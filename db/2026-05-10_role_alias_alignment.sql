-- Align HEAD_OF_AUDIT alias with SUPER_ADMIN privileges in Turso

INSERT OR IGNORE INTO roles (role_code, role_name, role_level, description, is_active)
VALUES ('HEAD_OF_AUDIT', 'Head of Audit', 1, 'Alias of SUPER_ADMIN', 1);

INSERT OR REPLACE INTO role_permissions (role_code, module_code, action_code, is_allowed, scope, updated_at)
SELECT 'HEAD_OF_AUDIT', module_code, action_code, is_allowed, scope, CURRENT_TIMESTAMP
FROM role_permissions
WHERE role_code = 'SUPER_ADMIN';
