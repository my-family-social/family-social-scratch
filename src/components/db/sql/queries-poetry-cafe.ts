import db from '@/components/db/drizzle';
import { and, asc, desc, eq, ilike, inArray, ne } from 'drizzle-orm';
import {
  member,
  discussThread,
  pwaMutationRequest,
  poemComment,
  poem,
  poemCategoryTag,
  poemLike,
  poemVerse,
} from "../schema/family-social-schema-tables";
import { poemCategoryReference, poemCategoryTagReference } from "../schema/global-schema-tables";
import {
  createTextTipTapDocument,
  isTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
  removeUnusedLinesFromEnd,
  serializeTipTapDocument,
} from '../types/poem-term-validation';
import {
  AddPoemCommentReturn,
  GetPoetryHomePoemReturn,
  Poem,
  PoemsReturn,
  PoetryHomePageDataReturn,
  PoetryHomePoem,
  PoemTagOptionsReturn,
  TogglePoemReactionReturn,
  SavePoetryHomePoemInput,
  SavePoetryHomePoemReturn,
  PoemCategoryWithTagsReturn,
  SavePoemCategoryInput,  SavePoemCategoryReturn,
  SavePoemCategoryTagReferenceInput,
  SavePoemCategoryTagReferenceReturn,
  DeletePoemCategoryInput,
  DeletePoemCategoryReturn,
  DeletePoemCategoryTagReferenceInput,
  DeletePoemCategoryTagReferenceReturn,
} from '../types/poem-verses';
import {
  createFamilyActivityRecord,
  createFamilyReactionActivityRecord,
  FAMILY_ACTIVITY_ACTION_TYPES,
} from './queries-family-activity';
import { getActiveClubSessionTargetIds, getFamilyClubs } from './queries-clubs';
import { loadDiscussionThreadSummariesByTargetIds } from './queries-discuss-threads';
import { logDbQueryError } from './db-error-logger';


function createSubmitterName(firstName?: string | null, lastName?: string | null) {
  const names = [firstName, lastName].filter(Boolean);

  if (names.length > 0) {
    return names.join(' ');
  }

  return 'Unknown Member';
}

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
  if (status !== 'draft') {
    return true;
  }

  return ownerMemberId === viewerMemberId || viewerIsFounder;
}

async function loadPoetryHomePoems(
  familyId: number,
  poemIds?: number[],
  viewerMemberId?: number
): Promise<PoetryHomePoem[]> {
  const whereClause = poemIds && poemIds.length > 0
    ? and(eq(poem.familyId, familyId), inArray(poem.id, poemIds))
    : eq(poem.familyId, familyId);

  const poemFactRows = await db
    .select()
    .from(poem)
    .where(whereClause)
    .orderBy(desc(poem.createdAt), asc(poem.poemTitle));

  if (!poemFactRows || poemFactRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visiblePoemRows = poemFactRows.filter((row) => canViewDraftPost(row.status, row.memberId, viewerMemberId, viewerIsFounder));

  if (visiblePoemRows.length === 0) {
    return [];
  }

  const poemFactIds = visiblePoemRows.map((row) => row.id);
  const verseRows = await db
    .select()
    .from(poemVerse)
    .where(inArray(poemVerse.poemId, poemFactIds));

  const verseIds = verseRows.map((row) => row.id);
  const commentRows = verseIds.length > 0
    ? await db
      .select()
      .from(poemComment)
      .where(inArray(poemComment.poemVerseId, verseIds))
      .orderBy(asc(poemComment.createdAt))
    : [];

  const likeRows = await db
    .select({
      poemId: poemLike.poemId,
      memberId: poemLike.memberId,
      reactionType: poemLike.reactionType,
    })
    .from(poemLike)
    .where(inArray(poemLike.poemId, poemFactIds));

  const memberIds = [...new Set([
    ...visiblePoemRows.map((row) => row.memberId),
    ...commentRows.map((row) => row.memberId),
    ...likeRows.map((row) => row.memberId),
  ])];

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

  const factTagRows = await db
    .select()
    .from(poemCategoryTag)
    .where(inArray(poemCategoryTag.poemId, poemFactIds));

  const clubSessionTargetIds = await getActiveClubSessionTargetIds(familyId, 'poem');
  const discussionThreadsByPoemId = await loadDiscussionThreadSummariesByTargetIds(familyId, 'poem', poemFactIds);

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));
  const verseByPoemId = new Map(verseRows.map((row) => [row.poemId, row]));
  const commentsByVerseId = new Map<number, typeof commentRows>();

  for (const commentRow of commentRows) {
    const existingRows = commentsByVerseId.get(commentRow.poemVerseId) ?? [];
    existingRows.push(commentRow);
    commentsByVerseId.set(commentRow.poemVerseId, existingRows);
  }

  const tagIdsByPoemId = new Map<number, number[]>();
  const reactionsByPoemId = new Map<number, { dislikeCount: number; likeCount: number; loveCount: number }>();
  const reactionMemberNamesByPoemId = new Map<number, { dislikeMemberNames: string[]; likeMemberNames: string[]; loveMemberNames: string[] }>();
  const userReactionTypeByPoemId = new Map<number, number>();
  const hasClubSessionByPoemId = new Set(clubSessionTargetIds);

  for (const factTagRow of factTagRows) {
    const existingTagIds = tagIdsByPoemId.get(factTagRow.poemId) ?? [];
    existingTagIds.push(factTagRow.tagReferenceId);
    tagIdsByPoemId.set(factTagRow.poemId, existingTagIds);
  }

  for (const likeRow of likeRows) {
    const currentCounts = reactionsByPoemId.get(likeRow.poemId) ?? {
      dislikeCount: 0,
      likeCount: 0,
      loveCount: 0,
    };
    const reactionMembers = reactionMemberNamesByPoemId.get(likeRow.poemId) ?? {
      dislikeMemberNames: [],
      likeMemberNames: [],
      loveMemberNames: [],
    };
    const memberName = memberNameById.get(likeRow.memberId) ?? `Member #${ likeRow.memberId }`;

    if (likeRow.reactionType === -1) {
      currentCounts.dislikeCount += 1;
      reactionMembers.dislikeMemberNames.push(memberName);
    } else if (likeRow.reactionType === 2) {
      currentCounts.loveCount += 1;
      reactionMembers.loveMemberNames.push(memberName);
    } else {
      currentCounts.likeCount += 1;
      reactionMembers.likeMemberNames.push(memberName);
    }

    reactionsByPoemId.set(likeRow.poemId, currentCounts);
    reactionMemberNamesByPoemId.set(likeRow.poemId, reactionMembers);

    if (viewerMemberId && likeRow.memberId === viewerMemberId) {
      userReactionTypeByPoemId.set(likeRow.poemId, likeRow.reactionType);
    }
  }

  return visiblePoemRows.map((row) => {
    const verseRow = verseByPoemId.get(row.id);
    const verseComments = verseRow ? commentsByVerseId.get(verseRow.id) ?? [] : [];
    const analysisComment = verseComments.find((commentRow) => commentRow.isPoemAnalysis);
    const submissionComments = verseComments.filter((commentRow) => !commentRow.isPoemAnalysis);
    const poemComments = submissionComments.map((commentRow) => {
      return {
        id: commentRow.id,
        createdAt: commentRow.createdAt as Date,
        commenterName: memberNameById.get(commentRow.memberId) ?? `Member #${ commentRow.memberId }`,
        commentJson: normalizeSerializedTipTapDocument(commentRow.commentJson),
      };
    });

    const reactionMembers = reactionMemberNamesByPoemId.get(row.id) ?? {
      dislikeMemberNames: [],
      likeMemberNames: [],
      loveMemberNames: [],
    };

    return {
      id: row.id,
      poemTitle: row.poemTitle,
      poetName: row.poetName,
      poemSource: row.poemSource,
      poemYear: row.poemYear,
      status: row.status,
      createdAt: row.createdAt as Date,
      memberId: row.memberId,
      familyId: row.familyId,
      submitterName: memberNameById.get(row.memberId) ?? `Member #${ row.memberId }`,
      submitterImageUrl: memberImageUrlById.get(row.memberId) ?? null,
      dislikeCount: reactionsByPoemId.get(row.id)?.dislikeCount ?? 0,
      likeCount: reactionsByPoemId.get(row.id)?.likeCount ?? 0,
      loveCount: reactionsByPoemId.get(row.id)?.loveCount ?? 0,
      commentCount: submissionComments.length,
      userReactionType: userReactionTypeByPoemId.get(row.id) ?? null,
      verseJson: verseRow?.verseJson,
      analysisJson: analysisComment?.commentJson,
      selectedTagIds: tagIdsByPoemId.get(row.id) ?? [],
      poemComments,
      discussionThreads: discussionThreadsByPoemId.get(row.id) ?? [],
      hasDiscussionThread: (discussionThreadsByPoemId.get(row.id) ?? []).length > 0,
      hasClubSession: hasClubSessionByPoemId.has(row.id),
      dislikeMemberNames: [...reactionMembers.dislikeMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      likeMemberNames: [...reactionMembers.likeMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      loveMemberNames: [...reactionMembers.loveMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
    };
  });
}

/*-------- findFamilyMember ------------------ */
export async function getAllFamilyPoems(familyId: number)
: Promise<PoemsReturn> {
  const result = await db
    .select()
    .from(poem).orderBy(desc(poem.createdAt), asc(poem.poemTitle))
    .where(eq(poem.familyId, familyId)
    );
  if (!result) {
    return {
      success: false,
      message: "Error accessing poems for familyId: " + familyId,
    };
  };
    
  // console.log('queries-poetry-cafe->getAllFamilyPoems->result.length: ',result.length);
  if (result.length === 0) {
    return {
      success: false,
      message: "No poems found for familyId: " + familyId,
    }; 
  };

  const poems: Poem[] = result.map((row) => ({
    id: row.id,
    poemTitle: row.poemTitle,
    poetName: row.poetName,
    poemSource: row.poemSource,
    poemYear: row.poemYear,
    status: row.status,
    createdAt: row.createdAt as Date,
    memberId: row.memberId,
    familyId: row.familyId,
  }));

  console.log('queries-poetry-cafe->getAllFamilyPoems->poems.length: ',poems.length);

  return {
    success: true,
    poems: poems,
    }
  };

export async function getPoetryHomePageData(familyId: number, memberId?: number)
  : Promise<PoetryHomePageDataReturn> {
  try {
    const [poems, poemTagsResult, clubs] = await Promise.all([
      loadPoetryHomePoems(familyId, undefined, memberId),
      getPoemTagReferences(),
      getFamilyClubs(familyId),
    ]);

    return {
      success: true,
      poems,
      poemTags: poemTagsResult.success ? poemTagsResult.poemTags : [],
      clubs,
    };
  } catch (error) {
    logDbQueryError("poetry.getPoetryHomePageData", error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error loading poetry home page data',
    };
  }
}

export async function getPoemById(
  familyId: number,
  poemId: number,
  memberId?: number
): Promise<GetPoetryHomePoemReturn> {
  try {
    const [foundPoem] = await loadPoetryHomePoems(familyId, [poemId], memberId);

    if (!foundPoem) {
      return { success: false, message: `Poem with id ${ poemId } was not found.` };
    }

    return { success: true, poem: foundPoem };
  } catch (error) {
    logDbQueryError('poetry.getPoemById', error, { familyId, poemId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : `Error loading poem with id ${ poemId }`,
    };
  }
}

export async function getPoemTagReferences()
  : Promise<PoemTagOptionsReturn> {
  const result = await db
    .select({
      id: poemCategoryTagReference.id,
      tagName: poemCategoryTagReference.tagName,
      tagJson: poemCategoryTagReference.tagJson,
      poemCategoryId: poemCategoryTagReference.poemCategoryId,
      categoryName: poemCategoryReference.categoryName,
    })
    .from(poemCategoryTagReference)
    .innerJoin(
      poemCategoryReference,
      eq(poemCategoryTagReference.poemCategoryId, poemCategoryReference.id)
    )
    .orderBy(asc(poemCategoryReference.categoryName), asc(poemCategoryTagReference.tagName));

  if (!result) {
    return {
      success: false,
      message: "Error accessing poem tag references",
    };
  }

  return {
    success: true,
    poemTags: result.map((row) => ({
      id: row.id,
      tagName: row.tagName,
      tagJson: row.tagJson,
      poemCategoryId: row.poemCategoryId,
      categoryName: row.categoryName,
      status: 'active',
      tagType: 'category-tag',
      seqNo: 0,
    })),
  };
}

export async function savePoetryHomePoem(
  input: SavePoetryHomePoemInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin?: boolean;
    isFounder?: boolean;
  }
): Promise<SavePoetryHomePoemReturn> {
  const normalizedTitle = input.poemTitle.trim();
  const normalizedPoetName = input.poetName.trim();
  const normalizedSource = input.poemSource.trim() || 'Unknown';
  const uniqueTagIds = [...new Set(input.selectedTagIds)];
  const parsedVerseJson = parseSerializedTipTapDocument(input.verseJson.trim());
  const parsedAnalysisJson = parseSerializedTipTapDocument(input.analysisJson.trim());

  if (!normalizedTitle) {
    return {
      success: false,
      message: 'Enter a poem name before saving.',
    };
  }

  if (!normalizedPoetName) {
    return {
      success: false,
      message: 'Enter a poet name before saving.',
    };
  }

  if (!Number.isInteger(input.poemYear) || input.poemYear < 1 || input.poemYear > 9999) {
    return {
      success: false,
      message: 'Enter a valid poem year before saving.',
    };
  }

  if (!parsedVerseJson.success) {
    return {
      success: false,
      message: parsedVerseJson.message,
    };
  }

  if (isTipTapDocumentEmpty(parsedVerseJson.content)) {
    return {
      success: false,
      message: 'Enter the poem verse before saving.',
    };
  }

  if (!parsedAnalysisJson.success) {
    return {
      success: false,
      message: parsedAnalysisJson.message,
    };
  }

  if (uniqueTagIds.length === 0) {
    return {
      success: false,
      message: 'Select at least one poem tag before saving.',
    };
  }

  if (uniqueTagIds.length > 0) {
    const validTags = await db
      .select({ id: poemCategoryTagReference.id })
      .from(poemCategoryTagReference)
      .where(inArray(poemCategoryTagReference.id, uniqueTagIds));

    if (validTags.length !== uniqueTagIds.length) {
      return {
        success: false,
        message: 'One or more selected poem tags are invalid.',
      };
    }
  }

  const existingPoem = input.id
    ? await db
      .select()
      .from(poem)
      .where(and(eq(poem.id, input.id), eq(poem.familyId, actor.familyId)))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingPoem) {
    return {
      success: false,
      message: `No poem was found for id: ${ input.id }`,
    };
  }

  if (existingPoem && existingPoem.memberId !== actor.memberId) {
    // Allow founders to archive/unarchive poems, but not edit other fields
    const isFounderModifyingArchiveStatus = actor.isFounder && 
      (input.status === 'archived' || (existingPoem.status === 'archived' && input.status === 'published'));
    
    if (!isFounderModifyingArchiveStatus) {
      return {
        success: false,
        message: 'Only the poem submitter can save changes to this poem.',
      };
    }

    // For founders doing archive/unarchive, only update status field
    try {
      const [updatedPoem] = await db
        .update(poem)
        .set({ status: input.status })
        .where(eq(poem.id, existingPoem.id))
        .returning();

      if (!updatedPoem) {
        return {
          success: false,
          message: `Failed to archive/unarchive poem with id: ${ input.id }`,
        };
      }

      // Load the full updated poem to return
      const poems = await loadPoetryHomePoems(actor.familyId, [updatedPoem.id], actor.memberId);
      const fullUpdatedPoem = poems[0];

      if (!fullUpdatedPoem) {
        return {
          success: false,
          message: `Failed to load updated poem with id: ${ input.id }`,
        };
      }

      return {
        success: true,
        poem: fullUpdatedPoem,
        message: updatedPoem.status === 'archived' ? 'Poem archived.' : 'Poem unarchived.',
      };
    } catch (error) {
      logDbQueryError('poetry.savePoetryHomePoem.archiveToggle', error, {
        poemId: input.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
        status: input.status,
      });
      return {
        success: false,
        message: 'An error occurred while archiving the poem.',
      };
    }
  }

  if (isTipTapDocumentEmpty(parsedAnalysisJson.content)) {
    return {
      success: false,
      message: 'Poem Analysis is required before saving.',
    };
  }

  const existingVerse = existingPoem
    ? await db
      .select()
      .from(poemVerse)
      .where(eq(poemVerse.poemId, existingPoem.id))
      .then((rows) => rows[0] ?? null)
    : null;

  const existingAnalysis = existingVerse
    ? await db
      .select()
      .from(poemComment)
      .where(and(eq(poemComment.poemVerseId, existingVerse.id), eq(poemComment.isPoemAnalysis, true)))
      .then((rows) => rows[0] ?? null)
    : null;

  const existingFactTags = existingPoem
    ? await db
      .select()
      .from(poemCategoryTag)
      .where(eq(poemCategoryTag.poemId, existingPoem.id))
    : [];

  const cleanedVerseContent = removeUnusedLinesFromEnd(parsedVerseJson.content);
  const serializedVerseJson = serializeTipTapDocument(cleanedVerseContent);
  const serializedAnalysisJson = serializeTipTapDocument(parsedAnalysisJson.content);

  const poemPayload = {
    poemTitle: normalizedTitle,
    poetName: normalizedPoetName,
    poemSource: normalizedSource,
    poemYear: input.poemYear,
    status: input.status.trim() || 'draft',
    memberId: existingPoem?.memberId ?? actor.memberId,
    familyId: actor.familyId,
  };
  let savedPoemId: number;
  let createdPoemFactId: number | null = null;
  let createdVerseId: number | null = null;
  let createdAnalysisId: number | null = null;
  let replacedTags = false;

  try {
    const savedPoemFact = existingPoem
      ? await db
        .update(poem)
        .set(poemPayload)
        .where(eq(poem.id, existingPoem.id))
        .returning()
        .then((rows) => rows[0])
      : await db
        .insert(poem)
        .values(poemPayload)
        .returning()
        .then((rows) => rows[0]);

    if (!existingPoem) {
      createdPoemFactId = savedPoemFact.id;
    }

    const savedVerse = existingVerse
      ? await db
        .update(poemVerse)
        .set({ verseJson: serializedVerseJson })
        .where(eq(poemVerse.id, existingVerse.id))
        .returning()
        .then((rows) => rows[0])
      : await db
        .insert(poemVerse)
        .values({
          poemId: savedPoemFact.id,
          verseJson: serializedVerseJson,
        })
        .returning()
        .then((rows) => rows[0]);

    if (!existingVerse) {
      createdVerseId = savedVerse.id;
    }

    if (existingAnalysis) {
      await db
        .update(poemComment)
        .set({ commentJson: serializedAnalysisJson })
        .where(eq(poemComment.id, existingAnalysis.id));
    } else {
      const createdAnalysis = await db
        .insert(poemComment)
        .values({
          poemVerseId: savedVerse.id,
          memberId: savedPoemFact.memberId,
          isPoemAnalysis: true,
          commentJson: serializedAnalysisJson,
        })
        .returning()
        .then((rows) => rows[0]);

      createdAnalysisId = createdAnalysis.id;
    }

    await db
      .delete(poemCategoryTag)
      .where(eq(poemCategoryTag.poemId, savedPoemFact.id));
    replacedTags = true;

    if (uniqueTagIds.length > 0) {
      await db
        .insert(poemCategoryTag)
        .values(uniqueTagIds.map((tagId) => ({
          poemId: savedPoemFact.id,
          tagReferenceId: tagId,
        })));
    }

    if (!existingPoem) {
      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: 'Poetry Nook',
        postName: normalizedTitle,
        postId: savedPoemFact.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    savedPoemId = savedPoemFact.id;
  } catch (error) {
    logDbQueryError('poetry.savePoetryHomePoem', error, {
      poemId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: input.status,
    });
    if (createdPoemFactId) {
      try {
        await db
          .delete(poem)
          .where(eq(poem.id, createdPoemFactId));
      } catch {
        // Best-effort cleanup only.
      }
    } else {
      if (replacedTags && existingPoem) {
        try {
          await db
            .delete(poemCategoryTag)
            .where(eq(poemCategoryTag.poemId, existingPoem.id));

          if (existingFactTags.length > 0) {
            await db
              .insert(poemCategoryTag)
              .values(existingFactTags.map((factTag) => ({
                poemId: existingPoem.id,
                tagReferenceId: factTag.tagReferenceId,
              })));
          }
        } catch {
          // Best-effort cleanup only.
        }
      }

      if (createdAnalysisId) {
        try {
          await db
            .delete(poemComment)
            .where(eq(poemComment.id, createdAnalysisId));
        } catch {
          // Best-effort cleanup only.
        }
      } else if (existingVerse && existingAnalysis) {
        try {
          const currentAnalysis = await db
            .select()
            .from(poemComment)
            .where(and(eq(poemComment.poemVerseId, existingVerse.id), eq(poemComment.isPoemAnalysis, true)))
            .then((rows) => rows[0] ?? null);

          if (!currentAnalysis) {
            await db
              .insert(poemComment)
              .values({
                poemVerseId: existingVerse.id,
                memberId: existingPoem!.memberId,
                isPoemAnalysis: true,
                commentJson: existingAnalysis.commentJson,
              });
          } else {
            await db
              .update(poemComment)
              .set({ commentJson: existingAnalysis.commentJson })
              .where(eq(poemComment.id, currentAnalysis.id));
          }
        } catch {
          // Best-effort cleanup only.
        }
      }

      if (createdVerseId) {
        try {
          await db
            .delete(poemVerse)
            .where(eq(poemVerse.id, createdVerseId));
        } catch {
          // Best-effort cleanup only.
        }
      } else if (existingVerse) {
        try {
          await db
            .update(poemVerse)
            .set({ verseJson: existingVerse.verseJson })
            .where(eq(poemVerse.id, existingVerse.id));
        } catch {
          // Best-effort cleanup only.
        }
      }

      if (existingPoem) {
        try {
          await db
            .update(poem)
            .set({
              poemTitle: existingPoem.poemTitle,
              poetName: existingPoem.poetName,
              poemSource: existingPoem.poemSource,
              poemYear: existingPoem.poemYear,
              status: existingPoem.status,
              memberId: existingPoem.memberId,
              familyId: existingPoem.familyId,
            })
            .where(eq(poem.id, existingPoem.id));
        } catch {
          // Best-effort cleanup only.
        }
      }
    }

    return {
      success: false,
      message: error instanceof Error
        ? `Failed to save poem changes. Best-effort cleanup was attempted: ${ error.message }`
        : 'Failed to save poem changes. Best-effort cleanup was attempted.',
    };
  }

  const [savedPoem] = await loadPoetryHomePoems(actor.familyId, [savedPoemId], actor.memberId);

  if (!savedPoem) {
    return {
      success: false,
      message: 'The poem was saved but could not be reloaded.',
    };
  }

  return {
    success: true,
    poem: savedPoem,
    message: `Poem "${ savedPoem.poemTitle }" saved successfully.`,
  };
}

export async function togglePoemReaction(
  poemId: number,
  reactionType: number,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<TogglePoemReactionReturn> {
  if (![-1, 1, 2].includes(reactionType)) {
    return {
      success: false,
      message: 'Invalid reaction type. Must be -1 (dislike), 1 (like), or 2 (love).',
    };
  }

  const existingPoem = await db
    .select()
    .from(poem)
    .where(and(eq(poem.id, poemId), eq(poem.familyId, actor.familyId)))
    .then((rows) => rows[0] ?? null);

  if (!existingPoem) {
    return {
      success: false,
      message: 'The selected poem could not be found.',
    };
  }

  const existingReaction = await db
    .select({
      id: poemLike.id,
      reactionType: poemLike.reactionType,
    })
    .from(poemLike)
    .where(and(eq(poemLike.poemId, poemId), eq(poemLike.memberId, actor.memberId)))
    .then((rows) => rows[0] ?? null);

  if (existingReaction && existingReaction.reactionType === reactionType) {
    await db
      .delete(poemLike)
      .where(eq(poemLike.id, existingReaction.id));
  } else {
    if (existingReaction) {
      await db
        .update(poemLike)
        .set({ reactionType })
        .where(eq(poemLike.id, existingReaction.id));
    } else {
      await db
        .insert(poemLike)
        .values({
          poemId,
          memberId: actor.memberId,
          reactionType,
        });
    }

    if (reactionType === 1 || reactionType === 2) {
      await createFamilyReactionActivityRecord({
        reactionType: reactionType === 2 ? 'love' : 'like',
        featureName: 'Poetry Nook',
        postName: existingPoem.poemTitle,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }
  }

  const [updatedPoem] = await loadPoetryHomePoems(actor.familyId, [poemId], actor.memberId);

  if (!updatedPoem) {
    return {
      success: false,
      message: 'Reaction was updated but the poem could not be reloaded.',
    };
  }

  const reactionLabel = reactionType === -1 ? 'dislike' : reactionType === 2 ? 'love' : 'like';

  return {
    success: true,
    poem: updatedPoem,
    message: existingReaction && existingReaction.reactionType === reactionType
      ? `You removed your ${ reactionLabel } reaction from "${ updatedPoem.poemTitle }".`
      : `You set a ${ reactionLabel } reaction on "${ updatedPoem.poemTitle }".`,
  };
}

export async function addPoemComment(
  input: {
    poemId: number;
    commentText: string;
    clientRequestId?: string;
  },
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<AddPoemCommentReturn> {
  const normalizedComment = input.commentText.trim();

  const parsedComment = parseSerializedTipTapDocument(normalizedComment);
  const content = parsedComment.success
    ? parsedComment.content
    : createTextTipTapDocument(normalizedComment);
  const commentJson = serializeTipTapDocument(content);

  if (parsedComment.success && isTipTapDocumentEmpty(parsedComment.content)) {
    return {
      success: false,
      message: 'Comment cannot be empty.',
    };
  }

  if (!parsedComment.success && normalizedComment.length < 2) {
    return {
      success: false,
      message: 'Enter at least 2 characters before posting a comment.',
    };
  }

  const existingPoem = await db
    .select()
    .from(poem)
    .where(and(eq(poem.id, input.poemId), eq(poem.familyId, actor.familyId)))
    .then((rows) => rows[0] ?? null);

  if (!existingPoem) {
    return {
      success: false,
      message: 'The selected poem could not be found.',
    };
  }

  const existingVerse = await db
    .select()
    .from(poemVerse)
    .where(eq(poemVerse.poemId, input.poemId))
    .then((rows) => rows[0] ?? null);

  if (!existingVerse) {
    return {
      success: false,
      message: 'The selected poem has no saved verse to comment on yet.',
    };
  }

  const duplicateRequest = input.clientRequestId
    ? await db
      .insert(pwaMutationRequest)
      .values({
        requestKey: input.clientRequestId,
        mutationName: 'poetry.addPoemComment',
        entityType: 'poem',
        entityId: input.poemId,
        familyId: actor.familyId,
        memberId: actor.memberId,
      })
      .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
      .returning({ id: pwaMutationRequest.id })
    : [{ id: 0 }];

  if (input.clientRequestId && duplicateRequest.length === 0) {
    const [existingUpdatedPoem] = await loadPoetryHomePoems(actor.familyId, [input.poemId], actor.memberId);

    if (!existingUpdatedPoem) {
      return {
        success: false,
        message: 'Poem comment was already submitted, but the poem could not be reloaded.',
      };
    }

    return {
      success: true,
      poem: existingUpdatedPoem,
      message: 'Comment already synced.',
    };
  }

  await db
    .insert(poemComment)
    .values({
      poemVerseId: existingVerse.id,
      memberId: actor.memberId,
      isPoemAnalysis: false,
      commentJson,
    });

  await createFamilyActivityRecord({
    actionType: FAMILY_ACTIVITY_ACTION_TYPES.COMMENT_CREATED,
    featureName: 'Poetry Nook',
    postName: existingPoem.poemTitle,
    familyId: actor.familyId,
    memberId: actor.memberId,
  });

  const [updatedPoem] = await loadPoetryHomePoems(actor.familyId, [input.poemId], actor.memberId);

  if (!updatedPoem) {
    return {
      success: false,
      message: 'Comment was saved but the poem could not be reloaded.',
    };
  }

  return {
    success: true,
    poem: updatedPoem,
    message: `Your comment was added to "${ updatedPoem.poemTitle }".`,
  };
}

export async function getPoemCategoryWithTags()
  : Promise<PoemCategoryWithTagsReturn> {
  const categoryRows = await db
    .select()
    .from(poemCategoryReference)
    .orderBy(asc(poemCategoryReference.categoryName));

  const tagRows = await db
    .select()
    .from(poemCategoryTagReference)
    .orderBy(asc(poemCategoryTagReference.poemCategoryId), asc(poemCategoryTagReference.tagName));

  const tagsByCategoryId = new Map<number, typeof tagRows>();

  for (const row of tagRows) {
    const existingTags = tagsByCategoryId.get(row.poemCategoryId) ?? [];
    existingTags.push(row);
    tagsByCategoryId.set(row.poemCategoryId, existingTags);
  }

  return {
    success: true,
    categories: categoryRows.map((row) => ({
      category: {
        id: row.id,
        categoryName: row.categoryName,
        categoryDesc: row.categoryDesc,
        updatedAt: row.updatedAt as Date,
      },
      tags: (tagsByCategoryId.get(row.id) ?? []).map((tagRow) => ({
        id: tagRow.id,
        poemCategoryId: tagRow.poemCategoryId,
        tagName: tagRow.tagName,
        tagJson: tagRow.tagJson,
        updatedAt: tagRow.updatedAt as Date,
      })),
    })),
  };
}

export async function savePoemCategory(input: SavePoemCategoryInput)
  : Promise<SavePoemCategoryReturn> {
  const categoryName = input.categoryName.trim();
  const categoryDesc = input.categoryDesc?.trim() ?? '';

  if (categoryName.length < 2) {
    return {
      success: false,
      message: 'Category name must be at least 2 characters.',
    };
  }

  const duplicateConditions = input.id
    ? and(ilike(poemCategoryReference.categoryName, categoryName), ne(poemCategoryReference.id, input.id))
    : ilike(poemCategoryReference.categoryName, categoryName);

  const [existingCategory] = await db
    .select({ id: poemCategoryReference.id })
    .from(poemCategoryReference)
    .where(duplicateConditions)
    .limit(1);

  if (existingCategory) {
    return {
      success: false,
      message: `A category named "${ categoryName }" already exists.`,
    };
  }

  if (input.id) {
    const [result] = await db
      .update(poemCategoryReference)
      .set({
        categoryName,
        categoryDesc,
        updatedAt: new Date(),
      })
      .where(eq(poemCategoryReference.id, input.id))
      .returning();

    if (!result) {
      return {
        success: false,
        message: `Could not update category id ${ input.id }`,
      };
    }

    return {
      success: true,
      category: {
        id: result.id,
        categoryName: result.categoryName,
        categoryDesc: result.categoryDesc,
        updatedAt: result.updatedAt as Date,
      },
      message: `Updated category "${ result.categoryName }".`,
    };
  }

  const [result] = await db
    .insert(poemCategoryReference)
    .values({
      categoryName,
      categoryDesc,
      updatedAt: new Date(),
    })
    .returning();

  if (!result) {
    return {
      success: false,
      message: 'Could not create category.',
    };
  }

  return {
    success: true,
    category: {
      id: result.id,
      categoryName: result.categoryName,
      categoryDesc: result.categoryDesc,
      updatedAt: result.updatedAt as Date,
    },
    message: `Added category "${ result.categoryName }".`,
  };
}

export async function savePoemCategoryTagReference(input: SavePoemCategoryTagReferenceInput)
  : Promise<SavePoemCategoryTagReferenceReturn> {
  const tagName = input.tagName.trim();

  if (tagName.length < 2) {
    return {
      success: false,
      message: 'Tag name must be at least 2 characters.',
    };
  }

  const [existingCategory] = await db
    .select({ id: poemCategoryReference.id })
    .from(poemCategoryReference)
    .where(eq(poemCategoryReference.id, input.poemCategoryId))
    .limit(1);

  if (!existingCategory) {
    return {
      success: false,
      message: `Category id ${ input.poemCategoryId } was not found.`,
    };
  }

  const parsedTagJson = parseSerializedTipTapDocument(input.tagJson.trim());

  if (!parsedTagJson.success) {
    return {
      success: false,
      message: parsedTagJson.message,
    };
  }

  const duplicateConditions = input.id
    ? and(
      eq(poemCategoryTagReference.poemCategoryId, input.poemCategoryId),
      ilike(poemCategoryTagReference.tagName, tagName),
      ne(poemCategoryTagReference.id, input.id)
    )
    : and(
      eq(poemCategoryTagReference.poemCategoryId, input.poemCategoryId),
      ilike(poemCategoryTagReference.tagName, tagName)
    );

  const [existingTag] = await db
    .select({ id: poemCategoryTagReference.id })
    .from(poemCategoryTagReference)
    .where(duplicateConditions)
    .limit(1);

  if (existingTag) {
    return {
      success: false,
      message: `A tag named "${ tagName }" already exists in this category.`,
    };
  }

  const tagPayload = {
    poemCategoryId: input.poemCategoryId,
    tagName,
    tagJson: serializeTipTapDocument(parsedTagJson.content),
    updatedAt: new Date(),
  };

  if (input.id) {
    const [result] = await db
      .update(poemCategoryTagReference)
      .set(tagPayload)
      .where(eq(poemCategoryTagReference.id, input.id))
      .returning();

    if (!result) {
      return {
        success: false,
        message: `Could not update tag id ${ input.id }`,
      };
    }

    return {
      success: true,
      tag: {
        id: result.id,
        poemCategoryId: result.poemCategoryId,
        tagName: result.tagName,
        tagJson: result.tagJson,
        updatedAt: result.updatedAt as Date,
      },
      message: `Updated tag "${ result.tagName }".`,
    };
  }

  const [result] = await db
    .insert(poemCategoryTagReference)
    .values(tagPayload)
    .returning();

  if (!result) {
    return {
      success: false,
      message: 'Could not create tag.',
    };
  }

  return {
    success: true,
    tag: {
      id: result.id,
      poemCategoryId: result.poemCategoryId,
      tagName: result.tagName,
      tagJson: result.tagJson,
      updatedAt: result.updatedAt as Date,
    },
    message: `Added tag "${ result.tagName }".`,
  };
}

export async function deletePoemCategoryTagReference(
  input: DeletePoemCategoryTagReferenceInput
): Promise<DeletePoemCategoryTagReferenceReturn> {
  const [existingTag] = await db
    .select({
      id: poemCategoryTagReference.id,
      tagName: poemCategoryTagReference.tagName,
    })
    .from(poemCategoryTagReference)
    .where(eq(poemCategoryTagReference.id, input.id))
    .limit(1);

  if (!existingTag) {
    return {
      success: false,
      message: `Tag id ${ input.id } was not found.`,
    };
  }

  const [deletedTag] = await db
    .delete(poemCategoryTagReference)
    .where(eq(poemCategoryTagReference.id, input.id))
    .returning({
      id: poemCategoryTagReference.id,
    });

  if (!deletedTag) {
    return {
      success: false,
      message: `Could not delete tag id ${ input.id }.`,
    };
  }

  return {
    success: true,
    message: `Deleted tag "${ existingTag.tagName }".`,
  };
}

export async function deletePoemCategory(
  input: DeletePoemCategoryInput
): Promise<DeletePoemCategoryReturn> {
  const [existingCategory] = await db
    .select({
      id: poemCategoryReference.id,
      categoryName: poemCategoryReference.categoryName,
    })
    .from(poemCategoryReference)
    .where(eq(poemCategoryReference.id, input.id))
    .limit(1);

  if (!existingCategory) {
    return {
      success: false,
      message: `Category id ${ input.id } was not found.`,
    };
  }

  const [deletedCategory] = await db
    .delete(poemCategoryReference)
    .where(eq(poemCategoryReference.id, input.id))
    .returning({
      id: poemCategoryReference.id,
    });

  if (!deletedCategory) {
    return {
      success: false,
      message: `Could not delete category id ${ input.id }.`,
    };
  }

  return {
    success: true,
    message: `Deleted category "${ existingCategory.categoryName }".`,
  };
}

export async function deletePoem(
  poemId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const permissionCheck = actor.isFounder
    ? and(eq(poem.id, poemId), eq(poem.familyId, actor.familyId))
    : and(eq(poem.id, poemId), eq(poem.familyId, actor.familyId), eq(poem.memberId, actor.memberId));

  const existingPoem = await db
    .select({ id: poem.id })
    .from(poem)
    .where(permissionCheck)
    .then((rows) => rows[0] ?? null);

  if (!existingPoem) {
    return {
      success: false,
      message: `No poem was found for id: ${poemId}`,
    };
  }

  try {
    await db
      .delete(discussThread)
      .where(and(eq(discussThread.targetType, "poem"), eq(discussThread.targetId, poemId), eq(discussThread.familyId, actor.familyId)));

    await db
      .delete(poemCategoryTag)
      .where(eq(poemCategoryTag.poemId, poemId));

    await db
      .delete(poemVerse)
      .where(eq(poemVerse.poemId, poemId));

    await db
      .delete(poem)
      .where(permissionCheck);

    return {
      success: true,
      message: "Poem deleted.",
    };
  } catch (error) {
    logDbQueryError('poetry.deletePoem', error, {
      poemId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isFounder: actor.isFounder ?? false,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting poem",
    };
  }
}
