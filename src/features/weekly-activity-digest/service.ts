import { randomUUID } from "node:crypto";
import * as repository from "@/components/db/sql/queries-weekly-activity-digest";
import { sendWeeklyActivityDigestEmail } from "@/components/emails/send-weekly-activity-digest-email";
import { getConfiguredThreshold, type DigestRequest, type Recipient, type DigestActivity } from "./contract";

export class InvalidFamilyScopeError extends Error {}

export async function queueDigestRun(input: DigestRequest, key: string) {
  const weekStartUtc = new Date(input.weekStartUtc);
  const existing = await repository.findKickoff(weekStartUtc, key);
  if (existing) return { queued: false as const, runId: existing.runId };
  const familyIds = await repository.getTargetFamilyIds(input);
  if (input.familyIds && familyIds.length !== input.familyIds.length) {
    throw new InvalidFamilyScopeError("All requested families must exist and have active or trial status.");
  }
  const runId = randomUUID();
  const inserted = await repository.insertDigestRun({
    runId, weekStartUtc, weekEndUtc: new Date(input.weekEndUtc), kickoffIdempotencyKey: key,
    dryRun: input.dryRun, forceReplay: input.forceReplay, familyIds,
    thresholdValue: input.minActivityScoreOverride ?? getConfiguredThreshold(),
    operatorNotes: input.operatorNotes,
  });
  if (!inserted) {
    const duplicate = await repository.findKickoff(weekStartUtc, key);
    if (!duplicate) throw new Error("Kickoff conflict did not resolve to a persisted run.");
    return { queued: false as const, runId: duplicate.runId };
  }
  return { queued: true as const, runId, familyCount: familyIds.length };
}

export async function sendFamilyDigestEmails(run: repository.DigestRun, familyId: number, recipients: Recipient[], digest: DigestActivity, canContinue: () => boolean = () => true) {
  for (const recipient of recipients) {
    if (!canContinue()) throw new Error("Digest worker lost its database lock.");
    const reservation = await repository.reserveDigestDelivery(run, familyId, recipient);
    if (!reservation) continue;
    const outcome = await sendWeeklyActivityDigestEmail(recipient, digest,
      `weekly-digest-${familyId}-${run.weekStartUtc.toISOString().slice(0, 10)}-${recipient.memberId}-${run.runId}`);
    await repository.finishDigestDelivery(reservation.id, outcome);
  }
  return repository.getFamilyDeliveryTotals(run, familyId);
}

export async function processDigestRun(run: repository.DigestRun, canContinue: () => boolean = () => true) {
  await repository.markDigestRunProcessing(run.runId);
  try {
    for (const familyId of run.familyIds) {
      if (!canContinue()) throw new Error("Digest worker lost its database lock.");
      if (await repository.getPersistedFamilyResult(run.runId, familyId)) continue;
      const values: repository.FamilyResult = {
        runId: run.runId, familyId, weekStartUtc: run.weekStartUtc, weekEndUtc: run.weekEndUtc,
        thresholdValue: run.thresholdValue, status: "skipped",
      };
      try {
        if (!run.dryRun) {
          const prior = await repository.getFamilyDeliveryTotals(run, familyId);
          if (prior.attempted > 0) {
            Object.assign(values, { emailsAttempted: prior.attempted, emailsSent: prior.sent, emailsFailed: prior.failed,
              errorMessage: prior.errorMessage, status: prior.failed > 0 ? "failed" : prior.sent > 0 ? "sent" : "skipped" });
          }
        }
        const eligible = await repository.getTargetFamilyIds({ familyIds: [familyId] });
        if (eligible.length === 0) {
          await repository.persistFamilyDigestResult({ ...values, errorMessage: "Family is no longer eligible.", processedAt: new Date() });
          continue;
        }
        const score = await repository.scoreFamilyWeeklyActivity(familyId, run.weekStartUtc, run.weekEndUtc, run.thresholdValue);
        Object.assign(values, {
          activityScore: score.activityScore, uniquePosters: score.uniquePosters,
          totalEvents: score.totalEvents, thresholdMet: score.thresholdMet,
        });
        if (score.thresholdMet) {
          const recipients = await repository.collectDigestRecipients(familyId);
          values.recipientsEligible = recipients.length;
          if (recipients.length > 0) {
            const digest = await repository.collectFamilyDigestActivity(familyId, run.weekStartUtc, run.weekEndUtc);
            if (run.dryRun) {
              values.status = "sent-preview";
            } else {
              if (!canContinue()) throw new Error("Digest worker lost its database lock.");
              const delivery = await sendFamilyDigestEmails(run, familyId, recipients, digest, canContinue);
              Object.assign(values, { emailsAttempted: delivery.attempted, emailsSent: delivery.sent,
                emailsFailed: delivery.failed, errorMessage: delivery.errorMessage,
                status: delivery.failed > 0 ? "failed" : delivery.sent > 0 ? "sent" : "skipped" });
            }
          }
        }
      } catch (error) {
        console.error("[weekly-activity-digest.family]", { runId: run.runId, familyId, error });
        values.status = "failed";
        values.errorMessage = error instanceof Error ? error.message : "Unexpected family processing failure.";
        if (!run.dryRun) {
          const delivery = await repository.getFamilyDeliveryTotals(run, familyId);
          Object.assign(values, { emailsAttempted: delivery.attempted, emailsSent: delivery.sent, emailsFailed: delivery.failed });
        }
      }
      await repository.persistFamilyDigestResult({ ...values, processedAt: new Date() });
    }
    await repository.finishDigestRun(run.runId);
  } catch (error) {
    console.error("[weekly-activity-digest.run]", { runId: run.runId, error });
    await repository.finishDigestRun(run.runId, error instanceof Error ? error.message : "Unexpected run processing failure.");
    throw error;
  }
}
