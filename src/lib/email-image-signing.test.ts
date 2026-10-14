import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildEmailImageUrl,
  getEmailImageSigningSecret,
  resolveEmailImageSource,
  signEmailImage,
  verifyEmailImageSignature,
} from "./email-image-signing";

const SECRET = "0123456789abcdef0123456789abcdef";
const expiresAt = new Date("2027-01-01T00:00:00Z");

describe("email image signing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("classifies stored image values", () => {
    expect(resolveEmailImageSource("/api/s3-upload?key=movies%2Fposter.jpg")).toEqual({ kind: "s3", key: "movies/poster.jpg" });
    expect(resolveEmailImageSource("https://app.example.com/api/s3-upload?key=family-3%2Fblogs%2Fcover.png"))
      .toEqual({ kind: "s3", key: "family-3/blogs/cover.png" });
    expect(resolveEmailImageSource("family-3/galleries/member-9/photo.jpg")).toEqual({ kind: "s3", key: "family-3/galleries/member-9/photo.jpg" });
    expect(resolveEmailImageSource("https://bucket.s3.us-east-2.amazonaws.com/foodies/cake.jpg")).toEqual({ kind: "s3", key: "foodies/cake.jpg" });
    expect(resolveEmailImageSource("https://image.tmdb.org/t/p/w500/x.jpg")).toEqual({ kind: "external", url: "https://image.tmdb.org/t/p/w500/x.jpg" });
    expect(resolveEmailImageSource("secrets/../../etc/passwd")).toBeNull();
    expect(resolveEmailImageSource("")).toBeNull();
    expect(resolveEmailImageSource(null)).toBeNull();
  });

  it("requires a sufficiently long secret", () => {
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", "short");
    expect(getEmailImageSigningSecret()).toBeNull();
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", SECRET);
    expect(getEmailImageSigningSecret()).toBe(SECRET);
  });

  it.each([
    "https://i.scdn.co/image/ab67616d00001e028c1029772ceac2ab96593eaa",
    "https://image.tmdb.org/t/p/w780/qmliLoo6GVheM2FihatlAXxCKyF.jpg",
  ])("keeps public artwork unchanged without S3 signing: %s", (value) => {
    expect(resolveEmailImageSource(value)).toEqual({ kind: "external", url: value });
    expect(buildEmailImageUrl({
      siteUrl: "https://app.example.com", familyId: 28, value, expiresAt, secret: null,
    })).toBe(value);
  });

  it("builds verifiable signed links and passes external URLs through", () => {
    const url = new URL(buildEmailImageUrl({ siteUrl: "https://app.example.com", familyId: 3, value: "movies/poster.jpg", expiresAt, secret: SECRET }) ?? "");
    expect(url.pathname).toBe("/api/email-image");
    const params = { familyId: 3, key: url.searchParams.get("k") ?? "", expiresAtSeconds: Number(url.searchParams.get("e")), signature: url.searchParams.get("s") ?? "" };
    expect(params.key).toBe("movies/poster.jpg");
    expect(params.expiresAtSeconds).toBe(expiresAt.getTime() / 1000);
    expect(verifyEmailImageSignature(params, SECRET)).toBe(true);
    expect(verifyEmailImageSignature({ ...params, familyId: 4 }, SECRET)).toBe(false);
    expect(verifyEmailImageSignature({ ...params, key: "movies/other.jpg" }, SECRET)).toBe(false);
    expect(verifyEmailImageSignature({ ...params, expiresAtSeconds: params.expiresAtSeconds + 1 }, SECRET)).toBe(false);
    expect(verifyEmailImageSignature({ ...params, signature: "short" }, SECRET)).toBe(false);

    expect(buildEmailImageUrl({ siteUrl: "https://app.example.com", familyId: 3, value: "https://image.tmdb.org/x.jpg", expiresAt, secret: null }))
      .toBe("https://image.tmdb.org/x.jpg");
  });

  it("refuses to sign without a secret or for another family's key", () => {
    expect(buildEmailImageUrl({ siteUrl: "https://app.example.com", familyId: 3, value: "movies/poster.jpg", expiresAt, secret: null })).toBeNull();
    expect(buildEmailImageUrl({ siteUrl: "https://app.example.com", familyId: 3, value: "family-4/movies/poster.jpg", expiresAt, secret: SECRET })).toBeNull();
    expect(signEmailImage(3, "movies/poster.jpg", 1, SECRET)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
