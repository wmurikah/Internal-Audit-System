BEGIN;
-- Add created_at for legacy tables that are queried with ORDER BY created_at.
ALTER TABLE users ADD COLUMN created_at TEXT;
ALTER TABLE audit_areas ADD COLUMN created_at TEXT;
ALTER TABLE sub_areas ADD COLUMN created_at TEXT;
UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL;
UPDATE audit_areas SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL;
UPDATE sub_areas SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE created_at IS NULL;

-- Normalize empty-string FK to NULL for action plan response links.
UPDATE action_plans SET response_id = NULL WHERE response_id = '';
COMMIT;
