-- Access control + workflow end-state support
-- Date: 2026-05-09

-- 1) Optional workflow terminal status registry (for reporting / hang detection)
CREATE TABLE IF NOT EXISTS workflow_terminal_states (
  workflow_name TEXT NOT NULL,
  terminal_status TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_name, terminal_status)
);

INSERT OR IGNORE INTO workflow_terminal_states (workflow_name, terminal_status, description) VALUES
  ('WORK_PAPER', 'Sent to Auditee', 'Work paper sent to auditee; audit team workflow end state.'),
  ('AUDITEE_RESPONSE', 'Response Accepted', 'Auditee response accepted by reviewer.'),
  ('AUDITEE_RESPONSE', 'Escalated', 'Auditee response escalated after rejection policy.'),
  ('ACTION_PLAN', 'Closed', 'Action plan closed after HOA approval.'),
  ('ACTION_PLAN', 'Not Implemented', 'Action plan cannot be implemented and is ended by decision.');

-- 2) Helpful indexes for role assignment and responsibility dropdown performance
CREATE INDEX IF NOT EXISTS idx_users_role_active ON users(role_code, is_active);
CREATE INDEX IF NOT EXISTS idx_work_paper_responsibles_user ON work_paper_responsibles(user_id);
CREATE INDEX IF NOT EXISTS idx_action_plan_owners_user ON action_plan_owners(user_id);
