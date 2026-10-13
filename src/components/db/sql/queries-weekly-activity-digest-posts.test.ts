import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/db/drizzle", () => ({ default: {} }));

import { digestPostRefKey, ROOM_RESOLVERS, tallyReactions } from "./queries-weekly-activity-digest-posts";

describe("weekly digest post details", () => {
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
    for (const featureName of ["TV Room", "Movie Theater", "Music Salon", "The Kitchen", "Poetry Nook", "Reading Room", "Blogs", "Family Blog", "Family Gallery"]) {
      expect(ROOM_RESOLVERS[featureName]).toBeDefined();
    }
    expect(ROOM_RESOLVERS["Family Discussions"]).toBeUndefined();
  });

  it("builds distinct keys for id-linked and title-matched references", () => {
    const byId = digestPostRefKey({ featureName: "Blogs", postName: "Hi", postId: 5, memberId: 1 });
    const byTitle = digestPostRefKey({ featureName: "Blogs", postName: "Hi", postId: null, memberId: 1 });
    expect(byId).not.toBe(byTitle);
  });
});
