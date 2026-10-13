import db from "@/components/db/drizzle";
import { and, asc, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";

import {
  member,
  discussThread,
  pwaMutationRequest,
  show,
  showComment,
  showLike,
  showTag,
  showTemplate,
} from "../schema/family-social-schema-tables";
import { showTagReference } from "../schema/global-schema-tables";
import {
  loadDiscussionThreadSummariesByTargetIds,
  loadDiscussionThreadSummariesForTargetId,
} from "./queries-discuss-threads";
import {
  AddShowCommentReturn,
  GetShowDetailReturn,
  SaveShowTemplateInput,
  SaveShowTemplateReturn,
  SaveShowInput,
  SaveShowReturn,
  ShowComment,
  ShowTagOption,
  ShowTagType,
  ShowTemplateRecord,
  ShowTemplateOption,
  ToggleShowLikeReturn,
  TvHomePageDataReturn,
  TvTemplateManagementDataReturn,
  TvShowDetail,
  TvShow,
} from "../types/shows";
import {
  createTextTipTapDocument,
  createEmptyTipTapDocument,
  isTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
  serializeTipTapDocument,
} from "../types/poem-term-validation";
import {
  createFamilyActivityRecord,
  createFamilyReactionActivityRecord,
  FAMILY_ACTIVITY_ACTION_TYPES,
} from "./queries-family-activity";
import { logDbQueryError } from "./db-error-logger";
import { canViewTemplate } from "./template-access";

const SUPPORTED_SHOW_TAG_TYPES: ShowTagType[] = ["genre", "adjective", "channel"];
const GLOBAL_TEMPLATE_FAMILY_ID = 1;

async function isViewerFounderForDrafts(familyId: number, viewerMemberId?: number): Promise<boolean> {
  if (!viewerMemberId) {
    return false;
  }

  const viewer = await db
    .select({
      id: member.id,
      isFounder: member.isFounder,
    })
    .from(member)
    .where(and(eq(member.id, viewerMemberId), eq(member.familyId, familyId)))
    .then((rows) => rows[0] ?? null);

  return Boolean(viewer?.isFounder);
}

function canViewDraftPost(
  status: string,
  ownerMemberId: number,
  viewerMemberId: number | undefined,
  viewerIsFounder: boolean
) {
  if (status !== "draft") {
    return true;
  }

  return ownerMemberId === viewerMemberId || viewerIsFounder;
}

export async function deleteShow(
  showId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const permissionCheck = actor.isFounder
    ? and(eq(show.id, showId), eq(show.familyId, actor.familyId))
    : and(eq(show.id, showId), eq(show.familyId, actor.familyId), eq(show.memberId, actor.memberId));

  const existingShow = await db
    .select({ id: show.id })
    .from(show)
    .where(permissionCheck)
    .then((rows) => rows[0] ?? null);

  if (!existingShow) {
    return {
      success: false,
      message: `No show was found for id: ${ showId }`,
    };
  }

  try {
    await db
      .delete(discussThread)
      .where(and(eq(discussThread.targetType, "show"), eq(discussThread.targetId, showId), eq(discussThread.familyId, actor.familyId)));

    await db.delete(show).where(permissionCheck);

    return {
      success: true,
      message: "Show deleted.",
    };
  } catch (error) {
    logDbQueryError("tv.deleteShow", error, {
      showId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isFounder: actor.isFounder ?? false,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting show",
    };
  }
}

function createSubmitterName(firstName?: string | null, lastName?: string | null) {
  const names = [firstName, lastName].filter(Boolean);

  if (names.length > 0) {
    return names.join(" ");
  }

  return "Unknown Member";
}

function createDefaultShowTemplateJson() {
  return serializeTipTapDocument({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Show Overview" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Why We Recommend It" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Best Episodes" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Watch Notes" }] },
      { type: "paragraph" },
    ],
  });
}

function toTemplateOption(row: {
  id: number;
  templateName: string;
  isGlobalTemplate: boolean;
  status: string;
  templateJson: string;
  memberId: number | null;
  familyId: number | null;
}): ShowTemplateOption {
  return {
    id: row.id,
    templateName: row.templateName,
    isGlobalTemplate: row.isGlobalTemplate,
    status: row.status,
    templateJson: row.templateJson,
    memberId: row.memberId,
    familyId: row.familyId,
    label: row.templateName,
  };
}

async function ensureGlobalShowTemplate(
  memberId: number,
  canManageGlobalTemplate: boolean
): Promise<ShowTemplateOption | null> {
  const [familyGlobalTemplate] = await db
    .select({
      id: showTemplate.id,
      templateName: showTemplate.templateName,
      isGlobalTemplate: showTemplate.isGlobalTemplate,
      status: showTemplate.status,
      templateJson: showTemplate.templateJson,
      memberId: showTemplate.memberId,
      familyId: showTemplate.familyId,
    })
    .from(showTemplate)
    .where(and(eq(showTemplate.isGlobalTemplate, true), eq(showTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)))
    .orderBy(asc(showTemplate.id));

  if (familyGlobalTemplate) {
    return toTemplateOption(familyGlobalTemplate);
  }

  if (!canManageGlobalTemplate) {
    return null;
  }

  const [createdTemplate] = await db
    .insert(showTemplate)
    .values({
      templateName: `__global-tv-${GLOBAL_TEMPLATE_FAMILY_ID}`,
      isGlobalTemplate: true,
      status: "published",
      templateJson: createDefaultShowTemplateJson(),
      memberId,
      familyId: GLOBAL_TEMPLATE_FAMILY_ID,
    })
    .returning({
      id: showTemplate.id,
      templateName: showTemplate.templateName,
      isGlobalTemplate: showTemplate.isGlobalTemplate,
      status: showTemplate.status,
      templateJson: showTemplate.templateJson,
      memberId: showTemplate.memberId,
      familyId: showTemplate.familyId,
    });

  return toTemplateOption(createdTemplate);
}

async function loadShowTagOptions(): Promise<ShowTagOption[]> {
  const rows = await db
    .select({
      id: showTagReference.id,
      tagName: showTagReference.tagName,
      tagDesc: showTagReference.tagDesc,
      tagType: showTagReference.tagType,
      status: showTagReference.status,
      seqNo: showTagReference.seqNo,
    })
    .from(showTagReference)
    .where(inArray(showTagReference.tagType, SUPPORTED_SHOW_TAG_TYPES))
    .orderBy(asc(showTagReference.tagType), asc(showTagReference.seqNo), asc(showTagReference.tagName));

  return rows.map((row) => ({
    id: row.id,
    tagName: row.tagName,
    tagDesc: row.tagDesc,
    tagType: row.tagType as ShowTagType,
    status: row.status,
    seqNo: row.seqNo,
  }));
}

async function loadShowTemplates(
  familyId: number,
  memberId: number,
  options: {
    includeDraft: boolean;
    includeGlobal: boolean;
    ensureGlobalTemplate?: boolean;
  }
): Promise<ShowTemplateOption[]> {
  const { includeDraft, includeGlobal, ensureGlobalTemplate = false } = options;
  const canManageGlobalTemplate = familyId === GLOBAL_TEMPLATE_FAMILY_ID && ensureGlobalTemplate;

  const fallbackTemplate = ensureGlobalTemplate
    ? await ensureGlobalShowTemplate(memberId, canManageGlobalTemplate)
    : null;

  const whereCondition = includeGlobal
    ? and(
      or(
        and(eq(showTemplate.isGlobalTemplate, true), eq(showTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
        and(
          eq(showTemplate.isGlobalTemplate, false),
          eq(showTemplate.familyId, familyId)
        )
      ),
      includeDraft ? undefined : eq(showTemplate.status, "published")
    )
    : and(
      eq(showTemplate.familyId, familyId),
      includeDraft ? undefined : eq(showTemplate.status, "published"),
      eq(showTemplate.isGlobalTemplate, false)
    );

  const rows = await db
    .select({
      id: showTemplate.id,
      templateName: showTemplate.templateName,
      isGlobalTemplate: showTemplate.isGlobalTemplate,
      status: showTemplate.status,
      templateJson: showTemplate.templateJson,
      memberId: showTemplate.memberId,
      familyId: showTemplate.familyId,
    })
    .from(showTemplate)
    .where(whereCondition)
    .orderBy(desc(showTemplate.isGlobalTemplate), asc(showTemplate.templateName));

  const mapById = new Map<number, ShowTemplateOption>();

  if (fallbackTemplate) {
    mapById.set(fallbackTemplate.id, fallbackTemplate);
  }

  for (const row of rows.filter((template) => canViewTemplate(template, familyId, memberId))) {
    mapById.set(row.id, toTemplateOption(row));
  }

  return Array.from(mapById.values()).sort((leftTemplate, rightTemplate) => {
    if (leftTemplate.isGlobalTemplate !== rightTemplate.isGlobalTemplate) {
      return leftTemplate.isGlobalTemplate ? -1 : 1;
    }

    return leftTemplate.label.localeCompare(rightTemplate.label);
  });
}

async function loadShowTemplateManagementRecords(
  familyId: number,
  actorMemberId: number,
  actorIsAdmin: boolean,
  actorIsFounder = false
): Promise<ShowTemplateRecord[]> {
  const canManageGlobalTemplate = actorIsAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

  if (canManageGlobalTemplate) {
    await ensureGlobalShowTemplate(actorMemberId, true);
  }

  const whereCondition = or(
    and(eq(showTemplate.isGlobalTemplate, true), eq(showTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
    and(
      eq(showTemplate.isGlobalTemplate, false),
      eq(showTemplate.familyId, familyId)
    )
  );

  const templateRows = await db
    .select({
      id: showTemplate.id,
      templateName: showTemplate.templateName,
      status: showTemplate.status,
      isGlobalTemplate: showTemplate.isGlobalTemplate,
      templateJson: showTemplate.templateJson,
      memberId: showTemplate.memberId,
      familyId: showTemplate.familyId,
      updatedAt: showTemplate.updatedAt,
    })
    .from(showTemplate)
    .where(whereCondition)
    .orderBy(desc(showTemplate.updatedAt), asc(showTemplate.templateName));

  const visibleTemplateRows = templateRows.filter((template) => canViewTemplate(template, familyId, actorMemberId));
  const memberIds = [...new Set(visibleTemplateRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))] as number[];
  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  return visibleTemplateRows.map((row) => {
    const canEdit = row.isGlobalTemplate
      ? canManageGlobalTemplate
      : row.memberId === actorMemberId || actorIsFounder;

    return {
      id: row.id,
      templateName: row.templateName,
      status: row.status,
      isGlobalTemplate: row.isGlobalTemplate,
      templateJson: row.templateJson,
      memberId: row.memberId,
      familyId: row.familyId,
      updatedAt: row.updatedAt ?? new Date(),
      ownerName: row.isGlobalTemplate
        ? "Global Template"
        : memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
      memberImageUrl: row.isGlobalTemplate ? null : memberImageUrlById.get(row.memberId ?? 0) ?? null,
      canEdit,
    };
  });
}

async function loadShows(familyId: number, viewerMemberId?: number): Promise<TvShow[]> {
  const showRows = await db
    .select()
    .from(show)
    .where(and(eq(show.familyId, familyId), ne(show.status, "template")))
    .orderBy(desc(show.updatedAt), asc(show.showTitle));

  if (!showRows || showRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visibleShowRows = showRows.filter((row) => canViewDraftPost(row.status, row.memberId, viewerMemberId, viewerIsFounder));

  if (visibleShowRows.length === 0) {
    return [];
  }

  const showIds = visibleShowRows.map((row) => row.id);

  const [commentRows, likeRows, tagRows, discussionThreadRows] = await Promise.all([
    db
      .select({
        showId: showComment.showId,
        isShowReviewer: showComment.isShowReviewer,
      })
      .from(showComment)
      .where(inArray(showComment.showId, showIds)),
    db
      .select({
        showId: showLike.showId,
        memberId: showLike.memberId,
        likenessDegree: showLike.likenessDegree,
      })
      .from(showLike)
      .where(inArray(showLike.showId, showIds)),
    db
      .select({
        showId: showTag.showId,
        tagId: showTag.tagId,
        tagName: showTagReference.tagName,
        tagType: showTagReference.tagType,
      })
      .from(showTag)
      .innerJoin(showTagReference, eq(showTagReference.id, showTag.tagId))
      .where(inArray(showTag.showId, showIds)),
    loadDiscussionThreadSummariesByTargetIds(familyId, "show", showIds),
  ]);

  const memberIds = [...new Set(visibleShowRows.map((row) => row.memberId))];
  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  const commentCountByShowId = new Map<number, number>();
  const noRatingByShowId = new Map<number, number>();
  const thumbsUpByShowId = new Map<number, number>();
  const loveByShowId = new Map<number, number>();
  const submitterLikeByShowId = new Map<number, number>();
  const viewerLikeByShowId = new Map<number, number>();
  const tagIdsByShowId = new Map<number, number[]>();
  const tagNamesByTypeByShowId = new Map<number, Partial<Record<ShowTagType, string[]>>>();

  for (const commentRow of commentRows) {
    if (commentRow.isShowReviewer) {
      continue;
    }

    commentCountByShowId.set(commentRow.showId, (commentCountByShowId.get(commentRow.showId) ?? 0) + 1);
  }

  for (const likeRow of likeRows) {
    const showRow = visibleShowRows.find((candidate) => candidate.id === likeRow.showId);
    const isSubmitterRating = Boolean(showRow && likeRow.memberId === showRow.memberId);

    if (isSubmitterRating) {
      submitterLikeByShowId.set(likeRow.showId, likeRow.likenessDegree);
    }

    if (viewerMemberId && likeRow.memberId === viewerMemberId) {
      viewerLikeByShowId.set(likeRow.showId, likeRow.likenessDegree);
    }

    if (isSubmitterRating) {
      continue;
    }

    if (likeRow.likenessDegree === 1) {
      thumbsUpByShowId.set(likeRow.showId, (thumbsUpByShowId.get(likeRow.showId) ?? 0) + 1);
      continue;
    }

    if (likeRow.likenessDegree === 2) {
      loveByShowId.set(likeRow.showId, (loveByShowId.get(likeRow.showId) ?? 0) + 1);
      continue;
    }

    if (likeRow.likenessDegree === -1) {
      noRatingByShowId.set(likeRow.showId, (noRatingByShowId.get(likeRow.showId) ?? 0) + 1);
    }
  }

  for (const tagRow of tagRows) {
    if (!SUPPORTED_SHOW_TAG_TYPES.includes(tagRow.tagType as ShowTagType)) {
      continue;
    }

    const nextTagIds = tagIdsByShowId.get(tagRow.showId) ?? [];
    nextTagIds.push(tagRow.tagId);
    tagIdsByShowId.set(tagRow.showId, nextTagIds);

    const tagType = tagRow.tagType as ShowTagType;
    const byType = tagNamesByTypeByShowId.get(tagRow.showId) ?? {};
    const nextNames = byType[tagType] ?? [];
    byType[tagType] = [...nextNames, tagRow.tagName];
    tagNamesByTypeByShowId.set(tagRow.showId, byType);
  }

  const hasDiscussionThreadByShowId = new Map<number, boolean>();

  for (const [targetId, summaries] of discussionThreadRows.entries()) {
    hasDiscussionThreadByShowId.set(targetId, summaries.length > 0);
  }

  return visibleShowRows.map((row) => ({
    id: row.id,
    showTitle: row.showTitle,
    showImageCredit: row.showImageCredit,
    showSiteUrl: row.showSiteUrl,
    showSiteBackground: row.showSiteBackground,
    showJson: row.showJson,
    status: row.status,
    showImageUrl: row.showImageUrl,
    showFirstYear: row.showFirstYear,
    showLastYear: row.showLastYear,
    seasonCount: row.seasonCount,
    updatedAt: row.updatedAt ?? new Date(),
    memberId: row.memberId,
    familyId: row.familyId,
    submitterName: memberNameById.get(row.memberId) ?? `Member #${row.memberId}`,
    submitterImageUrl: memberImageUrlById.get(row.memberId) ?? null,
    submitterLikenessDegree: submitterLikeByShowId.get(row.id) ?? null,
    commentCount: commentCountByShowId.get(row.id) ?? 0,
    noRatingCount: noRatingByShowId.get(row.id) ?? 0,
    thumbsUpCount: thumbsUpByShowId.get(row.id) ?? 0,
    loveCount: loveByShowId.get(row.id) ?? 0,
    likedByMember: (viewerLikeByShowId.get(row.id) ?? -1) !== -1,
    likenessDegree: viewerLikeByShowId.get(row.id) ?? null,
    selectedTagIds: tagIdsByShowId.get(row.id) ?? [],
    tagNamesByType: tagNamesByTypeByShowId.get(row.id) ?? {},
    hasDiscussionThread: hasDiscussionThreadByShowId.get(row.id) ?? false,
  }));
}

async function loadShowDetail(
  familyId: number,
  showId: number,
  viewerMemberId?: number
): Promise<TvShowDetail | null> {
  const showRows = await db
    .select()
    .from(show)
    .where(and(eq(show.familyId, familyId), eq(show.id, showId), ne(show.status, "template")));

  if (!showRows || showRows.length === 0) {
    return null;
  }

  const showRow = showRows[0];
  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);

  if (!canViewDraftPost(showRow.status, showRow.memberId, viewerMemberId, viewerIsFounder)) {
    return null;
  }

  const [commentRows, likeRows, tagRows, discussionThreads] = await Promise.all([
    db
      .select()
      .from(showComment)
      .where(eq(showComment.showId, showId))
      .orderBy(asc(showComment.createdAt)),
    db
      .select({
        memberId: showLike.memberId,
        likenessDegree: showLike.likenessDegree,
      })
      .from(showLike)
      .where(eq(showLike.showId, showId)),
    db
      .select({
        tagId: showTag.tagId,
        tagName: showTagReference.tagName,
        tagType: showTagReference.tagType,
      })
      .from(showTag)
      .innerJoin(showTagReference, eq(showTagReference.id, showTag.tagId))
      .where(eq(showTag.showId, showId)),
    loadDiscussionThreadSummariesForTargetId(familyId, "show", showId),
  ]);

  const commentMemberIds = [...new Set(commentRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const likeMemberIds = [...new Set(likeRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const memberIds = [...new Set([showRow.memberId, ...commentMemberIds, ...likeMemberIds])];

  const memberRows = memberIds.length > 0
    ? await db
      .select({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        memberImageUrl: member.memberImageUrl,
      })
      .from(member)
      .where(inArray(member.id, memberIds))
    : [];

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));

  const submitterLike = likeRows.find((row) => row.memberId === showRow.memberId) ?? null;
  const audienceLikeRows = likeRows.filter((row) => row.memberId !== showRow.memberId);
  const noRatingCount = audienceLikeRows.filter((row) => row.likenessDegree === -1).length;
  const thumbsUpCount = audienceLikeRows.filter((row) => row.likenessDegree === 1).length;
  const loveCount = audienceLikeRows.filter((row) => row.likenessDegree === 2).length;
  const noRatingMemberNames = audienceLikeRows
    .filter((row) => row.likenessDegree === -1)
    .map((row) => memberNameById.get(row.memberId) ?? `Member #${row.memberId}`)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
  const thumbsUpMemberNames = audienceLikeRows
    .filter((row) => row.likenessDegree === 1)
    .map((row) => memberNameById.get(row.memberId) ?? `Member #${row.memberId}`)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
  const loveMemberNames = audienceLikeRows
    .filter((row) => row.likenessDegree === 2)
    .map((row) => memberNameById.get(row.memberId) ?? `Member #${row.memberId}`)
    .sort((leftName, rightName) => leftName.localeCompare(rightName));
  const regularCommentRows = commentRows.filter((row) => !row.isShowReviewer);

  const viewerLike = viewerMemberId
    ? likeRows.find((row) => row.memberId === viewerMemberId)
    : null;

  const tagIdsByShowId = new Map<number, number[]>();
  const tagNamesByTypeByShowId = new Map<number, Partial<Record<ShowTagType, string[]>>>();

  for (const tagRow of tagRows) {
    if (!SUPPORTED_SHOW_TAG_TYPES.includes(tagRow.tagType as ShowTagType)) {
      continue;
    }

    const existingTagIds = tagIdsByShowId.get(showId) ?? [];
    existingTagIds.push(tagRow.tagId);
    tagIdsByShowId.set(showId, existingTagIds);

    const tagType = tagRow.tagType as ShowTagType;
    const byType = tagNamesByTypeByShowId.get(showId) ?? {};
    const currentNames = byType[tagType] ?? [];
    byType[tagType] = [...currentNames, tagRow.tagName];
    tagNamesByTypeByShowId.set(showId, byType);
  }

  const showComments: ShowComment[] = regularCommentRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt ?? new Date(),
    commenterName: memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
    commentJson: normalizeSerializedTipTapDocument(row.commentJson),
  }));

  return {
    id: showRow.id,
    showTitle: showRow.showTitle,
    showImageCredit: showRow.showImageCredit,
    showSiteUrl: showRow.showSiteUrl,
    showSiteBackground: showRow.showSiteBackground,
    showJson: showRow.showJson,
    status: showRow.status,
    showImageUrl: showRow.showImageUrl,
    showFirstYear: showRow.showFirstYear,
    showLastYear: showRow.showLastYear,
    seasonCount: showRow.seasonCount,
    updatedAt: showRow.updatedAt ?? new Date(),
    memberId: showRow.memberId,
    familyId: showRow.familyId,
    submitterName: memberNameById.get(showRow.memberId) ?? `Member #${showRow.memberId}`,
    submitterImageUrl: memberImageUrlById.get(showRow.memberId) ?? null,
    submitterLikenessDegree: submitterLike?.likenessDegree ?? null,
    commentCount: regularCommentRows.length,
    noRatingCount,
    thumbsUpCount,
    loveCount,
    likedByMember: Boolean(viewerLike && viewerLike.likenessDegree !== -1),
    likenessDegree: viewerLike?.likenessDegree ?? null,
    selectedTagIds: tagIdsByShowId.get(showId) ?? [],
    tagNamesByType: tagNamesByTypeByShowId.get(showId) ?? {},
    noRatingMemberNames,
    thumbsUpMemberNames,
    loveMemberNames,
    showComments,
    discussionThreads,
    hasDiscussionThread: discussionThreads.length > 0,
  };
}

export async function getTvShowById(
  familyId: number,
  showId: number,
  viewerMemberId?: number
): Promise<{ success: false; message: string } | { success: true; show: TvShow }> {
  const shows = await loadShows(familyId, viewerMemberId);
  const selectedShow = shows.find((showRecord) => showRecord.id === showId);

  if (!selectedShow) {
    return {
      success: false,
      message: `No show was found for id: ${showId}`,
    };
  }

  return {
    success: true,
    show: selectedShow,
  };
}

export async function getTvHomePageData(
  familyId: number,
  memberId: number,
  isAdmin = false
): Promise<TvHomePageDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

    const [shows, showTags, showTemplates] = await Promise.all([
      loadShows(familyId, memberId),
      loadShowTagOptions(),
      loadShowTemplates(familyId, memberId, {
        includeDraft: false,
        includeGlobal: true,
        ensureGlobalTemplate: canManageGlobalTemplate,
      }),
    ]);

    return {
      success: true,
      shows,
      showTags,
      showTemplates,
    };
  } catch (error) {
    logDbQueryError("tv.getTvHomePageData", error, { familyId, memberId });
    
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading TV home page data",
    };
  }
}

export async function getTvTemplateManagementData(
  familyId: number,
  memberId: number,
  isAdmin: boolean,
  isFounder = false
): Promise<TvTemplateManagementDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const templates = await loadShowTemplateManagementRecords(familyId, memberId, canManageGlobalTemplate, isFounder);

    return {
      success: true,
      templates,
    };
  } catch (error) {
    logDbQueryError("tv.getTvTemplateManagementData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading TV templates",
    };
  }
}

async function resolveTmdbTvImage(showTitle: string, showFirstYear?: number): Promise<{ imageUrl: string; imageCredit: string } | null> {
  const normalizedTitle = showTitle.trim();
  if (!normalizedTitle) {
    return null;
  }

  const token =
    process.env.TMDB_READ_ACCESS_TOKEN?.trim() ||
    process.env.TMDB_CLIENT_SECRET?.trim() ||
    process.env.TMDB_CLIENT_ID?.trim() ||
    process.env.TMDB_API_KEY?.trim();

  if (!token) {
    console.debug("[tmdb-tv-search] no TMDB API token configured");
    return null;
  }

  console.debug("[tmdb-tv-search] starting search", { showTitle: normalizedTitle, showFirstYear });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  try {
    let searchUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(normalizedTitle)}`;
    if (showFirstYear && Number.isInteger(showFirstYear) && showFirstYear > 1900) {
      searchUrl += `&first_air_date_year=${showFirstYear}`;
    }

    const response = await fetch(searchUrl, { headers });

    if (!response.ok) {
      const errorText = await response.text().catch(() => null);
      console.debug("[tmdb-tv-search] TMDB search request failed", { status: response.status, errorText });
      return null;
    }

    let body = (await response.json()) as {
      results?: Array<{
        name?: string;
        backdrop_path?: string | null;
        poster_path?: string | null;
        first_air_date?: string;
      }>;
    };

    if ((!body.results || body.results.length === 0) && showFirstYear) {
      const fallbackUrl = `https://api.themoviedb.org/3/search/tv?query=${encodeURIComponent(normalizedTitle)}`;
      console.debug("[tmdb-tv-search] no results with year, retrying without first_air_date_year");
      const fallbackResponse = await fetch(fallbackUrl, { headers });
      if (fallbackResponse.ok) {
        body = (await fallbackResponse.json()) as typeof body;
      }
    }

    const results = body.results ?? [];
    console.debug("[tmdb-tv-search] results count:", results.length);

    const matchedShow = results.find((item) => Boolean(item.backdrop_path || item.poster_path));
    if (!matchedShow) {
      console.debug("[tmdb-tv-search] no TV show image (backdrop or poster) found in results");
      return null;
    }

    const imagePath = matchedShow.backdrop_path || matchedShow.poster_path!;
    const imageSize = matchedShow.backdrop_path ? "w780" : "w342";
    const resolvedImageUrl = `https://image.tmdb.org/t/p/${imageSize}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`;
    const matchedName = matchedShow.name?.trim() || normalizedTitle;
    const imageCredit = `Title: TMDB (${matchedName}) | Source: ${resolvedImageUrl}`;

    console.debug("[tmdb-tv-search] matched TV poster", {
      name: matchedShow.name,
      first_air_date: matchedShow.first_air_date,
      resolvedImageUrl,
      imageCredit,
    });

    return { imageUrl: resolvedImageUrl, imageCredit };
  } catch (error) {
    console.debug("[tmdb-tv-search] search threw an error", { showTitle: normalizedTitle, error });
    return null;
  }
}

export async function saveShow(
  input: SaveShowInput,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<SaveShowReturn> {
  const normalizedTitle = input.showTitle.trim();

  if (!normalizedTitle) {
    return {
      success: false,
      message: "Show title is required.",
    };
  }

  const sanitizedTagIds = [...new Set(input.selectedTagIds)].filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  const existingShow = input.id
    ? await db
      .select()
      .from(show)
      .where(and(eq(show.id, input.id), eq(show.familyId, actor.familyId), ne(show.status, "template")))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingShow) {
    return {
      success: false,
      message: `No show was found for id: ${input.id}`,
    };
  }

  if (existingShow && existingShow.memberId !== actor.memberId) {
    if (!actor.isFounder) {
      return {
        success: false,
        message: "Only the member who created this show can edit it.",
      };
    }

    // Founders can only change status to/from archived
    const isArchiveStatusChange =
      input.status === "archived" || 
      (existingShow.status === "archived" && input.status === "published");

    if (!isArchiveStatusChange) {
      return {
        success: false,
        message: "Only the member who created this show can edit it.",
      };
    }

    // For founders doing archive/unarchive, only update status field
    try {
      const [updatedShow] = await db
        .update(show)
        .set({ status: input.status })
        .where(eq(show.id, existingShow.id))
        .returning();

      if (!updatedShow) {
        return {
          success: false,
          message: `Failed to archive/unarchive show with id: ${input.id}`,
        };
      }

      // Load the full updated show to return
      const shows = await loadShows(actor.familyId, actor.memberId);
      const fullUpdatedShow = shows.find((s) => s.id === updatedShow.id);

      if (!fullUpdatedShow) {
        return {
          success: false,
          message: `Failed to load updated show with id: ${input.id}`,
        };
      }

      return {
        success: true,
        show: fullUpdatedShow,
        message: updatedShow.status === "archived" ? "Show archived." : "Show unarchived.",
      };
    } catch (error) {
      logDbQueryError("tv.saveShow.archiveToggle", error, {
        showId: input.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
        status: input.status,
      });
      return {
        success: false,
        message: "An error occurred while archiving the show.",
      };
    }
  }

  const templates = await loadShowTemplates(actor.familyId, actor.memberId, {
    includeDraft: true,
    includeGlobal: true,
    ensureGlobalTemplate: true,
  });

  const selectedTemplate = templates.find((template) => template.id === input.templateId);

  if (!selectedTemplate) {
    return {
      success: false,
      message: "A show template must be selected.",
    };
  }

  const submitterLikenessDegree = Number(input.submitterLikenessDegree);
  const hasSubmitterLikenessDegree = [1, 2].includes(submitterLikenessDegree);

  const tmdbResult = input.searchTmdbImage
    ? await resolveTmdbTvImage(normalizedTitle, input.showFirstYear)
    : null;

  const resolvedShowImageUrl = tmdbResult?.imageUrl ?? (input.showImageUrl ?? null);
  const resolvedShowImageCredit = tmdbResult?.imageCredit ?? input.showImageCredit;

  console.debug("[tmdb-tv-search] saveShow invocation", {
    searchTmdbImage: Boolean(input.searchTmdbImage),
    showTitle: normalizedTitle,
    showFirstYear: input.showFirstYear,
    resolvedShowImageUrl,
    resolvedShowImageCredit,
  });

  const showJsonToStore = input.showJson?.trim() || selectedTemplate.templateJson || serializeTipTapDocument(createEmptyTipTapDocument());

  try {
    const [persistedShow] = input.id
      ? await db
        .update(show)
        .set({
          showTitle: normalizedTitle,
          showImageCredit: resolvedShowImageCredit,
          showSiteUrl: input.showSiteUrl ?? null,
          showSiteBackground: input.showSiteBackground ?? "#000000",
          showJson: showJsonToStore,
          status: input.status,
          showImageUrl: resolvedShowImageUrl,
          showFirstYear: input.showFirstYear,
          showLastYear: input.showLastYear,
          seasonCount: input.seasonCount,
          updatedAt: new Date(),
        })
        .where(and(eq(show.id, input.id), eq(show.familyId, actor.familyId)))
        .returning()
      : await db
        .insert(show)
        .values({
          showTitle: normalizedTitle,
          showImageCredit: resolvedShowImageCredit,
          showSiteUrl: input.showSiteUrl ?? null,
          showSiteBackground: input.showSiteBackground ?? "#000000",
          showJson: showJsonToStore,
          status: input.status,
          showImageUrl: resolvedShowImageUrl,
          showFirstYear: input.showFirstYear,
          showLastYear: input.showLastYear,
          seasonCount: input.seasonCount,
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    if (!persistedShow) {
      return {
        success: false,
        message: "Could not save show.",
      };
    }

    await db.delete(showTag).where(eq(showTag.showId, persistedShow.id));

    if (sanitizedTagIds.length > 0) {
      await db.insert(showTag).values(
        sanitizedTagIds.map((tagId) => ({
          showId: persistedShow.id,
          tagId,
        }))
      );
    }

    if (!existingShow) {
      await db.insert(showComment).values({
        showId: persistedShow.id,
        memberId: actor.memberId,
        commentJson: "",
        isShowReviewer: true,
      });
    }

    if (hasSubmitterLikenessDegree) {
      await db.delete(showLike).where(and(eq(showLike.showId, persistedShow.id), eq(showLike.memberId, actor.memberId)));

      await db.insert(showLike).values({
        showId: persistedShow.id,
        memberId: actor.memberId,
        likenessDegree: submitterLikenessDegree,
        updatedAt: new Date(),
      });
    }

    if (!existingShow) {
      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: "TV Room",
        postName: normalizedTitle,
        postId: persistedShow.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const shows = await loadShows(actor.familyId, actor.memberId);
    const savedShow = shows.find((showRecord) => showRecord.id === persistedShow.id);

    if (!savedShow) {
      return {
        success: false,
        message: "Show was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      show: savedShow,
      message: input.id ? "Show updated." : "Show added.",
    };
  } catch (error) {
    logDbQueryError("tv.saveShow", error, {
      showId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: input.status,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving show",
    };
  }
}

export async function saveShowTemplate(
  input: SaveShowTemplateInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin: boolean;
    isFounder?: boolean;
  }
): Promise<SaveShowTemplateReturn> {
  const canManageGlobalTemplate = actor.isAdmin && actor.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
  const normalizedName = input.templateName.trim();
  const normalizedStatus = input.status.trim().toLowerCase();
  const normalizedJson = input.templateJson.trim();

  if (!normalizedName) {
    return {
      success: false,
      message: "Enter a template name before saving.",
    };
  }

  if (normalizedStatus !== "draft" && normalizedStatus !== "published") {
    return {
      success: false,
      message: "Template status must be draft or published.",
    };
  }

  const parsedTemplateJson = parseSerializedTipTapDocument(normalizedJson);

  if (!parsedTemplateJson.success) {
    return {
      success: false,
      message: parsedTemplateJson.message,
    };
  }

  const existingTemplate = input.id
    ? await db
      .select()
      .from(showTemplate)
      .where(eq(showTemplate.id, input.id))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingTemplate) {
    return {
      success: false,
      message: `No template was found for id: ${input.id}`,
    };
  }

  if (existingTemplate) {
    if (existingTemplate.isGlobalTemplate && (!canManageGlobalTemplate || existingTemplate.familyId !== GLOBAL_TEMPLATE_FAMILY_ID)) {
      return {
        success: false,
        message: "Only the family 1 admin can edit global templates.",
      };
    }

    const isOwnerOrFounder = existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder);

    if (!existingTemplate.isGlobalTemplate && (existingTemplate.familyId !== actor.familyId || !isOwnerOrFounder)) {
      return {
        success: false,
        message: "Only the template owner or the family founder can edit this template.",
      };
    }
  }

  const duplicateRows = await db
    .select({ id: showTemplate.id })
    .from(showTemplate)
    .where(
      input.id
        ? and(
          eq(showTemplate.familyId, actor.familyId),
          ilike(showTemplate.templateName, normalizedName),
          ne(showTemplate.id, input.id)
        )
        : and(eq(showTemplate.familyId, actor.familyId), ilike(showTemplate.templateName, normalizedName))
    );

  if (duplicateRows.length > 0) {
    return {
      success: false,
      message: "A template with this name already exists in your family.",
    };
  }

  try {
    const [savedTemplate] = existingTemplate
      ? await db
        .update(showTemplate)
        .set({
          templateName: normalizedName,
          status: normalizedStatus,
          templateJson: serializeTipTapDocument(parsedTemplateJson.content),
          updatedAt: new Date(),
        })
        .where(eq(showTemplate.id, existingTemplate.id))
        .returning()
      : await db
        .insert(showTemplate)
        .values({
          templateName: normalizedName,
          status: normalizedStatus,
          isGlobalTemplate: false,
          templateJson: serializeTipTapDocument(parsedTemplateJson.content),
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    const templates = await loadShowTemplateManagementRecords(actor.familyId, actor.memberId, canManageGlobalTemplate, Boolean(actor.isFounder));
    const savedTemplateRecord = templates.find((template) => template.id === savedTemplate.id);

    if (!savedTemplateRecord) {
      return {
        success: false,
        message: "Template was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      template: savedTemplateRecord,
      message: `Template "${savedTemplateRecord.templateName}" saved successfully.`,
    };
  } catch (error) {
    logDbQueryError("tv.saveShowTemplate", error, {
      templateId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error
        ? `Failed to save template changes: ${error.message}`
        : "Failed to save template changes.",
    };
  }
}

export async function deleteShowTemplate(
  templateId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const existingTemplate = await db
    .select()
    .from(showTemplate)
    .where(eq(showTemplate.id, templateId))
    .then((rows) => rows[0] ?? null);

  if (!existingTemplate) {
    return {
      success: false,
      message: `No template was found for id: ${templateId}`,
    };
  }

  if (existingTemplate.isGlobalTemplate) {
    return {
      success: false,
      message: "Global templates cannot be deleted.",
    };
  }

  const isOwnerOrFounder = existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder);

  if (existingTemplate.familyId !== actor.familyId || !isOwnerOrFounder) {
    return {
      success: false,
      message: "Only the template owner or the family founder can delete this template.",
    };
  }

  try {
    await db.delete(showTemplate).where(eq(showTemplate.id, templateId));

    return {
      success: true,
      message: `Template "${existingTemplate.templateName}" deleted.`,
    };
  } catch (error) {
    logDbQueryError("tv.deleteShowTemplate", error, {
      templateId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting show template",
    };
  }
}

export async function getShowDetail(
  familyId: number,
  showId: number,
  viewerMemberId?: number
): Promise<GetShowDetailReturn> {
  try {
    const showDetail = await loadShowDetail(familyId, showId, viewerMemberId);

    if (!showDetail) {
      return {
        success: false,
        message: "Show not found.",
      };
    }

    return {
      success: true,
      show: showDetail,
    };
  } catch (error) {
    logDbQueryError("tv.getShowDetail", error, { familyId, showId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to load show detail.",
    };
  }
}

export async function toggleShowLike(
  showId: number,
  likenessDegree: number,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<ToggleShowLikeReturn> {
  const existingShow = await db
    .select()
    .from(show)
    .where(and(eq(show.familyId, actor.familyId), eq(show.id, showId), ne(show.status, "template")))
    .then((rows) => rows[0] ?? null);

  if (!existingShow) {
    return {
      success: false,
      message: "Show not found.",
    };
  }

  if (existingShow.memberId === actor.memberId) {
    return {
      success: false,
      message: "You cannot react to your own show.",
    };
  }

  if (![-1, 1, 2].includes(likenessDegree)) {
    return {
      success: false,
      message: "Show reactions must be thumbs down, thumbs up, or love.",
    };
  }

  try {
    const existingLike = await db
      .select()
      .from(showLike)
      .where(
        and(
          eq(showLike.showId, showId),
          eq(showLike.memberId, actor.memberId)
        )
      )
      .then((rows) => rows[0] ?? null);

    if (existingLike && existingLike.likenessDegree === likenessDegree) {
      await db
        .delete(showLike)
        .where(
          and(
            eq(showLike.showId, showId),
            eq(showLike.memberId, actor.memberId),
            eq(showLike.likenessDegree, likenessDegree)
          )
        );
    } else if (existingLike) {
      await db
        .update(showLike)
        .set({
          likenessDegree,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(showLike.showId, showId),
            eq(showLike.memberId, actor.memberId)
          )
        );
    } else {
      await db
        .insert(showLike)
        .values({
          showId,
          memberId: actor.memberId,
          likenessDegree,
        });
    }

    if ((likenessDegree === 1 || likenessDegree === 2) && (!existingLike || existingLike.likenessDegree !== likenessDegree)) {
      await createFamilyReactionActivityRecord({
        reactionType: likenessDegree === 2 ? "love" : "like",
        featureName: "TV Room",
        postName: existingShow.showTitle,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const updatedShow = await loadShowDetail(actor.familyId, showId, actor.memberId);

    if (!updatedShow) {
      return {
        success: false,
        message: "Show was updated but could not be reloaded.",
      };
    }

    const actionText = existingLike && existingLike.likenessDegree === likenessDegree
      ? "reaction removed"
      : "reaction added";

    return {
      success: true,
      show: updatedShow,
      message: `Show ${actionText} successfully.`,
    };
  } catch (error) {
    logDbQueryError("tv.toggleShowLike", error, {
      showId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      likenessDegree,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to update show reaction.",
    };
  }
}

export async function addShowComment(
  input: {
    showId: number;
    commentText: string;
    clientRequestId?: string;
  },
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<AddShowCommentReturn> {
  const normalizedComment = input.commentText.trim();

  const parsedComment = parseSerializedTipTapDocument(normalizedComment);
  const commentJson = parsedComment.success
    ? serializeTipTapDocument(parsedComment.content)
    : serializeTipTapDocument(createTextTipTapDocument(normalizedComment));

  if (parsedComment.success && isTipTapDocumentEmpty(parsedComment.content)) {
    return {
      success: false,
      message: "Comment cannot be empty.",
    };
  }

  if (!parsedComment.success && normalizedComment.length < 2) {
    return {
      success: false,
      message: "Comment must be at least 2 characters.",
    };
  }

  const existingShow = await db
    .select()
    .from(show)
    .where(and(eq(show.familyId, actor.familyId), eq(show.id, input.showId), ne(show.status, "template")))
    .then((rows) => rows[0] ?? null);

  if (!existingShow) {
    return {
      success: false,
      message: "Show not found.",
    };
  }

  try {
    const duplicateRequest = input.clientRequestId
      ? await db
        .insert(pwaMutationRequest)
        .values({
          requestKey: input.clientRequestId,
          mutationName: 'tv.addShowComment',
          entityType: 'show',
          entityId: input.showId,
          familyId: actor.familyId,
          memberId: actor.memberId,
        })
        .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
        .returning({ id: pwaMutationRequest.id })
      : [{ id: 0 }];

    if (input.clientRequestId && duplicateRequest.length === 0) {
      const existingUpdatedShow = await loadShowDetail(actor.familyId, input.showId, actor.memberId);

      if (!existingUpdatedShow) {
        return {
          success: false,
          message: 'Comment was already submitted, but the show could not be reloaded.',
        };
      }

      return {
        success: true,
        show: existingUpdatedShow,
        message: 'Comment already synced.',
      };
    }

    await db
      .insert(showComment)
      .values({
        showId: input.showId,
        memberId: actor.memberId,
        commentJson,
        isShowReviewer: false,
      });

    await createFamilyActivityRecord({
      actionType: FAMILY_ACTIVITY_ACTION_TYPES.COMMENT_CREATED,
      featureName: "TV Room",
      postName: existingShow.showTitle,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });

    const updatedShow = await loadShowDetail(actor.familyId, input.showId, actor.memberId);

    if (!updatedShow) {
      return {
        success: false,
        message: "Comment was added but show could not be reloaded.",
      };
    }

    return {
      success: true,
      show: updatedShow,
      message: "Comment posted successfully.",
    };
  } catch (error) {
    logDbQueryError("tv.addShowComment", error, {
      showId: input.showId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to add comment.",
    };
  }
}
