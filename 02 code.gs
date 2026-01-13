/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Backend Code v2.0
 * 
 * Main entry point and routing
 * Updated for custom email/password authentication
 */

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  SPREADSHEET_ID: '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4'
};

// Cache for performance
let _db = null;
let _configCache = null;
let _configCacheTime = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// DATABASE ACCESS
// ============================================================
function getDb() {
  if (!_db) {
    _db = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return _db;
}

function getSheet(sheetName) {
  return getDb().getSheetByName(sheetName);
}

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================

/**
 * Main entry point - Always show Login page
 * Client-side will check for existing session and redirect if valid
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Login')
    .setTitle('Hass Audit - Login')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Serve the appropriate portal based on session
 * Called after successful login validation
 */
function servePortal(sessionToken) {
  const sessionResult = validateSession(sessionToken);
  
  if (!sessionResult.valid) {
    return HtmlService.createHtmlOutputFromFile('Login')
      .setTitle('Hass Audit - Login')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  const template = getTemplateForRole(sessionResult.user.role_code);
  return HtmlService.createHtmlOutputFromFile(template)
    .setTitle('Hass Audit System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getTemplateForRole(roleCode) {
  switch (roleCode) {
    case 'SUPER_ADMIN':
    case 'AUDITOR':
      return 'AuditorPortal';
    case 'UNIT_MANAGER':
    case 'JUNIOR_STAFF':
      return 'AuditeePortal';
    case 'BOARD':
    case 'SENIOR_MGMT':
      return 'BoardPortal';
    case 'EXTERNAL_AUDITOR':
      return 'ExternalPortal';
    default:
      return 'Login';
  }
}

// ============================================================
// CONFIGURATION FROM DATABASE
// ============================================================
function getConfig(key) {
  const allConfig = getAllConfig();
  return allConfig[key] || null;
}

function getAllConfig() {
  // Check cache
  if (_configCache && _configCacheTime && (Date.now() - _configCacheTime < CACHE_DURATION_MS)) {
    return _configCache;
  }
  
  const sheet = getSheet('00_Config');
  if (!sheet) return {};
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  
  const headers = data[0];
  const keyIdx = headers.indexOf('config_key');
  const valueIdx = headers.indexOf('config_value');
  const typeIdx = headers.indexOf('value_type');
  
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const key = data[i][keyIdx];
    let value = data[i][valueIdx];
    const type = data[i][typeIdx];
    
    // Type conversion
    if (type === 'NUMBER') {
      value = Number(value);
    } else if (type === 'BOOLEAN') {
      value = value === 'true' || value === true || value === 'TRUE';
    } else if (type === 'JSON') {
      try { value = JSON.parse(value); } catch (e) { }
    }
    
    config[key] = value;
  }
  
  _configCache = config;
  _configCacheTime = Date.now();
  return config;
}

// ============================================================
// CURRENT USER - Session Based (NEW)
// ============================================================

/**
 * Get current user info from session token
 * Called by frontend after login
 */
function getCurrentUserInfo(sessionToken) {
  try {
    // If no token provided, return error
    if (!sessionToken) {
      return { success: false, error: 'No session provided' };
    }
    
    // Validate session using auth service
    const sessionResult = validateSession(sessionToken);
    
    if (!sessionResult.valid) {
      return { success: false, error: sessionResult.error || 'Invalid session' };
    }
    
    // Get permissions for this role
    const permissions = getUserPermissions(sessionResult.user.role_code);
    
    return {
      success: true,
      mustChangePassword: sessionResult.mustChangePassword,
      user: sessionResult.user,
      permissions: permissions
    };
  } catch (error) {
    console.error('getCurrentUserInfo error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Legacy function - kept for compatibility
 * Now requires session token
 */
function getCurrentUser(sessionToken) {
  if (!sessionToken) return null;
  
  const sessionResult = validateSession(sessionToken);
  if (!sessionResult.valid) return null;
  
  return sessionResult.user;
}

/**
 * Get user by ID (internal use)
 */
function getUserById(userId) {
  const users = getSheetData('05_Users');
  return users.find(u => u.user_id === userId && u.is_active) || null;
}

function getRoleName(roleCode) {
  const roleNames = {
    'SUPER_ADMIN': 'Head of Audit',
    'AUDITOR': 'Auditor',
    'EXTERNAL_AUDITOR': 'External Auditor',
    'UNIT_MANAGER': 'Unit Manager',
    'SENIOR_MGMT': 'Senior Management',
    'BOARD': 'Board Member',
    'JUNIOR_STAFF': 'Junior Staff'
  };
  return roleNames[roleCode] || roleCode;
}

// ============================================================
// PERMISSIONS
// ============================================================
function getUserPermissions(roleCode) {
  const sheet = getSheet('02_Permissions');
  if (!sheet) return {};
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  
  const headers = data[0];
  const permissions = {};
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, idx) => row[h] = data[i][idx]);
    
    if (row.role_code === roleCode) {
      permissions[row.module] = {
        can_create: row.can_create === true || row.can_create === 'TRUE',
        can_read: row.can_read === true || row.can_read === 'TRUE',
        can_update: row.can_update === true || row.can_update === 'TRUE',
        can_delete: row.can_delete === true || row.can_delete === 'TRUE',
        can_approve: row.can_approve === true || row.can_approve === 'TRUE',
        can_export: row.can_export === true || row.can_export === 'TRUE',
        field_restrictions: row.field_restrictions ? row.field_restrictions.split(',') : []
      };
    }
  }
  
  return permissions;
}

function checkPermission(roleCode, module, action) {
  const permissions = getUserPermissions(roleCode);
  const modulePerm = permissions[module];
  
  if (!modulePerm) return false;
  
  switch (action) {
    case 'create': return modulePerm.can_create;
    case 'read': return modulePerm.can_read;
    case 'update': return modulePerm.can_update;
    case 'delete': return modulePerm.can_delete;
    case 'approve': return modulePerm.can_approve;
    case 'export': return modulePerm.can_export;
    default: return false;
  }
}

// ============================================================
// GENERIC SHEET DATA ACCESS
// ============================================================
function getSheetData(sheetName, filters = {}) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  
  if (data.length < 2) return [];
  
  const headers = data[0];
  const results = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = data[i][idx];
    });
    
    // Apply filters
    let match = true;
    for (const [key, value] of Object.entries(filters)) {
      if (row[key] !== value) {
        match = false;
        break;
      }
    }
    
    if (match) {
      results.push(row);
    }
  }
  
  return results;
}

function getSheetHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

// ============================================================
// FIELD DEFINITIONS (for dynamic form rendering)
// ============================================================
function getFieldDefinitions(module) {
  try {
    const allFields = getSheetData('03_FieldDefinitions').filter(f => 
      f.module === module && (f.is_active === true || f.is_active === 'TRUE')
    );
    
    // Sort by display_order
    allFields.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    
    // Group by section
    const sections = {};
    allFields.forEach(field => {
      const section = field.section || 'Default';
      if (!sections[section]) {
        sections[section] = [];
      }
      sections[section].push({
        field_id: field.field_id,
        field_name: field.field_name,
        field_label: field.field_label,
        field_type: field.field_type,
        is_required: field.is_required === true || field.is_required === 'TRUE',
        is_readonly: field.is_readonly === true || field.is_readonly === 'TRUE',
        editable_by_roles: field.editable_by_roles ? field.editable_by_roles.split(',') : [],
        visible_to_roles: field.visible_to_roles ? field.visible_to_roles.split(',') : ['ALL'],
        dropdown_source: field.dropdown_source,
        default_value: field.default_value,
        validation_rule: field.validation_rule,
        help_text: field.help_text
      });
    });
    
    return { success: true, data: sections };
  } catch (error) {
    console.error('getFieldDefinitions error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// DROPDOWN OPTIONS (from database)
// ============================================================
function getDropdownOptions(dropdownName) {
  try {
    const allOptions = getSheetData('04_DropdownOptions');
    const options = allOptions
      .filter(o => o.dropdown_name === dropdownName && (o.is_active === true || o.is_active === 'TRUE'))
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
      .map(o => ({
        value: o.option_value,
        label: o.option_label,
        parent_value: o.parent_value,
        metadata: o.metadata ? (() => { try { return JSON.parse(o.metadata); } catch(e) { return null; } })() : null
      }));
    
    return { success: true, data: options };
  } catch (error) {
    console.error('getDropdownOptions error:', error);
    return { success: false, error: error.message };
  }
}

function getAllDropdownOptions() {
  try {
    const allOptions = getSheetData('04_DropdownOptions');
    const grouped = {};
    
    allOptions
      .filter(o => o.is_active === true || o.is_active === 'TRUE')
      .forEach(o => {
        if (!grouped[o.dropdown_name]) {
          grouped[o.dropdown_name] = [];
        }
        grouped[o.dropdown_name].push({
          value: o.option_value,
          label: o.option_label,
          parent_value: o.parent_value,
          metadata: o.metadata ? (() => { try { return JSON.parse(o.metadata); } catch(e) { return null; } })() : null
        });
      });
    
    // Sort each dropdown by display_order
    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    });
    
    return { success: true, data: grouped };
  } catch (error) {
    console.error('getAllDropdownOptions error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// MASTER DATA GETTERS
// ============================================================
function getDropdownData() {
  try {
    const affiliates = getSheetData('06_Affiliates')
      .filter(a => a.is_active === true || a.is_active === 'TRUE')
      .map(a => ({
        affiliate_code: a.affiliate_code,
        affiliate_name: a.affiliate_name,
        country: a.country
      }));
    
    const auditAreas = getSheetData('07_AuditAreas')
      .filter(a => a.is_active === true || a.is_active === 'TRUE')
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
      .map(a => ({
        area_id: a.area_id,
        area_name: a.area_name,
        area_code: a.area_code
      }));
    
    const subAreas = getSheetData('08_ProcessSubAreas')
      .filter(s => s.is_active === true || s.is_active === 'TRUE')
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
      .map(s => ({
        sub_area_id: s.sub_area_id,
        area_id: s.area_id,
        sub_area_name: s.sub_area_name,
        sub_area_code: s.sub_area_code,
        control_objectives: s.control_objectives,
        risk_description: s.risk_description,
        test_objective: s.test_objective,
        testing_steps: s.testing_steps
      }));
    
    const users = getSheetData('05_Users')
      .filter(u => u.is_active === true || u.is_active === 'TRUE')
      .map(u => ({
        user_id: u.user_id,
        full_name: u.full_name,
        email: u.email,
        role_code: u.role_code,
        affiliate_code: u.affiliate_code,
        department: u.department
      }));
    
    const unitManagers = users.filter(u => u.role_code === 'UNIT_MANAGER');
    const allUsers = users;
    
    // Get dropdown options from database
    const dropdownOptions = getAllDropdownOptions();
    
    return {
      success: true,
      data: {
        affiliates,
        auditAreas,
        subAreas,
        unitManagers,
        allUsers,
        dropdownOptions: dropdownOptions.success ? dropdownOptions.data : {}
      }
    };
  } catch (error) {
    console.error('getDropdownData error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// SEQUENCE GENERATOR
// ============================================================
function getNextId(sequenceName) {
  const sheet = getSheet('16_Sequences');
  if (!sheet) throw new Error('Sequences sheet not found');
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const nameIdx = headers.indexOf('sequence_name');
  const prefixIdx = headers.indexOf('prefix');
  const yearIdx = headers.indexOf('current_year');
  const valueIdx = headers.indexOf('current_value');
  
  const currentYear = new Date().getFullYear();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][nameIdx] === sequenceName) {
      let seqYear = data[i][yearIdx];
      let seqValue = data[i][valueIdx];
      const prefix = data[i][prefixIdx];
      
      // Reset if new year
      if (seqYear !== currentYear) {
        seqYear = currentYear;
        seqValue = 0;
      }
      
      // Increment
      seqValue++;
      
      // Update sheet
      sheet.getRange(i + 1, yearIdx + 1).setValue(currentYear);
      sheet.getRange(i + 1, valueIdx + 1).setValue(seqValue);
      
      // Format ID
      const paddedValue = String(seqValue).padStart(6, '0');
      return `${prefix}-${currentYear}-${paddedValue}`;
    }
  }
  
  throw new Error('Sequence not found: ' + sequenceName);
}

// ============================================================
// AUDIT LOG
// ============================================================
function logAudit(action, module, recordId, oldValues, newValues, userId) {
  try {
    const sheet = getSheet('17_AuditLog');
    if (!sheet) return;
    
    const logId = getNextId('LOG');
    
    sheet.appendRow([
      logId,
      new Date(),
      userId || 'SYSTEM',
      '', // email - can be looked up from userId if needed
      action,
      module,
      recordId,
      oldValues ? JSON.stringify(oldValues) : '',
      newValues ? JSON.stringify(newValues) : '',
      '', // IP address
      '' // User agent
    ]);
  } catch (error) {
    console.error('logAudit error:', error);
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function formatDate(date, format) {
  if (!date) return '';
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  if (isNaN(date.getTime())) return '';
  
  const configFormat = format || getConfig('DATE_FORMAT') || 'dd-MMM-yyyy';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), configFormat);
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  return new Date(dateStr);
}

function clearCache() {
  _db = null;
  _configCache = null;
  _configCacheTime = null;
}

// ============================================================
// PORTAL HTML LOADER (for post-login redirect)
// ============================================================
function getPortalHtml() {
  return HtmlService.createHtmlOutputFromFile('AuditorPortal').getContent();
}
