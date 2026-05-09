// 08_WebApp.gs - Web Application Entry Points, API Router, File Upload, Request/Response Utilities

// Handle GET requests - serve HTML pages (login page shown first)
function doGet(e) {
  try {
    const page = e.parameter.page || 'login';

    if (page === 'consent') {
      return HtmlService.createTemplateFromFile('PrivacyConsent')
        .evaluate()
        .setTitle('Data Protection and Privacy. Hass Petroleum Audit System')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }

    if (page !== 'app' && page !== 'dashboard') {
      return HtmlService.createTemplateFromFile('Login')
        .evaluate()
        .setTitle('Hass Petroleum Audit System')
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

    case 'acceptPrivacyConsent':
      return acceptPrivacyConsent(data, user);

    case 'updateUserProfile':
      return updateUserProfile(data, user);

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
      try {
        return { success: true, workPapers: getWorkPapers(data.filters, user) };
      } catch (wpErr) {
        console.error('getWorkPapers failed:', wpErr);
        return { success: false, error: wpErr.message, workPapers: [] };
      }

    case 'getWorkPaper':
      try {
        return { success: true, workPaper: getWorkPaper(data.workPaperId, data.includeRelated !== false) };
      } catch (wpErr) {
        console.error('getWorkPaper failed:', wpErr);
        return { success: false, error: wpErr.message };
      }

    case 'getWorkPaperCounts':
      try {
        return { success: true, counts: getWorkPaperCounts(data.filters, user) };
      } catch (wpErr) {
        console.error('getWorkPaperCounts failed:', wpErr);
        return { success: false, error: wpErr.message, counts: {} };
      }
      
    case 'createWorkPaper': {
      const auditRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
      if (!auditRoles.includes(user.role_code)) {
        return jsonResponse({ success: false, error: 'Access denied' }, 403);
      }
      return createWorkPaper(data, user);
    }

    case 'updateWorkPaper': {
      const auditRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
      if (!auditRoles.includes(user.role_code)) {
        return jsonResponse({ success: false, error: 'Access denied' }, 403);
      }
      return updateWorkPaper(data.workPaperId, data, user);
    }

    case 'deleteWorkPaper':
      return deleteWorkPaper(data.workPaperId, user);

    case 'submitWorkPaper': {
      const auditRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
      if (!auditRoles.includes(user.role_code)) {
        return jsonResponse({ success: false, error: 'Access denied' }, 403);
      }
      return submitWorkPaper(data.workPaperId, user);
    }

    case 'getAutoPopulateData':
      return getAutoPopulateData(data.auditAreaId, data.subAreaId, data.affiliateCode);

    case 'requestWorkPaperChange': {
      const auditRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
      if (!auditRoles.includes(user.role_code)) {
        return jsonResponse({ success: false, error: 'Access denied' }, 403);
      }
      return requestWorkPaperChange(data, user);
    }

    case 'reviewWorkPaper': {
      const auditRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
      if (!auditRoles.includes(user.role_code)) {
        return jsonResponse({ success: false, error: 'Access denied' }, 403);
      }
      return reviewWorkPaper(data.workPaperId, data.action, data.comments, user);
    }
      
    case 'sendToAuditee':
      return sendToAuditee(data.workPaperId, user);

    case 'getSendQueue':
      return getApprovedSendQueue(user);

    case 'batchSendToAuditees':
      return batchSendToAuditees(data.workPaperIds, user);
      
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
      try {
        return { success: true, actionPlans: getActionPlans(data.filters, user) };
      } catch (apErr) {
        console.error('getActionPlans failed:', apErr);
        return { success: false, error: apErr.message, actionPlans: [] };
      }

    case 'getActionPlan':
      try {
        return { success: true, actionPlan: getActionPlan(data.actionPlanId, data.includeRelated !== false) };
      } catch (apErr) {
        console.error('getActionPlan failed:', apErr);
        return { success: false, error: apErr.message };
      }

    case 'getActionPlanCounts':
      try {
        return { success: true, counts: getActionPlanCounts(data.filters, user) };
      } catch (apErr) {
        console.error('getActionPlanCounts failed:', apErr);
        return { success: false, error: apErr.message, counts: {} };
      }
      
    case 'createActionPlan':
      return createActionPlan(data, user);
      
    case 'createActionPlansBatch':
      return createActionPlansBatch(data.workPaperId, data.plans, user);
      
    case 'updateActionPlan':
      return updateActionPlan(data.actionPlanId, data, user);
      
    case 'deleteActionPlan':
      return deleteActionPlan(data.actionPlanId, user);
      
    case 'delegateActionPlan':
      return delegateActionPlan(data.actionPlanId, data.newOwnerIds, data.newOwnerNames, data.notes, user);

    case 'markAsImplemented':
      return markAsImplemented(data.actionPlanId, data.implementationNotes, user);
      
    case 'verifyImplementation':
      return verifyImplementation(data.actionPlanId, data.action, data.comments, user);
      
    case 'hoaReview':
      return hoaReview(data.actionPlanId, data.action, data.comments, user);
      
    // ========== AUDITEE RESPONSE WORKFLOW ==========
    case 'getAuditeeFindings':
      return { success: true, findings: getAuditeeFindings(data.filters, user) };

    case 'getAuditeeResponseData':
      return getAuditeeResponseData(data.workPaperId, user);

    case 'saveDraftResponse':
      return saveDraftResponse(data.workPaperId, data, user);

    case 'submitAuditeeResponse':
      return submitAuditeeResponse(data.workPaperId, data, user);

    case 'reviewAuditeeResponse':
      return reviewAuditeeResponse(data.workPaperId, data.action, data.comments, user);

    case 'createAuditeeActionPlan':
      return createAuditeeActionPlan(data, user);

    case 'respondToDelegation':
      return respondToDelegation(data.actionPlanId, data.action, data.reason, user);

    case 'getPendingAuditeeResponses':
      var prAuditorRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
      if (!prAuditorRoles.includes(user.role_code)) return { success: false, error: 'Permission denied' };
      return { success: true, responses: getPendingAuditeeResponsesForAuditor(user) };

    case 'getAuditeeFindingCounts':
      return { success: true, counts: getAuditeeFindingCounts(user) };

    case 'getResponseHistory':
      return { success: true, responses: getResponseHistory(data.workPaperId) };

    case 'batchSubmitAuditeeResponses':
      return batchSubmitAuditeeResponses(data.workPaperIds, user);

    case 'getQueuedResponses':
      return getQueuedResponses(user);

    // ========== ACTION PLAN EVIDENCE ==========
    case 'addActionPlanEvidence':
      return addActionPlanEvidence(data.actionPlanId, data, user);
      
    case 'deleteActionPlanEvidence':
      return deleteActionPlanEvidence(data.evidenceId, user);
      
    // ========== USERS ==========
    case 'getUsers':
    case 'createUser':
    case 'updateUser':
    case 'deactivateUser':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      if (action === 'getUsers') return getUsers(data.filters, user);
      if (action === 'createUser') return createUser(data, user);
      if (action === 'updateUser') return updateUser(data.userId, data, user);
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
      var comprehensiveResult = getComprehensiveReportData(data.filters);
      // Role-based scoping: UNIT_MANAGER only sees their assigned items
      var comprehensiveScopedRoles = ['UNIT_MANAGER', 'JUNIOR_STAFF'];
      if (user && comprehensiveScopedRoles.indexOf(user.role_code) >= 0) {
        var scopeUserId = String(user.user_id);
        comprehensiveResult.workPapers = (comprehensiveResult.workPapers || []).filter(function(wp) {
          return parseIdList(wp.responsible_ids).indexOf(scopeUserId) >= 0;
        });
        comprehensiveResult.actionPlans = (comprehensiveResult.actionPlans || []).filter(function(ap) {
          return parseIdList(ap.owner_ids).indexOf(scopeUserId) >= 0;
        });
      }
      return { success: true, ...comprehensiveResult };

    case 'getDashboardDataV2': {
      // Redesigned dashboard — returns all raw data for client-side filtering
      const allowedRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR,
                            ROLES.SENIOR_MGMT, ROLES.BOARD_MEMBER];
      if (!allowedRoles.includes(user.role_code)) {
        return jsonResponse({ success: false, error: 'Access denied' }, 403);
      }
      return getDashboardDataV2(data);
    }

    // ========== NOTIFICATIONS ==========
    case 'getNotificationQueueStatus':
      return { success: true, status: getNotificationQueueStatus() };
      
    case 'getUserNotifications':
      return { success: true, notifications: getUserNotifications(user.user_id, data.limit) };

    case 'sendBatchedAssignmentNotifications':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Head of Internal Audit can send batch notifications' };
      }
      return sendBatchedAssignmentNotifications();

    case 'getPendingBatchNotificationCount':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted' };
      }
      return { success: true, data: getPendingBatchNotificationCount() };
      
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

    // ========== SETTINGS (SUPER_ADMIN ONLY) ==========
    case 'getAccessControlDashboardData':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return { success: true, data: getAccessControlDashboardData() };

    case 'getPermissions':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return { success: true, permissions: getPermissionsCached(data.roleCode) };

    case 'updatePermissions':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return updatePermissions(data, user);

    case 'getUserStats':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return { success: true, stats: getUserStats() };

    case 'getSystemConfig':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return { success: true, config: getSystemConfigValues() };

    case 'saveSystemConfig':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return saveSystemConfigValues(data.config, user);

    case 'getAuditLog':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
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

    case 'purgeAndSeedTestData':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can purge and seed test data' };
      }
      return { success: true, report: purgeAndSeedTestData() };

    case 'purgeAndResyncFirestore':
      return { success: false, error: 'purgeAndResyncFirestore is deprecated. System now uses Turso exclusively.' };

    // ========== DATA & BACKUP ==========
    case 'getBackupStatus':
      if (!canUserPerform(user, 'read', 'CONFIG', null)) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, status: getBackupStatus() };

    case 'saveBackupSettings':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can change backup settings' };
      }
      return saveBackupSettings(data);

    case 'runIncrementalBackup':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can trigger backups' };
      }
      return runIncrementalBackup();

    case 'runFullSheetBackup':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Only Super Admin can trigger full backups' };
      }
      return runFullSheetBackup();

    // ========== AI SERVICE ==========
    case 'getAIConfigStatus':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return { success: true, config: getAIConfigStatus() };

    case 'setAIApiKey':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return setAIApiKey(data.provider, data.apiKey, user);

    case 'removeAIApiKey':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return removeAIApiKey(data.provider, user);

    case 'setActiveAIProvider':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return setActiveAIProvider(data.provider, user);

    case 'testAIConnection':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return testAIConnection(data.provider, user);

    case 'getWorkPaperInsights':
      return getWorkPaperInsights(data.workPaperId, user);

    case 'validateActionPlan':
      return validateActionPlan(data.actionPlan, data.workPaperContext, user);

    case 'getAnalyticsInsights':
      return getAnalyticsInsights(data.analyticsData, user);

    // ========== EMAIL (OUTLOOK / MICROSOFT GRAPH) ==========
    case 'getOutlookStatus':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return getOutlookStatus();

    case 'testOutlookEmail':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      return testOutlookEmailAction(data.recipientEmail, user);

    // ========== EMAIL TEMPLATES ==========
    case 'getEmailTemplatesAll':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
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

    // ========== BOARD REPORTS ==========
    case 'generateBoardReport':
      var boardReportAllowedRoles = [ROLES.BOARD_MEMBER, 'BOARD', ROLES.SUPER_ADMIN, ROLES.SENIOR_MGMT, ROLES.UNIT_MANAGER];
      if (boardReportAllowedRoles.indexOf(user.role_code) === -1) {
        return { success: false, error: 'Access restricted to authorized roles only' };
      }
      return generateBoardReport(data.filters, data.reportType, user);

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

    // ========== DROPDOWN MANAGEMENT (SUPER_ADMIN / SENIOR_AUDITOR only) ==========
    case 'getDropdownItems':
    case 'createDropdownItem':
    case 'updateDropdownItem':
    case 'deleteDropdownItem':
    case 'updateDropdownOrder':
    case 'saveConfigDropdown': {
      const refDataRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR];
      if (!refDataRoles.includes(user.role_code)) {
        return { success: false, error: 'Access restricted to Head of Internal Audit only' };
      }
      if (action === 'getDropdownItems')   return getDropdownItems(data, user);
      if (action === 'createDropdownItem') return createDropdownItem(data, user);
      if (action === 'updateDropdownItem') return updateDropdownItem(data, user);
      if (action === 'deleteDropdownItem') return deleteDropdownItem(data, user);
      if (action === 'updateDropdownOrder') return updateDropdownOrder(data, user);
      if (action === 'saveConfigDropdown') return saveConfigDropdown(data, user);
      break;
    }

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
    const roles = ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'AUDITOR', 'JUNIOR_STAFF', 'SENIOR_MGMT', 'UNIT_MANAGER', 'BOARD_MEMBER', 'EXTERNAL_AUDITOR'];
    // Permissions are now hardcoded in ROLE_PERMISSIONS — no need to cache from Firestore
    console.log('Permissions are hardcoded — skipping permission cache warming');
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
  const roles = ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'AUDITOR', 'JUNIOR_STAFF', 'UNIT_MANAGER', 'SENIOR_MGMT', 'BOARD_MEMBER', 'EXTERNAL_AUDITOR'];
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
        storage_id:  file.getId(),
        storage_url: file.getUrl(),
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

  // Add pending finding counts for auditee roles
  var auditeeRoles = ['JUNIOR_STAFF', 'UNIT_MANAGER', 'SENIOR_MGMT'];
  if (auditeeRoles.indexOf(user.role_code) >= 0) {
    try {
      response.pendingFindings = getAuditeeFindingCounts(user);
    } catch (e) {
      console.warn('Failed to get pending finding counts for auditee init:', e.message);
      response.pendingFindings = null;
    }
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

  // Add pending finding counts for auditee roles
  var auditeeRoles = ['JUNIOR_STAFF', 'UNIT_MANAGER', 'SENIOR_MGMT'];
  if (auditeeRoles.indexOf(user.role_code) >= 0) {
    try {
      response.pendingFindings = getAuditeeFindingCounts(user);
    } catch (e) {
      console.warn('Failed to get pending finding counts for auditee init:', e.message);
      response.pendingFindings = null;
    }
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
    
    // Run incremental backup if in incremental mode
    try {
      if (typeof getSheetBackupMode === 'function' && getSheetBackupMode() === 'incremental') {
        var backupResult = runIncrementalBackup();
        console.log('Incremental backup:', backupResult.processed, 'changes synced');
      }
    } catch (backupErr) {
      console.warn('Incremental backup during maintenance failed:', backupErr.message);
    }

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
  const knownHandlers = ['processEmailQueue', 'dailyMaintenance', 'sendWeeklySummary', 'warmAllCaches', 'runIncrementalBackup'];
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

/**
 * Generate a board-level audit report
 * Creates a Google Doc, populates with filtered report data, exports as .docx
 * @param {Object} filters - Date range, affiliate, risk rating, status filters
 * @param {string} reportType - 'executive', 'detailed', 'action-tracker', 'overdue'
 * @param {Object} user - Authenticated user (BOARD_MEMBER or SUPER_ADMIN only)
 */
function generateBoardReport(filters, reportType, user) {
  try {
    filters = filters || {};
    reportType = reportType || 'executive';

    // Get comprehensive report data (reuse existing function)
    var reportData = getComprehensiveReportData(filters);
    var workPapers = reportData.workPapers || [];
    var actionPlans = reportData.actionPlans || [];

    // Role-based scoping: UNIT_MANAGER only sees their assigned items
    var scopedRoles = ['UNIT_MANAGER', 'JUNIOR_STAFF'];
    if (user && scopedRoles.indexOf(user.role_code) >= 0) {
      var userId = String(user.user_id);
      workPapers = workPapers.filter(function(wp) {
        return parseIdList(wp.responsible_ids).indexOf(userId) >= 0;
      });
      actionPlans = actionPlans.filter(function(ap) {
        return parseIdList(ap.owner_ids).indexOf(userId) >= 0;
      });
    }

    // Apply date range filter
    if (filters.dateFrom || filters.dateTo) {
      var dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
      var dateTo = filters.dateTo ? new Date(filters.dateTo) : null;
      if (dateFrom) dateFrom.setHours(0, 0, 0, 0);
      if (dateTo) dateTo.setHours(23, 59, 59, 999);

      workPapers = workPapers.filter(function(wp) {
        var wpDate = new Date(wp.created_at || wp.work_paper_date || 0);
        if (dateFrom && wpDate < dateFrom) return false;
        if (dateTo && wpDate > dateTo) return false;
        return true;
      });
    }

    // Apply risk rating filter
    if (filters.riskRatings && filters.riskRatings.length > 0) {
      workPapers = workPapers.filter(function(wp) {
        return filters.riskRatings.indexOf(wp.risk_rating) >= 0;
      });
    }

    // Apply status filter
    if (filters.statuses && filters.statuses.length > 0) {
      workPapers = workPapers.filter(function(wp) {
        return filters.statuses.indexOf(wp.status) >= 0;
      });
    }

    // Apply affiliate filter
    if (filters.affiliate && filters.affiliate !== 'All') {
      workPapers = workPapers.filter(function(wp) {
        return wp.affiliate_code === filters.affiliate;
      });
    }

    // Filter action plans to match remaining work papers
    var wpIds = {};
    workPapers.forEach(function(wp) { wpIds[wp.work_paper_id] = true; });
    actionPlans = actionPlans.filter(function(ap) { return wpIds[ap.work_paper_id]; });

    // Build report statistics
    var stats = {
      totalObservations: workPapers.length,
      totalActionPlans: actionPlans.length,
      riskDistribution: { Extreme: 0, High: 0, Medium: 0, Low: 0 },
      statusDistribution: {},
      overdueAPs: 0,
      implementedAPs: 0
    };

    workPapers.forEach(function(wp) {
      if (stats.riskDistribution.hasOwnProperty(wp.risk_rating)) {
        stats.riskDistribution[wp.risk_rating]++;
      }
      stats.statusDistribution[wp.status] = (stats.statusDistribution[wp.status] || 0) + 1;
    });

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var closedStatuses = ['Implemented', 'Verified', 'Not Implemented', 'Closed', 'Rejected'];

    actionPlans.forEach(function(ap) {
      if (ap.status === 'Implemented' || ap.status === 'Verified') stats.implementedAPs++;
      if (ap.due_date && !closedStatuses.includes(ap.status)) {
        var due = new Date(ap.due_date);
        due.setHours(0, 0, 0, 0);
        if (due < today) stats.overdueAPs++;
      }
    });

    var implementationRate = stats.totalActionPlans > 0
      ? Math.round((stats.implementedAPs / stats.totalActionPlans) * 100)
      : 0;

    // Create Google Doc
    var reportTypeLabels = {
      'executive': 'Executive Summary',
      'detailed': 'Detailed Observations',
      'action-tracker': 'Action Plan Tracker',
      'overdue': 'Overdue & At-Risk'
    };
    var reportLabel = reportTypeLabels[reportType] || 'Audit Report';
    var dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM-yyyy');
    var docTitle = 'Hass Petroleum - ' + reportLabel + ' - ' + dateStr;

    var doc = DocumentApp.create(docTitle);
    var body = doc.getBody();

    // Styling constants
    var navyColor = '#1A365D';
    var goldColor = '#C9A83E';

    // ── COVER PAGE ──
    var cover = body.appendParagraph('HASS PETROLEUM');
    cover.setFontFamily('Arial');
    cover.setFontSize(28);
    cover.setBold(true);
    cover.setForegroundColor(navyColor);
    cover.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    var subtitle = body.appendParagraph('Internal Audit Division');
    subtitle.setFontFamily('Arial');
    subtitle.setFontSize(14);
    subtitle.setForegroundColor(goldColor);
    subtitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    body.appendParagraph('').setSpacingAfter(20);

    var reportTitle = body.appendParagraph(reportLabel);
    reportTitle.setFontFamily('Arial');
    reportTitle.setFontSize(22);
    reportTitle.setBold(true);
    reportTitle.setForegroundColor(navyColor);
    reportTitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    var dateRange = '';
    if (filters.dateFrom && filters.dateTo) {
      dateRange = filters.dateFrom + ' to ' + filters.dateTo;
    } else if (filters.dateFrom) {
      dateRange = 'From ' + filters.dateFrom;
    } else if (filters.dateTo) {
      dateRange = 'Up to ' + filters.dateTo;
    } else {
      dateRange = 'All available data';
    }
    var datePara = body.appendParagraph('Period: ' + dateRange);
    datePara.setFontFamily('Arial');
    datePara.setFontSize(12);
    datePara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    datePara.setForegroundColor('#666666');

    var genDate = body.appendParagraph('Generated: ' + dateStr);
    genDate.setFontFamily('Arial');
    genDate.setFontSize(10);
    genDate.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    genDate.setForegroundColor('#999999');

    body.appendParagraph('').setSpacingAfter(40);

    var confidential = body.appendParagraph('CONFIDENTIAL \u2014 For Board Audit Committee Use Only');
    confidential.setFontFamily('Arial');
    confidential.setFontSize(10);
    confidential.setBold(true);
    confidential.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    confidential.setForegroundColor('#DC3545');

    body.appendPageBreak();

    // ── EXECUTIVE SUMMARY ──
    var execHeader = body.appendParagraph('Executive Summary');
    execHeader.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    execHeader.setFontFamily('Arial');
    execHeader.setForegroundColor(navyColor);

    // KPI Table
    var kpiData = [
      ['Metric', 'Value'],
      ['Total Observations', String(stats.totalObservations)],
      ['Total Action Plans', String(stats.totalActionPlans)],
      ['Overdue Action Plans', String(stats.overdueAPs)],
      ['Implementation Rate', implementationRate + '%'],
      ['Extreme Risk', String(stats.riskDistribution.Extreme)],
      ['High Risk', String(stats.riskDistribution.High)],
      ['Medium Risk', String(stats.riskDistribution.Medium)],
      ['Low Risk', String(stats.riskDistribution.Low)]
    ];

    var kpiTable = body.appendTable(kpiData);
    kpiTable.setBorderColor(navyColor);
    var headerRow = kpiTable.getRow(0);
    for (var ci = 0; ci < headerRow.getNumCells(); ci++) {
      headerRow.getCell(ci).setBackgroundColor(navyColor);
      headerRow.getCell(ci).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true);
    }
    for (var ri = 1; ri < kpiTable.getNumRows(); ri++) {
      for (var ci2 = 0; ci2 < kpiTable.getRow(ri).getNumCells(); ci2++) {
        kpiTable.getRow(ri).getCell(ci2).editAsText().setFontFamily('Arial').setFontSize(10);
      }
    }

    // ── STATUS DISTRIBUTION TABLE ──
    body.appendParagraph('');
    var statusHeader = body.appendParagraph('Implementation Status');
    statusHeader.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    statusHeader.setFontFamily('Arial');
    statusHeader.setForegroundColor(navyColor);

    var apStatusDist = {};
    actionPlans.forEach(function(ap) { apStatusDist[ap.status || 'Unknown'] = (apStatusDist[ap.status || 'Unknown'] || 0) + 1; });
    var statusTableData = [['Status', 'Count', '% of Total']];
    Object.keys(apStatusDist).sort().forEach(function(s) {
      var pct = stats.totalActionPlans > 0 ? Math.round((apStatusDist[s] / stats.totalActionPlans) * 100) : 0;
      statusTableData.push([s, String(apStatusDist[s]), pct + '%']);
    });
    var statusTable = body.appendTable(statusTableData);
    statusTable.setBorderColor('#CCCCCC');
    var stHdr = statusTable.getRow(0);
    for (var sti = 0; sti < stHdr.getNumCells(); sti++) {
      stHdr.getCell(sti).setBackgroundColor(navyColor);
      stHdr.getCell(sti).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(9);
    }
    for (var stri = 1; stri < statusTable.getNumRows(); stri++) {
      for (var stci = 0; stci < statusTable.getRow(stri).getNumCells(); stci++) {
        statusTable.getRow(stri).getCell(stci).editAsText().setFontFamily('Arial').setFontSize(9);
      }
    }

    // ── BY AFFILIATE TABLE ──
    body.appendParagraph('');
    var affHeader = body.appendParagraph('By Affiliate');
    affHeader.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    affHeader.setFontFamily('Arial');
    affHeader.setForegroundColor(navyColor);

    var affMap = {};
    workPapers.forEach(function(wp) {
      var aff = wp.affiliate_name || wp.affiliate_code || 'Unknown';
      if (!affMap[aff]) affMap[aff] = { obs: 0, aps: 0, impl: 0, overdue: 0 };
      affMap[aff].obs++;
    });
    actionPlans.forEach(function(ap) {
      var parentWp = workPapers.find(function(wp) { return wp.work_paper_id === ap.work_paper_id; });
      var aff = parentWp ? (parentWp.affiliate_name || parentWp.affiliate_code || 'Unknown') : 'Unknown';
      if (!affMap[aff]) affMap[aff] = { obs: 0, aps: 0, impl: 0, overdue: 0 };
      affMap[aff].aps++;
      if (ap.status === 'Implemented' || ap.status === 'Verified') affMap[aff].impl++;
      if (ap.due_date && !closedStatuses.includes(ap.status)) {
        var due = new Date(ap.due_date); due.setHours(0,0,0,0);
        if (due < today) affMap[aff].overdue++;
      }
    });
    var affTableData = [['Affiliate', 'Observations', 'Action Plans', 'Implemented', 'Overdue', 'Impl. Rate']];
    var affKeys = Object.keys(affMap).sort(function(a, b) { return affMap[b].obs - affMap[a].obs; });
    affKeys.forEach(function(aff) {
      var d = affMap[aff];
      var rate = d.aps > 0 ? Math.round((d.impl / d.aps) * 100) : 0;
      affTableData.push([aff, String(d.obs), String(d.aps), String(d.impl), String(d.overdue), rate + '%']);
    });
    var affTable = body.appendTable(affTableData);
    affTable.setBorderColor('#CCCCCC');
    var afHdr = affTable.getRow(0);
    for (var afi = 0; afi < afHdr.getNumCells(); afi++) {
      afHdr.getCell(afi).setBackgroundColor(navyColor);
      afHdr.getCell(afi).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(9);
    }
    for (var afri = 1; afri < affTable.getNumRows(); afri++) {
      for (var afci = 0; afci < affTable.getRow(afri).getNumCells(); afci++) {
        affTable.getRow(afri).getCell(afci).editAsText().setFontFamily('Arial').setFontSize(9);
      }
    }

    // ── BY AUDIT AREA TABLE ──
    body.appendParagraph('');
    var areaHeader = body.appendParagraph('By Audit Area');
    areaHeader.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    areaHeader.setFontFamily('Arial');
    areaHeader.setForegroundColor(navyColor);

    var areaMap = {};
    workPapers.forEach(function(wp) {
      var area = wp.audit_area_name || wp.audit_area_id || 'Unknown';
      if (!areaMap[area]) areaMap[area] = { obs: 0, aps: 0, impl: 0 };
      areaMap[area].obs++;
    });
    actionPlans.forEach(function(ap) {
      var parentWp = workPapers.find(function(wp) { return wp.work_paper_id === ap.work_paper_id; });
      var area = parentWp ? (parentWp.audit_area_name || parentWp.audit_area_id || 'Unknown') : 'Unknown';
      if (!areaMap[area]) areaMap[area] = { obs: 0, aps: 0, impl: 0 };
      areaMap[area].aps++;
      if (ap.status === 'Implemented' || ap.status === 'Verified') areaMap[area].impl++;
    });
    var areaTableData = [['Audit Area', 'Observations', 'Action Plans', 'Impl. Rate']];
    var areaKeys = Object.keys(areaMap).sort(function(a, b) { return areaMap[b].obs - areaMap[a].obs; });
    areaKeys.forEach(function(area) {
      var d = areaMap[area];
      var rate = d.aps > 0 ? Math.round((d.impl / d.aps) * 100) : 0;
      areaTableData.push([area, String(d.obs), String(d.aps), rate + '%']);
    });
    var areaTable = body.appendTable(areaTableData);
    areaTable.setBorderColor('#CCCCCC');
    var arHdr = areaTable.getRow(0);
    for (var ari2 = 0; ari2 < arHdr.getNumCells(); ari2++) {
      arHdr.getCell(ari2).setBackgroundColor(navyColor);
      arHdr.getCell(ari2).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(9);
    }
    for (var arri = 1; arri < areaTable.getNumRows(); arri++) {
      for (var arci = 0; arci < areaTable.getRow(arri).getNumCells(); arci++) {
        areaTable.getRow(arri).getCell(arci).editAsText().setFontFamily('Arial').setFontSize(9);
      }
    }

    if (reportType === 'executive') {
      // Executive summary with all tables above — done
    }

    // ── DETAILED OBSERVATIONS ──
    if (reportType === 'detailed' || reportType === 'executive') {
      body.appendParagraph('');
      var obsHeader = body.appendParagraph('Observations');
      obsHeader.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      obsHeader.setFontFamily('Arial');
      obsHeader.setForegroundColor(navyColor);

      if (workPapers.length === 0) {
        body.appendParagraph('No observations match the selected filters.');
      } else {
        workPapers.forEach(function(wp, idx) {
          var wpTitle = body.appendParagraph((idx + 1) + '. ' + (wp.observation_title || 'Untitled'));
          wpTitle.setHeading(DocumentApp.ParagraphHeading.HEADING2);
          wpTitle.setFontFamily('Arial');
          wpTitle.setForegroundColor(navyColor);

          var detailData = [
            ['Field', 'Details'],
            ['Risk Rating', wp.risk_rating || 'N/A'],
            ['Status', wp.status || 'N/A'],
            ['Affiliate', wp.affiliate_code || 'N/A'],
            ['Description', wp.observation_description || 'N/A'],
            ['Recommendation', wp.recommendation || 'N/A']
          ];
          var detailTable = body.appendTable(detailData);
          detailTable.setBorderColor('#CCCCCC');
          var dHeaderRow = detailTable.getRow(0);
          for (var dci = 0; dci < dHeaderRow.getNumCells(); dci++) {
            dHeaderRow.getCell(dci).setBackgroundColor(navyColor);
            dHeaderRow.getCell(dci).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(9);
          }
          for (var dri = 1; dri < detailTable.getNumRows(); dri++) {
            for (var dci2 = 0; dci2 < detailTable.getRow(dri).getNumCells(); dci2++) {
              detailTable.getRow(dri).getCell(dci2).editAsText().setFontFamily('Arial').setFontSize(9);
            }
          }

          // Nested action plans
          var wpAps = actionPlans.filter(function(ap) { return ap.work_paper_id === wp.work_paper_id; });
          if (wpAps.length > 0) {
            var apSubHeader = body.appendParagraph('Action Plans:');
            apSubHeader.setFontFamily('Arial');
            apSubHeader.setFontSize(10);
            apSubHeader.setBold(true);
            apSubHeader.setForegroundColor(goldColor);

            var apTableData = [['#', 'Description', 'Owner', 'Due Date', 'Status']];
            wpAps.forEach(function(ap, apIdx) {
              apTableData.push([
                String(apIdx + 1),
                ap.action_description || 'N/A',
                ap.owner_names || 'N/A',
                ap.due_date || 'N/A',
                ap.status || 'N/A'
              ]);
            });
            var apTable = body.appendTable(apTableData);
            apTable.setBorderColor('#CCCCCC');
            var apHdr = apTable.getRow(0);
            for (var aci = 0; aci < apHdr.getNumCells(); aci++) {
              apHdr.getCell(aci).setBackgroundColor(goldColor);
              apHdr.getCell(aci).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(8);
            }
            for (var ari = 1; ari < apTable.getNumRows(); ari++) {
              for (var aci2 = 0; aci2 < apTable.getRow(ari).getNumCells(); aci2++) {
                apTable.getRow(ari).getCell(aci2).editAsText().setFontFamily('Arial').setFontSize(8);
              }
            }
          }
          body.appendParagraph('');
        });
      }
    }

    // ── ACTION PLAN TRACKER ──
    if (reportType === 'action-tracker') {
      body.appendParagraph('');
      var apTrackerHeader = body.appendParagraph('Action Plan Tracker');
      apTrackerHeader.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      apTrackerHeader.setFontFamily('Arial');
      apTrackerHeader.setForegroundColor(navyColor);

      if (actionPlans.length === 0) {
        body.appendParagraph('No action plans match the selected filters.');
      } else {
        var trackerData = [['Observation', 'Action Plan', 'Owner', 'Due Date', 'Status', 'Evidence']];
        actionPlans.forEach(function(ap) {
          var parentWp = workPapers.find(function(wp) { return wp.work_paper_id === ap.work_paper_id; });
          trackerData.push([
            parentWp ? (parentWp.observation_title || 'N/A') : 'N/A',
            ap.action_description || 'N/A',
            ap.owner_names || 'N/A',
            ap.due_date || 'N/A',
            ap.status || 'N/A',
            ap.implementation_notes ? 'Yes' : 'No'
          ]);
        });
        var trackerTable = body.appendTable(trackerData);
        trackerTable.setBorderColor('#CCCCCC');
        var tHdr = trackerTable.getRow(0);
        for (var ti = 0; ti < tHdr.getNumCells(); ti++) {
          tHdr.getCell(ti).setBackgroundColor(navyColor);
          tHdr.getCell(ti).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(8);
        }
        for (var tri = 1; tri < trackerTable.getNumRows(); tri++) {
          for (var tci = 0; tci < trackerTable.getRow(tri).getNumCells(); tci++) {
            trackerTable.getRow(tri).getCell(tci).editAsText().setFontFamily('Arial').setFontSize(8);
          }
        }
      }
    }

    // ── OVERDUE & AT-RISK ──
    if (reportType === 'overdue') {
      body.appendParagraph('');
      var overdueHeader = body.appendParagraph('Overdue & At-Risk Items');
      overdueHeader.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      overdueHeader.setFontFamily('Arial');
      overdueHeader.setForegroundColor(navyColor);

      var fourteenDaysOut = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
      var overdueAps = [];
      var atRiskAps = [];
      actionPlans.forEach(function(ap) {
        if (!ap.due_date || closedStatuses.includes(ap.status)) return;
        var due = new Date(ap.due_date);
        due.setHours(0, 0, 0, 0);
        if (due < today) {
          overdueAps.push(ap);
        } else if (due < fourteenDaysOut) {
          atRiskAps.push(ap);
        }
      });

      // Summary paragraph
      var summaryText = 'Overdue: ' + overdueAps.length + ' | At-Risk (due within 14 days): ' + atRiskAps.length;
      var summaryPara = body.appendParagraph(summaryText);
      summaryPara.setFontFamily('Arial');
      summaryPara.setFontSize(11);
      summaryPara.setBold(true);
      summaryPara.setSpacingAfter(8);

      // Overdue table
      if (overdueAps.length === 0) {
        body.appendParagraph('No overdue action plans found for the selected filters.');
      } else {
        var overdueSubH = body.appendParagraph('Overdue Items');
        overdueSubH.setHeading(DocumentApp.ParagraphHeading.HEADING2);
        overdueSubH.setFontFamily('Arial');
        overdueSubH.setForegroundColor('#DC3545');

        var overdueData = [['Observation', 'Action Plan', 'Owner', 'Due Date', 'Days Overdue', 'Risk', 'Status']];
        overdueAps.sort(function(a, b) {
          return new Date(a.due_date) - new Date(b.due_date);
        });
        overdueAps.forEach(function(ap) {
          var parentWp = workPapers.find(function(wp) { return wp.work_paper_id === ap.work_paper_id; });
          var due = new Date(ap.due_date);
          var daysOverdue = Math.floor((today - due) / (1000 * 60 * 60 * 24));
          overdueData.push([
            parentWp ? (parentWp.observation_title || 'N/A') : 'N/A',
            ap.action_description || 'N/A',
            ap.owner_names || 'N/A',
            ap.due_date || 'N/A',
            String(daysOverdue),
            parentWp ? (parentWp.risk_rating || 'N/A') : 'N/A',
            ap.status || 'N/A'
          ]);
        });
        var overdueTable = body.appendTable(overdueData);
        overdueTable.setBorderColor('#CCCCCC');
        var oHdr = overdueTable.getRow(0);
        for (var oi2 = 0; oi2 < oHdr.getNumCells(); oi2++) {
          oHdr.getCell(oi2).setBackgroundColor('#DC3545');
          oHdr.getCell(oi2).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(8);
        }
        for (var ori = 1; ori < overdueTable.getNumRows(); ori++) {
          for (var oci = 0; oci < overdueTable.getRow(ori).getNumCells(); oci++) {
            overdueTable.getRow(ori).getCell(oci).editAsText().setFontFamily('Arial').setFontSize(8);
          }
        }
      }

      // At-Risk table
      if (atRiskAps.length > 0) {
        body.appendParagraph('');
        var atRiskSubH = body.appendParagraph('At-Risk Items (Due Within 14 Days)');
        atRiskSubH.setHeading(DocumentApp.ParagraphHeading.HEADING2);
        atRiskSubH.setFontFamily('Arial');
        atRiskSubH.setForegroundColor('#856404');

        var atRiskData = [['Observation', 'Action Plan', 'Owner', 'Due Date', 'Days Until Due', 'Risk', 'Status']];
        atRiskAps.sort(function(a, b) {
          return new Date(a.due_date) - new Date(b.due_date);
        });
        atRiskAps.forEach(function(ap) {
          var parentWp = workPapers.find(function(wp) { return wp.work_paper_id === ap.work_paper_id; });
          var due = new Date(ap.due_date);
          var daysUntil = Math.floor((due - today) / (1000 * 60 * 60 * 24));
          atRiskData.push([
            parentWp ? (parentWp.observation_title || 'N/A') : 'N/A',
            ap.action_description || 'N/A',
            ap.owner_names || 'N/A',
            ap.due_date || 'N/A',
            String(daysUntil),
            parentWp ? (parentWp.risk_rating || 'N/A') : 'N/A',
            ap.status || 'N/A'
          ]);
        });
        var atRiskTable = body.appendTable(atRiskData);
        atRiskTable.setBorderColor('#CCCCCC');
        var arHdr2 = atRiskTable.getRow(0);
        for (var ari3 = 0; ari3 < arHdr2.getNumCells(); ari3++) {
          arHdr2.getCell(ari3).setBackgroundColor('#FFC107');
          arHdr2.getCell(ari3).editAsText().setForegroundColor('#000000').setFontFamily('Arial').setBold(true).setFontSize(8);
        }
        for (var arri2 = 1; arri2 < atRiskTable.getNumRows(); arri2++) {
          for (var arci2 = 0; arci2 < atRiskTable.getRow(arri2).getNumCells(); arci2++) {
            atRiskTable.getRow(arri2).getCell(arci2).editAsText().setFontFamily('Arial').setFontSize(8);
          }
        }
      }
    }

    // ── APPENDIX ──
    body.appendPageBreak();
    var appHeader = body.appendParagraph('Appendix: Risk Framework');
    appHeader.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    appHeader.setFontFamily('Arial');
    appHeader.setForegroundColor(navyColor);

    var riskDefs = [
      ['Risk Rating', 'Definition'],
      ['Extreme', 'Critical control failure with potential for material loss or regulatory breach. Requires immediate board attention.'],
      ['High', 'Significant control weakness likely to result in notable financial or operational impact. Requires urgent management action.'],
      ['Medium', 'Moderate control weakness that could lead to inefficiencies or minor losses. Requires management attention within agreed timelines.'],
      ['Low', 'Minor control improvement opportunity. Addressed as part of normal business operations.']
    ];
    var riskTable = body.appendTable(riskDefs);
    riskTable.setBorderColor('#CCCCCC');
    var riskHdr = riskTable.getRow(0);
    for (var rki = 0; rki < riskHdr.getNumCells(); rki++) {
      riskHdr.getCell(rki).setBackgroundColor(navyColor);
      riskHdr.getCell(rki).editAsText().setForegroundColor('#FFFFFF').setFontFamily('Arial').setBold(true).setFontSize(9);
    }
    for (var rri = 1; rri < riskTable.getNumRows(); rri++) {
      for (var rci = 0; rci < riskTable.getRow(rri).getNumCells(); rci++) {
        riskTable.getRow(rri).getCell(rci).editAsText().setFontFamily('Arial').setFontSize(9);
      }
    }

    // Add header and footer
    var docHeader = doc.addHeader();
    var headerPara = docHeader.appendParagraph('Hass Petroleum \u2014 Internal Audit Report');
    headerPara.setFontFamily('Arial');
    headerPara.setFontSize(8);
    headerPara.setForegroundColor('#999999');
    headerPara.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

    var docFooter = doc.addFooter();
    var footerPara = docFooter.appendParagraph('Confidential | Generated ' + dateStr);
    footerPara.setFontFamily('Arial');
    footerPara.setFontSize(8);
    footerPara.setForegroundColor('#999999');
    footerPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    // Save and export
    doc.saveAndClose();

    var docFile = DriveApp.getFileById(doc.getId());
    var blob = docFile.getAs('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    blob.setName(docTitle + '.docx');

    // Save to Exports subfolder (from config), fall back to named folder
    var exportFolder;
    var exportFolderId = getDriveFolderId('DRIVE_EXPORTS_FOLDER_ID');
    if (exportFolderId) {
      try {
        exportFolder = DriveApp.getFolderById(exportFolderId);
      } catch (folderErr) {
        console.warn('Exports folder not accessible, falling back:', folderErr.message);
      }
    }
    if (!exportFolder) {
      var folders = DriveApp.getFoldersByName('Audit Report Exports');
      if (folders.hasNext()) {
        exportFolder = folders.next();
      } else {
        exportFolder = DriveApp.createFolder('Audit Report Exports');
      }
    }
    var exportFile = exportFolder.createFile(blob);

    // Clean up temp Google Doc
    docFile.setTrashed(true);

    // Build clean filename
    var fileSlug = reportLabel.replace(/[^a-zA-Z0-9]/g, '_');
    var fileName = 'Audit_Report_' + fileSlug + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.docx';

    // Return base64 for client-side download + fallback URL
    var base64 = Utilities.base64Encode(blob.getBytes());

    return {
      success: true,
      downloadUrl: exportFile.getDownloadUrl(),
      base64: base64,
      fileName: fileName,
      stats: stats
    };
  } catch (e) {
    console.error('Error generating board report:', e);
    return { success: false, error: 'Failed to generate report: ' + e.message };
  }
}


// ─────────────────────────────────────────────────────────────
// ONE-TIME MIGRATION: Move misplaced files from parent folder
// to correct subfolders based on Firestore references.
// Run manually from the Apps Script editor. Do NOT add a trigger.
// ─────────────────────────────────────────────────────────────

function migrateExistingDriveFiles() {
  var parentFolderId = getConfigValue('DRIVE_PARENT_FOLDER_ID') || getConfigValue('AUDIT_FILES_FOLDER_ID');
  if (!parentFolderId) {
    console.log('No parent folder configured. Aborting migration.');
    return;
  }

  var wpFolderId = getConfigValue('DRIVE_WP_FILES_FOLDER_ID');
  var apFolderId = getConfigValue('DRIVE_AP_EVIDENCE_FOLDER_ID');
  var exportsFolderId = getConfigValue('DRIVE_EXPORTS_FOLDER_ID');

  // Build lookup sets of known Drive file IDs from Firestore
  var wpFileIds = {};
  var apFileIds = {};

  try {
    var wpFiles = tursoGetAll('11_WorkPaperFiles');
    wpFiles.forEach(function(f) { if (f.storage_id) wpFileIds[f.storage_id] = true; });
    console.log('Found ' + Object.keys(wpFileIds).length + ' WP file references in Turso.');
  } catch (e) { console.warn('Could not load WP files:', e.message); }

  try {
    var apEvidence = tursoGetAll('14_ActionPlanEvidence');
    apEvidence.forEach(function(f) { if (f.storage_id) apFileIds[f.storage_id] = true; });
    console.log('Found ' + Object.keys(apFileIds).length + ' AP evidence references in Turso.');
  } catch (e) { console.warn('Could not load AP evidence:', e.message); }

  var parentFolder = DriveApp.getFolderById(parentFolderId);
  var files = parentFolder.getFiles();
  var moved = { wp: 0, ap: 0, exports: 0, skipped: 0 };

  while (files.hasNext()) {
    var file = files.next();
    var fileId = file.getId();
    var fileName = file.getName();

    if (wpFileIds[fileId] && wpFolderId) {
      try {
        file.moveTo(DriveApp.getFolderById(wpFolderId));
        moved.wp++;
        console.log('Moved to WP Files: ' + fileName + ' (' + fileId + ')');
      } catch (e) { console.warn('Failed to move WP file ' + fileId + ':', e.message); }
    } else if (apFileIds[fileId] && apFolderId) {
      try {
        file.moveTo(DriveApp.getFolderById(apFolderId));
        moved.ap++;
        console.log('Moved to AP Evidence: ' + fileName + ' (' + fileId + ')');
      } catch (e) { console.warn('Failed to move AP file ' + fileId + ':', e.message); }
    } else if (exportsFolderId && (
      fileName.toLowerCase().indexOf('export') >= 0 ||
      fileName.toLowerCase().indexOf('report') >= 0 ||
      fileName.toLowerCase().endsWith('.docx')
    )) {
      try {
        file.moveTo(DriveApp.getFolderById(exportsFolderId));
        moved.exports++;
        console.log('Moved to Exports: ' + fileName + ' (' + fileId + ')');
      } catch (e) { console.warn('Failed to move export file ' + fileId + ':', e.message); }
    } else {
      moved.skipped++;
      console.log('Skipped (no match): ' + fileName + ' (' + fileId + ')');
    }
  }

  var summary = 'Migration complete. Moved: ' + moved.wp + ' WP files, ' +
    moved.ap + ' AP files, ' + moved.exports + ' exports. Skipped: ' + moved.skipped;
  console.log(summary);
  return summary;
}

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

/**
 * Return the Login page HTML so the dashboard can swap itself out via
 * document.open/write/close without triggering sandbox navigation restrictions.
 */
function getLoginHtml() {
  return HtmlService.createTemplateFromFile('Login').evaluate().getContent();
}

/**
 * Fetch the AuditorPortal HTML for the authenticated session.
 * Called from Login.html after login to avoid sandbox navigation restrictions.
 * Uses document.open/write/close on the client instead of window.top.location.href.
 */
function getDashboardHtml(sessionToken) {
  if (!sessionToken) {
    throw new Error('No session token provided');
  }

  const session = getSessionByToken(sessionToken);
  if (!session) {
    throw new Error('Session invalid or expired — please log in again');
  }

  const user = getUserByIdCached(session.user_id);
  if (!user || !isActive(user.is_active)) {
    throw new Error('User account not found or inactive');
  }

  const initData = getInitDataOptimized(user);
  const template = HtmlService.createTemplateFromFile('AuditorPortal');
  template.inlineInitData = initData ? JSON.stringify(initData) : 'null';

  return template.evaluate().getContent();
}
