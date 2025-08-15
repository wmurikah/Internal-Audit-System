/**
 * AUTHENTICATION & AUTHORIZATION MODULE
 * Handles user authentication, role-based permissions, and security
 */

/**
 * Gets current authenticated user with role and permissions
 */
function getCurrentUser() {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    
    // Enforce corporate domain (@hasspetroleum.com) for sign-in
    const allowedDomain = 'hasspetroleum.com';
    if (!userEmail || userEmail.split('@')[1] !== allowedDomain) {
      return {
        email: userEmail || 'anonymous@system.local',
        role: 'Guest',
        name: 'Unauthorized',
        permissions: [],
        org_unit: 'Unknown',
        authenticated: false,
        active: false,
        error: 'Access restricted to corporate domain'
      };
    }
    
    const users = getSheetData('Users') || [];
    const user = users.find(u => u.email && u.email.toLowerCase() === userEmail.toLowerCase() && u.active !== false);
    
    if (!user) {
      // For first-time setup, default to AuditManager
      return {
        email: userEmail,
        role: 'AuditManager',
        name: userEmail.split('@')[0],
        permissions: getPermissions('AuditManager'),
        org_unit: 'Internal Audit',
        authenticated: true,
        active: true
      };
    }
    
    if (!user.active) {
      return {
        email: userEmail,
        role: 'Guest',
        name: 'Inactive User',
        permissions: [],
        org_unit: 'Unknown',
        authenticated: false,
        active: false
      };
    }
    
    const permissions = getPermissions(user.role);
    
    // Update last login
    try {
      updateRow('Users', user.id, { last_login: new Date() });
    } catch (e) {
      Logger.log('Error updating last login: ' + e.toString());
    }
    
    return {
      email: userEmail,
      role: user.role,
      name: user.name || userEmail.split('@')[0],
      permissions: permissions,
      org_unit: user.org_unit || 'Unknown',
      authenticated: true,
      active: true,
      id: user.id
    };
    
  } catch (error) {
    Logger.log('getCurrentUser error: ' + error.toString());
    return {
      email: 'error@system.local',
      role: 'Guest',
      name: 'System Error',
      permissions: [],
      org_unit: 'Unknown',
      authenticated: false,
      active: false
    };
  }
}

/**
 * Defines comprehensive role-based permissions
 */
function getPermissions(role) {
  const rolePermissions = {
    'AuditManager': [
      'create', 'read', 'update', 'delete', 'approve', 'reject', 
      'final_approval', 'manage_config', 'manage_users', 'view_logs',
      'upload_evidence', 'review_evidence', 'approve_evidence',
      'assign_actions', 'close_issues', 'reopen_items', 'export_reports',
      'view_confidential', 'ai_assist', 'override_workflow', 'create_workpapers',
      'review_workpapers', 'manage_system'
    ],
    'Auditor': [
      'create', 'read', 'update', 'upload_evidence', 'review_evidence',
      'approve_evidence', 'submit_for_review', 'ai_assist', 'create_workpapers',
      'view_own_audits'
    ],
    'SeniorManagement': [
      'read', 'approve', 'reject', 'final_approval', 'export_reports',
      'ai_assist', 'manage_users', 'approve_high_risk', 'view_executive_reports'
    ],
    'Board': [
      'read', 'final_approval', 'export_reports', 'view_governance', 
      'ai_assist', 'view_board_reports'
    ],
    'Auditee': [
      'read', 'update_own', 'upload_evidence', 'submit_for_review',
      'view_assigned_actions'
    ],
    'Guest': ['read']
  };
  
  return rolePermissions[role] || rolePermissions['Guest'];
}

/**
 * Performs secure logout
 */
function performLogout() {
  try {
    const user = getCurrentUser();
    
    if (user && user.authenticated) {
      logAction('Auth', user.email, 'logout', {}, { 
        timestamp: new Date(),
        session_end: true 
      });
    }
    
    const appUrl = ScriptApp.getService().getUrl();
    return {
      success: true,
      redirectUrl: `${appUrl}?logout=1&t=${Date.now()}`
    };
    
  } catch (error) {
    Logger.log('Logout error: ' + error.toString());
    return { success: false, error: error.message };
  }
}
