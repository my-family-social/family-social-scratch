import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import db from "@/components/db/drizzle";
import {
  family, member, memberOption, familyActivity,
  familyActivityDigestRun as runs,
  familyActivityDigestResult as results,
  familyActivityDigestDelivery as deliveries,
} from "@/components/db/schema/family-social-schema-tables";
import { memberOptionReference } from "@/components/db/schema/global-schema-tables";
import { ACTIVITY_WEIGHTS, MIN_UNIQUE_POSTERS, type ActivityScore, type DigestActivity, type Recipient } from "@/features/weekly-activity-digest/contract";
import { digestPostRefKey, resolveDigestPostDetails } from "./queries-weekly-activity-digest-posts";

const weights = sql.join(Object.entries(ACTIVITY_WEIGHTS).map(([action, weight]) => sql`(${action}, ${weight}::integer)`), sql`, `);
const weekFilter = (start: Date, end: Date) => sql`
  ${familyActivity.createdAt} >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
  AND ${familyActivity.createdAt} <= (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
  AND ${familyActivity.status} = 'active'`;

export async function getTargetFamilyIds(input: { familyIds?: number[] }): Promise<number[]> {
  const rows = await db.select({ id: family.id }).from(family).where(and(
    inArray(family.status, ["active", "trial"]),
    input.familyIds ? inArray(family.id, input.familyIds) : undefined,
  )).orderBy(family.id);
  return rows.map((row) => row.id);
}

type ScoreRow = { family_id: number; activity_score: string | number; unique_posters: string | number; total_events: string | number };

export async function getQualifyingFamilyScores(start: Date, end: Date, threshold: number): Promise<ScoreRow[]> {
  const response = await db.execute<ScoreRow>(sql`
    WITH weights(action_type, weight) AS (VALUES ${weights})
    SELECT fa.fk_family_id AS family_id, COALESCE(SUM(w.weight), 0) AS activity_score,
      COUNT(DISTINCT fa.fk_member_id) AS unique_posters, COUNT(*) AS total_events
    FROM family_schema.family_activity fa
    JOIN weights w ON fa.action_type = w.action_type
    WHERE fa.created_at >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND fa.created_at <= (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND fa.status = 'active'
    GROUP BY fa.fk_family_id
    HAVING SUM(w.weight) >= ${threshold} AND COUNT(DISTINCT fa.fk_member_id) >= ${MIN_UNIQUE_POSTERS}`);
  return response.rows;
}

export async function scoreFamilyWeeklyActivity(familyId: number, start: Date, end: Date, threshold: number): Promise<ActivityScore> {
  const response = await db.execute<ScoreRow>(sql`
    WITH weights(action_type, weight) AS (VALUES ${weights})
    SELECT fa.fk_family_id AS family_id, COALESCE(SUM(w.weight), 0) AS activity_score,
      COUNT(DISTINCT fa.fk_member_id) AS unique_posters, COUNT(*) AS total_events
    FROM family_schema.family_activity fa
    JOIN weights w ON fa.action_type = w.action_type
    WHERE fa.fk_family_id = ${familyId}
      AND fa.created_at >= (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND fa.created_at <= (${end.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      AND fa.status = 'active'
    GROUP BY fa.fk_family_id`);
  const row = response.rows[0];
  const activityScore = Number(row?.activity_score ?? 0);
  const uniquePosters = Number(row?.unique_posters ?? 0);
  const breakdown = await db.select({ actionType: familyActivity.actionType, count: count() })
    .from(familyActivity).where(and(eq(familyActivity.familyId, familyId), weekFilter(start, end),
      inArray(familyActivity.actionType, Object.keys(ACTIVITY_WEIGHTS)))).groupBy(familyActivity.actionType);
  return {
    activityScore, uniquePosters, totalEvents: Number(row?.total_events ?? 0),
    thresholdMet: activityScore >= threshold && uniquePosters >= MIN_UNIQUE_POSTERS,
    weightedBreakdown: breakdown.map((entry) => {
      const weight = Object.entries(ACTIVITY_WEIGHTS).find(([action]) => action === entry.actionType)?.[1];
      if (weight === undefined) throw new Error(`Unweighted action: ${entry.actionType}`);
      return { ...entry, score: entry.count * weight };
    }),
  };
}

export async function collectFamilyDigestActivity(familyId: number, start: Date, end: Date): Promise<DigestActivity> {
  const filter = and(eq(familyActivity.familyId, familyId), weekFilter(start, end),
    inArray(familyActivity.actionType, Object.keys(ACTIVITY_WEIGHTS)));
  const [familyRow] = await db.select({ name: family.name }).from(family).where(eq(family.id, familyId));
  if (!familyRow) throw new Error(`Family ${familyId} no longer exists.`);
  const dashboardActions = ["POST_CREATED", "COMMENT_CREATED", "LIKE_ADDED", "LOVE_ADDED"];
  const normalizedFeatureName = sql<string>`CASE WHEN ${familyActivity.featureName} = 'Family Blog' THEN 'Blogs' ELSE ${familyActivity.featureName} END`;
  const [topMembers, byActionType, byFeature, featureDashboard, memberDashboard, highlights] = await Promise.all([
    db.select({ firstName: member.firstName, lastName: member.lastName, count: count() })
      .from(familyActivity).innerJoin(member, and(eq(familyActivity.memberId, member.id), eq(member.familyId, familyId)))
      .where(filter).groupBy(member.id, member.firstName, member.lastName).orderBy(desc(count()), asc(member.id)).limit(5),
    db.select({ name: familyActivity.actionType, count: count() }).from(familyActivity)
      .where(filter).groupBy(familyActivity.actionType).orderBy(familyActivity.actionType),
    db.select({ name: sql<string>`CASE WHEN ${familyActivity.featureName} = 'Family Blog' THEN 'Blogs' ELSE ${familyActivity.featureName} END`, count: count() })
      .from(familyActivity).where(filter).groupBy(sql`CASE WHEN ${familyActivity.featureName} = 'Family Blog' THEN 'Blogs' ELSE ${familyActivity.featureName} END`).orderBy(desc(count())),
    db.select({ featureName: normalizedFeatureName, actionType: familyActivity.actionType, count: count() })
      .from(familyActivity).where(and(filter, inArray(familyActivity.actionType, dashboardActions)))
      .groupBy(normalizedFeatureName, familyActivity.actionType).orderBy(asc(normalizedFeatureName), asc(familyActivity.actionType)),
    db.select({
      memberName: sql<string>`concat(${member.firstName}, ' ', ${member.lastName})`,
      actionType: familyActivity.actionType,
      count: count(),
    }).from(familyActivity).innerJoin(member, and(eq(familyActivity.memberId, member.id), eq(member.familyId, familyId)))
      .where(and(filter, inArray(familyActivity.actionType, dashboardActions), ne(member.status, "retired")))
      .groupBy(member.id, member.firstName, member.lastName, familyActivity.actionType)
      .orderBy(asc(member.firstName), asc(member.lastName), asc(familyActivity.actionType)),
    db.select({ firstName: member.firstName, lastName: member.lastName, memberImageUrl: member.memberImageUrl,
      memberId: familyActivity.memberId, actionType: familyActivity.actionType,
      featureName: familyActivity.featureName, postName: familyActivity.postName, postId: familyActivity.postId })
      .from(familyActivity).innerJoin(member, and(eq(familyActivity.memberId, member.id), eq(member.familyId, familyId)))
      .where(and(filter, inArray(familyActivity.actionType, ["POST_CREATED", "ALBUM_SHARED", "DISCUSS_START"])))
      .orderBy(desc(familyActivity.createdAt), desc(familyActivity.id)),
  ]);
  const postDetails = await resolveDigestPostDetails(familyId, highlights);
  return {
    familyId, familyName: familyRow.name, weekStartUtc: start.toISOString(), weekEndUtc: end.toISOString(),
    topMembers: topMembers.map((row) => ({ displayName: `${row.firstName} ${row.lastName}`, count: row.count })),
    byActionType, byFeature, featureDashboard, memberDashboard,
    highlights: highlights.map((row) => {
      const details = postDetails.get(digestPostRefKey(row));
      return {
        memberName: `${row.firstName} ${row.lastName}`,
        memberImageUrl: row.memberImageUrl,
        actionType: row.actionType,
        featureName: row.featureName,
        postName: row.postName,
        post: details ? {
          imageUrl: details.imageValue, excerpt: details.excerpt,
          likeCount: details.likeCount, loveCount: details.loveCount, commentCount: details.commentCount,
        } : null,
      };
    }),
  };
}

export async function collectDigestRecipients(familyId: number): Promise<Recipient[]> {
  const rows = await db.selectDistinct({ memberId: member.id, email: member.email, firstName: member.firstName, lastName: member.lastName })
    .from(memberOption).innerJoin(memberOptionReference, eq(memberOption.optionId, memberOptionReference.id))
    .innerJoin(member, eq(memberOption.memberId, member.id))
    .where(and(eq(member.familyId, familyId), eq(member.status, "active"), eq(memberOption.isSelected, true),
      sql`lower(${memberOptionReference.optionName}) = 'activity summary'`,
      sql`${member.email} IS NOT NULL AND ${member.email} <> ''`)).orderBy(member.id);
  return rows.flatMap((row) => {
    const email = row.email.trim();
    if (!z.email().safeParse(email).success) {
      console.warn("[weekly-activity-digest.invalid-email]", { familyId, memberId: row.memberId });
      return [];
    }
    return [{ memberId: row.memberId, email, displayName: `${row.firstName} ${row.lastName}` }];
  });
}

export type DigestRun = typeof runs.$inferSelect;
export type FamilyResult = typeof results.$inferInsert;

export async function findKickoff(weekStart: Date, key: string): Promise<{ runId: string } | undefined> {
  const [row] = await db.select({ runId: runs.runId }).from(runs)
    .where(and(eq(runs.weekStartUtc, weekStart), eq(runs.kickoffIdempotencyKey, key)));
  return row;
}

export async function insertDigestRun(values: typeof runs.$inferInsert): Promise<{ runId: string } | undefined> {
  const [row] = await db.insert(runs).values(values).onConflictDoNothing({
    target: [runs.weekStartUtc, runs.kickoffIdempotencyKey],
  }).returning({ runId: runs.runId });
  return row;
}

export async function persistFamilyDigestResult(values: FamilyResult) {
  const [row] = await db.insert(results).values(values).onConflictDoUpdate({
    target: [results.runId, results.familyId], set: values,
  }).returning({ id: results.id });
  return row.id;
}

export async function getPersistedFamilyResult(runId: string, familyId: number): Promise<{ id: number } | undefined> {
  const [row] = await db.select({ id: results.id }).from(results)
    .where(and(eq(results.runId, runId), eq(results.familyId, familyId)));
  return row;
}

export async function reserveDigestDelivery(run: DigestRun, familyId: number, recipient: Recipient): Promise<{ id: number } | undefined> {
  const [row] = await db.insert(deliveries).values({
    runId: run.runId, familyId, memberId: recipient.memberId, weekStartUtc: run.weekStartUtc,
    recipientEmail: recipient.email, status: "sending",
  }).onConflictDoUpdate({
    target: [deliveries.familyId, deliveries.weekStartUtc, deliveries.memberId],
    set: { runId: run.runId, recipientEmail: recipient.email, status: "sending", attemptsInRun: 1,
      errorMessage: null, processedAt: null },
    setWhere: sql`${run.forceReplay} AND ${deliveries.status} = 'failed' AND ${deliveries.runId} <> ${run.runId}`,
  }).returning({ id: deliveries.id });
  return row;
}

export async function finishDigestDelivery(id: number, outcome: {
  status: "sent" | "failed" | "unknown"; providerMessageId?: string; errorMessage?: string;
}) {
  await db.update(deliveries).set({ ...outcome, processedAt: new Date() }).where(eq(deliveries.id, id));
}

export async function getFamilyDeliveryTotals(run: DigestRun, familyId: number) {
  const rows = await db.select().from(deliveries)
    .where(and(eq(deliveries.familyId, familyId), eq(deliveries.weekStartUtc, run.weekStartUtc)));
  const current = rows.filter((row) => row.runId === run.runId);
  const unresolved = rows.filter((row) => row.status !== "sent");
  return {
    attempted: current.reduce((sum, row) => sum + row.attemptsInRun, 0),
    sent: current.filter((row) => row.status === "sent").length,
    failed: unresolved.length,
    providerMessageIds: current.flatMap((row) => row.providerMessageId ? [row.providerMessageId] : []),
    errorMessage: unresolved.length ? `${unresolved.length} failed or uncertain deliveries; inspect delivery audit before replay.` : null,
  };
}

export async function markDigestRunProcessing(runId: string) {
  await db.update(runs).set({ status: "processing", startedAt: sql`COALESCE(${runs.startedAt}, now())` })
    .where(eq(runs.runId, runId));
  // A previous worker could have stopped after submitting an email but before saving its response.
  await db.update(deliveries).set({ status: "unknown", errorMessage: "Worker interrupted during delivery; reconcile with provider before retry." })
    .where(and(eq(deliveries.runId, runId), eq(deliveries.status, "sending")));
}

export async function finishDigestRun(runId: string, errorMessage?: string) {
  const rows = await db.select().from(results).where(eq(results.runId, runId));
  const failed = rows.some((row) => row.status === "failed");
  await db.update(runs).set({
    status: failed || errorMessage ? "failed" : "completed", finishedAt: new Date(),
    familiesScanned: rows.length, familiesThresholdMet: rows.filter((row) => row.thresholdMet).length,
    recipientsTotal: rows.reduce((sum, row) => sum + row.recipientsEligible, 0),
    emailsSent: rows.reduce((sum, row) => sum + row.emailsSent, 0),
    emailsFailed: rows.reduce((sum, row) => sum + row.emailsFailed, 0),
    errorMessage: errorMessage ?? (failed ? "One or more families failed; inspect family results and delivery audit." : null),
  }).where(eq(runs.runId, runId));
}

export async function getNextDigestRun(input: { runId?: string; dryRunOnly?: boolean } = {}): Promise<DigestRun | undefined> {
  const [row] = await db.select().from(runs).where(and(
    inArray(runs.status, ["queued", "processing"]),
    input.runId ? eq(runs.runId, input.runId) : undefined,
    input.dryRunOnly ? eq(runs.dryRun, true) : undefined,
  ))
    .orderBy(runs.createdAt, runs.id).limit(1);
  return row;
}
