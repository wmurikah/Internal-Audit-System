// 01_Core.gs - Core Services Layer (Database, Cache, Index, Security).

const CONFIG = {
  // Cache TTLs (seconds)
  CACHE_TTL: {
    CONFIG: 3600,        // 1 hour - rarely changes
    DROPDOWNS: 1800,     // 30 min - affiliates, areas, users list
    PERMISSIONS: 10,     // 10 sec - keep access control changes near-real-time
    SESSION: 300,        // 5 min - session validation
    USER_BY_EMAIL: 300   // 5 min - email to user mapping
  },
  
  // Entity type → Turso table key mappings
  // Used by DB.getById, DB.getFiltered, DB.count
  DATA_SHEETS: {
    'WORK_PAPER': '09_WorkPapers',
    'ACTION_PLAN': '13_ActionPlans',
    'USER': '05_Users'
  }
};

/** Legacy stub — returns null. All data now comes from Firestore. */
function getSheet(sheetName) {
  return null;
}

// ── In-memory sheet data cache ──
// Prevents duplicate getDataRange().getValues() calls for the same sheet
// within a single server execution (~3-6 second lifetime).
// This is the highest-leverage perf win: a single dashboard load can read
// the same sheet 3-4 times (sidebar counts, dashboard stats, list queries).
var _sheetDataCache = {};

/**
 * Map a sheet tab name (e.g. '13_ActionPlans') to its SCHEMAS key (e.g. 'ACTION_PLANS').
 * Returns null if no mapping exists.
 */
var _schemaKeyMap = {
  '00_Config': 'CONFIG',
  '01_Roles': 'ROLES',
  '05_Users': 'USERS',
  '06_Affiliates': 'AFFILIATES',
  '07_AuditAreas': 'AUDIT_AREAS',
  '08_ProcessSubAreas': 'SUB_AREAS',
  '09_WorkPapers': 'WORK_PAPERS',
  '10_WorkPaperRequirements': 'WP_REQUIREMENTS',
  '11_WorkPaperFiles': 'WP_FILES',
  '12_WorkPaperRevisions': 'WP_REVISIONS',
  '13_ActionPlans': 'ACTION_PLANS',
  '14_ActionPlanEvidence': 'AP_EVIDENCE',
  '15_ActionPlanHistory': 'AP_HISTORY',
  '16_AuditLog': 'AUDIT_LOG',
  '20_Sessions': 'SESSIONS',
  '21_NotificationQueue': 'NOTIFICATION_QUEUE',
  '22_EmailTemplates': 'EMAIL_TEMPLATES'
};

function _sheetNameToSchemaKey(sheetName) {
  return _schemaKeyMap[sheetName] || null;
}

/**
 * Get all values from a collection. Firestore is the source of truth.
 * Returns data in array-of-arrays format: [[headers], [row1], [row2], ...]
 * for backward compatibility with existing callers.
 *
 * For Firestore-backed collections: reads only from Firestore. No Sheet fallback.
 * For non-Firestore collections (no mapping in FIRESTORE_DOC_ID_FIELD): reads from Sheet.
 * For write-heavy paths, pass skipCache = true.
 */
function getSheetData(sheetName, skipCache) {
  if (!skipCache && _sheetDataCache[sheetName]) {
    return _sheetDataCache[sheetName];
  }

  const rows = tursoGetAll(sheetName);
  if (!rows || rows.length === 0) return [[], []];
  const headers = Object.keys(rows[0]);
  const data    = rows.map(r => headers.map(h => r[h]));
  const result  = [headers, data];
  _sheetDataCache[sheetName] = result;
  return result;
}

/** Invalidate in-memory cache for a sheet after writes */
function invalidateSheetData(sheetName) {
  delete _sheetDataCache[sheetName];
}

/** Invalidate all in-memory sheet data (e.g., after bulk operations) */
function invalidateAllSheetData() {
  _sheetDataCache = {};
}

const Cache = {
  get: function(key) {
    try {
      const cache = CacheService.getScriptCache();
      const data = cache.get(key);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      // Cache miss or parse error
    }
    return null;
  },

  set: function(key, value, ttlSeconds) {
    try {
      const cache = CacheService.getScriptCache();
      const serialized = JSON.stringify(value);
      
      // CacheService has 100KB limit per key
      if (serialized.length > 100000) {
        console.warn('Cache value too large for key:', key);
        return false;
      }
      
      cache.put(key, serialized, ttlSeconds || 300);
      return true;
    } catch (e) {
      console.warn('Cache set error:', e.message);
      return false;
    }
  },

  remove: function(key) {
    try {
      CacheService.getScriptCache().remove(key);
    } catch (e) {}
  },

  invalidatePattern: function(pattern) {
    // CacheService doesn't support pattern deletion.
    // Remove all well-known dynamic keys that match the pattern.
    var cache = CacheService.getScriptCache();
    var keysToRemove = [];
    var roles = ['SUPER_ADMIN','SENIOR_AUDITOR','AUDITOR','JUNIOR_STAFF','UNIT_MANAGER','SENIOR_MGMT','BOARD_MEMBER','EXTERNAL_AUDITOR'];

    if (pattern === '*' || pattern === 'perm_' || pattern === 'perm') {
      roles.forEach(function(r) { keysToRemove.push('perm_' + r); });
    }
    if (pattern === '*' || pattern === 'dropdown' || pattern === 'dropdown_') {
      keysToRemove.push('dropdown_data_all', 'dropdown_all', 'dropdown_affiliates',
        'dropdown_areas', 'dropdown_subareas', 'dropdown_users');
    }
    if (pattern === '*' || pattern === 'config' || pattern === 'config_') {
      keysToRemove.push('config_all', 'config_SYSTEM_NAME', 'config_SESSION_TIMEOUT_HOURS', 'config_AUDIT_FILES_FOLDER_ID');
    }
    if (pattern === '*' || pattern === 'role') {
      keysToRemove.push('role_names');
      roles.forEach(function(r) { keysToRemove.push('role_name_' + r); });
    }

    if (keysToRemove.length > 0) {
      try { cache.removeAll(keysToRemove); } catch (e) {}
    }
  },

  clearAll: function() {
    // Remove all well-known cache keys
    this.invalidatePattern('*');
  }
};

// Index object removed — Firestore queries replace Sheet-based indexes.

const DB = {
  getById: function(entityType, entityId) {
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (!sheetName) return null;
    return tursoGet(sheetName, entityId) || null;
  },

  getByIds: function(entityType, entityIds) {
    if (!entityIds || entityIds.length === 0) return [];
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (!sheetName) return [];
    var allDocs = tursoGetAll(sheetName);
    if (!allDocs) return [];
    var idSet = {};
    entityIds.forEach(function(id) { idSet[id] = true; });
    var pkMap = (typeof TURSO_PK !== 'undefined') ? TURSO_PK : {};
    var tableName = (typeof TURSO_TABLES !== 'undefined') ? TURSO_TABLES[sheetName] : null;
    var idField = tableName ? (pkMap[tableName] || 'id') : 'id';
    return allDocs.filter(function(doc) { return idSet[doc[idField]]; });
  },

  getAll: function(sheetName) {
    return tursoGetAll(sheetName) || [];
  },

  getFiltered: function(entityType, filters) {
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (!sheetName) return [];
    var allDocs = tursoGetAll(sheetName);
    if (!allDocs) return [];
    return allDocs.filter(function(doc) {
      for (var key in filters) {
        if (filters.hasOwnProperty(key) && filters[key] !== undefined && doc[key] !== filters[key]) {
          return false;
        }
      }
      return true;
    });
  },

  count: function(entityType, filters) {
    return this.getFiltered(entityType, filters).length;
  }
};

// All writes go directly through tursoSet / tursoUpdate / tursoDelete.

function getConfig(key) {
  const allConfig = getAllConfig();
  return allConfig[key];
}

function getAllConfig() {
  const cacheKey = 'config_all';
  
  // Check cache
  let config = Cache.get(cacheKey);
  if (config) return config;
  
  // Load from Turso
  const data = tursoGetAll('00_Config');
  config = {};
  
  data.forEach(row => {
    if (row.config_key) {
      config[row.config_key] = row.config_value;
    }
  });
  
  // Cache for 1 hour
  Cache.set(cacheKey, config, CONFIG.CACHE_TTL.CONFIG);
  
  return config;
}

function setConfig(key, value) {
  tursoSetConfig(key, value, 'GLOBAL');
  Cache.remove('config_all');
  return true;
}

const Security = {
  hashPassword: function(password, salt) {
    // Delegate to the canonical implementation in 07_AuthService.gs
    // This avoids duplication and ensures they stay in sync
    return hashPassword(password, salt);
  },

  verifyPassword: function(password, salt, storedHash) {
    return verifyPassword(password, salt, storedHash);
  },

  generateSalt: function() {
    // Use Utilities.getUuid() for cryptographic entropy instead of Math.random()
    var uuids = Utilities.getUuid() + Utilities.getUuid();
    var bytes = [];
    var hex = uuids.replace(/-/g, '');
    for (var i = 0; i < 32 && i * 2 < hex.length; i++) {
      bytes.push(parseInt(hex.substr(i * 2, 2), 16));
    }
    return Utilities.base64Encode(bytes);
  },

  generatePassword: function(length) {
    length = length || 12;
    function secureRandom(max) {
      var hex = Utilities.getUuid().replace(/-/g, '').substring(0, 8);
      return parseInt(hex, 16) % max;
    }

    var upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var lower = 'abcdefghjkmnpqrstuvwxyz';
    var numbers = '23456789';
    var special = '!@#$%';
    var allChars = upper + lower + numbers + special;
    var chars = [];

    // Ensure at least one of each required type
    chars.push(upper[secureRandom(upper.length)]);
    chars.push(lower[secureRandom(lower.length)]);
    chars.push(numbers[secureRandom(numbers.length)]);
    chars.push(special[secureRandom(special.length)]);

    for (var i = 4; i < length; i++) {
      chars.push(allChars[secureRandom(allChars.length)]);
    }

    // Fisher-Yates shuffle
    for (var j = chars.length - 1; j > 0; j--) {
      var k = secureRandom(j + 1);
      var tmp = chars[j]; chars[j] = chars[k]; chars[k] = tmp;
    }
    return chars.join('');
  },

  generateSessionToken: function() {
    // Use Utilities.getUuid() for cryptographic randomness
    var token = '';
    while (token.length < 64) {
      token += Utilities.getUuid().replace(/-/g, '');
    }
    return token.substring(0, 64);
  },

  sanitizeInput: function(value) {
    return sanitizeValue(value);
  },

  isValidEmail: function(email) {
    if (!email) return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  isStrongPassword: function(password) {
    const minLength = parseInt(getConfig('PASSWORD_MIN_LENGTH')) || 8;
    
    if (!password || password.length < minLength) {
      return { valid: false, error: 'Password must be at least ' + minLength + ' characters' };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one uppercase letter' };
    }
    if (!/[a-z]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one lowercase letter' };
    }
    if (!/[0-9]/.test(password)) {
      return { valid: false, error: 'Password must contain at least one number' };
    }
    
    return { valid: true };
  }
};

// Sanitize value to prevent formula injection
function sanitizeValue(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  
  const strVal = String(value);
  
  // Prevent formula injection
  if (/^[=+\-@]/.test(strVal)) {
    return "'" + strVal;
  }
  
  return value;
}

// formatDate is defined in 02_Config.gs (supports optional format parameter)

function formatDateISO(date) {
  if (!date) return '';
  
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().split('T')[0];
  } catch (e) {
    return '';
  }
}

function parseStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(',').map(s => s.trim()).filter(s => s);
}

function formatStringArray(arr) {
  if (!arr) return '';
  if (typeof arr === 'string') return arr;
  return arr.join(',');
}

function logAudit(action, entityType, entityId, oldData, newData, user) {
  try {
    const logId = generateId('LOG');
    const now   = new Date().toISOString();

    // Get previous row hash for chain
    const prevRows = tursoQuery_SQL(
      'SELECT row_hash FROM audit_log ORDER BY occurred_at DESC LIMIT 1', []
    );
    const prevHash = prevRows.length > 0 ? prevRows[0].row_hash : null;

    // Compute row hash: SHA-256 of key fields concatenated
    const hashInput = [logId, now, (user && user.email) || '',
                       action, entityType, entityId || '', prevHash || ''].join('|');
    const hashBytes = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      hashInput,
      Utilities.Charset.UTF_8
    );
    const rowHash = hashBytes.map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('');

    const logRow = {
      log_id:          logId,
      organization_id: (user && user.organization_id) || 'HASS',
      occurred_at:     now,
      actor_user_id:   (user && user.user_id)  || null,
      actor_email:     (user && user.email)     || null,
      actor_role:      (user && user.role_code) || null,
      actor_ip:        null,
      action:          action,
      entity_type:     entityType,
      entity_id:       entityId  || null,
      old_data:        oldData   ? JSON.stringify(oldData)  : null,
      new_data:        newData   ? JSON.stringify(newData)  : null,
      severity:        'info',
      success:         1,
      correlation_id:  null,
      prev_hash:       prevHash,
      row_hash:        rowHash
    };

    tursoSet('16_AuditLog', logId, logRow);
  } catch(e) {
    // Audit log failure must never crash the caller
    console.error('[logAudit] ' + e.message);
  }
}

function checkPermission(roleCode, module, action) {
  // Normalize BOARD → BOARD_MEMBER alias (Firestore stores 'BOARD')
  if (roleCode === 'BOARD') roleCode = 'BOARD_MEMBER';
  const permissions = getPermissions(roleCode);
  let modulePerm = permissions[module];

  // Backward-compatible module aliases to prevent false denials when one module
  // is configured but an equivalent legacy/new module key is checked.
  if (!modulePerm) {
    const moduleAliases = {
      'DASHBOARD': ['REPORT'],
      'REPORT': ['DASHBOARD']
    };
    const aliases = moduleAliases[module] || [];
    for (var i = 0; i < aliases.length; i++) {
      if (permissions[aliases[i]]) {
        modulePerm = permissions[aliases[i]];
        break;
      }
    }
  }
  
  if (!modulePerm) return false;
  
  const actionMap = {
    'create': 'can_create',
    'read': 'can_read',
    'update': 'can_update',
    'delete': 'can_delete',
    'approve': 'can_approve',
    'export': 'can_export'
  };
  
  const permKey = actionMap[action];
  return permKey ? modulePerm[permKey] === true : false;
}

function getPermissions(roleCode) {
  if (!roleCode) return {};
  // Normalize BOARD → BOARD_MEMBER alias (Firestore stores 'BOARD')
  if (roleCode === 'BOARD') roleCode = 'BOARD_MEMBER';
  return ROLE_PERMISSIONS[roleCode] || {};
}

function getRoleName(roleCode) {
  if (!roleCode) return '';
  // Normalize BOARD → BOARD_MEMBER alias (Firestore stores 'BOARD')
  if (roleCode === 'BOARD') roleCode = 'BOARD_MEMBER';

  const cacheKey = 'role_names';
  let roleMap = Cache.get(cacheKey);
  
  if (!roleMap) {
    const roles = tursoGetAll('01_Roles');
    roleMap = {};
    roles.forEach(r => {
      roleMap[r.role_code] = r.role_name;
    });
    Cache.set(cacheKey, roleMap, CONFIG.CACHE_TTL.DROPDOWNS);
  }
  
  return roleMap[roleCode] || roleCode;
}

/**
 * Sanitize object for safe transport to browser via google.script.run
 * Converts Date objects to ISO strings and removes undefined values
 * CANONICAL definition - all other files should use this one
 */
function sanitizeForClient(obj) {
  return JSON.parse(JSON.stringify(obj, function (key, value) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (value === undefined) {
      return null;
    }
    return value;
  }));
}

/**
 * Sanitize user input to prevent formula injection in Google Sheets
 * CANONICAL definition - used by all service files
 */
function sanitizeInput(value, maxLength) {
  if (typeof value !== 'string') return value;

  let sanitized = value;

  // Enforce maximum length to prevent exceeding Google Sheets cell limits (50K chars)
  var limit = maxLength || 50000;
  if (sanitized.length > limit) {
    sanitized = sanitized.substring(0, limit);
  }

  const dangerousChars = ['=', '+', '-', '@', '\t', '\r', '\n'];

  while (dangerousChars.includes(sanitized.charAt(0))) {
    sanitized = sanitized.substring(1);
  }

  sanitized = sanitized.replace(/^=/, "'=");

  return sanitized.trim();
}

/**
 * Build a column-index map from a headers array
 * Utility to replace 52+ inline colMap creation blocks
 */
function buildColumnMap(headers) {
  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });
  return colMap;
}

/**
 * Parse comma-separated ID string into trimmed array
 * Utility to replace 16+ inline split/trim/filter blocks
 */
function parseIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

/**
 * Apply field_restrictions: remove restricted fields from data object
 * based on the role's permission configuration
 */
function applyFieldRestrictions(data, roleCode, module) {
  if (!data || !roleCode || !module) return data;
  var permissions = getPermissions(roleCode);
  var modulePerm = permissions[module];
  if (!modulePerm || !modulePerm.field_restrictions || modulePerm.field_restrictions.length === 0) {
    return data;
  }
  var restricted = modulePerm.field_restrictions;
  if (Array.isArray(data)) {
    return data.map(function(item) {
      var cleaned = {};
      Object.keys(item).forEach(function(key) {
        if (!restricted.includes(key)) {
          cleaned[key] = item[key];
        }
      });
      return cleaned;
    });
  }
  var cleaned = {};
  Object.keys(data).forEach(function(key) {
    if (!restricted.includes(key)) {
      cleaned[key] = data[key];
    }
  });
  return cleaned;
}
