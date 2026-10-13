import db from "@/components/db/drizzle";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";

import {
  member,
  discussThread,
  movie,
  movieComment,
  movieLike,
  movieTag,
  pwaMutationRequest,
  movieTemplate,
} from "../schema/family-social-schema-tables";
import { movieTagReference } from "../schema/global-schema-tables";
import { loadDiscussionThreadSummariesByTargetIds, loadDiscussionThreadSummariesForTargetId } from "./queries-discuss-threads";
import {
  AddMovieCommentReturn,
  DeleteMovieReturn,
  GetMovieDetailReturn,
  MovieComment,
  MovieDetail,
  MovieHomePageDataReturn,
  MovieRecord,
  MovieTagOption,
  MovieTagType,
  MovieTemplateManagementDataReturn,
  MovieTemplateOption,
  MovieTemplateRecord,
  SaveMovieInput,
  SaveMovieReturn,
  SaveMovieTemplateInput,
  SaveMovieTemplateReturn,
  ToggleMovieLikeReturn,
} from "../types/movies";
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

const SUPPORTED_MOVIE_TAG_TYPES: MovieTagType[] = ["genre", "adjective", "channel"];
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

export async function deleteMovie(
  movieId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<DeleteMovieReturn> {
  const permissionCheck = actor.isFounder
    ? and(eq(movie.id, movieId), eq(movie.familyId, actor.familyId))
    : and(eq(movie.id, movieId), eq(movie.familyId, actor.familyId), eq(movie.memberId, actor.memberId));

  const existingMovie = await db
    .select({ id: movie.id })
    .from(movie)
    .where(permissionCheck)
    .then((rows) => rows[0] ?? null);

  if (!existingMovie) {
    return {
      success: false,
      message: `No movie was found for id: ${ movieId }`,
    };
  }

  try {
    await db
      .delete(discussThread)
      .where(and(eq(discussThread.targetType, "movie"), eq(discussThread.targetId, movieId), eq(discussThread.familyId, actor.familyId)));

    await db.delete(movie).where(permissionCheck);

    return {
      success: true,
      message: "Movie deleted.",
    };
  } catch (error) {
    logDbQueryError("movies.deleteMovie", error, {
      movieId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isFounder: actor.isFounder ?? false,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting movie",
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

function createDefaultMovieTemplateJson() {
  return serializeTipTapDocument({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Movie Overview" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Why We Recommend It" }] },
      { type: "paragraph" },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Favorite Scenes" }] },
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
}): MovieTemplateOption {
  const isFamilyGlobalTemplate = row.isGlobalTemplate && row.familyId === GLOBAL_TEMPLATE_FAMILY_ID;

  return {
    id: row.id,
    templateName: row.templateName,
    isGlobalTemplate: isFamilyGlobalTemplate,
    status: row.status,
    templateJson: row.templateJson,
    memberId: row.memberId,
    familyId: row.familyId,
    label: row.templateName,
  };
}

async function ensureGlobalMovieTemplate(
  memberId: number,
  canManageGlobalTemplate: boolean
): Promise<MovieTemplateOption | null> {
  const [familyGlobalTemplate] = await db
    .select({
      id: movieTemplate.id,
      templateName: movieTemplate.templateName,
      isGlobalTemplate: movieTemplate.isGlobalTemplate,
      status: movieTemplate.status,
      templateJson: movieTemplate.templateJson,
      memberId: movieTemplate.memberId,
      familyId: movieTemplate.familyId,
    })
    .from(movieTemplate)
    .where(and(eq(movieTemplate.isGlobalTemplate, true), eq(movieTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)))
    .orderBy(asc(movieTemplate.id));

  if (familyGlobalTemplate) {
    return toTemplateOption(familyGlobalTemplate);
  }

  if (!canManageGlobalTemplate) {
    return null;
  }

  const [createdTemplate] = await db
    .insert(movieTemplate)
    .values({
      templateName: `__global-movie-${GLOBAL_TEMPLATE_FAMILY_ID}`,
      isGlobalTemplate: true,
      status: "published",
      templateJson: createDefaultMovieTemplateJson(),
      memberId,
      familyId: GLOBAL_TEMPLATE_FAMILY_ID,
    })
    .returning({
      id: movieTemplate.id,
      templateName: movieTemplate.templateName,
      isGlobalTemplate: movieTemplate.isGlobalTemplate,
      status: movieTemplate.status,
      templateJson: movieTemplate.templateJson,
      memberId: movieTemplate.memberId,
      familyId: movieTemplate.familyId,
    });

  return toTemplateOption(createdTemplate);
}

async function loadMovieTagOptions(): Promise<MovieTagOption[]> {
  const rows = await db
    .select({
      id: movieTagReference.id,
      tagName: movieTagReference.tagName,
      tagDesc: movieTagReference.tagDesc,
      tagType: movieTagReference.tagType,
      status: movieTagReference.status,
      seqNo: movieTagReference.seqNo,
    })
    .from(movieTagReference)
    .where(inArray(movieTagReference.tagType, SUPPORTED_MOVIE_TAG_TYPES))
    .orderBy(asc(movieTagReference.tagType), asc(movieTagReference.seqNo), asc(movieTagReference.tagName));

  return rows.map((row) => ({
    id: row.id,
    tagName: row.tagName,
    tagDesc: row.tagDesc,
    tagType: row.tagType as MovieTagType,
    status: row.status,
    seqNo: row.seqNo,
  }));
}

async function loadMovieTemplates(
  familyId: number,
  memberId: number,
  options: {
    includeDraft: boolean;
    includeGlobal: boolean;
    ensureGlobalTemplate?: boolean;
  }
): Promise<MovieTemplateOption[]> {
  const { includeDraft, includeGlobal, ensureGlobalTemplate = false } = options;
  const canManageGlobalTemplate = familyId === GLOBAL_TEMPLATE_FAMILY_ID && ensureGlobalTemplate;

  const fallbackTemplate = ensureGlobalTemplate
    ? await ensureGlobalMovieTemplate(memberId, canManageGlobalTemplate)
    : null;

  const whereCondition = includeGlobal
    ? and(
      or(
        and(eq(movieTemplate.isGlobalTemplate, true), eq(movieTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
        and(
          eq(movieTemplate.isGlobalTemplate, false),
          eq(movieTemplate.familyId, familyId)
        )
      ),
      includeDraft ? undefined : eq(movieTemplate.status, "published")
    )
    : and(
      eq(movieTemplate.familyId, familyId),
      includeDraft ? undefined : eq(movieTemplate.status, "published"),
      eq(movieTemplate.isGlobalTemplate, false)
    );

  const rows = await db
    .select({
      id: movieTemplate.id,
      templateName: movieTemplate.templateName,
      isGlobalTemplate: movieTemplate.isGlobalTemplate,
      status: movieTemplate.status,
      templateJson: movieTemplate.templateJson,
      memberId: movieTemplate.memberId,
      familyId: movieTemplate.familyId,
    })
    .from(movieTemplate)
    .where(whereCondition)
    .orderBy(desc(movieTemplate.isGlobalTemplate), asc(movieTemplate.templateName));

  const mapById = new Map<number, MovieTemplateOption>();

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

async function loadMovieTemplateManagementRecords(
  familyId: number,
  actorMemberId: number,
  actorIsAdmin: boolean,
  actorIsFounder = false
): Promise<MovieTemplateRecord[]> {
  const canManageGlobalTemplate = actorIsAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

  if (canManageGlobalTemplate) {
    await ensureGlobalMovieTemplate(actorMemberId, true);
  }

  const whereCondition = or(
    and(eq(movieTemplate.isGlobalTemplate, true), eq(movieTemplate.familyId, GLOBAL_TEMPLATE_FAMILY_ID)),
    and(
      eq(movieTemplate.isGlobalTemplate, false),
      eq(movieTemplate.familyId, familyId)
    )
  );

  const templateRows = await db
    .select({
      id: movieTemplate.id,
      templateName: movieTemplate.templateName,
      status: movieTemplate.status,
      isGlobalTemplate: movieTemplate.isGlobalTemplate,
      templateJson: movieTemplate.templateJson,
      memberId: movieTemplate.memberId,
      familyId: movieTemplate.familyId,
      updatedAt: movieTemplate.updatedAt,
    })
    .from(movieTemplate)
    .where(whereCondition)
    .orderBy(desc(movieTemplate.updatedAt), asc(movieTemplate.templateName));

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
    const isFamilyGlobalTemplate = row.isGlobalTemplate && row.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const canEdit = isFamilyGlobalTemplate
      ? canManageGlobalTemplate
      : row.memberId === actorMemberId || actorIsFounder;

    return {
      id: row.id,
      templateName: row.templateName,
      status: row.status,
      isGlobalTemplate: isFamilyGlobalTemplate,
      templateJson: row.templateJson,
      memberId: row.memberId,
      familyId: row.familyId,
      updatedAt: row.updatedAt ?? new Date(),
      ownerName: isFamilyGlobalTemplate
        ? "Global Template"
        : memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
      memberImageUrl: isFamilyGlobalTemplate ? null : memberImageUrlById.get(row.memberId ?? 0) ?? null,
      canEdit,
    };
  });
}

async function loadMovies(familyId: number, viewerMemberId?: number): Promise<MovieRecord[]> {
  const movieRows = await db
    .select()
    .from(movie)
    .where(eq(movie.familyId, familyId))
    .orderBy(desc(movie.updatedAt), asc(movie.movieTitle));

  if (!movieRows || movieRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visibleMovieRows = movieRows.filter((row) => canViewDraftPost(row.status, row.memberId, viewerMemberId, viewerIsFounder));

  if (visibleMovieRows.length === 0) {
    return [];
  }

  const movieIds = visibleMovieRows.map((row) => row.id);

  const [commentRows, likeRows, tagRows, discussionThreadRows] = await Promise.all([
    db
      .select({
        movieId: movieComment.movieId,
        ismovieReviewer: movieComment.ismovieReviewer,
      })
      .from(movieComment)
      .where(inArray(movieComment.movieId, movieIds)),
    db
      .select({
        movieId: movieLike.movieId,
        memberId: movieLike.memberId,
        likenessDegree: movieLike.likenessDegree,
      })
      .from(movieLike)
      .where(inArray(movieLike.movieId, movieIds)),
    db
      .select({
        movieId: movieTag.movieId,
        tagId: movieTag.tagId,
        tagName: movieTagReference.tagName,
        tagType: movieTagReference.tagType,
      })
      .from(movieTag)
      .innerJoin(movieTagReference, eq(movieTagReference.id, movieTag.tagId))
      .where(inArray(movieTag.movieId, movieIds)),
    loadDiscussionThreadSummariesByTargetIds(familyId, "movie", movieIds),
  ]);

  const memberIds = [...new Set(visibleMovieRows.map((row) => row.memberId))];
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
  const submitterMemberIdByMovieId = new Map(visibleMovieRows.map((row) => [row.id, row.memberId]));

  const commentCountByMovieId = new Map<number, number>();
  const noRatingByMovieId = new Map<number, number>();
  const thumbsUpByMovieId = new Map<number, number>();
  const loveByMovieId = new Map<number, number>();
  const submitterLikeByMovieId = new Map<number, number>();
  const viewerLikeByMovieId = new Map<number, number>();
  const tagIdsByMovieId = new Map<number, number[]>();
  const tagNamesByTypeByMovieId = new Map<number, Partial<Record<MovieTagType, string[]>>>();
  const hasDiscussionThreadByMovieId = new Map<number, boolean>();

  for (const commentRow of commentRows) {
    if (commentRow.ismovieReviewer) {
      continue;
    }

    commentCountByMovieId.set(commentRow.movieId, (commentCountByMovieId.get(commentRow.movieId) ?? 0) + 1);
  }

  for (const likeRow of likeRows) {
    const submitterMemberId = submitterMemberIdByMovieId.get(likeRow.movieId);

    if (submitterMemberId && likeRow.memberId === submitterMemberId) {
      submitterLikeByMovieId.set(likeRow.movieId, likeRow.likenessDegree);
    } else if (likeRow.likenessDegree === 1) {
      thumbsUpByMovieId.set(likeRow.movieId, (thumbsUpByMovieId.get(likeRow.movieId) ?? 0) + 1);
    } else if (likeRow.likenessDegree === 2) {
      loveByMovieId.set(likeRow.movieId, (loveByMovieId.get(likeRow.movieId) ?? 0) + 1);
    } else if (likeRow.likenessDegree === -1) {
      noRatingByMovieId.set(likeRow.movieId, (noRatingByMovieId.get(likeRow.movieId) ?? 0) + 1);
    }

    if (viewerMemberId && likeRow.memberId === viewerMemberId) {
      viewerLikeByMovieId.set(likeRow.movieId, likeRow.likenessDegree);
    }
  }

  for (const tagRow of tagRows) {
    if (!SUPPORTED_MOVIE_TAG_TYPES.includes(tagRow.tagType as MovieTagType)) {
      continue;
    }

    const nextTagIds = tagIdsByMovieId.get(tagRow.movieId) ?? [];
    nextTagIds.push(tagRow.tagId);
    tagIdsByMovieId.set(tagRow.movieId, nextTagIds);

    const tagType = tagRow.tagType as MovieTagType;
    const byType = tagNamesByTypeByMovieId.get(tagRow.movieId) ?? {};
    const nextNames = byType[tagType] ?? [];
    byType[tagType] = [...nextNames, tagRow.tagName];
    tagNamesByTypeByMovieId.set(tagRow.movieId, byType);
  }

  for (const [targetId, summaries] of discussionThreadRows.entries()) {
    hasDiscussionThreadByMovieId.set(targetId, summaries.length > 0);
  }

  return visibleMovieRows.map((row) => ({
    id: row.id,
    movieTitle: row.movieTitle,
    movieImageCredit: row.movieImageCredit,
    movieSiteUrl: row.movieSiteUrl,
    movieSiteBackground: row.movieSiteBackground,
    movieJson: row.movieJson,
    status: row.status,
    movieImageUrl: row.movieImageUrl,
    movieDebutYear: row.movieDebutYear,
    updatedAt: row.updatedAt ?? new Date(),
    memberId: row.memberId,
    familyId: row.familyId,
    submitterName: memberNameById.get(row.memberId) ?? `Member #${row.memberId}`,
    submitterImageUrl: memberImageUrlById.get(row.memberId) ?? null,
    submitterLikenessDegree: submitterLikeByMovieId.get(row.id) ?? null,
    commentCount: commentCountByMovieId.get(row.id) ?? 0,
    noRatingCount: noRatingByMovieId.get(row.id) ?? 0,
    thumbsUpCount: thumbsUpByMovieId.get(row.id) ?? 0,
    loveCount: loveByMovieId.get(row.id) ?? 0,
    likedByMember: (viewerLikeByMovieId.get(row.id) ?? -1) !== -1,
    likenessDegree: viewerLikeByMovieId.get(row.id) ?? null,
    selectedTagIds: tagIdsByMovieId.get(row.id) ?? [],
    tagNamesByType: tagNamesByTypeByMovieId.get(row.id) ?? {},
    hasDiscussionThread: hasDiscussionThreadByMovieId.get(row.id) ?? false,
  }));
}

async function loadMovieDetail(
  familyId: number,
  movieId: number,
  viewerMemberId?: number
): Promise<MovieDetail | null> {
  const movieRows = await db
    .select()
    .from(movie)
    .where(and(eq(movie.familyId, familyId), eq(movie.id, movieId)));

  if (!movieRows || movieRows.length === 0) {
    return null;
  }

  const movieRow = movieRows[0];
  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);

  if (!canViewDraftPost(movieRow.status, movieRow.memberId, viewerMemberId, viewerIsFounder)) {
    return null;
  }

  const [commentRows, likeRows, tagRows, discussionThreads] = await Promise.all([
    db
      .select()
      .from(movieComment)
      .where(eq(movieComment.movieId, movieId))
      .orderBy(asc(movieComment.createdAt)),
    db
      .select({
        memberId: movieLike.memberId,
        likenessDegree: movieLike.likenessDegree,
      })
      .from(movieLike)
      .where(eq(movieLike.movieId, movieId)),
    db
      .select({
        tagId: movieTag.tagId,
        tagName: movieTagReference.tagName,
        tagType: movieTagReference.tagType,
      })
      .from(movieTag)
      .innerJoin(movieTagReference, eq(movieTagReference.id, movieTag.tagId))
      .where(eq(movieTag.movieId, movieId)),
    loadDiscussionThreadSummariesForTargetId(familyId, "movie", movieId),
  ]);

  const commentMemberIds = [...new Set(commentRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const likeMemberIds = [...new Set(likeRows.map((row) => row.memberId).filter((memberId) => Number.isInteger(memberId)))];
  const memberIds = [...new Set([movieRow.memberId, ...commentMemberIds, ...likeMemberIds])];

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

  const submitterLike = likeRows.find((row) => row.memberId === movieRow.memberId) ?? null;
  const audienceLikeRows = likeRows.filter((row) => row.memberId !== movieRow.memberId);
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
  const regularCommentRows = commentRows.filter((row) => !row.ismovieReviewer);

  const viewerLike = viewerMemberId
    ? likeRows.find((row) => row.memberId === viewerMemberId)
    : null;

  const tagIdsByMovieId = new Map<number, number[]>();
  const tagNamesByTypeByMovieId = new Map<number, Partial<Record<MovieTagType, string[]>>>();

  for (const tagRow of tagRows) {
    if (!SUPPORTED_MOVIE_TAG_TYPES.includes(tagRow.tagType as MovieTagType)) {
      continue;
    }

    const existingTagIds = tagIdsByMovieId.get(movieId) ?? [];
    existingTagIds.push(tagRow.tagId);
    tagIdsByMovieId.set(movieId, existingTagIds);

    const tagType = tagRow.tagType as MovieTagType;
    const byType = tagNamesByTypeByMovieId.get(movieId) ?? {};
    const currentNames = byType[tagType] ?? [];
    byType[tagType] = [...currentNames, tagRow.tagName];
    tagNamesByTypeByMovieId.set(movieId, byType);
  }

  const movieComments: MovieComment[] = regularCommentRows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt ?? new Date(),
    commenterName: memberNameById.get(row.memberId ?? 0) ?? `Member #${row.memberId ?? 0}`,
    commentJson: normalizeSerializedTipTapDocument(row.commentJson),
  }));

  return {
    id: movieRow.id,
    movieTitle: movieRow.movieTitle,
    movieImageCredit: movieRow.movieImageCredit,
    movieSiteUrl: movieRow.movieSiteUrl,
    movieSiteBackground: movieRow.movieSiteBackground,
    movieJson: movieRow.movieJson,
    status: movieRow.status,
    movieImageUrl: movieRow.movieImageUrl,
    movieDebutYear: movieRow.movieDebutYear,
    updatedAt: movieRow.updatedAt ?? new Date(),
    memberId: movieRow.memberId,
    familyId: movieRow.familyId,
    submitterName: memberNameById.get(movieRow.memberId) ?? `Member #${movieRow.memberId}`,
    submitterImageUrl: memberImageUrlById.get(movieRow.memberId) ?? null,
    submitterLikenessDegree: submitterLike?.likenessDegree ?? null,
    commentCount: regularCommentRows.length,
    noRatingCount,
    thumbsUpCount,
    loveCount,
    likedByMember: Boolean(viewerLike && viewerLike.likenessDegree !== -1),
    likenessDegree: viewerLike?.likenessDegree ?? null,
    selectedTagIds: tagIdsByMovieId.get(movieId) ?? [],
    tagNamesByType: tagNamesByTypeByMovieId.get(movieId) ?? {},
    noRatingMemberNames,
    thumbsUpMemberNames,
    loveMemberNames,
    movieComments,
    discussionThreads,
    hasDiscussionThread: discussionThreads.length > 0,
  };
}

export async function getMovieById(
  familyId: number,
  movieId: number,
  viewerMemberId?: number
): Promise<{ success: false; message: string } | { success: true; movie: MovieRecord }> {
  const movies = await loadMovies(familyId, viewerMemberId);
  const selectedMovie = movies.find((movieRecord) => movieRecord.id === movieId);

  if (!selectedMovie) {
    return {
      success: false,
      message: `No movie was found for id: ${movieId}`,
    };
  }

  return {
    success: true,
    movie: selectedMovie,
  };
}

export async function getMoviesHomePageData(
  familyId: number,
  memberId: number,
  isAdmin = false
): Promise<MovieHomePageDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;

    const [movies, movieTags, movieTemplates] = await Promise.all([
      loadMovies(familyId, memberId),
      loadMovieTagOptions(),
      loadMovieTemplates(familyId, memberId, {
        includeDraft: false,
        includeGlobal: true,
        ensureGlobalTemplate: canManageGlobalTemplate,
      }),
    ]);

    return {
      success: true,
      movies,
      movieTags,
      movieTemplates,
    };
  } catch (error) {
    logDbQueryError("movies.getMoviesHomePageData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading movie home page data",
    };
  }
}

export async function getMovieTemplateManagementData(
  familyId: number,
  memberId: number,
  isAdmin: boolean,
  isFounder = false
): Promise<MovieTemplateManagementDataReturn> {
  try {
    const canManageGlobalTemplate = isAdmin && familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const templates = await loadMovieTemplateManagementRecords(familyId, memberId, canManageGlobalTemplate, isFounder);

    return {
      success: true,
      templates,
    };
  } catch (error) {
    logDbQueryError("movies.getMovieTemplateManagementData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading movie templates",
    };
  }
}

async function resolveTmdbMovieImage(movieTitle: string, movieDebutYear?: number): Promise<{ imageUrl: string; imageCredit: string } | null> {
  const normalizedTitle = movieTitle.trim();
  if (!normalizedTitle) {
    return null;
  }

  const token =
    process.env.TMDB_READ_ACCESS_TOKEN?.trim() ||
    process.env.TMDB_CLIENT_SECRET?.trim() ||
    process.env.TMDB_CLIENT_ID?.trim() ||
    process.env.TMDB_API_KEY?.trim();

  if (!token) {
    console.debug("[tmdb-movie-search] no TMDB API token configured");
    return null;
  }

  console.debug("[tmdb-movie-search] starting search", { movieTitle: normalizedTitle, movieDebutYear });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  try {
    let searchUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(normalizedTitle)}`;
    if (movieDebutYear && Number.isInteger(movieDebutYear) && movieDebutYear > 1900) {
      searchUrl += `&primary_release_year=${movieDebutYear}`;
    }

    const response = await fetch(searchUrl, { headers });

    if (!response.ok) {
      const errorText = await response.text().catch(() => null);
      console.debug("[tmdb-movie-search] TMDB search request failed", { status: response.status, errorText });
      return null;
    }

    let body = (await response.json()) as {
      results?: Array<{
        title?: string;
        backdrop_path?: string | null;
        poster_path?: string | null;
        release_date?: string;
      }>;
    };

    if ((!body.results || body.results.length === 0) && movieDebutYear) {
      const fallbackUrl = `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(normalizedTitle)}`;
      console.debug("[tmdb-movie-search] no results with year, retrying without primary_release_year");
      const fallbackResponse = await fetch(fallbackUrl, { headers });
      if (fallbackResponse.ok) {
        body = (await fallbackResponse.json()) as typeof body;
      }
    }

    const results = body.results ?? [];
    console.debug("[tmdb-movie-search] results count:", results.length);

    const matchedMovie = results.find((item) => Boolean(item.backdrop_path || item.poster_path));
    if (!matchedMovie) {
      console.debug("[tmdb-movie-search] no movie image (backdrop or poster) found in results");
      return null;
    }

    const imagePath = matchedMovie.backdrop_path || matchedMovie.poster_path!;
    const imageSize = matchedMovie.backdrop_path ? "w780" : "w342";
    const resolvedImageUrl = `https://image.tmdb.org/t/p/${imageSize}${imagePath.startsWith("/") ? imagePath : `/${imagePath}`}`;
    const matchedTitle = matchedMovie.title?.trim() || normalizedTitle;
    const imageCredit = `Title: TMDB (${matchedTitle}) | Source: ${resolvedImageUrl}`;

    console.debug("[tmdb-movie-search] matched movie poster", {
      title: matchedMovie.title,
      release_date: matchedMovie.release_date,
      resolvedImageUrl,
      imageCredit,
    });

    return { imageUrl: resolvedImageUrl, imageCredit };
  } catch (error) {
    console.debug("[tmdb-movie-search] search threw an error", { movieTitle: normalizedTitle, error });
    return null;
  }
}

export async function saveMovie(
  input: SaveMovieInput,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<SaveMovieReturn> {
  const normalizedTitle = input.movieTitle.trim();

  if (!normalizedTitle) {
    return {
      success: false,
      message: "Movie title is required.",
    };
  }

  const sanitizedTagIds = [...new Set(input.selectedTagIds)].filter((tagId) => Number.isInteger(tagId) && tagId > 0);
  const existingMovie = input.id
    ? await db
      .select()
      .from(movie)
      .where(and(eq(movie.id, input.id), eq(movie.familyId, actor.familyId)))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingMovie) {
    return {
      success: false,
      message: `No movie was found for id: ${input.id}`,
    };
  }

  if (existingMovie && existingMovie.memberId !== actor.memberId) {
    if (!actor.isFounder) {
      return {
        success: false,
        message: "Only the member who created this movie can edit it.",
      };
    }

    // Founders can only change status to/from archived
    const isArchiveStatusChange =
      input.status === "archived" || 
      (existingMovie.status === "archived" && input.status === "published");

    if (!isArchiveStatusChange) {
      return {
        success: false,
        message: "Only the member who created this movie can edit it.",
      };
    }

    // For founders doing archive/unarchive, only update status field
    try {
      const [updatedMovie] = await db
        .update(movie)
        .set({ status: input.status })
        .where(eq(movie.id, existingMovie.id))
        .returning();

      if (!updatedMovie) {
        return {
          success: false,
          message: `Failed to archive/unarchive movie with id: ${input.id}`,
        };
      }

      // Load the full updated movie to return
      const movies = await loadMovies(actor.familyId, actor.memberId);
      const fullUpdatedMovie = movies.find((m) => m.id === updatedMovie.id);

      if (!fullUpdatedMovie) {
        return {
          success: false,
          message: `Failed to load updated movie with id: ${input.id}`,
        };
      }

      return {
        success: true,
        movie: fullUpdatedMovie,
        message: updatedMovie.status === "archived" ? "Movie archived." : "Movie unarchived.",
      };
    } catch (error) {
      logDbQueryError("movies.saveMovie.archiveToggle", error, {
        movieId: input.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
        status: input.status,
      });
      return {
        success: false,
        message: "An error occurred while archiving the movie.",
      };
    }
  }

  const templates = await loadMovieTemplates(actor.familyId, actor.memberId, {
    includeDraft: true,
    includeGlobal: true,
    ensureGlobalTemplate: true,
  });

  const selectedTemplate = templates.find((template) => template.id === input.templateId);

  if (!selectedTemplate) {
    return {
      success: false,
      message: "A movie template must be selected.",
    };
  }

  const submitterLikenessDegree = Number(input.submitterLikenessDegree);
  const hasSubmitterLikenessDegree = [1, 2].includes(submitterLikenessDegree);

  const tmdbResult = input.searchTmdbImage
    ? await resolveTmdbMovieImage(normalizedTitle, input.movieDebutYear)
    : null;

  const resolvedMovieImageUrl = tmdbResult?.imageUrl ?? (input.movieImageUrl ?? null);
  const resolvedMovieImageCredit = tmdbResult?.imageCredit ?? input.movieImageCredit;

  console.debug("[tmdb-movie-search] saveMovie invocation", {
    searchTmdbImage: Boolean(input.searchTmdbImage),
    movieTitle: normalizedTitle,
    movieDebutYear: input.movieDebutYear,
    resolvedMovieImageUrl,
    resolvedMovieImageCredit,
  });

  const normalizedMovieJson = input.movieJson?.trim();
  const parsedMovieJson = normalizedMovieJson ? parseSerializedTipTapDocument(normalizedMovieJson) : null;
  const movieJsonToStore = parsedMovieJson?.success
    ? normalizedMovieJson
    : selectedTemplate.templateJson || serializeTipTapDocument(createEmptyTipTapDocument());

  try {
    const movieInsertValues = {
      movieTitle: normalizedTitle,
      movieImageCredit: resolvedMovieImageCredit,
      movieSiteUrl: input.movieSiteUrl ?? null,
      movieSiteBackground: input.movieSiteBackground ?? "#000000",
      movieJson: movieJsonToStore,
      status: input.status,
      movieImageUrl: resolvedMovieImageUrl,
      movieDebutYear: input.movieDebutYear,
      memberId: actor.memberId,
      familyId: actor.familyId,
    };

    const [persistedMovie] = input.id
      ? await db
        .update(movie)
        .set({
          movieTitle: normalizedTitle,
          movieImageCredit: resolvedMovieImageCredit,
          movieSiteUrl: input.movieSiteUrl ?? null,
          movieSiteBackground: input.movieSiteBackground ?? "#000000",
          movieJson: movieJsonToStore,
          status: input.status,
          movieImageUrl: resolvedMovieImageUrl,
          movieDebutYear: input.movieDebutYear,
          updatedAt: new Date(),
        })
        .where(and(eq(movie.id, input.id), eq(movie.familyId, actor.familyId)))
        .returning()
      : await db
        .insert(movie)
        .values(movieInsertValues)
        .returning();

    if (!persistedMovie) {
      return {
        success: false,
        message: "Could not save movie.",
      };
    }

    await db.delete(movieTag).where(eq(movieTag.movieId, persistedMovie.id));

    if (sanitizedTagIds.length > 0) {
      await db.insert(movieTag).values(
        sanitizedTagIds.map((tagId) => ({
          movieId: persistedMovie.id,
          tagId,
        }))
      );
    }

    if (!existingMovie) {
      await db.insert(movieComment).values({
        movieId: persistedMovie.id,
        memberId: actor.memberId,
        commentJson: "",
        ismovieReviewer: true,
      });
    }

    if (hasSubmitterLikenessDegree) {
      await db.delete(movieLike).where(and(eq(movieLike.movieId, persistedMovie.id), eq(movieLike.memberId, actor.memberId)));

      await db.insert(movieLike).values({
        movieId: persistedMovie.id,
        memberId: actor.memberId,
        likenessDegree: submitterLikenessDegree,
        updatedAt: new Date(),
      });
    }

    if (!existingMovie) {
      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: "Movie Theater",
        postName: normalizedTitle,
        postId: persistedMovie.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const movies = await loadMovies(actor.familyId, actor.memberId);
    const savedMovie = movies.find((movieRecord) => movieRecord.id === persistedMovie.id);

    if (!savedMovie) {
      return {
        success: false,
        message: "Movie was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      movie: savedMovie,
      message: input.id ? "Movie updated." : "Movie added.",
    };
  } catch (error) {
    logDbQueryError("movies.saveMovie", error, {
      movieId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: input.status,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving movie",
    };
  }
}

export async function saveMovieTemplate(
  input: SaveMovieTemplateInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin: boolean;
    isFounder?: boolean;
  }
): Promise<SaveMovieTemplateReturn> {
  const canManageGlobalTemplate = actor.isAdmin && actor.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
  const normalizedName = input.templateName.trim();
  const normalizedStatus = input.status.trim().toLowerCase();
  const normalizedJson = input.templateJson.trim();

  if (!normalizedName) {
    return {
      success: false,
      message: "Template name is required.",
    };
  }

  if (!["draft", "published"].includes(normalizedStatus)) {
    return {
      success: false,
      message: "Template status must be draft or published.",
    };
  }

  const jsonResult = parseSerializedTipTapDocument(normalizedJson);

  if (!jsonResult.success) {
    return {
      success: false,
      message: "Template content must be valid TipTap JSON.",
    };
  }

  const existingTemplate = input.id
    ? await db
      .select()
      .from(movieTemplate)
      .where(eq(movieTemplate.id, input.id))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingTemplate) {
    return {
      success: false,
      message: `No movie template was found for id: ${input.id}`,
    };
  }

  if (existingTemplate) {
    const isFamilyGlobalTemplate = existingTemplate.isGlobalTemplate && existingTemplate.familyId === GLOBAL_TEMPLATE_FAMILY_ID;
    const canEditExisting = isFamilyGlobalTemplate
      ? canManageGlobalTemplate && existingTemplate.familyId === GLOBAL_TEMPLATE_FAMILY_ID
      : (existingTemplate.memberId === actor.memberId || Boolean(actor.isFounder)) && existingTemplate.familyId === actor.familyId;

    if (!canEditExisting) {
      return {
        success: false,
        message: "Only the template owner or the family founder can edit this movie template.",
      };
    }
  }

  try {
    const [persistedTemplate] = input.id
      ? await db
        .update(movieTemplate)
        .set({
          templateName: normalizedName,
          status: normalizedStatus,
          templateJson: normalizedJson,
          updatedAt: new Date(),
        })
        .where(eq(movieTemplate.id, input.id))
        .returning()
      : await db
        .insert(movieTemplate)
        .values({
          templateName: normalizedName,
          status: normalizedStatus,
          templateJson: normalizedJson,
          isGlobalTemplate: false,
          memberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

    if (!persistedTemplate) {
      return {
        success: false,
        message: "Could not save movie template.",
      };
    }

    const templates = await loadMovieTemplateManagementRecords(actor.familyId, actor.memberId, canManageGlobalTemplate, Boolean(actor.isFounder));
    const savedTemplate = templates.find((template) => template.id === persistedTemplate.id);

    if (!savedTemplate) {
      return {
        success: false,
        message: "Movie template was saved but could not be reloaded.",
      };
    }

    return {
      success: true,
      template: savedTemplate,
      message: input.id ? "Movie template updated." : "Movie template added.",
    };
  } catch (error) {
    logDbQueryError("movies.saveMovieTemplate", error, {
      templateId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving movie template",
    };
  }
}

export async function deleteMovieTemplate(
  templateId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const existingTemplate = await db
    .select()
    .from(movieTemplate)
    .where(eq(movieTemplate.id, templateId))
    .then((rows) => rows[0] ?? null);

  if (!existingTemplate) {
    return {
      success: false,
      message: `No movie template was found for id: ${templateId}`,
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
    await db.delete(movieTemplate).where(eq(movieTemplate.id, templateId));

    return {
      success: true,
      message: `Template "${existingTemplate.templateName}" deleted.`,
    };
  } catch (error) {
    logDbQueryError("movies.deleteMovieTemplate", error, {
      templateId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting movie template",
    };
  }
}

export async function getMovieDetail(
  familyId: number,
  movieId: number,
  viewerMemberId?: number
): Promise<GetMovieDetailReturn> {
  try {
    const selectedMovie = await loadMovieDetail(familyId, movieId, viewerMemberId);

    if (!selectedMovie) {
      return {
        success: false,
        message: `No movie was found for id: ${movieId}`,
      };
    }

    return {
      success: true,
      movie: selectedMovie,
    };
  } catch (error) {
    logDbQueryError("movies.getMovieDetail", error, { familyId, movieId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error loading movie detail",
    };
  }
}

export async function toggleMovieLike(
  movieId: number,
  likenessDegree: number,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<ToggleMovieLikeReturn> {
  if (![-1, 1, 2].includes(likenessDegree)) {
    return {
      success: false,
      message: "Movie reactions must be thumbs down, thumbs up, or love.",
    };
  }

  const selectedMovie = await loadMovieDetail(actor.familyId, movieId, actor.memberId);

  if (!selectedMovie) {
    return {
      success: false,
      message: `No movie was found for id: ${movieId}`,
    };
  }

  if (selectedMovie.memberId === actor.memberId) {
    return {
      success: false,
      message: "You cannot react to your own movie.",
    };
  }

  try {
    await db.delete(movieLike).where(and(eq(movieLike.movieId, movieId), eq(movieLike.memberId, actor.memberId)));
    await db.insert(movieLike).values({
      movieId,
      memberId: actor.memberId,
      likenessDegree,
      updatedAt: new Date(),
    });

    if (likenessDegree === 1 || likenessDegree === 2) {
      await createFamilyReactionActivityRecord({
        reactionType: likenessDegree === 2 ? "love" : "like",
        featureName: "Movie Theater",
        postName: selectedMovie.movieTitle,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const updatedMovie = await loadMovieDetail(actor.familyId, movieId, actor.memberId);

    if (!updatedMovie) {
      return {
        success: false,
        message: "Movie reaction was saved but the movie could not be reloaded.",
      };
    }

    return {
      success: true,
      movie: updatedMovie,
      message: likenessDegree === -1 ? "Thumbs down saved." : likenessDegree === 1 ? "Thumbs up saved." : "Love saved.",
    };
  } catch (error) {
    logDbQueryError("movies.toggleMovieLike", error, {
      movieId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      likenessDegree,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving movie reaction",
    };
  }
}

export async function addMovieComment(
  input: {
    movieId: number;
    commentText: string;
    clientRequestId?: string;
  },
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<AddMovieCommentReturn> {
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

  if (!parsedComment.success && !normalizedComment) {
    return {
      success: false,
      message: "Comment text is required.",
    };
  }

  const selectedMovie = await loadMovieDetail(actor.familyId, input.movieId, actor.memberId);

  if (!selectedMovie) {
    return {
      success: false,
      message: `No movie was found for id: ${input.movieId}`,
    };
  }

  try {
    const duplicateRequest = input.clientRequestId
      ? await db
        .insert(pwaMutationRequest)
        .values({
          requestKey: input.clientRequestId,
          mutationName: 'movies.addMovieComment',
          entityType: 'movie',
          entityId: input.movieId,
          familyId: actor.familyId,
          memberId: actor.memberId,
        })
        .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
        .returning({ id: pwaMutationRequest.id })
      : [{ id: 0 }];

    if (input.clientRequestId && duplicateRequest.length === 0) {
      const existingUpdatedMovie = await loadMovieDetail(actor.familyId, input.movieId, actor.memberId);

      if (!existingUpdatedMovie) {
        return {
          success: false,
          message: 'Movie comment was already submitted, but the movie could not be reloaded.',
        };
      }

      return {
        success: true,
        movie: existingUpdatedMovie,
        message: 'Comment already synced.',
      };
    }

    await db.insert(movieComment).values({
      movieId: input.movieId,
      memberId: actor.memberId,
      commentJson,
      ismovieReviewer: false,
      createdAt: new Date(),
    });

    await createFamilyActivityRecord({
      actionType: FAMILY_ACTIVITY_ACTION_TYPES.COMMENT_CREATED,
      featureName: "Movie Theater",
      postName: selectedMovie.movieTitle,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });

    const updatedMovie = await loadMovieDetail(actor.familyId, input.movieId, actor.memberId);

    if (!updatedMovie) {
      return {
        success: false,
        message: "Movie comment was saved but the movie could not be reloaded.",
      };
    }

    return {
      success: true,
      movie: updatedMovie,
      message: "Movie comment added.",
    };
  } catch (error) {
    logDbQueryError("movies.addMovieComment", error, {
      movieId: input.movieId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error saving movie comment",
    };
  }
}