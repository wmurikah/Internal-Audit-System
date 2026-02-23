// 01_Core.gs - Core Services Layer (Database, Cache, Index, Security).

const CONFIG = {
 SPREADSHEET_ID: '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4',
  
  // Cache TTLs (seconds)
  CACHE_TTL: {
    CONFIG: 3600,        // 1 hour - rarely changes
    DROPDOWNS: 1800,     // 30 min - affiliates, areas, users list
    PERMISSIONS: 10,     // 10 sec - keep access control changes near-real-time
    SESSION: 300,        // 5 min - session validation
    INDEX: 600,          // 10 min - lookup indexes
    USER_BY_EMAIL: 300,  // 5 min - email to user mapping
    SHEET_HEADERS: 3600  // 1 hour - column headers
  },
  
  // Index sheet mappings
  INDEX_SHEETS: {
    'WORK_PAPER': '17_Index_WorkPapers',
    'ACTION_PLAN': '18_Index_ActionPlans',
    'USER': '19_Index_Users'
  },
  
  // Data sheet mappings
  DATA_SHEETS: {
    'WORK_PAPER': '09_WorkPapers',
    'ACTION_PLAN': '13_ActionPlans',
    'USER': '05_Users'
  }
};

let _dbInstance = null;

function getDatabase() {
  if (!_dbInstance) {
    _dbInstance = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return _dbInstance;
}

function getSheet(sheetName) {
  const db = getDatabase();
  const sheet = db.getSheetByName(sheetName);
  if (!sheet) {
    console.error('Sheet not found:', sheetName);
    return null;
  }
  return sheet;
}

// ── In-memory sheet data cache ──
// Prevents duplicate getDataRange().getValues() calls for the same sheet
// within a single server execution (~3-6 second lifetime).
// This is the highest-leverage perf win: a single dashboard load can read
// the same sheet 3-4 times (sidebar counts, dashboard stats, list queries).
var _sheetDataCache = {};

/**
 * Get all values from a collection, using Firestore as the primary read source.
 * Returns data in array-of-arrays format: [[headers], [row1], [row2], ...]
 * for backward compatibility with existing callers.
 * Falls back to Sheet for collections not in Firestore.
 * For write-heavy paths, pass skipCache = true.
 */
function getSheetData(sheetName, skipCache) {
  if (!skipCache && _sheetDataCache[sheetName]) {
    return _sheetDataCache[sheetName];
  }

  // Firestore-primary: read from Firestore for sheets that have collections
  if (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined' && FIRESTORE_DOC_ID_FIELD[sheetName] &&
      typeof firestoreGetAll === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
    try {
      var fsDocs = firestoreGetAll(sheetName);
      if (fsDocs && fsDocs.length > 0) {
        var headers = Object.keys(fsDocs[0]);
        var data = [headers];
        for (var d = 0; d < fsDocs.length; d++) {
          var row = [];
          for (var h = 0; h < headers.length; h++) {
            var val = fsDocs[d][headers[h]];
            row.push(val !== undefined && val !== null ? val : '');
          }
          data.push(row);
        }
        _sheetDataCache[sheetName] = data;
        return data;
      }
      // Empty Firestore collection — fall through to Sheet
      // (collection may not have been migrated yet)
      console.log('Firestore collection empty for ' + sheetName + ', falling back to Sheet');
    } catch (e) {
      console.warn('Firestore read failed for ' + sheetName + ', falling back to Sheet:', e.message);
    }
  }

  // Fallback to Sheet for non-Firestore collections or Firestore errors
  var sheet = getSheet(sheetName);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  _sheetDataCache[sheetName] = data;
  return data;
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
    var roles = ['SUPER_ADMIN','SENIOR_AUDITOR','AUDITOR','JUNIOR_STAFF','AUDITEE','UNIT_MANAGER','MANAGEMENT','SENIOR_MGMT','BOARD','EXTERNAL_AUDITOR','OBSERVER'];

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
    if (pattern === '*' || pattern === 'index' || pattern === 'index_') {
      keysToRemove.push('index_work_paper_map', 'index_action_plan_map', 'index_user_map');
    }
    if (pattern === '*' || pattern === 'role') {
      keysToRemove.push('role_names');
      roles.forEach(function(r) { keysToRemove.push('role_name_' + r); });
    }
    if (pattern === '*' || pattern === 'headers' || pattern === 'headers_') {
      keysToRemove.push('headers_05_Users', 'headers_09_WorkPapers', 'headers_13_ActionPlans',
        'headers_00_Config', 'headers_02_Permissions', 'headers_06_Sessions');
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

function getSheetHeaders(sheetName) {
  const cacheKey = 'headers_' + sheetName;
  
  // Check cache first
  let headers = Cache.get(cacheKey);
  if (headers) return headers;
  
  // Load from sheet
  const sheet = getSheet(sheetName);
  if (!sheet || sheet.getLastColumn() < 1) return [];
  
  headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // Cache for 1 hour
  Cache.set(cacheKey, headers, CONFIG.CACHE_TTL.SHEET_HEADERS);
  
  return headers;
}

function getColumnIndex(sheetName, columnName) {
  const headers = getSheetHeaders(sheetName);
  return headers.indexOf(columnName);
}

const Index = {
  getRowNumber: function(entityType, entityId) {
    const indexMap = this.getIndexMap(entityType);
    const entry = indexMap[entityId];
    return entry ? entry.rowNumber : -1;
  },

  getIndexMap: function(entityType) {
    const cacheKey = 'index_' + entityType.toLowerCase() + '_map';
    
    // Check cache
    let indexMap = Cache.get(cacheKey);
    if (indexMap) return indexMap;
    
    // Build from index sheet
    const indexSheetName = CONFIG.INDEX_SHEETS[entityType];
    if (!indexSheetName) {
      console.error('No index sheet for entity type:', entityType);
      return {};
    }
    
    const sheet = getSheet(indexSheetName);
    if (!sheet || sheet.getLastRow() < 2) return {};
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const idIdx = 0;  // First column is always the ID
    const rowIdx = 1; // Second column is always row_number
    
    indexMap = {};
    
    for (let i = 1; i < data.length; i++) {
      const id = data[i][idIdx];
      if (!id) continue;
      
      const entry = { rowNumber: data[i][rowIdx] };
      
      // Add additional indexed fields
      for (let j = 2; j < headers.length; j++) {
        entry[headers[j]] = data[i][j];
      }
      
      indexMap[id] = entry;
    }
    
    // Cache the index map
    Cache.set(cacheKey, indexMap, CONFIG.CACHE_TTL.INDEX);
    
    return indexMap;
  },

  updateEntry: function(entityType, entityId, rowNumber, metadata) {
    const indexSheetName = CONFIG.INDEX_SHEETS[entityType];
    if (!indexSheetName) return false;
    
    const sheet = getSheet(indexSheetName);
    if (!sheet) return false;
    
    const headers = getSheetHeaders(indexSheetName);
    const data = sheet.getDataRange().getValues();
    
    // Find existing entry
    let existingRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === entityId) {
        existingRow = i + 1;
        break;
      }
    }
    
    // Build row data
    const rowData = headers.map((header, idx) => {
      if (idx === 0) return entityId;
      if (idx === 1) return rowNumber;
      if (header === 'updated_at') return new Date();
      return metadata[header] !== undefined ? metadata[header] : '';
    });
    
    if (existingRow > 0) {
      // Update existing
      sheet.getRange(existingRow, 1, 1, headers.length).setValues([rowData]);
    } else {
      // Append new
      sheet.appendRow(rowData);
    }
    
    // Invalidate cache
    Cache.remove('index_' + entityType.toLowerCase() + '_map');
    
    return true;
  },

  removeEntry: function(entityType, entityId) {
    const indexSheetName = CONFIG.INDEX_SHEETS[entityType];
    if (!indexSheetName) return false;
    
    const sheet = getSheet(indexSheetName);
    if (!sheet) return false;
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === entityId) {
        sheet.deleteRow(i + 1);
        Cache.remove('index_' + entityType.toLowerCase() + '_map');
        return true;
      }
    }
    
    return false;
  },

  rebuild: function(entityType) {
    const dataSheetName = CONFIG.DATA_SHEETS[entityType];
    const indexSheetName = CONFIG.INDEX_SHEETS[entityType];
    
    if (!dataSheetName || !indexSheetName) {
      console.error('Invalid entity type for index rebuild:', entityType);
      return false;
    }
    
    const dataSheet = getSheet(dataSheetName);
    const indexSheet = getSheet(indexSheetName);
    
    if (!dataSheet || !indexSheet) return false;
    
    const data = dataSheet.getDataRange().getValues();
    if (data.length < 2) {
      // Clear index (keep headers)
      if (indexSheet.getLastRow() > 1) {
        indexSheet.getRange(2, 1, indexSheet.getLastRow() - 1, indexSheet.getLastColumn()).clearContent();
      }
      return true;
    }
    
    const dataHeaders = data[0];
    const indexHeaders = getSheetHeaders(indexSheetName);
    
    // Build column mappings
    const idColName = indexHeaders[0]; // e.g., 'work_paper_id'
    const idIdx = dataHeaders.indexOf(idColName);
    
    if (idIdx === -1) {
      console.error('ID column not found in data sheet:', idColName);
      return false;
    }
    
    const indexRows = [];
    const now = new Date();
    
    for (let i = 1; i < data.length; i++) {
      const entityId = data[i][idIdx];
      if (!entityId) continue;
      
      const indexRow = indexHeaders.map((header, idx) => {
        if (idx === 0) return entityId;
        if (idx === 1) return i + 1; // row_number
        if (header === 'updated_at') return now;
        
        // Find matching column in data
        const dataColIdx = dataHeaders.indexOf(header);
        return dataColIdx >= 0 ? data[i][dataColIdx] : '';
      });
      
      indexRows.push(indexRow);
    }
    
    // Clear and rewrite index
    if (indexSheet.getLastRow() > 1) {
      indexSheet.getRange(2, 1, indexSheet.getLastRow() - 1, indexSheet.getLastColumn()).clearContent();
    }
    
    if (indexRows.length > 0) {
      indexSheet.getRange(2, 1, indexRows.length, indexHeaders.length).setValues(indexRows);
    }
    
    // Clear cache
    Cache.remove('index_' + entityType.toLowerCase() + '_map');
    
    return true;
  }
};

const DB = {
  getById: function(entityType, entityId) {
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (!sheetName) return null;

    // Read from Firestore (primary)
    if (typeof firestoreGet === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      var doc = firestoreGet(sheetName, entityId);
      if (doc) return doc;
    }

    return null;
  },

  getByIds: function(entityType, entityIds) {
    if (!entityIds || entityIds.length === 0) return [];

    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (!sheetName) return [];

    // Read all from Firestore and filter by ID set
    if (typeof firestoreGetAll === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      var allDocs = firestoreGetAll(sheetName);
      if (!allDocs) return [];
      var idField = (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined') ? FIRESTORE_DOC_ID_FIELD[sheetName] : null;
      if (!idField) return [];
      var idSet = {};
      entityIds.forEach(function(id) { idSet[id] = true; });
      return allDocs.filter(function(doc) { return idSet[doc[idField]]; });
    }

    return [];
  },

  getAll: function(sheetName) {
    // Read from Firestore for sheets with collections
    if (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined' && FIRESTORE_DOC_ID_FIELD[sheetName] &&
        typeof firestoreGetAll === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      return firestoreGetAll(sheetName) || [];
    }

    // Fallback for non-Firestore sheets
    var sheet = getSheet(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return [];
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var results = [];
    for (var i = 1; i < data.length; i++) {
      var row = {};
      headers.forEach(function(h, idx) { row[h] = data[i][idx]; });
      results.push(row);
    }
    return results;
  },

  getFiltered: function(entityType, filters) {
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (!sheetName) return [];

    // Read from Firestore and filter in memory
    if (typeof firestoreGetAll === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      var allDocs = firestoreGetAll(sheetName);
      if (!allDocs) return [];
      return allDocs.filter(function(doc) {
        for (var key in filters) {
          if (filters.hasOwnProperty(key) && filters[key] !== undefined && doc[key] !== filters[key]) {
            return false;
          }
        }
        return true;
      });
    }

    return [];
  },

  count: function(entityType, filters) {
    return this.getFiltered(entityType, filters).length;
  }
};

// ── DBWrite: Sheet backup layer ──
// Firestore is the primary write store (via syncToFirestore in service files).
// DBWrite handles Sheet backup only: realtime writes, incremental queuing, or skip.
const DBWrite = {
  insert: function(sheetName, data) {
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup()) {
        try {
          var sheet = getSheet(sheetName);
          if (sheet) {
            var headers = getSheetHeaders(sheetName);
            var rowArray = headers.map(function(header) {
              var value = data[header];
              return sanitizeValue(value !== undefined ? value : '');
            });
            sheet.appendRow(rowArray);
          }
        } catch (e) {
          console.warn('Sheet backup insert failed for ' + sheetName + ':', e.message);
        }
      } else {
        var idField = (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined') ? FIRESTORE_DOC_ID_FIELD[sheetName] : null;
        var docId = idField ? data[idField] : '';
        if (typeof backupToSheet === 'function') backupToSheet(sheetName, docId, 'upsert', null);
      }
    }
    return -1; // No Sheet row (Firestore is primary)
  },

  updateRow: function(sheetName, rowNumber, data) {
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup() && rowNumber >= 2) {
        try {
          var sheet = getSheet(sheetName);
          if (sheet) {
            var headers = getSheetHeaders(sheetName);
            var currentData = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
            var newRowArray = headers.map(function(header, idx) {
              if (data[header] !== undefined) return sanitizeValue(data[header]);
              return currentData[idx];
            });
            sheet.getRange(rowNumber, 1, 1, headers.length).setValues([newRowArray]);
          }
        } catch (e) {
          console.warn('Sheet backup updateRow failed for ' + sheetName + ':', e.message);
        }
      } else if (typeof isRealtimeBackup === 'function' && !isRealtimeBackup()) {
        var idField = (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined') ? FIRESTORE_DOC_ID_FIELD[sheetName] : null;
        var docId = idField && data[idField] ? data[idField] : 'row_' + rowNumber;
        if (typeof backupToSheet === 'function') backupToSheet(sheetName, docId, 'upsert', null);
      }
    }
    return true;
  },

  updateById: function(entityType, entityId, data) {
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup()) {
        var rowNumber = Index.getRowNumber(entityType, entityId);
        if (rowNumber >= 2) {
          this.updateRow(sheetName, rowNumber, data);
          // Update index for backup consistency
          try {
            var indexHeaders = getSheetHeaders(CONFIG.INDEX_SHEETS[entityType]);
            var indexFields = {};
            var needsIndexUpdate = false;
            indexHeaders.forEach(function(header) {
              if (data[header] !== undefined) { indexFields[header] = data[header]; needsIndexUpdate = true; }
            });
            if (needsIndexUpdate) Index.updateEntry(entityType, entityId, rowNumber, indexFields);
          } catch (e) {}
        }
      } else {
        if (typeof backupToSheet === 'function') backupToSheet(sheetName, entityId, 'upsert', null);
      }
    }
    return true;
  },

  deleteRow: function(sheetName, rowNumber) {
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup() && rowNumber >= 2) {
        try {
          var sheet = getSheet(sheetName);
          if (sheet) sheet.deleteRow(rowNumber);
        } catch (e) {
          console.warn('Sheet backup deleteRow failed for ' + sheetName + ':', e.message);
        }
      } else if (typeof isRealtimeBackup === 'function' && !isRealtimeBackup()) {
        if (typeof backupToSheet === 'function') backupToSheet(sheetName, 'row_' + rowNumber, 'delete', null);
      }
    }
    return true;
  },

  deleteById: function(entityType, entityId) {
    var sheetName = CONFIG.DATA_SHEETS[entityType];
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup()) {
        var rowNumber = Index.getRowNumber(entityType, entityId);
        if (rowNumber >= 2) {
          try {
            var sheet = getSheet(sheetName);
            if (sheet) sheet.deleteRow(rowNumber);
            Index.removeEntry(entityType, entityId);
          } catch (e) {
            console.warn('Sheet backup deleteById failed:', e.message);
          }
        }
      } else {
        if (typeof backupToSheet === 'function') backupToSheet(sheetName, entityId, 'delete', null);
      }
    }
    return true;
  },

  batchInsert: function(sheetName, dataArray) {
    if (!dataArray || dataArray.length === 0) return [];
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup()) {
        try {
          var sheet = getSheet(sheetName);
          if (sheet) {
            var headers = getSheetHeaders(sheetName);
            var startRow = sheet.getLastRow() + 1;
            var rowArrays = dataArray.map(function(d) {
              return headers.map(function(header) {
                var value = d[header];
                return sanitizeValue(value !== undefined ? value : '');
              });
            });
            sheet.getRange(startRow, 1, rowArrays.length, headers.length).setValues(rowArrays);
          }
        } catch (e) {
          console.warn('Sheet backup batchInsert failed:', e.message);
        }
      } else {
        var idField = (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined') ? FIRESTORE_DOC_ID_FIELD[sheetName] : null;
        dataArray.forEach(function(d) {
          var docId = idField && d[idField] ? d[idField] : '';
          if (typeof backupToSheet === 'function') backupToSheet(sheetName, docId, 'upsert', null);
        });
      }
    }
    return [];
  },

  batchUpdate: function(sheetName, updates) {
    if (!updates || updates.length === 0) return true;
    if (typeof isSheetBackupEnabled === 'function' && isSheetBackupEnabled()) {
      if (typeof isRealtimeBackup === 'function' && isRealtimeBackup()) {
        try {
          var sheet = getSheet(sheetName);
          if (sheet) {
            var headers = getSheetHeaders(sheetName);
            updates.forEach(function(update) {
              if (update.rowNumber >= 2) {
                var currentData = sheet.getRange(update.rowNumber, 1, 1, headers.length).getValues()[0];
                var newRowArray = headers.map(function(header, idx) {
                  if (update.data[header] !== undefined) return sanitizeValue(update.data[header]);
                  return currentData[idx];
                });
                sheet.getRange(update.rowNumber, 1, 1, headers.length).setValues([newRowArray]);
              }
            });
          }
        } catch (e) {
          console.warn('Sheet backup batchUpdate failed:', e.message);
        }
      } else {
        var idField = (typeof FIRESTORE_DOC_ID_FIELD !== 'undefined') ? FIRESTORE_DOC_ID_FIELD[sheetName] : null;
        updates.forEach(function(u) {
          var docId = idField && u.data[idField] ? u.data[idField] : 'row_' + u.rowNumber;
          if (typeof backupToSheet === 'function') backupToSheet(sheetName, docId, 'upsert', null);
        });
      }
    }
    return true;
  }
};

// Transaction is no longer needed with Firestore-primary.
// Firestore writes are atomic per document. For multi-document atomicity,
// use firestoreBatchWrite() in 00_FirestoreService.gs.
const Transaction = {
  execute: function(operations) {
    console.warn('Transaction.execute is deprecated in Firestore-primary mode. Use firestoreBatchWrite() instead.');
    return { success: false, error: 'Transaction.execute is deprecated. Use Firestore writes directly.' };
  }
};

function getNextId(prefix) {
  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var counterKey = 'NEXT_' + prefix + '_ID';

    // Read from Firestore (primary)
    if (typeof firestoreGet === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      var configDoc = firestoreGet('00_Config', counterKey);
      var currentVal = configDoc ? (parseInt(configDoc.config_value) || 1) : 1;

      // Write incremented value to Firestore
      firestoreSet('00_Config', counterKey, {
        config_key: counterKey,
        config_value: currentVal + 1,
        description: 'Auto-generated counter',
        updated_at: new Date().toISOString()
      });

      lock.releaseLock();
      Cache.remove('config_all');

      var padded = String(currentVal).padStart(5, '0');
      return getIdPrefix(prefix) + padded;
    }

    // Fallback to Sheet
    var sheet = getSheet('00_Config');
    var data = sheet.getDataRange().getValues();
    var headers = data[0];
    var keyIdx = headers.indexOf('config_key');
    var valueIdx = headers.indexOf('config_value');

    for (var i = 1; i < data.length; i++) {
      if (data[i][keyIdx] === counterKey) {
        var val = parseInt(data[i][valueIdx]) || 1;
        sheet.getRange(i + 1, valueIdx + 1).setValue(val + 1);
        lock.releaseLock();
        Cache.remove('config_all');
        return getIdPrefix(prefix) + String(val).padStart(5, '0');
      }
    }

    // Counter doesn't exist, create it
    sheet.appendRow([counterKey, 2, 'Auto-generated counter', new Date()]);
    lock.releaseLock();
    return getIdPrefix(prefix) + '00001';

  } catch (e) {
    try { lock.releaseLock(); } catch (ignored) {}
    throw e;
  }
}

function getIdPrefix(prefix) {
  const prefixMap = {
    'WORK_PAPER': 'WP-',
    'ACTION_PLAN': 'AP-',
    'REQUIREMENT': 'REQ-',
    'FILE': 'FILE-',
    'USER': 'USR-',
    'SESSION': 'SESS-',
    'LOG': 'LOG-',
    'NOTIFICATION': 'NOTIF-'
  };
  return prefixMap[prefix] || prefix + '-';
}

function getConfig(key) {
  const allConfig = getAllConfig();
  return allConfig[key];
}

function getAllConfig() {
  const cacheKey = 'config_all';
  
  // Check cache
  let config = Cache.get(cacheKey);
  if (config) return config;
  
  // Load from sheet
  const data = DB.getAll('00_Config');
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
  // Write to Firestore (primary)
  if (typeof firestoreSet === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
    firestoreSet('00_Config', key, {
      config_key: key,
      config_value: value,
      description: '',
      updated_at: new Date().toISOString()
    });
  }

  // Sheet backup (if enabled)
  if (typeof shouldWriteToSheet !== 'function' || shouldWriteToSheet()) {
    var sheet = getSheet('00_Config');
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var keyIdx = headers.indexOf('config_key');
      var valueIdx = headers.indexOf('config_value');
      var updatedIdx = headers.indexOf('updated_at');

      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][keyIdx] === key) {
          sheet.getRange(i + 1, valueIdx + 1).setValue(value);
          if (updatedIdx >= 0) sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date());
          found = true;
          break;
        }
      }
      if (!found) {
        sheet.appendRow([key, value, '', new Date()]);
      }
    }
  }

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

function logAudit(action, entityType, entityId, oldData, newData, userId) {
  try {
    var logId = getNextId('LOG');
    var logData = {
      log_id: logId,
      action: action,
      entity_type: entityType,
      entity_id: entityId,
      old_data: oldData ? JSON.stringify(oldData) : '',
      new_data: newData ? JSON.stringify(newData) : '',
      user_id: userId || '',
      user_email: '',
      timestamp: new Date().toISOString(),
      ip_address: ''
    };

    // Write to Firestore (primary)
    if (typeof firestoreSet === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      firestoreSet('16_AuditLog', logId, logData);
    }

    // Sheet backup
    if (typeof shouldWriteToSheet !== 'function' || shouldWriteToSheet()) {
      var sheet = getSheet('16_AuditLog');
      if (sheet) {
        sheet.appendRow([
          logId, action, entityType, entityId,
          logData.old_data, logData.new_data,
          logData.user_id, logData.user_email,
          new Date(), logData.ip_address
        ]);
      }
    }
  } catch (e) {
    console.warn('Audit log error:', e.message);
  }
}

function checkPermission(roleCode, module, action) {
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
  const cacheKey = 'perm_' + roleCode;
  
  // Check cache
  let permissions = Cache.get(cacheKey);
  if (permissions) return permissions;
  
  // Load from sheet
  const data = DB.getAll('02_Permissions');
  permissions = {};
  
  data.forEach(row => {
    if (row.role_code === roleCode) {
      permissions[row.module] = {
        can_create: isActive(row.can_create),
        can_read: isActive(row.can_read),
        can_update: isActive(row.can_update),
        can_delete: isActive(row.can_delete),
        can_approve: isActive(row.can_approve),
        can_export: isActive(row.can_export),
        field_restrictions: parseStringArray(row.field_restrictions)
      };
    }
  });
  
  // Cache for 10 minutes
  Cache.set(cacheKey, permissions, CONFIG.CACHE_TTL.PERMISSIONS);
  
  return permissions;
}

function getRoleName(roleCode) {
  if (!roleCode) return '';
  
  const cacheKey = 'role_names';
  let roleMap = Cache.get(cacheKey);
  
  if (!roleMap) {
    const roles = DB.getAll('01_Roles');
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
