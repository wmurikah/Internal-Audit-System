BEGIN;

-- Notification org required by queue writes.
UPDATE notification_queue
SET organization_id = 'HASS'
WHERE organization_id IS NULL OR TRIM(organization_id) = '';

-- Ensure sortable timestamps for legacy rows.
UPDATE users
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE created_at IS NULL OR TRIM(created_at) = '';

UPDATE audit_areas
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE created_at IS NULL OR TRIM(created_at) = '';

UPDATE sub_areas
SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE created_at IS NULL OR TRIM(created_at) = '';

-- Normalize legacy empty FK values.
UPDATE action_plans
SET response_id = NULL
WHERE response_id = '';

-- Normalize response status values to enum contract.
UPDATE work_papers
SET response_status = NULL
WHERE response_status IS NOT NULL
  AND (TRIM(response_status) = '' OR response_status NOT IN (
    'Pending Response','Draft Response','Response Submitted',
    'Response Accepted','Response Rejected','Escalated'
  ));

COMMIT;
