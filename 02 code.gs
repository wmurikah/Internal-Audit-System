/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Core Code v2.0
 * 
 * Database access, config, permissions, dashboard
 * FIXED: All user references use 05_Users
 */

// ============================================================
// CONFIGURATION
// ============================================================
const SPREADSHEET_ID = '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4';

let _db = null;

// ============================================================
// DATABASE ACCESS
// ============================================================
function getDb() {
  if (!_db) {
    _db = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return _db;
}

function getSheet(sheetName) {
  const sheet = getDb().getSheetByName(sheetName);
  if (!sheet) {
    console.error('Sheet not found:', sheetName);
  }
  return sheet;
}

function getSheetHeaders(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function getSheetData(sheetName) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  
  const headers = data[0];
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = data[i][idx];
    });
    rows.push(row);
  }
  
  return rows;
}

// ============================================================
// WEB APP ENTRY POINTS
// ============================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Login')
    .setTitle('Hass Audit - Login')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getPortalHtml() {
  return HtmlService.createHtmlOutputFromFile('AuditorPortal').getContent();
}

// ============================================================
// DROPDOWN DATA (Called by HTML)
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
    
    // FIXED: Use 05_Users
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
    
    return {
      success: true,
      data: {
        affiliates,
        auditAreas,
        subAreas,
        unitManagers,
        allUsers: users
      }
    };
  } catch (error) {
    console.error('getDropdownData error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// AUDITOR DASHBOARD (Called by HTML)
// ============================================================
function getAuditorDashboard(params) {
  try {
    const year = params.year || new Date().getFullYear();
    
    let workPapers = getSheetData('09_WorkPapers');
    if (year) {
      workPapers = workPapers.filter(wp => wp.year == year);
    }
    
    let actionPlans = getSheetData('13_ActionPlans');
    const wpIds = workPapers.map(wp => wp.work_paper_id);
    actionPlans = actionPlans.filter(ap => wpIds.includes(ap.work_paper_id));
    
    const totalWorkPapers = workPapers.length;
    const submittedWPs = workPapers.filter(wp => wp.status === 'Submitted' || wp.status === 'Under Review').length;
    const totalActionPlans = actionPlans.length;
    const openAPs = actionPlans.filter(ap => ap.final_status === 'Open').length;
    const closedAPs = actionPlans.filter(ap => ap.final_status === 'Closed').length;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdueAPs = actionPlans.filter(ap => {
      if (ap.final_status !== 'Open' || !ap.due_date) return false;
      const dueDate = new Date(ap.due_date);
      dueDate.setHours(0, 0, 0, 0);
      return dueDate < today;
    }).length;
    
    const implementationRate = totalActionPlans > 0 
      ? Math.round((closedAPs / totalActionPlans) * 100) 
      : 0;
    
    const recentWPs = workPapers
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .slice(0, 5)
      .map(wp => ({
        ...wp,
        work_paper_date_formatted: formatDate(wp.work_paper_date)
      }));
    
    const pendingReview = workPapers
      .filter(wp => wp.status === 'Submitted' || wp.status === 'Under Review')
      .map(wp => ({
        ...wp,
        submitted_date: formatDate(wp.submitted_date)
      }));
    
    return {
      success: true,
      data: {
        kpis: {
          totalWorkPapers,
          submittedWPs,
          totalActionPlans,
          openAPs,
          closedAPs,
          overdueAPs,
          implementationRate
        },
        tables: {
          recentWPs,
          pendingReview
        }
      }
    };
  } catch (error) {
    console.error('getAuditorDashboard error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// CONFIG FUNCTIONS
// ============================================================
function getConfig(key) {
  try {
    const configData = getSheetData('00_Config');
    const config = configData.find(c => c.config_key === key);
    return config ? config.config_value : null;
  } catch (e) {
    console.warn('getConfig error:', e);
    return null;
  }
}

function getAllConfig() {
  try {
    const configData = getSheetData('00_Config');
    const result = {};
    configData.forEach(c => {
      result[c.config_key] = c.config_value;
    });
    return { success: true, data: result };
  } catch (error) {
    console.error('getAllConfig error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// ID GENERATION
// ============================================================
function getNextId(prefix) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  
  try {
    const sheet = getSheet('00_Config');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf('config_key');
    const valueIdx = headers.indexOf('config_value');
    
    const counterKey = 'NEXT_' + prefix + '_ID';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyIdx] === counterKey) {
        const currentVal = parseInt(data[i][valueIdx]) || 1;
        sheet.getRange(i + 1, valueIdx + 1).setValue(currentVal + 1);
        lock.releaseLock();
        
        const padded = String(currentVal).padStart(5, '0');
        switch (prefix) {
          case 'WORK_PAPER': return 'WP-' + padded;
          case 'ACTION_PLAN': return 'AP-' + padded;
          case 'REQUIREMENT': return 'REQ-' + padded;
          case 'FILE': return 'FILE-' + padded;
          case 'USER': return 'USR-' + padded;
          case 'SESSION': return 'SESS-' + padded;
          case 'LOG': return 'LOG-' + padded;
          default: return prefix + '-' + padded;
        }
      }
    }
    
    sheet.appendRow([counterKey, 2, 'Auto-generated counter']);
    lock.releaseLock();
    
    const padded = '00001';
    switch (prefix) {
      case 'WORK_PAPER': return 'WP-' + padded;
      case 'ACTION_PLAN': return 'AP-' + padded;
      case 'REQUIREMENT': return 'REQ-' + padded;
      case 'FILE': return 'FILE-' + padded;
      case 'USER': return 'USR-' + padded;
      case 'SESSION': return 'SESS-' + padded;
      case 'LOG': return 'LOG-' + padded;
      default: return prefix + '-' + padded;
    }
  } catch (e) {
    lock.releaseLock();
    throw e;
  }
}

// ============================================================
// PERMISSION CHECKING
// ============================================================
function checkPermission(roleCode, module, action) {
  try {
    const permissions = getSheetData('02_RolePermissions');
    const perm = permissions.find(p => 
      p.role_code === roleCode && 
      p.module === module
    );
    
    if (!perm) return false;
    
    switch (action) {
      case 'create': return perm.can_create === true || perm.can_create === 'TRUE';
      case 'read': return perm.can_read === true || perm.can_read === 'TRUE';
      case 'update': return perm.can_update === true || perm.can_update === 'TRUE';
      case 'delete': return perm.can_delete === true || perm.can_delete === 'TRUE';
      case 'approve': return perm.can_approve === true || perm.can_approve === 'TRUE';
      default: return false;
    }
  } catch (e) {
    console.warn('checkPermission error:', e);
    return false;
  }
}

function getUserPermissions(roleCode) {
  try {
    const permissions = getSheetData('02_RolePermissions')
      .filter(p => p.role_code === roleCode);
    
    const result = {};
    permissions.forEach(p => {
      result[p.module] = {
        can_create: p.can_create === true || p.can_create === 'TRUE',
        can_read: p.can_read === true || p.can_read === 'TRUE',
        can_update: p.can_update === true || p.can_update === 'TRUE',
        can_delete: p.can_delete === true || p.can_delete === 'TRUE',
        can_approve: p.can_approve === true || p.can_approve === 'TRUE',
        field_restrictions: p.field_restrictions ? p.field_restrictions.split(',') : []
      };
    });
    
    return result;
  } catch (e) {
    console.warn('getUserPermissions error:', e);
    return {};
  }
}

// ============================================================
// DATE FORMATTING
// ============================================================
function formatDate(date) {
  if (!date) return '';
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch (e) {
    return '';
  }
}

// ============================================================
// AUDIT LOGGING
// ============================================================
function logAudit(action, entityType, entityId, oldData, newData) {
  try {
    const sheet = getSheet('16_AuditLog');
    if (!sheet) return;
    
    const user = Session.getActiveUser().getEmail();
    
    sheet.appendRow([
      getNextId('LOG'),
      action,
      entityType,
      entityId,
      JSON.stringify(oldData || {}),
      JSON.stringify(newData || {}),
      user,
      new Date()
    ]);
  } catch (e) {
    console.warn('logAudit error:', e);
  }
}

// ============================================================
// NOTIFICATION QUEUE
// ============================================================
function queueNotification(type, entityId, user) {
  console.log('Notification queued:', type, entityId, user ? user.user_id : 'system');
}

// ============================================================
// DRIVE FOLDER HELPERS
// ============================================================
function getOrCreateSubfolder(parentFolderId, folderName) {
  try {
    const parent = DriveApp.getFolderById(parentFolderId);
    const existing = parent.getFoldersByName(folderName);
    
    if (existing.hasNext()) {
      return existing.next();
    }
    
    return parent.createFolder(folderName);
  } catch (e) {
    console.error('getOrCreateSubfolder error:', e);
    throw e;
  }
}

// ============================================================
// ADMIN: GET ALL USERS - FIXED: 05_Users
// ============================================================
function adminGetUsers(sessionToken) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Admin access required' };
    }
    
    // FIXED: Use 05_Users
    const users = getSheetData('05_Users');
    
    const roles = getSheetData('01_Roles');
    const roleMap = {};
    roles.forEach(r => {
      roleMap[r.role_code] = r.role_name;
    });
    
    const enriched = users.map(u => ({
      ...u,
      role_name: roleMap[u.role_code] || u.role_code
    }));
    
    return { success: true, data: enriched };
  } catch (error) {
    console.error('adminGetUsers error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: CREATE USER - FIXED: 05_Users
// ============================================================
function adminCreateUser(sessionToken, userData) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Admin access required' };
    }
    
    // FIXED: Use 05_Users
    const existingUsers = getSheetData('05_Users');
    if (existingUsers.find(u => u.email === userData.email)) {
      return { success: false, error: 'Email already exists' };
    }
    
    const tempPassword = generateTempPassword();
    const hashedPassword = hashPassword(tempPassword);
    
    const userId = getNextId('USER');
    const now = new Date();
    
    const sheet = getSheet('05_Users');
    const headers = getSheetHeaders('05_Users');
    
    const row = headers.map(header => {
      switch (header) {
        case 'user_id': return userId;
        case 'email': return userData.email;
        case 'password_hash': return hashedPassword;
        case 'full_name': return (userData.first_name + ' ' + userData.last_name).trim();
        case 'first_name': return userData.first_name || '';
        case 'last_name': return userData.last_name || '';
        case 'role_code': return userData.role_code;
        case 'affiliate_code': return userData.affiliate_code || '';
        case 'department': return userData.department || '';
        case 'phone': return userData.phone || '';
        case 'is_active': return true;
        case 'must_change_password': return true;
        case 'created_at': return now;
        case 'created_by': return user.user_id;
        default: return '';
      }
    });
    
    sheet.appendRow(row);
    
    logAudit('CREATE', 'USER', userId, null, { email: userData.email });
    
    return { 
      success: true, 
      data: { user_id: userId },
      temp_password: tempPassword
    };
  } catch (error) {
    console.error('adminCreateUser error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: RESET PASSWORD - FIXED: 05_Users
// ============================================================
function adminResetPassword(sessionToken, userId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Admin access required' };
    }
    
    const tempPassword = generateTempPassword();
    const hashedPassword = hashPassword(tempPassword);
    
    // FIXED: Use 05_Users
    const sheet = getSheet('05_Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('user_id');
    const pwIdx = headers.indexOf('password_hash');
    const mustChangeIdx = headers.indexOf('must_change_password');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === userId) {
        sheet.getRange(i + 1, pwIdx + 1).setValue(hashedPassword);
        if (mustChangeIdx >= 0) {
          sheet.getRange(i + 1, mustChangeIdx + 1).setValue(true);
        }
        
        logAudit('RESET_PASSWORD', 'USER', userId, null, {});
        
        return { success: true, temp_password: tempPassword };
      }
    }
    
    return { success: false, error: 'User not found' };
  } catch (error) {
    console.error('adminResetPassword error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// ADMIN: TOGGLE USER STATUS - FIXED: 05_Users
// ============================================================
function adminToggleUserStatus(sessionToken, userId, makeActive) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Admin access required' };
    }
    
    // FIXED: Use 05_Users
    const sheet = getSheet('05_Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('user_id');
    const activeIdx = headers.indexOf('is_active');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === userId) {
        sheet.getRange(i + 1, activeIdx + 1).setValue(makeActive);
        
        logAudit(makeActive ? 'ACTIVATE' : 'DEACTIVATE', 'USER', userId, null, {});
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'User not found' };
  } catch (error) {
    console.error('adminToggleUserStatus error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// PASSWORD UTILITIES
// ============================================================
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function hashPassword(password) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password);
  return hash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ============================================================
// TEST FUNCTION
// ============================================================
function testBasicFunctions() {
  console.log('Testing basic functions...');
  console.log('DB:', getDb().getName());
  console.log('Users sheet:', getSheet('05_Users') ? 'Found' : 'Missing');
  console.log('User count:', getSheetData('05_Users').length);
  console.log('Dropdown test:', JSON.stringify(getDropdownData().success));
  console.log('Dashboard test:', JSON.stringify(getAuditorDashboard({ year: 2025 }).success));
  console.log('Config test:', JSON.stringify(getAllConfig().success));
}
