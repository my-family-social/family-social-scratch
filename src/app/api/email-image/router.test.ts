import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/api/api-error-logger", () => ({ logApiRouteError: vi.fn() }));
vi.mock("@/lib/s3-client-factory", () => ({ getS3ClientForFamily: vi.fn() }));

import { S3Client } from "@aws-sdk/client-s3";
import { logApiRouteError } from "@/components/api/api-error-logger";
import { buildEmailImageUrl } from "@/lib/email-image-signing";
import { getS3ClientForFamily } from "@/lib/s3-client-factory";
import { GET } from "./router";

const SECRET = "0123456789abcdef0123456789abcdef";
const future = () => new Date(Date.now() + 30 * 86400000);

function signedUrl(value: string, familyId = 3, expiresAt = future()) {
  return buildEmailImageUrl({ siteUrl: "http://localhost", familyId, value, expiresAt, secret: SECRET }) ?? "";
}

function mockS3(send: (command: { input: { Key: string } }) => unknown) {
  const client = new S3Client({ region: "us-east-1" });
  vi.spyOn(client, "send").mockImplementation(send as never);
  vi.mocked(getS3ClientForFamily).mockResolvedValue({ client, bucketName: "family-bucket", region: "us-east-1" });
  return client;
}

const imageObject = (contentType = "image/jpeg") => ({
  ContentType: contentType,
  ContentLength: 3,
  Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
});

describe("GET /api/email-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("streams a correctly signed image with public cache headers", async () => {
    const client = mockS3(async () => imageObject());
    const response = await GET(new Request(signedUrl("movies/poster.jpg")));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(getS3ClientForFamily).toHaveBeenCalledWith(3);
    expect(vi.mocked(client.send).mock.calls[0]?.[0].input).toMatchObject({ Bucket: "family-bucket", Key: "movies/poster.jpg" });
  });

  it("retries with the family-scoped key when the legacy key is missing", async () => {
    const client = mockS3(async (command) => {
      if (command.input.Key === "movies/poster.jpg") throw Object.assign(new Error("The specified key does not exist."), { name: "NoSuchKey" });
      return imageObject();
    });
    const response = await GET(new Request(signedUrl("movies/poster.jpg")));
    expect(response.status).toBe(200);
    expect(vi.mocked(client.send).mock.calls[1]?.[0].input).toMatchObject({ Key: "family-3/movies/poster.jpg" });
  });

  it("rejects tampered, expired, malformed, and cross-family links without touching S3", async () => {
    mockS3(async () => imageObject());
    const url = new URL(signedUrl("movies/poster.jpg"));

    const tampered = new URL(url);
    tampered.searchParams.set("k", "movies/other.jpg");
    expect((await GET(new Request(tampered))).status).toBe(403);

    const otherFamily = new URL(url);
    otherFamily.searchParams.set("f", "4");
    expect((await GET(new Request(otherFamily))).status).toBe(403);

    expect((await GET(new Request(signedUrl("movies/poster.jpg", 3, new Date(Date.now() - 1000))))).status).toBe(410);

    const unsafe = new URL(url);
    unsafe.searchParams.set("k", "../secrets.txt");
    expect((await GET(new Request(unsafe))).status).toBe(400);

    const crossFamilyKey = new URL(url);
    crossFamilyKey.searchParams.set("k", "family-9/movies/poster.jpg");
    expect((await GET(new Request(crossFamilyKey))).status).toBe(400);

    expect((await GET(new Request("http://localhost/api/email-image"))).status).toBe(400);
    expect(getS3ClientForFamily).not.toHaveBeenCalled();
  });

  it("returns 404 when signing is not configured", async () => {
    const url = signedUrl("movies/poster.jpg");
    vi.stubEnv("FS_EMAIL_IMAGE_SIGNING_SECRET", "");
    expect((await GET(new Request(url))).status).toBe(404);
  });

  it("refuses non-image and SVG objects", async () => {
    mockS3(async () => imageObject("text/html"));
    expect((await GET(new Request(signedUrl("movies/page.jpg")))).status).toBe(404);
    mockS3(async () => imageObject("image/svg+xml"));
    expect((await GET(new Request(signedUrl("movies/icon.jpg")))).status).toBe(404);
  });

  it("logs unexpected S3 failures", async () => {
    mockS3(async () => { throw new Error("boom"); });
    const response = await GET(new Request(signedUrl("movies/poster.jpg")));
    expect(response.status).toBe(500);
    expect(logApiRouteError).toHaveBeenCalledWith("api.email-image.GET.streamObject", expect.any(Error), expect.objectContaining({ familyId: 3 }));
  });
});
