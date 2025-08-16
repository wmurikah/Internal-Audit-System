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

    // Fast cache layer (return early if present)
    const cache = CacheService.getScriptCache();
    const key = `auth_user_${(userEmail || '').toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) { try { return JSON.parse(cached); } catch(e){} }

    // Domain enforcement from Settings
    let allowedDomain = 'hasspetroleum.com';
    try { const cfg = getConfig(); if (cfg && cfg.ALLOWED_SIGNIN_DOMAIN) allowedDomain = cfg.ALLOWED_SIGNIN_DOMAIN; } catch(e){}

    // Prefer Users sheet record first
    let usersQuick = [];
    try { usersQuick = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('Users') : getSheetData('Users'); } catch(e){}
    const preUser = usersQuick.find(u => (u.email||'').toLowerCase() === String(userEmail||'').toLowerCase() && u.active !== false) || null;

    if (!preUser && (!userEmail || userEmail.split('@')[1] !== allowedDomain)) {
      const guestRes = {
        email: userEmail || 'anonymous@system.local',
        role: 'Guest',
        name: 'Unauthorized',
        permissions: [],
        org_unit: 'Unknown',
        authenticated: false,
        active: false,
        error: 'Access restricted to corporate domain'
      };
      try { cache.put(key, JSON.stringify(guestRes), 300); } catch(e){}
      return guestRes;
    }

    let user = preUser || null;

    const result = user ? {
      email: userEmail,
      role: user.role,
      name: user.name || (userEmail ? userEmail.split('@')[0] : 'User'),
      permissions: getPermissions(user.role),
      org_unit: user.org_unit || 'Unknown',
      authenticated: true,
      active: true,
      id: user.id
    } : {
      // First time setup default to AuditManager when domain-allowed but not yet registered
      email: userEmail,
      role: 'AuditManager',
      name: userEmail ? userEmail.split('@')[0] : 'AuditManager',
      permissions: getPermissions('AuditManager'),
      org_unit: 'Internal Audit',
      authenticated: true,
      active: true
    };

    // Update last login (best effort)
    try { if (result.id) updateRow('Users', result.id, { last_login: new Date() }); } catch (e) { Logger.log('last_login update error: '+e); }

    // Cache 5 min
    try { cache.put(key, JSON.stringify(result), 300); } catch(e){}

    return result;
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
