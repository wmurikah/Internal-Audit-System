// 00_FirestoreService.gs - Firestore Integration Layer
// Provides a fast read/write cache backed by Cloud Firestore (free tier).
// Google Sheets remains the canonical data store; Firestore acts as a
// sub-100ms read cache that is kept in sync on every write.
//
// SETUP:
//   1. Create a Firestore database in Native mode (Google Cloud Console).
//   2. In Apps Script: Project Settings > check "Show appsscript.json manifest"
//   3. Add "https://www.googleapis.com/auth/datastore" to oauthScopes in appsscript.json
//   4. Set FIRESTORE_PROJECT_ID in Script Properties
//   5. Run  testFirestoreConnection()  to verify, then  migrateAllSheetsToFirestore()

// ─────────────────────────────────────────────────────────────
// Auth & HTTP helpers
// ─────────────────────────────────────────────────────────────

var _firestoreTokenCache = null;
var _firestoreDisabled = false; // runtime kill-switch if auth keeps failing

/**
 * Check if Firestore is configured (project ID present in Script Properties)
 */
function isFirestoreEnabled() {
  if (_firestoreDisabled) return false;
  try {
    var props = PropertiesService.getScriptProperties();
    var projectId = props.getProperty('FIRESTORE_PROJECT_ID');
    return !!projectId;
  } catch (e) {
    return false;
  }
}

/**
 * Get Firestore project ID from Script Properties
 */
function getFirestoreProjectId_() {
  return PropertiesService.getScriptProperties().getProperty('FIRESTORE_PROJECT_ID');
}

/**
 * Get an OAuth2 access token for Firestore.
 * Uses ScriptApp.getOAuthToken() which leverages the script owner's credentials
 * with the datastore scope declared in appsscript.json.
 */
function getFirestoreAccessToken_() {
  if (_firestoreTokenCache && _firestoreTokenCache.expiry > Date.now()) {
    return _firestoreTokenCache.token;
  }

  var token = ScriptApp.getOAuthToken();
  if (!token) {
    throw new Error('Failed to get OAuth token. Ensure https://www.googleapis.com/auth/datastore is in appsscript.json oauthScopes.');
  }

  _firestoreTokenCache = {
    token: token,
    expiry: Date.now() + 45 * 60 * 1000  // refresh after 45 min
  };

  return token;
}

/**
 * Base URL for Firestore REST API v1
 */
function getFirestoreBaseUrl_() {
  var projectId = getFirestoreProjectId_();
  return 'https://firestore.googleapis.com/v1/projects/' +
         projectId + '/databases/(default)/documents';
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
    if (code === 404) return null;
    if (code === 403 || code === 401) {
      console.error('Firestore auth error (' + code + '). Check that datastore scope is in appsscript.json and Firestore API is enabled.');
    }
    console.error('Firestore error (' + code + '):', text);
    return null;
  }

  return text ? JSON.parse(text) : null;
}

/**
 * Run this to verify Firestore connection works.
 * Select testFirestoreConnection from the function dropdown and click Run.
 */
function testFirestoreConnection() {
  var projectId = getFirestoreProjectId_();
  if (!projectId) {
    console.log('FAIL: FIRESTORE_PROJECT_ID not set in Script Properties');
    return;
  }
  console.log('Project ID: ' + projectId);

  try {
    var token = ScriptApp.getOAuthToken();
    console.log('OAuth token obtained: ' + (token ? 'YES (' + token.substring(0, 20) + '...)' : 'NO'));
  } catch (e) {
    console.log('FAIL: Could not get OAuth token: ' + e.message);
    console.log('Make sure https://www.googleapis.com/auth/datastore is in appsscript.json oauthScopes');
    return;
  }

  // Try to list documents from a collection
  var url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
            '/databases/(default)/documents/users?pageSize=1';
  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = response.getContentText();
    console.log('Firestore response code: ' + code);
    if (code === 200) {
      console.log('SUCCESS! Firestore connection working.');
      var data = JSON.parse(body);
      console.log('Documents found: ' + (data.documents ? data.documents.length : 0));
    } else if (code === 403) {
      console.log('FAIL: 403 Forbidden. Enable the Firestore API in Google Cloud Console:');
      console.log('https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=' + projectId);
      console.log('Response: ' + body);
    } else if (code === 404) {
      console.log('FAIL: 404 Not Found. Create a Firestore database in Native mode:');
      console.log('https://console.cloud.google.com/firestore?project=' + projectId);
    } else {
      console.log('FAIL: Unexpected response: ' + body);
    }
  } catch (e) {
    console.log('FAIL: Request error: ' + e.message);
  }
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
      if (!k.startsWith('_')) {
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
// CRUD operations (all wrapped in try-catch for graceful fallback)
// ─────────────────────────────────────────────────────────────

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

function getFirestoreCollection_(sheetName) {
  return FIRESTORE_COLLECTIONS[sheetName] || sheetName.replace(/^[0-9]+_/, '').toLowerCase();
}

/**
 * Get a single document by ID. Returns null on any failure (non-fatal).
 */
function firestoreGet(sheetName, docId) {
  if (!isFirestoreEnabled()) return null;
  try {
    var collection = getFirestoreCollection_(sheetName);
    var doc = firestoreRequest_('get', collection + '/' + encodeURIComponent(docId));
    return doc ? firestoreDocToObject_(doc) : null;
  } catch (e) {
    console.warn('firestoreGet failed for ' + sheetName + '/' + docId + ':', e.message);
    _firestoreDisabled = true; // stop trying for this execution
    return null;
  }
}

/**
 * Get all documents in a collection. Returns null on any failure (non-fatal).
 */
function firestoreGetAll(sheetName) {
  if (!isFirestoreEnabled()) return null;
  try {
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
  } catch (e) {
    console.warn('firestoreGetAll failed for ' + sheetName + ':', e.message);
    _firestoreDisabled = true;
    return null;
  }
}

/**
 * Query documents by a field value. Returns empty array on failure (non-fatal).
 */
function firestoreQuery(sheetName, field, op, value) {
  if (!isFirestoreEnabled()) return null;
  try {
    var collection = getFirestoreCollection_(sheetName);
    var projectId = getFirestoreProjectId_();

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
              projectId + '/databases/(default)/documents:runQuery';

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
  } catch (e) {
    console.warn('firestoreQuery failed:', e.message);
    _firestoreDisabled = true;
    return null;
  }
}

/**
 * Write a single document. Non-fatal on failure.
 */
function firestoreSet(sheetName, docId, data) {
  if (!isFirestoreEnabled()) return;
  try {
    var collection = getFirestoreCollection_(sheetName);
    var payload = { fields: objectToFirestoreFields_(data) };
    firestoreRequest_('patch', collection + '/' + encodeURIComponent(docId), payload);
  } catch (e) {
    console.warn('firestoreSet failed for ' + sheetName + '/' + docId + ':', e.message);
  }
}

/**
 * Delete a single document. Non-fatal on failure.
 */
function firestoreDelete(sheetName, docId) {
  if (!isFirestoreEnabled()) return;
  try {
    var collection = getFirestoreCollection_(sheetName);
    firestoreRequest_('delete', collection + '/' + encodeURIComponent(docId));
  } catch (e) {
    console.warn('firestoreDelete failed for ' + sheetName + '/' + docId + ':', e.message);
  }
}

/**
 * Batch write multiple documents (max 500 per batch). Non-fatal on failure.
 */
function firestoreBatchWrite(writes) {
  if (!isFirestoreEnabled() || !writes || writes.length === 0) return;

  var projectId = getFirestoreProjectId_();
  var baseUrl = 'projects/' + projectId + '/databases/(default)/documents';
  var token = getFirestoreAccessToken_();

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
              projectId + '/databases/(default)/documents:batchWrite';

    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ writes: batchWrites }),
      muteHttpExceptions: true
    });
  }
}


// ─────────────────────────────────────────────────────────────
// Dual-write helpers (keep Sheets + Firestore in sync)
// ─────────────────────────────────────────────────────────────

function syncToFirestore(sheetName, docId, data) {
  try {
    firestoreSet(sheetName, docId, data);
  } catch (e) {
    console.warn('Firestore sync failed for ' + sheetName + '/' + docId + ':', e.message);
  }
}

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

function migrateAllSheetsToFirestore() {
  if (!isFirestoreEnabled()) {
    throw new Error('Firestore is not configured. Add FIRESTORE_PROJECT_ID to Script Properties first.');
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

function verifyFirestoreMigration() {
  if (!isFirestoreEnabled()) return 'Firestore not configured';

  var sheetsToCheck = [
    SHEETS.USERS, SHEETS.WORK_PAPERS, SHEETS.ACTION_PLANS
  ];

  var report = [];

  sheetsToCheck.forEach(function(sheetName) {
    var sheet = getSheet(sheetName);
    var sheetRows = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
    var fsDocs = firestoreGetAll(sheetName);
    var fsCount = fsDocs ? fsDocs.length : 0;

    var status = sheetRows === fsCount ? 'OK' : 'MISMATCH';
    report.push(sheetName + ': Sheet=' + sheetRows + ' Firestore=' + fsCount + ' [' + status + ']');
  });

  var summary = 'Verification:\n' + report.join('\n');
  console.log(summary);
  return summary;
}
