-- V3__add_privacy_controls.sql
-- Add consent tracking and privacy request queues.

BEGIN;

CREATE TABLE IF NOT EXISTS privacy_consents (
  user_id                         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  consent_version                 TEXT NOT NULL,
  telemetry_upload                BOOLEAN NOT NULL DEFAULT TRUE,
  biometrics_processing           BOOLEAN NOT NULL DEFAULT TRUE,
  therapist_transcript_retention  BOOLEAN NOT NULL DEFAULT FALSE,
  marketing_updates               BOOLEAN NOT NULL DEFAULT FALSE,
  consented_at                    TIMESTAMPTZ,
  revoked_at                      TIMESTAMPTZ,
  deletion_requested_at           TIMESTAMPTZ,
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type  TEXT NOT NULL CHECK (request_type IN ('export', 'delete')),
  status        TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  details       JSONB NOT NULL DEFAULT '{}',
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_user ON privacy_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_status ON privacy_requests (status, requested_at DESC);

COMMIT;
