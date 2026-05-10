-- Ensure notification_queue has organization_id and is backfilled for NOT NULL deployments.

BEGIN;

ALTER TABLE notification_queue ADD COLUMN organization_id TEXT;

UPDATE notification_queue
SET organization_id = 'HASS'
WHERE organization_id IS NULL OR TRIM(organization_id) = '';

COMMIT;
