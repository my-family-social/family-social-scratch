-- Adds post_id to family_schema.family_activity so activity rows can reference the room post
-- (movie, show, music, recipe, poem, book, blog_post, gallery_album) named by feature_name.
-- The column is nullable: legacy rows and non-post activity keep NULL and the weekly digest
-- falls back to matching by post_name.
-- Run this BEFORE deploying the application code that writes post_id.
-- Safe to run multiple times.

ALTER TABLE family_schema.family_activity
  ADD COLUMN IF NOT EXISTS post_id integer;
