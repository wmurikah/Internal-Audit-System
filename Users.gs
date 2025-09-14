/**
 * USER MANAGEMENT - Interplanetary Personnel Control
 */

function getCurrentUser() {
  const email = Session.getActiveUser().getEmail();
  const users = getSheetData('Users');
  const user = users.find(u => u.email === email);
  
  if (user) {
    return {
      ...user,
      permissions: getRolePermissions(user.role)
    };
  }
  
  // Auto-create user if not exists
  return {
    email: email,
    name: email.split('@')[0],
    role: 'Auditee',
    permissions: getRolePermissions('Auditee'),
    active: true
  };
}

function getRolePermissions(role) {
  const permissions = {
    'AuditManager': ['all'],
    'Auditor': ['create', 'read', 'update', 'review'],
    'SeniorManagement': ['read', 'approve', 'reports'],
    'Board': ['read', 'reports'],
    'Auditee': ['read', 'update_assigned', 'upload_evidence']
  };
  return permissions[role] || ['read'];
}

function createUser(userData) {
  return addRow('Users', userData);
}

function updateUser(id, updates) {
  return updateRow('Users', id, updates);
}

function listUsers() {
  return getSheetData('Users');
}

function activateUser(id) {
  return updateRow('Users', id, { active: true });
}

function deactivateUser(id) {
  return updateRow('Users', id, { active: false });
}
