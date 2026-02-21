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

  // Let GAS handle form encoding automatically (no explicit contentType)
  var tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant_type:jwt-bearer',
      assertion: jwt
    },
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
