-- Align response_status values in Turso with application enum/check constraints.
-- Run in Turso shell or via CI migration runner.

BEGIN;

-- 1) Normalize legacy blank/invalid statuses so they satisfy current CHECK constraints.
UPDATE work_papers
SET response_status = NULL
WHERE response_status IS NOT NULL
  AND TRIM(response_status) = '';

UPDATE work_papers
SET response_status = NULL
WHERE response_status IS NOT NULL
  AND response_status NOT IN (
    'Pending Response',
    'Draft Response',
    'Response Submitted',
    'Response Accepted',
    'Response Rejected',
    'Escalated'
  );

-- 2) Optional: backfill Pending Response for work papers already sent to auditee.
UPDATE work_papers
SET response_status = 'Pending Response'
WHERE status = 'Sent to Auditee'
  AND response_status IS NULL;

COMMIT;
