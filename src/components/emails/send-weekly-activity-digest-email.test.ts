import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@react-email/render";
import { createElement } from "react";
import WeeklyActivityDigestEmail from "./templates/weekly-activity-digest-email";
import type { DigestActivity } from "@/features/weekly-activity-digest/contract";

const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
import { sendWeeklyActivityDigestEmail } from "./send-weekly-activity-digest-email";
const recipient = { memberId: 1, displayName: "Test Member", email: "member@example.com" };
const digest: DigestActivity = {
  newMembers: [],
  familyId: 7, familyName: "Test", weekStartUtc: "2026-10-05T00:00:00Z", weekEndUtc: "2026-10-11T23:59:59.999Z",
  topMembers: [{ displayName: "Test Member", count: 3 }], byActionType: [{ name: "POST_CREATED", count: 3 }],
  byFeature: [{ name: "Blogs", count: 3 }],
  featureDashboard: [{ featureName: "Blogs", actionType: "POST_CREATED", count: 2 }],
  memberDashboard: [{ memberName: "Test Member", actionType: "COMMENT_CREATED", count: 1 }, { memberName: "Test Member", actionType: "POST_CREATED", count: 2 }],
  highlights: [
    { memberName: "Test Member", memberImageUrl: null, actionType: "POST_CREATED", featureName: "Blogs", postName: "<script>unsafe</script>", post: null },
    {
      memberName: "Movie Fan", memberImageUrl: "/api/s3-upload?key=members%2Favatar.png", actionType: "POST_CREATED",
      featureName: "Movie Theater", postName: "Robin Hood",
      post: { imageUrl: "https://image.tmdb.org/t/p/w500/poster.jpg", tags: [], excerpt: "A spoof of Robin Hood.", likeCount: 3, loveCount: 2, commentCount: 1 },
    },
  ],
};
const SECRET = "0123456789abcdef0123456789abcdef";

describe("weekly digest email", () => {
  beforeEach(() => {
    send.mockReset();
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("FS_EMAIL_IMAGE_BASE_URL", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it("requires provider credentials and never pretends a missing key sent mail", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toMatchObject({ status: "failed" });
    expect(send).not.toHaveBeenCalled();
  });
  it("records provider IDs and forwards the idempotency key", async () => {
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toEqual({ status: "sent", providerMessageId: "message" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: recipient.email }), { idempotencyKey: "key" });
  });
  it("records explicit rejections as retryable failures", async () => {
    send.mockResolvedValue({ error: { name: "validation_error", message: "Invalid address" } });
    expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toEqual({ status: "failed", errorMessage: "Invalid address" });
  });
  it("does not treat an ambiguous provider failure as safe to retry", async () => {
    send.mockResolvedValue({ error: { name: "application_error", message: "Server error" } });
    expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toMatchObject({ status: "unknown" });
  });
  it("records thrown/network errors as uncertain, not definitively undelivered", async () => {
    send.mockRejectedValue(new Error("timeout"));
    expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toMatchObject({ status: "unknown" });
  });
  it("requires a successful message ID", async () => {
    send.mockResolvedValue({ data: null, error: null });
    expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toMatchObject({ status: "unknown" });
  });
  it("uses AUTH_URL for siteUrl when provided", async () => {
    vi.stubEnv("AUTH_URL", "https://local.my-family-social.com:3000");
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    await sendWeeklyActivityDigestEmail(recipient, digest, "key");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        react: expect.objectContaining({
          props: expect.objectContaining({
            siteUrl: "https://local.my-family-social.com:3000",
          }),
        }),
      }),
      { idempotencyKey: "key" },
    );
  });
  it("renders room-colored post cards, dashboard summaries, the homepage CTA, and escaped titles", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, { digest, displayName: recipient.displayName, siteUrl: "https://example.com" }));
    expect(html).toContain("Test Member");
    expect(html).toContain("Blogs");
    expect(html).toContain("New post");
    expect(html).toContain("Family Dashboards");
    expect(html).toContain("By Room: Posts, Comments, Reactions");
    expect(html).toContain("By Member: Posts, Comments, Reactions");
    expect(html).toContain("https://example.com");
    expect(html).toContain("Visit My Family Social");
    expect(html).toContain("Activity Summary");
    expect(html).toContain("10-05-26");
    expect(html).toContain("10-11-26");
    expect(html).not.toContain("10-05-2026");
    expect(html).not.toContain("10-11-2026");
    expect(html).not.toContain("UTC");
    expect(html).not.toContain("2026-10-05");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it.each([
    ["TV Room", "/tv"],
    ["Movie Theater", "/movies"],
    ["Home Theater", "/movies"],
    ["Music Salon", "/music"],
    ["Music Room", "/music"],
    ["The Kitchen", "/foodies"],
    ["Poetry Nook", "/poetry"],
    ["Reading Room", "/books"],
    ["Library", "/books"],
    ["Blogs", "/blogs"],
    ["Family Blog", "/blogs"],
    ["Living Room", "/blogs"],
    ["Family Gallery", "/family-gallery"],
    ["Family Discussions", "/threads"],
    ["Unknown Room", ""],
  ])("links %s post titles to their room while preserving the homepage button", async (featureName, path) => {
    const siteUrl = "https://family.example.com:3000";
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest: {
        ...digest,
        highlights: [{
          memberName: "Test Member", memberImageUrl: null, actionType: "POST_CREATED",
          featureName, postName: "Room link test", post: null,
        }],
      },
      displayName: recipient.displayName, siteUrl, imageBaseUrl: "https://images.example.com",
    }));
    expect(html).toMatch(new RegExp(`href="${siteUrl.replaceAll(".", "\\.")}${path}"[^>]*>Room link test</a>`));
    expect(html).toContain(`href="${siteUrl}"`);
    expect(html).not.toContain(`href="https://images.example.com${path}"`);
  });
  it("renders post images, avatars, excerpts, and like/love/comment counts", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, { digest, displayName: recipient.displayName, siteUrl: "https://example.com" }));
    expect(html).toContain("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(html).toContain("A spoof of Robin Hood.");
    expect(html).toContain("3 likes");
    expect(html).toContain("2 loves");
    expect(html).toContain("1 comment\"");
    expect(html).toContain("TM");
    expect(html).toMatch(/<img[^>]*alt="Robin Hood"[^>]*max-width:120px[^>]*width="120"/);
    expect(html).toMatch(/<img[^>]*alt="Movie Fan"[^>]*width="28"/);
  });
  it("renders new members between posts and dashboards with signed photos or initials", async () => {
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", SECRET);
    vi.stubEnv("FS_EMAIL_IMAGE_BASE_URL", "https://public.example.com");
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    const memberDigest: DigestActivity = {
      ...digest,
      newMembers: [
        { memberId: 40, memberName: "New Arrival", memberImageUrl: "family-7/members/new.jpg" },
        { memberId: 41, memberName: "<script>Guest</script> Member", memberImageUrl: null },
      ],
    };
    await sendWeeklyActivityDigestEmail(recipient, memberDigest, "key");
    const email = send.mock.calls[0]?.[0].react;
    const sentDigest = email.props.digest as DigestActivity;
    const photo = new URL(sentDigest.newMembers[0]!.memberImageUrl!);
    expect(photo.origin + photo.pathname).toBe("https://public.example.com/api/email-image");
    expect(photo.searchParams.get("k")).toBe("family-7/members/new.jpg");
    expect(sentDigest.newMembers[1]?.memberImageUrl).toBeNull();
    expect(memberDigest.newMembers[0]?.memberImageUrl).toBe("family-7/members/new.jpg");
    const html = await render(email);
    expect(html.indexOf("New Members</h2>")).toBeGreaterThan(html.indexOf("New Posts</h2>"));
    expect(html.indexOf("New Members</h2>")).toBeLessThan(html.indexOf("Family Dashboards</h2>"));
    expect(html).toMatch(/<img[^>]*alt="New Arrival"[^>]*width="48"/);
    expect(html).toContain("&lt;script&gt;Guest&lt;/script&gt; Member");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Joined the family this week. Welcome!");
  });
  it("omits the new members section when no members joined", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest, displayName: recipient.displayName, siteUrl: "https://example.com",
    }));
    expect(html).not.toContain("New Members");
  });
  it("bounds multiline right-hand previews with an ellipsis and a 280-character fallback limit", async () => {
    const longLine = "A long opening sentence with useful details. ".repeat(10);
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest: {
        ...digest,
        highlights: [{
          ...digest.highlights[1]!,
          post: { imageUrl: null, tags: [], excerpt: `${longLine}\nHidden second line`, likeCount: 0, loveCount: 0, commentCount: 0 },
        }],
      },
      displayName: recipient.displayName, siteUrl: "https://example.com",
    }));
    const preview = html.match(/<div style="max-height:144px;[^"]*"><p[^>]*>([^<]*)<\/p>/);
    expect(preview).not.toBeNull();
    expect(preview?.[1]?.length).toBeLessThanOrEqual(280);
    expect(preview?.[1]).toMatch(/…$/);
    expect(preview?.[0]).toContain("line-height:18px");
    expect(preview?.[0]).toContain("overflow-wrap:anywhere");
    expect(preview?.[0]).not.toContain("white-space:nowrap");
    expect(preview?.[0]).toContain("-webkit-line-clamp:8");
    expect(html.indexOf(preview![0])).toBeGreaterThan(html.indexOf("Robin Hood</a>"));
    expect(html).not.toContain("Hidden second line");
    expect(html).toContain("table-layout:fixed");
  });
  it("places the author and counts below the title, not below artwork", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest: { ...digest, highlights: [digest.highlights[1]!] },
      displayName: recipient.displayName, siteUrl: "https://example.com",
    }));
    const artwork = html.indexOf('alt="Robin Hood"');
    const author = html.indexOf("Movie Fan</p>");
    const reactions = html.indexOf('title="3 likes"');
    const avatar = html.indexOf('alt="Movie Fan"');
    const title = html.indexOf("Robin Hood</a>");
    expect(artwork).toBeGreaterThan(-1);
    expect(author).toBeGreaterThan(artwork);
    expect(reactions).toBeGreaterThan(author);
    expect(avatar).toBeGreaterThan(artwork);
    expect(title).toBeGreaterThan(avatar);
    expect(author).toBeGreaterThan(title);
    expect(html).not.toContain("Shared by");
    expect(html.indexOf("A spoof of Robin Hood.")).toBeGreaterThan(title);
  });
  it("continues the preview across source lines instead of stopping after the opening line", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest: { ...digest, highlights: [{
        ...digest.highlights[1]!,
        post: { ...digest.highlights[1]!.post!, excerpt: "Opening line.\nMore text from the post.\nAnother line." },
      }] },
      displayName: recipient.displayName, siteUrl: "https://example.com",
    }));
    expect(html).toContain("Opening line. More text from the post. Another line.");
  });
  it("stacks the preview in a full-width row on phones without changing desktop layout", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest: { ...digest, highlights: [digest.highlights[1]!] },
      displayName: recipient.displayName, siteUrl: "https://example.com",
    }));
    expect(html).toContain("(max-width: 480px)");
    expect(html).toContain(".digest-post-details { width: 100% !important; padding-right: 0 !important; }");
    expect(html).toContain(".digest-post-preview-desktop { display: none !important; }");
    expect(html).toContain(".digest-post-preview-mobile { display: table-row !important; }");
    expect(html).toMatch(/<td class="digest-post-preview-desktop"[^>]*>/);
    expect(html).toMatch(/<tr class="digest-post-preview-mobile" style="display:none[^"]*"><td colSpan="2"/);
    expect(html.match(/A spoof of Robin Hood\./g)).toHaveLength(2);
    const tables: number[] = [];
    let nextTableId = 0;
    let artworkTable: number | undefined;
    let mobilePreviewTable: number | undefined;
    for (const match of html.matchAll(/<table\b[^>]*>|<\/table>|<img\b[^>]*>|<tr\b[^>]*>/g)) {
      const tag = match[0];
      if (tag.startsWith("<table")) tables.push(++nextTableId);
      else if (tag === "</table>") tables.pop();
      else if (tag.startsWith("<img") && tag.includes('alt="Robin Hood"')) {
        artworkTable = tables[tables.length - 1];
      } else if (tag.startsWith("<tr") && tag.includes('class="digest-post-preview-mobile"')) {
        mobilePreviewTable = tables[tables.length - 1];
      }
    }
    expect(artworkTable).toBeDefined();
    expect(mobilePreviewTable).toBe(artworkTable);
  });
  it.each(["Reading Room", "Poetry Nook"])("shows %s tags in the left column even without images or reactions", async (featureName) => {
    const taggedDigest: DigestActivity = {
      ...digest,
      highlights: [{
        memberName: "Test Member", memberImageUrl: null, actionType: "POST_CREATED",
        featureName, postName: "Tagged post",
        post: { imageUrl: null, tags: ["Nature", "<script>Literary</script>"], excerpt: null, likeCount: 0, loveCount: 0, commentCount: 0 },
      }],
    };
    const html = await render(createElement(WeeklyActivityDigestEmail, {
      digest: taggedDigest, displayName: recipient.displayName, siteUrl: "https://example.com",
    }));
    expect(html).toContain("width:120px");
    expect(html).toContain("Nature</span>");
    expect(html).toContain("&lt;script&gt;Literary&lt;/script&gt;</span>");
    expect(html.indexOf("Nature</span>")).toBeLessThan(html.indexOf("Tagged post</a>"));
    expect(html).not.toContain('alt="Tagged post"');
    expect(html).not.toContain("<script>");
  });
  it("rewrites private S3 images to signed email-image links before sending", async () => {
    vi.stubEnv("AUTH_URL", "https://family.example.com");
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", SECRET);
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    await sendWeeklyActivityDigestEmail(recipient, digest, "key");
    const sentDigest = send.mock.calls[0]?.[0].react.props.digest as DigestActivity;
    const avatar = new URL(sentDigest.highlights[1]?.memberImageUrl ?? "");
    expect(avatar.origin + avatar.pathname).toBe("https://family.example.com/api/email-image");
    expect(avatar.searchParams.get("f")).toBe("7");
    expect(avatar.searchParams.get("k")).toBe("members/avatar.png");
    expect(sentDigest.highlights[1]?.post?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(digest.highlights[1]?.memberImageUrl).toBe("/api/s3-upload?key=members%2Favatar.png");
  });
  it("omits private S3 images when no signing secret is configured", async () => {
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", "");
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    await sendWeeklyActivityDigestEmail(recipient, digest, "key");
    const sentDigest = send.mock.calls[0]?.[0].react.props.digest as DigestActivity;
    expect(sentDigest.highlights[1]?.memberImageUrl).toBeNull();
    expect(sentDigest.highlights[1]?.post?.imageUrl).toBe("https://image.tmdb.org/t/p/w500/poster.jpg");
  });
  it.each([
    ["Music Room", "https://i.scdn.co/image/ab67616d00001e028c1029772ceac2ab96593eaa"],
    ["Home Theater", "https://image.tmdb.org/t/p/w780/qmliLoo6GVheM2FihatlAXxCKyF.jpg"],
  ])("renders public %s artwork directly in the sent HTML", async (featureName, imageUrl) => {
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", "");
    vi.stubEnv("FS_EMAIL_IMAGE_BASE_URL", "https://public.example.com");
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    const publicImageDigest: DigestActivity = {
      ...digest,
      highlights: [{
        memberName: "Test Member", memberImageUrl: null, actionType: "POST_CREATED",
        featureName, postName: "Public artwork",
        post: { imageUrl, tags: [], excerpt: null, likeCount: 0, loveCount: 0, commentCount: 0 },
      }],
    };
    expect(await sendWeeklyActivityDigestEmail(recipient, publicImageDigest, "key")).toMatchObject({ status: "sent" });
    const html = await render(send.mock.calls[0]?.[0].react);
    expect(html).toContain(`src="${imageUrl}"`);
    expect(html).not.toContain("/api/email-image");
  });
  it("uses the public image host for the logo and signed images but keeps links on AUTH_URL", async () => {
    vi.stubEnv("AUTH_URL", "https://local.my-family-social.com:3000");
    vi.stubEnv("FS_EMAIL_IMAGE_BASE_URL", "https://public.example.com/");
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", SECRET);
    send.mockResolvedValue({ data: { id: "message" }, error: null });
    const privateImageDigest: DigestActivity = {
      ...digest,
      highlights: digest.highlights.map((entry) => ({
        ...entry,
        post: entry.post ? { ...entry.post, imageUrl: "family-7/movies/poster.jpg" } : null,
      })),
    };
    expect(await sendWeeklyActivityDigestEmail(recipient, privateImageDigest, "key")).toMatchObject({ status: "sent" });
    const email = send.mock.calls[0]?.[0].react;
    const sentDigest = email.props.digest as DigestActivity;
    for (const value of [sentDigest.highlights[1]?.memberImageUrl, sentDigest.highlights[1]?.post?.imageUrl]) {
      expect(new URL(value ?? "").origin).toBe("https://public.example.com");
    }
    const html = await render(email);
    expect(html).toContain('src="https://public.example.com/images/pwa-phone-logo-192.png"');
    expect(html).not.toContain('src="https://local.my-family-social.com:3000');
    expect(html).toContain('href="https://local.my-family-social.com:3000"');
    expect(email.props.siteUrl).toBe("https://local.my-family-social.com:3000");
  });
  it.each(["not-a-url", "ftp://example.com", "https://user:password@example.com", "https://example.com/path", "https://example.com?key=value", "https://example.com#fragment"])(
    "rejects invalid image base configuration %s before sending",
    async (imageBaseUrl) => {
      vi.stubEnv("FS_EMAIL_IMAGE_BASE_URL", imageBaseUrl);
      expect(await sendWeeklyActivityDigestEmail(recipient, digest, "key")).toEqual({
        status: "failed", errorMessage: "FS_EMAIL_IMAGE_BASE_URL must be an absolute HTTP(S) origin.",
      });
      expect(send).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalled();
    },
  );
});
