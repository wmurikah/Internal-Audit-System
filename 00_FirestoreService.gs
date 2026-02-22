// 00_FirestoreService.gs - Firestore Integration Layer
// Provides a fast read/write cache backed by Cloud Firestore (free tier).
// Google Sheets remains the canonical data store; Firestore acts as a
// sub-100ms read cache that is kept in sync on every write.
//
// SETUP:
//   1. Create a Firestore database in Native mode (Google Cloud Console).
//   2. Create a service account with "Cloud Datastore User" role.
//   3. Add these Script Properties:
//      - FIRESTORE_PROJECT_ID
//      - FIRESTORE_CLIENT_EMAIL
//      - FIRESTORE_PRIVATE_KEY
//   4. Run  migrateAllSheetsToFirestore()  once to seed the data.

// ─────────────────────────────────────────────────────────────
// Auth & HTTP helpers
// ─────────────────────────────────────────────────────────────

var _firestoreTokenCache = null;

/**
 * Check if Firestore is configured (credentials present in Script Properties)
 */
function isFirestoreEnabled() {
  try {
    var props = PropertiesService.getScriptProperties();
    var projectId = props.getProperty('FIRESTORE_PROJECT_ID');
    var email = props.getProperty('FIRESTORE_CLIENT_EMAIL');
    var key = props.getProperty('FIRESTORE_PRIVATE_KEY');
    return !!(projectId && email && key);
  } catch (e) {
    return false;
  }
}

/**
 * Get Firestore configuration from Script Properties
 */
function getFirestoreConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    projectId: props.getProperty('FIRESTORE_PROJECT_ID'),
    clientEmail: props.getProperty('FIRESTORE_CLIENT_EMAIL'),
    privateKey: props.getProperty('FIRESTORE_PRIVATE_KEY')
  };
}

/**
 * Build a signed JWT and exchange it for a Google OAuth2 access token.
 * Caches the token in memory for the duration of the execution (~6 s).
 */
function getFirestoreAccessToken_() {
  if (_firestoreTokenCache && _firestoreTokenCache.expiry > Date.now()) {
    return _firestoreTokenCache.token;
  }

  var config = getFirestoreConfig_();
  if (!config.projectId || !config.clientEmail || !config.privateKey) {
    throw new Error('Firestore credentials not configured. Set FIRESTORE_PROJECT_ID, FIRESTORE_CLIENT_EMAIL, FIRESTORE_PRIVATE_KEY in Script Properties.');
  }

  var now = Math.floor(Date.now() / 1000);
  var claimSet = {
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  var header = { alg: 'RS256', typ: 'JWT' };

  // Base64url encode WITHOUT padding (JWT spec requires no padding)
  var headerEnc = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, '');
  var claimsEnc = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet)).replace(/=+$/, '');
  var toSign = headerEnc + '.' + claimsEnc;

  // Clean up the private key (handle escaped newlines from Script Properties)
  var cleanKey = config.privateKey.replace(/\\n/g, '\n');
  var signature = Utilities.computeRsaSha256Signature(toSign, cleanKey);
  var sigEnc = Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
  var jwt = toSign + '.' + sigEnc;

  var tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt),
    muteHttpExceptions: true
  });

  var tokenData = JSON.parse(tokenResponse.getContentText());
  if (!tokenData.access_token) {
    throw new Error('Failed to get Firestore access token: ' + tokenResponse.getContentText());
  }

  _firestoreTokenCache = {
    token: tokenData.access_token,
    expiry: Date.now() + (tokenData.expires_in - 60) * 1000  // refresh 60s early
  };

  return _firestoreTokenCache.token;
}

/**
 * Base URL for Firestore REST API v1
 */
function getFirestoreBaseUrl_() {
  var config = getFirestoreConfig_();
  return 'https://firestore.googleapis.com/v1/projects/' +
         config.projectId + '/databases/(default)/documents';
}

/**
 * Generic Firestore REST call
 */
function firestoreRequest_(method, path, payload) {
  var url = getFirestoreBaseUrl_() + (path ? '/' + path : '');
  var options = {
    method: method,
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + getFirestoreAccessToken_()
    },
    muteHttpExceptions: true
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code >= 400) {
    // 404 = document not found — return null, don't throw
    if (code === 404) return null;
    console.error('Firestore error (' + code + '):', text);
    return null;
  }

  return text ? JSON.parse(text) : null;
}


// ─────────────────────────────────────────────────────────────
// Value encoding / decoding (Firestore ↔ plain JS objects)
// ─────────────────────────────────────────────────────────────

/**
 * Convert a plain JS value to Firestore Value format.
 */
function toFirestoreValue_(value) {
  if (value === null || value === undefined || value === '') {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map(function(v) { return toFirestoreValue_(v); })
      }
    };
  }
  if (typeof value === 'object') {
    var fields = {};
    Object.keys(value).forEach(function(k) {
      if (!k.startsWith('_')) {  // skip internal fields like _rowIndex
        fields[k] = toFirestoreValue_(value[k]);
      }
    });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

/**
 * Convert a Firestore Value back to plain JS.
 */
function fromFirestoreValue_(fsValue) {
  if (!fsValue) return null;
  if ('nullValue' in fsValue) return '';
  if ('booleanValue' in fsValue) return fsValue.booleanValue;
  if ('integerValue' in fsValue) return Number(fsValue.integerValue);
  if ('doubleValue' in fsValue) return fsValue.doubleValue;
  if ('timestampValue' in fsValue) return new Date(fsValue.timestampValue);
  if ('stringValue' in fsValue) return fsValue.stringValue;
  if ('arrayValue' in fsValue) {
    return (fsValue.arrayValue.values || []).map(fromFirestoreValue_);
  }
  if ('mapValue' in fsValue) {
    var obj = {};
    var fields = fsValue.mapValue.fields || {};
    Object.keys(fields).forEach(function(k) {
      obj[k] = fromFirestoreValue_(fields[k]);
    });
    return obj;
  }
  return null;
}

/**
 * Convert a plain JS object → Firestore document fields.
 */
function objectToFirestoreFields_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(key) {
    if (!key.startsWith('_')) {
      fields[key] = toFirestoreValue_(obj[key]);
    }
  });
  return fields;
}

/**
 * Convert a Firestore document → plain JS object.
 */
function firestoreDocToObject_(doc) {
  if (!doc || !doc.fields) return null;
  var obj = {};
  Object.keys(doc.fields).forEach(function(key) {
    obj[key] = fromFirestoreValue_(doc.fields[key]);
  });
  return obj;
}


// ─────────────────────────────────────────────────────────────
// CRUD operations
// ─────────────────────────────────────────────────────────────

/**
 * Collection names in Firestore (matching sheet names).
 * Using cleaner names than the sheet tab names.
 */
var FIRESTORE_COLLECTIONS = {
  '05_Users':               'users',
  '06_Affiliates':          'affiliates',
  '07_AuditAreas':          'audit_areas',
  '08_ProcessSubAreas':     'sub_areas',
  '09_WorkPapers':          'work_papers',
  '10_WorkPaperRequirements': 'wp_requirements',
  '11_WorkPaperFiles':      'wp_files',
  '12_WorkPaperRevisions':  'wp_revisions',
  '13_ActionPlans':         'action_plans',
  '14_ActionPlanEvidence':  'ap_evidence',
  '15_ActionPlanHistory':   'ap_history',
  '20_Sessions':            'sessions',
  '00_Config':              'config',
  '01_Roles':               'roles',
  '02_Permissions':         'permissions'
};

/**
 * Primary key column for each sheet (used as Firestore document ID).
 */
var FIRESTORE_DOC_ID_FIELD = {
  '05_Users':               'user_id',
  '06_Affiliates':          'affiliate_code',
  '07_AuditAreas':          'area_id',
  '08_ProcessSubAreas':     'sub_area_id',
  '09_WorkPapers':          'work_paper_id',
  '10_WorkPaperRequirements': 'requirement_id',
  '11_WorkPaperFiles':      'file_id',
  '12_WorkPaperRevisions':  'revision_id',
  '13_ActionPlans':         'action_plan_id',
  '14_ActionPlanEvidence':  'evidence_id',
  '15_ActionPlanHistory':   'history_id',
  '20_Sessions':            'session_id',
  '00_Config':              'config_key',
  '01_Roles':               'role_code',
  '02_Permissions':         'permission_id'
};

/**
 * Get the Firestore collection name for a sheet tab name.
 */
function getFirestoreCollection_(sheetName) {
  return FIRESTORE_COLLECTIONS[sheetName] || sheetName.replace(/^[0-9]+_/, '').toLowerCase();
}

/**
 * Get a single document by ID.
 * @param {string} sheetName - The sheet tab name (e.g., SHEETS.WORK_PAPERS)
 * @param {string} docId - The document ID (primary key value)
 * @return {Object|null} Plain JS object or null
 */
function firestoreGet(sheetName, docId) {
  if (!isFirestoreEnabled()) return null;

  var collection = getFirestoreCollection_(sheetName);
  var doc = firestoreRequest_('get', collection + '/' + encodeURIComponent(docId));
  return doc ? firestoreDocToObject_(doc) : null;
}

/**
 * Get all documents in a collection.
 * @param {string} sheetName - The sheet tab name
 * @return {Array} Array of plain JS objects
 */
function firestoreGetAll(sheetName) {
  if (!isFirestoreEnabled()) return null;

  var collection = getFirestoreCollection_(sheetName);
  var results = [];
  var pageToken = null;

  do {
    var url = collection + '?pageSize=300';
    if (pageToken) url += '&pageToken=' + pageToken;

    var response = firestoreRequest_('get', url);
    if (!response) break;

    var docs = response.documents || [];
    docs.forEach(function(doc) {
      var obj = firestoreDocToObject_(doc);
      if (obj) results.push(obj);
    });

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return results;
}

/**
 * Query documents by a field value.
 * @param {string} sheetName - The sheet tab name
 * @param {string} field - Field name to filter on
 * @param {string} op - Operator: EQUAL, LESS_THAN, GREATER_THAN, etc.
 * @param {*} value - Value to compare against
 * @return {Array} Matching documents
 */
function firestoreQuery(sheetName, field, op, value) {
  if (!isFirestoreEnabled()) return null;

  var collection = getFirestoreCollection_(sheetName);
  var config = getFirestoreConfig_();

  var queryPayload = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: op,
          value: toFirestoreValue_(value)
        }
      }
    }
  };

  var url = 'https://firestore.googleapis.com/v1/projects/' +
            config.projectId + '/databases/(default)/documents:runQuery';

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getFirestoreAccessToken_() },
    payload: JSON.stringify(queryPayload),
    muteHttpExceptions: true
  });

  var results = [];
  var data = JSON.parse(response.getContentText());
  if (Array.isArray(data)) {
    data.forEach(function(item) {
      if (item.document) {
        var obj = firestoreDocToObject_(item.document);
        if (obj) results.push(obj);
      }
    });
  }
  return results;
}

/**
 * Write a single document (create or overwrite).
 * @param {string} sheetName - The sheet tab name
 * @param {string} docId - Document ID
 * @param {Object} data - Plain JS object to store
 */
function firestoreSet(sheetName, docId, data) {
  if (!isFirestoreEnabled()) return;

  var collection = getFirestoreCollection_(sheetName);
  var payload = { fields: objectToFirestoreFields_(data) };
  firestoreRequest_('patch', collection + '/' + encodeURIComponent(docId), payload);
}

/**
 * Delete a single document.
 * @param {string} sheetName - The sheet tab name
 * @param {string} docId - Document ID
 */
function firestoreDelete(sheetName, docId) {
  if (!isFirestoreEnabled()) return;

  var collection = getFirestoreCollection_(sheetName);
  firestoreRequest_('delete', collection + '/' + encodeURIComponent(docId));
}

/**
 * Batch write multiple documents (max 500 per batch — Firestore limit).
 * @param {Array} writes - Array of { sheetName, docId, data } objects
 */
function firestoreBatchWrite(writes) {
  if (!isFirestoreEnabled() || !writes || writes.length === 0) return;

  var config = getFirestoreConfig_();
  var baseUrl = 'projects/' + config.projectId + '/databases/(default)/documents';

  // Firestore batch limit is 500 writes per commit
  var batchSize = 500;
  for (var i = 0; i < writes.length; i += batchSize) {
    var batch = writes.slice(i, i + batchSize);
    var batchWrites = batch.map(function(w) {
      var collection = getFirestoreCollection_(w.sheetName);
      var docPath = baseUrl + '/' + collection + '/' + encodeURIComponent(w.docId);
      return {
        update: {
          name: docPath,
          fields: objectToFirestoreFields_(w.data)
        }
      };
    });

    var url = 'https://firestore.googleapis.com/v1/projects/' +
              config.projectId + '/databases/(default)/documents:batchWrite';

    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + getFirestoreAccessToken_() },
      payload: JSON.stringify({ writes: batchWrites }),
      muteHttpExceptions: true
    });
  }
}


// ─────────────────────────────────────────────────────────────
// Dual-write helpers (keep Sheets + Firestore in sync)
// ─────────────────────────────────────────────────────────────

/**
 * After writing to a Google Sheet, call this to mirror the change to Firestore.
 * Non-fatal: if Firestore write fails, the Sheet write already succeeded.
 * @param {string} sheetName - Sheet tab name (e.g., SHEETS.WORK_PAPERS)
 * @param {string} docId - Primary key value
 * @param {Object} data - The full object that was written to the sheet
 */
function syncToFirestore(sheetName, docId, data) {
  try {
    firestoreSet(sheetName, docId, data);
  } catch (e) {
    console.warn('Firestore sync failed for ' + sheetName + '/' + docId + ':', e.message);
  }
}

/**
 * After deleting from a Google Sheet, remove from Firestore too.
 */
function deleteFromFirestore(sheetName, docId) {
  try {
    firestoreDelete(sheetName, docId);
  } catch (e) {
    console.warn('Firestore delete failed for ' + sheetName + '/' + docId + ':', e.message);
  }
}


// ─────────────────────────────────────────────────────────────
// Migration: Seed Firestore from Google Sheets
// ─────────────────────────────────────────────────────────────

/**
 * One-time migration: reads every row from a Google Sheet tab and writes
 * it to the corresponding Firestore collection.
 * @param {string} sheetName - The sheet tab name to migrate
 * @return {number} Number of documents written
 */
function migrateSheetToFirestore(sheetName) {
  var sheet = getSheet(sheetName);
  if (!sheet) {
    console.log('Sheet not found: ' + sheetName);
    return 0;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    console.log('No data in sheet: ' + sheetName);
    return 0;
  }

  var headers = data[0];
  var idField = FIRESTORE_DOC_ID_FIELD[sheetName];
  var idIdx = idField ? headers.indexOf(idField) : -1;

  if (idIdx === -1) {
    // If no known primary key, use row index as ID
    console.warn('No primary key configured for ' + sheetName + ', using row index');
  }

  var writes = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var docId = idIdx >= 0 ? String(row[idIdx]) : String(i);

    if (!docId || docId === 'undefined') continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      if (headers[j]) {
        obj[headers[j]] = row[j];
      }
    }

    writes.push({
      sheetName: sheetName,
      docId: docId,
      data: obj
    });
  }

  console.log('Migrating ' + writes.length + ' documents to Firestore collection: ' + getFirestoreCollection_(sheetName));
  firestoreBatchWrite(writes);
  console.log('Migration complete for: ' + sheetName);

  return writes.length;
}

/**
 * RUN THIS ONCE: Migrate all relevant sheets to Firestore.
 * Run from Script Editor: Run → migrateAllSheetsToFirestore
 */
function migrateAllSheetsToFirestore() {
  if (!isFirestoreEnabled()) {
    throw new Error('Firestore is not configured. Add FIRESTORE_PROJECT_ID, FIRESTORE_CLIENT_EMAIL, FIRESTORE_PRIVATE_KEY to Script Properties first.');
  }

  var sheetsToMigrate = [
    SHEETS.CONFIG,
    SHEETS.ROLES,
    SHEETS.PERMISSIONS,
    SHEETS.USERS,
    SHEETS.AFFILIATES,
    SHEETS.AUDIT_AREAS,
    SHEETS.SUB_AREAS,
    SHEETS.WORK_PAPERS,
    SHEETS.WP_REQUIREMENTS,
    SHEETS.WP_FILES,
    SHEETS.WP_REVISIONS,
    SHEETS.ACTION_PLANS,
    SHEETS.AP_EVIDENCE,
    SHEETS.AP_HISTORY
  ];

  var totalDocs = 0;
  var report = [];

  sheetsToMigrate.forEach(function(sheetName) {
    try {
      var count = migrateSheetToFirestore(sheetName);
      totalDocs += count;
      report.push(sheetName + ': ' + count + ' docs');
    } catch (e) {
      report.push(sheetName + ': ERROR - ' + e.message);
    }
  });

  var summary = 'Migration complete. Total: ' + totalDocs + ' documents.\n\n' + report.join('\n');
  console.log(summary);
  return summary;
}

/**
 * Verify migration: compare Firestore document count vs Sheet row count.
 */
function verifyFirestoreMigration() {
  if (!isFirestoreEnabled()) return 'Firestore not configured';

  var sheetsToCheck = [
    SHEETS.USERS, SHEETS.WORK_PAPERS, SHEETS.ACTION_PLANS
  ];

  var report = [];

  sheetsToCheck.forEach(function(sheetName) {
    var sheet = getSheet(sheetName);
    var sheetRows = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;  // exclude header
    var fsDocs = firestoreGetAll(sheetName);
    var fsCount = fsDocs ? fsDocs.length : 0;

    var status = sheetRows === fsCount ? 'OK' : 'MISMATCH';
    report.push(sheetName + ': Sheet=' + sheetRows + ' Firestore=' + fsCount + ' [' + status + ']');
  });

  var summary = 'Verification:\n' + report.join('\n');
  console.log(summary);
  return summary;
}


// ─────────────────────────────────────────────────────────────
// Purge & Seed: Reset Firestore + Sheets for testing
// ─────────────────────────────────────────────────────────────

/**
 * Delete ALL documents in a Firestore collection.
 * Uses pagination to handle large collections.
 */
function purgeFirestoreCollection(sheetName) {
  if (!isFirestoreEnabled()) return 0;

  var collection = getFirestoreCollection_(sheetName);
  var deleted = 0;
  var pageToken = null;

  do {
    var url = collection + '?pageSize=300&mask.fieldPaths=__name__';
    if (pageToken) url += '&pageToken=' + pageToken;

    var response = firestoreRequest_('get', url);
    if (!response || !response.documents || response.documents.length === 0) break;

    response.documents.forEach(function(doc) {
      // Extract document ID from the full path
      var parts = doc.name.split('/');
      var docId = parts[parts.length - 1];
      firestoreDelete(sheetName, decodeURIComponent(docId));
      deleted++;
    });

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  console.log('Purged ' + deleted + ' docs from Firestore collection: ' + collection);
  return deleted;
}

/**
 * Clear all data rows from a Google Sheet (keep header row).
 */
function purgeSheetData(sheetName) {
  var sheet = getSheet(sheetName);
  if (!sheet) return 0;

  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  var rowsDeleted = lastRow - 1;
  sheet.getRange(2, 1, rowsDeleted, sheet.getLastColumn()).clearContent();
  // Actually delete rows to avoid blank rows
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1);
  }
  invalidateSheetData(sheetName);
  return rowsDeleted;
}

/**
 * PURGE ALL DATA except active users.
 * Clears both Google Sheets and Firestore, keeping:
 * - Config, Roles, Permissions (system tables)
 * - Active users only (is_active = true/TRUE)
 * - Email templates
 *
 * Then seeds 10 test records per data table with a realistic
 * workflow: work papers in various statuses, action plans, etc.
 *
 * RUN: Script Editor → Run → purgeAndSeedTestData
 */
function purgeAndSeedTestData() {
  if (!isFirestoreEnabled()) {
    throw new Error('Firestore must be enabled. Configure credentials first.');
  }

  var report = [];
  var now = new Date();

  // ── STEP 1: Preserve active users ──
  console.log('Step 1: Preserving active users...');
  var usersSheet = getSheet(SHEETS.USERS);
  var usersData = usersSheet.getDataRange().getValues();
  var userHeaders = usersData[0];
  var activeCol = userHeaders.indexOf('is_active');
  var activeUsers = [];
  for (var i = 1; i < usersData.length; i++) {
    var isActive = usersData[i][activeCol];
    if (isActive === true || isActive === 'true' || isActive === 'TRUE' || isActive === 1) {
      var userObj = {};
      for (var j = 0; j < userHeaders.length; j++) {
        if (userHeaders[j]) userObj[userHeaders[j]] = usersData[i][j];
      }
      activeUsers.push(userObj);
    }
  }
  report.push('Active users preserved: ' + activeUsers.length);
  console.log('Active users found: ' + activeUsers.length);

  // ── STEP 2: Purge data tables (Sheets + Firestore) ──
  console.log('Step 2: Purging data tables...');
  var dataTables = [
    SHEETS.WORK_PAPERS,
    SHEETS.WP_REQUIREMENTS,
    SHEETS.WP_FILES,
    SHEETS.WP_REVISIONS,
    SHEETS.ACTION_PLANS,
    SHEETS.AP_EVIDENCE,
    SHEETS.AP_HISTORY,
    SHEETS.AUDIT_LOG,
    SHEETS.SESSIONS,
    SHEETS.NOTIFICATION_QUEUE,
    SHEETS.STAGING_AREA,
    SHEETS.INDEX_WORK_PAPERS,
    SHEETS.INDEX_ACTION_PLANS,
    SHEETS.INDEX_USERS,
    SHEETS.USERS  // Will re-populate with active users
  ];

  dataTables.forEach(function(tableName) {
    try {
      var sheetRows = purgeSheetData(tableName);
      report.push('Sheet ' + tableName + ': purged ' + sheetRows + ' rows');
    } catch (e) {
      report.push('Sheet ' + tableName + ': ERROR - ' + e.message);
    }
    try {
      var fsDocs = purgeFirestoreCollection(tableName);
      report.push('Firestore ' + getFirestoreCollection_(tableName) + ': purged ' + fsDocs + ' docs');
    } catch (e) {
      report.push('Firestore ' + tableName + ': ERROR - ' + e.message);
    }
  });

  // ── STEP 3: Re-insert active users ──
  console.log('Step 3: Re-inserting active users...');
  if (activeUsers.length > 0) {
    var rows = activeUsers.map(function(u) { return objectToRow('USERS', u); });
    usersSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    invalidateSheetData(SHEETS.USERS);

    // Sync to Firestore
    var userWrites = activeUsers.map(function(u) {
      return { sheetName: SHEETS.USERS, docId: u.user_id, data: u };
    });
    firestoreBatchWrite(userWrites);
    report.push('Users restored: ' + activeUsers.length);
  }

  // Rebuild user index
  try { Index.rebuild('USER'); } catch (e) { console.warn('User index rebuild:', e); }

  // ── STEP 4: Get reference data for seeding ──
  var affiliates = getSheetData(SHEETS.AFFILIATES);
  var affHeaders = affiliates[0];
  var affCodeIdx = affHeaders.indexOf('affiliate_code');
  var affiliateCodes = [];
  for (var a = 1; a < affiliates.length; a++) {
    if (affiliates[a][affCodeIdx]) affiliateCodes.push(affiliates[a][affCodeIdx]);
  }
  if (affiliateCodes.length === 0) affiliateCodes = ['HQ'];

  var areas = getSheetData(SHEETS.AUDIT_AREAS);
  var areaHeaders = areas[0];
  var areaIdIdx = areaHeaders.indexOf('area_id');
  var areaIds = [];
  for (var b = 1; b < areas.length; b++) {
    if (areas[b][areaIdIdx]) areaIds.push(areas[b][areaIdIdx]);
  }
  if (areaIds.length === 0) areaIds = ['AREA-001'];

  var subAreas = getSheetData(SHEETS.SUB_AREAS);
  var saHeaders = subAreas[0];
  var saIdIdx = saHeaders.indexOf('sub_area_id');
  var subAreaIds = [];
  for (var c = 1; c < subAreas.length; c++) {
    if (subAreas[c][saIdIdx]) subAreaIds.push(subAreas[c][saIdIdx]);
  }
  if (subAreaIds.length === 0) subAreaIds = ['SA-001'];

  // Categorise active users by role
  var auditors = activeUsers.filter(function(u) {
    return ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'AUDITOR'].indexOf(u.role_code) >= 0;
  });
  var auditees = activeUsers.filter(function(u) {
    return u.role_code === 'AUDITEE';
  });

  if (auditors.length === 0) auditors = activeUsers.slice(0, 1);
  if (auditees.length === 0) auditees = activeUsers.slice(0, 1);

  // ── STEP 5: Seed 10 Work Papers ──
  console.log('Step 4: Seeding 10 work papers...');
  var wpStatuses = [
    'Draft', 'Draft',
    'Submitted', 'Under Review',
    'Revision Required', 'Approved', 'Approved',
    'Sent to Auditee', 'Sent to Auditee', 'Sent to Auditee'
  ];
  var riskRatings = ['High', 'High', 'Medium', 'Medium', 'Medium', 'Low', 'Low', 'High', 'Medium', 'Low'];
  var observations = [
    'Segregation of duties not enforced in procurement',
    'Incomplete vendor due diligence documentation',
    'Access controls bypass in financial system',
    'Manual journal entries lack dual approval',
    'Inventory reconciliation discrepancies',
    'Travel expense claims without receipts',
    'IT password policy non-compliance',
    'Contract renewals processed without competitive bidding',
    'Fixed asset register not updated quarterly',
    'Petty cash fund not reconciled monthly'
  ];
  var recommendations = [
    'Implement system-enforced SoD controls with compensating detective controls',
    'Develop a standardised vendor onboarding checklist with mandatory documents',
    'Deploy role-based access controls with quarterly access reviews',
    'Configure ERP to require dual sign-off for manual journal entries above threshold',
    'Automate inventory count reconciliation with perpetual system',
    'Mandate receipt uploads before expense claim submission',
    'Enforce 90-day password rotation with complexity requirements',
    'Establish a tender committee for all renewals exceeding USD 50,000',
    'Assign asset custodians and schedule quarterly physical verification',
    'Implement daily petty cash reconciliation with surprise counts'
  ];

  var wpSheet = getSheet(SHEETS.WORK_PAPERS);
  var wpWrites = [];
  var seededWPs = [];

  for (var w = 0; w < 10; w++) {
    var wpId = 'WP-' + String(w + 1).padStart(5, '0');
    var preparer = auditors[w % auditors.length];
    var reviewer = auditors[(w + 1) % auditors.length];
    var auditee = auditees[w % auditees.length];
    var daysAgo = 30 - (w * 3);
    var createdDate = new Date(now.getTime() - daysAgo * 86400000);

    var wp = {
      work_paper_id: wpId,
      year: String(now.getFullYear()),
      affiliate_code: affiliateCodes[w % affiliateCodes.length],
      audit_area_id: areaIds[w % areaIds.length],
      sub_area_id: subAreaIds[w % subAreaIds.length],
      work_paper_date: createdDate,
      audit_period_from: new Date(now.getFullYear(), 0, 1),
      audit_period_to: new Date(now.getFullYear(), 11, 31),
      control_objectives: 'Ensure adequate controls over ' + observations[w].toLowerCase(),
      control_classification: w % 2 === 0 ? 'Preventive' : 'Detective',
      control_type: w % 3 === 0 ? 'Manual' : 'Automated',
      control_frequency: ['Daily', 'Weekly', 'Monthly', 'Quarterly'][w % 4],
      control_standards: 'IIA Standard 2300',
      risk_description: 'Risk of material misstatement or loss due to ' + observations[w].toLowerCase(),
      test_objective: 'Verify that ' + observations[w].toLowerCase() + ' is adequately controlled',
      testing_steps: '1. Obtain sample of transactions\n2. Test controls\n3. Document exceptions\n4. Conclude on effectiveness',
      observation_title: observations[w],
      observation_description: 'During our audit we observed that ' + observations[w].toLowerCase() + '. This was identified through sample testing of transactions in the audit period.',
      risk_rating: riskRatings[w],
      risk_summary: riskRatings[w] + ' risk finding requiring ' + (riskRatings[w] === 'High' ? 'immediate' : 'timely') + ' remediation',
      recommendation: recommendations[w],
      management_response: wpStatuses[w] === 'Sent to Auditee' ? 'Management acknowledges the finding and will implement corrective actions.' : '',
      responsible_ids: auditee.user_id,
      cc_recipients: '',
      status: wpStatuses[w],
      final_status: '',
      revision_count: wpStatuses[w] === 'Revision Required' ? 1 : 0,
      prepared_by_id: preparer.user_id,
      prepared_by_name: preparer.full_name || '',
      prepared_date: createdDate,
      submitted_date: ['Submitted', 'Under Review', 'Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? new Date(createdDate.getTime() + 86400000) : '',
      reviewed_by_id: ['Under Review', 'Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? reviewer.user_id : '',
      reviewed_by_name: ['Under Review', 'Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? (reviewer.full_name || '') : '',
      review_date: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? new Date(createdDate.getTime() + 2 * 86400000) : '',
      review_comments: wpStatuses[w] === 'Revision Required' ? 'Please provide more supporting evidence.' : '',
      approved_by_id: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? reviewer.user_id : '',
      approved_by_name: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? (reviewer.full_name || '') : '',
      approved_date: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? new Date(createdDate.getTime() + 3 * 86400000) : '',
      sent_to_auditee_date: wpStatuses[w] === 'Sent to Auditee' ? new Date(createdDate.getTime() + 4 * 86400000) : '',
      created_at: createdDate,
      updated_at: now,
      work_paper_ref: affiliateCodes[w % affiliateCodes.length] + '/WP/' + String(w + 1).padStart(3, '0')
    };

    seededWPs.push(wp);
    var row = objectToRow('WORK_PAPERS', wp);
    wpSheet.appendRow(row);
    wpWrites.push({ sheetName: SHEETS.WORK_PAPERS, docId: wpId, data: wp });
  }
  invalidateSheetData(SHEETS.WORK_PAPERS);
  firestoreBatchWrite(wpWrites);
  report.push('Work papers seeded: 10');

  // ── STEP 6: Seed Action Plans (for the 3 "Sent to Auditee" WPs) ──
  console.log('Step 5: Seeding action plans...');
  var apSheet = getSheet(SHEETS.ACTION_PLANS);
  var apHistSheet = getSheet(SHEETS.AP_HISTORY);
  var apWrites = [];
  var apHistWrites = [];
  var apStatuses = [
    STATUS.ACTION_PLAN.PENDING,
    STATUS.ACTION_PLAN.IN_PROGRESS,
    STATUS.ACTION_PLAN.PENDING_VERIFICATION,
    STATUS.ACTION_PLAN.NOT_DUE,
    STATUS.ACTION_PLAN.PENDING,
    STATUS.ACTION_PLAN.OVERDUE,
    STATUS.ACTION_PLAN.VERIFIED,
    STATUS.ACTION_PLAN.IN_PROGRESS,
    STATUS.ACTION_PLAN.PENDING,
    STATUS.ACTION_PLAN.REJECTED
  ];
  var apCount = 0;

  var sentWPs = seededWPs.filter(function(wp) { return wp.status === 'Sent to Auditee'; });

  for (var s = 0; s < sentWPs.length; s++) {
    var parentWp = sentWPs[s];
    // Create 3-4 action plans per sent work paper
    var planCount = 3 + (s % 2);
    for (var p = 0; p < planCount; p++) {
      var apIdx = apCount % apStatuses.length;
      var apId = 'AP-' + String(apCount + 1).padStart(5, '0');
      var dueOffset = (apStatuses[apIdx] === STATUS.ACTION_PLAN.OVERDUE) ? -10 : 30 + (p * 15);
      var dueDate = new Date(now.getTime() + dueOffset * 86400000);
      var apOwner = auditees[apCount % auditees.length];
      var daysOvd = apStatuses[apIdx] === STATUS.ACTION_PLAN.OVERDUE ? Math.abs(dueOffset) : 0;

      var ap = {
        action_plan_id: apId,
        work_paper_id: parentWp.work_paper_id,
        action_number: p + 1,
        action_description: recommendations[apCount % recommendations.length],
        owner_ids: apOwner.user_id,
        owner_names: apOwner.full_name || '',
        due_date: dueDate,
        status: apStatuses[apIdx],
        final_status: '',
        implementation_notes: apStatuses[apIdx] === STATUS.ACTION_PLAN.PENDING_VERIFICATION ? 'Controls have been implemented as recommended.' : '',
        implemented_date: apStatuses[apIdx] === STATUS.ACTION_PLAN.PENDING_VERIFICATION ? new Date(now.getTime() - 2 * 86400000) : '',
        auditor_review_status: apStatuses[apIdx] === STATUS.ACTION_PLAN.VERIFIED ? 'Approved' : (apStatuses[apIdx] === STATUS.ACTION_PLAN.REJECTED ? 'Rejected' : ''),
        auditor_review_by: apStatuses[apIdx] === STATUS.ACTION_PLAN.VERIFIED ? auditors[0].user_id : '',
        auditor_review_date: apStatuses[apIdx] === STATUS.ACTION_PLAN.VERIFIED ? new Date(now.getTime() - 86400000) : '',
        auditor_review_comments: apStatuses[apIdx] === STATUS.ACTION_PLAN.REJECTED ? 'Evidence provided is insufficient. Please provide system screenshots.' : '',
        hoa_review_status: '',
        hoa_review_by: '',
        hoa_review_date: '',
        hoa_review_comments: '',
        days_overdue: daysOvd,
        delegated_by_id: '',
        delegated_by_name: '',
        delegated_date: '',
        delegation_notes: '',
        original_owner_ids: '',
        created_at: parentWp.sent_to_auditee_date || now,
        created_by: auditors[0].user_id,
        updated_at: now,
        updated_by: auditors[0].user_id
      };

      apSheet.appendRow(objectToRow('ACTION_PLANS', ap));
      apWrites.push({ sheetName: SHEETS.ACTION_PLANS, docId: apId, data: ap });

      // Add creation history
      var histId = 'HIST-' + String(apCount + 1).padStart(5, '0');
      var hist = {
        history_id: histId,
        action_plan_id: apId,
        previous_status: '',
        new_status: apStatuses[apIdx],
        comments: 'Action plan created from audit finding',
        user_id: auditors[0].user_id,
        user_name: auditors[0].full_name || '',
        changed_at: parentWp.sent_to_auditee_date || now
      };
      apHistSheet.appendRow(objectToRow('AP_HISTORY', hist));
      apHistWrites.push({ sheetName: SHEETS.AP_HISTORY, docId: histId, data: hist });

      apCount++;
    }
  }

  invalidateSheetData(SHEETS.ACTION_PLANS);
  invalidateSheetData(SHEETS.AP_HISTORY);
  firestoreBatchWrite(apWrites);
  firestoreBatchWrite(apHistWrites);
  report.push('Action plans seeded: ' + apCount);
  report.push('AP history records seeded: ' + apCount);

  // ── STEP 7: Reset ID counters so new records don't collide with seeded IDs ──
  console.log('Step 6: Resetting ID counters...');
  var idCounterResets = {
    'NEXT_WP_ID': 11,     // seeded WP-00001 to WP-00010
    'NEXT_AP_ID': apCount + 1,
    'NEXT_HISTORY_ID': apCount + 1,
    'NEXT_REQ_ID': 1,
    'NEXT_FILE_ID': 1,
    'NEXT_REV_ID': 1,
    'NEXT_EVIDENCE_ID': 1,
    'NEXT_LOG_ID': 1,
    'NEXT_SESSION_ID': 1,
    'NEXT_NOTIF_ID': 1
  };
  Object.keys(idCounterResets).forEach(function(key) {
    try {
      setConfigValue(key, idCounterResets[key]);
      report.push('Reset counter ' + key + ' = ' + idCounterResets[key]);
    } catch (e) {
      report.push('Counter reset ' + key + ': ERROR - ' + e.message);
    }
  });

  // ── STEP 8: Rebuild indexes ──
  console.log('Step 7: Rebuilding indexes...');
  try { rebuildWorkPaperIndex(); } catch (e) { console.warn('WP index rebuild:', e); }
  try { rebuildActionPlanIndex(); } catch (e) { console.warn('AP index rebuild:', e); }
  report.push('Indexes rebuilt');

  // ── STEP 9: Re-migrate system tables to Firestore ──
  console.log('Step 8: Syncing system tables to Firestore...');
  [SHEETS.CONFIG, SHEETS.ROLES, SHEETS.PERMISSIONS, SHEETS.AFFILIATES,
   SHEETS.AUDIT_AREAS, SHEETS.SUB_AREAS, SHEETS.EMAIL_TEMPLATES].forEach(function(sn) {
    try {
      migrateSheetToFirestore(sn);
      report.push('Re-synced to Firestore: ' + sn);
    } catch (e) {
      report.push('Firestore sync ' + sn + ': ERROR - ' + e.message);
    }
  });

  // ── DONE ──
  var summary = '=== PURGE & SEED COMPLETE ===\n' + report.join('\n');
  console.log(summary);
  return summary;
}

/**
 * Purge ONLY Firestore (leave Sheets intact) and re-migrate.
 * Useful when Firestore is out of sync with Sheets.
 */
function purgeAndResyncFirestore() {
  if (!isFirestoreEnabled()) {
    throw new Error('Firestore must be enabled.');
  }

  var collections = Object.keys(FIRESTORE_COLLECTIONS);
  var report = [];

  // Purge all Firestore collections
  collections.forEach(function(sheetName) {
    try {
      var count = purgeFirestoreCollection(sheetName);
      report.push('Purged ' + getFirestoreCollection_(sheetName) + ': ' + count + ' docs');
    } catch (e) {
      report.push('Error purging ' + sheetName + ': ' + e.message);
    }
  });

  // Re-migrate everything from Sheets
  var migrationSummary = migrateAllSheetsToFirestore();
  report.push('\n' + migrationSummary);

  var summary = '=== FIRESTORE RESYNC COMPLETE ===\n' + report.join('\n');
  console.log(summary);
  return summary;
}
