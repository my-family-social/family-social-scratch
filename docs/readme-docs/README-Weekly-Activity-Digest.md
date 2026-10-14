# Weekly activity digest

## Setup

1. Apply [the additive SQL script](../sql-scripts/create-weekly-activity-digest-tables.sql) to the family database before deploying. The definitions are also exported by the family Drizzle schema. Do not run a broad schema push against shared environments just to install these tables. Also apply [the `post_id` column script](../sql-scripts/add-family-activity-post-id-column.sql) **before** deploying this code: activity inserts write `post_id`, so they fail until the column exists.
2. Set `FS_INTERNAL_API_SECRET` to a strong shared secret in the app environment. Never put it in source control. Callers must supply the exact value.

      Use the following PowerShell script to generate a 256-bit secret. 
      ```bash
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $rng.Dispose()
        [Convert]::ToBase64String($bytes)
      ```

3. Optional: `FS_DIGEST_MIN_ACTIVITY_SCORE` (nonnegative integer, default `12`). Two distinct posters are always required. Only `active` activity records with a weighted action count toward the score.
4. Set `FS_EMAIL_IMAGE_SIGNING_SECRET` (at least 32 characters; generate it the same way as above, using a value different from `FS_INTERNAL_API_SECRET`) in both the web app and the worker environments. Without it, emails omit S3-hosted images (post photos and member avatars). Public external images, such as TMDB posters, still appear. Rotating the secret invalidates image links in emails already sent.
5. Live delivery uses existing `RESEND_API_KEY`, sender address, and `AUTH_URL` (with fallback to `NEXTAUTH_URL`, `SITE_BASE_URL`, or default production host). Dry runs never invoke Resend.
   Optional: set `FS_EMAIL_IMAGE_BASE_URL` to a publicly reachable HTTPS app origin (for example, `https://my-family-social.com`) when `AUTH_URL` points to a local development server. This overrides the host for the weekly digest logo and signed S3 images only; the homepage button and post-title links still use `AUTH_URL`. Without this setting, images use the same host as the homepage. The value must be an absolute HTTP(S) origin without credentials, a path, query, or fragment; invalid configuration fails delivery with a logged error.
6. Start the web app normally. Start the worker in a second terminal:

   ```powershell
    npm run digest:worker -- --env-file=.env.google-local
   ```

    To be safe, if you've made changes to the digest code, then it's just best to stop and start it with the command above. However, the `digest start` command below will start it in watch mode so that, as you make tsx changes during development, it will pick them up. 
    ```powershell
      npx tsx watch scripts\weekly-activity-digest-worker.ts --env-file=.env.google-local
    ```

   Without `--env-file`, the worker loads Next.js's standard environment files. It does not implicitly load `.env.google-local`. Use `--once` to process one queued/interrupted run and exit. Use `--dry-run-only` to exclude live runs, and `--run-id=<uuid>` to target a particular queued/interrupted run. Production must supervise this worker separately; running only the web process will leave runs queued.
   Restart the digest worker after changing its code as well as its environment. It does not hot-reload with the Next.js development server; an already-running worker continues using the modules loaded at startup.


The kickoff is durable: 202 means a run was written to the database, not that emails were sent. The worker polls every five seconds, holds a PostgreSQL session advisory lock, and resumes runs left in `processing` after a restart. Only one worker operates at a time. It finishes the current run on a graceful shutdown; a hard shutdown is recoverable.

Database polling failures use `logDbQueryError` with scope `weekly-activity-digest.getNextDigestRun`; advisory-lock connection errors use scope `weekly-activity-digest.worker.lockConnection`. Both produce structured `[DB_QUERY_FAILED]` console logs through the shared logger. Sentry delivery requires Sentry to be initialized in the standalone worker; Next.js server instrumentation does not automatically initialize a separate worker process.

`ECONNRESET` on the lock connection or `fetch failed` during polling indicates a database/network connectivity failure, not necessarily invalid SQL. The worker exits on these failures rather than continuing without its advisory lock. Restart it after connectivity is restored (a deployed process supervisor can handle restarts). `tsx watch` reloads code changes, but is not a substitute for a supervisor that restarts crashed workers. Logging alone does not reconnect the database or retry sends. A run already logged as `Finished` is not made unsuccessful by a later idle polling failure; inspect its persisted run and delivery audit to confirm the outcome.

## SoapUI POST

### Import the WADL

1. In SoapUI, choose **File > New REST Project**, then select **Import WADL** (the label varies by version).
2. Select [weekly-activity-digest.wadl](../api/weekly-activity-digest.wadl).
3. Add a project custom property named `FS_INTERNAL_API_SECRET` containing your configured secret. Keep that value local; do not commit or share a SoapUI project with the secret saved in it.
4. Open the generated POST request and set its media type to `application/json`. Paste the dry-run JSON example below into the body. WADL does not reliably generate JSON request bodies in SoapUI.
5. Verify the imported header values. The WADL uses `${#Project#FS_INTERNAL_API_SECRET}` for the secret, `${=java.time.Instant.now().toString()}` for a fresh UTC timestamp, and `soapui-weekly-${=java.util.UUID.randomUUID().toString()}` for a new kickoff key. If your SoapUI version does not preserve these defaults, enter them in the request's Headers tab.
6. Change the endpoint to match your app. For a duplicate-request test, replace the dynamic kickoff key with a fixed value and submit the same week twice; expect 202 then 409.

The WADL includes the JSON request contract and examples for 202, 400, 401, 409, and 500 responses. The initial body uses `dryRun: true` to avoid sending email.

Create a REST POST request to:

```text
https://local.my-family-social.com:3000/api/internal/weekly-activity-digest/run
```

Use the actual local hostname/port of your running app. No browser login, session cookie, or OAuth token is required.

Headers:

```text
Content-Type: application/json
x-fs-internal-secret: <the configured secret>
x-fs-request-ts: <current ISO-8601 UTC timestamp ending in Z>
x-fs-idempotency-key: weekly-activity-2026-10-05-preview
```

`x-fs-request-ts` must be within five minutes of the server clock, including future clock skew. Generate a fresh value in PowerShell with `(Get-Date).ToUniversalTime().ToString("o")`. The idempotency key accepts 1-200 letters, digits, dots, underscores, colons, and hyphens.

Example body (safe first run):

```json
{
  "weekStartUtc": "2026-10-05T00:00:00Z",
  "weekEndUtc": "2026-10-11T23:59:59.999Z",
  "dryRun": true,
  "familyIds": [1]
}
```

Replace `[1]` with existing active/trial family IDs. Omit `familyIds` to snapshot all active/trial families at kickoff. IDs must be distinct positive integers, with a maximum of 10,000 in an explicit subset. Missing, expired, or otherwise inactive requested families return 400. Eligibility is checked again before processing.

The body is strict: unknown properties are rejected. Start must be Monday midnight UTC and end exactly that week's final millisecond. `dryRun` and `forceReplay` default to false. `minActivityScoreOverride` can override the score threshold for a test; it cannot bypass the two-poster requirement.

Success (202):

```json
{
  "success": true,
  "runId": "<uuid>",
  "status": "queued",
  "weekStartUtc": "2026-10-05T00:00:00.000Z",
  "weekEndUtc": "2026-10-11T23:59:59.999Z",
  "familyScope": "subset",
  "requestedFamilyCount": 1,
  "dryRun": true,
  "message": "Digest run persisted. The digest worker will process it."
}
```

Errors: 400 `INVALID_REQUEST` with `issues`, 401 `UNAUTHORIZED`, 409 `ALREADY_QUEUED` with original `runId`, or 500 `INTERNAL_ERROR`. Missing server-side secret configuration is a 500 (and is logged), not an authentication bypass. A duplicate week/key returns 409 even if the run is already completed or failed.

## Scoring and content

Weights: posts 3; comments, discussion starts, threads, and album shares 2; discussion replies/reactions, likes, and loves 1. The gate is score >= threshold AND distinct non-null member IDs >= 2. Activity timestamps are stored without timezone in the existing table; queries interpret the requested week as UTC explicitly.

Results include score, distinct posters, total weighted events, threshold, eligible recipients, and email totals. Each email presents every recorded post-created, album-shared, or discussion-start event for the week as a room-colored card, followed by family-dashboard summaries by room and member for posts, comments, and reactions. The homepage button links to `AUTH_URL`. Private mailbox thread titles are not included. Existing `Family Blog` feature labels are normalized to `Blogs` in feature counts.

### Post cards

The greeting displays the activity date range as `MM-DD-YY to MM-DD-YY`, without a UTC label. This is a display-only change; activity selection still uses the configured UTC week boundaries.

Each card shows the room, the action, the member avatar (or initials), and the title. When the activity can be matched to its post, the card also shows the post image, a short excerpt, and like (👍), love (❤), and comment (💬) counts as of send time. Counts follow the room pages: the submitter's own rating is excluded, and reviewer, pro-tip, analysis, and deleted comments are not counted.

Post artwork is displayed at 120px wide with its original aspect ratio; member avatars remain 28px beside the title. Book and poetry cards show their assigned category tags as room-colored labels in the same left-hand area instead of an image. The posting member's name appears below the title, followed by reaction counts, in the middle column rather than below the image. Tags are loaded at send time for visible posts only, sorted by name, with duplicate or blank names removed.

The right side includes opening text from the post body (TV/movie/music content, book analysis, poem verse, recipe body, blog body, or album description), continuing across source lines and paragraphs to fill the preview area. Rich-text formatting and media are not included. An existing recipe/blog summary is used only when body text is unavailable. Previews wrap at an 18px line height and are clamped to eight lines (144px) with an ellipsis in supporting clients. A 280-character server-side limit, including an ellipsis when shortened, bounds the text even in clients that ignore CSS line clamping. Email clients vary in CSS support; the preview cannot dynamically measure the neighboring artwork's height. Empty previews are omitted; stored content and room pages are unchanged.

Post titles link to their room homepage on the `AUTH_URL` host: `/tv`, `/movies`, `/music`, `/foodies`, `/poetry`, `/books`, `/blogs`, or `/family-gallery` (and `/threads` for Family Discussions). Room aliases such as Music Room/Music Salon and Home Theater/Movie Theater share the same destination. Unrecognized room names fall back to the application homepage. The bottom **Visit My Family Social** button still links to the application homepage, and `FS_EMAIL_IMAGE_BASE_URL` does not affect navigation links.

- Matching: new activity rows store `post_id`. Rows recorded before the column existed are matched by member and title (blogs and gallery albums only); if no match is found, the card shows only the room, title, and member.
- Visibility: draft, template, and private posts, unpublished blogs, and unshared albums never contribute an image, excerpt, or counts. Gallery cards use the album's first photo.
- Music activity labeled either `Music Room` or `Music Salon` resolves to the same music posts and artwork, including legacy title-matched activity.
- Movie activity labeled either `Home Theater` or `Movie Theater` resolves to the same movie posts.

### New members

When active `MEMBER_JOINED` activity exists within the digest week, a **New Members** section appears between New Posts and Family Dashboards. It joins the activity member ID to the same family's member record and displays each member once, ordered by name. Cards show the member's name and a 48px profile photo, or initials when no usable photo is available. Profile photos use the same signed-image handling as post-card avatars. No email addresses or other contact details are included. When nobody joined, the section is omitted.

Membership events do not change the existing activity score, two-poster requirement, dashboard counts, or recipient eligibility. A week containing only membership events does not independently qualify for an email.

### Email images

S3 objects are never made public. When sending, each S3-hosted image is rewritten to `/api/email-image?f=&k=&e=&s=`, an HMAC-SHA256-signed link bound to the family, object key, and expiry. Links expire 90 days after the digest week ends (or 90 days after a late replay). Expiry is derived from the digest week, so a retried send produces an identical payload, as Resend idempotency requires. The route is unauthenticated so mail clients and image proxies can fetch it:

- 403: tampered link
- 410: expired link
- 400: malformed or cross-family key
- 404: signing not configured, or the object is not a raster image (SVG is refused)

Valid images are streamed from the family's bucket with `Cache-Control: public, max-age=604800, immutable`. External image URLs are passed through unchanged, including public Spotify artwork (`https://i.scdn.co/image/`) and TMDB posters (`https://image.tmdb.org/`). These public URLs do not use `/api/email-image`, the signing secret, or `FS_EMAIL_IMAGE_BASE_URL`.

For local email testing, Gmail and Resend cannot fetch images from a local-only host such as `local.my-family-social.com:3000`, even when that host works in your browser. Set `FS_EMAIL_IMAGE_BASE_URL` in the sending worker's environment to a public deployed app with `/api/email-image` installed. That app must use the **same** `FS_EMAIL_IMAGE_SIGNING_SECRET` as the sender and have access to the same family IDs, S3 configuration, and objects. Its logo and image route must be reachable without login or deployment access protection. Restart the worker after changing its environment. An image base URL is not a direct S3 bucket URL.

This setting affects newly generated email HTML, not emails already delivered. Successful deliveries for the same family/week/member are not resent by `forceReplay`; use a new test week or an eligible test recipient with no successful delivery for that week. To diagnose rendering, inspect the actual HTML in Resend or Gmail's **Show original** message action, not the Gmail application's browser page source.

Recipients must be active members with a selected option whose case-insensitive name is exactly `Activity Summary`, and a valid trimmed email. Missing notification rows are not automatically opted in or synchronized by this worker. Invalid email addresses are excluded and logged with member/family IDs.

## Replay and audit

Use a **new kickoff key** for previews, live runs, or replays. `forceReplay` never bypasses kickoff idempotency, the score gate, current family eligibility, or recipient preferences.

```json
{
  "weekStartUtc": "2026-10-05T00:00:00Z",
  "weekEndUtc": "2026-10-11T23:59:59.999Z",
  "forceReplay": true,
  "operatorNotes": "Retry confirmed provider rejections after correcting email configuration",
  "familyIds": [1]
}
```

`operatorNotes` is required for `forceReplay`. Only definitively failed deliveries can be retried. Successful deliveries for the same family/week/member are never resent, even under a different kickoff key. A member with no prior delivery may receive a digest on a later run if now eligible. A preview does not consume live delivery keys.

The delivery table is required for this retry policy. A unique family/week/member key and atomic reservation protect against duplicate submissions. A provider idempotency key is also sent per reserved attempt. `sending`/`unknown` outcomes are never retried automatically: after a crash, network error, or ambiguous provider response, reconcile with Resend first. If confirmed delivered, record `sent` and its provider message ID; only a confirmed nondelivery may be changed to `failed` for explicit replay. Do not rely solely on the provider's time-limited idempotency retention to retry uncertain deliveries.

Intentional schema differences from the initial recommendation:

- Family results are unique by **run/family**, with a family/week index, so previews and replays retain separate audit rows rather than overwriting weekly history.
- Weekly send uniqueness is enforced at the **delivery** level.
- Preview status is `sent-preview`; it has zero email attempts and creates no delivery rows.
- Runs store resolved family scope, threshold, replay flag, notes, metrics, and error information for restart recovery.

Run metrics are finalized from family result rows. Delivery failures include unresolved failures/uncertain outcomes for the family/week, while sent and attempted counts refer to this run. Partial successes are retained when a later recipient fails. A run with any failed family finishes `failed`; others continue processing.

Inspect progress (substitute the returned UUID):

```sql
SELECT * FROM family_schema.family_activity_digest_run WHERE run_id = '<uuid>';
SELECT * FROM family_schema.family_activity_digest_result WHERE run_id = '<uuid>';
SELECT * FROM family_schema.family_activity_digest_delivery WHERE run_id = '<uuid>';
```

## Validation and rollout

Run targeted tests:

```powershell
npx vitest run src\app\api\internal\weekly-activity-digest\run\router.test.ts src\features\weekly-activity-digest\service.test.ts src\components\emails src\lib\email-image-signing.test.ts src\app\api\email-image\router.test.ts src\components\db\sql\queries-weekly-activity-digest-posts.test.ts
```

The database integration test is opt-in. It uses the configured database, inserts fixtures inside a transaction, and rolls them back. Apply the additive tables first:

```powershell
$env:FS_DIGEST_DB_TESTS = "1"
node --env-file=.env.google-local node_modules\vitest\vitest.mjs run src\components\db\sql\queries-weekly-activity-digest.integration.test.ts
```

Start with dry runs for one or two weeks to calibrate the threshold. EventBridge configuration, retries/DLQ, CloudWatch alarms, and any future SQS fan-out are separate deployment work. Internal authentication is reusable for future internal routes; family-level operations are service functions, not additional HTTP endpoints.
