-- thun.ai PostgreSQL Schema
-- Run: psql $DATABASE_URL -f schema.sql

BEGIN;

-- ─── Extensions ──────────────────────────────────────────────────────────────
-- gen_random_uuid() is built-in from PostgreSQL 13+; no extension needed.
-- pgcrypto kept for any future encryption helpers.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- PostGIS is required for accident zone spatial queries (ST_Intersects).
-- Install PostGIS on your database before running this migration.
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid  TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  email         TEXT,
  phone         TEXT,
  -- JSON blob: questionnaire answers, calibrated thresholds, intervention prefs
  anxiety_profile JSONB NOT NULL DEFAULT '{}',
  tts_language  TEXT NOT NULL DEFAULT 'en-IN',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users (firebase_uid);

-- ─── Drive Sessions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drive_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at        TIMESTAMPTZ NOT NULL,
  ended_at          TIMESTAMPTZ,
  -- Route metadata: origin, destination, summary, distance, duration, anxietyScore
  route_meta        JSONB NOT NULL DEFAULT '{}',
  -- Aggregated telemetry: avg speed, max speed, harsh events count
  telemetry_summary JSONB NOT NULL DEFAULT '{}',
  -- Array of { score, ts, speed, rpm } sampled stress events
  stress_events     JSONB NOT NULL DEFAULT '[]',
  anxiety_score_avg REAL NOT NULL DEFAULT 0,
  peak_stress       REAL NOT NULL DEFAULT 0,
  -- Generated LLM narrative (cached after first generation)
  confidence_narrative TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drive_sessions_user_id ON drive_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_drive_sessions_started_at ON drive_sessions (started_at DESC);

-- ─── IVIS Interventions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ivis_interventions (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES drive_sessions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,         -- calm_audio, hud_icon, breathing_cue, etc.
  severity      SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  triggered_at  TIMESTAMPTZ NOT NULL,
  acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  stress_score_at_trigger REAL
);

CREATE INDEX IF NOT EXISTS idx_interventions_session ON ivis_interventions (session_id);
CREATE INDEX IF NOT EXISTS idx_interventions_user ON ivis_interventions (user_id);

-- ─── Confidence Trajectory ────────────────────────────────────────────────────
-- Tracks per-session confidence scores for longitudinal progress display
CREATE TABLE IF NOT EXISTS confidence_trajectory (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL REFERENCES drive_sessions(id) ON DELETE CASCADE,
  -- 0–100: inverse of anxiety_score_avg, adjusted for positive reinforcement
  confidence_score REAL NOT NULL,
  scenario_variants JSONB NOT NULL DEFAULT '[]', -- synthetic practice scenarios
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_confidence_user ON confidence_trajectory (user_id, recorded_at DESC);

-- ─── Accident Zones ──────────────────────────────────────────────────────────
-- Stores known high-risk locations used by the route anxiety scoring service.
-- Populated externally (e.g. from government NCRB / MORTH accident datasets).
CREATE TABLE IF NOT EXISTS accident_zones (
  id          BIGSERIAL PRIMARY KEY,
  -- PostGIS geometry – geographic coordinates (WGS84 / EPSG:4326)
  geom        GEOMETRY(Point, 4326) NOT NULL,
  severity    SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  description TEXT,
  source      TEXT,            -- data source identifier (e.g. 'MORTH_2023')
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index for efficient ST_Intersects bounding-box queries.
CREATE INDEX IF NOT EXISTS idx_accident_zones_geom ON accident_zones USING GIST (geom);
-- Covering index for severity-filtered queries.
CREATE INDEX IF NOT EXISTS idx_accident_zones_severity ON accident_zones (severity);

-- ─── Trigger: auto-update users.updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
