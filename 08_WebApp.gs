// 08_WebApp.gs - Web Application Entry Points, API Router, File Upload, Request/Response Utilities

// Handle GET requests - serve HTML pages (login page shown first)
function doGet(e) {
  try {
    const page = e.parameter.page || 'login';

    if (page !== 'app') {
      return HtmlService.createTemplateFromFile('Login')
        .evaluate()
        .setTitle('Login - Hass Petroleum Audit System')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }

    // =========================================================
    // SERVE APP PAGE
    // Data comes from: sessionStorage (post-login) or localStorage (repeat visit)
    // SSR is only a bonus if Google session + cache are both available
    // =========================================================
    const template = HtmlService.createTemplateFromFile('AuditorPortal');
    
    // Lightweight SSR attempt - ONLY reads from cache, never computes
    let inlineData = null;
    try {
      const cache = CacheService.getScriptCache();
      const user = getCurrentUser(); // Fast if Google-authed, null otherwise
      
      if (user && isActive(user.is_active)) {
        const roleName = cache.get('role_name_' + user.role_code) || user.role_code;
        const cachedPerm = cache.get('perm_' + user.role_code);
        const cachedDropdowns = cache.get('dropdown_data_all');
        
        // Only build SSR data if permissions are already cached
        if (cachedPerm) {
          inlineData = {
            success: true,
            user: {
              user_id: user.user_id,
              email: user.email,
              full_name: user.full_name,
              role_code: user.role_code,
              role_name: roleName,
              affiliate_code: user.affiliate_code || '',
              department: user.department || '',
              must_change_password: user.must_change_password === true || user.must_change_password === 'true' || user.must_change_password === 'TRUE'
            },
            permissions: JSON.parse(cachedPerm),
            dropdowns: cachedDropdowns ? JSON.parse(cachedDropdowns) : {},
            config: {
              systemName: 'Hass Petroleum Internal Audit System',
              currentYear: new Date().getFullYear()
            }
          };
        }
      }
    } catch (ssrError) {
      // Non-fatal - client will use sessionStorage or API fallback
      console.error('SSR skip:', ssrError.message);
    }

    template.inlineInitData = inlineData ? JSON.stringify(inlineData) : 'null';

    return template
      .evaluate()
      .setTitle('Hass Petroleum Internal Audit System')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');

  } catch (error) {
    console.error('doGet error:', error);
    return HtmlService.createHtmlOutput(
      '<h2>Error</h2><p>An error occurred loading the application. Please try again.</p>' +
      '<p><a href="' + ScriptApp.getService().getUrl() + '">Refresh</a></p>'
    ).setTitle('Error');
  }
}

/**
 * Handle POST requests - API endpoint
 */
function doPost(e) {
  try {
    const request = JSON.parse(e.postData.contents);
    const action = request.action;
    const data = request.data || {};

    const publicActions = ['login', 'ping', 'forgotPassword', 'validateSession'];

    let user = null;
    if (!publicActions.includes(action)) {
      if (data.sessionToken) {
        const sessionResult = validateSession(data.sessionToken);
        if (sessionResult && sessionResult.valid && sessionResult.user) {
          user = getUserByIdCached(sessionResult.user.user_id) || sessionResult.user;
        }
      }

      // Fallback for legacy Google-session based access in editor/development contexts
      if (!user) {
        user = getCurrentUser();
      }
    }

    if (!publicActions.includes(action) && !user) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401);
    }

    // Strip sessionToken from data to prevent it leaking into business logic
    delete data.sessionToken;

    const result = routeAction(action, data, user);
    
    if (result === null || result === undefined) {
      console.error('doPost: routeAction returned null/undefined for action:', action);
      return jsonResponse({ 
        success: false, 
        error: 'No response from server', 
        errorDetail: 'routeAction returned null/undefined for action: ' + action 
      }, 500);
    }
    
    return jsonResponse(result);
    
  } catch (error) {
    console.error('doPost error:', error);
    return jsonResponse({ success: false, error: error.message }, 500);
  }
}

/**
 * Route action to appropriate handler
 */
function routeAction(action, data, user) {
  switch (action) {
    // ========== AUTH ==========
    case 'ping':
      return { success: true, timestamp: new Date().toISOString() };
      
    case 'login':
      return login(data.email, data.password);
      
    case 'forgotPassword':
      return forgotPassword(data.email);
      
    case 'logout':
      return logout(data.sessionToken);
      
    case 'validateSession':
      return validateSession(data.sessionToken);
      
    case 'changePassword':
      return changePassword(user.user_id, data.currentPassword, data.newPassword);
      
    case 'resetPassword':
      return resetPassword(data.userId, user);
    
    case 'postLoginCleanup':
      return postLoginCleanup(data);
      
    // ========== INIT ==========
    case 'getInitData':
      return getInitData(data.sessionToken);
    
    case 'getInitDataLight':
      return getInitDataLight(user);
    
    case 'getDropdowns':
      return getDropdownDataCached();
      
    case 'getDashboardData':
      return getDashboardDataSafe(user);
      
    case 'getDropdownData':
      return { success: true, dropdowns: getDropdownDataCached() };
      
    case 'getSidebarCounts':
      return getSidebarCounts(user);
      
    // ========== WORK PAPERS ==========
    case 'getWorkPapers':
      return { success: true, workPapers: getWorkPapers(data.filters, user) };
      
    case 'getWorkPaper':
      return { success: true, workPaper: getWorkPaper(data.workPaperId, data.includeRelated !== false) };
      
    case 'getWorkPaperCounts':
      return { success: true, counts: getWorkPaperCounts(data.filters, user) };
      
    case 'createWorkPaper':
      return createWorkPaper(data, user);
      
    case 'updateWorkPaper':
      return updateWorkPaper(data.workPaperId, data, user);
      
    case 'deleteWorkPaper':
      return deleteWorkPaper(data.workPaperId, user);
      
    case 'submitWorkPaper':
      return submitWorkPaper(data.workPaperId, user);
      
    case 'reviewWorkPaper':
      return reviewWorkPaper(data.workPaperId, data.action, data.comments, user);
      
    case 'sendToAuditee':
      return sendToAuditee(data.workPaperId, user);
      
    // ========== WORK PAPER REQUIREMENTS ==========
    case 'addWorkPaperRequirement':
      return addWorkPaperRequirement(data.workPaperId, data, user);
      
    case 'updateWorkPaperRequirement':
      return updateWorkPaperRequirement(data.requirementId, data, user);
      
    case 'deleteWorkPaperRequirement':
      return deleteWorkPaperRequirement(data.requirementId, user);
      
    // ========== WORK PAPER FILES ==========
    case 'addWorkPaperFile':
      return addWorkPaperFile(data.workPaperId, data, user);
      
    case 'deleteWorkPaperFile':
      return deleteWorkPaperFile(data.fileId, user);
      
    // ========== ACTION PLANS ==========
    case 'getActionPlans':
      return { success: true, actionPlans: getActionPlans(data.filters, user) };
      
    case 'getActionPlan':
      return { success: true, actionPlan: getActionPlan(data.actionPlanId, data.includeRelated !== false) };
      
    case 'getActionPlanCounts':
      return { success: true, counts: getActionPlanCounts(data.filters, user) };
      
    case 'createActionPlan':
      return createActionPlan(data, user);
      
    case 'createActionPlansBatch':
      return createActionPlansBatch(data.workPaperId, data.plans, user);
      
    case 'updateActionPlan':
      return updateActionPlan(data.actionPlanId, data, user);
      
    case 'deleteActionPlan':
      return deleteActionPlan(data.actionPlanId, user);
      
    case 'markAsImplemented':
      return markAsImplemented(data.actionPlanId, data.implementationNotes, user);
      
    case 'verifyImplementation':
      return verifyImplementation(data.actionPlanId, data.action, data.comments, user);
      
    case 'hoaReview':
      return hoaReview(data.actionPlanId, data.action, data.comments, user);
      
    // ========== ACTION PLAN EVIDENCE ==========
    case 'addActionPlanEvidence':
      return addActionPlanEvidence(data.actionPlanId, data, user);
      
    case 'deleteActionPlanEvidence':
      return deleteActionPlanEvidence(data.evidenceId, user);
      
    // ========== USERS ==========
    case 'getUsers':
      return getUsers(data.filters, user);
      
    case 'createUser':
      return createUser(data, user);
      
    case 'updateUser':
      return updateUser(data.userId, data, user);
      
    case 'deactivateUser':
      return deactivateUser(data.userId, user);
      
    // ========== REPORTS ==========
    case 'getAuditSummaryReport':
      if (!canUserPerform(user, 'read', 'REPORT', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, report: getAuditSummaryReport(data.filters) };

    case 'getActionPlanAgingReport':
      if (!canUserPerform(user, 'read', 'REPORT', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, report: getActionPlanAgingReport() };

    case 'getRiskSummaryReport':
      if (!canUserPerform(user, 'read', 'REPORT', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, report: getRiskSummaryReport(data.filters) };

    case 'getComprehensiveReportData':
      // Dashboard is visible to ALL authenticated users regardless of role
      return { success: true, ...getComprehensiveReportData(data.filters) };

    // ========== NOTIFICATIONS ==========
    case 'getNotificationQueueStatus':
      return { success: true, status: getNotificationQueueStatus() };
      
    case 'getUserNotifications':
      return { success: true, notifications: getUserNotifications(user.user_id, data.limit) };
      
    // ========== ADMIN ==========
    case 'rebuildWorkPaperIndex':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, count: rebuildWorkPaperIndex() };
      
    case 'rebuildActionPlanIndex':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, count: rebuildActionPlanIndex() };
      
    case 'processEmailQueue':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, result: processEmailQueue() };
      
    case 'cleanupExpiredSessions':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, cleaned: cleanupExpiredSessions() };

    // ========== SETTINGS ==========
    case 'getPermissions':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, permissions: getPermissionsCached(data.roleCode) };

    case 'updatePermissions':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return updatePermissions(data.roleCode, data.permissions, user);

    case 'getUserStats':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, stats: getUserStats() };

    case 'getSystemConfig':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, config: getSystemConfigValues() };

    case 'saveSystemConfig':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return saveSystemConfigValues(data.config, user);

    case 'getAuditLog':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, logs: getAuditLogs(data.action, data.page, data.pageSize), total: getAuditLogCount(data.action) };

    case 'rebuildAllIndexes':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      Index.rebuild('WORK_PAPER');
      Index.rebuild('ACTION_PLAN');
      Index.rebuild('USER');
      return { success: true, message: 'All indexes rebuilt' };

    // ========== AI SERVICE ==========
    case 'getAIConfigStatus':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, config: getAIConfigStatus() };

    case 'setAIApiKey':
      return setAIApiKey(data.provider, data.apiKey, user);

    case 'removeAIApiKey':
      return removeAIApiKey(data.provider, user);

    case 'setActiveAIProvider':
      return setActiveAIProvider(data.provider, user);

    case 'testAIConnection':
      return testAIConnection(data.provider, user);

    case 'getWorkPaperInsights':
      return getWorkPaperInsights(data.workPaperId, user);

    case 'validateActionPlan':
      return validateActionPlan(data.actionPlan, data.workPaperContext, user);

    case 'getAnalyticsInsights':
      return getAnalyticsInsights(data.analyticsData, user);

    // ========== EMAIL (OUTLOOK / MICROSOFT GRAPH) ==========
    case 'getOutlookStatus':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return getOutlookStatus();

    case 'testOutlookEmail':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return testOutlookEmailAction(data.recipientEmail, user);

    // ========== EMAIL TEMPLATES ==========
    case 'getEmailTemplatesAll':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, templates: getEmailTemplatesAll() };

    case 'saveEmailTemplate':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can edit email templates' };
      }
      return saveEmailTemplateAction(data.templateCode, data.updates, user);

    // ========== SUMMARY RECIPIENTS ==========
    case 'getSummaryRecipients':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return getSummaryRecipients();

    case 'saveSummaryRecipients':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can configure summary recipients' };
      }
      return saveSummaryRecipients(data.recipients, user);

    case 'setupTriggers':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can configure triggers' };
      }
      return setupNotificationTriggers();

    // ========== EXPORT ==========
    case 'exportWorkPapersCSV':
      if (!canUserPerform(user, 'export', 'REPORT', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return exportWorkPapersCSV(data.filters, user);

    case 'exportActionPlansCSV':
      if (!canUserPerform(user, 'export', 'REPORT', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return exportActionPlansCSV(data.filters, user);

    // ========== ANALYTICS ==========
    case 'getAnalyticsData':
      // AI Assist module is available to all authenticated users
      return getAnalyticsData(data.year, user);

    // ========== CACHE MANAGEMENT ==========
    case 'warmCache':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return warmAllCaches();

    case 'clearCache':
      if (!canUserPerform(user, 'update', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return clearAllCaches();

    default:
      return { success: false, error: 'Unknown action: ' + action };
  }
}

/**
 * Get dashboard data with proper error handling
 */
function getDashboardDataSafe(user) {
  try {
    if (!user) {
      return { success: false, error: 'Authentication required', requireLogin: true };
    }

    const dashboardData = getDashboardData(user);

    if (!dashboardData) {
      console.error('getDashboardData: Dashboard service returned null/undefined');
      return { 
        success: false, 
        error: 'Dashboard service returned null',
        errorDetail: 'getDashboardData() returned null/undefined'
      };
    }

    if (dashboardData.success === false) {
      return dashboardData;
    }

    if (!dashboardData.summary) {
      dashboardData.summary = { workPapers: {}, actionPlans: {} };
    }
    if (!dashboardData.charts) {
      dashboardData.charts = {};
    }
    if (!dashboardData.alerts) {
      dashboardData.alerts = [];
    }
    if (!dashboardData.recentActivity) {
      dashboardData.recentActivity = [];
    }

    return {
      success: true,
      ...dashboardData
    };

  } catch (e) {
    console.error('getDashboardData error:', e);
    return {
      success: false,
      error: 'Failed to load dashboard: ' + e.message,
      errorDetail: 'Exception in getDashboardData handler: ' + e.message,
      summary: { workPapers: {}, actionPlans: {} },
      charts: {},
      alerts: [],
      recentActivity: []
    };
  }
}

/**
 * Get dropdown data with caching - OPTIMIZED
 */
function getDropdownDataCached() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'dropdown_data_all';
  
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.warn('Dropdown cache parse error:', e);
    }
  }
  
  const dropdowns = getDropdownData();
  
  try {
    cache.put(cacheKey, JSON.stringify(dropdowns), 1800);
  } catch (e) {
    console.warn('Failed to cache dropdowns:', e);
  }
  
  return dropdowns;
}

/**
 * Get permissions with caching
 */
function getPermissionsCached(roleCode) {
  if (!roleCode) return {};
  
  const cache = CacheService.getScriptCache();
  const cacheKey = 'perm_' + roleCode;
  
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }
  
  const permissions = getPermissions(roleCode);
  
  try {
    cache.put(cacheKey, JSON.stringify(permissions), CONFIG.CACHE_TTL.PERMISSIONS);
  } catch (e) {}
  
  return permissions;
}

/**
 * Warm all caches - call after login or on app start
 */
function warmAllCaches() {
  const startTime = new Date().getTime();
  console.log('Starting cache warm...');
  
  const cache = CacheService.getScriptCache();
  const results = { success: true, cached: [] };
  
  try {
    // 1. Cache dropdowns
    const dropdowns = getDropdownData();
    cache.put('dropdown_data_all', JSON.stringify(dropdowns), 1800);
    results.cached.push('dropdowns');
    console.log('Cached dropdowns');
    
    // 2. Cache all role permissions
    const roles = ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'JUNIOR_STAFF', 'AUDITEE', 'MANAGEMENT', 'SENIOR_MGMT', 'AUDITOR', 'UNIT_MANAGER', 'BOARD', 'EXTERNAL_AUDITOR', 'OBSERVER'];
    roles.forEach(role => {
      try {
        const perms = getPermissions(role);
        cache.put('perm_' + role, JSON.stringify(perms), CONFIG.CACHE_TTL.PERMISSIONS);
      } catch (e) {
        console.warn('Failed to cache permissions for role:', role);
      }
    });
    results.cached.push('permissions');
    console.log('Cached permissions');
    
    // 3. Cache config values
    const configKeys = ['SYSTEM_NAME', 'SESSION_TIMEOUT_HOURS', 'AUDIT_FILES_FOLDER_ID'];
    configKeys.forEach(key => {
      try {
        const value = getConfigValue(key);
        if (value) {
          cache.put('config_' + key, value, 3600);
        }
      } catch (e) {}
    });
    results.cached.push('config');
    console.log('Cached config');
    
    // 4. Cache role names
    roles.forEach(role => {
      try {
        const name = getRoleName(role);
        cache.put('role_name_' + role, name, 3600);
      } catch (e) {}
    });
    results.cached.push('roleNames');
    console.log('Cached role names');
    
  } catch (e) {
    console.error('Cache warm error:', e);
    results.error = e.message;
  }
  
  results.duration = new Date().getTime() - startTime;
  console.log('Cache warm completed in', results.duration, 'ms');
  
  return results;
}

/**
 * Clear all caches - including permission caches
 */
function clearAllCaches() {
  const cache = CacheService.getScriptCache();
  
  const keysToRemove = [
    'dropdown_data_all',
    'config_SYSTEM_NAME',
    'config_SESSION_TIMEOUT_HOURS',
    'config_AUDIT_FILES_FOLDER_ID',
    'role_names'
  ];
  
  // Clear all role permission caches
  const roles = ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'AUDITOR', 'JUNIOR_STAFF', 'AUDITEE', 'UNIT_MANAGER', 'MANAGEMENT', 'SENIOR_MGMT', 'BOARD', 'EXTERNAL_AUDITOR', 'OBSERVER'];
  roles.forEach(role => {
    keysToRemove.push('perm_' + role);
    keysToRemove.push('role_name_' + role);
  });
  
  keysToRemove.forEach(key => {
    try {
      cache.remove(key);
    } catch (e) {}
  });
  
  console.log('Cleared caches:', keysToRemove.length, 'keys');
  
  return { success: true, cleared: keysToRemove.length };
}

function uploadFileToDrive(fileName, mimeType, base64Data, folderId, sessionToken) {
  try {
    // Try session-based auth first, then fall back to Google session
    let user = null;
    if (sessionToken) {
      const sessionResult = validateSession(sessionToken);
      if (sessionResult && sessionResult.valid) {
        user = getUserByIdCached(sessionResult.user.user_id) || sessionResult.user;
      }
    }
    if (!user) {
      user = getCurrentUser();
    }
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }

    // Server-side file type validation
    const allowedMimeTypes = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg', 'image/png', 'image/gif',
      'text/plain', 'text/csv'
    ];
    if (mimeType && !allowedMimeTypes.includes(mimeType)) {
      return { success: false, error: 'File type not allowed: ' + mimeType };
    }

    // Validate file size (base64 adds ~33% overhead, limit to ~10MB decoded)
    if (base64Data && base64Data.length > 14000000) {
      return { success: false, error: 'File too large. Maximum size is 10MB.' };
    }

    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);

    let folder;
    if (folderId) {
      folder = DriveApp.getFolderById(folderId);
    } else {
      const rootFolderId = getConfigValue('AUDIT_FILES_FOLDER_ID');
      if (rootFolderId) {
        folder = DriveApp.getFolderById(rootFolderId);
      } else {
        folder = DriveApp.getRootFolder();
      }
    }

    const file = folder.createFile(blob);
    // Share within the domain only (Google Workspace accounts)
    try {
      file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      // If domain sharing fails (e.g. consumer/personal account without Workspace),
      // fall back to ANYONE_WITH_LINK so files remain accessible to system users
      console.warn('Domain sharing not available, falling back to ANYONE_WITH_LINK:', sharingError.message);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (fallbackError) {
        console.error('File sharing fallback also failed:', fallbackError.message);
      }
    }

    return {
      success: true,
      file: {
        drive_file_id: file.getId(),
        drive_url: file.getUrl(),
        file_name: file.getName(),
        file_size: file.getSize(),
        mime_type: file.getMimeType()
      }
    };

  } catch (error) {
    console.error('Upload error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create folder structure for work paper
 */
function createWorkPaperFolder(workPaperId, affiliateCode, year) {
  try {
    const rootFolderId = getConfigValue('AUDIT_FILES_FOLDER_ID');
    let rootFolder;
    
    if (rootFolderId) {
      rootFolder = DriveApp.getFolderById(rootFolderId);
    } else {
      const folders = DriveApp.getFoldersByName('Hass Audit Files');
      if (folders.hasNext()) {
        rootFolder = folders.next();
      } else {
        rootFolder = DriveApp.createFolder('Hass Audit Files');
        setConfigValue('AUDIT_FILES_FOLDER_ID', rootFolder.getId());
      }
    }
    
    let yearFolder;
    const yearFolders = rootFolder.getFoldersByName(String(year));
    if (yearFolders.hasNext()) {
      yearFolder = yearFolders.next();
    } else {
      yearFolder = rootFolder.createFolder(String(year));
    }
    
    let affiliateFolder;
    const affiliateFolders = yearFolder.getFoldersByName(affiliateCode);
    if (affiliateFolders.hasNext()) {
      affiliateFolder = affiliateFolders.next();
    } else {
      affiliateFolder = yearFolder.createFolder(affiliateCode);
    }
    
    const wpFolder = affiliateFolder.createFolder(workPaperId);
    
    return {
      success: true,
      folderId: wpFolder.getId(),
      folderUrl: wpFolder.getUrl()
    };
    
  } catch (error) {
    console.error('Create folder error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete file from Drive
 */
function deleteFileFromDrive(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return { success: true };
  } catch (error) {
    console.error('Delete file error:', error);
    return { success: false, error: error.message };
  }
}

function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * Include HTML file content (for templates)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Get script URL
 */
function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Generic API call function for client-side - FIXED
 * Now checks session token FIRST before falling back to Google session
 */
function apiCall(action, data) {
  const startTime = new Date().getTime();
  
  try {
    data = data || {};

    console.log('=== API Call: ' + action + ' ===');

    const publicActions = ['login', 'ping', 'testConnection', 'validateSession', 'forgotPassword'];

    let user = null;

    // SPEED: Skip all auth lookups for public actions that don't need a user
    if (!publicActions.includes(action)) {
      // Try session token FIRST, then fall back to Google session
      if (data.sessionToken) {
        const sessionResult = validateSession(data.sessionToken);

        if (sessionResult.valid) {
          user = getUserByIdCached(sessionResult.user.user_id);

          if (!user) {
            user = getUserByEmailCached(sessionResult.user.email);
          }

          if (!user) {
            user = sessionResult.user;
            user._fromSession = true;
          }

          console.log('User from session token:', user.email, 'role:', user.role_code);
        } else {
          console.log('Session token invalid:', sessionResult.error);
        }
      }

      // Only fall back to Google session if no valid session token
      if (!user) {
        user = getCurrentUser();
        if (user) {
          console.log('User from Google session:', user.email, 'role:', user.role_code);
        }
      }

      if (!user) {
        return { success: false, error: 'Authentication required', requireLogin: true };
      }
    }

    if (action === 'testConnection') {
      return { success: true, message: 'Backend is working!', timestamp: new Date().toISOString() };
    }

    // Special handling for getInitData - use optimized version
    if (action === 'getInitData' && user) {
      const initResult = getInitDataOptimized(user);
      console.log('getInitData completed in', new Date().getTime() - startTime, 'ms');
      return initResult;
    }

    // Strip sessionToken from data to prevent it leaking into business logic / audit logs
    var cleanData = Object.assign({}, data);
    delete cleanData.sessionToken;

    const result = routeAction(action, cleanData, user);

    if (result === null || result === undefined) {
      console.error('apiCall: routeAction returned null/undefined for action:', action);
      return {
        success: false,
        error: 'No response from server',
        errorDetail: 'routeAction returned null/undefined for action: ' + action
      };
    }

    console.log('apiCall completed in', new Date().getTime() - startTime, 'ms');
    return result;

  } catch (error) {
    console.error('API call error:', error);
    return { success: false, error: error.message, errorDetail: 'Exception in apiCall: ' + error.message };
  }
}

/**
 * Get init data - OPTIMIZED with batched operations and caching
 * Uses database-backed permissions via getUserPermissions()
 */
function getInitDataOptimized(user) {
  const startTime = new Date().getTime();
  console.log('getInitDataOptimized called for:', user ? user.email : 'null');

  if (!user) {
    return { success: false, error: 'User not found', requireLogin: true };
  }

  if (!isActive(user.is_active)) {
    return { success: false, error: 'Account is inactive' };
  }

  const cache = CacheService.getScriptCache();
  
  // Build response
  const response = {
    success: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: '',
      affiliate_code: user.affiliate_code || '',
      department: user.department || '',
      must_change_password: user.must_change_password === true || user.must_change_password === 'true' || user.must_change_password === 'TRUE'
    },
    dropdowns: {},
    config: {
      systemName: 'Hass Petroleum Internal Audit System',
      currentYear: new Date().getFullYear()
    },
    permissions: {}
  };

  // Get role name (try cache first)
  try {
    let roleName = cache.get('role_name_' + user.role_code);
    if (!roleName) {
      roleName = getRoleName(user.role_code) || user.role_code;
      cache.put('role_name_' + user.role_code, roleName, 3600);
    }
    response.user.role_name = roleName;
    console.log('Role name for', user.role_code, ':', roleName);
  } catch (e) {
    response.user.role_name = user.role_code;
    console.error('Error getting role name:', e);
  }

  // Get dropdowns (try cache first)
  try {
    response.dropdowns = getDropdownDataCached();
    console.log('Dropdowns loaded in', new Date().getTime() - startTime, 'ms');
  } catch (e) {
    console.error('Error loading dropdowns:', e);
    response.dropdowns = { affiliates: [], auditAreas: [], subAreas: [], users: [], roles: [] };
  }

  // Get config (try cache first)
  try {
    let systemName = cache.get('config_SYSTEM_NAME');
    if (!systemName) {
      systemName = getConfigValue('SYSTEM_NAME');
      if (systemName) {
        cache.put('config_SYSTEM_NAME', systemName, 3600);
      }
    }
    if (systemName) response.config.systemName = systemName;
  } catch (e) {
    console.error('Error loading config:', e);
  }

  // Get permissions from database via getUserPermissions()
  try {
    response.permissions = getUserPermissions(user.role_code);
    console.log('Permissions loaded from database in', new Date().getTime() - startTime, 'ms');
  } catch (e) {
    console.error('Error loading permissions:', e);
    response.permissions = {};
  }

  console.log('getInitDataOptimized completed in', new Date().getTime() - startTime, 'ms');
  return sanitizeForClient(response);
}

/**
 * LIGHTWEIGHT INIT - Fast first load
 * Only loads: user info, permissions, minimal config
 * Dropdowns loaded separately in background
 */
function getInitDataLight(user) {
  const startTime = new Date().getTime();
  console.log('getInitDataLight called for:', user ? user.email : 'null');

  if (!user) {
    return { success: false, error: 'User not found', requireLogin: true };
  }

  if (!isActive(user.is_active)) {
    return { success: false, error: 'Account is inactive' };
  }

  const cache = CacheService.getScriptCache();
  
  // Build minimal response - NO dropdowns
  const response = {
    success: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: '',
      affiliate_code: user.affiliate_code || '',
      department: user.department || '',
      must_change_password: user.must_change_password === true || user.must_change_password === 'true' || user.must_change_password === 'TRUE'
    },
    dropdowns: {}, // Empty - will be loaded in background
    config: {
      systemName: 'Hass Petroleum Internal Audit System',
      currentYear: new Date().getFullYear()
    },
    permissions: {}
  };

  // Get role name (cached)
  try {
    let roleName = cache.get('role_name_' + user.role_code);
    if (!roleName) {
      roleName = getRoleName(user.role_code) || user.role_code;
      cache.put('role_name_' + user.role_code, roleName, 3600);
    }
    response.user.role_name = roleName;
  } catch (e) {
    response.user.role_name = user.role_code;
  }

  // Get permissions (this is fast - single sheet lookup)
  try {
    response.permissions = getUserPermissions(user.role_code);
  } catch (e) {
    console.error('Error loading permissions:', e);
    response.permissions = {};
  }

  console.log('getInitDataLight completed in', new Date().getTime() - startTime, 'ms');
  return sanitizeForClient(response);
}

/**
 * Legacy getInitDataWithUser - redirects to optimized version
 */
function getInitDataWithUser(user) {
  return getInitDataOptimized(user);
}

// Run all scheduled maintenance tasks
function runScheduledMaintenance() {
  console.log('=== Running Scheduled Maintenance ===');
  
  try {
    const overdueCount = updateOverdueStatuses();
    console.log('Overdue statuses updated:', overdueCount);
    
    const sessionsCleaned = cleanupExpiredSessions();
    console.log('Sessions cleaned:', sessionsCleaned);
    
    const emailResult = processEmailQueue();
    console.log('Emails sent:', emailResult.sent);
    
    // Warm caches after maintenance
    warmAllCaches();
    
    console.log('=== Maintenance Complete ===');
    
    return {
      success: true,
      overdueCount,
      sessionsCleaned,
      emailsSent: emailResult.sent
    };
    
  } catch (error) {
    console.error('Maintenance error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Setup all time-based triggers
 */
function setupAllTriggers() {
  // Only delete triggers for known handler functions - preserve any custom triggers
  const knownHandlers = ['processEmailQueue', 'dailyMaintenance', 'sendWeeklySummary', 'warmAllCaches'];
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (knownHandlers.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  ScriptApp.newTrigger('processEmailQueue')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  
  ScriptApp.newTrigger('sendWeeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
  
  ScriptApp.newTrigger('warmAllCaches')
    .timeBased()
    .everyHours(6)
    .create();
  
  console.log('All triggers configured successfully');
  
  return { success: true, message: 'Triggers configured' };
}

/**
 * List all current triggers
 */
function listTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  const triggerInfo = triggers.map(t => ({
    id: t.getUniqueId(),
    function: t.getHandlerFunction(),
    type: t.getEventType().toString()
  }));

  console.log('Current triggers:', JSON.stringify(triggerInfo, null, 2));
  return triggerInfo;
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)

/**
 * DIAGNOSTIC FUNCTION
 */
function diagnoseDashboardIssues() {
  console.log('========================================');
  console.log('=== DASHBOARD DIAGNOSTIC TEST START ===');
  console.log('========================================');
  console.log('Timestamp:', new Date().toISOString());

  const results = {
    sheets: {},
    indexes: {},
    users: {},
    sessions: {},
    cache: {},
    errors: []
  };

  // Test cache
  console.log('\n=== TEST: Cache Status ===');
  const cache = CacheService.getScriptCache();
  const cacheKeys = ['dropdown_data_all', 'config_SYSTEM_NAME'];
  cacheKeys.forEach(key => {
    const value = cache.get(key);
    results.cache[key] = value ? 'HIT' : 'MISS';
    console.log(key + ':', value ? 'CACHED' : 'NOT CACHED');
  });

  // Test sheets
  console.log('\n=== TEST: Sheet Access ===');
  const requiredSheets = [
    '00_Config', '01_Roles', '02_Permissions', '05_Users', '06_Affiliates',
    '07_AuditAreas', '08_ProcessSubAreas', '09_WorkPapers', '13_ActionPlans'
  ];

  requiredSheets.forEach(name => {
    try {
      const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(name);
      const exists = !!sheet;
      const rows = exists ? sheet.getLastRow() : 0;
      results.sheets[name] = { exists: exists, rows: rows };
      console.log(name + ': ' + (exists ? 'EXISTS (' + rows + ' rows)' : 'MISSING'));
    } catch (e) {
      results.sheets[name] = { exists: false, error: e.message };
      results.errors.push('Sheet ' + name + ': ' + e.message);
    }
  });

  // Test performance
  console.log('\n=== TEST: Performance ===');
  
  const perfTests = [
    { name: 'getDropdownDataCached', fn: () => getDropdownDataCached() },
    { name: 'warmAllCaches', fn: () => warmAllCaches() }
  ];
  
  perfTests.forEach(test => {
    const start = new Date().getTime();
    try {
      test.fn();
      const duration = new Date().getTime() - start;
      results[test.name] = { duration: duration + 'ms' };
      console.log(test.name + ':', duration, 'ms');
    } catch (e) {
      results[test.name] = { error: e.message };
      console.error(test.name + ' failed:', e);
    }
  });

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
  return results;
}

/**
 * QUICK FIX: Rebuild all indexes
 */
function rebuildAllIndexesQuickFix() {
  console.log('Rebuilding all indexes...');

  try {
    Index.rebuild('USER');
    console.log('USER index rebuilt');
  } catch (e) {
    console.error('Failed to rebuild USER index:', e);
  }

  try {
    Index.rebuild('WORK_PAPER');
    console.log('WORK_PAPER index rebuilt');
  } catch (e) {
    console.error('Failed to rebuild WORK_PAPER index:', e);
  }

  try {
    Index.rebuild('ACTION_PLAN');
    console.log('ACTION_PLAN index rebuilt');
  } catch (e) {
    console.error('Failed to rebuild ACTION_PLAN index:', e);
  }

  // Warm caches after rebuild
  warmAllCaches();

  console.log('Index rebuild complete!');
  return { success: true, message: 'All indexes rebuilt and caches warmed' };
}
