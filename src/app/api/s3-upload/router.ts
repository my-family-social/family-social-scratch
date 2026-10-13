import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { logApiRouteError } from "@/components/api/api-error-logger";
import { getMemberPageDetails } from "@/features/family/services/family-services";
import { getS3ClientForFamily } from "@/lib/s3-client-factory";
import { extractS3KeyFromValue } from "@/lib/s3-object-key";
import { ALLOWED_S3_FOLDERS as ALLOWED_FOLDERS, isSafeObjectKey, toFamilyScopedKey } from "@/lib/s3-safe-object-key";

const ALLOWED_ACTIONS = new Set(["upload", "download"]);
const SAFE_FILE_NAME_REGEX = /^[A-Za-z0-9._-]+$/;
const IS_DEV = process.env.NODE_ENV !== "production";

type ResolvedS3Context = {
  client: S3Client;
  bucketName: string;
  region: string;
};

function isSafeFileName(fileName: string) {
  return SAFE_FILE_NAME_REGEX.test(fileName) && !fileName.includes("..") && !fileName.includes("/") && !fileName.includes("\\");
}

function buildPublicObjectUrl(key: string, bucket: string, region: string) {
  if (!bucket || !region) {
    return null;
  }

  if (region === "us-east-1") {
    return `https://${bucket}.s3.amazonaws.com/${key}`;
  }

  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

function buildS3Uri(key: string, bucket: string) {
  if (!bucket || !key) {
    return null;
  }

  return `s3://${bucket}/${key}`;
}

function getEnvFallbackS3Context(): ResolvedS3Context | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucketName = process.env.AWS_S3_BUCKET_NAME;
  const region = process.env.AWS_REGION ?? "us-east-2";

  if (!accessKeyId || !secretAccessKey || !bucketName) {
    return null;
  }

  return {
    client: new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    }),
    bucketName,
    region,
  };
}

async function resolveDownloadContext(
  requestId: string,
  baseContext: ResolvedS3Context,
  objectKey: string
): Promise<ResolvedS3Context> {
  if (!IS_DEV) {
    return baseContext;
  }

  const envFallbackContext = getEnvFallbackS3Context();
  const contexts: ResolvedS3Context[] = [baseContext];

  if (envFallbackContext) {
    contexts.push(envFallbackContext);
  }

  let resolved = baseContext;

  for (const candidate of contexts) {
    try {
      await candidate.client.send(
        new HeadObjectCommand({
          Bucket: candidate.bucketName,
          Key: objectKey,
        })
      );

      resolved = candidate;
      break;
    } catch {
      // Continue trying alternate context in development rollout.
    }
  }

  // console.info("[api/s3-upload] download context selected", {
  //   requestId,
  //   objectKey,
  //   bucketName: resolved.bucketName,
  //   region: resolved.region,
  // });

  return resolved;
}

export async function GET(request: Request) {
  const memberDetails = await getMemberPageDetails();
  const requestId = crypto.randomUUID();

  if (!memberDetails.isLoggedIn || !memberDetails.familyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const keyParam = searchParams.get("key");
  const normalizedObjectKey = extractS3KeyFromValue(keyParam);

  if (!normalizedObjectKey || !isSafeObjectKey(normalizedObjectKey)) {
    return NextResponse.json({ error: "Invalid object key" }, { status: 400 });
  }

  let objectKey = normalizedObjectKey;

  try {
    const s3Context = await getS3ClientForFamily(memberDetails.familyId);
    let downloadContext = await resolveDownloadContext(requestId, s3Context, objectKey);

    let response;
    try {
      response = await downloadContext.client.send(
        new GetObjectCommand({
          Bucket: downloadContext.bucketName,
          Key: objectKey,
        })
      );
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : "";
      const isKeyNotFound = primaryMessage.toLowerCase().includes("specified key does not exist");
      const familyScopedObjectKey = toFamilyScopedKey(objectKey, memberDetails.familyId);
      const shouldRetryFamilyScoped = isKeyNotFound && familyScopedObjectKey !== objectKey;

      if (shouldRetryFamilyScoped) {
        objectKey = familyScopedObjectKey;
        downloadContext = await resolveDownloadContext(requestId, s3Context, objectKey);
        response = await downloadContext.client.send(
          new GetObjectCommand({
            Bucket: downloadContext.bucketName,
            Key: objectKey,
          })
        );
      } else {
      const envFallbackContext = IS_DEV ? getEnvFallbackS3Context() : null;
      const canRetryWithEnv =
        Boolean(envFallbackContext) &&
        primaryMessage.toLowerCase().includes("access key id you provided does not exist");

      if (!canRetryWithEnv || !envFallbackContext) {
        throw primaryError;
      }

      if (IS_DEV) {
        console.warn("[api/s3-upload] retrying download with env fallback credentials", {
          requestId,
          objectKey,
          primaryErrorMessage: primaryMessage,
          fallbackBucketName: envFallbackContext.bucketName,
          fallbackRegion: envFallbackContext.region,
        });
      }

      response = await envFallbackContext.client.send(
        new GetObjectCommand({
          Bucket: envFallbackContext.bucketName,
          Key: objectKey,
        })
      );
      }
    }

    const bodyBytes = await response.Body?.transformToByteArray();

    if (!bodyBytes) {
      return NextResponse.json({ error: "Object not found" }, { status: 404 });
    }

    const safeBytes = Uint8Array.from(bodyBytes);
    const blob = new Blob([safeBytes], {
      type: response.ContentType ?? "application/octet-stream",
    });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": response.ContentType ?? "application/octet-stream",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (error) {
    logApiRouteError("api.s3-upload.GET.streamObject", error, {
      requestId,
      familyId: memberDetails.familyId,
      objectKey,
      route: "s3-upload",
    });
    return NextResponse.json({ error: "Failed to load image" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const memberDetails = await getMemberPageDetails();
  const requestId = crypto.randomUUID();

  if (!memberDetails.isLoggedIn || !memberDetails.familyId) {
    console.warn("[api/s3-upload] unauthorized request", {
      requestId,
      isLoggedIn: memberDetails.isLoggedIn,
      familyId: memberDetails.familyId,
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileName, contentType, action, folder, uploadTransport } = await request.json();

  // if (IS_DEV) {
  //   console.info("[api/s3-upload] request", {
  //     requestId,
  //     action,
  //     fileName,
  //     folder,
  //     familyId: memberDetails.familyId,
  //   });
  // }

  if (!ALLOWED_ACTIONS.has(action)) {
    console.warn("[api/s3-upload] invalid action", { requestId, action });
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (action === "upload") {
    if (!folder || !ALLOWED_FOLDERS.has(folder)) {
      console.warn("[api/s3-upload] invalid upload folder", { requestId, folder });
      return NextResponse.json({ error: "Invalid upload folder" }, { status: 400 });
    }

    if (!fileName || !isSafeFileName(fileName)) {
      console.warn("[api/s3-upload] invalid upload file name", { requestId, fileName });
      return NextResponse.json({ error: "Invalid upload file name" }, { status: 400 });
    }

    if (!contentType || typeof contentType !== "string") {
      console.warn("[api/s3-upload] missing content type", { requestId, contentType });
      return NextResponse.json({ error: "Missing content type" }, { status: 400 });
    }

    if (!["image/png", "image/jpeg", "image/jpg"].includes(contentType)) {
      console.warn("[api/s3-upload] invalid content type", { requestId, contentType });
      return NextResponse.json({ error: "Invalid content type for upload" }, { status: 400 });
    }
  }

  const normalizedDownloadKey = action === "download" ? extractS3KeyFromValue(fileName) : null;

  if (action === "download") {
    if (!normalizedDownloadKey || !isSafeObjectKey(normalizedDownloadKey)) {
      console.warn("[api/s3-upload] invalid download object key", {
        requestId,
        fileName,
        normalizedDownloadKey,
      });
      return NextResponse.json({ error: "Invalid object key for download" }, { status: 400 });
    }
  }

  const objectKey =
    action === "upload"
      ? folder === "galleries"
        ? toFamilyScopedKey(`galleries/member-${memberDetails.memberId}/${fileName}`, memberDetails.familyId)
        : toFamilyScopedKey(`${folder}/${fileName}`, memberDetails.familyId)
      : normalizedDownloadKey!;

  try {
    const s3Context = await getS3ClientForFamily(memberDetails.familyId);

    if (action === "upload") {
      const command = new PutObjectCommand({
        Bucket: s3Context.bucketName,
        Key: objectKey,
        ContentType: contentType,
      });

      const url = uploadTransport === "proxy"
        ? `/api/s3-upload?key=${ encodeURIComponent(objectKey) }`
        : await getSignedUrl(s3Context.client, command, { expiresIn: 60 });

      // if (IS_DEV) {
      //   console.info("[api/s3-upload] signed upload URL created", {
      //     requestId,
      //     objectKey,
      //     bucketName: s3Context.bucketName,
      //     region: s3Context.region,
      //   });
      // }

      return NextResponse.json({
        url,
        s3Key: objectKey,
        s3Uri: buildS3Uri(objectKey, s3Context.bucketName),
        fileUrl: buildPublicObjectUrl(objectKey, s3Context.bucketName, s3Context.region),
        signedContentType: contentType,
      });
    }

    await resolveDownloadContext(requestId, s3Context, objectKey);
    const url = `/api/s3-upload?key=${encodeURIComponent(objectKey)}`;

    // if (IS_DEV) {
    //   console.info("[api/s3-upload] proxied download URL created", {
    //     requestId,
    //     objectKey,
    //     bucketName: downloadContext.bucketName,
    //     region: downloadContext.region,
    //     proxyUrl: url,
    //   });
    // }

    return NextResponse.json({ url, s3Key: objectKey });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logApiRouteError("api.s3-upload.POST.generateUrl", error, {
      requestId,
      action,
      familyId: memberDetails.familyId,
      fileName,
      folder,
      errorMessage,
      route: "s3-upload",
    });
    return NextResponse.json({ error: `Failed to generate URL: ${errorMessage}` }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const memberDetails = await getMemberPageDetails();
  const requestId = crypto.randomUUID();

  if (!memberDetails.isLoggedIn || !memberDetails.familyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const keyParam = searchParams.get("key");
  const normalizedObjectKey = extractS3KeyFromValue(keyParam);

  if (!normalizedObjectKey || !isSafeObjectKey(normalizedObjectKey)) {
    return NextResponse.json({ error: "Invalid object key" }, { status: 400 });
  }

  const contentType = request.headers.get("content-type") ?? "application/octet-stream";

  if (!["image/png", "image/jpeg", "image/jpg"].includes(contentType)) {
    return NextResponse.json({ error: "Invalid content type for upload" }, { status: 400 });
  }

  try {
    const s3Context = await getS3ClientForFamily(memberDetails.familyId);
    const body = Buffer.from(await request.arrayBuffer());

    await s3Context.client.send(
      new PutObjectCommand({
        Bucket: s3Context.bucketName,
        Key: normalizedObjectKey,
        ContentType: contentType,
        Body: body,
      })
    );

    return NextResponse.json({
      success: true,
      s3Key: normalizedObjectKey,
      s3Uri: buildS3Uri(normalizedObjectKey, s3Context.bucketName),
      fileUrl: buildPublicObjectUrl(normalizedObjectKey, s3Context.bucketName, s3Context.region),
    });
  } catch (error) {
    logApiRouteError("api.s3-upload.PUT.proxyUpload", error, {
      requestId,
      familyId: memberDetails.familyId,
      objectKey: normalizedObjectKey,
      route: "s3-upload",
    });

    return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
  }
}