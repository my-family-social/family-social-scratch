import { createHmac, timingSafeEqual } from "node:crypto";
import { extractS3KeyFromValue } from "@/lib/s3-object-key";
import { isKeyInFamilyScope, isSafeObjectKey } from "@/lib/s3-safe-object-key";

export const EMAIL_IMAGE_ROUTE_PATH = "/api/email-image";
export const EMAIL_IMAGE_SIGNING_SECRET_ENV = "FS_EMAIL_IMAGE_SIGNING_SECRET";
export const EMAIL_IMAGE_LINK_TTL_DAYS = 90;
// Rejects links whose expiry is implausibly far in the future even if the signature is valid.
export const EMAIL_IMAGE_MAX_TTL_SECONDS = 400 * 86400;
const MIN_SECRET_LENGTH = 32;
const HTTP_URL_REGEX = /^https?:\/\//i;
const S3_UPLOAD_ROUTE_REGEX = /^\/?api\/s3-upload(?:\/)?$/i;

export type EmailImageSource = { kind: "external"; url: string } | { kind: "s3"; key: string };

export function getEmailImageSigningSecret(): string | null {
  const secret = process.env[EMAIL_IMAGE_SIGNING_SECRET_ENV]?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function keyFromS3UploadRoute(url: URL): string | null | undefined {
  if (!S3_UPLOAD_ROUTE_REGEX.test(url.pathname)) return undefined;
  return extractS3KeyFromValue(url.searchParams.get("key"));
}

/**
 * Classifies a stored image value (S3 key, `/api/s3-upload?key=...` link, S3 URL, or
 * external URL such as a TMDB poster) into something an email can reference.
 */
export function resolveEmailImageSource(value: string | null | undefined): EmailImageSource | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  let key: string | null;
  try {
    if (HTTP_URL_REGEX.test(trimmed)) {
      const url = new URL(trimmed);
      const routeKey = keyFromS3UploadRoute(url);
      if (routeKey !== undefined) {
        key = routeKey;
      } else if (url.hostname.toLowerCase().endsWith("amazonaws.com")) {
        key = extractS3KeyFromValue(trimmed);
      } else {
        return { kind: "external", url: url.toString() };
      }
    } else if (trimmed.startsWith("/")) {
      const url = new URL(trimmed, "http://localhost");
      const routeKey = keyFromS3UploadRoute(url);
      key = routeKey !== undefined ? routeKey : extractS3KeyFromValue(trimmed);
    } else {
      key = extractS3KeyFromValue(trimmed);
    }
  } catch {
    return null;
  }

  return key && isSafeObjectKey(key) ? { kind: "s3", key } : null;
}

function signaturePayload(familyId: number, key: string, expiresAtSeconds: number) {
  return `v1\n${familyId}\n${key}\n${expiresAtSeconds}`;
}

export function signEmailImage(familyId: number, key: string, expiresAtSeconds: number, secret: string): string {
  return createHmac("sha256", secret).update(signaturePayload(familyId, key, expiresAtSeconds)).digest("base64url");
}

export function verifyEmailImageSignature(
  input: { familyId: number; key: string; expiresAtSeconds: number; signature: string },
  secret: string,
): boolean {
  const expected = Buffer.from(signEmailImage(input.familyId, input.key, input.expiresAtSeconds, secret));
  const provided = Buffer.from(input.signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/**
 * Builds an email-safe absolute image URL. External URLs pass through unchanged, private S3
 * objects are exposed through a signed, expiring app route. Returns null when the image
 * cannot be referenced (unsupported value, out-of-family key, or missing signing secret).
 */
export function buildEmailImageUrl(input: {
  siteUrl: string;
  familyId: number;
  value: string | null | undefined;
  expiresAt: Date;
  secret: string | null;
}): string | null {
  const source = resolveEmailImageSource(input.value);
  if (!source) return null;
  if (source.kind === "external") return source.url;
  if (!input.secret || !isKeyInFamilyScope(source.key, input.familyId)) return null;

  const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1000);
  let url: URL;
  try {
    url = new URL(EMAIL_IMAGE_ROUTE_PATH, input.siteUrl.endsWith("/") ? input.siteUrl : `${input.siteUrl}/`);
  } catch {
    return null;
  }
  url.searchParams.set("f", String(input.familyId));
  url.searchParams.set("k", source.key);
  url.searchParams.set("e", String(expiresAtSeconds));
  url.searchParams.set("s", signEmailImage(input.familyId, source.key, expiresAtSeconds, input.secret));
  return url.toString();
}
