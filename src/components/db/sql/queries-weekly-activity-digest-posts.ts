import { and, asc, count, eq, inArray, isNull, or, type AnyColumn } from "drizzle-orm";
import db from "@/components/db/drizzle";
import {
  blogComment, blogLikeness, blogPost,
  book, bookComment, bookLike,
  galleryAlbum, galleryAlbumComment, galleryAlbumPhoto, galleryAlbumPhotoLike, galleryPhoto,
  member,
  movie, movieComment, movieLike,
  music, musicComment, musicLike,
  poem, poemComment, poemLike, poemVerse,
  recipe, recipeComment, recipeLike,
  show, showComment, showLike,
} from "@/components/db/schema/family-social-schema-tables";

export type DigestPostRef = { featureName: string; postName: string; postId: number | null; memberId: number | null };
export type DigestPostDetails = {
  postId: number;
  imageValue: string | null;
  excerpt: string | null;
  likeCount: number;
  loveCount: number;
  commentCount: number;
};

type PostRow = { id: number; title: string; memberId: number; imageValue: string | null; excerpt: string | null; visible: boolean };
type ReactionRow = { postId: number; memberId: number; degree: number };
type CommentCountRow = { postId: number; count: number };
type Lookup = { ids: number[]; titles: string[] };

type RoomResolver = {
  loadPosts(familyId: number, lookup: Lookup): Promise<PostRow[]>;
  loadReactions(postIds: number[]): Promise<ReactionRow[]>;
  loadCommentCounts(postIds: number[]): Promise<CommentCountRow[]>;
  /** Titles are only unique per author for these rooms, so title fallbacks also match the activity member. */
  matchTitleByMember?: boolean;
};

const HIDDEN_STATUSES = ["draft", "template", "private"];
const isVisibleStatus = (status: string | null) => !HIDDEN_STATUSES.includes((status ?? "").toLowerCase());

function lookupFilter(idColumn: AnyColumn, titleColumn: AnyColumn, lookup: Lookup) {
  return or(
    lookup.ids.length > 0 ? inArray(idColumn, lookup.ids) : undefined,
    lookup.titles.length > 0 ? inArray(titleColumn, lookup.titles) : undefined,
  );
}

const showResolver: RoomResolver = {
  async loadPosts(familyId, lookup) {
    const rows = await db.select({ id: show.id, title: show.showTitle, memberId: show.memberId, imageValue: show.showImageUrl, status: show.status })
      .from(show).where(and(eq(show.familyId, familyId), lookupFilter(show.id, show.showTitle, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, excerpt: null, visible: isVisibleStatus(status) }));
  },
  loadReactions: (ids) => db.select({ postId: showLike.showId, memberId: showLike.memberId, degree: showLike.likenessDegree })
    .from(showLike).where(inArray(showLike.showId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: showComment.showId, count: count() }).from(showComment)
    .where(and(inArray(showComment.showId, ids), eq(showComment.isShowReviewer, false))).groupBy(showComment.showId),
};

const movieResolver: RoomResolver = {
  async loadPosts(familyId, lookup) {
    const rows = await db.select({ id: movie.id, title: movie.movieTitle, memberId: movie.memberId, imageValue: movie.movieImageUrl, status: movie.status })
      .from(movie).where(and(eq(movie.familyId, familyId), lookupFilter(movie.id, movie.movieTitle, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, excerpt: null, visible: isVisibleStatus(status) }));
  },
  loadReactions: (ids) => db.select({ postId: movieLike.movieId, memberId: movieLike.memberId, degree: movieLike.likenessDegree })
    .from(movieLike).where(inArray(movieLike.movieId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: movieComment.movieId, count: count() }).from(movieComment)
    .where(and(inArray(movieComment.movieId, ids), eq(movieComment.ismovieReviewer, false))).groupBy(movieComment.movieId),
};

const musicResolver: RoomResolver = {
  async loadPosts(familyId, lookup) {
    const rows = await db.select({ id: music.id, title: music.musicTitle, memberId: music.memberId, imageValue: music.musicImageUrl, status: music.status })
      .from(music).where(and(eq(music.familyId, familyId), lookupFilter(music.id, music.musicTitle, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, excerpt: null, visible: isVisibleStatus(status) }));
  },
  loadReactions: (ids) => db.select({ postId: musicLike.musicId, memberId: musicLike.memberId, degree: musicLike.likenessDegree })
    .from(musicLike).where(inArray(musicLike.musicId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: musicComment.musicId, count: count() }).from(musicComment)
    .where(and(inArray(musicComment.musicId, ids), eq(musicComment.isMusicReviewer, false))).groupBy(musicComment.musicId),
};

const recipeResolver: RoomResolver = {
  async loadPosts(familyId, lookup) {
    const rows = await db.select({
      id: recipe.id, title: recipe.recipeTitle, memberId: recipe.memberId, imageValue: recipe.recipeImageUrl,
      excerpt: recipe.recipeShortSummary, status: recipe.status,
    }).from(recipe).where(and(eq(recipe.familyId, familyId), lookupFilter(recipe.id, recipe.recipeTitle, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, visible: isVisibleStatus(status) }));
  },
  loadReactions: (ids) => db.select({ postId: recipeLike.recipeId, memberId: recipeLike.memberId, degree: recipeLike.likenessDegree })
    .from(recipeLike).where(inArray(recipeLike.recipeId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: recipeComment.recipeId, count: count() }).from(recipeComment)
    .where(and(inArray(recipeComment.recipeId, ids), eq(recipeComment.isRecipeProTip, false))).groupBy(recipeComment.recipeId),
};

const poemResolver: RoomResolver = {
  async loadPosts(familyId, lookup) {
    const rows = await db.select({ id: poem.id, title: poem.poemTitle, memberId: poem.memberId, status: poem.status })
      .from(poem).where(and(eq(poem.familyId, familyId), lookupFilter(poem.id, poem.poemTitle, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, imageValue: null, excerpt: null, visible: isVisibleStatus(status) }));
  },
  loadReactions: (ids) => db.select({ postId: poemLike.poemId, memberId: poemLike.memberId, degree: poemLike.reactionType })
    .from(poemLike).where(inArray(poemLike.poemId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: poemVerse.poemId, count: count() }).from(poemComment)
    .innerJoin(poemVerse, eq(poemComment.poemVerseId, poemVerse.id))
    .where(and(inArray(poemVerse.poemId, ids), eq(poemComment.isPoemAnalysis, false))).groupBy(poemVerse.poemId),
};

const bookResolver: RoomResolver = {
  async loadPosts(familyId, lookup) {
    const rows = await db.select({ id: book.id, title: book.bookTitle, memberId: book.memberId, status: book.status })
      .from(book).where(and(eq(book.familyId, familyId), lookupFilter(book.id, book.bookTitle, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, imageValue: null, excerpt: null, visible: isVisibleStatus(status) }));
  },
  loadReactions: (ids) => db.select({ postId: bookLike.bookId, memberId: bookLike.memberId, degree: bookLike.reactionType })
    .from(bookLike).where(inArray(bookLike.bookId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: bookComment.bookId, count: count() }).from(bookComment)
    .where(and(inArray(bookComment.bookId, ids), eq(bookComment.isBookAnalysis, false))).groupBy(bookComment.bookId),
};

const blogResolver: RoomResolver = {
  matchTitleByMember: true,
  async loadPosts(familyId, lookup) {
    const rows = await db.select({
      id: blogPost.id, title: blogPost.title, memberId: blogPost.authorMemberId, imageValue: blogPost.coverImageS3Key,
      excerpt: blogPost.excerpt, status: blogPost.status,
    }).from(blogPost).where(and(eq(blogPost.familyId, familyId), lookupFilter(blogPost.id, blogPost.title, lookup)));
    return rows.map(({ status, ...row }) => ({ ...row, visible: status === "published" }));
  },
  loadReactions: (ids) => db.select({ postId: blogLikeness.blogPostId, memberId: blogLikeness.memberId, degree: blogLikeness.likenessDegree })
    .from(blogLikeness).where(inArray(blogLikeness.blogPostId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: blogComment.blogPostId, count: count() }).from(blogComment)
    .where(and(inArray(blogComment.blogPostId, ids), isNull(blogComment.softDeletedAt))).groupBy(blogComment.blogPostId),
};

const galleryResolver: RoomResolver = {
  matchTitleByMember: true,
  async loadPosts(familyId, lookup) {
    const albums = await db.select({ id: galleryAlbum.id, title: galleryAlbum.albumName, memberId: galleryAlbum.memberId, isShared: galleryAlbum.isShared })
      .from(galleryAlbum).innerJoin(member, and(eq(galleryAlbum.memberId, member.id), eq(member.familyId, familyId)))
      .where(lookupFilter(galleryAlbum.id, galleryAlbum.albumName, lookup));
    const sharedIds = albums.filter((album) => album.isShared).map((album) => album.id);
    const covers = sharedIds.length > 0
      ? await db.select({ albumId: galleryAlbumPhoto.albumId, imageValue: galleryPhoto.photoImageUrl })
        .from(galleryAlbumPhoto).innerJoin(galleryPhoto, eq(galleryAlbumPhoto.photoId, galleryPhoto.id))
        .where(inArray(galleryAlbumPhoto.albumId, sharedIds))
        .orderBy(asc(galleryAlbumPhoto.albumId), asc(galleryAlbumPhoto.seqNo), asc(galleryAlbumPhoto.id))
      : [];
    const coverByAlbumId = new Map<number, string>();
    for (const cover of covers) {
      if (!coverByAlbumId.has(cover.albumId)) coverByAlbumId.set(cover.albumId, cover.imageValue);
    }
    return albums.map(({ isShared, ...album }) => ({
      ...album, imageValue: coverByAlbumId.get(album.id) ?? null, excerpt: null, visible: isShared,
    }));
  },
  loadReactions: (ids) => db.select({ postId: galleryAlbumPhoto.albumId, memberId: galleryAlbumPhotoLike.memberId, degree: galleryAlbumPhotoLike.likeType })
    .from(galleryAlbumPhotoLike).innerJoin(galleryAlbumPhoto, eq(galleryAlbumPhotoLike.albumPhotoId, galleryAlbumPhoto.id))
    .where(inArray(galleryAlbumPhoto.albumId, ids)),
  loadCommentCounts: (ids) => db.select({ postId: galleryAlbumComment.albumId, count: count() }).from(galleryAlbumComment)
    .where(inArray(galleryAlbumComment.albumId, ids)).groupBy(galleryAlbumComment.albumId),
};

export const ROOM_RESOLVERS: Record<string, RoomResolver> = {
  "TV Room": showResolver,
  "Movie Theater": movieResolver,
  "Music Salon": musicResolver,
  "The Kitchen": recipeResolver,
  "Poetry Nook": poemResolver,
  "Reading Room": bookResolver,
  "Blogs": blogResolver,
  "Family Blog": blogResolver,
  "Family Gallery": galleryResolver,
};

/** Counts likes (1) and loves (2), ignoring the submitter's own rating, as the room pages do. */
export function tallyReactions(reactions: ReactionRow[], submitterByPostId: Map<number, number>) {
  const tally = new Map<number, { likeCount: number; loveCount: number }>();
  for (const reaction of reactions) {
    if (submitterByPostId.get(reaction.postId) === reaction.memberId) continue;
    const entry = tally.get(reaction.postId) ?? { likeCount: 0, loveCount: 0 };
    if (reaction.degree === 1) entry.likeCount += 1;
    else if (reaction.degree === 2) entry.loveCount += 1;
    tally.set(reaction.postId, entry);
  }
  return tally;
}

export function digestPostRefKey(ref: DigestPostRef) {
  return `${ref.featureName}\u0000${ref.postId ?? ""}\u0000${ref.postName}\u0000${ref.memberId ?? ""}`;
}
const refKey = digestPostRefKey;

/**
 * Resolves each activity row to its room post (by stored post id, falling back to the post title
 * for legacy rows) and loads the post image, excerpt, and reaction/comment counts. Posts that are
 * not visible to the whole family (drafts, templates, private posts, unshared albums) resolve to null.
 */
export async function resolveDigestPostDetails(familyId: number, refs: DigestPostRef[]): Promise<Map<string, DigestPostDetails | null>> {
  const result = new Map<string, DigestPostDetails | null>();
  const refsByFeature = new Map<string, DigestPostRef[]>();
  for (const ref of refs) {
    result.set(refKey(ref), null);
    if (!ROOM_RESOLVERS[ref.featureName]) continue;
    refsByFeature.set(ref.featureName, [...(refsByFeature.get(ref.featureName) ?? []), ref]);
  }

  await Promise.all([...refsByFeature.entries()].map(async ([featureName, featureRefs]) => {
    const resolver = ROOM_RESOLVERS[featureName]!;
    const lookup: Lookup = {
      ids: [...new Set(featureRefs.flatMap((ref) => (ref.postId ? [ref.postId] : [])))],
      titles: [...new Set(featureRefs.filter((ref) => !ref.postId).map((ref) => ref.postName))],
    };
    const posts = await resolver.loadPosts(familyId, lookup);
    const postById = new Map(posts.map((post) => [post.id, post]));
    const matched = new Map<string, PostRow>();
    for (const ref of featureRefs) {
      const post = ref.postId
        ? postById.get(ref.postId)
        : posts.find((candidate) => candidate.title === ref.postName &&
          (!resolver.matchTitleByMember || candidate.memberId === ref.memberId));
      if (post?.visible) matched.set(refKey(ref), post);
    }

    const postIds = [...new Set([...matched.values()].map((post) => post.id))];
    if (postIds.length === 0) return;
    const [reactions, commentCounts] = await Promise.all([resolver.loadReactions(postIds), resolver.loadCommentCounts(postIds)]);
    const submitterByPostId = new Map([...matched.values()].map((post) => [post.id, post.memberId]));
    const reactionTally = tallyReactions(reactions, submitterByPostId);
    const commentsByPostId = new Map(commentCounts.map((row) => [row.postId, Number(row.count)]));

    for (const [key, post] of matched) {
      const reactionCounts = reactionTally.get(post.id);
      result.set(key, {
        postId: post.id,
        imageValue: post.imageValue,
        excerpt: post.excerpt?.trim() || null,
        likeCount: reactionCounts?.likeCount ?? 0,
        loveCount: reactionCounts?.loveCount ?? 0,
        commentCount: commentsByPostId.get(post.id) ?? 0,
      });
    }
  }));

  return result;
}
