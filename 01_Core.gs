// 01_Core.gs - Core Services Layer (Database, Cache, Index, Security)

const CONFIG = {
 SPREADSHEET_ID: '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4',
  
  // Cache TTLs (seconds)
  CACHE_TTL: {
    CONFIG: 3600,        // 1 hour - rarely changes
    DROPDOWNS: 1800,     // 30 min - affiliates, areas, users list
    PERMISSIONS: 600,    // 10 min - role permissions
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
    // CacheService doesn't support pattern deletion
    // We track known cache keys and remove matching ones
    const knownPrefixes = [
      'config_', 'dropdown_', 'perm_', 'session_', 
      'index_', 'user_email_', 'headers_', 'entity_'
    ];
    
    const cache = CacheService.getScriptCache();
    knownPrefixes.forEach(prefix => {
      if (pattern === '*' || prefix.startsWith(pattern)) {
        // Remove common keys with this prefix
        try {
          cache.remove(prefix + 'all');
          cache.remove(prefix + 'list');
        } catch (e) {}
      }
    });
  },

  clearAll: function() {
    try {
      // CacheService doesn't have clearAll, but we can remove known keys
      const cache = CacheService.getScriptCache();
      const keysToRemove = [
        'config_all', 'dropdown_all', 'dropdown_affiliates', 
        'dropdown_areas', 'dropdown_subareas', 'dropdown_users',
        'index_wp_map', 'index_ap_map', 'index_user_map'
      ];
      cache.removeAll(keysToRemove);
    } catch (e) {}
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
    const rowNumber = Index.getRowNumber(entityType, entityId);
    if (rowNumber < 2) return null;

    const sheetName = CONFIG.DATA_SHEETS[entityType];
    const sheet = getSheet(sheetName);
    if (!sheet) return null;

    const headers = getSheetHeaders(sheetName);
    const rowData = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];

    // Convert to object
    const entity = {};
    headers.forEach((h, idx) => {
      entity[h] = rowData[idx];
    });

    // CRITICAL: Include _rowIndex for update operations
    entity._rowIndex = rowNumber;

    return entity;
  },

  getByIds: function(entityType, entityIds) {
    if (!entityIds || entityIds.length === 0) return [];
    
    const indexMap = Index.getIndexMap(entityType);
    const sheetName = CONFIG.DATA_SHEETS[entityType];
    const sheet = getSheet(sheetName);
    if (!sheet) return [];
    
    const headers = getSheetHeaders(sheetName);
    const results = [];
    
    // Group by row ranges for batch read
    const rowsToFetch = entityIds
      .map(id => indexMap[id]?.rowNumber)
      .filter(r => r && r >= 2)
      .sort((a, b) => a - b);
    
    if (rowsToFetch.length === 0) return [];
    
    // For small sets, read individually
    // For large sets, read entire sheet (more efficient)
    if (rowsToFetch.length > 50) {
      // Batch read entire sheet
      const allData = sheet.getDataRange().getValues();
      const idSet = new Set(entityIds);
      const idIdx = headers.indexOf(headers[0]); // Assumes first column is ID
      
      for (let i = 1; i < allData.length; i++) {
        if (idSet.has(allData[i][idIdx])) {
          const entity = {};
          headers.forEach((h, idx) => entity[h] = allData[i][idx]);
          results.push(entity);
        }
      }
    } else {
      // Individual reads
      rowsToFetch.forEach(rowNum => {
        const rowData = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
        const entity = {};
        headers.forEach((h, idx) => entity[h] = rowData[idx]);
        results.push(entity);
      });
    }
    
    return results;
  },

  getAll: function(sheetName) {
    const sheet = getSheet(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const results = [];
    
    for (let i = 1; i < data.length; i++) {
      const row = {};
      headers.forEach((h, idx) => row[h] = data[i][idx]);
      results.push(row);
    }
    
    return results;
  },

  getFiltered: function(entityType, filters) {
    const indexMap = Index.getIndexMap(entityType);
    const matchingIds = [];
    
    // Filter using index metadata
    Object.entries(indexMap).forEach(([id, entry]) => {
      let matches = true;
      
      for (const [key, value] of Object.entries(filters)) {
        if (entry[key] !== undefined && entry[key] !== value) {
          matches = false;
          break;
        }
      }
      
      if (matches) {
        matchingIds.push(id);
      }
    });
    
    // Fetch full records for matching IDs
    return this.getByIds(entityType, matchingIds);
  },

  count: function(entityType, filters) {
    const indexMap = Index.getIndexMap(entityType);
    let count = 0;
    
    Object.values(indexMap).forEach(entry => {
      let matches = true;
      
      for (const [key, value] of Object.entries(filters || {})) {
        if (entry[key] !== undefined && entry[key] !== value) {
          matches = false;
          break;
        }
      }
      
      if (matches) count++;
    });
    
    return count;
  }
};

const DBWrite = {
  insert: function(sheetName, data) {
    const sheet = getSheet(sheetName);
    if (!sheet) return -1;
    
    const headers = getSheetHeaders(sheetName);
    
    // Build row array from data object
    const rowArray = headers.map(header => {
      const value = data[header];
      return sanitizeValue(value !== undefined ? value : '');
    });
    
    sheet.appendRow(rowArray);
    const newRowNumber = sheet.getLastRow();
    
    return newRowNumber;
  },

  updateRow: function(sheetName, rowNumber, data) {
    if (rowNumber < 2) return false;
    
    const sheet = getSheet(sheetName);
    if (!sheet) return false;
    
    const headers = getSheetHeaders(sheetName);
    
    // Get current row data
    const currentData = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
    
    // Merge with new data
    const newRowArray = headers.map((header, idx) => {
      if (data[header] !== undefined) {
        return sanitizeValue(data[header]);
      }
      return currentData[idx];
    });
    
    // Write back
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([newRowArray]);
    
    return true;
  },

  updateById: function(entityType, entityId, data) {
    const rowNumber = Index.getRowNumber(entityType, entityId);
    if (rowNumber < 2) return false;
    
    const sheetName = CONFIG.DATA_SHEETS[entityType];
    const result = this.updateRow(sheetName, rowNumber, data);
    
    // Update index if relevant fields changed
    if (result) {
      const indexHeaders = getSheetHeaders(CONFIG.INDEX_SHEETS[entityType]);
      const indexFields = {};
      let needsIndexUpdate = false;
      
      indexHeaders.forEach(header => {
        if (data[header] !== undefined) {
          indexFields[header] = data[header];
          needsIndexUpdate = true;
        }
      });
      
      if (needsIndexUpdate) {
        Index.updateEntry(entityType, entityId, rowNumber, indexFields);
      }
    }
    
    return result;
  },

  deleteRow: function(sheetName, rowNumber) {
    if (rowNumber < 2) return false;
    
    const sheet = getSheet(sheetName);
    if (!sheet) return false;
    
    sheet.deleteRow(rowNumber);
    return true;
  },

  deleteById: function(entityType, entityId) {
    const rowNumber = Index.getRowNumber(entityType, entityId);
    if (rowNumber < 2) return false;
    
    const sheetName = CONFIG.DATA_SHEETS[entityType];
    const result = this.deleteRow(sheetName, rowNumber);
    
    if (result) {
      // Must rebuild entire index since row numbers shifted
      Index.rebuild(entityType);
    }
    
    return result;
  },

  batchInsert: function(sheetName, dataArray) {
    if (!dataArray || dataArray.length === 0) return [];
    
    const sheet = getSheet(sheetName);
    if (!sheet) return [];
    
    const headers = getSheetHeaders(sheetName);
    const startRow = sheet.getLastRow() + 1;
    
    // Convert data objects to row arrays
    const rowArrays = dataArray.map(data => {
      return headers.map(header => {
        const value = data[header];
        return sanitizeValue(value !== undefined ? value : '');
      });
    });
    
    // Single batch write
    sheet.getRange(startRow, 1, rowArrays.length, headers.length).setValues(rowArrays);
    
    // Return row numbers
    return rowArrays.map((_, idx) => startRow + idx);
  },

  batchUpdate: function(sheetName, updates) {
    if (!updates || updates.length === 0) return true;
    
    const sheet = getSheet(sheetName);
    if (!sheet) return false;
    
    const headers = getSheetHeaders(sheetName);
    
    // Process each update
    // TODO: Optimize by grouping contiguous rows
    updates.forEach(update => {
      if (update.rowNumber >= 2) {
        const currentData = sheet.getRange(update.rowNumber, 1, 1, headers.length).getValues()[0];
        
        const newRowArray = headers.map((header, idx) => {
          if (update.data[header] !== undefined) {
            return sanitizeValue(update.data[header]);
          }
          return currentData[idx];
        });
        
        sheet.getRange(update.rowNumber, 1, 1, headers.length).setValues([newRowArray]);
      }
    });
    
    return true;
  }
};

const Transaction = {
  execute: function(operations) {
    const results = [];
    const rollbackOps = [];
    
    try {
      const lock = LockService.getScriptLock();
      lock.waitLock(30000); // Wait up to 30 seconds
      
      try {
        for (const op of operations) {
          let result;
          
          switch (op.type) {
            case 'insert':
              result = DBWrite.insert(op.sheet, op.data);
              if (result > 0) {
                rollbackOps.push({ type: 'delete', sheet: op.sheet, rowNumber: result });
                results.push({ success: true, rowNumber: result });
              } else {
                throw new Error('Insert failed for sheet: ' + op.sheet);
              }
              break;
              
            case 'update':
              // Store original data for rollback
              const originalData = getSheet(op.sheet)
                .getRange(op.rowNumber, 1, 1, getSheetHeaders(op.sheet).length)
                .getValues()[0];
              
              result = DBWrite.updateRow(op.sheet, op.rowNumber, op.data);
              if (result) {
                const headers = getSheetHeaders(op.sheet);
                const originalObj = {};
                headers.forEach((h, idx) => originalObj[h] = originalData[idx]);
                rollbackOps.push({ type: 'update', sheet: op.sheet, rowNumber: op.rowNumber, data: originalObj });
                results.push({ success: true });
              } else {
                throw new Error('Update failed for sheet: ' + op.sheet);
              }
              break;
              
            case 'delete':
              // Store data for rollback
              const deleteData = getSheet(op.sheet)
                .getRange(op.rowNumber, 1, 1, getSheetHeaders(op.sheet).length)
                .getValues()[0];
              const deleteHeaders = getSheetHeaders(op.sheet);
              const deleteObj = {};
              deleteHeaders.forEach((h, idx) => deleteObj[h] = deleteData[idx]);
              
              result = DBWrite.deleteRow(op.sheet, op.rowNumber);
              if (result) {
                rollbackOps.push({ type: 'insert', sheet: op.sheet, data: deleteObj, atRow: op.rowNumber });
                results.push({ success: true });
              } else {
                throw new Error('Delete failed for sheet: ' + op.sheet);
              }
              break;
              
            default:
              throw new Error('Unknown operation type: ' + op.type);
          }
        }
        
        lock.releaseLock();
        return { success: true, results: results };
        
      } catch (opError) {
        // Attempt rollback
        console.error('Transaction failed, rolling back:', opError.message);
        
        for (let i = rollbackOps.length - 1; i >= 0; i--) {
          const rollback = rollbackOps[i];
          try {
            switch (rollback.type) {
              case 'delete':
                DBWrite.deleteRow(rollback.sheet, rollback.rowNumber);
                break;
              case 'update':
                DBWrite.updateRow(rollback.sheet, rollback.rowNumber, rollback.data);
                break;
              case 'insert':
                // Re-insert at specific row is complex, just append
                DBWrite.insert(rollback.sheet, rollback.data);
                break;
            }
          } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError.message);
          }
        }
        
        lock.releaseLock();
        throw opError;
      }
      
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

function getNextId(prefix) {
  const lock = LockService.getScriptLock();
  
  try {
    lock.waitLock(10000);
    
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
        
        // Clear config cache
        Cache.remove('config_all');
        
        const padded = String(currentVal).padStart(5, '0');
        return getIdPrefix(prefix) + padded;
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
  const sheet = getSheet('00_Config');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx = headers.indexOf('config_key');
  const valueIdx = headers.indexOf('config_value');
  const updatedIdx = headers.indexOf('updated_at');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][keyIdx] === key) {
      sheet.getRange(i + 1, valueIdx + 1).setValue(value);
      if (updatedIdx >= 0) {
        sheet.getRange(i + 1, updatedIdx + 1).setValue(new Date());
      }
      Cache.remove('config_all');
      return true;
    }
  }
  
  // Key doesn't exist, create it
  sheet.appendRow([key, value, '', new Date()]);
  Cache.remove('config_all');
  return true;
}

const Security = {
  hashPassword: function(password, salt) {
    const iterations = parseInt(getConfig('PBKDF2_ITERATIONS')) || 10000;
    let hash = password + salt;
    
    for (let i = 0; i < iterations; i++) {
      const signature = Utilities.computeHmacSignature(
        Utilities.MacAlgorithm.HMAC_SHA_256,
        hash,
        salt
      );
      hash = Utilities.base64Encode(signature);
    }
    
    return hash;
  },

  verifyPassword: function(password, salt, storedHash) {
    const computedHash = this.hashPassword(password, salt);
    return computedHash === storedHash;
  },

  generateSalt: function() {
    const bytes = [];
    for (let i = 0; i < 32; i++) {
      bytes.push(Math.floor(Math.random() * 256));
    }
    return Utilities.base64Encode(bytes);
  },

  generatePassword: function(length) {
    length = length || 12;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    
    // Ensure at least one of each required type
    password += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)];
    password += 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)];
    password += '23456789'[Math.floor(Math.random() * 8)];
    password += '!@#$%'[Math.floor(Math.random() * 5)];
    
    // Fill rest randomly
    for (let i = 4; i < length; i++) {
      password += chars[Math.floor(Math.random() * chars.length)];
    }
    
    // Shuffle
    return password.split('').sort(() => Math.random() - 0.5).join('');
  },

  generateSessionToken: function() {
    const bytes = [];
    for (let i = 0; i < 48; i++) {
      bytes.push(Math.floor(Math.random() * 256));
    }
    return Utilities.base64Encode(bytes).replace(/[+/=]/g, c => {
      return c === '+' ? '-' : c === '/' ? '_' : '';
    });
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

function formatDate(date) {
  if (!date) return '';
  
  try {
    const d = date instanceof Date ? date : new Date(date);
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
    const sheet = getSheet('16_AuditLog');
    if (!sheet) return;
    
    const logId = getNextId('LOG');
    
    sheet.appendRow([
      logId,
      action,
      entityType,
      entityId,
      oldData ? JSON.stringify(oldData) : '',
      newData ? JSON.stringify(newData) : '',
      userId || '',
      '', // user_email - filled by caller if available
      new Date(),
      '' // ip_address - not available in Apps Script
    ]);
  } catch (e) {
    console.warn('Audit log error:', e.message);
  }
}

function checkPermission(roleCode, module, action) {
  const permissions = getPermissions(roleCode);
  const modulePerm = permissions[module];
  
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
        can_create: row.can_create === true || row.can_create === 'TRUE',
        can_read: row.can_read === true || row.can_read === 'TRUE',
        can_update: row.can_update === true || row.can_update === 'TRUE',
        can_delete: row.can_delete === true || row.can_delete === 'TRUE',
        can_approve: row.can_approve === true || row.can_approve === 'TRUE',
        can_export: row.can_export === true || row.can_export === 'TRUE',
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
