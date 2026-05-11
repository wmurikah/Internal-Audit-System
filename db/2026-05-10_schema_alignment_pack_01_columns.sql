BEGIN;

-- Core alignment columns expected by backend reads/writes.
ALTER TABLE work_papers ADD COLUMN cc_recipients TEXT;
ALTER TABLE notification_queue ADD COLUMN organization_id TEXT;
ALTER TABLE action_plan_history ADD COLUMN organization_id TEXT;
ALTER TABLE action_plan_history ADD COLUMN updated_at TEXT;

-- Legacy tables read via tursoGetAll (ordered by created_at + soft-delete filter).
ALTER TABLE users ADD COLUMN created_at TEXT;
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE audit_areas ADD COLUMN created_at TEXT;
ALTER TABLE audit_areas ADD COLUMN deleted_at TEXT;
ALTER TABLE sub_areas ADD COLUMN created_at TEXT;
ALTER TABLE sub_areas ADD COLUMN deleted_at TEXT;

COMMIT;
