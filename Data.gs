/**
 * CONFIGURATION MANAGEMENT MODULE
 * Centralized system configuration with validation and defaults
 */

/**
 * Gets system configuration with fallback to defaults
 */
function getConfig() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let settingsSheet = ss.getSheetByName('Settings');
    
    if (!settingsSheet || settingsSheet.getLastRow() <= 1) {
      Logger.log('Settings sheet not found or empty, initializing defaults');
      return initializeDefaults();
    }
    
    const data = settingsSheet.getDataRange().getValues();
    const config = {};
    
    // Skip header row
    data.slice(1).forEach(row => {
      if (row[0] && row[1]) {
        try {
          config[row[0]] = JSON.parse(row[1]);
        } catch (e) {
          config[row[0]] = row[1]; // Store as string if not JSON
        }
      }
    });
    
    return validateAndFillDefaults(config);
    
  } catch (error) {
    Logger.log('getConfig error: ' + error.toString());
    return getDefaultConfig();
  }
}

/**
 * Updates system configuration
 */
// Delta-based config updates for lightweight UI operations
function updateConfigurationDelta(delta){
  try{
    const cfg = getConfig();
    if (delta.addRiskRating){ if (!cfg.riskRatings.includes(delta.addRiskRating)) cfg.riskRatings.push(delta.addRiskRating); }
    if (delta.removeRiskRating){ cfg.riskRatings = cfg.riskRatings.filter(x=> x !== delta.removeRiskRating); }
    if (delta.addAuditStatus){ if (!cfg.auditStatuses.includes(delta.addAuditStatus)) cfg.auditStatuses.push(delta.addAuditStatus); }
    if (delta.removeAuditStatus){ cfg.auditStatuses = cfg.auditStatuses.filter(x=> x !== delta.removeAuditStatus); }
    if (delta.setDefaultLanding){ cfg.defaultLanding = String(delta.setDefaultLanding); }
    return updateConfig(cfg);
  }catch(e){
    Logger.log('updateConfigurationDelta error: '+e);
    return { success:false, error: e.message };
  }
}

function updateConfig(newConfig) {
  try {
    const user = getCurrentUser();
    if (!user.permissions.includes('manage_config')) {
      throw new Error('Insufficient permissions to update configuration');
    }
    
    const validatedConfig = validateConfig(newConfig);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Settings');
    
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
      sheet.getRange('A1:E1').setValues([['key', 'value', 'description', 'updated_by', 'updated_at']]);
    } else {
      sheet.clear();
      sheet.getRange('A1:E1').setValues([['key', 'value', 'description', 'updated_by', 'updated_at']]);
    }
    
    let row = 2;
    Object.entries(validatedConfig).forEach(([key, value]) => {
      const description = getConfigDescription(key);
      sheet.getRange(`A${row}:E${row}`).setValues([[
        key, 
        JSON.stringify(value),
        description,
        user.email,
        new Date()
      ]]);
      row++;
    });
    
    // Log configuration change
    logAction('Config', 'system', 'update_config', {}, {
      updated_by: user.email,
      config_keys: Object.keys(validatedConfig)
    });
    
    return { success: true, message: 'Configuration updated successfully' };
    
  } catch (error) {
    Logger.log('updateConfig error: ' + error.toString());
    return { success: false, error: error.message };
  }
}

/**
 * Initializes default configuration
 */
function initializeDefaults() {
  const defaultConfig = getDefaultConfig();
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Settings');
    
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
    } else {
      sheet.clear();
    }
    
    sheet.getRange('A1:E1').setValues([['key', 'value', 'description', 'updated_by', 'updated_at']]);
    
    let row = 2;
    Object.entries(defaultConfig).forEach(([key, value]) => {
      const description = getConfigDescription(key);
      sheet.getRange(`A${row}:E${row}`).setValues([[
        key, 
        JSON.stringify(value),
        description,
        'system',
        new Date()
      ]]);
      row++;
    });
    
    Logger.log('Default configuration initialized');
    return defaultConfig;
    
  } catch (error) {
    Logger.log('initializeDefaults error: ' + error.toString());
    return defaultConfig;
  }
}

/**
 * Returns default system configuration
 */
function getDefaultConfig() {
  return {
    riskRatings: ['Extreme', 'High', 'Medium', 'Low'],
    auditStatuses: ['Planning', 'In Progress', 'Review', 'Completed', 'Closed'],
    issueStatuses: ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed', 'Reopened'],
    actionStatuses: ['Not Started', 'In Progress', 'Pending Review', 'Completed', 'Rejected', 'Overdue'],
    workPaperStatuses: ['Draft', 'Submitted for Review', 'Approved', 'Returned'],
    businessUnits: ['Fleet Logistics Kenya', 'Finance', 'Operations', 'HR', 'IT', 'Compliance', 'Legal', 'Procurement'],
    affiliates: ['Group', 'Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'South Sudan', 'DRC'],
    riskCategories: ['Operational', 'Financial', 'Compliance', 'Strategic', 'Reputational', 'Technology'],
    defaultLanding: 'workpapers',
    OPENAI_API_KEY: '',
    SYSTEM_EMAIL: 'audit@company.com',
    EMAIL_NOTIFICATIONS: true,
    ALLOWED_SIGNIN_DOMAIN: 'hasspetroleum.com',
    AUTO_ASSIGN_ACTIONS: false,
    REQUIRE_EVIDENCE: true,
    MAX_FILE_SIZE_MB: 10
  };
}

/**
 * Validates configuration and fills missing defaults
 */
function validateAndFillDefaults(config) {
  const defaults = getDefaultConfig();
  const validated = { ...config };
  
  Object.keys(defaults).forEach(key => {
    if (!validated[key] || 
        (Array.isArray(defaults[key]) && (!Array.isArray(validated[key]) || validated[key].length === 0))) {
      validated[key] = defaults[key];
    }
  });
  
  return validated;
}

/**
 * Validates configuration values
 */
function validateConfig(config) {
  const validated = { ...config };
  const defaults = getDefaultConfig();
  
  // Validate required arrays
  const requiredArrays = ['riskRatings', 'auditStatuses', 'issueStatuses', 'actionStatuses', 'businessUnits', 'affiliates'];
  requiredArrays.forEach(key => {
    if (!Array.isArray(validated[key]) || validated[key].length === 0) {
      validated[key] = defaults[key];
    }
  });
  
  // Validate API key format
  if (validated.OPENAI_API_KEY && !validated.OPENAI_API_KEY.startsWith('sk-')) {
    throw new Error('Invalid OpenAI API key format');
  }
  
  // Validate file size limit
  if (validated.MAX_FILE_SIZE_MB && (isNaN(validated.MAX_FILE_SIZE_MB) || validated.MAX_FILE_SIZE_MB <= 0)) {
    validated.MAX_FILE_SIZE_MB = defaults.MAX_FILE_SIZE_MB;
  }
  
  return validated;
}

/**
 * Gets description for configuration keys
 */
function getConfigDescription(key) {
  const descriptions = {
    riskRatings: 'Risk severity levels for audit findings',
    auditStatuses: 'Possible statuses for audit engagements',
    issueStatuses: 'Lifecycle statuses for audit issues',
    actionStatuses: 'Status options for corrective actions',
    workPaperStatuses: 'Workflow statuses for work papers',
    businessUnits: 'Organizational units for audit scope',
    affiliates: 'Company affiliates and subsidiaries',
    riskCategories: 'Categories for risk classification',
    OPENAI_API_KEY: 'API key for AI-powered audit assistance',
    SYSTEM_EMAIL: 'Default email address for system notifications',
    EMAIL_NOTIFICATIONS: 'Enable/disable email notifications',
    AUTO_ASSIGN_ACTIONS: 'Automatically assign actions to issue owners',
    REQUIRE_EVIDENCE: 'Require evidence upload for issue resolution',
    MAX_FILE_SIZE_MB: 'Maximum file size for evidence uploads (MB)'
  };
  
  return descriptions[key] || 'System configuration parameter';
}


/**
 * BULK DATA API - ONE CALL FOR EVERYTHING
 */
function getBulkDataUltraFast() {
  const startTime = Date.now();
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const bulkData = {};
    
    // Read all sheets in parallel (conceptually)
    ['Audits', 'Issues', 'Actions', 'Users', 'WorkPapers', 'Evidence'].forEach(sheetName => {
      try {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet && sheet.getLastRow() > 1) {
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          
          bulkData[sheetName] = data.slice(1)
            .filter(row => row.some(cell => cell !== ''))
            .map(row => {
              const obj = {};
              headers.forEach((header, index) => {
                const value = row[index];
                obj[header] = value instanceof Date ? value.toISOString().split('T')[0] : (value || '');
              });
              return obj;
            })
            .filter(row => row.id);
        } else {
          bulkData[sheetName] = [];
        }
      } catch (e) {
        Logger.log(`Error reading ${sheetName}: ${e.message}`);
        bulkData[sheetName] = [];
      }
    });
    
    const loadTime = Date.now() - startTime;
    Logger.log(`🚀 Bulk data loaded: ${loadTime}ms`);
    
    return {
      ...bulkData,
      metadata: {
        loadTime,
        totalRecords: Object.values(bulkData).reduce((sum, arr) => sum + arr.length, 0)
      }
    };
    
  } catch (error) {
    Logger.log(`Bulk data error: ${error.message}`);
    throw error;
  }
}

/**
 * === SIMPLE DATA ACCESS LAYER (Used across modules) ===
 */
function getSheetData(sheetName){
  return (typeof getSheetDataDirect === 'function') ? getSheetDataDirect(sheetName) : [];
}

function getRowById(sheetName, id){
  const rows = getSheetData(sheetName);
  return rows.find(r => r.id === id) || null;
}

function addRow(sheetName, obj){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet '+sheetName+' not found');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  // ID generation per sheet prefix
  if (!obj.id){
    const prefix = {Users:'USR', Audits:'AUD', Issues:'ISS', Actions:'ACT', WorkPapers:'WP', Evidence:'EVD'}[sheetName] || 'ID';
    const n = Math.max(0, sh.getLastRow()-1) + 1;
    obj.id = prefix + ('000' + n).slice(-3);
  }
  const row = headers.map(h => (obj[h] instanceof Date) ? obj[h] : (obj.hasOwnProperty(h) ? obj[h] : ''));
  sh.appendRow(row);
  logAction(sheetName, obj.id, 'create', {}, obj);
  return obj;
}

function updateRow(sheetName, id, changes){
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet '+sheetName+' not found');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  if (idCol === -1) throw new Error('No id column');
  for (let r=1; r<data.length; r++){
    if (String(data[r][idCol]) === String(id)){
      const before = {};
      headers.forEach((h,i)=> before[h] = data[r][i]);
      Object.entries(changes||{}).forEach(([k,v])=>{
        const c = headers.indexOf(k);
        if (c>-1) sh.getRange(r+1, c+1).setValue(v);
      });
      const after = {...before, ...changes};
      logAction(sheetName, id, 'update', before, after);
      return {success:true, id, after};
    }
  }
  throw new Error('Row not found: '+sheetName+'#'+id);
}

function logAction(entity, entity_id, action, before_json, after_json){
  try{
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName('Logs');
    if (!sh){ sh = ss.insertSheet('Logs'); sh.getRange(1,1,1,7).setValues([["timestamp","user_email","entity","entity_id","action","before_json","after_json"]]); }
    const user = (Session.getActiveUser() && Session.getActiveUser().getEmail()) || 'system@local';
    sh.appendRow([new Date(), user, entity, entity_id, action, JSON.stringify(before_json||{}), JSON.stringify(after_json||{})]);
    return true;
  }catch(e){ Logger.log('logAction error: '+e); return false; }
}

/**
 * Super Admin: centrally define and apply validation sets based on Settings values.
 */
function applyStandardValidations(){
  try{
    const cfg = getConfig();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // Audits.status (G)
    const audits = ss.getSheetByName('Audits');
    if (audits){
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(cfg.auditStatuses, true).setAllowInvalid(false).build();
      audits.getRange('G2:G').setDataValidation(rule);
    }
    // Issues.risk_rating (F) and Issues.status (J)
    const issues = ss.getSheetByName('Issues');
    if (issues){
      issues.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cfg.riskRatings, true).setAllowInvalid(false).build());
      issues.getRange('J2:J').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cfg.issueStatuses, true).setAllowInvalid(false).build());
    }
    // Actions.status (F)
    const actions = ss.getSheetByName('Actions');
    if (actions){
      actions.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cfg.actionStatuses, true).setAllowInvalid(false).build());
    }
    // WorkPapers.status (O)
    const wps = ss.getSheetByName('WorkPapers');
    if (wps){
      wps.getRange('O2:O').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cfg.workPaperStatuses, true).setAllowInvalid(false).build());
    }
    return {success:true};
  }catch(e){ Logger.log('applyStandardValidations error: '+e); return {success:false, error:e.message}; }
}

// Call validations after defaults/updates
(function(){ try{ if (typeof ScriptApp !== 'undefined') applyStandardValidations(); }catch(e){} })();

/** Users management with invite **/
function createOrUpdateUser(user){
  const current = getCurrentUser();
  if (!current.permissions || !current.permissions.includes('manage_users')){
    throw new Error('Insufficient permissions');
  }
  if (!user || !user.email) throw new Error('Email is required');
  const existing = getSheetData('Users').find(u => (u.email||'').toLowerCase() === user.email.toLowerCase());
  if (existing){
    return updateRow('Users', existing.id, user);
  } else {
    const rec = addRow('Users', { id:'', email:user.email, name: user.name || user.email.split('@')[0], role: user.role || 'Auditee', org_unit: user.org_unit || 'Unknown', active: user.active!==false, created_at: new Date(), last_login: '' });
    try{ sendUserInviteEmail(rec.email); }catch(e){ Logger.log('invite email error: '+e); }
    return {success:true, id: rec.id, record: rec};
  }
}

function sendUserInviteEmail(email){
  try{
    const appUrl = ScriptApp.getService().getUrl();
    const subject = 'Audit System Invitation';
    const body = 'You have been added to the Audit Management System. Click the link to sign in: '+appUrl;
    MailApp.sendEmail(email, subject, body);
    return {success:true};
  }catch(e){ Logger.log('sendUserInviteEmail error: '+e); return {success:false, error:e.message}; }
}

/** WorkPapers APIs with workflow **/
function listWorkPapers(){
  const user = getCurrentUser();
  const wps = getSheetData('WorkPapers');
  if (user.role === 'Auditor'){ return wps; }
  if (user.role === 'Auditee'){ return wps.filter(w=> (w.created_by||'').toLowerCase() === user.email.toLowerCase()); }
  return wps;
}

function createWorkPaper(payload){
  const user = getCurrentUser();
  if (!user.permissions.includes('create_workpapers')) throw new Error('No permission');
  if (!payload || !payload.audit_id) throw new Error('audit_id required');
  payload.created_by = user.email;
  payload.created_at = new Date();
  payload.status = 'Draft';
  return addRow('WorkPapers', payload);
}

function reviewWorkPaper(id, updates){
  const user = getCurrentUser();
  if (user.role !== 'AuditManager') throw new Error('Only AuditManager can review');
  updates.reviewed_at = new Date();
  updates.reviewer_email = user.email;
  return updateRow('WorkPapers', id, updates);
}

