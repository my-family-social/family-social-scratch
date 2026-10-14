import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  family, member, familyActivity, memberOption, familyActivityDigestRun as runs,
  familyActivityDigestResult as results, familyActivityDigestDelivery as deliveries,
} from "../schema/family-social-schema-tables";
import { memberOptionReference } from "../schema/global-schema-tables";
import type { DigestRun } from "./queries-weekly-activity-digest";

const state = vi.hoisted(() => ({ db: undefined as NodePgDatabase | undefined }));
vi.mock("@/components/db/drizzle", () => ({ get default() { return state.db; } }));
const enabled = process.env.FS_DIGEST_DB_TESTS === "1";

describe.skipIf(!enabled)("weekly digest PostgreSQL integration (rolled-back fixtures)", () => {
  it("scores exact fixtures, filters recipients, preserves previews, and enforces kickoff/delivery idempotency", async () => {
    const rawUrl = process.env.FAMILY_SOCIAL_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!rawUrl) throw new Error("Database integration tests require FAMILY_SOCIAL_DATABASE_URL or DATABASE_URL.");
    const url = new URL(rawUrl.trim());
    url.searchParams.set("sslmode", "verify-full");
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    try {
      await client.query("BEGIN");
      const db = drizzle(client);
      state.db = db;
      const queries = await import("./queries-weekly-activity-digest");
      const { processDigestRun } = await import("@/features/weekly-activity-digest/service");
      const start = new Date("2026-10-05T00:00:00Z");
      const end = new Date("2026-10-11T23:59:59.999Z");
      const token = randomUUID();
      const [first, second, solo, empty, allWeights] = await db.insert(family).values(
        ["qualified", "likes", "solo", "empty", "weights"].map((suffix) => ({ name: `digest-test-${token}-${suffix}`, status: "active" })),
      ).returning();
      const [alice, bob, carol, resigned, invalid] = await db.insert(member).values([
        { familyId: first.id, firstName: "Alice", lastName: "Tester", email: "alice@example.com" },
        { familyId: first.id, firstName: "Bob", lastName: "Tester", email: "bob@example.com" },
        { familyId: second.id, firstName: "Carol", lastName: "Tester", email: "carol@example.com" },
        { familyId: first.id, firstName: "Resigned", lastName: "Tester", email: "resigned@example.com", status: "resigned" },
        { familyId: first.id, firstName: "Invalid", lastName: "Tester", email: "not-an-email" },
      ]).returning();
      const activity = (familyId: number, memberId: number | null, actionType: string, createdAt = start, status = "active") => ({
        familyId, memberId, actionType, createdAt, status, featureName: "Family Blog", postName: "A family update",
      });
      await db.insert(familyActivity).values([
        activity(first.id, alice.id, "POST_CREATED"), activity(first.id, bob.id, "POST_CREATED"),
        activity(first.id, alice.id, "COMMENT_CREATED"), activity(first.id, bob.id, "COMMENT_CREATED", end),
        activity(first.id, alice.id, "ALBUM_SHARED"),
        ...Array.from({ length: 11 }, () => activity(first.id, alice.id, "POST_CREATED")),
        activity(first.id, alice.id, "POST_CREATED", new Date(start.getTime() - 1)),
        activity(first.id, bob.id, "POST_CREATED", new Date(end.getTime() + 1)),
        activity(first.id, alice.id, "POST_CREATED", start, "deleted"),
        activity(first.id, bob.id, "GAME_STARTED"), activity(first.id, null, "INVITE_SENT"),
        activity(first.id, alice.id, "MEMBER_JOINED"),
        activity(first.id, alice.id, "MEMBER_JOINED", end),
        activity(first.id, bob.id, "MEMBER_JOINED", new Date(start.getTime() - 1)),
        activity(first.id, bob.id, "MEMBER_JOINED", new Date(end.getTime() + 1)),
        activity(first.id, bob.id, "MEMBER_JOINED", start, "deleted"),
        activity(first.id, carol.id, "MEMBER_JOINED"),
        activity(second.id, bob.id, "MEMBER_JOINED"),
        activity(first.id, null, "MEMBER_JOINED"),
        activity(second.id, carol.id, "LIKE_ADDED"), activity(second.id, carol.id, "LIKE_ADDED"),
        ...Array.from({ length: 5 }, () => activity(solo.id, alice.id, "POST_CREATED")),
        ...["POST_CREATED", "COMMENT_CREATED", "DISCUSS_START", "DISCUSS_REPLY", "THREAD_CREATED",
          "ALBUM_SHARED", "LIKE_ADDED", "LOVE_ADDED", "DISCUSS_REACT"]
          .map((action, index) => activity(allWeights.id, index % 2 === 0 ? alice.id : bob.id, action)),
      ]);
      const score = await queries.scoreFamilyWeeklyActivity(first.id, start, end, 12);
      expect(score).toEqual({
        activityScore: 45, uniquePosters: 2, totalEvents: 16, thresholdMet: true,
        weightedBreakdown: expect.arrayContaining([
          { actionType: "POST_CREATED", count: 13, score: 39 },
          { actionType: "COMMENT_CREATED", count: 2, score: 4 },
          { actionType: "ALBUM_SHARED", count: 1, score: 2 },
        ]),
      });
      expect((await queries.scoreFamilyWeeklyActivity(first.id, start, end, 46)).thresholdMet).toBe(false);
      expect(await queries.scoreFamilyWeeklyActivity(second.id, start, end, 12)).toMatchObject({ activityScore: 2, uniquePosters: 1, thresholdMet: false });
      expect(await queries.scoreFamilyWeeklyActivity(solo.id, start, end, 12)).toMatchObject({ activityScore: 15, uniquePosters: 1, thresholdMet: false });
      expect(await queries.scoreFamilyWeeklyActivity(empty.id, start, end, 12)).toMatchObject({ activityScore: 0, totalEvents: 0, uniquePosters: 0, thresholdMet: false });
      expect(await queries.scoreFamilyWeeklyActivity(allWeights.id, start, end, 12)).toMatchObject({ activityScore: 15, totalEvents: 9, uniquePosters: 2, thresholdMet: true });
      const candidates = await queries.getQualifyingFamilyScores(start, end, 12);
      expect(candidates.some((row) => row.family_id === first.id)).toBe(true);
      expect(candidates.some((row) => [second.id, solo.id, empty.id].includes(row.family_id))).toBe(false);

      const [option] = await db.insert(memberOptionReference).values({ optionName: "Activity Summary", category: "notification" }).returning();
      await db.insert(memberOption).values([
        { memberId: alice.id, optionId: option.id, isSelected: true },
        { memberId: alice.id, optionId: option.id, isSelected: true },
        { memberId: bob.id, optionId: option.id, isSelected: false },
        { memberId: carol.id, optionId: option.id, isSelected: true },
        { memberId: resigned.id, optionId: option.id, isSelected: true },
        { memberId: invalid.id, optionId: option.id, isSelected: true },
      ]);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const recipients = await queries.collectDigestRecipients(first.id);
      expect(recipients).toEqual([{ memberId: alice.id, email: "alice@example.com", displayName: "Alice Tester" }]);
      expect(warning).toHaveBeenCalled();
      warning.mockRestore();
      const content = await queries.collectFamilyDigestActivity(first.id, start, end);
      expect(content.byFeature).toEqual([{ name: "Blogs", count: 16 }]);
      expect(content.highlights).toHaveLength(14);
      expect(content.familyId).toBe(first.id);
      expect(content.newMembers).toEqual([
        { memberId: alice.id, memberName: "Alice Tester", memberImageUrl: null },
      ]);
      expect(content.highlights.every((entry) => entry.memberName.endsWith("Tester"))).toBe(true);
      // Fixture activity has no matching blog post, so cards render without post details.
      expect(content.highlights.every((entry) => entry.post === null && "memberImageUrl" in entry)).toBe(true);
      expect(content.featureDashboard).toEqual([
        { featureName: "Blogs", actionType: "COMMENT_CREATED", count: 2 },
        { featureName: "Blogs", actionType: "POST_CREATED", count: 13 },
      ]);
      expect(content.memberDashboard).toEqual([
        { memberName: "Alice Tester", actionType: "COMMENT_CREATED", count: 1 },
        { memberName: "Alice Tester", actionType: "POST_CREATED", count: 12 },
        { memberName: "Bob Tester", actionType: "COMMENT_CREATED", count: 1 },
        { memberName: "Bob Tester", actionType: "POST_CREATED", count: 1 },
      ]);

      const [preview] = await db.insert(runs).values({
        runId: randomUUID(), weekStartUtc: start, weekEndUtc: end, kickoffIdempotencyKey: token,
        dryRun: true, familyIds: [first.id, second.id], thresholdValue: 12,
      }).returning();
      expect(await queries.insertDigestRun({ ...preview, id: undefined, runId: randomUUID() })).toBeUndefined();
      expect(await queries.findKickoff(start, token)).toEqual({ runId: preview.runId });
      await processDigestRun(preview);
      const previewResults = await db.select().from(results).where(eq(results.runId, preview.runId));
      expect(previewResults.find((row) => row.familyId === first.id)).toMatchObject({
        status: "sent-preview", emailsAttempted: 0, emailsSent: 0, recipientsEligible: 1,
      });
      expect(previewResults.find((row) => row.familyId === second.id)).toMatchObject({ status: "skipped" });
      const [finished] = await db.select().from(runs).where(eq(runs.runId, preview.runId));
      expect(finished).toMatchObject({ status: "completed", familiesScanned: 2, familiesThresholdMet: 1, recipientsTotal: 1, emailsSent: 0, emailsFailed: 0 });
      expect(await db.select().from(deliveries).where(eq(deliveries.runId, preview.runId))).toHaveLength(0);

      const makeRun = async (forceReplay: boolean): Promise<DigestRun> => {
        const [row] = await db.insert(runs).values({
          runId: randomUUID(), weekStartUtc: start, weekEndUtc: end, kickoffIdempotencyKey: randomUUID(),
          dryRun: false, forceReplay, familyIds: [first.id], thresholdValue: 12,
        }).returning();
        return row;
      };
      const live = await makeRun(false);
      const reserved = await queries.reserveDigestDelivery(live, first.id, recipients[0]);
      expect(reserved).toBeDefined();
      expect(await queries.reserveDigestDelivery(live, first.id, recipients[0])).toBeUndefined();
      await queries.finishDigestDelivery(reserved!.id, { status: "sent", providerMessageId: "fixture-message" });
      const replay = await makeRun(true);
      expect(await queries.reserveDigestDelivery(replay, first.id, recipients[0])).toBeUndefined();
      expect(await queries.getFamilyDeliveryTotals(live, first.id)).toMatchObject({ attempted: 1, sent: 1, failed: 0, providerMessageIds: ["fixture-message"] });

      const bobRecipient = { memberId: bob.id, email: "bob@example.com", displayName: "Bob Tester" };
      const failedReservation = await queries.reserveDigestDelivery(live, first.id, bobRecipient);
      await queries.finishDigestDelivery(failedReservation!.id, { status: "failed", errorMessage: "Confirmed rejection" });
      const normalRerun = await makeRun(false);
      expect(await queries.reserveDigestDelivery(normalRerun, first.id, bobRecipient)).toBeUndefined();
      const retry = await queries.reserveDigestDelivery(replay, first.id, bobRecipient);
      expect(retry?.id).toBe(failedReservation?.id);
      expect(await queries.reserveDigestDelivery(replay, first.id, bobRecipient)).toBeUndefined();
      await queries.markDigestRunProcessing(replay.runId);
      const [uncertain] = await db.select().from(deliveries).where(and(eq(deliveries.familyId, first.id), eq(deliveries.memberId, bob.id)));
      expect(uncertain.status).toBe("unknown");
      const anotherReplay = await makeRun(true);
      expect(await queries.reserveDigestDelivery(anotherReplay, first.id, bobRecipient)).toBeUndefined();
      await queries.persistFamilyDigestResult({ runId: replay.runId, familyId: first.id, weekStartUtc: start,
        weekEndUtc: end, thresholdValue: 12, thresholdMet: true, status: "failed", emailsAttempted: 1, emailsFailed: 1 });
      await queries.finishDigestRun(replay.runId);
      const [failedRun] = await db.select().from(runs).where(eq(runs.runId, replay.runId));
      expect(failedRun).toMatchObject({ status: "failed", familiesScanned: 1, emailsFailed: 1 });
      expect((await db.execute(sql`SELECT COUNT(*)::integer AS count FROM family_schema.family_activity_digest_delivery WHERE fk_family_id = ${first.id}`)).rows[0]).toMatchObject({ count: 2 });
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  }, 60000);
});
