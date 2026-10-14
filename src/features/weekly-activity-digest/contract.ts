import { z } from "zod";

export const ACTIVITY_WEIGHTS = {
  POST_CREATED: 3,
  COMMENT_CREATED: 2,
  DISCUSS_START: 2,
  DISCUSS_REPLY: 1,
  THREAD_CREATED: 2,
  ALBUM_SHARED: 2,
  LIKE_ADDED: 1,
  LOVE_ADDED: 1,
  DISCUSS_REACT: 1,
} as const;

export const MIN_UNIQUE_POSTERS = 2;
const utcDate = z.iso.datetime({ precision: undefined, offset: false });

export const digestRequestSchema = z.object({
  weekStartUtc: utcDate,
  weekEndUtc: utcDate,
  dryRun: z.boolean().default(false),
  forceReplay: z.boolean().default(false),
  familyIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(10000).optional(),
  minActivityScoreOverride: z.number().int().min(0).max(2147483647).optional(),
  operatorNotes: z.string().trim().min(1).max(2000).optional(),
}).strict().superRefine((input, ctx) => {
  const start = new Date(input.weekStartUtc);
  const end = new Date(input.weekEndUtc);
  if (start.getUTCDay() !== 1 || start.getUTCHours() !== 0 ||
      start.getUTCMinutes() !== 0 || start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) {
    ctx.addIssue({ code: "custom", path: ["weekStartUtc"], message: "Must be Monday 00:00:00Z." });
  }
  if (end.getTime() !== start.getTime() + 7 * 86400000 - 1) {
    ctx.addIssue({ code: "custom", path: ["weekEndUtc"], message: "Must be the same week's Sunday 23:59:59.999Z." });
  }
  if (input.familyIds && new Set(input.familyIds).size !== input.familyIds.length) {
    ctx.addIssue({ code: "custom", path: ["familyIds"], message: "Family IDs must be unique." });
  }
  if (input.forceReplay && !input.operatorNotes) {
    ctx.addIssue({ code: "custom", path: ["operatorNotes"], message: "Operator notes are required for forceReplay." });
  }
});

export type DigestRequest = z.infer<typeof digestRequestSchema>;
export type Recipient = { memberId: number; email: string; displayName: string };
export type ActivityScore = {
  activityScore: number;
  uniquePosters: number;
  totalEvents: number;
  thresholdMet: boolean;
  weightedBreakdown: { actionType: string; count: number; score: number }[];
};
export type DigestHighlightPost = {
  /** Stored image value from the room (S3 key/app link/external URL); the email sender rewrites it to an email-safe URL. */
  imageUrl: string | null;
  tags: string[];
  excerpt: string | null;
  likeCount: number;
  loveCount: number;
  commentCount: number;
};
export type DigestHighlight = {
  memberName: string;
  /** Stored avatar value; rewritten to an email-safe URL by the email sender. */
  memberImageUrl: string | null;
  actionType: string;
  featureName: string;
  postName: string;
  /** Null when the post could not be resolved or is not visible to the whole family. */
  post: DigestHighlightPost | null;
};
export type DigestActivity = {
  familyId: number;
  familyName: string;
  weekStartUtc: string;
  weekEndUtc: string;
  topMembers: { displayName: string; count: number }[];
  byActionType: { name: string; count: number }[];
  byFeature: { name: string; count: number }[];
  featureDashboard: { featureName: string; actionType: string; count: number }[];
  memberDashboard: { memberName: string; actionType: string; count: number }[];
  highlights: DigestHighlight[];
  newMembers: { memberId: number; memberName: string; memberImageUrl: string | null }[];
};

export function getConfiguredThreshold(): number {
  const value = process.env.FS_DIGEST_MIN_ACTIVITY_SCORE ?? "12";
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new Error("FS_DIGEST_MIN_ACTIVITY_SCORE must be a nonnegative integer.");
  }
  return Number(value);
}
