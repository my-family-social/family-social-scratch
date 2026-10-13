import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestRun } from "@/components/db/sql/queries-weekly-activity-digest";
import { digestRequestSchema, getConfiguredThreshold } from "./contract";

vi.mock("@/components/db/sql/queries-weekly-activity-digest", () => ({
  findKickoff: vi.fn(), getTargetFamilyIds: vi.fn(), insertDigestRun: vi.fn(),
  markDigestRunProcessing: vi.fn(), scoreFamilyWeeklyActivity: vi.fn(),
  collectDigestRecipients: vi.fn(), collectFamilyDigestActivity: vi.fn(),
  reserveDigestDelivery: vi.fn(), finishDigestDelivery: vi.fn(), getFamilyDeliveryTotals: vi.fn(),
  persistFamilyDigestResult: vi.fn(), finishDigestRun: vi.fn(),
  getPersistedFamilyResult: vi.fn(),
}));
vi.mock("@/components/emails/send-weekly-activity-digest-email", () => ({ sendWeeklyActivityDigestEmail: vi.fn() }));
import * as repository from "@/components/db/sql/queries-weekly-activity-digest";
import { sendWeeklyActivityDigestEmail } from "@/components/emails/send-weekly-activity-digest-email";
import { InvalidFamilyScopeError, processDigestRun, queueDigestRun } from "./service";

const run: DigestRun = {
  id: 1, runId: "b36c9bfb-1d76-4c49-9fb3-74fd7fd42243", weekStartUtc: new Date("2026-10-05T00:00:00Z"),
  weekEndUtc: new Date("2026-10-11T23:59:59.999Z"), kickoffIdempotencyKey: "test",
  dryRun: true, forceReplay: false, familyIds: [1], thresholdValue: 12, operatorNotes: null,
  triggerSource: "eventbridge", status: "queued", familiesScanned: 0, familiesThresholdMet: 0,
  recipientsTotal: 0, emailsSent: 0, emailsFailed: 0, errorMessage: null,
  createdAt: new Date(), startedAt: null, finishedAt: null,
};
const score = { activityScore: 12, uniquePosters: 2, totalEvents: 5, thresholdMet: true, weightedBreakdown: [] };
const recipients = [{ memberId: 1, email: "member@example.com", displayName: "Test Member" }];
const digest = {
  familyId: 1, familyName: "Test", weekStartUtc: run.weekStartUtc.toISOString(), weekEndUtc: run.weekEndUtc.toISOString(),
  topMembers: [], byActionType: [], byFeature: [], featureDashboard: [], memberDashboard: [], highlights: [],
};

describe("durable digest orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(repository.getTargetFamilyIds).mockResolvedValue([1]);
    vi.mocked(repository.scoreFamilyWeeklyActivity).mockResolvedValue(score);
    vi.mocked(repository.collectDigestRecipients).mockResolvedValue(recipients);
    vi.mocked(repository.collectFamilyDigestActivity).mockResolvedValue(digest);
    vi.mocked(repository.getFamilyDeliveryTotals).mockResolvedValue({ attempted: 1, sent: 1, failed: 0, providerMessageIds: ["message"], errorMessage: null });
  });
  it("persists a preview without making provider calls or reservations", async () => {
    await processDigestRun(run);
    expect(repository.persistFamilyDigestResult).toHaveBeenCalledWith(expect.objectContaining({
      activityScore: 12, uniquePosters: 2, totalEvents: 5, recipientsEligible: 1, status: "sent-preview",
    }));
    expect(repository.reserveDigestDelivery).not.toHaveBeenCalled();
    expect(sendWeeklyActivityDigestEmail).not.toHaveBeenCalled();
    expect(repository.finishDigestRun).toHaveBeenCalledWith(run.runId);
  });
  it("skips families below the gate", async () => {
    vi.mocked(repository.scoreFamilyWeeklyActivity).mockResolvedValue({ ...score, activityScore: 2, thresholdMet: false });
    await processDigestRun(run);
    expect(repository.persistFamilyDigestResult).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", activityScore: 2 }));
    expect(repository.collectDigestRecipients).not.toHaveBeenCalled();
  });
  it("resumes without overwriting completed family checkpoints", async () => {
    vi.mocked(repository.getPersistedFamilyResult).mockResolvedValue({ id: 3 });
    await processDigestRun(run);
    expect(repository.scoreFamilyWeeklyActivity).not.toHaveBeenCalled();
    expect(repository.persistFamilyDigestResult).not.toHaveBeenCalled();
    expect(repository.finishDigestRun).toHaveBeenCalledWith(run.runId);
  });
  it("preserves previously sent counts after an interrupted family falls below the gate", async () => {
    vi.mocked(repository.scoreFamilyWeeklyActivity).mockResolvedValue({ ...score, thresholdMet: false });
    await processDigestRun({ ...run, dryRun: false });
    expect(repository.persistFamilyDigestResult).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", emailsSent: 1, emailsAttempted: 1 }));
  });
  it("sends and records successful provider responses", async () => {
    vi.mocked(repository.reserveDigestDelivery).mockResolvedValue({ id: 9 });
    vi.mocked(sendWeeklyActivityDigestEmail).mockResolvedValue({ status: "sent", providerMessageId: "message" });
    await processDigestRun({ ...run, dryRun: false });
    expect(repository.finishDigestDelivery).toHaveBeenCalledWith(9, { status: "sent", providerMessageId: "message" });
    expect(repository.persistFamilyDigestResult).toHaveBeenCalledWith(expect.objectContaining({ emailsAttempted: 1, emailsSent: 1, emailsFailed: 0, status: "sent" }));
  });
  it("does not send when an atomic reservation is unavailable", async () => {
    vi.mocked(repository.reserveDigestDelivery).mockResolvedValue(undefined);
    await processDigestRun({ ...run, dryRun: false, forceReplay: true });
    expect(sendWeeklyActivityDigestEmail).not.toHaveBeenCalled();
  });
  it("records partial failures and continues to other families", async () => {
    vi.mocked(repository.getFamilyDeliveryTotals).mockResolvedValue({ attempted: 2, sent: 1, failed: 1, providerMessageIds: ["message"], errorMessage: "One failure" });
    await processDigestRun({ ...run, dryRun: false, familyIds: [1, 2] });
    expect(repository.persistFamilyDigestResult).toHaveBeenCalledTimes(2);
    expect(repository.persistFamilyDigestResult).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", emailsSent: 1, emailsFailed: 1 }));
  });
  it("does not reserve when the lock connection is lost", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(processDigestRun({ ...run, dryRun: false }, () => false)).rejects.toThrow("lost its database lock");
    expect(repository.reserveDigestDelivery).not.toHaveBeenCalled();
    error.mockRestore();
  });
  it("checks duplicates before family resolution", async () => {
    vi.mocked(repository.findKickoff).mockResolvedValue({ runId: "original" });
    expect(await queueDigestRun(digestRequestSchema.parse(digestRequest()), "test")).toEqual({ queued: false, runId: "original" });
    expect(repository.getTargetFamilyIds).not.toHaveBeenCalled();
  });
  it("rejects invalid family overrides instead of silently shrinking them", async () => {
    await expect(queueDigestRun(digestRequestSchema.parse({ ...digestRequest(), familyIds: [1, 2] }), "test")).rejects.toBeInstanceOf(InvalidFamilyScopeError);
    expect(repository.insertDigestRun).not.toHaveBeenCalled();
  });
  it("resolves concurrent insert conflicts to the original run", async () => {
    vi.mocked(repository.findKickoff).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ runId: "winner" });
    vi.mocked(repository.insertDigestRun).mockResolvedValue(undefined);
    expect(await queueDigestRun(digestRequestSchema.parse(digestRequest()), "test")).toEqual({ queued: false, runId: "winner" });
  });
  it("rejects invalid configured thresholds explicitly", () => {
    vi.stubEnv("FS_DIGEST_MIN_ACTIVITY_SCORE", "invalid");
    expect(getConfiguredThreshold).toThrow("nonnegative integer");
    vi.unstubAllEnvs();
  });
});

function digestRequest() {
  return { weekStartUtc: run.weekStartUtc.toISOString(), weekEndUtc: run.weekEndUtc.toISOString() };
}
