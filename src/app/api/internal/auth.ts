import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export function authenticateInternalRequest(headers: Headers, now = Date.now()): boolean {
  const configured = process.env.FS_INTERNAL_API_SECRET;
  if (!configured) throw new Error("FS_INTERNAL_API_SECRET is not configured.");
  const supplied = headers.get("x-fs-internal-secret") ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(configured), hash(supplied))) return false;
  const timestamp = headers.get("x-fs-request-ts");
  if (!z.iso.datetime({ offset: false }).safeParse(timestamp).success) return false;
  return Math.abs(now - Date.parse(timestamp!)) <= 5 * 60 * 1000;
}
