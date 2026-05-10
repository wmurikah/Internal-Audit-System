BEGIN;
ALTER TABLE work_papers ADD COLUMN cc_recipients TEXT;
ALTER TABLE notification_queue ADD COLUMN organization_id TEXT;
UPDATE notification_queue SET organization_id='HASS' WHERE organization_id IS NULL OR TRIM(organization_id)='';
COMMIT;
