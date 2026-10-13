// ...existing code...
import { pgSchema, serial, bigserial, uuid, jsonb, index, boolean, pgEnum, foreignKey, unique } from "drizzle-orm/pg-core";
import {is, like, not, sql } from 'drizzle-orm';
import { number } from "zod";
import { ta } from "date-fns/locale";
import { bookCategoryTagReference, blogTagReference, poemCategoryTagReference, showTagReference, 
         movieTagReference, musicTagReference, featureReference, memberOptionReference,
         guidedTourReference, guidedTourStepReference  
        } from "./global-schema-tables"; 
export const familySchema = pgSchema('family_schema');



export const familyStatus = pgEnum('status', ['trial', 'active', 'expired']);
export const inviteStatus = pgEnum('status', ['invited', 'joined', 'resend', 'declined']);
export const memberStatus = pgEnum('status', ['active', 'resigned']);
export const optionReferenceCategory = pgEnum('category', [
  'feature', 'notification', 'admin', 'other'
]);

import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
} from "drizzle-orm/pg-core"
import type { AdapterAccount } from "@auth/core/adapters"


export const accounts = familySchema.table("account",
  {
    userId: integer("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccount["type"]>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  })
)

export const verificationTokens = familySchema.table(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
)

export const sessions = familySchema.table("session", {
  sessionToken: text("sessionToken").primaryKey().notNull(),
  userId: integer("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})


/* Table below is a hybrid using the original user table with addition OAuth columns */
export const user = familySchema.table("user", {
  id: serial("id").primaryKey(),
  name: text("name"), 
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  twoFactorSecret: text("2fa_secret"),
  twoFactorActivated: boolean("2fa_activated").default(false),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  familyId: integer("fk_family_id").notNull().references(() => family.id),
  memberId: integer("fk_member_id").references(() => member.id),
});

export const user2faCode = familySchema.table("user_2fa_code", {
  id: serial("id").primaryKey(),
  code2fa: integer("code_number").notNull(),
  userId: integer("fk_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
})


/*------------------------------- Essential Family Schema ------------------------------ */
export const passwordReset = familySchema.table("password_reset", {
  id: serial("id").primaryKey(),
  userId: integer("fk_user_id").notNull().references(() => user.id, {onDelete: "cascade"}).unique(),
  token: text("token").notNull(),
  tokenExpiry: timestamp("token_expiry"),
}, (table) => [
  index('reset_token_idx').on(table.token),
]);

export const familyActivity = familySchema.table("family_activity", {
  id: serial("id").primaryKey(),
  actionType: text("action_type").notNull(),
  featureName: text("feature_name").notNull(),
  postName: text("post_name").notNull(),
  // Id of the room post (movie, show, blog_post, gallery_album, ...) identified by featureName; null for legacy rows.
  postId: integer("post_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").references(() => member.id, {onDelete: 'cascade'}),
}, (table) => [
  index('family_activity_family_id_idx').on(table.familyId),
  index('family_activity_member_id_idx').on(table.memberId),

]);

export const pwaMutationRequest = familySchema.table("pwa_mutation_request", {
  id: serial("id").primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  mutationName: text("mutation_name").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index('pwa_mutation_request_family_id_idx').on(table.familyId),
  index('pwa_mutation_request_member_id_idx').on(table.memberId),
]);

export const memberOption = familySchema.table("member_option", {
  id: serial("id").primaryKey(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  optionId: integer("fk_option_id").notNull().references(() => memberOptionReference.id, {onDelete: 'cascade'}),
  isSelected: boolean("is_selected").notNull().default(false),
});

export const familyActivityDigestRun = familySchema.table("family_activity_digest_run", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").notNull().unique(),
  weekStartUtc: timestamp("week_start_utc", { withTimezone: true }).notNull(),
  weekEndUtc: timestamp("week_end_utc", { withTimezone: true }).notNull(),
  kickoffIdempotencyKey: text("kickoff_idempotency_key").notNull(),
  triggerSource: text("trigger_source").notNull().default("eventbridge"),
  dryRun: boolean("dry_run").notNull().default(false),
  forceReplay: boolean("force_replay").notNull().default(false),
  familyIds: jsonb("family_ids").$type<number[]>().notNull(),
  thresholdValue: integer("threshold_value").notNull(),
  operatorNotes: text("operator_notes"),
  status: text("status").$type<"queued" | "processing" | "completed" | "failed">().notNull().default("queued"),
  familiesScanned: integer("families_scanned").notNull().default(0),
  familiesThresholdMet: integer("families_threshold_met").notNull().default(0),
  recipientsTotal: integer("recipients_total").notNull().default(0),
  emailsSent: integer("emails_sent").notNull().default(0),
  emailsFailed: integer("emails_failed").notNull().default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("digest_run_week_key_uq").on(table.weekStartUtc, table.kickoffIdempotencyKey),
  index("digest_run_status_idx").on(table.status),
]);

export const familyActivityDigestResult = familySchema.table("family_activity_digest_result", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").notNull().references(() => familyActivityDigestRun.runId, { onDelete: "cascade" }),
  familyId: integer("fk_family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  weekStartUtc: timestamp("week_start_utc", { withTimezone: true }).notNull(),
  weekEndUtc: timestamp("week_end_utc", { withTimezone: true }).notNull(),
  activityScore: integer("activity_score").notNull().default(0),
  uniquePosters: integer("unique_posters").notNull().default(0),
  totalEvents: integer("total_events").notNull().default(0),
  thresholdValue: integer("threshold_value").notNull(),
  thresholdMet: boolean("threshold_met").notNull().default(false),
  recipientsEligible: integer("recipients_eligible").notNull().default(0),
  emailsAttempted: integer("emails_attempted").notNull().default(0),
  emailsSent: integer("emails_sent").notNull().default(0),
  emailsFailed: integer("emails_failed").notNull().default(0),
  status: text("status").$type<"skipped" | "sent-preview" | "sent" | "failed">().notNull().default("skipped"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  unique("digest_result_run_family_uq").on(table.runId, table.familyId),
  index("digest_result_family_week_idx").on(table.familyId, table.weekStartUtc),
  index("digest_result_run_idx").on(table.runId),
  index("digest_result_status_idx").on(table.status),
]);

export const familyActivityDigestDelivery = familySchema.table("family_activity_digest_delivery", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id").notNull().references(() => familyActivityDigestRun.runId),
  familyId: integer("fk_family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  weekStartUtc: timestamp("week_start_utc", { withTimezone: true }).notNull(),
  recipientEmail: text("recipient_email").notNull(),
  providerMessageId: text("provider_message_id"),
  status: text("status").$type<"sending" | "sent" | "failed" | "unknown">().notNull(),
  attemptsInRun: integer("attempts_in_run").notNull().default(1),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
}, (table) => [
  unique("digest_delivery_family_week_member_uq").on(table.familyId, table.weekStartUtc, table.memberId),
  index("digest_delivery_run_idx").on(table.runId),
]);

export const blogPost = familySchema.table("blog_post", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  excerpt: text("excerpt").notNull().default(""),
  contentJson: text("content_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  coverImageS3Key: text("cover_image_s3_key"),
  coverImageAlt: text("cover_image_alt"),
  videoUrl: text("video_url"),
  videoMinutes: integer("video_minutes").notNull().default(0),
  allowComments: boolean("allow_comments").notNull().default(true),
  authorMemberId: integer("fk_author_member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  familyId: integer("fk_family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
},
  (table) => [
    index("blog_post_family_created_idx").on(table.familyId, table.createdAt),
    index("blog_post_family_status_created_idx").on(table.familyId, table.status, table.createdAt),
    index("blog_post_author_created_idx").on(table.authorMemberId, table.createdAt),
    unique("blog_post_family_slug_uq").on(table.familyId, table.slug),
  ]
);

export const blogPostTag = familySchema.table("blog_post_tag", {
  id: serial("id").primaryKey(),
  blogPostId: integer("fk_blog_post_id").notNull().references(() => blogPost.id, { onDelete: "cascade" }),
  blogTagId: integer("fk_blog_tag_id").notNull().references(() => blogTagReference.id, { onDelete: "cascade" }),
},
  (table) => [
    index("blog_post_tag_post_id_idx").on(table.blogPostId),
    index("blog_post_tag_tag_id_idx").on(table.blogTagId),
    unique("blog_post_tag_post_tag_uq").on(table.blogPostId, table.blogTagId),
  ]
);

export const blogComment = familySchema.table("blog_comment", {
  id: serial("id").primaryKey(),
  contentJson: text("content_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  softDeletedAt: timestamp("soft_deleted_at"),
  blogPostId: integer("fk_blog_post_id").notNull().references(() => blogPost.id, { onDelete: "cascade" }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
},
  (table) => [
    index("blog_comment_post_id_idx").on(table.blogPostId),
    index("blog_comment_member_id_idx").on(table.memberId),
  ]
);

export const blogLikeness = familySchema.table("blog_likeness", {
  id: serial("id").primaryKey(),
  likenessDegree: integer("likeness_degree").notNull().default(-1),
  createdAt: timestamp("created_at").defaultNow(),
  blogPostId: integer("fk_blog_post_id").notNull().references(() => blogPost.id, { onDelete: "cascade" }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
},
  (table) => [
    index("blog_likeness_post_id_idx").on(table.blogPostId),
    index("blog_likeness_member_id_idx").on(table.memberId),
    unique("blog_likeness_post_member_uq").on(table.blogPostId, table.memberId),
  ]
);

export const blogMedia = familySchema.table("blog_media", {
  id: serial("id").primaryKey(),
  s3ObjectKey: text("s3_object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull().default(0),
  width: integer("width"),
  height: integer("height"),
  altText: text("alt_text"),
  caption: text("caption"),
  createdAt: timestamp("created_at").defaultNow(),
  blogPostId: integer("fk_blog_post_id").references(() => blogPost.id, { onDelete: "cascade" }),
  uploadMemberId: integer("fk_upload_member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  familyId: integer("fk_family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
},
  (table) => [
    index("blog_media_post_id_idx").on(table.blogPostId),
    index("blog_media_uploader_id_idx").on(table.uploadMemberId),
    index("blog_media_family_id_idx").on(table.familyId),
  ]
);

export const book = familySchema.table("book", {
  id: serial("id").primaryKey(),
  bookTitle: text("book_title").notNull().unique(),
  authorName: text("author_name").notNull().default("anonymous"),
  bookLanguage: text("book_language").notNull().default("english"),
  bookYear: integer("book_year").notNull().default(0),
  bookSeriesName: text("book_series_name"),
  bookSource: text("book_source").notNull().default("bookstore"),
  status: text("status").notNull().default("published"),
  createdAt: timestamp("created_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('book_member_id_idx').on(table.memberId),
    index('book_family_id_idx').on(table.familyId),
  ]
);

export const bookBiblio = familySchema.table("book_biblio", {
  id: serial("id").primaryKey(),
  bookTitle: text("book_title").notNull(),
  authorName: text("author_name").notNull().default("anonymous"),
  bookSeriesName: text("book_series_name"),
  status: text("status").notNull().default("private"),
  summaryJson: text("summary_json").notNull().default("{}"),
  commentsJson: text("comment_json").notNull().default("{}"),
  publishedYear: integer("published_year").notNull().default(0),
  readYear: integer("read_year").notNull().default(0),
  rating: integer("rating").notNull().default(0), // Rating out of 5; 0 means not rated yet
  updatedAt: timestamp("updated_at").defaultNow(),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('book_biblio_family_id_idx').on(table.familyId),
    index('book_biblio_member_id_idx').on(table.memberId),
  ]
);

export const bookBiblioTag = familySchema.table("book_biblio_tag", {
  id: serial("id").primaryKey(),
  biblioId: integer("fk_biblio_id").notNull().references(() => bookBiblio.id, {onDelete: 'cascade'}),
  tagId: integer("fk_tag_id").notNull().references(() => bookCategoryTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('book_biblio_biblio_id_idx').on(table.biblioId),
    index('book_biblio_tag_id_idx').on(table.tagId),
  ]
);

export const bookComment = familySchema.table("book_comment", {
  id: serial("id").primaryKey(),
  isBookAnalysis: boolean("is_book_analysis").notNull().default(false),
  commentJson: text("comment_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  bookId: integer("fk_book_id").notNull().references(() => book.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('book_comment_book_id_idx').on(table.bookId),
    index('book_comment_member_id_idx').on(table.memberId),
  ]
);

export const bookCategoryTag = familySchema.table("book_category_tag", {
  id: serial("id").primaryKey(),
  bookId: integer("fk_book_id").notNull().references(() => book.id, {onDelete: 'cascade'}),
  tagReferenceId: integer("fk_tag_id").notNull().references(() => bookCategoryTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('book_category_tag_book_id_idx').on(table.bookId),
    index('book_category_tag_reference_id_idx').on(table.tagReferenceId),
  ]
);

export const bookLike = familySchema.table("book_like", {
  id: serial("id").primaryKey(),
  bookId: integer("fk_book_id").notNull().references(() => book.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  reactionType: integer("reaction_type").notNull().default(1), // -1 = dislike, 1 = like, 2 = love
  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => [
    index("book_like_book_id_idx").on(table.bookId),
    index("book_like_member_id_idx").on(table.memberId),
    unique("book_like_member_id_uq").on(table.bookId, table.memberId),
  ]
);

export const club = familySchema.table("club", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("active"),
  clubName: text("club_name").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  clubFounderId: integer("fk_club_founder_id").references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('club_family_id_idx').on(table.familyId),
    index('club_club_founder_id_idx').on(table.clubFounderId),
]);

export const club_session = familySchema.table("club_session", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("created_at").defaultNow(),
  finishesAt: timestamp("updated_at"),
  targetType: text("target_type").notNull(),
  targetId: integer("fk_target_id").notNull(),
  clubId: integer("fk_club_id").notNull().references(() => club.id, {onDelete: 'cascade'}),
  moderatorId: integer("fk_post_member_id").references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('club_session_moderator_id_idx').on(table.moderatorId),
    index('club_session_club_id_idx').on(table.clubId),
]);

export const discussThread = familySchema.table("discuss_thread", {
  id: serial("id").primaryKey(),
  discussTopic: text("title").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  topicJson: text("topic_json"),
  closedAt: timestamp("closed_at"),
  targetType: text("target_type").notNull(),
  targetId: integer("fk_target_id").notNull(),
  postMemberId: integer("fk_post_member_id").references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id),
},
  (table) => [
    index('discuss_thread_family_created_idx').on(table.familyId),
    index('discuss_thread_post_member_created_idx').on(table.postMemberId),
    index('discuss_thread_target_id_idx').on(table.targetId, table.targetType),
]);

export const discussPostReply = familySchema.table("discuss_post_reply", {
  id: serial("id").primaryKey(),
  postReplyType: text("post_reply_type").notNull().default("post"),
  summary: text("summary").notNull(),
  contentJson: text("content_json").notNull().default("{}"),
  seqNo: integer("seq_no").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  parentPostId: integer("parent_post_id"),
  rootPostId: integer("root_post_id"),
  discussThreadId: integer("fk_discuss_thread_id").notNull().references(() => discussThread.id, {onDelete: 'cascade'}),
  authorMemberId: integer("fk_author_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  },
  (table) => [
    foreignKey({
      columns: [table.parentPostId],
      foreignColumns: [table.id],
      name: "thread_post_reply_parent_post_fkey",
    }),
    foreignKey({
      columns: [table.rootPostId],
      foreignColumns: [table.id],
      name: "thread_post_reply_root_post_fkey",
    }),
    index('discuss_post_reply_discuss_thread_seq_idx').on(table.discussThreadId, table.seqNo),
    index('discuss_post_reply_discuss_thread_idx').on(table.discussThreadId),
    index('discuss_post_reply_parent_post_idx').on(table.parentPostId),
    index('discuss_post_reply_author_created_idx').on(table.authorMemberId),
  ]);

export const discussLike = familySchema.table("discuss_like", {
  id: serial("id").primaryKey(),
  discussPostId: integer("fk_discuss_post_id").notNull().references(() => discussPostReply.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  reactionType: integer("reaction_type").notNull().default(1), // 1 = like (thumbs up), 2 = love (heart)
  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => [
    index("discuss_like_discuss_post_id_idx").on(table.discussPostId),
    index("discuss_like_member_id_idx").on(table.memberId),
    unique("discuss_like_discuss_post_member_id_uq").on(table.discussPostId, table.memberId),
  ]
);

export const family = familySchema.table("family", {
  id: serial("id").primaryKey(),
  name: text("family_name").notNull().unique(),
  status: text("status").notNull().default("trial"),
  expirationDate: timestamp("expiration_date").default(sql`CURRENT_DATE + INTERVAL '28 days'`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const familyInvitation = familySchema.table("family_invitation", {
  id: serial("id").primaryKey(),
  email: text("invited_email").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  status: text("status").notNull().default("invited"),
  expirationDate: timestamp("expiration_date").notNull().default(sql`CURRENT_DATE + INTERVAL '7 days'`),
  secret: text("secret"),
  inviteToken: text("invite_token"),
  inviteFounderMessage: text("invite_founder_message"),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
  createdAt: timestamp("created_at").defaultNow(),
  statusUpdate: timestamp("status_update"),
}, (table) => [
  index('invite_email_idx').on(table.email),
  index('invite_token_idx').on(table.inviteToken),
]);

export const familyFeatureConfig = familySchema.table("family_feature_config", {
  id: serial("id").primaryKey(),
  isSelected: boolean("is_selected").notNull().default(false),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
  featureId: integer("fk_feature_id").notNull().references(() => featureReference.id, {onDelete: 'cascade'}),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index('family_feature_config_family_id_idx').on(table.familyId),
  index('family_feature_config_feature_id_idx').on(table.featureId),
]);

export const familyS3Credentials = familySchema.table("family_s3_credentials", {
  id: serial("id").primaryKey(),
  encryptedAccessKey: text("encrypted_access_key").notNull(),
  encryptedSecretKey: text("encrypted_secret_key").notNull(),
  bucketName: text("bucket_name").notNull(),
  region: text("region").notNull().default("us-east-2"),  
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
}, (table) => [
  index('family_s3_credentials_family_id_idx').on(table.familyId),
  index('family_s3_active_credential_idx').on(table.familyId, table.isActive),
]);

export const member = familySchema.table("member", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  nickName: text("nick_name").notNull().default(""),
  email: text("email").notNull(),
  birthday: text("birthday").notNull().default("01/01/1970"),
  cellPhone: text("cell_phone").notNull().default("(000) 000-0000"),
  familyId: integer("fk_family_id").notNull().references(() => family.id),
  status: text("status").notNull().default("active"),
  memberImageUrl: text("member_image_url"),
  isFounder: boolean("is_family_founder").notNull().default(false),
  isGuest: boolean("is_guest").notNull().default(false),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index('member_email_idx').on(table.email),
]);

export const galleryPhoto = familySchema.table("gallery_photo", {
  id: serial("id").primaryKey(),
  caption: text("caption"),
  photoYear: integer("photo_year").notNull().default(0),
  photoImageUrl: text("photo_image_url").notNull(),
  photoPosition: text("photo_position").notNull().default("portrait"),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('gallery_photo_member_id_idx').on(table.memberId),
]);

export const galleryAlbum = familySchema.table("gallery_album", {
  id: serial("id").primaryKey(),
  caption: text("caption"),
  albumName: text("album_name").notNull(),
  albumJson: text("album_json").notNull().default("{}"),
  isShared: boolean("is_shared").notNull().default(false),
  isLiked: boolean("is_liked").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('gallery_album_member_id_idx').on(table.memberId),
]);

export const galleryAlbumPhoto = familySchema.table("gallery_album_photo", {
  id: serial("id").primaryKey(),
  caption: text("caption"),
  albumPhotoDescription: text("album_photo_description"),
  seqNo: integer("seq_no").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
  photoId: integer("fk_photo_id").notNull().references(() => galleryPhoto.id, {onDelete: 'cascade'}),
  albumId: integer("fk_album_id").notNull().references(() => galleryAlbum.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('gallery_album_photo_member_id_idx').on(table.memberId),
    index('gallery_album_photo_photo_id_idx').on(table.photoId),
    index('gallery_album_photo_album_id_idx').on(table.albumId),
]);

export const galleryAlbumPhotoLike = familySchema.table("gallery_album_photo_like", {
  id: serial("id").primaryKey(),
  likeType: integer("like_type").notNull().default(1), // 1 = like (thumbs up), 2 = love (heart)
  albumPhotoId: integer("fk_gallery_album_photo_id").notNull().references(() => galleryAlbumPhoto.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => [
    index("gallery_album_photo_like_gallery_album_photo_id_idx").on(table.albumPhotoId),
    index("gallery_album_photo_like_member_id_idx").on(table.memberId),
  ]
);

export const galleryAlbumComment = familySchema.table("gallery_album_photo_comment", {
  id: serial("id").primaryKey(),
  commentText: text("comment_text").notNull().default(""),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  albumId: integer("fk_gallery_album_id").notNull().references(() => galleryAlbum.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => [
    index("gallery_album_comment_member_id_idx").on(table.memberId),
    index("gallery_album_comment_gallery_album_id_idx").on(table.albumId),
  ]
);

export const gameMetadata = familySchema.table("game_metadata", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  highOrLo: text("high_or_lo").notNull().default("high"),
  scoreUom: text("score_uom").notNull().default("points"),
  isRoundBased: boolean("is_round_based").notNull().default(true),
  maxRounds: integer("max_rounds").notNull().default(12),
  maxPlayers: integer("max_players").notNull().default(4),
  roundsOrder: text("rounds_order").notNull().default("desc"),
  winningScore: integer("winning_score").notNull().default(-1),
  supportsTeams: boolean("supports_teams").notNull().default(false),
});

export const gameState = familySchema.table("game_state", {
  id: serial("id").primaryKey(),
  gameTitle: text("game_title").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  gameMetaId: integer("fk_game_meta_id").notNull().references(() => gameMetadata.id),
  familyId: integer("fk_family_id").notNull().references(() => family.id),
},
  (table) => [
    index('game_state_metadata_id_idx').on(table.gameMetaId),
    index('game_state_family_id_idx').on(table.familyId),
]);

export const gamePlayerState = familySchema.table("game_player_state", {
  id: serial("id").primaryKey(),
  playPosition: integer("play_position"),
  status: text("status").notNull().default("active"),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id),
},
  (table) => [
    index('game_player_state_member_id_idx').on(table.memberId),
    index('game_player_state_family_id_idx').on(table.familyId),
]);


export const gamePlayerRound = familySchema.table("game_player_round", {
  id: serial("id").primaryKey(),
  roundNo: integer("round_no").notNull().default(1),
  roundScore: integer("round_score").notNull().default(0),
  cumulativeScore: integer("cumulative_score").notNull().default(0),
  gameId: integer("fk_game_id").notNull().references(() => gameState.id),
  gamePlayerId: integer("fk_game_player_id").notNull().references(() => gamePlayerState.id),
},
  (table) => [
    index('game_player_round_game_player_id_idx').on(table.gamePlayerId),
    index('game_player_round_game_id_idx').on(table.gameId),
]);
export const guidedMemberTourProgress = familySchema.table("guided_member_tour_progress", {
  id: serial("id").primaryKey(),
  versionMajor: integer("version_major").notNull().default(1),
  versionMinor: integer("version_minor").notNull().default(0),
  versionPatch: integer("version_patch").notNull().default(0),
  status: text("status").notNull().default("not_started"),
  currentStepNo: integer("current_step_no").notNull().default(1),
  startedAt: timestamp("started_at"),
  lastSeenAt: timestamp("last_seen_at"),
  completedAt: timestamp("completed_at"),
  skippedAt: timestamp("skipped_at"),
  dismissedAt: timestamp("dismissed_at"),
  neverShowAgain: boolean("never_show_again").notNull().default(false),
  restartCount: integer("restart_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: "cascade" }),
  familyId: integer("fk_family_id").notNull().references(() => family.id, { onDelete: "cascade" }),
  tourId: integer("fk_tour_id").notNull().references(() => guidedTourReference.id, { onDelete: "cascade" }),
},
(table) => [
  index("member_tour_progress_member_status_updated_idx").on(table.memberId, table.status, table.updatedAt),
  index("member_tour_progress_family_member_idx").on(table.familyId, table.memberId),
  unique("member_tour_progress_member_family_tour_version_uq").on(
    table.memberId,
    table.familyId,
    table.tourId,
    table.versionMajor,
    table.versionMinor,
    table.versionPatch,
  ),
]);

export const guidedMemberTourStepProgress = familySchema.table("guided_member_tour_step_progress", {
  id: serial("id").primaryKey(),
  stepNo: integer("step_no").notNull(),
  status: text("status").notNull().default("not_started"),
  viewedAt: timestamp("viewed_at"),
  completedAt: timestamp("completed_at"),
  skippedAt: timestamp("skipped_at"),
  timeSpentMs: integer("time_spent_ms").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberTourProgressId: integer("fk_member_tour_progress_id").notNull().references(() => guidedMemberTourProgress.id, { onDelete: "cascade" }),
  stepId: integer("fk_step_id").notNull().references(() => guidedTourStepReference.id, { onDelete: "cascade" }),
},
(table) => [
  index("member_tour_step_progress_member_progress_status_idx").on(table.memberTourProgressId, table.status),
  index("member_tour_step_progress_step_no_idx").on(table.stepNo),
  unique("member_tour_step_progress_member_progress_step_uq").on(table.memberTourProgressId, table.stepId),
]);

export const movie = familySchema.table("movie", {
  id: serial("id").primaryKey(),
  movieTitle: text("movie_title").notNull().unique(),
  movieImageCredit: text("movie_image_credit").notNull().default(""),
  movieJson: text("movie_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  movieImageUrl: text("movie_image_url"),
  movieSiteUrl: text("movie_site_url"),
  movieSiteBackground: text("movie_site_background").notNull().default("#000000"),
  movieDebutYear: integer("movie_year").notNull().default(sql`EXTRACT(YEAR FROM CURRENT_DATE)`),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('movie_member_id_idx').on(table.memberId),
    index('movie_family_id_idx').on(table.familyId),
  ]
);

export const movieComment = familySchema.table("movie_comment", {
  id: serial("id").primaryKey(),
  ismovieReviewer: boolean("is_movie_reviewer").notNull().default(false),
  commentJson: text("comment_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  movieId: integer("fk_movie_id").notNull().references(() => movie.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('movie_comment_movie_id_idx').on(table.movieId),
    index('movie_comment_member_id_idx').on(table.memberId),
  ]
);

export const movieTemplate = familySchema.table("movie_template", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull().default(""),
  isGlobalTemplate: boolean("is_global_template").notNull().default(false),
  templateJson: text("template_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id"),
  familyId: integer("fk_family_id"),
},
  (table) => [
    index('movie_template_member_id_idx').on(table.memberId),
    index('movie_template_family_id_idx').on(table.familyId),
  ]
);


export const movieTag = familySchema.table("movie_tag", {
  id: serial("id").primaryKey(),
  movieId: integer("fk_movie_id").notNull().references(() => movie.id, {onDelete: 'cascade'}),
  tagId: integer("fk_tag_id").notNull().references(() => movieTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('movie_tag_movie_id_idx').on(table.movieId),
    index('movie_tag_tag_id_idx').on(table.tagId),
  ]
);

export const movieLike = familySchema.table("movie_like", {
  id: serial("id").primaryKey(),
  likenessDegree: integer("likeness_degree").notNull().default(-1),
  movieId: integer("fk_movie_id").notNull().references(() => movie.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  updatedAt: timestamp("updated_at").defaultNow(),
},
(table) => [
  index("movie_like_movie_id_idx").on(table.movieId),
  index("movie_like_member_id_idx").on(table.memberId),
]
);

export const music = familySchema.table("music", {
  id: serial("id").primaryKey(),
  musicTitle: text("music_title").notNull().unique(),
  artistName: text("artist_name").notNull().default(""),
  albumName: text("album_name"),
  musicJson: text("music_json").notNull().default("{}"),
  status: text("status").notNull().default("published"),
  musicType: text("music_type").notNull().default("album"),
  musicImageUrl: text("music_image_url"),
  musicDebutYear: integer("music_year").notNull().default(sql`EXTRACT(YEAR FROM CURRENT_DATE)`),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
},
(table) => [
  index('music_member_id_idx').on(table.memberId),
  index('music_family_id_idx').on(table.familyId),
]
);

export const musicPlaylistMedia = familySchema.table("music_playlist_media", {
  id: serial("id").primaryKey(),
  mediaSource: text("media_source").notNull().default(""),
  mediaSeqNo: integer("media_seq_no").notNull().default(1),
  mediaType: text("media_type").notNull().default("song"),
  mediaUrl: text("media_url").notNull().default(""),
  mediaArtist: text("media_artist").notNull().default(""),
  mediaCaption: text("media_caption").notNull().default(""),
  mediaImageUrl: text("media_image_url"),
  useImageUrl: boolean("use_image_url").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  musicId: integer("fk_music_id").notNull().references(() => music.id, { onDelete: 'cascade' }),
},
  (table) => [
    index("music_media_music_id_idx").on(table.musicId),
  ]
);

export const musicComment = familySchema.table("music_comment", {
  id: serial("id").primaryKey(),
  isMusicReviewer: boolean("is_music_reviewer").notNull().default(false),
  commentJson: text("comment_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  musicId: integer("fk_music_id").notNull().references(() => music.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('music_comment_music_id_idx').on(table.musicId),
    index('music_comment_member_id_idx').on(table.memberId),
  ]
);

export const musicLyrics = familySchema.table("music_lyrics", {
  id: serial("id").primaryKey(),
  lyricsJson: text("lyrics_json").notNull().default("{}"),
  updatedAt: timestamp("updated_at").defaultNow(),
  status: text("status").notNull().default("draft"),
  musicId: integer("fk_music_id").notNull().references(() => music.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('music_lyrics_music_id_idx').on(table.musicId),
    index('music_lyrics_member_id_idx').on(table.memberId),
  ]
);

export const musicTemplate = familySchema.table("music_template", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull().default(""),
  isGlobalTemplate: boolean("is_global_template").notNull().default(false),
  templateJson: text("template_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('music_template_member_id_idx').on(table.memberId),
    index('music_template_family_id_idx').on(table.familyId),
  ]
);


export const musicTag = familySchema.table("music_tag", {
  id: serial("id").primaryKey(),
  musicId: integer("fk_music_id").notNull().references(() => music.id, {onDelete: 'cascade'}),
  tagId: integer("fk_tag_id").notNull().references(() => musicTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('music_tag_music_id_idx').on(table.musicId),
    index('music_tag_tag_id_idx').on(table.tagId),
  ]
);

export const musicLike = familySchema.table("music_like", {
  id: serial("id").primaryKey(),
  likenessDegree: integer("likeness_degree").notNull().default(-1),
  musicId: integer("fk_music_id").notNull().references(() => music.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  updatedAt: timestamp("updated_at").defaultNow(),
},
  (table) => [
    index("music_like_music_id_idx").on(table.musicId),
    index("music_like_member_id_idx").on(table.memberId),
  ]
);


export const threadVisibility = pgEnum('visibility', ['public', 'private']);
export const conversationStatus = pgEnum('status', ['active', 'archived', 'closed']);
export const postReplyType = pgEnum('type', ['post', 'reply']);
export const deliveryType = pgEnum('delivery_type', ['threads', 'email', 'sms']);
export const tagName = pgEnum('tag_name', [
  'tv', 'movie', 'music', 'books', 'poetry', 'recipe', 'games', 
  'founder', 'member', 'admin', 'suggestion', 'bug', 'question', 'other',
]);


export const poem = familySchema.table("poem", {
  id: serial("id").primaryKey(),
  poemTitle: text("poem_title").notNull().unique(),
  poetName: text("poet_name").notNull().default("Anonymous"),
  poemSource: text("poem_source").notNull().default("Unknown"),
  poemYear: integer("poem_year").notNull().default(0),
  status: text("status").notNull().default("published"),
  createdAt: timestamp("created_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id),
},
  (table) => [
    index('poem_member_id_idx').on(table.memberId),
    index('poem_family_id_idx').on(table.familyId),
  ]
);

export const poemVerse = familySchema.table("poem_verse", {
  id: serial("id").primaryKey(),
  verseJson: text("verse_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  poemId: integer("fk_poem_id").notNull().references(() => poem.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('poem_verse_poem_id_idx').on(table.poemId),
  ]
);

export const poemComment = familySchema.table("poem_comment", {
  id: serial("id").primaryKey(),
  isPoemAnalysis: boolean("is_poem_analysis").notNull().default(false),
  commentJson: text("comment_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  poemVerseId: integer("fk_poem_verse_id").notNull().references(() => poemVerse.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('poem_comment_poem_verse_id_idx').on(table.poemVerseId),
    index('poem_comment_member_id_idx').on(table.memberId),
  ]
);


export const poemCategoryTag = familySchema.table("poem_category_tag", {
  id: serial("id").primaryKey(),
  poemId: integer("fk_poem_id").notNull().references(() => poem.id, {onDelete: 'cascade'}),
  tagReferenceId: integer("fk_tag_id").notNull().references(() => poemCategoryTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('poem_category_tag_poem_id_idx').on(table.poemId),
    index('poem_category_tag_reference_id_idx').on(table.tagReferenceId),
  ]
);

export const poemLike = familySchema.table("poem_like", {
  id: serial("id").primaryKey(),
  poemId: integer("fk_poem_id").notNull().references(() => poem.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  reactionType: integer("reaction_type").notNull().default(1), // -1 = dislike, 1 = like, 2 = love
  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => [
    index("poem_like_poem_id_idx").on(table.poemId),
    index("poem_like_member_id_idx").on(table.memberId),
    unique("poem_like_poem_member_id_uq").on(table.poemId, table.memberId),
  ]
);

export const recipe = familySchema.table("recipe", {
  id: serial("id").primaryKey(),
  recipeTitle: text("recipe_title").notNull().unique(),
  recipeShortSummary: text("recipe_short_summary").notNull().default(""),
  recipeJson: text("recipe_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  recipeImageUrl: text("recipe_image_url"),
  prepTimeMins: integer("prep_time_minutes").notNull().default(0),
  cookTimeMins: integer("cook_time_minutes").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
  templateId: integer("fk_template_id").references(() => recipeTemplate.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('recipe_member_id_idx').on(table.memberId),
    index('recipe_family_id_idx').on(table.familyId),
    index('recipe_template_id_idx').on(table.templateId),
  ]
);

export const recipeComment = familySchema.table("recipe_comment", {
  id: serial("id").primaryKey(),
  isRecipeProTip: boolean("is_recipe_pro_tip").notNull().default(false),
  commentJson: text("comment_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  recipeId: integer("fk_recipe_id").notNull().references(() => recipe.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('recipe_comment_recipe_id_idx').on(table.recipeId),
    index('recipe_comment_member_id_idx').on(table.memberId),
  ]
);

export const recipeTemplate = familySchema.table("recipe_template", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull().default("").unique(),
  isGlobalTemplate: boolean("is_global_template").notNull().default(false),
  templateJson: text("template_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('recipe_template_member_id_idx').on(table.memberId),
    index('recipe_template_family_id_idx').on(table.familyId),
    unique('recipe_template_family_id_name_uq').on(table.familyId, table.templateName),
  ]
);

export const recipeTagReference = familySchema.table("recipe_tag_reference", {
  id: serial("id").primaryKey(),
  tagName: text("tag_name").notNull().default(""),
  tagDesc: text("tag_description"),
  tagType: text("tag_type").notNull().default("global"),
  status: text("status").notNull().default("active"),
  seqNo: integer("seq_no").notNull().default(1),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const recipeTag = familySchema.table("recipe_tag", {
  id: serial("id").primaryKey(),
  recipeId: integer("fk_recipe_id").notNull().references(() => recipe.id, {onDelete: 'cascade'}),
  tagId: integer("fk_tag_id").notNull().references(() => recipeTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('recipe_tag_recipe_id_idx').on(table.recipeId),
    index('recipe_tag_tag_id_idx').on(table.tagId),
  ]
);

export const recipeLike = familySchema.table("recipe_like", {
  id: serial("id").primaryKey(),
  likenessDegree: integer("likeness_degree").notNull().default(-1),
  recipeId: integer("fk_recipe_id").notNull().references(() => recipe.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  updatedAt: timestamp("updated_at").defaultNow(),
},
  (table) => [
    index("recipe_like_recipe_id_idx").on(table.recipeId),
    index("recipe_like_member_id_idx").on(table.memberId),
  ]
);

export const recipeTerm = familySchema.table("recipe_term", {
  id: serial("id").primaryKey(),
  term: text("term").notNull().default(""),
  termJson: text("term_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const show = familySchema.table("show", {
  id: serial("id").primaryKey(),
  showTitle: text("show_title").notNull().unique(),
  showImageCredit: text("show_image_credit").notNull().default(""),
  showJson: text("show_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  showImageUrl: text("show_image_url"),
  showSiteUrl: text("show_site_url"),
  showSiteBackground: text("show_site_background").notNull().default("#000000"),
  showFirstYear: integer("show_first_year").notNull().default(sql`EXTRACT(YEAR FROM CURRENT_DATE)`),
  showLastYear: integer("show_last_year").notNull().default(sql`EXTRACT(YEAR FROM CURRENT_DATE)`),
  seasonCount: integer("season_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('show_member_id_idx').on(table.memberId),
    index('show_family_id_idx').on(table.familyId),
  ]
);

export const showComment = familySchema.table("show_comment", {
  id: serial("id").primaryKey(),
  isShowReviewer: boolean("is_show_reviewer").notNull().default(false),
  commentJson: text("comment_json").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow(),
  showId: integer("fk_show_id").notNull().references(() => show.id, {onDelete: 'cascade'}),
  memberId: integer("fk_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('show_comment_show_id_idx').on(table.showId),
    index('show_comment_member_id_idx').on(table.memberId),
  ]
);

export const showTemplate = familySchema.table("show_template", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull().default(""),
  isGlobalTemplate: boolean("is_global_template").notNull().default(false),
  templateJson: text("template_json").notNull().default("{}"),
  status: text("status").notNull().default("draft"),
  updatedAt: timestamp("updated_at").defaultNow(),
  memberId: integer("fk_member_id").references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id"),
},
  (table) => [
    index('show_template_member_id_idx').on(table.memberId),
    index('show_template_family_id_idx').on(table.familyId),
  ]
);

export const showTag = familySchema.table("show_tag", {
  id: serial("id").primaryKey(),
  showId: integer("fk_show_id").notNull().references(() => show.id, {onDelete: 'cascade'}),
  tagId: integer("fk_tag_id").notNull().references(() => showTagReference.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('show_tag_show_id_idx').on(table.showId),
    index('show_tag_tag_id_idx').on(table.tagId),
  ]
);

export const showLike = familySchema.table("show_like", {
  id: serial("id").primaryKey(),
  likenessDegree: integer("likeness_degree").notNull().default(-1),
  showId: integer("fk_show_id").notNull().references(() => show.id, { onDelete: 'cascade' }),
  memberId: integer("fk_member_id").notNull().references(() => member.id, { onDelete: 'cascade' }),
  updatedAt: timestamp("updated_at").defaultNow(),
},
  (table) => [
    index("show_like_show_id_idx").on(table.showId),
    index("show_like_member_id_idx").on(table.memberId),
  ]
);

export const threadTagReference = familySchema.table("thread_tag_reference", {
  id: serial("id").primaryKey(),
  tagName: text("tag_name").notNull(),
  tagDesc: text("tag_description"),
  status: text("status").notNull().default("active"),
  seqNo: integer("seq_no").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),  
});

export const threadConversationTag = familySchema.table("thread_conversation_tag", {
  id: serial("id").primaryKey(),
  tagId: integer("fk_tag_id").notNull().references(() => threadTagReference.id, {onDelete: 'cascade'}),
  conversationId: integer("fk_conversation_id").notNull().references(() => threadConversation.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('thread_conversation_tag_idx').on(table.conversationId, table.tagId),
]);

export const threadConversation = familySchema.table("thread_conversation", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  visibility: text("visibility").notNull().default("private"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  subject: text("subject"),
  primaryCategory: text("primary_category"),
  closedAt: timestamp("closed_at"),
  archivedAt: timestamp("archived_at"),
  archiveBatchId: integer("archive_batch_id"),
  archiveObjectKey: text("archive_object_key"),
  senderMemberId: integer("fk_sender_member_id").references(() => member.id, {onDelete: 'cascade'}),
  familyId: integer("fk_family_id").notNull().references(() => family.id, {onDelete: 'cascade'}),
},
  (table) => [
    index('thread_conversation_family_created_idx').on(table.familyId, table.createdAt),
    index('thread_conversation_family_status_created_idx').on(table.familyId, table.status, table.createdAt),
    index('thread_conversation_sender_created_idx').on(table.senderMemberId, table.createdAt),
]);

export const threadPostReply = familySchema.table("thread_post_reply", {
  id: serial("id").primaryKey(),
  conversationId: integer("fk_conversation_id").notNull().references(() => threadConversation.id, {onDelete: 'cascade'}),
  authorMemberId: integer("fk_author_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  type: text("type").notNull().default("post"),
  content: text("content").notNull(),
  contentJson: text("content_json").notNull().default("{}"),
  seqNo: integer("seq_no").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow(),
  softDeletedAt: timestamp("soft_deleted_at"),
  parentPostId: integer("parent_post_id"),
  rootPostId: integer("root_post_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.parentPostId],
      foreignColumns: [table.id],
      name: "thread_post_reply_parent_post_fkey",
    }),
    foreignKey({
      columns: [table.rootPostId],
      foreignColumns: [table.id],
      name: "thread_post_reply_root_post_fkey",
    }),
    index('thread_post_reply_conversation_seq_idx').on(table.conversationId, table.seqNo),
    index('thread_post_reply_conversation_created_idx').on(table.conversationId, table.createdAt),
    index('thread_post_reply_parent_post_idx').on(table.parentPostId),
    index('thread_post_reply_author_created_idx').on(table.authorMemberId, table.createdAt),
    unique('thread_post_reply_conversation_seq_uq').on(table.conversationId, table.seqNo),
]);

export const threadPostAttachment = familySchema.table("thread_post_attachment", {
  id: serial("id").primaryKey(),
  postId: integer("fk_post_id").notNull().references(() => threadPostReply.id, { onDelete: 'cascade' }),
  attachmentType: text("attachment_type").notNull().default("image"),
  s3ObjectKey: text("s3_object_key").notNull(),
  displayUrl: text("display_url"),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  mimeType: text("mime_type"),
  createdAt: timestamp("created_at").defaultNow(),
},
  (table) => [
    index('thread_post_attachment_post_idx').on(table.postId),
    index('thread_post_attachment_object_key_idx').on(table.s3ObjectKey),
]);

export const threadRecipientState = familySchema.table("thread_recipient_state", {
  id: serial("id").primaryKey(),
  conversationId: integer("fk_conversation_id").notNull().references(() => threadConversation.id, {onDelete: 'cascade'}),
  recipientMemberId: integer("fk_recipient_member_id").notNull().references(() => member.id, {onDelete: 'cascade'}),
  deliveryType: text("delivery_type").notNull().default("threads"),
  readAt: timestamp("read_at"),
  answeredAt: timestamp("answered_at"),
  archivedAt: timestamp("archived_at"),
  archiveBatchId: integer("archive_batch_id"),
  archiveObjectKey: text("archive_object_key"),
  createdAt: timestamp("created_at").defaultNow(),
  lastViewedPostId: integer("last_viewed_post_id"),
},
  (table) => [
    foreignKey({
      columns: [table.lastViewedPostId],
      foreignColumns: [table.id],
      name: "thread_recipient_state_last_viewed_post_fkey",
    }),
    index('thread_recipient_state_conversation_recipient_idx').on(table.conversationId, table.recipientMemberId),
    index('thread_recipient_state_conversation_created_idx').on(table.conversationId, table.createdAt),
    index('thread_recipient_state_recipient_read_archive_idx').on(table.recipientMemberId, table.readAt, table.archivedAt),
    unique('thread_recipient_state_conversation_recipient_uq').on(table.conversationId, table.recipientMemberId),
]);
