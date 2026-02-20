// 02_Config.gs - Configuration, Constants, and Database Helpers

const SHEETS = {
  CONFIG: '00_Config',
  ROLES: '01_Roles',
  PERMISSIONS: '02_Permissions',
  FIELD_DEFINITIONS: '03_FieldDefinitions',
  STATUS_WORKFLOW: '04_StatusWorkflow',
  USERS: '05_Users',
  AFFILIATES: '06_Affiliates',
  AUDIT_AREAS: '07_AuditAreas',
  SUB_AREAS: '08_ProcessSubAreas',
  WORK_PAPERS: '09_WorkPapers',
  WP_REQUIREMENTS: '10_WorkPaperRequirements',
  WP_FILES: '11_WorkPaperFiles',
  WP_REVISIONS: '12_WorkPaperRevisions',
  ACTION_PLANS: '13_ActionPlans',
  AP_EVIDENCE: '14_ActionPlanEvidence',
  AP_HISTORY: '15_ActionPlanHistory',
  AUDIT_LOG: '16_AuditLog',
  INDEX_WORK_PAPERS: '17_Index_WorkPapers',
  INDEX_ACTION_PLANS: '18_Index_ActionPlans',
  INDEX_USERS: '19_Index_Users',
  SESSIONS: '20_Sessions',
  NOTIFICATION_QUEUE: '21_NotificationQueue',
  EMAIL_TEMPLATES: '22_EmailTemplates',
  STAGING_AREA: '23_StagingArea'
};

const SCHEMAS = {
  CONFIG: ['config_key', 'config_value', 'description', 'updated_at'],
  ROLES: ['role_code', 'role_name', 'role_level', 'description', 'is_active'],
  USERS: [
    'user_id', 'email', 'password_hash', 'password_salt', 'full_name', 
    'first_name', 'last_name', 'role_code', 'affiliate_code', 'department', 
    'phone', 'is_active', 'must_change_password', 'login_attempts', 
    'locked_until', 'last_login', 'created_at', 'created_by', 'updated_at', 'updated_by'
  ],
  AFFILIATES: ['affiliate_code', 'affiliate_name', 'country', 'region', 'is_active', 'display_order'],
  AUDIT_AREAS: ['area_id', 'area_code', 'area_name', 'description', 'is_active', 'display_order'],
  SUB_AREAS: [
    'sub_area_id', 'area_id', 'sub_area_code', 'sub_area_name', 'control_objectives',
    'risk_description', 'test_objective', 'testing_steps', 'is_active', 'display_order'
  ],
  WORK_PAPERS: [
    'work_paper_id', 'year', 'affiliate_code', 'audit_area_id', 'sub_area_id',
    'work_paper_date', 'audit_period_from', 'audit_period_to',
    'control_objectives', 'control_classification', 'control_type', 'control_frequency', 'control_standards',
    'risk_description', 'test_objective', 'testing_steps',
    'observation_title', 'observation_description', 'risk_rating', 'risk_summary', 'recommendation',
    'management_response', 'responsible_ids', 'cc_recipients',
    'status', 'final_status', 'revision_count',
    'prepared_by_id', 'prepared_by_name', 'prepared_date',
    'submitted_date', 'reviewed_by_id', 'reviewed_by_name', 'review_date', 'review_comments',
    'approved_by_id', 'approved_by_name', 'approved_date', 'sent_to_auditee_date',
    'created_at', 'updated_at', 'work_paper_ref'
  ],
  WP_REQUIREMENTS: [
    'requirement_id', 'work_paper_id', 'requirement_number', 'requirement_description',
    'date_requested', 'status', 'notes', 'created_at', 'created_by'
  ],
  WP_FILES: [
    'file_id', 'work_paper_id', 'file_category', 'file_name', 'file_description',
    'drive_file_id', 'drive_url', 'file_size', 'mime_type', 'uploaded_by', 'uploaded_at'
  ],
  WP_REVISIONS: [
    'revision_id', 'work_paper_id', 'revision_number', 'action', 'comments',
    'changes_summary', 'user_id', 'user_name', 'action_date'
  ],
  ACTION_PLANS: [
    'action_plan_id', 'work_paper_id', 'action_number', 'action_description',
    'owner_ids', 'owner_names', 'due_date', 'status', 'final_status',
    'implementation_notes', 'implemented_date',
    'auditor_review_status', 'auditor_review_by', 'auditor_review_date', 'auditor_review_comments',
    'hoa_review_status', 'hoa_review_by', 'hoa_review_date', 'hoa_review_comments',
    'days_overdue', 'created_at', 'created_by', 'updated_at', 'updated_by'
  ],
  AP_EVIDENCE: [
    'evidence_id', 'action_plan_id', 'file_name', 'file_description',
    'drive_file_id', 'drive_url', 'file_size', 'mime_type', 'uploaded_by', 'uploaded_at'
  ],
  AP_HISTORY: [
    'history_id', 'action_plan_id', 'previous_status', 'new_status', 'comments',
    'user_id', 'user_name', 'changed_at'
  ],
  AUDIT_LOG: [
    'log_id', 'action', 'entity_type', 'entity_id', 'old_data', 'new_data',
    'user_id', 'user_email', 'timestamp', 'ip_address'
  ],
  SESSIONS: [
    'session_id', 'user_id', 'session_token', 'created_at', 'expires_at',
    'ip_address', 'user_agent', 'is_valid'
  ],
  NOTIFICATION_QUEUE: [
    'notification_id', 'template_code', 'recipient_user_id', 'recipient_email',
    'subject', 'body', 'module', 'record_id', 'status', 'scheduled_for',
    'sent_at', 'error_message', 'created_at'
  ],
  EMAIL_TEMPLATES: ['template_code', 'template_name', 'subject_template', 'body_template', 'is_active']
};

const STATUS = {
  WORK_PAPER: {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under Review',
    REVISION_REQUIRED: 'Revision Required',
    APPROVED: 'Approved',
    SENT_TO_AUDITEE: 'Sent to Auditee'
  },
  ACTION_PLAN: {
    NOT_DUE: 'Not Due',
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    IMPLEMENTED: 'Implemented',      // Auditee marks as done
    PENDING_VERIFICATION: 'Pending Verification',  // Awaiting auditor verification
    VERIFIED: 'Verified',            // Auditor verified implementation
    REJECTED: 'Rejected',            // Auditor rejected/returned
    OVERDUE: 'Overdue',
    NOT_IMPLEMENTED: 'Not Implemented',
    CLOSED: 'Closed'                 // Final state after verification
  },
  REVIEW: {
    PENDING: 'Pending Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    RETURNED: 'Returned for Revision'
  },
  NOTIFICATION: {
    PENDING: 'Pending',
    SENT: 'Sent',
    FAILED: 'Failed'
  }
};

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',        // Head of Internal Audit - full system access
  SENIOR_AUDITOR: 'SENIOR_AUDITOR',
  JUNIOR_STAFF: 'JUNIOR_STAFF',
  AUDITEE: 'AUDITEE',
  MANAGEMENT: 'MANAGEMENT',
  SENIOR_MGMT: 'SENIOR_MGMT',
  OBSERVER: 'OBSERVER',
  AUDITOR: 'AUDITOR',
  UNIT_MANAGER: 'UNIT_MANAGER',
  BOARD: 'BOARD',
  EXTERNAL_AUDITOR: 'EXTERNAL_AUDITOR'
};

function generateId(entityType) {
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000);
    
    const configSheet = getSheet(SHEETS.CONFIG);
    const data = configSheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf('config_key');
    const valueIdx = headers.indexOf('config_value');
    
    const configKeyMap = {
      'WORK_PAPER': 'NEXT_WP_ID',
      'ACTION_PLAN': 'NEXT_AP_ID',
      'USER': 'NEXT_USER_ID',
      'REQUIREMENT': 'NEXT_REQ_ID',
      'FILE': 'NEXT_FILE_ID',
      'REVISION': 'NEXT_REV_ID',
      'EVIDENCE': 'NEXT_EVIDENCE_ID',
      'HISTORY': 'NEXT_HISTORY_ID',
      'SESSION': 'NEXT_SESSION_ID',
      'NOTIFICATION': 'NEXT_NOTIF_ID',
      'LOG': 'NEXT_LOG_ID'
    };
    
    const prefixMap = {
      'WORK_PAPER': 'WP-',
      'ACTION_PLAN': 'AP-',
      'USER': 'USR-',
      'REQUIREMENT': 'REQ-',
      'FILE': 'FILE-',
      'REVISION': 'REV-',
      'EVIDENCE': 'EVI-',
      'HISTORY': 'HIST-',
      'SESSION': 'SES-',
      'NOTIFICATION': 'NOTIF-',
      'LOG': 'LOG-'
    };
    
    const configKey = configKeyMap[entityType];
    const prefix = prefixMap[entityType];
    
    if (!configKey || !prefix) {
      throw new Error('Unknown entity type: ' + entityType);
    }
    
    let rowIndex = -1;
    let currentValue = 1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyIdx] === configKey) {
        rowIndex = i + 1;
        currentValue = parseInt(data[i][valueIdx]) || 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      configSheet.appendRow([configKey, 2, 'Auto-generated ID counter', new Date()]);
      return prefix + '000001';
    }
    
    const nextValue = currentValue + 1;
    configSheet.getRange(rowIndex, valueIdx + 1).setValue(nextValue);
    
    const paddedNum = String(currentValue).padStart(6, '0');
    return prefix + paddedNum;
    
  } finally {
    lock.releaseLock();
  }
}

function generateIds(entityType, count) {
  if (count <= 0) return [];
  if (count === 1) return [generateId(entityType)];
  
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000);
    
    const configSheet = getSheet(SHEETS.CONFIG);
    const data = configSheet.getDataRange().getValues();
    const headers = data[0];
    const keyIdx = headers.indexOf('config_key');
    const valueIdx = headers.indexOf('config_value');
    
    const configKeyMap = {
      'WORK_PAPER': 'NEXT_WP_ID',
      'ACTION_PLAN': 'NEXT_AP_ID',
      'FILE': 'NEXT_FILE_ID',
      'REQUIREMENT': 'NEXT_REQ_ID',
      'EVIDENCE': 'NEXT_EVIDENCE_ID'
    };
    
    const prefixMap = {
      'WORK_PAPER': 'WP-',
      'ACTION_PLAN': 'AP-',
      'FILE': 'FILE-',
      'REQUIREMENT': 'REQ-',
      'EVIDENCE': 'EVI-'
    };
    
    const configKey = configKeyMap[entityType];
    const prefix = prefixMap[entityType];
    
    if (!configKey || !prefix) {
      throw new Error('Unknown entity type for batch: ' + entityType);
    }
    
    let rowIndex = -1;
    let currentValue = 1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][keyIdx] === configKey) {
        rowIndex = i + 1;
        currentValue = parseInt(data[i][valueIdx]) || 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      configSheet.appendRow([configKey, count + 1, 'Auto-generated ID counter', new Date()]);
      currentValue = 1;
    } else {
      const nextValue = currentValue + count;
      configSheet.getRange(rowIndex, valueIdx + 1).setValue(nextValue);
    }
    
    const ids = [];
    for (let i = 0; i < count; i++) {
      const paddedNum = String(currentValue + i).padStart(6, '0');
      ids.push(prefix + paddedNum);
    }
    
    return ids;
    
  } finally {
    lock.releaseLock();
  }
}

function getDropdownData() {
  const cacheKey = 'dropdown_data_all';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  
  const dropdowns = {
    affiliates: getAffiliatesDropdown(),
    auditAreas: getAuditAreasDropdown(),
    subAreas: getSubAreasDropdown(),
    users: getUsersDropdown(),
    auditors: getAuditorsDropdown(),
    auditees: getAuditeesDropdown(),
    roles: getRolesDropdown(),
    riskRatings: getRiskRatings(),
    controlClassifications: getControlClassifications(),
    controlTypes: getControlTypes(),
    controlFrequencies: getControlFrequencies(),
    wpStatuses: Object.values(STATUS.WORK_PAPER),
    apStatuses: Object.values(STATUS.ACTION_PLAN),
    years: getYearOptions()
  };
  
  cache.put(cacheKey, JSON.stringify(dropdowns), CONFIG.CACHE_TTL.DROPDOWNS);
  return dropdowns;
}

function invalidateDropdownCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('dropdown_data_all');
  cache.remove('affiliates_dropdown');
  cache.remove('audit_areas_dropdown');
  cache.remove('sub_areas_dropdown');
  cache.remove('users_dropdown');
  cache.remove('roles_dropdown');
  console.log('All dropdown caches invalidated');
}

/**
 * Force clear ALL caches - run this manually after updating user data
 */
function clearAllCaches() {
  const cache = CacheService.getScriptCache();
  // Clear all known cache keys
  const keysToRemove = [
    'dropdown_data_all',
    'affiliates_dropdown', 
    'audit_areas_dropdown',
    'sub_areas_dropdown',
    'users_dropdown',
    'roles_dropdown',
    'perm_SUPER_ADMIN',
    'perm_SENIOR_AUDITOR',
    'perm_AUDITOR',
    'perm_JUNIOR_STAFF',
    'perm_AUDITEE',
    'perm_UNIT_MANAGER',
    'perm_MANAGEMENT',
    'perm_SENIOR_MGMT',
    'perm_BOARD',
    'perm_EXTERNAL_AUDITOR',
    'perm_OBSERVER'
  ];
  
  keysToRemove.forEach(key => {
    try {
      cache.remove(key);
    } catch(e) {}
  });
  
  console.log('All caches cleared successfully');
  return { success: true, message: 'All caches cleared' };
}

function isActive(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'active';
  }
  return false;
}

function getRolesDropdown() {
  const cacheKey = 'roles_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  const sheet = getSheet(SHEETS.ROLES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const codeIdx = headers.indexOf('role_code');
  const nameIdx = headers.indexOf('role_name');
  const levelIdx = headers.indexOf('role_level');
  const activeIdx = headers.indexOf('is_active');
  
  const roles = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      roles.push({ code: row[codeIdx], name: row[nameIdx], level: row[levelIdx] });
    }
  }
  
  roles.sort((a, b) => (b.level || 0) - (a.level || 0));
  cache.put(cacheKey, JSON.stringify(roles), CONFIG.CACHE_TTL.DROPDOWNS);
  return roles;
}

function getAffiliatesDropdown() {
  const cacheKey = 'affiliates_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  const sheet = getSheet(SHEETS.AFFILIATES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const codeIdx = headers.indexOf('affiliate_code');
  const nameIdx = headers.indexOf('affiliate_name');
  const countryIdx = headers.indexOf('country');
  const activeIdx = headers.indexOf('is_active');
  const orderIdx = headers.indexOf('display_order');
  
  const affiliates = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      affiliates.push({
        code: row[codeIdx],
        name: row[nameIdx],
        country: row[countryIdx],
        order: row[orderIdx] || 999,
        display: row[codeIdx] + ' - ' + row[nameIdx]
      });
    }
  }
  
  affiliates.sort((a, b) => (a.order || 999) - (b.order || 999));
  cache.put(cacheKey, JSON.stringify(affiliates), CONFIG.CACHE_TTL.DROPDOWNS);
  return affiliates;
}

function getAuditAreasDropdown() {
  const cacheKey = 'audit_areas_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  const sheet = getSheet(SHEETS.AUDIT_AREAS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const idIdx = headers.indexOf('area_id');
  const codeIdx = headers.indexOf('area_code');
  const nameIdx = headers.indexOf('area_name');
  const activeIdx = headers.indexOf('is_active');
  const orderIdx = headers.indexOf('display_order');
  
  const areas = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      areas.push({
        id: row[idIdx],
        code: row[codeIdx],
        name: row[nameIdx],
        order: row[orderIdx] || 999,
        display: row[codeIdx] + ' - ' + row[nameIdx]
      });
    }
  }
  
  areas.sort((a, b) => (a.order || 999) - (b.order || 999));
  cache.put(cacheKey, JSON.stringify(areas), CONFIG.CACHE_TTL.DROPDOWNS);
  return areas;
}

function getSubAreasDropdown() {
  const cacheKey = 'sub_areas_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  const sheet = getSheet(SHEETS.SUB_AREAS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const idIdx = headers.indexOf('sub_area_id');
  const areaIdIdx = headers.indexOf('area_id');
  const codeIdx = headers.indexOf('sub_area_code');
  const nameIdx = headers.indexOf('sub_area_name');
  const activeIdx = headers.indexOf('is_active');
  const orderIdx = headers.indexOf('display_order');
  const controlObjIdx = headers.indexOf('control_objectives');
  const riskDescIdx = headers.indexOf('risk_description');
  const testObjIdx = headers.indexOf('test_objective');
  const testStepsIdx = headers.indexOf('testing_steps');
  
  const subAreas = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      subAreas.push({
        id: row[idIdx],
        areaId: row[areaIdIdx],
        code: row[codeIdx],
        name: row[nameIdx],
        order: row[orderIdx] || 999,
        controlObjectives: row[controlObjIdx] || '',
        riskDescription: row[riskDescIdx] || '',
        testObjective: row[testObjIdx] || '',
        testingSteps: row[testStepsIdx] || ''
      });
    }
  }
  
  subAreas.sort((a, b) => (a.order || 999) - (b.order || 999));
  cache.put(cacheKey, JSON.stringify(subAreas), CONFIG.CACHE_TTL.DROPDOWNS);
  return subAreas;
}

function getUsersDropdown() {
  const cacheKey = 'users_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const idIdx = headers.indexOf('user_id');
  const emailIdx = headers.indexOf('email');
  const nameIdx = headers.indexOf('full_name');
  const roleIdx = headers.indexOf('role_code');
  const activeIdx = headers.indexOf('is_active');
  const affiliateIdx = headers.indexOf('affiliate_code');
  const deptIdx = headers.indexOf('department');
  
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      users.push({
        id: row[idIdx],
        email: row[emailIdx],
        name: row[nameIdx],
        roleCode: row[roleIdx],
        affiliate: row[affiliateIdx],
        department: row[deptIdx],
        display: row[nameIdx] + ' (' + row[emailIdx] + ')'
      });
    }
  }
  
  users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  cache.put(cacheKey, JSON.stringify(users), CONFIG.CACHE_TTL.DROPDOWNS);
  return users;
}

function getAuditorsDropdown() {
  const allUsers = getUsersDropdown();
  const auditorRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.JUNIOR_STAFF, ROLES.AUDITOR, 'SUPER_ADMIN', 'SENIOR_AUDITOR', 'JUNIOR_STAFF', 'AUDITOR'];
  return allUsers.filter(u => auditorRoles.includes(u.roleCode));
}

function getAuditeesDropdown() {
  const allUsers = getUsersDropdown();
  // Include all non-auditor roles as potential auditees (responsible parties)
  const auditeeRoles = [
    'AUDITEE', 'MANAGEMENT', 'UNIT_MANAGER', 'SENIOR_MGMT', 'JUNIOR_STAFF',
    ROLES.AUDITEE, ROLES.MANAGEMENT, ROLES.UNIT_MANAGER
  ];
  // Return all users that are potential auditees, or just return all active users if no matches
  const auditees = allUsers.filter(u => auditeeRoles.includes(u.roleCode));
  // If no auditees found, return all active users (fallback)
  return auditees.length > 0 ? auditees : allUsers;
}

function getRiskRatings() {
  return [
    { value: 'Extreme', label: 'Extreme', color: '#dc3545' },
    { value: 'High', label: 'High', color: '#fd7e14' },
    { value: 'Medium', label: 'Medium', color: '#ffc107' },
    { value: 'Low', label: 'Low', color: '#28a745' }
  ];
}

function getControlClassifications() {
  return ['Preventive', 'Detective', 'Corrective', 'Directive'];
}

function getControlTypes() {
  return ['Manual', 'Automated', 'IT-Dependent Manual', 'Hybrid'];
}

function getControlFrequencies() {
  return ['Ad-hoc', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];
}

function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y--) {
    years.push(y);
  }
  return years;
}

function getUserByEmail(email) {
  if (!email) return null;
  
  const normalizedEmail = email.toLowerCase().trim();
  const cacheKey = 'user_email_' + normalizedEmail;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.USERS);
  var headers = data[0];
  var emailIdx = headers.indexOf('email');

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).toLowerCase().trim() === normalizedEmail) {
      var user = rowToObject(headers, data[i]);
      user._rowIndex = i + 1;
      cache.put(cacheKey, JSON.stringify(user), CONFIG.CACHE_TTL.USER_BY_EMAIL);
      return user;
    }
  }
  return null;
}

function invalidateUserCache(email, userId) {
  if (!email && !userId) return;
  const cache = CacheService.getScriptCache();
  if (email) {
    cache.remove('user_email_' + email.toLowerCase().trim());
  }
  if (userId) {
    cache.remove('user_id_' + userId);
  }
  cache.remove('users_dropdown');
  cache.remove('dropdown_data_all');
}

function getUserById(userId) {
  if (!userId) return null;

  if (typeof DB !== 'undefined' && DB.getById) {
    const user = DB.getById('USER', userId);
    if (user && user._rowIndex) {
      return user;
    }
    console.log('getUserById: DB.getById returned null or no _rowIndex, using direct lookup');
  }

  var data = getSheetData(SHEETS.USERS);
  if (!data || data.length < 2) {
    console.error('getUserById: Users sheet empty');
    return null;
  }
  var headers = data[0];
  var idIdx = headers.indexOf('user_id');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === userId) {
      var user = rowToObject(headers, data[i]);
      user._rowIndex = i + 1;
      return user;
    }
  }

  console.log('getUserById: User not found:', userId);
  return null;
}

function getWorkPaperById(workPaperId) {
  var data = getSheetData(SHEETS.WORK_PAPERS);
  if (!data || data.length < 2) return null;
  var headers = data[0];
  var idIdx = headers.indexOf('work_paper_id');

  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === workPaperId) {
      var wp = rowToObject(headers, data[i]);
      wp._rowIndex = i + 1;
      return wp;
    }
  }
  return null;
}

function getWorkPaperFull(workPaperId) {
  if (!workPaperId) return null;
  
  let workPaper;
  if (typeof DB !== 'undefined' && DB.getById) {
    workPaper = DB.getById('WORK_PAPER', workPaperId);
  } else {
    workPaper = getWorkPaperById(workPaperId);
  }
  
  if (!workPaper) return null;
  
  workPaper.requirements = getWorkPaperRequirements(workPaperId);
  workPaper.files = getWorkPaperFiles(workPaperId);
  workPaper.revisions = getWorkPaperRevisions(workPaperId);
  workPaper.actionPlans = getActionPlansByWorkPaper(workPaperId);
  
  return workPaper;
}

function getWorkPaperRequirements(workPaperId) {
  var data = getSheetData(SHEETS.WP_REQUIREMENTS);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var requirements = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var req = rowToObject(headers, data[i]);
      req._rowIndex = i + 1;
      requirements.push(req);
    }
  }
  return requirements.sort(function(a, b) { return (a.requirement_number || 0) - (b.requirement_number || 0); });
}

function getWorkPaperFiles(workPaperId) {
  var data = getSheetData(SHEETS.WP_FILES);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var files = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var file = rowToObject(headers, data[i]);
      file._rowIndex = i + 1;
      files.push(file);
    }
  }
  return files;
}

function getWorkPaperRevisions(workPaperId) {
  var data = getSheetData(SHEETS.WP_REVISIONS);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var revisions = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var rev = rowToObject(headers, data[i]);
      rev._rowIndex = i + 1;
      revisions.push(rev);
    }
  }
  return revisions.sort(function(a, b) { return (b.revision_number || 0) - (a.revision_number || 0); });
}

function getActionPlansByWorkPaper(workPaperId) {
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var plans = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var plan = rowToObject(headers, data[i]);
      plan._rowIndex = i + 1;
      plans.push(plan);
    }
  }
  return plans.sort(function(a, b) { return (a.action_number || 0) - (b.action_number || 0); });
}

function getActionPlanById(actionPlanId) {
  if (!actionPlanId) return null;
  if (typeof DB !== 'undefined' && DB.getById) {
    return DB.getById('ACTION_PLAN', actionPlanId);
  }
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) return null;
  var headers = data[0];
  var idIdx = headers.indexOf('action_plan_id');
  for (var i = 1; i < data.length; i++) {
    if (data[i][idIdx] === actionPlanId) {
      var plan = rowToObject(headers, data[i]);
      plan._rowIndex = i + 1;
      return plan;
    }
  }
  return null;
}

function getActionPlanFull(actionPlanId) {
  const plan = getActionPlanById(actionPlanId);
  if (!plan) return null;
  
  plan.evidence = getActionPlanEvidence(actionPlanId);
  plan.history = getActionPlanHistory(actionPlanId);
  
  if (plan.work_paper_id) {
    const wp = getWorkPaperById(plan.work_paper_id);
    if (wp) {
      plan.workPaperTitle = wp.observation_title;
      plan.workPaperStatus = wp.status;
    }
  }
  return plan;
}

function getActionPlanEvidence(actionPlanId) {
  var data = getSheetData(SHEETS.AP_EVIDENCE);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var apIdIdx = headers.indexOf('action_plan_id');
  var evidence = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][apIdIdx] === actionPlanId) {
      var ev = rowToObject(headers, data[i]);
      ev._rowIndex = i + 1;
      evidence.push(ev);
    }
  }
  return evidence;
}

function getActionPlanHistory(actionPlanId) {
  var data = getSheetData(SHEETS.AP_HISTORY);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var apIdIdx = headers.indexOf('action_plan_id');
  var history = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][apIdIdx] === actionPlanId) {
      var h = rowToObject(headers, data[i]);
      h._rowIndex = i + 1;
      history.push(h);
    }
  }
  return history.sort(function(a, b) { return new Date(b.changed_at || 0) - new Date(a.changed_at || 0); });
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, idx) => { obj[header] = row[idx]; });
  return obj;
}

function objectToRow(schemaKey, obj) {
  const schema = SCHEMAS[schemaKey];
  if (!schema) throw new Error('Unknown schema: ' + schemaKey);
  
  return schema.map(col => {
    const val = obj[col];
    if (val instanceof Date) return val;
    if (val === undefined || val === null) return '';
    return val;
  });
}

function getColumnIndex(schemaKey, columnName) {
  const schema = SCHEMAS[schemaKey];
  if (!schema) throw new Error('Unknown schema: ' + schemaKey);
  const idx = schema.indexOf(columnName);
  if (idx === -1) throw new Error('Column not found: ' + columnName + ' in ' + schemaKey);
  return idx;
}

/**
 * Check if user can perform action - NOW USES DATABASE PERMISSIONS
 * SUPER_ADMIN has full access to everything
 * Auditor roles have code-level fallback for work paper create/update
 */
function canUserPerform(user, action, entityType, entity) {
  if (!user) return false;

  const roleCode = user.role_code || user.roleCode;

  // SUPER_ADMIN bypasses all permission checks - full system access
  if (roleCode === 'SUPER_ADMIN') {
    return true;
  }

  // Check database permissions first
  if (typeof checkPermission === 'function') {
    if (!checkPermission(roleCode, entityType, action)) {
      // Fallback: auditor roles should always be able to create/update/read work papers
      // This prevents lockouts when the 02_Permissions sheet is missing entries
      var auditorRoles = [ROLES.AUDITOR, ROLES.SENIOR_AUDITOR, ROLES.JUNIOR_STAFF];
      var wpFallbackActions = ['create', 'read', 'update'];
      if (entityType === 'WORK_PAPER' && auditorRoles.indexOf(roleCode) !== -1 && wpFallbackActions.indexOf(action) !== -1) {
        console.log('Permission granted via auditor fallback:', roleCode, entityType, action);
      } else {
        console.log('Permission denied by database:', roleCode, entityType, action);
        return false;
      }
    }
  }
  
  // Entity-level restrictions (these are business rules, not role bypasses)
  if (entity) {
    // Work paper ownership check for update/delete
    if (entityType === 'WORK_PAPER' && (action === 'update' || action === 'delete')) {
      // Only enforce ownership for non-admin roles that don't have approve permission
      const permissions = getUserPermissions(roleCode);
      if (!permissions.canApproveWorkPaper) {
        // Non-reviewers can only edit their own work papers
        if (entity.prepared_by_id !== user.user_id) {
          console.log('Ownership check failed: user', user.user_id, 'vs prepared_by', entity.prepared_by_id);
          return false;
        }
      }
    }
    
    // Action plan ownership check for auditees
    if (entityType === 'ACTION_PLAN' && roleCode === ROLES.AUDITEE) {
      const ownerIds = String(entity.owner_ids || '').split(',').map(s => s.trim());
      if (!ownerIds.includes(user.user_id)) {
        console.log('Auditee not owner of action plan');
        return false;
      }
      // Auditees cannot delete action plans
      if (action === 'delete') return false;
    }
  }
  
  return true;
}

// getRoleName is defined in 01_Core.gs (canonical, with caching)

function formatDate(date, format) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  
  format = format || 'YYYY-MM-DD';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

function calculateDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (isNaN(due.getTime())) return 0;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  
  const diffMs = today - due;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

function isPastDue(dueDate) {
  return calculateDaysOverdue(dueDate) > 0;
}

function logAuditEvent(action, entityType, entityId, oldData, newData, userId, userEmail) {
  try {
    const sheet = getSheet(SHEETS.AUDIT_LOG);
    const logId = generateId('LOG');
    
    const row = [
      logId, action, entityType, entityId || '',
      oldData ? JSON.stringify(oldData) : '',
      newData ? JSON.stringify(newData) : '',
      userId || '', userEmail || Session.getActiveUser().getEmail() || '',
      new Date(), ''
    ];
    
    sheet.appendRow(row);
  } catch (e) {
    console.error('Failed to log audit event:', e);
  }
}

function getConfigValue(key) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx = headers.indexOf('config_key');
  const valueIdx = headers.indexOf('config_value');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyIdx] === key) return data[i][valueIdx];
  }
  return null;
}

function setConfigValue(key, value) {
  const sheet = getSheet(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx = headers.indexOf('config_key');
  const valueIdx = headers.indexOf('config_value');
  const updatedIdx = headers.indexOf('updated_at');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyIdx] === key) {
      sheet.getRange(i + 1, valueIdx + 1).setValue(value);
      if (updatedIdx >= 0) sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date());
      return true;
    }
  }
  
  sheet.appendRow([key, value, '', new Date()]);
  return true;
}
