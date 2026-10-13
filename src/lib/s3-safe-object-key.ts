export const ALLOWED_S3_FOLDERS = new Set(["members", "movies", "tv", "music", "foodies", "threads", "galleries", "blogs"]);

const SAFE_FILE_NAME_REGEX = /^[A-Za-z0-9._-]+$/;
const FAMILY_PREFIX_REGEX = /^family-\d+$/i;
const MEMBER_PREFIX_REGEX = /^member-\d+$/i;

function isSafeFileName(fileName: string) {
  return SAFE_FILE_NAME_REGEX.test(fileName) && !fileName.includes("..") && !fileName.includes("/") && !fileName.includes("\\");
}

export function isSafeObjectKey(key: string) {
  const segments = key.split("/").filter(Boolean);

  let folder: string | undefined;
  let fileName: string | undefined;

  if (segments.length === 2) {
    // folder/filename
    [folder, fileName] = segments;
  } else if (segments.length === 3 && FAMILY_PREFIX_REGEX.test(segments[0] ?? "")) {
    // family-##/folder/filename
    [, folder, fileName] = segments;
  } else if (
    segments.length === 4 &&
    FAMILY_PREFIX_REGEX.test(segments[0] ?? "") &&
    segments[1] === "galleries" &&
    MEMBER_PREFIX_REGEX.test(segments[2] ?? "")
  ) {
    // family-##/galleries/member-##/filename
    folder = "galleries";
    fileName = segments[3];
  } else {
    return false;
  }

  if (!folder || !fileName || !ALLOWED_S3_FOLDERS.has(folder)) {
    return false;
  }

  return isSafeFileName(fileName);
}

export function getFamilyScopedPrefix(familyId: number) {
  return `family-${familyId}`;
}

export function toFamilyScopedKey(objectKey: string, familyId: number) {
  const prefix = getFamilyScopedPrefix(familyId);
  if (objectKey.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) {
    return objectKey;
  }

  return `${prefix}/${objectKey}`;
}

/** Returns true when a key is unscoped or scoped to the given family. */
export function isKeyInFamilyScope(objectKey: string, familyId: number) {
  const [first] = objectKey.split("/");
  if (!first || !FAMILY_PREFIX_REGEX.test(first)) {
    return true;
  }
  return first.toLowerCase() === getFamilyScopedPrefix(familyId);
}
