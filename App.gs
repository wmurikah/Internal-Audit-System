/**
 * AUDIT MANAGEMENT SYSTEM - MAIN ENTRY POINT
 * Enterprise-grade audit management with role-based access control
 */

const SPREADSHEET_ID = '14wSwpcdDtSNu2dpGwYCDJgJWyls2w52YfS__z3zsWMk';
const EVIDENCE_FOLDER_ID = '17r19y2uyKeBu2QcKMsOMjIBeSYKu7R4R';

/**
 * Main application entry point
 */
function doGet(e) {
  try {
    const template = HtmlService.createTemplateFromFile('CoreScripts');
    if (e && e.parameter && e.parameter.logout === '1') { template.forceLogout = true; }
    return template.evaluate()
      .setTitle('Audit Management System - Instant')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    Logger.log('doGet error: ' + error.toString());
    return HtmlService.createHtmlOutput(`
      <div style="padding: 2rem; text-align: center; font-family: Arial;">
        <h2>System Error</h2>
        <p>Unable to load the application. Please contact your administrator.</p>
        <p><small>Error: ${error.message}</small></p>
        <button onclick="location.reload()">Retry</button>
      </div>
    `);
  }
}

/**
 * Include HTML files for separation of concerns
 */
function include(filename) {
  try { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }
  catch (error) { Logger.log(`Include error for ${filename}: ${error.toString()}`); return `<!-- Error loading ${filename} -->`; }
}

/**
 * System initialization - Run once as admin
 */
function initializeSystem() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const currentUserEmail = Session.getActiveUser().getEmail();
    if (!currentUserEmail) { throw new Error('No authenticated user found'); }

    // Create required sheets with headers if missing
    const requiredSheets = {
      'Users': ['id', 'email', 'name', 'role', 'org_unit', 'active', 'created_at', 'last_login'],
      'Audits': ['id', 'year', 'affiliate', 'business_unit', 'title', 'scope', 'status', 'manager_email', 'start_date', 'end_date', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'WorkPapers': ['id', 'audit_id', 'audit_title', 'year', 'affiliate', 'process_area', 'objective', 'risks', 'controls', 'test_objective', 'proposed_tests', 'observation', 'observation_risk', 'reportable', 'status', 'reviewer_email', 'reviewer_comments', 'submitted_at', 'reviewed_at', 'created_by', 'created_at', 'updated_by', 'updated_at', 'process', 'risk_statement', 'audit_steps', 'sample_details', 'evidence_list', 'implications', 'management_response', 'action_plans', 'process_owner', 'due_dates', 'residual_risk', 'tags', 'links'],
      'Issues': ['id', 'audit_id', 'title', 'description', 'root_cause', 'risk_rating', 'recommendation', 'owner_email', 'due_date', 'status', 'reopened_count', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'Actions': ['id', 'issue_id', 'assignee_email', 'action_plan', 'due_date', 'status', 'closed_on', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'Evidence': ['id', 'parent_type', 'parent_id', 'file_name', 'drive_url', 'uploader_email', 'uploaded_on', 'version', 'checksum', 'status', 'reviewer_email', 'review_comment', 'reviewed_at', 'manager_email', 'manager_decision', 'manager_review_comment', 'manager_reviewed_at', 'created_at'],
      'Logs': ['timestamp', 'user_email', 'entity', 'entity_id', 'action', 'before_json', 'after_json'],
      'Settings': ['key', 'value', 'description', 'updated_by', 'updated_at'],
      'RiskRegister': ['id', 'unit', 'process', 'risk_statement', 'inherent_rating', 'controls', 'owner_email', 'status', 'due_date', 'residual_risk', 'links', 'created_at', 'updated_at']
    };
    Object.entries(requiredSheets).forEach(([sheetName, headers]) => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) { sheet = ss.insertSheet(sheetName); sheet.getRange(1, 1, 1, headers.length).setValues([headers]); try{ sheet.setFrozenRows(1);}catch(e){} }
    });

    // Initialize configuration and validations
    getConfig();
    try { applyStandardValidations(); } catch (e) { Logger.log('applyStandardValidations on init error: '+e); }

    // Ensure current user exists
    const users = getSheetData('Users') || [];
    if (!users.some(u => u.email && u.email.toLowerCase() === currentUserEmail.toLowerCase())) {
      addRow('Users', { email: currentUserEmail, name: currentUserEmail.split('@')[0], role: 'AuditManager', org_unit: 'Internal Audit', active: true, created_at: new Date(), last_login: '' });
    }

    return { success: true, message: 'System initialized successfully' };
  } catch (error) {
    Logger.log('System initialization error: ' + error.toString());
    return { success: false, error: error.message };
  }
}

// Provide boot info for client
function getAppInfo(){
  try{
    const user = getCurrentUser();
    const cfg = getConfig();
    return {
      user: { email: user.email, role: user.role, org_unit: user.org_unit, permissions: user.permissions },
      featureFlags: { ai: !!(cfg && cfg.OPENAI_API_KEY), evidenceRequired: !!(cfg && cfg.REQUIRE_EVIDENCE) },
      defaultLanding: (cfg && cfg.defaultLanding) || 'dashboard'
    };
  }catch(e){
    return { user: { email: '', role: 'Guest', org_unit: '', permissions: [] }, featureFlags: { ai: false, evidenceRequired: true }, defaultLanding: 'dashboard' };
  }
}

/**
 * getSystemHealth
 * One-click comprehensive system health report for admins.
 * Safe, read-mostly checks with lightweight calls and timings.
 */
function getSystemHealth() {
  var started = Date.now();
  var health = { timestamps: { started: new Date().toISOString() } };

  // Current user
  var user = {};
  try { user = getCurrentUser(); } catch(e) { user = { email:'', role:'', authenticated:false, error:e.message }; }
  health.user = { email: user.email || '', role: user.role || '', authenticated: !!user.authenticated };

  // Config and validations
  var cfg = {};
  try { cfg = getConfig(); } catch(e) { cfg = {}; }
  var requiredKeys = ['riskRatings','auditStatuses','issueStatuses','actionStatuses','businessUnits','affiliates','ALLOWED_SIGNIN_DOMAIN','REQUIRE_EVIDENCE'];
  var keysPresent = [];
  requiredKeys.forEach(function(k){ if (cfg && Object.prototype.hasOwnProperty.call(cfg, k)) keysPresent.push(k); });
  var validationsOK = false;
  try { validationsOK = !!(applyStandardValidations() && true); } catch(e) { validationsOK = false; }
  health.config = { domain: (cfg && cfg.ALLOWED_SIGNIN_DOMAIN) || '', keysPresent: keysPresent.sort(), validationsOK: validationsOK };

  // Dashboard resolution path and field sanity
  var snapshot = null; var pathUsed = 'unknown';
  try { snapshot = getDashboardDataUltraFast(); pathUsed = (snapshot && snapshot.performance && snapshot.performance.cacheStatus) ? String(snapshot.performance.cacheStatus) : 'ultraFast'; } catch(e) {}
  if (!snapshot) { try { snapshot = computeComprehensiveDashboard(); pathUsed = 'compute'; } catch(e) {} }
  if (!snapshot) { try { snapshot = getMinimalDashboard(); pathUsed = 'minimal'; } catch(e) {} }
  var fieldsOK = !!snapshot && ['activeAudits','openIssues','completedActions','overdueItems','riskDistribution','recentAudits'].every(function(k){ return Object.prototype.hasOwnProperty.call(snapshot, k); });
  health.dashboard = { pathUsed: pathUsed, fieldsOK: fieldsOK };

  // Bulk data timing and counts
  var bulk = null; var bulkMs = 0;
  try { var t0 = Date.now(); bulk = getBulkDataUltraFast(); bulkMs = Date.now() - t0; } catch(e) {}
  var bulkCounts = {};
  ['Audits','Issues','Actions','Users','WorkPapers','Evidence','RiskRegister'].forEach(function(name){
    bulkCounts[name] = Array.isArray(bulk && bulk[name]) ? bulk[name].length : 0;
  });
  health.bulk = { counts: bulkCounts, loadTimeMs: bulkMs };

  // Endpoint presence audit (as referenced by CoreScripts.html)
  var endpoints = {
    getQuantumDashboardData: (typeof getQuantumDashboardData === 'function'),
    getCurrentUser: (typeof getCurrentUser === 'function'),
    getConfig: (typeof getConfig === 'function'),
    getBulkDataUltraFast: (typeof getBulkDataUltraFast === 'function'),
    updateConfigurationDelta: (typeof updateConfigurationDelta === 'function'),
    createOrUpdateUser: (typeof createOrUpdateUser === 'function'),
    createAudit: (typeof createAudit === 'function'),
    createWorkPaper: (typeof createWorkPaper === 'function'),
    uploadEvidenceFromBase64: (typeof uploadEvidenceFromBase64 === 'function'),
    listEvidence: (typeof listEvidence === 'function'),
    reviewEvidenceByAuditor: (typeof reviewEvidenceByAuditor === 'function'),
    managerReviewEvidence: (typeof managerReviewEvidence === 'function'),
    getAuditTrail: (typeof getAuditTrail === 'function'),
    bulkGenerateWorkPapersPDF: (typeof bulkGenerateWorkPapersPDF === 'function'),
    updateWorkPaper: (typeof updateWorkPaper === 'function'),
    reviewWorkPaper: (typeof reviewWorkPaper === 'function'),
    generateWorkPaperPDF: (typeof generateWorkPaperPDF === 'function'),
    updateEntityWithEvidenceGuard: (typeof updateEntityWithEvidenceGuard === 'function'),
    requireEvidenceForStatusChange: (typeof requireEvidenceForStatusChange === 'function')
  };
  health.endpoints = endpoints;

  // Triggers: monthly reminders
  var hasMonthly = false;
  try { hasMonthly = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === 'sendMonthlyProcessOwnerReminders'; }); } catch(e) { hasMonthly = false; }
  health.triggers = { monthlyReminders: hasMonthly };

  // Cache/persistence markers
  var cacheOk = false, persistentOk = false, cacheAgeMs = null;
  try {
    var cache = CacheService.getScriptCache();
    var snap = cache.get('DASHBOARD_ULTRA_V1');
    cacheOk = !!snap;
  } catch(e) {}
  try {
    var props = PropertiesService.getScriptProperties();
    var persistent = props.getProperty('DASHBOARD_ULTRA_V1') || props.getProperty('QUANTUM_DASHBOARD_V2');
    persistentOk = !!persistent;
    if (persistent) {
      try {
        var wrapper = JSON.parse(persistent);
        if (wrapper && typeof wrapper.timestamp === 'number') cacheAgeMs = Date.now() - Number(wrapper.timestamp);
      } catch(e) {}
    }
  } catch(e) {}
  health.cache = { dashboardSnapshot: cacheOk, persistentSnapshot: persistentOk, ageMs: cacheAgeMs };

  // Evidence gating sanity (read-only check using helper)
  var evidenceGate = { ok: true, note: 'no sample tested' };
  try {
    var sampleIssueId = null;
    if (bulk && Array.isArray(bulk.Issues) && bulk.Issues.length) sampleIssueId = bulk.Issues[0].id;
    if (sampleIssueId && typeof requireEvidenceForStatusChange === 'function') {
      var gateRes = requireEvidenceForStatusChange('Issues', sampleIssueId, 'In Progress', user.email || '');
      evidenceGate = gateRes || { ok: true };
    }
  } catch(e) { evidenceGate = { ok:false, error: e.message }; }
  health.evidenceGating = evidenceGate;

  // Reports: HTML build check (no Drive writes)
  var reports = {};
  try { var r = buildExecutiveSummaryHtml(); reports.executiveSummaryHtmlOK = !!(r && r.success); } catch(e) { reports.executiveSummaryHtmlOK = false; reports.error = e.message; }
  health.reports = reports;

  health.timestamps.completed = new Date().toISOString();
  health.durationMs = Date.now() - started;
  return health;
}

/** Quick endpoint audit only */
function getEndpointsAudit(){
  return {
    getQuantumDashboardData: (typeof getQuantumDashboardData === 'function'),
    getCurrentUser: (typeof getCurrentUser === 'function'),
    getConfig: (typeof getConfig === 'function'),
    getBulkDataUltraFast: (typeof getBulkDataUltraFast === 'function'),
    updateConfigurationDelta: (typeof updateConfigurationDelta === 'function'),
    createOrUpdateUser: (typeof createOrUpdateUser === 'function'),
    createAudit: (typeof createAudit === 'function'),
    createWorkPaper: (typeof createWorkPaper === 'function'),
    uploadEvidenceFromBase64: (typeof uploadEvidenceFromBase64 === 'function'),
    listEvidence: (typeof listEvidence === 'function'),
    reviewEvidenceByAuditor: (typeof reviewEvidenceByAuditor === 'function'),
    managerReviewEvidence: (typeof managerReviewEvidence === 'function'),
    getAuditTrail: (typeof getAuditTrail === 'function'),
    bulkGenerateWorkPapersPDF: (typeof bulkGenerateWorkPapersPDF === 'function'),
    updateWorkPaper: (typeof updateWorkPaper === 'function'),
    reviewWorkPaper: (typeof reviewWorkPaper === 'function'),
    generateWorkPaperPDF: (typeof generateWorkPaperPDF === 'function'),
    updateEntityWithEvidenceGuard: (typeof updateEntityWithEvidenceGuard === 'function'),
    requireEvidenceForStatusChange: (typeof requireEvidenceForStatusChange === 'function')
  };
}
