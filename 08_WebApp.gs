// 08_WebApp.gs - Web Application Entry Points, API Router, File Upload, Request/Response Utilities

// Handle GET requests - serve HTML pages (login page shown first)
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
    
    // Ensure we never return null/undefined
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
      try {
        console.log('=== getDashboardData Handler START ===');
        console.log('User object exists:', !!user);
        if (user) {
          console.log('User email:', user.email);
          console.log('User role:', user.role_code);
          console.log('User ID:', user.user_id);
          console.log('User has _rowIndex:', !!user._rowIndex);
        }

        // Ensure user is authenticated
        if (!user) {
          console.error('getDashboardData: No user object - authentication required');
          return { success: false, error: 'Authentication required', requireLogin: true };
        }

        console.log('Calling getDashboardData service function...');
        // Call the service function
        const dashboardData = getDashboardData(user);
        console.log('getDashboardData service returned:', !!dashboardData);

        // Validate the response
        if (!dashboardData) {
          console.error('getDashboardData: Dashboard service returned null/undefined');
          return {
            success: false,
            error: 'Dashboard service returned null',
            errorDetail: 'getDashboardData() returned null/undefined'
          };
        }

        console.log('dashboardData.success:', dashboardData.success);
        console.log('dashboardData has summary:', !!dashboardData.summary);
        console.log('dashboardData has charts:', !!dashboardData.charts);

        // If getDashboardData already returned an error response, pass it through
        if (dashboardData.success === false) {
          console.error('getDashboardData returned error:', dashboardData.error);
          return dashboardData;
        }

        // Ensure required properties exist for frontend
        if (!dashboardData.summary) {
          console.warn('No summary in dashboardData, adding defaults');
          dashboardData.summary = { workPapers: {}, actionPlans: {} };
        }
        if (!dashboardData.charts) {
          console.warn('No charts in dashboardData, adding defaults');
          dashboardData.charts = {};
        }
        if (!dashboardData.alerts) {
          dashboardData.alerts = [];
        }
        if (!dashboardData.recentActivity) {
          dashboardData.recentActivity = [];
        }

        console.log('=== getDashboardData Handler SUCCESS ===');
        // Return with proper structure
        return {
          success: true,
          ...dashboardData
        };

      } catch (e) {
        console.error('=== getDashboardData Handler EXCEPTION ===');
        console.error('Error:', e.message);
        console.error('Stack:', e.stack);
        return {
          success: false,
          error: 'Failed to load dashboard: ' + e.message,
          errorDetail: 'Exception in getDashboardData handler: ' + e.stack,
          summary: { workPapers: {}, actionPlans: {} },
          charts: {},
          alerts: [],
          recentActivity: []
        };
      }
      
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

// Generic API call function for client-side (supports session-based authentication)
function apiCall(action, data) {
  try {
    data = data || {};

    // Debug logging - helps diagnose authentication issues
    console.log('===========================');
    console.log('=== API Call Debug START ===');
    console.log('===========================');
    console.log('Action:', action);
    console.log('Session token provided:', !!data.sessionToken);
    console.log('Session token length:', data.sessionToken ? data.sessionToken.length : 0);

    // Public actions that don't require authentication
    const publicActions = ['login', 'ping', 'testConnection'];

    // Try to get user from Google session first (works in Apps Script editor)
    let user = getCurrentUser();
    console.log('STEP 1: getCurrentUser result:', user ? user.email : 'null');

    // If no user from Google session, try session token validation
    if (!user && data.sessionToken) {
      console.log('STEP 2: No Google user - trying session token validation...');
      const sessionResult = validateSession(data.sessionToken);
      console.log('STEP 3: validateSession result:', sessionResult.valid ? 'VALID' : 'INVALID');
      if (!sessionResult.valid) {
        console.error('Session validation error:', sessionResult.error);
      }

      if (sessionResult.valid) {
        console.log('STEP 4: Session valid - user from session:', sessionResult.user.email);
        console.log('STEP 5: Attempting getUserById with ID:', sessionResult.user.user_id);

        // IMPORTANT FIX: First try to get full user from database
        user = getUserById(sessionResult.user.user_id);
        console.log('STEP 6: getUserById result:', user ? 'FOUND (' + user.email + ')' : 'NULL');

        // FALLBACK: If getUserById fails (e.g., index not built), use session user data
        if (!user) {
          console.log('STEP 7: getUserById failed - trying getUserByEmail with:', sessionResult.user.email);
          // Get full user data by email instead
          user = getUserByEmail(sessionResult.user.email);
          console.log('STEP 8: getUserByEmail result:', user ? 'FOUND (' + user.email + ')' : 'NULL');

          // Last resort: use the user object from session validation
          if (!user) {
            console.warn('STEP 9: Both getUserById and getUserByEmail failed - using session user object');
            user = sessionResult.user;
            user._fromSession = true; // Flag that this is from session (partial data)
            console.log('STEP 10: Using session user (partial data)');
          }
        }
      }
    }

    console.log('===========================');
    console.log('FINAL USER RESULT:', user ? user.email : 'NULL');
    console.log('User has _rowIndex:', user ? (!!user._rowIndex) : 'N/A');
    console.log('===========================');

    // Check if authentication is required
    if (!publicActions.includes(action) && !user) {
      console.log('Authentication required - no valid user found');
      return { success: false, error: 'Authentication required', requireLogin: true };
    }

    // Test connection action - simple ping to verify backend is working
    if (action === 'testConnection') {
      return { success: true, message: 'Backend is working!', timestamp: new Date().toISOString() };
    }

    // Special handling for getInitData when user is available from session
    if (action === 'getInitData' && user) {
      console.log('Calling getInitDataWithUser...');
      const initResult = getInitDataWithUser(user);
      
      // Ensure we never return null/undefined
      if (initResult === null || initResult === undefined) {
        console.error('apiCall: getInitDataWithUser returned null/undefined');
        return { 
          success: false, 
          error: 'Failed to initialize application', 
          errorDetail: 'getInitDataWithUser returned null/undefined' 
        };
      }
      
      console.log('apiCall completed successfully for action:', action);
      return initResult;
    }

    const result = routeAction(action, data, user);
    
    // Ensure we never return null/undefined
    if (result === null || result === undefined) {
      console.error('apiCall: routeAction returned null/undefined for action:', action);
      return { 
        success: false, 
        error: 'No response from server', 
        errorDetail: 'routeAction returned null/undefined for action: ' + action 
      };
    }
    
    console.log('apiCall completed successfully for action:', action);
    return result;

  } catch (error) {
    console.error('API call error:', error);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message, errorDetail: 'Exception in apiCall: ' + error.message };
  }
}

/**
 * Get init data using a provided user object (for session-based auth)
 */
function getInitDataWithUser(user) {
  console.log('getInitDataWithUser called for:', user ? user.email : 'null');

  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (!isActive(user.is_active)) {
    return { success: false, error: 'Account is inactive' };
  }

  // Build response with try-catch for each component
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
      must_change_password: user.must_change_password || false
    },
    dropdowns: {},
    config: {
      systemName: 'Hass Petroleum Internal Audit System',
      currentYear: new Date().getFullYear()
    },
    permissions: {}
  };

  // Get role name with error handling
  try {
    response.user.role_name = getRoleName(user.role_code) || user.role_code;
  } catch (e) {
    console.error('Error getting role name:', e);
    response.user.role_name = user.role_code;
  }

  // Get dropdowns with error handling
  try {
    response.dropdowns = getDropdownData();
    console.log('Dropdowns loaded successfully');
  } catch (e) {
    console.error('Error loading dropdowns:', e);
    response.dropdowns = { affiliates: [], auditAreas: [], subAreas: [], users: [], roles: [] };
  }

  // Get config with error handling
  try {
    const systemName = getConfigValue('SYSTEM_NAME');
    if (systemName) response.config.systemName = systemName;
  } catch (e) {
    console.error('Error loading config:', e);
  }

  // Get permissions with error handling
  try {
    response.permissions = getUserPermissions(user.role_code);
    console.log('Permissions loaded successfully');
  } catch (e) {
    console.error('Error loading permissions:', e);
    response.permissions = {};
  }

  console.log('getInitDataWithUser completed successfully');
  return response;
}

// Run all scheduled maintenance tasks (called by time-based trigger)
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
    const emailResult = processEmailQueue()
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

/**
 * DIAGNOSTIC FUNCTION - Run this from the Apps Script editor to diagnose issues
 * View > Executions to see the logs
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
    errors: []
  };

  // Test 1: Check if sheets exist
  console.log('\n=== TEST 1: Checking Sheet Access ===');
  const requiredSheets = [
    '00_Config', '01_Roles', '02_Permissions', '05_Users', '06_Affiliates',
    '07_AuditAreas', '08_ProcessSubAreas', '09_WorkPapers', '13_ActionPlans',
    '17_Index_WorkPapers', '18_Index_ActionPlans', '19_Index_Users', '20_Sessions'
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
      console.error(name + ': ERROR - ' + e.message);
    }
  });

  // Test 2: Check indexes
  console.log('\n=== TEST 2: Checking Index Maps ===');
  try {
    const userIndexMap = Index.getIndexMap('USER');
    const userCount = Object.keys(userIndexMap).length;
    results.indexes.USER = { count: userCount };
    console.log('User index entries:', userCount);

    const wpIndexMap = Index.getIndexMap('WORK_PAPER');
    const wpCount = Object.keys(wpIndexMap).length;
    results.indexes.WORK_PAPER = { count: wpCount };
    console.log('Work paper index entries:', wpCount);

    const apIndexMap = Index.getIndexMap('ACTION_PLAN');
    const apCount = Object.keys(apIndexMap).length;
    results.indexes.ACTION_PLAN = { count: apCount };
    console.log('Action plan index entries:', apCount);
  } catch (e) {
    results.errors.push('Index check error: ' + e.message);
    console.error('Index check error:', e);
  }

  // Test 3: Check active sessions
  console.log('\n=== TEST 3: Checking Sessions ===');
  try {
    const sessionsSheet = getSheet('20_Sessions');
    if (sessionsSheet) {
      const sessionCount = Math.max(0, sessionsSheet.getLastRow() - 1);
      results.sessions.total = sessionCount;
      console.log('Total sessions in sheet:', sessionCount);

      // Count valid sessions
      if (sessionCount > 0) {
        const data = sessionsSheet.getDataRange().getValues();
        const headers = data[0];
        const validIdx = headers.indexOf('is_valid');
        const expiresIdx = headers.indexOf('expires_at');
        let validCount = 0;
        const now = new Date();

        for (let i = 1; i < data.length; i++) {
          const isValid = data[i][validIdx];
          const expiresAt = new Date(data[i][expiresIdx]);
          if (isValid && expiresAt > now) {
            validCount++;
          }
        }
        results.sessions.valid = validCount;
        console.log('Valid (non-expired) sessions:', validCount);
      }
    }
  } catch (e) {
    results.errors.push('Session check error: ' + e.message);
    console.error('Session check error:', e);
  }

  // Test 4: Check users
  console.log('\n=== TEST 4: Checking Users ===');
  try {
    const usersSheet = getSheet('05_Users');
    if (usersSheet) {
      const userCount = Math.max(0, usersSheet.getLastRow() - 1);
      results.users.total = userCount;
      console.log('Total users in sheet:', userCount);

      // Count active users
      if (userCount > 0) {
        const data = usersSheet.getDataRange().getValues();
        const headers = data[0];
        const activeIdx = headers.indexOf('is_active');
        let activeCount = 0;

        for (let i = 1; i < data.length; i++) {
          if (isActive(data[i][activeIdx])) {
            activeCount++;
          }
        }
        results.users.active = activeCount;
        console.log('Active users:', activeCount);
      }
    }
  } catch (e) {
    results.errors.push('User check error: ' + e.message);
    console.error('User check error:', e);
  }

  // Test 5: Test Google Session
  console.log('\n=== TEST 5: Testing Google Session ===');
  try {
    const email = Session.getActiveUser().getEmail();
    results.googleSession = { email: email || '(empty)' };
    console.log('Session.getActiveUser().getEmail():', email || '(empty - this is normal for web app)');

    if (email) {
      const user = getUserByEmail(email);
      console.log('User found by email:', user ? user.full_name : 'NOT FOUND');
      results.googleSession.userFound = !!user;
    }
  } catch (e) {
    results.errors.push('Google session check error: ' + e.message);
    console.error('Google session check error:', e);
  }

  // Test 6: Test getCurrentUser
  console.log('\n=== TEST 6: Testing getCurrentUser() ===');
  try {
    const user = getCurrentUser();
    results.getCurrentUser = user ? { email: user.email, role: user.role_code } : null;
    console.log('getCurrentUser() result:', user ? user.email : 'null');
  } catch (e) {
    results.errors.push('getCurrentUser error: ' + e.message);
    console.error('getCurrentUser error:', e);
  }

  // Test 7: Attempt to load dashboard data with first active user
  console.log('\n=== TEST 7: Testing Dashboard Data Load ===');
  try {
    const usersSheet = getSheet('05_Users');
    if (usersSheet && usersSheet.getLastRow() > 1) {
      const data = usersSheet.getDataRange().getValues();
      const headers = data[0];
      const activeIdx = headers.indexOf('is_active');

      // Find first active user
      for (let i = 1; i < data.length; i++) {
        if (isActive(data[i][activeIdx])) {
          const testUser = rowToObject(headers, data[i]);
          testUser._rowIndex = i + 1;
          console.log('Testing with user:', testUser.email);

          const dashboardData = getDashboardData(testUser);
          results.dashboardTest = {
            success: !!dashboardData,
            hasUser: !!dashboardData?.user,
            hasSummary: !!dashboardData?.summary,
            hasCharts: !!dashboardData?.charts
          };
          console.log('Dashboard data loaded:', !!dashboardData);
          console.log('Has user:', !!dashboardData?.user);
          console.log('Has summary:', !!dashboardData?.summary);
          console.log('Has charts:', !!dashboardData?.charts);
          break;
        }
      }
    }
  } catch (e) {
    results.errors.push('Dashboard test error: ' + e.message);
    console.error('Dashboard test error:', e);
  }

  // Summary
  console.log('\n========================================');
  console.log('=== DIAGNOSTIC SUMMARY ===');
  console.log('========================================');

  if (results.errors.length > 0) {
    console.log('ERRORS FOUND:');
    results.errors.forEach((err, i) => console.log((i + 1) + '. ' + err));
  } else {
    console.log('No errors detected!');
  }

  // Recommendations
  console.log('\n=== RECOMMENDATIONS ===');

  if (results.indexes.USER?.count === 0) {
    console.log('- Run rebuildAllIndexes() to rebuild indexes');
  }

  if (results.sessions.valid === 0) {
    console.log('- No valid sessions found. Users need to log in again.');
  }

  if (results.googleSession?.email === '(empty)') {
    console.log('- Session.getActiveUser().getEmail() returns empty (normal for web app deployment)');
    console.log('- Authentication relies on session tokens - ensure login is working');
  }

  console.log('\n=== DIAGNOSTIC TEST COMPLETE ===');

  return results;
}

/**
 * QUICK FIX: Rebuild all indexes
 * Run this if users cannot authenticate
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

  console.log('Index rebuild complete!');
  return { success: true, message: 'All indexes rebuilt' };
}
