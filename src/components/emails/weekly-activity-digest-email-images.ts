import type { DigestActivity } from "@/features/weekly-activity-digest/contract";
import { buildEmailImageUrl, EMAIL_IMAGE_LINK_TTL_DAYS, getEmailImageSigningSecret } from "@/lib/email-image-signing";

const DAY_MS = 86400000;
const MIN_REMAINING_DAYS = 30;

/**
 * Image links expire EMAIL_IMAGE_LINK_TTL_DAYS after the digest week ends, so retried sends produce
 * an identical payload (keeping Resend idempotency keys valid). Late replays that would leave less
 * than MIN_REMAINING_DAYS of validity are re-based on the current UTC day instead.
 */
export function getDigestImageExpiry(weekEndUtc: string, now: Date = new Date()): Date {
  const ttlMs = EMAIL_IMAGE_LINK_TTL_DAYS * DAY_MS;
  const weekEnd = new Date(weekEndUtc).getTime();
  const fromWeek = Math.ceil((Number.isNaN(weekEnd) ? 0 : weekEnd) / DAY_MS) * DAY_MS + ttlMs;
  if (fromWeek >= now.getTime() + MIN_REMAINING_DAYS * DAY_MS) {
    return new Date(fromWeek);
  }
  return new Date(Math.ceil(now.getTime() / DAY_MS) * DAY_MS + ttlMs);
}

/** Replaces stored image values with absolute, email-safe URLs (or null when unavailable). */
export function withEmailImageUrls(digest: DigestActivity, siteUrl: string, now: Date = new Date()): DigestActivity {
  const secret = getEmailImageSigningSecret();
  const expiresAt = getDigestImageExpiry(digest.weekEndUtc, now);
  const toUrl = (value: string | null) => buildEmailImageUrl({ siteUrl, familyId: digest.familyId, value, expiresAt, secret });
  return {
    ...digest,
    highlights: digest.highlights.map((highlight) => ({
      ...highlight,
      memberImageUrl: toUrl(highlight.memberImageUrl),
      post: highlight.post ? { ...highlight.post, imageUrl: toUrl(highlight.post.imageUrl) } : null,
    })),
  };
}
