-- Additive deployment script. Run before deploying the digest endpoint and worker.
BEGIN;

CREATE TABLE IF NOT EXISTS family_schema.family_activity_digest_run (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE,
  week_start_utc timestamptz NOT NULL,
  week_end_utc timestamptz NOT NULL,
  kickoff_idempotency_key text NOT NULL,
  trigger_source text NOT NULL DEFAULT 'eventbridge',
  dry_run boolean NOT NULL DEFAULT false,
  force_replay boolean NOT NULL DEFAULT false,
  family_ids jsonb NOT NULL,
  threshold_value integer NOT NULL,
  operator_notes text,
  status text NOT NULL DEFAULT 'queued',
  families_scanned integer NOT NULL DEFAULT 0,
  families_threshold_met integer NOT NULL DEFAULT 0,
  recipients_total integer NOT NULL DEFAULT 0,
  emails_sent integer NOT NULL DEFAULT 0,
  emails_failed integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digest_run_week_key_uq UNIQUE (week_start_utc, kickoff_idempotency_key)
);
CREATE INDEX IF NOT EXISTS digest_run_status_idx ON family_schema.family_activity_digest_run (status);

CREATE TABLE IF NOT EXISTS family_schema.family_activity_digest_result (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES family_schema.family_activity_digest_run(run_id) ON DELETE CASCADE,
  fk_family_id integer NOT NULL REFERENCES family_schema.family(id) ON DELETE CASCADE,
  week_start_utc timestamptz NOT NULL,
  week_end_utc timestamptz NOT NULL,
  activity_score integer NOT NULL DEFAULT 0,
  unique_posters integer NOT NULL DEFAULT 0,
  total_events integer NOT NULL DEFAULT 0,
  threshold_value integer NOT NULL,
  threshold_met boolean NOT NULL DEFAULT false,
  recipients_eligible integer NOT NULL DEFAULT 0,
  emails_attempted integer NOT NULL DEFAULT 0,
  emails_sent integer NOT NULL DEFAULT 0,
  emails_failed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'skipped',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT digest_result_run_family_uq UNIQUE (run_id, fk_family_id)
);
CREATE INDEX IF NOT EXISTS digest_result_family_week_idx ON family_schema.family_activity_digest_result (fk_family_id, week_start_utc);
CREATE INDEX IF NOT EXISTS digest_result_run_idx ON family_schema.family_activity_digest_result (run_id);
CREATE INDEX IF NOT EXISTS digest_result_status_idx ON family_schema.family_activity_digest_result (status);

CREATE TABLE IF NOT EXISTS family_schema.family_activity_digest_delivery (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES family_schema.family_activity_digest_run(run_id),
  fk_family_id integer NOT NULL REFERENCES family_schema.family(id) ON DELETE CASCADE,
  fk_member_id integer NOT NULL REFERENCES family_schema.member(id) ON DELETE CASCADE,
  week_start_utc timestamptz NOT NULL,
  recipient_email text NOT NULL,
  provider_message_id text,
  status text NOT NULL,
  attempts_in_run integer NOT NULL DEFAULT 1,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT digest_delivery_family_week_member_uq UNIQUE (fk_family_id, week_start_utc, fk_member_id)
);
CREATE INDEX IF NOT EXISTS digest_delivery_run_idx ON family_schema.family_activity_digest_delivery (run_id);

COMMIT;
