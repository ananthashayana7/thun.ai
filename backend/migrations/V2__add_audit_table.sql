-- V2__add_audit_table.sql
-- Add audit logging for compliance and debugging

BEGIN;

-- ─── Audit Log ────────────────────────────────────────────────────────────────
-- Tracks all user-affecting actions for GDPR compliance and support debugging
CREATE TABLE IF NOT EXISTS audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID,  -- NULL for unauthenticated actions
  action          VARCHAR(50) NOT NULL,  -- 'session.created', 'intervention.triggered', etc.
  resource_type   VARCHAR(20),           -- 'drive_session', 'user', 'therapist', etc.
  resource_id     VARCHAR(100),          -- UUID of affected resource
  old_values      JSONB,                 -- Previous state (for updates)
  new_values      JSONB,                 -- New state
  ip_address      INET,
  user_agent      TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log (timestamp DESC);

-- ─── Cleanup: Delete audit logs older than 2 years ──────────────────────────
-- (Can be run periodically or via cron job)
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS TABLE(deleted_count BIGINT) LANGUAGE plpgsql AS $$
DECLARE
  count BIGINT;
BEGIN
  DELETE FROM audit_log WHERE timestamp < now() - interval '2 years';
  GET DIAGNOSTICS count = ROW_COUNT;
  RETURN QUERY SELECT count;
END;
$$;

COMMIT;
