/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Web Application Entry Points v3.0
 * 
 * FILE: 08_WebApp.gs
 * 
 * Provides:
 * - doGet() - Serve HTML pages
 * - doPost() - API endpoint router
 * - File upload handling
 * - Error handling
 * - Request/response utilities
 * 
 * DEPENDS ON: All other service files (01-07)
 */

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================

/**
 * Handle GET requests - serve HTML pages
 * IMPORTANT: Login page is ALWAYS shown first (mandatory entry point)
 * User must authenticate before accessing any module
 */
function doGet(e) {
  try {
    const page = e.parameter.page || 'login';

    // MANDATORY: Always show login page first unless explicitly requesting app after auth
    if (page !== 'app') {
      return HtmlService.createTemplateFromFile('Login')
        .evaluate()
        .setTitle('Login - Hass Petroleum Audit System')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }

    // page=app: Serve the portal - client-side will validate session via getInitData
    // This allows the app to work in test deployments where Session.getActiveUser() may fail
    return HtmlService.createTemplateFromFile('AuditorPortal')
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
    
    // Get current user
    const user = getCurrentUser();
    
    // Public actions (no auth required)
    const publicActions = ['login', 'ping'];
    
    if (!publicActions.includes(action) && !user) {
      return jsonResponse({ success: false, error: 'Authentication required' }, 401);
    }
    
    // Route to handler
    const result = routeAction(action, data, user);
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
      
    case 'logout':
      return logout(data.sessionToken);
      
    case 'validateSession':
      return validateSession(data.sessionToken);
      
    case 'changePassword':
      return changePassword(user.user_id, data.currentPassword, data.newPassword);
      
    case 'resetPassword':
      return resetPassword(data.userId, user);
      
    // ========== INIT ==========
    case 'getInitData':
      return getInitData();
      
    case 'getDashboardData':
      return { success: true, ...getDashboardData(user) };
      
    case 'getDropdownData':
      return { success: true, dropdowns: getDropdownData() };
      
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
      return { success: true, report: getAuditSummaryReport(data.filters) };
      
    case 'getActionPlanAgingReport':
      return { success: true, report: getActionPlanAgingReport() };
      
    case 'getRiskSummaryReport':
      return { success: true, report: getRiskSummaryReport(data.filters) };
      
    // ========== NOTIFICATIONS ==========
    case 'getNotificationQueueStatus':
      return { success: true, status: getNotificationQueueStatus() };
      
    case 'getUserNotifications':
      return { success: true, notifications: getUserNotifications(user.user_id, data.limit) };
      
    // ========== ADMIN ==========
    case 'rebuildWorkPaperIndex':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, count: rebuildWorkPaperIndex() };
      
    case 'rebuildActionPlanIndex':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, count: rebuildActionPlanIndex() };
      
    case 'processEmailQueue':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, result: processEmailQueue() };
      
    case 'cleanupExpiredSessions':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, cleaned: cleanupExpiredSessions() };

    // ========== SETTINGS ==========
    case 'getPermissions':
      return { success: true, permissions: getPermissions(data.roleCode) };

    case 'updatePermissions':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return updatePermissions(data.roleCode, data.permissions, user);

    case 'getUserStats':
      return { success: true, stats: getUserStats() };

    case 'getSystemConfig':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, config: getSystemConfigValues() };

    case 'saveSystemConfig':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return saveSystemConfigValues(data.config, user);

    case 'getAuditLog':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      return { success: true, logs: getAuditLogs(data.action, data.page, data.pageSize), total: getAuditLogCount(data.action) };

    case 'rebuildAllIndexes':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
        return { success: false, error: 'Permission denied' };
      }
      Index.rebuild('WORK_PAPER');
      Index.rebuild('ACTION_PLAN');
      Index.rebuild('USER');
      return { success: true, message: 'All indexes rebuilt' };

    // ========== AI SERVICE ==========
    case 'getAIConfigStatus':
      if (user.role_code !== ROLES.SUPER_ADMIN) {
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

    // ========== ANALYTICS ==========
    case 'getAnalyticsData':
      return getAnalyticsData(data.year, user);

    default:
      return { success: false, error: 'Unknown action: ' + action };
  }
}

// ============================================================
// FILE UPLOAD HANDLING
// ============================================================

/**
 * Upload file to Google Drive
 * Called from client-side with base64 data
 */
function uploadFileToDrive(fileName, mimeType, base64Data, folderId) {
  try {
    const user = getCurrentUser();
    if (!user) {
      return { success: false, error: 'Authentication required' };
    }
    
    // Decode base64
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    
    // Get or create folder
    let folder;
    if (folderId) {
      folder = DriveApp.getFolderById(folderId);
    } else {
      // Use default audit files folder
      const rootFolderId = getConfigValue('AUDIT_FILES_FOLDER_ID');
      if (rootFolderId) {
        folder = DriveApp.getFolderById(rootFolderId);
      } else {
        folder = DriveApp.getRootFolder();
      }
    }
    
    // Create file
    const file = folder.createFile(blob);
    
    // Set sharing to anyone with link can view
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
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
      // Create root folder if it doesn't exist
      const folders = DriveApp.getFoldersByName('Hass Audit Files');
      if (folders.hasNext()) {
        rootFolder = folders.next();
      } else {
        rootFolder = DriveApp.createFolder('Hass Audit Files');
        setConfigValue('AUDIT_FILES_FOLDER_ID', rootFolder.getId());
      }
    }
    
    // Create year folder
    let yearFolder;
    const yearFolders = rootFolder.getFoldersByName(String(year));
    if (yearFolders.hasNext()) {
      yearFolder = yearFolders.next();
    } else {
      yearFolder = rootFolder.createFolder(String(year));
    }
    
    // Create affiliate folder
    let affiliateFolder;
    const affiliateFolders = yearFolder.getFoldersByName(affiliateCode);
    if (affiliateFolders.hasNext()) {
      affiliateFolder = affiliateFolders.next();
    } else {
      affiliateFolder = yearFolder.createFolder(affiliateCode);
    }
    
    // Create work paper folder
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

// ============================================================
// RESPONSE UTILITIES
// ============================================================

/**
 * Create JSON response
 */
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

// ============================================================
// CLIENT-SIDE API WRAPPER
// ============================================================

/**
 * Generic API call function for client-side
 * This is called from HTML files
 */
function apiCall(action, data) {
  try {
    const user = getCurrentUser();
    
    // Public actions
    const publicActions = ['login', 'ping'];
    
    if (!publicActions.includes(action) && !user) {
      return { success: false, error: 'Authentication required' };
    }
    
    return routeAction(action, data || {}, user);
    
  } catch (error) {
    console.error('API call error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// SCHEDULED TRIGGER FUNCTIONS
// ============================================================

/**
 * Run all scheduled maintenance tasks
 * Called by time-based trigger
 */
function runScheduledMaintenance() {
  console.log('=== Running Scheduled Maintenance ===');
  
  try {
    // Update overdue statuses
    console.log('Updating overdue statuses...');
    const overdueCount = updateOverdueStatuses();
    console.log('Updated:', overdueCount);
    
    // Clean up expired sessions
    console.log('Cleaning expired sessions...');
    const sessionsCleaned = cleanupExpiredSessions();
    console.log('Cleaned:', sessionsCleaned);
    
    // Process email queue
    console.log('Processing email queue...');
    const emailResult = processEmailQueue();
    console.log('Emails sent:', emailResult.sent);
    
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
 * Run this once to configure scheduled tasks
 */
function setupAllTriggers() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // Email queue processing - every 10 minutes
  ScriptApp.newTrigger('processEmailQueue')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  // Daily maintenance - 6 AM
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  
  // Weekly summary - Monday 8 AM
  ScriptApp.newTrigger('sendWeeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
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

// ============================================================
// TEST FUNCTION
// ============================================================
function testWebApp() {
  console.log('=== Testing 08_WebApp.gs ===\n');
  
  const user = getCurrentUser();
  
  if (!user) {
    console.log('FAIL: Current user not found');
    return;
  }
  
  console.log('Testing as user:', user.full_name, '(' + user.role_code + ')');
  
  // Test ping
  console.log('\n1. Testing ping...');
  try {
    const result = apiCall('ping', {});
    console.log('Ping response:', result.success);
    console.log('Timestamp:', result.timestamp);
    console.log('ping: PASS');
  } catch (e) {
    console.log('ping: FAIL -', e.message);
  }
  
  // Test getInitData
  console.log('\n2. Testing getInitData via apiCall...');
  try {
    const result = apiCall('getInitData', {});
    console.log('Init success:', result.success);
    console.log('User:', result.user ? result.user.full_name : 'null');
    console.log('getInitData: PASS');
  } catch (e) {
    console.log('getInitData: FAIL -', e.message);
  }
  
  // Test getWorkPapers
  console.log('\n3. Testing getWorkPapers via apiCall...');
  try {
    const result = apiCall('getWorkPapers', { filters: { limit: 3 } });
    console.log('Work papers:', result.workPapers ? result.workPapers.length : 0);
    console.log('getWorkPapers: PASS');
  } catch (e) {
    console.log('getWorkPapers: FAIL -', e.message);
  }
  
  // Test getActionPlans
  console.log('\n4. Testing getActionPlans via apiCall...');
  try {
    const result = apiCall('getActionPlans', { filters: { limit: 3 } });
    console.log('Action plans:', result.actionPlans ? result.actionPlans.length : 0);
    console.log('getActionPlans: PASS');
  } catch (e) {
    console.log('getActionPlans: FAIL -', e.message);
  }
  
  // Test getDashboardData
  console.log('\n5. Testing getDashboardData via apiCall...');
  try {
    const result = apiCall('getDashboardData', {});
    console.log('Dashboard user:', result.user ? result.user.full_name : 'null');
    console.log('Alerts:', result.alerts ? result.alerts.length : 0);
    console.log('getDashboardData: PASS');
  } catch (e) {
    console.log('getDashboardData: FAIL -', e.message);
  }
  
  // Test unknown action
  console.log('\n6. Testing unknown action handling...');
  try {
    const result = apiCall('unknownAction', {});
    console.log('Error returned:', result.error);
    console.log('Unknown action handling: PASS');
  } catch (e) {
    console.log('Unknown action handling: FAIL -', e.message);
  }
  
  // Test getScriptUrl
  console.log('\n7. Testing getScriptUrl...');
  try {
    const url = getScriptUrl();
    console.log('Script URL:', url ? 'Retrieved' : 'null');
    console.log('getScriptUrl: PASS');
  } catch (e) {
    console.log('getScriptUrl: FAIL -', e.message);
  }
  
  // Test listTriggers
  console.log('\n8. Testing listTriggers...');
  try {
    const triggers = listTriggers();
    console.log('Current triggers:', triggers.length);
    console.log('listTriggers: PASS');
  } catch (e) {
    console.log('listTriggers: FAIL -', e.message);
  }
  
  console.log('\n=== 08_WebApp.gs Tests Complete ===');
}
