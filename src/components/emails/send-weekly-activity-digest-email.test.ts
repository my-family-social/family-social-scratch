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
      post: { imageUrl: "https://image.tmdb.org/t/p/w500/poster.jpg", excerpt: "A spoof of Robin Hood.", likeCount: 3, loveCount: 2, commentCount: 1 },
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
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("renders post images, avatars, excerpts, and like/love/comment counts", async () => {
    const html = await render(createElement(WeeklyActivityDigestEmail, { digest, displayName: recipient.displayName, siteUrl: "https://example.com" }));
    expect(html).toContain("https://image.tmdb.org/t/p/w500/poster.jpg");
    expect(html).toContain("A spoof of Robin Hood.");
    expect(html).toContain("3 likes");
    expect(html).toContain("2 loves");
    expect(html).toContain("1 comment\"");
    expect(html).toContain("TM");
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
