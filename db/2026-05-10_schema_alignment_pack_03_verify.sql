-- Column existence checks
SELECT 'work_papers.cc_recipients' AS check_name, COUNT(*) AS present
FROM pragma_table_info('work_papers') WHERE name = 'cc_recipients';

SELECT 'notification_queue.organization_id' AS check_name, COUNT(*) AS present
FROM pragma_table_info('notification_queue') WHERE name = 'organization_id';

SELECT 'action_plan_history.organization_id' AS check_name, COUNT(*) AS present
FROM pragma_table_info('action_plan_history') WHERE name = 'organization_id';

SELECT 'action_plan_history.updated_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('action_plan_history') WHERE name = 'updated_at';

SELECT 'users.created_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('users') WHERE name = 'created_at';

SELECT 'users.deleted_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('users') WHERE name = 'deleted_at';

SELECT 'audit_areas.created_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('audit_areas') WHERE name = 'created_at';

SELECT 'audit_areas.deleted_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('audit_areas') WHERE name = 'deleted_at';

SELECT 'sub_areas.created_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('sub_areas') WHERE name = 'created_at';

SELECT 'sub_areas.deleted_at' AS check_name, COUNT(*) AS present
FROM pragma_table_info('sub_areas') WHERE name = 'deleted_at';

-- Data integrity checks
SELECT 'notification_queue null org' AS check_name, COUNT(*) AS bad_rows
FROM notification_queue
WHERE organization_id IS NULL OR TRIM(organization_id) = '';

SELECT 'action_plans empty response_id' AS check_name, COUNT(*) AS bad_rows
FROM action_plans
WHERE response_id = '';

SELECT 'work_papers invalid response_status' AS check_name, COUNT(*) AS bad_rows
FROM work_papers
WHERE response_status IS NOT NULL
  AND response_status NOT IN (
    'Pending Response','Draft Response','Response Submitted',
    'Response Accepted','Response Rejected','Escalated'
  );
