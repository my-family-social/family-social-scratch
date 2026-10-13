import { createElement } from "react";
import { Resend } from "resend";
import WeeklyActivityDigestEmail from "./templates/weekly-activity-digest-email";
import { withEmailImageUrls } from "./weekly-activity-digest-email-images";
import { familySocialEmail, familySocialHostReference } from "@/features/family/constants/family-steps";
import type { DigestActivity, Recipient } from "@/features/weekly-activity-digest/contract";

export type DeliveryOutcome = { status: "sent" | "failed" | "unknown"; providerMessageId?: string; errorMessage?: string };

export async function sendWeeklyActivityDigestEmail(recipient: Recipient, digest: DigestActivity, idempotencyKey: string): Promise<DeliveryOutcome> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.error("[weekly-activity-digest.email] RESEND_API_KEY is missing");
    return { status: "failed", errorMessage: "RESEND_API_KEY is missing." };
  }
  const siteUrl =
    process.env.AUTH_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.SITE_BASE_URL?.trim() ||
    familySocialHostReference;
  const configuredImageBaseUrl = process.env.FS_EMAIL_IMAGE_BASE_URL?.trim();
  let imageBaseUrl = siteUrl;
  if (configuredImageBaseUrl) {
    try {
      const url = new URL(configuredImageBaseUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password ||
          url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Expected an HTTP(S) origin without credentials, a path, query, or fragment.");
      }
      imageBaseUrl = url.origin;
    } catch (error) {
      console.error("[weekly-activity-digest.email] Invalid FS_EMAIL_IMAGE_BASE_URL", { error });
      return { status: "failed", errorMessage: "FS_EMAIL_IMAGE_BASE_URL must be an absolute HTTP(S) origin." };
    }
  }
  const emailDigest = withEmailImageUrls(digest, imageBaseUrl);
  try {
    const result = await new Resend(apiKey).emails.send({
      from: familySocialEmail, to: recipient.email,
      subject: `${digest.familyName}: your weekly family activity`,
      react: createElement(WeeklyActivityDigestEmail, {
        digest: emailDigest, displayName: recipient.displayName, siteUrl, imageBaseUrl,
      }),
    }, { idempotencyKey });
    if (result.error) {
      console.error("[weekly-activity-digest.email] Provider rejected delivery", { memberId: recipient.memberId, error: result.error });
      const definiteRejection = [
        "validation_error", "missing_api_key", "invalid_api_key", "restricted_api_key",
        "invalid_access", "not_found", "rate_limit_exceeded", "daily_quota_exceeded",
        "monthly_quota_exceeded", "invalid_from_address",
      ].includes(result.error.name);
      return { status: definiteRejection ? "failed" : "unknown", errorMessage: result.error.message };
    }
    if (!result.data?.id) {
      console.error("[weekly-activity-digest.email] Provider returned no message ID", { memberId: recipient.memberId });
      return { status: "unknown", errorMessage: "Provider returned no message ID; reconcile before retry." };
    }
    return { status: "sent", providerMessageId: result.data.id };
  } catch (error) {
    console.error("[weekly-activity-digest.email] Uncertain provider outcome", { memberId: recipient.memberId, error });
    return { status: "unknown", errorMessage: "Provider request failed with uncertain delivery; reconcile before retry." };
  }
}
