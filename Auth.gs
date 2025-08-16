/**
 * AUTHENTICATION & AUTHORIZATION MODULE
 * Handles user authentication, role-based permissions, and security
 */

/**
 * Gets current authenticated user with role and permissions
 */
function getCurrentUser() {
  try {
    const userEmailRaw = Session.getActiveUser().getEmail();
    const userEmail = (userEmailRaw || '').trim().toLowerCase();

    // Fast cache layer (return early if present)
    const cache = CacheService.getScriptCache();
    const key = `auth_user_${(userEmail || '').toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) { try { return JSON.parse(cached); } catch(e){} }

    // Domain enforcement from Settings
    let allowedDomain = 'hasspetroleum.com';
    try { const cfg = getConfig(); if (cfg && cfg.ALLOWED_SIGNIN_DOMAIN) allowedDomain = String(cfg.ALLOWED_SIGNIN_DOMAIN).toLowerCase(); } catch(e){}

    // Prefer Users sheet record first
    let usersQuick = [];
    try { usersQuick = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('Users') : getSheetData('Users'); } catch(e){}
    const preUser = usersQuick.find(u => (String(u.email||'').toLowerCase()) === userEmail && (u.active === true || String(u.active).toLowerCase()==='true' || u.active===1)) || null;

    const superAdminEmail = 'wmurikah@gmail.com';
    const isSuperAdmin = (userEmail === superAdminEmail);

    if (!preUser && (!userEmail || (!isSuperAdmin && userEmail.split('@')[1] !== allowedDomain))) {
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
      try { logAction('Auth', userEmail||'unknown', 'role_resolution', {}, guestRes); } catch(e){}
      return guestRes;
    }

    let user = preUser || null;

    if (!user && isSuperAdmin) {
      user = { id: 'SUPERADMIN', email: superAdminEmail, name: 'Super Admin', role: 'AuditManager', org_unit: 'Internal Audit', active: true };
    }

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
      // Enforce roles strictly from Users sheet: unregistered users are Guests (no implicit AuditManager)
      email: userEmail,
      role: 'Guest',
      name: userEmail ? userEmail.split('@')[0] : 'Guest',
      permissions: getPermissions('Guest'),
      org_unit: 'Unknown',
      authenticated: false,
      active: false
    };

    // Update last login (best effort)
    try { if (result.id) updateRow('Users', result.id, { last_login: new Date() }); } catch (e) { Logger.log('last_login update error: '+e); }

    // Cache 5 min
    try { cache.put(key, JSON.stringify(result), 300); } catch(e){}

    try { logAction('Auth', result.email||'unknown', 'role_resolution', {}, { role: result.role, org_unit: result.org_unit, authenticated: result.authenticated }); } catch(e){}

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
  // Aligned with approved role matrix
  const rolePermissions = {
    'AuditManager': [
      'create','read','update','delete','approve','reject',
      'final_approval','manage_config','manage_users','view_logs',
      'upload_evidence','review_evidence','approve_evidence',
      'assign_actions','close_issues','reopen_items','export_reports',
      'view_confidential','ai_assist','override_workflow','create_workpapers',
      'review_workpapers','manage_system'
    ],
    'Auditor': [
      'create','read','update','upload_evidence','review_evidence',
      'submit_for_review','ai_assist','create_workpapers','view_own_audits'
    ],
    'SeniorManagement': [
      // Read-only access across Actions, Issues, Risk Register; no work papers
      'read','view_executive_reports','export_reports'
    ],
    'Board': [
      // Read-only dashboards and finalized reports
      'read','view_executive_reports','view_board_reports'
    ],
    'Auditee': [
      'read','update_own','upload_evidence','submit_for_review','view_assigned_actions'
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
