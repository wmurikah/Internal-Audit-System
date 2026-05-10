-- Align work_papers schema for junction-backed cc recipients on older Turso instances.

BEGIN;

ALTER TABLE work_papers ADD COLUMN cc_recipients TEXT;

COMMIT;
