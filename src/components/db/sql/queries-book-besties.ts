import db from '@/components/db/drizzle';
import { and, asc, desc, eq, ilike, inArray, ne } from 'drizzle-orm';
import { member, bookComment, book, bookCategoryTag as bookTag, bookLike, discussThread, pwaMutationRequest } from "../schema/family-social-schema-tables";
import { bookCategoryTagReference as bookTagReference, bookCategoryReference, bookCategoryTagReference } from "../schema/global-schema-tables";
import {
  AddBookCommentReturn,
  Book,
  BookCategoryWithTagsReturn,
  DeleteBookCategoryInput,
  DeleteBookCategoryReturn,
  DeleteBookCategoryTagReferenceInput,
  DeleteBookCategoryTagReferenceReturn,
  BookTagOptionsReturn,
  BooksHomeBook,
  BooksHomePageDataReturn,
  BooksReturn,
  SaveBookCategoryInput,
  SaveBookCategoryReturn,
  SaveBookCategoryTagReferenceInput,
  SaveBookCategoryTagReferenceReturn,
  SaveBooksHomeBookInput,
  SaveBooksHomeBookReturn,
  ToggleBookReactionReturn,
} from '@/components/db/types/books';
import {
  createTextTipTapDocument,
  isTipTapDocumentEmpty,
  normalizeSerializedTipTapDocument,
  parseSerializedTipTapDocument,
  serializeTipTapDocument,
} from '../types/poem-term-validation';
import {
  createFamilyActivityRecord,
  createFamilyReactionActivityRecord,
  FAMILY_ACTIVITY_ACTION_TYPES,
} from './queries-family-activity';
import { getActiveClubSessionTargetIds, getFamilyClubs } from './queries-clubs';
import { loadDiscussionThreadSummariesByTargetIds } from './queries-discuss-threads';
import { logDbQueryError } from './db-error-logger';
import { BOOK_SOURCE_OPTIONS } from '@/features/books/types/constants';

const BOOK_SOURCE_VALUES = new Set(BOOK_SOURCE_OPTIONS.map(({ value }) => value));

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

async function loadBooksHomeBooks(
  familyId: number,
  bookIds?: number[],
  viewerMemberId?: number
): Promise<BooksHomeBook[]> {
  const whereClause = bookIds && bookIds.length > 0
    ? and(eq(book.familyId, familyId), inArray(book.id, bookIds))
    : eq(book.familyId, familyId);

  const bookRows = await db
    .select()
    .from(book)
    .where(whereClause)
    .orderBy(desc(book.createdAt), asc(book.bookTitle));

  if (!bookRows || bookRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visibleBookRows = bookRows.filter((row) => canViewDraftPost(row.status, row.memberId, viewerMemberId, viewerIsFounder));

  if (visibleBookRows.length === 0) {
    return [];
  }

  const bookIdsToLoad = visibleBookRows.map((row) => row.id);
  const commentRows = await db
    .select({
      id: bookComment.id,
      createdAt: bookComment.createdAt,
      commentJson: bookComment.commentJson,
      isBookAnalysis: bookComment.isBookAnalysis,
      bookId: bookComment.bookId,
      memberId: bookComment.memberId,
    })
    .from(bookComment)
    .where(inArray(bookComment.bookId, bookIdsToLoad))
    .orderBy(asc(bookComment.createdAt));

  const likeRows = await db
    .select({
      bookId: bookLike.bookId,
      memberId: bookLike.memberId,
      reactionType: bookLike.reactionType,
    })
    .from(bookLike)
    .where(inArray(bookLike.bookId, bookIdsToLoad));

  const memberIds = [...new Set([
    ...visibleBookRows.map((row) => row.memberId),
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
    .from(bookTag)
    .where(inArray(bookTag.bookId, bookIdsToLoad));

  const clubSessionTargetIds = await getActiveClubSessionTargetIds(familyId, 'book');
  const discussionThreadsByBookId = await loadDiscussionThreadSummariesByTargetIds(familyId, 'book', bookIdsToLoad);

  const memberNameById = new Map(
    memberRows.map((row) => [row.id, createSubmitterName(row.firstName, row.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((row) => [row.id, row.memberImageUrl]));
  const commentsByBookId = new Map<number, typeof commentRows>();

  for (const commentRow of commentRows) {
    const existingRows = commentsByBookId.get(commentRow.bookId) ?? [];
    existingRows.push(commentRow);
    commentsByBookId.set(commentRow.bookId, existingRows);
  }

  const tagIdsByBookId = new Map<number, number[]>();
  const reactionsByBookId = new Map<number, { dislikeCount: number; likeCount: number; loveCount: number }>();
  const reactionMemberNamesByBookId = new Map<number, { dislikeMemberNames: string[]; likeMemberNames: string[]; loveMemberNames: string[] }>();
  const userReactionTypeByBookId = new Map<number, number>();
  const submitterMemberIdByBookId = new Map(visibleBookRows.map((row) => [row.id, row.memberId]));
  const hasClubSessionByBookId = new Set(clubSessionTargetIds);

  for (const factTagRow of factTagRows) {
    const existingTagIds = tagIdsByBookId.get(factTagRow.bookId) ?? [];
    existingTagIds.push(factTagRow.tagReferenceId);
    tagIdsByBookId.set(factTagRow.bookId, existingTagIds);
  }

  for (const likeRow of likeRows) {
    const submitterMemberId = submitterMemberIdByBookId.get(likeRow.bookId);

    if (submitterMemberId !== likeRow.memberId) {
      const currentCounts = reactionsByBookId.get(likeRow.bookId) ?? {
        dislikeCount: 0,
        likeCount: 0,
        loveCount: 0,
      };
      const reactionMembers = reactionMemberNamesByBookId.get(likeRow.bookId) ?? {
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

      reactionsByBookId.set(likeRow.bookId, currentCounts);
      reactionMemberNamesByBookId.set(likeRow.bookId, reactionMembers);
    }

    if (viewerMemberId && likeRow.memberId === viewerMemberId) {
      userReactionTypeByBookId.set(likeRow.bookId, likeRow.reactionType);
    }
  }

  return visibleBookRows.map((row) => {
    const bookCommentsForBook = commentsByBookId.get(row.id) ?? [];
    const analysisComment = bookCommentsForBook.find((commentRow) => commentRow.isBookAnalysis);
    const submissionComments = bookCommentsForBook.filter((commentRow) => !commentRow.isBookAnalysis);
    const bookComments = submissionComments.map((commentRow) => {
      return {
        id: commentRow.id,
        createdAt: commentRow.createdAt as Date,
        commenterName: memberNameById.get(commentRow.memberId) ?? `Member #${ commentRow.memberId }`,
        commentJson: normalizeSerializedTipTapDocument(commentRow.commentJson),
      };
    });

    const reactionMembers = reactionMemberNamesByBookId.get(row.id) ?? {
      dislikeMemberNames: [],
      likeMemberNames: [],
      loveMemberNames: [],
    };

    return {
      id: row.id,
      bookTitle: row.bookTitle,
      authorName: row.authorName,
      bookLanguage: row.bookLanguage,
      bookSource: row.bookSource,
      bookSeriesName: row.bookSeriesName,
      bookYear: row.bookYear,
      status: row.status,
      createdAt: row.createdAt as Date,
      memberId: row.memberId,
      familyId: row.familyId,
      submitterName: memberNameById.get(row.memberId) ?? `Member #${ row.memberId }`,
      submitterImageUrl: memberImageUrlById.get(row.memberId) ?? null,
      dislikeCount: reactionsByBookId.get(row.id)?.dislikeCount ?? 0,
      likeCount: reactionsByBookId.get(row.id)?.likeCount ?? 0,
      loveCount: reactionsByBookId.get(row.id)?.loveCount ?? 0,
      commentCount: bookComments.length,
      userReactionType: userReactionTypeByBookId.get(row.id) ?? null,
      analysisJson: analysisComment?.commentJson,
      selectedTagIds: tagIdsByBookId.get(row.id) ?? [],
      bookComments,
      discussionThreads: discussionThreadsByBookId.get(row.id) ?? [],
      hasDiscussionThread: (discussionThreadsByBookId.get(row.id) ?? []).length > 0,
      hasClubSession: hasClubSessionByBookId.has(row.id),
      dislikeMemberNames: [...reactionMembers.dislikeMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      likeMemberNames: [...reactionMembers.likeMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      loveMemberNames: [...reactionMembers.loveMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
    };
  });
}

export async function getBooksHomePageData(familyId: number, memberId?: number)
  : Promise<BooksHomePageDataReturn> {
  try {
    const [books, bookTagsResult, clubs] = await Promise.all([
      loadBooksHomeBooks(familyId, undefined, memberId),
      getBookTagReferences(),
      getFamilyClubs(familyId),
    ]);

    return {
      success: true,
      books,
      bookTags: bookTagsResult.success ? bookTagsResult.bookTags : [],
      clubs,
    };
  } catch (error) {
    logDbQueryError('books.getBooksHomePageData', error, { familyId, memberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Error loading book besties home page data',
    };
  }
}

export async function getBookTagReferences()
  : Promise<BookTagOptionsReturn> {
  const result = await db
    .select({
      id: bookTagReference.id,
      tagName: bookTagReference.tagName,
      tagJson: bookTagReference.tagJson,
      bookCategoryId: bookTagReference.bookCategoryId,
      categoryName: bookCategoryReference.categoryName,
    })
    .from(bookTagReference)
    .innerJoin(
      bookCategoryReference,
      eq(bookTagReference.bookCategoryId, bookCategoryReference.id)
    )
    .orderBy(asc(bookCategoryReference.categoryName), asc(bookTagReference.tagName));

  if (!result) {
    return {
      success: false,
      message: 'Error accessing book tag references',
    };
  }

  return {
    success: true,
    bookTags: result.map((row) => ({
      id: row.id,
      tagName: row.tagName,
      tagJson: row.tagJson,
      bookCategoryId: row.bookCategoryId,
      categoryName: row.categoryName,
      status: 'active',
      tagType: 'category-tag',
      seqNo: 0,
    })),
  };
}

export async function saveBooksHomeBook(
  input: SaveBooksHomeBookInput,
  actor: {
    familyId: number;
    memberId: number;
    isAdmin?: boolean;
    isFounder?: boolean;
  }
): Promise<SaveBooksHomeBookReturn> {
  const normalizedTitle = input.bookTitle.trim();
  const normalizedAuthorName = input.authorName.trim();
  const normalizedLanguage = input.bookLanguage.trim() || 'English';
  const normalizedSource = input.bookSource.trim().toLowerCase() || 'bookstore';
  const normalizedSeriesName = (input.bookSeriesName ?? '').trim();
  const uniqueTagIds = [...new Set(input.selectedTagIds)];
  const parsedAnalysisJson = parseSerializedTipTapDocument(input.analysisJson.trim());

  if (!normalizedTitle) {
    return {
      success: false,
      message: 'Enter a book name before saving.',
    };
  }

  if (!normalizedAuthorName) {
    return {
      success: false,
      message: 'Enter an author name before saving.',
    };
  }

  if (!BOOK_SOURCE_VALUES.has(normalizedSource)) {
    return {
      success: false,
      message: 'Select a valid book source before saving.',
    };
  }

  if (!Number.isInteger(input.bookYear) || input.bookYear < 1 || input.bookYear > 9999) {
    return {
      success: false,
      message: 'Enter a valid book year before saving.',
    };
  }

  if (normalizedSeriesName && normalizedSeriesName.length < 5) {
    return {
      success: false,
      message: 'Book Series Name must be at least 5 characters when provided.',
    };
  }

  if (!parsedAnalysisJson.success) {
    return {
      success: false,
      message: parsedAnalysisJson.message,
    };
  }

  if (uniqueTagIds.length < 1) {
    return {
      success: false,
      message: 'Select at least one book tag before saving.',
    };
  }

  if (uniqueTagIds.length > 0) {
    const validTags = await db
      .select({ id: bookTagReference.id })
      .from(bookTagReference)
      .where(inArray(bookTagReference.id, uniqueTagIds));

    if (validTags.length !== uniqueTagIds.length) {
      return {
        success: false,
        message: 'One or more selected book tags are invalid.',
      };
    }
  }

  const existingBook = input.id
    ? await db
      .select()
      .from(book)
      .where(and(eq(book.id, input.id), eq(book.familyId, actor.familyId)))
      .then((rows) => rows[0] ?? null)
    : null;

  if (input.id && !existingBook) {
    return {
      success: false,
      message: `No book was found for id: ${ input.id }`,
    };
  }

  if (existingBook && existingBook.memberId !== actor.memberId) {
    // Allow founders to archive/unarchive books ONLY
    if (!actor.isFounder) {
      return {
        success: false,
        message: 'Only the book submitter can save changes to this book.',
      };
    }

    // Founders can only change status to/from archived
    const isArchiveStatusChange =
      input.status === 'archived' || 
      (existingBook.status === 'archived' && input.status === 'published');

    if (!isArchiveStatusChange) {
      return {
        success: false,
        message: 'Only the book submitter can save changes to this book.',
      };
    }

    // For founders doing archive/unarchive, only update status field
    try {
      const [updatedBook] = await db
        .update(book)
        .set({ status: input.status })
        .where(eq(book.id, existingBook.id))
        .returning();

      if (!updatedBook) {
        return {
          success: false,
          message: `Failed to archive/unarchive book with id: ${ input.id }`,
        };
      }

      // Load the full updated book to return
      const fullUpdatedBooks = await loadBooksHomeBooks(actor.familyId, [updatedBook.id], actor.memberId);
      const fullUpdatedBook = fullUpdatedBooks[0];

      if (!fullUpdatedBook) {
        return {
          success: false,
          message: `Failed to load updated book with id: ${ input.id }`,
        };
      }

      return {
        success: true,
        book: fullUpdatedBook,
        message: updatedBook.status === 'archived' ? 'Book archived.' : 'Book unarchived.',
      };
    } catch (error) {
      logDbQueryError('books.saveBooksHomeBook.archiveToggle', error, {
        bookId: input.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
        status: input.status,
      });
      return {
        success: false,
        message: 'An error occurred while archiving the book.',
      };
    }
  }

  if (isTipTapDocumentEmpty(parsedAnalysisJson.content)) {
    return {
      success: false,
      message: 'Book Analysis is required before saving.',
    };
  }

  const existingAnalysis = existingBook
    ? await db
      .select()
      .from(bookComment)
      .where(and(eq(bookComment.bookId, existingBook.id), eq(bookComment.isBookAnalysis, true)))
      .then((rows) => rows[0] ?? null)
    : null;

  const existingFactTags = existingBook
    ? await db
      .select()
      .from(bookTag)
      .where(eq(bookTag.bookId, existingBook.id))
    : [];

  const serializedAnalysisJson = serializeTipTapDocument(parsedAnalysisJson.content);

  const bookPayload = {
    bookTitle: normalizedTitle,
    authorName: normalizedAuthorName,
    bookLanguage: normalizedLanguage,
    bookSource: normalizedSource,
    bookSeriesName: normalizedSeriesName || null,
    bookYear: input.bookYear,
    status: input.status.trim() || 'draft',
    memberId: existingBook?.memberId ?? actor.memberId,
    familyId: actor.familyId,
  };
  let savedBookId: number;
  let createdBookFactId: number | null = null;
  let createdAnalysisId: number | null = null;
  let replacedTags = false;

  try {
    const savedBookFact = existingBook
      ? await db
        .update(book)
        .set(bookPayload)
        .where(eq(book.id, existingBook.id))
        .returning()
        .then((rows) => rows[0])
      : await db
        .insert(book)
        .values(bookPayload)
        .returning()
        .then((rows) => rows[0]);

    if (!existingBook) {
      createdBookFactId = savedBookFact.id;
    }

    if (existingAnalysis) {
      await db
        .update(bookComment)
        .set({ commentJson: serializedAnalysisJson })
        .where(eq(bookComment.id, existingAnalysis.id));
    } else {
      const createdAnalysis = await db
        .insert(bookComment)
        .values({
          bookId: savedBookFact.id,
          memberId: savedBookFact.memberId,
          isBookAnalysis: true,
          commentJson: serializedAnalysisJson,
        })
        .returning()
        .then((rows) => rows[0]);

      createdAnalysisId = createdAnalysis.id;
    }

    await db
      .delete(bookTag)
      .where(eq(bookTag.bookId, savedBookFact.id));
    replacedTags = true;

    if (uniqueTagIds.length > 0) {
      await db
        .insert(bookTag)
        .values(uniqueTagIds.map((tagId) => ({
          bookId: savedBookFact.id,
          tagReferenceId: tagId,
        })));
    }

    if (!existingBook) {
      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: 'Reading Room',
        postName: normalizedTitle,
        postId: savedBookFact.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    savedBookId = savedBookFact.id;
  } catch (error) {
    logDbQueryError('books.saveBooksHomeBook', error, {
      inputId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: input.status,
    });
    if (createdBookFactId) {
      try {
        await db
          .delete(book)
          .where(eq(book.id, createdBookFactId));
      } catch {
        // Best-effort cleanup only.
      }
    } else {
      if (replacedTags && existingBook) {
        try {
          await db
            .delete(bookTag)
            .where(eq(bookTag.bookId, existingBook.id));

          if (existingFactTags.length > 0) {
            await db
              .insert(bookTag)
              .values(existingFactTags.map((factTag) => ({
                bookId: existingBook.id,
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
            .delete(bookComment)
            .where(eq(bookComment.id, createdAnalysisId));
        } catch {
          // Best-effort cleanup only.
        }
      } else if (existingAnalysis) {
        try {
          const currentAnalysis = await db
            .select()
            .from(bookComment)
            .where(and(eq(bookComment.bookId, existingBook!.id), eq(bookComment.isBookAnalysis, true)))
            .then((rows) => rows[0] ?? null);

          if (!currentAnalysis) {
            await db
              .insert(bookComment)
              .values({
                bookId: existingBook!.id,
                memberId: existingBook!.memberId,
                isBookAnalysis: true,
                commentJson: existingAnalysis.commentJson,
              });
          } else {
            await db
              .update(bookComment)
              .set({ commentJson: existingAnalysis.commentJson })
              .where(eq(bookComment.id, currentAnalysis.id));
          }
        } catch {
          // Best-effort cleanup only.
        }
      }

      if (existingBook) {
        try {
          await db
            .update(book)
            .set({
              bookTitle: existingBook.bookTitle,
              authorName: existingBook.authorName,
              bookLanguage: existingBook.bookLanguage,
              bookSource: existingBook.bookSource,
              bookSeriesName: existingBook.bookSeriesName,
              bookYear: existingBook.bookYear,
              status: existingBook.status,
              memberId: existingBook.memberId,
              familyId: existingBook.familyId,
            })
            .where(eq(book.id, existingBook.id));
        } catch {
          // Best-effort cleanup only.
        }
      }
    }

    return {
      success: false,
      message: error instanceof Error
        ? `Failed to save book changes. Best-effort cleanup was attempted: ${ error.message }`
        : 'Failed to save book changes. Best-effort cleanup was attempted.',
    };
  }

  const [savedBook] = await loadBooksHomeBooks(actor.familyId, [savedBookId], actor.memberId);

  if (!savedBook) {
    return {
      success: false,
      message: 'The book was saved but could not be reloaded.',
    };
  }

  return {
    success: true,
    book: savedBook,
    message: `Book "${ savedBook.bookTitle }" saved successfully.`,
  };
}

export async function toggleBookReaction(
  bookId: number,
  reactionType: number,
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<ToggleBookReactionReturn> {
  if (![-1, 1, 2].includes(reactionType)) {
    return {
      success: false,
      message: 'Invalid reaction type. Must be -1 (dislike), 1 (like), or 2 (love).',
    };
  }

  const existingBook = await db
    .select()
    .from(book)
    .where(and(eq(book.id, bookId), eq(book.familyId, actor.familyId)))
    .then((rows) => rows[0] ?? null);

  if (!existingBook) {
    return {
      success: false,
      message: 'The selected book could not be found.',
    };
  }

  const existingReaction = await db
    .select({
      id: bookLike.id,
      reactionType: bookLike.reactionType,
    })
    .from(bookLike)
    .where(and(eq(bookLike.bookId, bookId), eq(bookLike.memberId, actor.memberId)))
    .then((rows) => rows[0] ?? null);

  if (existingReaction && existingReaction.reactionType === reactionType) {
    await db
      .delete(bookLike)
      .where(eq(bookLike.id, existingReaction.id));
  } else {
    if (existingReaction) {
      await db
        .update(bookLike)
        .set({ reactionType })
        .where(eq(bookLike.id, existingReaction.id));
    } else {
      await db
        .insert(bookLike)
        .values({
          bookId,
          memberId: actor.memberId,
          reactionType,
        });
    }

    if (reactionType === 1 || reactionType === 2) {
      await createFamilyReactionActivityRecord({
        reactionType: reactionType === 2 ? 'love' : 'like',
        featureName: 'Reading Room',
        postName: existingBook.bookTitle,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }
  }

  const [updatedBook] = await loadBooksHomeBooks(actor.familyId, [bookId], actor.memberId);

  if (!updatedBook) {
    return {
      success: false,
      message: 'Reaction was updated but the book could not be reloaded.',
    };
  }

  const reactionLabel = reactionType === -1 ? 'dislike' : reactionType === 2 ? 'love' : 'like';

  return {
    success: true,
    book: updatedBook,
    message: existingReaction && existingReaction.reactionType === reactionType
      ? `You removed your ${ reactionLabel } reaction from "${ updatedBook.bookTitle }".`
      : `You set a ${ reactionLabel } reaction on "${ updatedBook.bookTitle }".`,
  };
}

export async function addBookComment(
  input: {
    bookId: number;
    commentText: string;
    clientRequestId?: string;
  },
  actor: {
    familyId: number;
    memberId: number;
  }
): Promise<AddBookCommentReturn> {
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

  const existingBook = await db
    .select()
    .from(book)
    .where(and(eq(book.id, input.bookId), eq(book.familyId, actor.familyId)))
    .then((rows) => rows[0] ?? null);

  if (!existingBook) {
    return {
      success: false,
      message: 'The selected book could not be found.',
    };
  }

  const duplicateRequest = input.clientRequestId
    ? await db
      .insert(pwaMutationRequest)
      .values({
        requestKey: input.clientRequestId,
        mutationName: 'books.addBookComment',
        entityType: 'book',
        entityId: input.bookId,
        familyId: actor.familyId,
        memberId: actor.memberId,
      })
      .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
      .returning({ id: pwaMutationRequest.id })
    : [{ id: 0 }];

  if (input.clientRequestId && duplicateRequest.length === 0) {
    const [existingUpdatedBook] = await loadBooksHomeBooks(actor.familyId, [input.bookId], actor.memberId);

    if (!existingUpdatedBook) {
      return {
        success: false,
        message: 'Book comment was already submitted, but the book could not be reloaded.',
      };
    }

    return {
      success: true,
      book: existingUpdatedBook,
      message: 'Comment already synced.',
    };
  }

  await db
    .insert(bookComment)
    .values({
      bookId: input.bookId,
      memberId: actor.memberId,
      isBookAnalysis: false,
      commentJson,
    });

  await createFamilyActivityRecord({
    actionType: FAMILY_ACTIVITY_ACTION_TYPES.COMMENT_CREATED,
    featureName: 'Reading Room',
    postName: existingBook.bookTitle,
    familyId: actor.familyId,
    memberId: actor.memberId,
  });

  const [updatedBook] = await loadBooksHomeBooks(actor.familyId, [input.bookId], actor.memberId);

  if (!updatedBook) {
    return {
      success: false,
      message: 'Comment was saved but the book could not be reloaded.',
    };
  }

  return {
    success: true,
    book: updatedBook,
    message: `Your comment was added to "${ updatedBook.bookTitle }".`,
  };
}

/*-------- findFamilyMember ------------------ */
export async function getAllFamilyBooks(familyId: number)
: Promise<BooksReturn> {
  const result = await db
    .select()
    .from(book).orderBy(desc(book.createdAt), asc(book.bookTitle))
    .where(eq(book.familyId, familyId)
    );
  if (!result) {
    return {
      success: false,
      message: "Error accessing books for familyId: " + familyId,
    };
  };
    
  // console.log('queries-book-besties->getAllFamilyBooks->result.length: ',result.length);
  if (result.length === 0) {
    return {
      success: false,
      message: "No books found for familyId: " + familyId,
    }; 
  };

  const books: Book[] = result.map((row) => ({
    id: row.id,
    bookTitle: row.bookTitle,
    authorName: row.authorName,
    bookLanguage: row.bookLanguage,
    bookSource: row.bookSource,
    bookSeriesName: row.bookSeriesName,
    bookYear: row.bookYear,
    status: row.status,
    createdAt: row.createdAt as Date,
    memberId: row.memberId,
    familyId: row.familyId,
  }));

  console.log('queries-book-besties->getAllFamilyBooks->books.length: ',books.length);

  return {
    success: true,
    books: books,
    }
  };

export async function getBookCategoryWithTags()
  : Promise<BookCategoryWithTagsReturn> {
  const categoryRows = await db
    .select()
    .from(bookCategoryReference)
    .orderBy(asc(bookCategoryReference.categoryName));

  const tagRows = await db
    .select()
    .from(bookCategoryTagReference)
    .orderBy(asc(bookCategoryTagReference.bookCategoryId), asc(bookCategoryTagReference.tagName));

  const tagsByCategoryId = new Map<number, typeof tagRows>();

  for (const row of tagRows) {
    const existingTags = tagsByCategoryId.get(row.bookCategoryId) ?? [];
    existingTags.push(row);
    tagsByCategoryId.set(row.bookCategoryId, existingTags);
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
        bookCategoryId: tagRow.bookCategoryId,
        tagName: tagRow.tagName,
        tagJson: tagRow.tagJson,
        updatedAt: tagRow.updatedAt as Date,
      })),
    })),
  };
}

export async function saveBookCategory(input: SaveBookCategoryInput)
  : Promise<SaveBookCategoryReturn> {
  const categoryName = input.categoryName.trim();
  const categoryDesc = input.categoryDesc?.trim() ?? '';

  if (categoryName.length < 2) {
    return {
      success: false,
      message: 'Category name must be at least 2 characters.',
    };
  }

  const duplicateConditions = input.id
    ? and(ilike(bookCategoryReference.categoryName, categoryName), ne(bookCategoryReference.id, input.id))
    : ilike(bookCategoryReference.categoryName, categoryName);

  const [existingCategory] = await db
    .select({ id: bookCategoryReference.id })
    .from(bookCategoryReference)
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
      .update(bookCategoryReference)
      .set({
        categoryName,
        categoryDesc,
        updatedAt: new Date(),
      })
      .where(eq(bookCategoryReference.id, input.id))
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
    .insert(bookCategoryReference)
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

export async function saveBookCategoryTagReference(input: SaveBookCategoryTagReferenceInput)
  : Promise<SaveBookCategoryTagReferenceReturn> {
  const tagName = input.tagName.trim();

  if (tagName.length < 2) {
    return {
      success: false,
      message: 'Tag name must be at least 2 characters.',
    };
  }

  const [existingCategory] = await db
    .select({ id: bookCategoryReference.id })
    .from(bookCategoryReference)
    .where(eq(bookCategoryReference.id, input.bookCategoryId))
    .limit(1);

  if (!existingCategory) {
    return {
      success: false,
      message: `Category id ${ input.bookCategoryId } was not found.`,
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
      eq(bookCategoryTagReference.bookCategoryId, input.bookCategoryId),
      ilike(bookCategoryTagReference.tagName, tagName),
      ne(bookCategoryTagReference.id, input.id)
    )
    : and(
      eq(bookCategoryTagReference.bookCategoryId, input.bookCategoryId),
      ilike(bookCategoryTagReference.tagName, tagName)
    );

  const [existingTag] = await db
    .select({ id: bookCategoryTagReference.id })
    .from(bookCategoryTagReference)
    .where(duplicateConditions)
    .limit(1);

  if (existingTag) {
    return {
      success: false,
      message: `A tag named "${ tagName }" already exists in this category.`,
    };
  }

  const tagPayload = {
    bookCategoryId: input.bookCategoryId,
    tagName,
    tagJson: serializeTipTapDocument(parsedTagJson.content),
    updatedAt: new Date(),
  };

  if (input.id) {
    const [result] = await db
      .update(bookCategoryTagReference)
      .set(tagPayload)
      .where(eq(bookCategoryTagReference.id, input.id))
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
        bookCategoryId: result.bookCategoryId,
        tagName: result.tagName,
        tagJson: result.tagJson,
        updatedAt: result.updatedAt as Date,
      },
      message: `Updated tag "${ result.tagName }".`,
    };
  }

  const [result] = await db
    .insert(bookCategoryTagReference)
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
      bookCategoryId: result.bookCategoryId,
      tagName: result.tagName,
      tagJson: result.tagJson,
      updatedAt: result.updatedAt as Date,
    },
    message: `Added tag "${ result.tagName }".`,
  };
}

export async function deleteBookCategoryTagReference(
  input: DeleteBookCategoryTagReferenceInput
): Promise<DeleteBookCategoryTagReferenceReturn> {
  const [existingTag] = await db
    .select({
      id: bookCategoryTagReference.id,
      tagName: bookCategoryTagReference.tagName,
    })
    .from(bookCategoryTagReference)
    .where(eq(bookCategoryTagReference.id, input.id))
    .limit(1);

  if (!existingTag) {
    return {
      success: false,
      message: `Tag id ${ input.id } was not found.`,
    };
  }

  const [deletedTag] = await db
    .delete(bookCategoryTagReference)
    .where(eq(bookCategoryTagReference.id, input.id))
    .returning({
      id: bookCategoryTagReference.id,
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

export async function deleteBookCategory(
  input: DeleteBookCategoryInput
): Promise<DeleteBookCategoryReturn> {
  const [existingCategory] = await db
    .select({
      id: bookCategoryReference.id,
      categoryName: bookCategoryReference.categoryName,
    })
    .from(bookCategoryReference)
    .where(eq(bookCategoryReference.id, input.id))
    .limit(1);

  if (!existingCategory) {
    return {
      success: false,
      message: `Category id ${ input.id } was not found.`,
    };
  }

  const [deletedCategory] = await db
    .delete(bookCategoryReference)
    .where(eq(bookCategoryReference.id, input.id))
    .returning({
      id: bookCategoryReference.id,
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

export async function deleteBook(
  bookId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<{ success: false; message: string } | { success: true; message: string }> {
  const permissionCheck = actor.isFounder
    ? and(eq(book.id, bookId), eq(book.familyId, actor.familyId))
    : and(eq(book.id, bookId), eq(book.familyId, actor.familyId), eq(book.memberId, actor.memberId));

  const existingBook = await db
    .select({ id: book.id })
    .from(book)
    .where(permissionCheck)
    .then((rows) => rows[0] ?? null);

  if (!existingBook) {
    return {
      success: false,
      message: `No book was found for id: ${bookId}`,
    };
  }

  try {
    await db
      .delete(discussThread)
      .where(and(eq(discussThread.targetType, "book"), eq(discussThread.targetId, bookId), eq(discussThread.familyId, actor.familyId)));

    await db
      .delete(book)
      .where(permissionCheck);

    return {
      success: true,
      message: "Book deleted.",
    };
  } catch (error) {
    logDbQueryError('books.deleteBook', error, {
      bookId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      isFounder: actor.isFounder ?? false,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : "Error deleting book",
    };
  }
}


