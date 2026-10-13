import { GetObjectCommand } from "@aws-sdk/client-s3";
import { logApiRouteError } from "@/components/api/api-error-logger";
import {
  EMAIL_IMAGE_MAX_TTL_SECONDS,
  getEmailImageSigningSecret,
  verifyEmailImageSignature,
} from "@/lib/email-image-signing";
import { getS3ClientForFamily } from "@/lib/s3-client-factory";
import { isKeyInFamilyScope, isSafeObjectKey, toFamilyScopedKey } from "@/lib/s3-safe-object-key";

const POSITIVE_INT_REGEX = /^[1-9]\d{0,15}$/;
const SIGNATURE_REGEX = /^[A-Za-z0-9_-]{43}$/;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CACHE_SECONDS = 7 * 86400;

function errorResponse(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function isKeyNotFound(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "NoSuchKey" || error.message.toLowerCase().includes("specified key does not exist");
}

export async function GET(request: Request): Promise<Response> {
  const secret = getEmailImageSigningSecret();
  if (!secret) {
    return errorResponse(404, "Not found");
  }

  const { searchParams } = new URL(request.url);
  const familyParam = searchParams.get("f") ?? "";
  const key = searchParams.get("k") ?? "";
  const expiresParam = searchParams.get("e") ?? "";
  const signature = searchParams.get("s") ?? "";

  if (!POSITIVE_INT_REGEX.test(familyParam) || !POSITIVE_INT_REGEX.test(expiresParam) || !SIGNATURE_REGEX.test(signature)) {
    return errorResponse(400, "Invalid image link");
  }

  const familyId = Number(familyParam);
  const expiresAtSeconds = Number(expiresParam);
  if (familyId > 2147483647 || !isSafeObjectKey(key) || !isKeyInFamilyScope(key, familyId)) {
    return errorResponse(400, "Invalid image link");
  }

  if (!verifyEmailImageSignature({ familyId, key, expiresAtSeconds, signature }, secret)) {
    return errorResponse(403, "Invalid image link");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAtSeconds <= nowSeconds) {
    return errorResponse(410, "Image link expired");
  }
  if (expiresAtSeconds - nowSeconds > EMAIL_IMAGE_MAX_TTL_SECONDS) {
    return errorResponse(400, "Invalid image link");
  }

  let objectKey = key;
  try {
    const { client, bucketName } = await getS3ClientForFamily(familyId);
    const getObject = (Key: string) => client.send(new GetObjectCommand({ Bucket: bucketName, Key }));

    let response;
    try {
      response = await getObject(objectKey);
    } catch (error) {
      const scopedKey = toFamilyScopedKey(objectKey, familyId);
      if (!isKeyNotFound(error) || scopedKey === objectKey) throw error;
      objectKey = scopedKey;
      response = await getObject(objectKey);
    }

    const contentType = response.ContentType?.toLowerCase() ?? "";
    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      return errorResponse(404, "Not found");
    }
    if ((response.ContentLength ?? 0) > MAX_IMAGE_BYTES) {
      return errorResponse(404, "Not found");
    }

    const bodyBytes = await response.Body?.transformToByteArray();
    if (!bodyBytes || bodyBytes.byteLength > MAX_IMAGE_BYTES) {
      return errorResponse(404, "Not found");
    }

    return new Response(new Blob([Uint8Array.from(bodyBytes)], { type: contentType }), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${CACHE_SECONDS}, immutable`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if (isKeyNotFound(error)) {
      return errorResponse(404, "Not found");
    }
    logApiRouteError("api.email-image.GET.streamObject", error, { familyId, objectKey, route: "email-image" });
    return errorResponse(500, "Failed to load image");
  }
}
