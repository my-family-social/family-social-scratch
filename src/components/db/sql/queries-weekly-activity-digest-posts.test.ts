import { afterEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/components/db/drizzle", () => ({ default: { select: dbMocks.select } }));

import { digestPostRefKey, resolveDigestPostDetails, ROOM_RESOLVERS, tallyReactions } from "./queries-weekly-activity-digest-posts";
import { buildEmailImageUrl } from "@/lib/email-image-signing";

describe("weekly digest post details", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["TV Room", "Movie Theater", "Music Room", "The Kitchen", "Reading Room", "Blogs"])(
    "extracts the first body line for %s rather than a summary",
    async (featureName) => {
      const resolver = ROOM_RESOLVERS[featureName]!;
      vi.spyOn(resolver, "loadPosts").mockResolvedValue([{
        id: 1, title: "Post", memberId: 64, imageValue: null, visible: true, excerpt: "Old summary",
        contentJson: JSON.stringify({ type: "doc", content: [
          { type: "paragraph", content: [{ type: "text", text: "First body line." }] },
          { type: "paragraph", content: [{ type: "text", text: "Later body line." }] },
        ] }),
      }]);
      vi.spyOn(resolver, "loadReactions").mockResolvedValue([]);
      vi.spyOn(resolver, "loadCommentCounts").mockResolvedValue([]);
      if (resolver.loadTags) {
        vi.spyOn(resolver, "loadTags");
        vi.mocked(resolver.loadTags).mockResolvedValue([]);
      }
      const ref = { featureName, postName: "Post", postId: 1, memberId: 64 };
      const details = await resolveDigestPostDetails(28, [ref]);
      expect(details.get(digestPostRefKey(ref))?.excerpt).toBe("First body line. Later body line.");
    },
  );
  it("loads the first stored poem verse as preview content", async () => {
    const verse = JSON.stringify({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "First verse line." }] },
    ] });
    dbMocks.select
      .mockReturnValueOnce({ from: () => ({ where: async () => [
        { id: 1, title: "Poem", memberId: 64, status: "published" },
      ] }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => [
        { poemId: 1, contentJson: verse }, { poemId: 1, contentJson: "{}" },
      ] }) }) });
    const posts = await ROOM_RESOLVERS["Poetry Nook"]!.loadPosts(28, { ids: [1], titles: [] });
    expect(posts[0]?.contentJson).toBe(verse);
  });
  it("loads book analysis text rather than reader comments", async () => {
    const contentJson = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Book analysis."}]}]}';
    dbMocks.select
      .mockReturnValueOnce({ from: () => ({ where: async () => [
        { id: 1, title: "Book", memberId: 64, status: "published" },
      ] }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: async () => [
        { bookId: 1, contentJson },
      ] }) }) });
    const posts = await ROOM_RESOLVERS["Reading Room"]!.loadPosts(28, { ids: [1], titles: [] });
    expect(posts[0]?.contentJson).toBe(contentJson);
  });
  it("counts likes and loves while ignoring the submitter's own rating and no-rating rows", () => {
    const tally = tallyReactions([
      { postId: 1, memberId: 10, degree: 2 },
      { postId: 1, memberId: 11, degree: 1 },
      { postId: 1, memberId: 12, degree: 2 },
      { postId: 1, memberId: 13, degree: -1 },
      { postId: 2, memberId: 11, degree: 1 },
    ], new Map([[1, 10], [2, 20]]));
    expect(tally.get(1)).toEqual({ likeCount: 1, loveCount: 1 });
    expect(tally.get(2)).toEqual({ likeCount: 1, loveCount: 0 });
  });

  it("supports every room that writes POST_CREATED or DISCUSS_START activity", () => {
    for (const featureName of ["TV Room", "Movie Theater", "Home Theater", "Music Salon", "Music Room", "The Kitchen", "Poetry Nook", "Reading Room", "Blogs", "Family Blog", "Family Gallery"]) {
      expect(ROOM_RESOLVERS[featureName]).toBeDefined();
    }
    expect(ROOM_RESOLVERS["Family Discussions"]).toBeUndefined();
    expect(ROOM_RESOLVERS["Home Theater"]).toBe(ROOM_RESOLVERS["Movie Theater"]);
  });

  it.each([6, null])("resolves Music Room artwork and counts for postId %s", async (postId) => {
    const resolver = ROOM_RESOLVERS["Music Room"]!;
    expect(resolver).toBe(ROOM_RESOLVERS["Music Salon"]);
    const imageValue = "https://bucket.s3.us-east-2.amazonaws.com/family-28/music/album.jpg";
    const loadPosts = vi.spyOn(resolver, "loadPosts").mockResolvedValue([
      { id: 6, title: "Album", memberId: 64, imageValue, excerpt: null, visible: true },
    ]);
    vi.spyOn(resolver, "loadReactions").mockResolvedValue([
      { postId: 6, memberId: 63, degree: 1 },
    ]);
    vi.spyOn(resolver, "loadCommentCounts").mockResolvedValue([{ postId: 6, count: 2 }]);
    const ref = { featureName: "Music Room", postName: "Album", postId, memberId: 64 };
    const details = (await resolveDigestPostDetails(28, [ref])).get(digestPostRefKey(ref));
    expect(loadPosts).toHaveBeenCalledWith(28, postId
      ? { ids: [6], titles: [] }
      : { ids: [], titles: ["Album"] });
    expect(details).toEqual({
      postId: 6, imageValue, tags: [], excerpt: null, likeCount: 1, loveCount: 0, commentCount: 2,
    });
    const url = new URL(buildEmailImageUrl({
      siteUrl: "https://example.com", familyId: 28, value: details?.imageValue,
      expiresAt: new Date("2027-01-10"), secret: "0123456789abcdef0123456789abcdef",
    }) ?? "");
    expect(url.pathname).toBe("/api/email-image");
    expect(url.searchParams.get("k")).toBe("family-28/music/album.jpg");
  });

  it("builds distinct keys for id-linked and title-matched references", () => {
    const byId = digestPostRefKey({ featureName: "Blogs", postName: "Hi", postId: 5, memberId: 1 });
    const byTitle = digestPostRefKey({ featureName: "Blogs", postName: "Hi", postId: null, memberId: 1 });
    expect(byId).not.toBe(byTitle);
  });
  it.each(["Reading Room", "Poetry Nook"])("loads tags only for visible %s posts", async (featureName) => {
    const resolver = ROOM_RESOLVERS[featureName]!;
    vi.spyOn(resolver, "loadPosts").mockResolvedValue([
      { id: 1, title: "Visible", memberId: 64, imageValue: null, excerpt: null, visible: true },
      { id: 2, title: "Draft", memberId: 64, imageValue: null, excerpt: null, visible: false },
    ]);
    vi.spyOn(resolver, "loadReactions").mockResolvedValue([]);
    vi.spyOn(resolver, "loadCommentCounts").mockResolvedValue([]);
    vi.spyOn(resolver, "loadTags");
    const loadTags = vi.mocked(resolver.loadTags!).mockResolvedValue([
      { postId: 1, tagName: " Nature " }, { postId: 1, tagName: "Nature" },
      { postId: 1, tagName: " " }, { postId: 1, tagName: "Literary" },
    ]);
    const refs = [1, 2, 3].map((postId) => ({ featureName, postName: "Post", postId, memberId: 64 }));
    const details = await resolveDigestPostDetails(28, refs);
    expect(loadTags).toHaveBeenCalledWith([1]);
    expect(details.get(digestPostRefKey(refs[0]!))?.tags).toEqual(["Nature", "Literary"]);
    expect(details.get(digestPostRefKey(refs[1]!))).toBeNull();
    expect(details.get(digestPostRefKey(refs[2]!))).toBeNull();
  });
});
