-- Audit activity enhancements for Turso

CREATE TABLE IF NOT EXISTS audit_activity (
  event_id TEXT PRIMARY KEY,
  organization_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor_user_id TEXT,
  actor_email TEXT,
  actor_role TEXT,
  actor_ip TEXT,
  actor_location TEXT,
  user_agent TEXT,
  action TEXT NOT NULL,
  module_code TEXT,
  entity_type TEXT,
  entity_id TEXT,
  details_json TEXT,
  success INTEGER NOT NULL DEFAULT 1
);

ALTER TABLE audit_log ADD COLUMN actor_location TEXT;
ALTER TABLE audit_log ADD COLUMN user_agent TEXT;
ALTER TABLE audit_log ADD COLUMN module_code TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at ON audit_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_activity_occurred_at ON audit_activity(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_activity_actor ON audit_activity(actor_user_id, occurred_at DESC);
