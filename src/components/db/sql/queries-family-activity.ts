import { count, eq, and, inArray, gte, lte, sql, ne } from "drizzle-orm";
import db from "@/components/db/drizzle";
import { familyActivity, member } from "@/components/db/schema/family-social-schema-tables";

const FEATURE_POST_NAMES = [
  "TV Room",
  "Movie Theater",
  "The Kitchen",
  "Poetry Nook",
  "Reading Room",
  "Family Gallery",
  "Blogs",
] as const;

const FEATURE_POST_FILTER_NAMES = [...FEATURE_POST_NAMES, "Family Blog"] as const;

const POST_ACTION_TYPES = [
  "POST_CREATED",
  "COMMENT_CREATED",
  "LIKE_ADDED",
  "LOVE_ADDED",
  "DISCUSS_START",
  "DISCUSS_REPLY",
  "DISCUSS_REACT",
] as const;

const FAMILY_WIDE_ACTION_TYPES = [
  "THREAD_CREATED",
  "GAME_STARTED",
  "INVITE_SENT",
  "MEMBER_JOINED",
] as const;

const MEMBER_DASHBOARD_ACTION_TYPES = [
  "POST_CREATED",
  "ALBUM_SHARED",
  "COMMENT_CREATED",
  "LIKE_ADDED",
  "LOVE_ADDED",
] as const;

export type FeaturePostsRawRow = {
  featureName: string;
  actionType: string;
  count: number;
};

export type MemberPostsRawRow = {
  firstName: string;
  lastName: string;
  actionType: string;
  count: number;
};

export type ThreadGameRawRow = {
  firstName: string;
  lastName: string;
  actionType: string;
  count: number;
};

type MemberDashboardActivityRow = {
  actionType: string;
  featureName: string;
  postName: string;
  memberId: number;
};

export type MemberDashboardActivitySummary = {
  memberToOthers: {
    posts: number;
    comments: number;
    likes: number;
    loves: number;
  };
  othersToMember: {
    posts: number;
    comments: number;
    likes: number;
    loves: number;
  };
};

type DateRangeFilter = {
  startDate: Date;
  endDate: Date;
};

export async function getFeaturePostsActivity(
  familyId: number,
  dateRange: DateRangeFilter,
): Promise<FeaturePostsRawRow[]> {
  const normalizedFeatureName = sql<string>`CASE WHEN ${familyActivity.featureName} = 'Family Blog' THEN 'Blogs' ELSE ${familyActivity.featureName} END`;

  const rows = await db
    .select({
      featureName: normalizedFeatureName,
      actionType: familyActivity.actionType,
      count: count(),
    })
    .from(familyActivity)
    .where(
      and(
        eq(familyActivity.familyId, familyId),
        inArray(familyActivity.featureName, [...FEATURE_POST_FILTER_NAMES]),
        inArray(familyActivity.actionType, [...POST_ACTION_TYPES]),
        gte(familyActivity.createdAt, dateRange.startDate),
        lte(familyActivity.createdAt, dateRange.endDate),
      ),
    )
    .groupBy(normalizedFeatureName, familyActivity.actionType);

  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

export async function getMemberPostsActivity(
  familyId: number,
  dateRange: DateRangeFilter,
): Promise<MemberPostsRawRow[]> {
  const rows = await db
    .select({
      firstName: member.firstName,
      lastName: member.lastName,
      actionType: familyActivity.actionType,
      count: count(),
    })
    .from(familyActivity)
    .innerJoin(member, eq(familyActivity.memberId, member.id))
    .where(
      and(
        eq(familyActivity.familyId, familyId),
        inArray(familyActivity.featureName, [...FEATURE_POST_FILTER_NAMES]),
        inArray(familyActivity.actionType, [...POST_ACTION_TYPES]),
        gte(familyActivity.createdAt, dateRange.startDate),
        lte(familyActivity.createdAt, dateRange.endDate),
        ne(member.status, 'retired'),
      ),
    )
    .groupBy(member.id, member.firstName, member.lastName, familyActivity.actionType);

  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

export async function getThreadAndGameActivity(familyId: number): Promise<ThreadGameRawRow[]> {
  const rows = await db
    .select({
      firstName: member.firstName,
      lastName: member.lastName,
      actionType: familyActivity.actionType,
      count: count(),
    })
    .from(familyActivity)
    .innerJoin(member, eq(familyActivity.memberId, member.id))
    .where(
      and(
        eq(familyActivity.familyId, familyId),
        inArray(familyActivity.actionType, [...FAMILY_WIDE_ACTION_TYPES]),
      ),
    )
    .groupBy(member.id, member.firstName, member.lastName, familyActivity.actionType);

  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

export async function getThreadAndGameActivityFamilySummary(
  familyId: number,
  dateRange: DateRangeFilter,
): Promise<{ actionType: string; count: number }[]> {
  const rows = await db
    .select({
      actionType: familyActivity.actionType,
      count: count(),
    })
    .from(familyActivity)
    .where(
      and(
        eq(familyActivity.familyId, familyId),
        inArray(familyActivity.actionType, [...FAMILY_WIDE_ACTION_TYPES]),
        gte(familyActivity.createdAt, dateRange.startDate),
        lte(familyActivity.createdAt, dateRange.endDate),
      ),
    )
    .groupBy(familyActivity.actionType);

  return rows.map((r) => ({ ...r, count: Number(r.count) }));
}

function buildPostKey(row: { featureName: string; postName: string }): string {
  return `${ row.featureName }::${ row.postName }`;
}

function isPostAction(actionType: string): boolean {
  return actionType === "POST_CREATED" || actionType === "ALBUM_SHARED";
}

function isLikeAction(actionType: string): boolean {
  return actionType === "LIKE_ADDED";
}

function isLoveAction(actionType: string): boolean {
  return actionType === "LOVE_ADDED";
}

export async function getMemberDashboardActivitySummary(
  familyId: number,
  memberId: number,
  dateRange: DateRangeFilter,
): Promise<MemberDashboardActivitySummary> {
  const rows = await db
    .select({
      actionType: familyActivity.actionType,
      featureName: familyActivity.featureName,
      postName: familyActivity.postName,
      memberId: familyActivity.memberId,
    })
    .from(familyActivity)
    .where(
      and(
        eq(familyActivity.familyId, familyId),
        inArray(familyActivity.featureName, [...FEATURE_POST_FILTER_NAMES]),
        inArray(familyActivity.actionType, [...MEMBER_DASHBOARD_ACTION_TYPES]),
        gte(familyActivity.createdAt, dateRange.startDate),
        lte(familyActivity.createdAt, dateRange.endDate),
      ),
    );

  const typedRows: MemberDashboardActivityRow[] = rows.filter(
    (row): row is MemberDashboardActivityRow => row.memberId !== null,
  );

  const memberPostKeys = new Set(
    typedRows
      .filter((row) => row.memberId === memberId && isPostAction(row.actionType))
      .map((row) => buildPostKey(row)),
  );

  const otherMemberPostKeys = new Set(
    typedRows
      .filter((row) => row.memberId !== memberId && isPostAction(row.actionType))
      .map((row) => buildPostKey(row)),
  );

  const memberToOthers = {
    posts: typedRows.filter((row) => row.memberId === memberId && isPostAction(row.actionType)).length,
    comments: typedRows.filter(
      (row) =>
        row.memberId === memberId
        && row.actionType === "COMMENT_CREATED"
        && otherMemberPostKeys.has(buildPostKey(row)),
    ).length,
    likes: typedRows.filter(
      (row) =>
        row.memberId === memberId
        && isLikeAction(row.actionType)
        && otherMemberPostKeys.has(buildPostKey(row)),
    ).length,
    loves: typedRows.filter(
      (row) =>
        row.memberId === memberId
        && isLoveAction(row.actionType)
        && otherMemberPostKeys.has(buildPostKey(row)),
    ).length,
  };

  const othersToMember = {
    posts: typedRows.filter(
      (row) =>
        row.memberId !== memberId
        && isPostAction(row.actionType)
        && memberPostKeys.has(buildPostKey(row)),
    ).length,
    comments: typedRows.filter(
      (row) =>
        row.memberId !== memberId
        && row.actionType === "COMMENT_CREATED"
        && memberPostKeys.has(buildPostKey(row)),
    ).length,
    likes: typedRows.filter(
      (row) =>
        row.memberId !== memberId
        && isLikeAction(row.actionType)
        && memberPostKeys.has(buildPostKey(row)),
    ).length,
    loves: typedRows.filter(
      (row) =>
        row.memberId !== memberId
        && isLoveAction(row.actionType)
        && memberPostKeys.has(buildPostKey(row)),
    ).length,
  };

  return { memberToOthers, othersToMember };
}

export const FAMILY_ACTIVITY_ACTION_TYPES = {
  POST_CREATED: "POST_CREATED",
  COMMENT_CREATED: "COMMENT_CREATED",
  ALBUM_SHARED: "ALBUM_SHARED",
  DISCUSS_START: "DISCUSS_START",
  DISCUSS_REPLY: "DISCUSS_REPLY",
  DISCUSS_REACT: "DISCUSS_REACT",
  THREAD_CREATED: "THREAD_CREATED",
  GAME_STARTED: "GAME_STARTED",
  LIKE_ADDED: "LIKE_ADDED",
  LOVE_ADDED: "LOVE_ADDED",
  INVITE_SENT: "INVITE_SENT",
  MEMBER_JOINED: "MEMBER_JOINED",
} as const;

export type FamilyActivityActionType =
  (typeof FAMILY_ACTIVITY_ACTION_TYPES)[keyof typeof FAMILY_ACTIVITY_ACTION_TYPES];

export type FamilyActivityReactionType = "like" | "love";

type CreateFamilyActivityInput = {
  actionType: FamilyActivityActionType;
  featureName: string;
  postName: string;
  postId?: number | null;
  familyId: number;
  memberId: number;
};

export async function createFamilyActivityRecord(input: CreateFamilyActivityInput): Promise<void> {
  await db.insert(familyActivity).values({
    actionType: input.actionType,
    featureName: input.featureName,
    postName: input.postName,
    postId: input.postId ?? null,
    familyId: input.familyId,
    memberId: input.memberId,
  });
}

export async function createFamilyReactionActivityRecord(input: {
  reactionType: FamilyActivityReactionType;
  featureName: string;
  postName: string;
  familyId: number;
  memberId: number;
}): Promise<void> {
  await createFamilyActivityRecord({
    actionType: input.reactionType === "love"
      ? FAMILY_ACTIVITY_ACTION_TYPES.LOVE_ADDED
      : FAMILY_ACTIVITY_ACTION_TYPES.LIKE_ADDED,
    featureName: input.featureName,
    postName: input.postName,
    familyId: input.familyId,
    memberId: input.memberId,
  });
}
