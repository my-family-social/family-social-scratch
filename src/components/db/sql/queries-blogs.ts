import db from '@/components/db/drizzle';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';

import {
  blogComment,
  discussThread,
  blogLikeness,
  blogMedia,
  blogPost,
  blogPostTag,
  member,
  pwaMutationRequest,
} from '../schema/family-social-schema-tables';
import { blogTagReference } from '../schema/global-schema-tables';
import {
  AddBlogCommentInput,
  AddBlogCommentReturn,
  BlogCommentRecord,
  BlogHomePost,
  BlogMediaRecord,
  BlogPostDetail,
  BlogPostStatus,
  BlogTagOption,
  BlogsHomePageDataReturn,
  DeleteBlogPostReturn,
  GetBlogPostDetailReturn,
  SaveBlogMediaInput,
  SaveBlogMediaReturn,
  SaveBlogPostInput,
  SaveBlogPostReturn,
  ToggleBlogLikenessReturn,
} from '../types/blogs';
import {
  createTextTipTapDocument,
  isTipTapDocumentEmpty,
  parseSerializedTipTapDocument,
  serializeTipTapDocument,
} from '../types/poem-term-validation';
import {
  createFamilyActivityRecord,
  createFamilyReactionActivityRecord,
  FAMILY_ACTIVITY_ACTION_TYPES,
} from './queries-family-activity';
import { loadDiscussionThreadSummariesForTargetId } from './queries-discuss-threads';
import { logDbQueryError } from './db-error-logger';
import { normalizeYouTubeUrl } from '@/features/blogs/utils/youtube-url';

const BLOG_FEATURE_NAME = 'Blogs';
const BLOG_STATUS_OPTIONS = new Set<BlogPostStatus>(['draft', 'published', 'private']);
const BLOG_LIKENESS_OPTIONS = new Set([-1, 1, 2]);

function createMemberDisplayName(firstName?: string | null, lastName?: string | null) {
  const names = [firstName, lastName].filter(Boolean);

  if (names.length > 0) {
    return names.join(' ');
  }

  return 'Unknown Member';
}

function slugify(rawValue: string) {
  const slug = rawValue
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  if (slug) {
    return slug;
  }

  return `post-${ Date.now() }`;
}

async function isViewerFounderForDrafts(familyId: number, viewerMemberId?: number) {
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
  authorMemberId: number,
  viewerMemberId: number | undefined,
  viewerIsFounder: boolean,
  publicOnly = false
) {
  if (publicOnly) {
    return status === 'published';
  }

  if (status === 'published') {
    return true;
  }

  if (status === 'draft' || status === 'private') {
    return authorMemberId === viewerMemberId || viewerIsFounder;
  }

  return true;
}

async function ensureUniqueSlug(familyId: number, baseSlug: string, excludePostId?: number) {
  let attempt = 0;

  while (attempt < 500) {
    const candidateSlug = attempt === 0 ? baseSlug : `${ baseSlug }-${ attempt + 1 }`;

    const existing = await db
      .select({ id: blogPost.id })
      .from(blogPost)
      .where(
        and(
          eq(blogPost.familyId, familyId),
          eq(blogPost.slug, candidateSlug),
          excludePostId ? ne(blogPost.id, excludePostId) : undefined
        )
      )
      .then((rows) => rows[0] ?? null);

    if (!existing) {
      return candidateSlug;
    }

    attempt += 1;
  }

  return `${ baseSlug }-${ Date.now() }`;
}

async function loadBlogHomePosts(
  familyId: number,
  options?: {
    postIds?: number[];
    viewerMemberId?: number;
    publicOnly?: boolean;
    memberScopedOnly?: boolean;
  }
): Promise<BlogHomePost[]> {
  const postIds = options?.postIds;
  const viewerMemberId = options?.viewerMemberId;
  const publicOnly = options?.publicOnly ?? false;
  const memberScopedOnly = options?.memberScopedOnly ?? false;
  const whereFilters = [eq(blogPost.familyId, familyId)];

  if (postIds && postIds.length > 0) {
    whereFilters.push(inArray(blogPost.id, postIds));
  }

  if (memberScopedOnly) {
    if (viewerMemberId === undefined) {
      return [];
    }

    whereFilters.push(eq(blogPost.authorMemberId, viewerMemberId));
  }

  const whereClause = whereFilters.length === 1
    ? whereFilters[0]
    : and(...whereFilters);

  const postRows = await db
    .select()
    .from(blogPost)
    .where(whereClause)
    .orderBy(desc(blogPost.createdAt), asc(blogPost.title));

  if (!postRows || postRows.length === 0) {
    return [];
  }

  const viewerIsFounder = await isViewerFounderForDrafts(familyId, viewerMemberId);
  const visiblePostRows = postRows.filter((postRow) =>
    canViewDraftPost(postRow.status, postRow.authorMemberId, viewerMemberId, viewerIsFounder, publicOnly)
  );

  if (visiblePostRows.length === 0) {
    return [];
  }

  const visiblePostIds = visiblePostRows.map((postRow) => postRow.id);

  const [commentRows, likenessRows, taggedRows, discussionThreadRows] = await Promise.all([
    db
      .select({
        id: blogComment.id,
        contentJson: blogComment.contentJson,
        createdAt: blogComment.createdAt,
        updatedAt: blogComment.updatedAt,
        blogPostId: blogComment.blogPostId,
        memberId: blogComment.memberId,
      })
      .from(blogComment)
      .where(and(inArray(blogComment.blogPostId, visiblePostIds), isNull(blogComment.softDeletedAt)))
      .orderBy(asc(blogComment.createdAt)),
    db
      .select({
        blogPostId: blogLikeness.blogPostId,
        memberId: blogLikeness.memberId,
        likenessDegree: blogLikeness.likenessDegree,
      })
      .from(blogLikeness)
      .where(inArray(blogLikeness.blogPostId, visiblePostIds)),
    db
      .select({
        blogPostId: blogPostTag.blogPostId,
        blogTagId: blogPostTag.blogTagId,
        tagName: blogTagReference.tagName,
      })
      .from(blogPostTag)
      .innerJoin(blogTagReference, eq(blogTagReference.id, blogPostTag.blogTagId))
      .where(inArray(blogPostTag.blogPostId, visiblePostIds)),
    db
      .select({
        targetId: discussThread.targetId,
      })
      .from(discussThread)
      .where(
        and(
          eq(discussThread.familyId, familyId),
          eq(discussThread.targetType, 'blog'),
          inArray(discussThread.targetId, visiblePostIds),
        )
      ),
  ]);

  const memberIds = [...new Set([
    ...visiblePostRows.map((postRow) => postRow.authorMemberId),
    ...commentRows.map((commentRow) => commentRow.memberId),
    ...likenessRows.map((likenessRow) => likenessRow.memberId),
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

  const memberNameById = new Map(
    memberRows.map((memberRow) => [memberRow.id, createMemberDisplayName(memberRow.firstName, memberRow.lastName)])
  );
  const memberImageUrlById = new Map(memberRows.map((memberRow) => [memberRow.id, memberRow.memberImageUrl]));

  const commentsByPostId = new Map<number, BlogCommentRecord[]>();
  const selectedTagIdsByPostId = new Map<number, number[]>();
  const selectedTagNamesByPostId = new Map<number, string[]>();
  const hasDiscussionThreadByPostId = new Set<number>(discussionThreadRows.map((threadRow) => threadRow.targetId));
  const userLikenessByPostId = new Map<number, number>();
  const reactionsByPostId = new Map<number, { dislikeCount: number; likeCount: number; loveCount: number }>();
  const reactionMemberNamesByPostId = new Map<number, { dislikeMemberNames: string[]; likeMemberNames: string[]; loveMemberNames: string[] }>();
  const authorIdByPostId = new Map(visiblePostRows.map((postRow) => [postRow.id, postRow.authorMemberId]));

  for (const commentRow of commentRows) {
    const existingComments = commentsByPostId.get(commentRow.blogPostId) ?? [];
    existingComments.push({
      id: commentRow.id,
      createdAt: commentRow.createdAt as Date,
      updatedAt: commentRow.updatedAt as Date,
      commenterName: memberNameById.get(commentRow.memberId) ?? `Member #${ commentRow.memberId }`,
      memberId: commentRow.memberId,
      contentJson: commentRow.contentJson,
    });
    commentsByPostId.set(commentRow.blogPostId, existingComments);
  }

  for (const taggedRow of taggedRows) {
    const existingTagIds = selectedTagIdsByPostId.get(taggedRow.blogPostId) ?? [];
    existingTagIds.push(taggedRow.blogTagId);
    selectedTagIdsByPostId.set(taggedRow.blogPostId, existingTagIds);

    const existingTagNames = selectedTagNamesByPostId.get(taggedRow.blogPostId) ?? [];
    existingTagNames.push(taggedRow.tagName);
    selectedTagNamesByPostId.set(taggedRow.blogPostId, existingTagNames);
  }

  for (const likenessRow of likenessRows) {
    const authorMemberId = authorIdByPostId.get(likenessRow.blogPostId);

    if (viewerMemberId && viewerMemberId === likenessRow.memberId) {
      userLikenessByPostId.set(likenessRow.blogPostId, likenessRow.likenessDegree);
    }

    if (authorMemberId === likenessRow.memberId) {
      continue;
    }

    const currentReactionCounts = reactionsByPostId.get(likenessRow.blogPostId) ?? {
      dislikeCount: 0,
      likeCount: 0,
      loveCount: 0,
    };
    const currentReactionMemberNames = reactionMemberNamesByPostId.get(likenessRow.blogPostId) ?? {
      dislikeMemberNames: [],
      likeMemberNames: [],
      loveMemberNames: [],
    };
    const memberName = memberNameById.get(likenessRow.memberId) ?? `Member #${ likenessRow.memberId }`;

    if (likenessRow.likenessDegree === -1) {
      currentReactionCounts.dislikeCount += 1;
      currentReactionMemberNames.dislikeMemberNames.push(memberName);
    } else if (likenessRow.likenessDegree === 2) {
      currentReactionCounts.loveCount += 1;
      currentReactionMemberNames.loveMemberNames.push(memberName);
    } else {
      currentReactionCounts.likeCount += 1;
      currentReactionMemberNames.likeMemberNames.push(memberName);
    }

    reactionsByPostId.set(likenessRow.blogPostId, currentReactionCounts);
    reactionMemberNamesByPostId.set(likenessRow.blogPostId, currentReactionMemberNames);
  }

  return visiblePostRows.map((postRow) => {
    const reactionCounts = reactionsByPostId.get(postRow.id) ?? {
      dislikeCount: 0,
      likeCount: 0,
      loveCount: 0,
    };

    const reactionMembers = reactionMemberNamesByPostId.get(postRow.id) ?? {
      dislikeMemberNames: [],
      likeMemberNames: [],
      loveMemberNames: [],
    };

    const comments = commentsByPostId.get(postRow.id) ?? [];

    return {
      id: postRow.id,
      title: postRow.title,
      slug: postRow.slug,
      excerpt: postRow.excerpt,
      contentJson: postRow.contentJson,
      status: postRow.status as BlogPostStatus,
      publishedAt: postRow.publishedAt,
      createdAt: postRow.createdAt as Date,
      updatedAt: postRow.updatedAt as Date,
      coverImageS3Key: postRow.coverImageS3Key,
      coverImageAlt: postRow.coverImageAlt,
      videoUrl: postRow.videoUrl,
      videoMinutes: postRow.videoMinutes,
      allowComments: postRow.allowComments,
      authorMemberId: postRow.authorMemberId,
      familyId: postRow.familyId,
      authorName: memberNameById.get(postRow.authorMemberId) ?? `Member #${ postRow.authorMemberId }`,
      authorImageUrl: memberImageUrlById.get(postRow.authorMemberId) ?? null,
      dislikeCount: reactionCounts.dislikeCount,
      likeCount: reactionCounts.likeCount,
      loveCount: reactionCounts.loveCount,
      userLikenessDegree: userLikenessByPostId.get(postRow.id) ?? null,
      commentCount: comments.length,
      hasDiscussionThread: hasDiscussionThreadByPostId.has(postRow.id),
      selectedTagIds: selectedTagIdsByPostId.get(postRow.id) ?? [],
      selectedTagNames: [...new Set(selectedTagNamesByPostId.get(postRow.id) ?? [])].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      dislikeMemberNames: [...reactionMembers.dislikeMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      likeMemberNames: [...reactionMembers.likeMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      loveMemberNames: [...reactionMembers.loveMemberNames].sort((leftName, rightName) => leftName.localeCompare(rightName)),
      comments,
    };
  });
}

async function loadBlogPostDetail(
  familyId: number,
  blogPostId: number,
  viewerMemberId?: number
): Promise<BlogPostDetail | null> {
  const homePosts = await loadBlogHomePosts(familyId, {
    postIds: [blogPostId],
    viewerMemberId,
  });
  const post = homePosts[0];

  if (!post) {
    return null;
  }

  const mediaRows = await db
    .select()
    .from(blogMedia)
    .where(and(eq(blogMedia.familyId, familyId), eq(blogMedia.blogPostId, blogPostId)))
    .orderBy(asc(blogMedia.createdAt));

  const discussionThreads = await loadDiscussionThreadSummariesForTargetId(
    familyId,
    'blog',
    blogPostId,
  );

  return {
    ...post,
    media: mediaRows.map((mediaRow) => ({
      id: mediaRow.id,
      s3ObjectKey: mediaRow.s3ObjectKey,
      mimeType: mediaRow.mimeType,
      fileSizeBytes: mediaRow.fileSizeBytes,
      width: mediaRow.width,
      height: mediaRow.height,
      altText: mediaRow.altText,
      caption: mediaRow.caption,
      createdAt: mediaRow.createdAt as Date,
      blogPostId: mediaRow.blogPostId,
      uploadMemberId: mediaRow.uploadMemberId,
      familyId: mediaRow.familyId,
    })),
    discussionThreads,
  };
}

async function loadBlogTagOptions(): Promise<BlogTagOption[]> {
  const rows = await db
    .select({
      id: blogTagReference.id,
      tagName: blogTagReference.tagName,
      category: blogTagReference.category,
      seqNo: blogTagReference.seqNo,
    })
    .from(blogTagReference)
    .orderBy(asc(blogTagReference.category), asc(blogTagReference.seqNo), asc(blogTagReference.tagName));

  return rows.map((row) => ({
    id: row.id,
    tagName: row.tagName,
    category: row.category,
    seqNo: row.seqNo,
  }));
}

function normalizePostContentJson(rawInput: string) {
  const trimmedInput = rawInput.trim();
  const parsed = parseSerializedTipTapDocument(trimmedInput);

  if (parsed.success) {
    if (isTipTapDocumentEmpty(parsed.content)) {
      return {
        success: false as const,
        message: 'Blog post content cannot be empty.',
      };
    }

    return {
      success: true as const,
      contentJson: serializeTipTapDocument(parsed.content),
    };
  }

  if (trimmedInput.length < 2) {
    return {
      success: false as const,
      message: 'Blog post content must be at least 2 characters.',
    };
  }

  return {
    success: true as const,
    contentJson: serializeTipTapDocument(createTextTipTapDocument(trimmedInput)),
  };
}

function normalizeCommentContentJson(rawInput: string) {
  const trimmedInput = rawInput.trim();
  const parsed = parseSerializedTipTapDocument(trimmedInput);

  if (parsed.success) {
    if (isTipTapDocumentEmpty(parsed.content)) {
      return {
        success: false as const,
        message: 'Comment cannot be empty.',
      };
    }

    return {
      success: true as const,
      contentJson: serializeTipTapDocument(parsed.content),
    };
  }

  if (trimmedInput.length < 2) {
    return {
      success: false as const,
      message: 'Comment must be at least 2 characters.',
    };
  }

  return {
    success: true as const,
    contentJson: serializeTipTapDocument(createTextTipTapDocument(trimmedInput)),
  };
}

export async function getPublishedBlogsHomePageData(
  familyId: number,
  viewerMemberId?: number
): Promise<BlogsHomePageDataReturn> {
  try {
    const [posts, blogTags] = await Promise.all([
      loadBlogHomePosts(familyId, { viewerMemberId, publicOnly: true }),
      loadBlogTagOptions(),
    ]);

    return {
      success: true,
      posts,
      blogTags,
    };
  } catch (error) {
    logDbQueryError('blogs.getPublishedBlogsHomePageData', error, { familyId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to load published blog home page data.',
    };
  }
}

export async function getMemberBlogsHomePageData(
  familyId: number,
  viewerMemberId?: number
): Promise<BlogsHomePageDataReturn> {
  try {
    const [posts, blogTags] = await Promise.all([
      loadBlogHomePosts(familyId, { viewerMemberId, memberScopedOnly: true }),
      loadBlogTagOptions(),
    ]);

    return {
      success: true,
      posts,
      blogTags,
    };
  } catch (error) {
    logDbQueryError('blogs.getMemberBlogsHomePageData', error, { familyId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to load member blog page data.',
    };
  }
}

export async function getBlogsHomePageData(
  familyId: number,
  viewerMemberId?: number
): Promise<BlogsHomePageDataReturn> {
  return getPublishedBlogsHomePageData(familyId, viewerMemberId);
}

export async function getBlogPostDetail(
  familyId: number,
  blogPostId: number,
  viewerMemberId?: number
): Promise<GetBlogPostDetailReturn> {
  try {
    const post = await loadBlogPostDetail(familyId, blogPostId, viewerMemberId);

    if (!post) {
      return {
        success: false,
        message: 'Blog post not found.',
      };
    }

    return {
      success: true,
      post,
    };
  } catch (error) {
    logDbQueryError('blogs.getBlogPostDetail', error, { familyId, blogPostId, viewerMemberId });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to load blog post detail.',
    };
  }
}

export async function saveBlogPost(
  input: SaveBlogPostInput,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<SaveBlogPostReturn> {
  const normalizedTitle = input.title.trim();
  const normalizedExcerpt = (input.excerpt ?? '').trim();
  const normalizedStatus = input.status;
  const normalizedCoverImageS3Key = (input.coverImageS3Key ?? '').trim() || null;
  const normalizedCoverImageAlt = (input.coverImageAlt ?? '').trim() || null;
  const rawVideoUrl = (input.videoUrl ?? '').trim();
  const normalizedVideoUrl = normalizeYouTubeUrl(rawVideoUrl);
  const normalizedVideoMinutes = Math.trunc(input.videoMinutes ?? 0);
  const uniqueTagIds = [...new Set(input.selectedTagIds)];

  if (normalizedTitle.length < 2) {
    return {
      success: false,
      message: 'Blog title must be at least 2 characters.',
    };
  }

  if (!BLOG_STATUS_OPTIONS.has(normalizedStatus)) {
    return {
      success: false,
      message: 'Select a valid blog status.',
    };
  }

  if (rawVideoUrl && !normalizedVideoUrl) {
    return {
      success: false,
      message: 'Video URL must be a valid HTTPS YouTube URL.',
    };
  }

  if (normalizedVideoUrl && (!Number.isFinite(normalizedVideoMinutes) || normalizedVideoMinutes <= 0)) {
    return {
      success: false,
      message: 'Video minutes must be greater than 0 when a YouTube URL is entered.',
    };
  }

  const normalizedContentJsonResult = normalizePostContentJson(input.contentJson);

  if (!normalizedContentJsonResult.success) {
    return {
      success: false,
      message: normalizedContentJsonResult.message,
    };
  }

  if (uniqueTagIds.length > 0) {
    const tagRows = await db
      .select({ id: blogTagReference.id })
      .from(blogTagReference)
      .where(inArray(blogTagReference.id, uniqueTagIds));

    if (tagRows.length !== uniqueTagIds.length) {
      return {
        success: false,
        message: 'One or more selected blog tags are invalid.',
      };
    }
  }

  const requestedPublishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
  const publishedAt = normalizedStatus === 'published'
    ? (requestedPublishedAt && !Number.isNaN(requestedPublishedAt.getTime()) ? requestedPublishedAt : new Date())
    : null;

  try {
    let persistedPostId = input.id;

    if (input.id) {
      const existingPost = await db
        .select()
        .from(blogPost)
        .where(and(eq(blogPost.id, input.id), eq(blogPost.familyId, actor.familyId)))
        .then((rows) => rows[0] ?? null);

      if (!existingPost) {
        return {
          success: false,
          message: 'Blog post not found.',
        };
      }

      const canEditPost = actor.memberId === existingPost.authorMemberId || Boolean(actor.isFounder);

      if (!canEditPost) {
        return {
          success: false,
          message: 'Only the author or founder can edit this blog post.',
        };
      }

      const requestedSlug = (input.slug ?? '').trim();
      const normalizedSlug = requestedSlug ? slugify(requestedSlug) : slugify(normalizedTitle);
      const uniqueSlug = await ensureUniqueSlug(actor.familyId, normalizedSlug, existingPost.id);

      await db
        .update(blogPost)
        .set({
          title: normalizedTitle,
          slug: uniqueSlug,
          excerpt: normalizedExcerpt,
          contentJson: normalizedContentJsonResult.contentJson,
          status: normalizedStatus,
          publishedAt,
          updatedAt: new Date(),
          coverImageS3Key: normalizedCoverImageS3Key,
          coverImageAlt: normalizedCoverImageAlt,
          videoUrl: normalizedVideoUrl,
          videoMinutes: normalizedVideoUrl ? normalizedVideoMinutes : 0,
          allowComments: input.allowComments,
        })
        .where(eq(blogPost.id, existingPost.id));

      await db
        .delete(blogPostTag)
        .where(eq(blogPostTag.blogPostId, existingPost.id));

      if (uniqueTagIds.length > 0) {
        await db.insert(blogPostTag).values(
          uniqueTagIds.map((tagId) => ({
            blogPostId: existingPost.id,
            blogTagId: tagId,
          }))
        );
      }

      persistedPostId = existingPost.id;
    } else {
      const requestedSlug = (input.slug ?? '').trim();
      const normalizedSlug = requestedSlug ? slugify(requestedSlug) : slugify(normalizedTitle);
      const uniqueSlug = await ensureUniqueSlug(actor.familyId, normalizedSlug);

      const [createdPost] = await db
        .insert(blogPost)
        .values({
          title: normalizedTitle,
          slug: uniqueSlug,
          excerpt: normalizedExcerpt,
          contentJson: normalizedContentJsonResult.contentJson,
          status: normalizedStatus,
          publishedAt,
          coverImageS3Key: normalizedCoverImageS3Key,
          coverImageAlt: normalizedCoverImageAlt,
          videoUrl: normalizedVideoUrl,
          videoMinutes: normalizedVideoUrl ? normalizedVideoMinutes : 0,
          allowComments: input.allowComments,
          authorMemberId: actor.memberId,
          familyId: actor.familyId,
        })
        .returning();

      persistedPostId = createdPost.id;

      if (uniqueTagIds.length > 0) {
        await db.insert(blogPostTag).values(
          uniqueTagIds.map((tagId) => ({
            blogPostId: createdPost.id,
            blogTagId: tagId,
          }))
        );
      }

      await createFamilyActivityRecord({
        actionType: FAMILY_ACTIVITY_ACTION_TYPES.POST_CREATED,
        featureName: BLOG_FEATURE_NAME,
        postName: normalizedTitle,
        postId: createdPost.id,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const updatedHomePosts = await loadBlogHomePosts(actor.familyId, {
      postIds: [persistedPostId as number],
      viewerMemberId: actor.memberId,
    });
    const updatedPost = updatedHomePosts[0];

    if (!updatedPost) {
      return {
        success: false,
        message: 'Blog post was saved but could not be reloaded.',
      };
    }

    return {
      success: true,
      post: updatedPost,
      message: input.id ? 'Blog post updated successfully.' : 'Blog post created successfully.',
    };
  } catch (error) {
    logDbQueryError('blogs.saveBlogPost', error, {
      postId: input.id,
      familyId: actor.familyId,
      memberId: actor.memberId,
      status: normalizedStatus,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to save blog post.',
    };
  }
}

export async function toggleBlogLikeness(
  blogPostId: number,
  likenessDegree: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<ToggleBlogLikenessReturn> {
  if (!BLOG_LIKENESS_OPTIONS.has(likenessDegree)) {
    return {
      success: false,
      message: 'Invalid likeness reaction.',
    };
  }

  try {
    const existingPost = await db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.familyId, actor.familyId), eq(blogPost.id, blogPostId)))
      .then((rows) => rows[0] ?? null);

    if (!existingPost) {
      return {
        success: false,
        message: 'Blog post not found.',
      };
    }

    const viewerCanView = canViewDraftPost(
      existingPost.status,
      existingPost.authorMemberId,
      actor.memberId,
      Boolean(actor.isFounder)
    );

    if (!viewerCanView) {
      return {
        success: false,
        message: 'You cannot react to this draft post.',
      };
    }

    if (existingPost.authorMemberId === actor.memberId) {
      return {
        success: false,
        message: 'You cannot react to your own blog post.',
      };
    }

    const existingLikeness = await db
      .select()
      .from(blogLikeness)
      .where(and(eq(blogLikeness.blogPostId, blogPostId), eq(blogLikeness.memberId, actor.memberId)))
      .then((rows) => rows[0] ?? null);

    if (existingLikeness && existingLikeness.likenessDegree === likenessDegree) {
      await db.delete(blogLikeness).where(eq(blogLikeness.id, existingLikeness.id));
    } else if (existingLikeness) {
      await db
        .update(blogLikeness)
        .set({ likenessDegree })
        .where(eq(blogLikeness.id, existingLikeness.id));
    } else {
      await db.insert(blogLikeness).values({
        blogPostId,
        memberId: actor.memberId,
        likenessDegree,
      });
    }

    if ((!existingLikeness || existingLikeness.likenessDegree !== likenessDegree) && actor.memberId !== existingPost.authorMemberId) {
      await createFamilyReactionActivityRecord({
        reactionType: likenessDegree === 2 ? 'love' : 'like',
        featureName: BLOG_FEATURE_NAME,
        postName: existingPost.title,
        familyId: actor.familyId,
        memberId: actor.memberId,
      });
    }

    const updatedPost = await loadBlogPostDetail(actor.familyId, blogPostId, actor.memberId);

    if (!updatedPost) {
      return {
        success: false,
        message: 'Reaction was saved but the blog post could not be reloaded.',
      };
    }

    const actionText = existingLikeness && existingLikeness.likenessDegree === likenessDegree
      ? 'removed'
      : 'saved';

    return {
      success: true,
      post: updatedPost,
      message: `Blog reaction ${actionText} successfully.`,
    };
  } catch (error) {
    logDbQueryError('blogs.toggleBlogLikeness', error, {
      blogPostId,
      likenessDegree,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to update blog reaction.',
    };
  }
}

export async function addBlogComment(
  input: AddBlogCommentInput,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<AddBlogCommentReturn> {
  const normalizedCommentResult = normalizeCommentContentJson(input.commentText);

  if (!normalizedCommentResult.success) {
    return {
      success: false,
      message: normalizedCommentResult.message,
    };
  }

  const existingPost = await db
    .select()
    .from(blogPost)
    .where(and(eq(blogPost.familyId, actor.familyId), eq(blogPost.id, input.blogPostId)))
    .then((rows) => rows[0] ?? null);

  if (!existingPost) {
    return {
      success: false,
      message: 'Blog post not found.',
    };
  }

  const viewerCanView = canViewDraftPost(
    existingPost.status,
    existingPost.authorMemberId,
    actor.memberId,
    Boolean(actor.isFounder)
  );

  if (!viewerCanView) {
    return {
      success: false,
      message: 'You cannot comment on this draft post.',
    };
  }

  if (existingPost.authorMemberId === actor.memberId) {
    return {
      success: false,
      message: 'You cannot comment on your own blog post.',
    };
  }

  try {
    const duplicateRequest = input.clientRequestId
      ? await db
        .insert(pwaMutationRequest)
        .values({
          requestKey: input.clientRequestId,
          mutationName: 'blogs.addBlogComment',
          entityType: 'blog_post',
          entityId: input.blogPostId,
          familyId: actor.familyId,
          memberId: actor.memberId,
        })
        .onConflictDoNothing({ target: pwaMutationRequest.requestKey })
        .returning({ id: pwaMutationRequest.id })
      : [{ id: 0 }];

    if (input.clientRequestId && duplicateRequest.length === 0) {
      const existingPostDetail = await loadBlogPostDetail(actor.familyId, input.blogPostId, actor.memberId);

      if (!existingPostDetail) {
        return {
          success: false,
          message: 'Comment already synced, but the blog post could not be reloaded.',
        };
      }

      return {
        success: true,
        post: existingPostDetail,
        message: 'Comment already synced.',
      };
    }

    await db.insert(blogComment).values({
      contentJson: normalizedCommentResult.contentJson,
      blogPostId: input.blogPostId,
      memberId: actor.memberId,
    });

    await createFamilyActivityRecord({
      actionType: FAMILY_ACTIVITY_ACTION_TYPES.COMMENT_CREATED,
      featureName: BLOG_FEATURE_NAME,
      postName: existingPost.title,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });

    const updatedPost = await loadBlogPostDetail(actor.familyId, input.blogPostId, actor.memberId);

    if (!updatedPost) {
      return {
        success: false,
        message: 'Comment was saved but the blog post could not be reloaded.',
      };
    }

    return {
      success: true,
      post: updatedPost,
      message: 'Comment posted successfully.',
    };
  } catch (error) {
    logDbQueryError('blogs.addBlogComment', error, {
      blogPostId: input.blogPostId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      clientRequestId: input.clientRequestId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to add blog comment.',
    };
  }
}

export async function saveBlogMedia(
  input: SaveBlogMediaInput,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<SaveBlogMediaReturn> {
  const normalizedKey = input.s3ObjectKey.trim();
  const normalizedMimeType = input.mimeType.trim().toLowerCase();

  if (!normalizedKey) {
    return {
      success: false,
      message: 'Media object key is required.',
    };
  }

  if (!normalizedMimeType) {
    return {
      success: false,
      message: 'Media MIME type is required.',
    };
  }

  if (input.blogPostId) {
    const existingPost = await db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.id, input.blogPostId), eq(blogPost.familyId, actor.familyId)))
      .then((rows) => rows[0] ?? null);

    if (!existingPost) {
      return {
        success: false,
        message: 'Blog post not found for media attachment.',
      };
    }

    const canAttachMedia = existingPost.authorMemberId === actor.memberId || Boolean(actor.isFounder);

    if (!canAttachMedia) {
      return {
        success: false,
        message: 'Only the author or founder can attach blog media.',
      };
    }
  }

  try {
    const [savedMedia] = await db
      .insert(blogMedia)
      .values({
        s3ObjectKey: normalizedKey,
        mimeType: normalizedMimeType,
        fileSizeBytes: input.fileSizeBytes ?? 0,
        width: input.width ?? null,
        height: input.height ?? null,
        altText: input.altText?.trim() || null,
        caption: input.caption?.trim() || null,
        blogPostId: input.blogPostId ?? null,
        uploadMemberId: actor.memberId,
        familyId: actor.familyId,
      })
      .returning();

    const responseMedia: BlogMediaRecord = {
      id: savedMedia.id,
      s3ObjectKey: savedMedia.s3ObjectKey,
      mimeType: savedMedia.mimeType,
      fileSizeBytes: savedMedia.fileSizeBytes,
      width: savedMedia.width,
      height: savedMedia.height,
      altText: savedMedia.altText,
      caption: savedMedia.caption,
      createdAt: savedMedia.createdAt as Date,
      blogPostId: savedMedia.blogPostId,
      uploadMemberId: savedMedia.uploadMemberId,
      familyId: savedMedia.familyId,
    };

    return {
      success: true,
      media: responseMedia,
      message: 'Blog media saved successfully.',
    };
  } catch (error) {
    logDbQueryError('blogs.saveBlogMedia', error, {
      blogPostId: input.blogPostId,
      familyId: actor.familyId,
      memberId: actor.memberId,
      s3ObjectKey: normalizedKey,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to save blog media.',
    };
  }
}

export async function deleteBlogPost(
  blogPostId: number,
  actor: {
    familyId: number;
    memberId: number;
    isFounder?: boolean;
  }
): Promise<DeleteBlogPostReturn> {
  try {
    const existingPost = await db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.id, blogPostId), eq(blogPost.familyId, actor.familyId)))
      .then((rows) => rows[0] ?? null);

    if (!existingPost) {
      return {
        success: false,
        message: 'Blog post not found.',
      };
    }

    const canDeletePost = existingPost.authorMemberId === actor.memberId || Boolean(actor.isFounder);

    if (!canDeletePost) {
      return {
        success: false,
        message: 'Only the author or founder can delete this blog post.',
      };
    }

    await db
      .delete(blogPost)
      .where(eq(blogPost.id, blogPostId));

    return {
      success: true,
      message: 'Blog post deleted successfully.',
    };
  } catch (error) {
    logDbQueryError('blogs.deleteBlogPost', error, {
      blogPostId,
      familyId: actor.familyId,
      memberId: actor.memberId,
    });
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to delete blog post.',
    };
  }
}
