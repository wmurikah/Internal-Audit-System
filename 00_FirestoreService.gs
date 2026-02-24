// 00_FirestoreService.gs - Firestore Integration Layer
// Cloud Firestore is the single source of truth for all data.
// Google Sheets is used only for optional backup (configurable via SHEET_BACKUP_MODE).
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
    if (code === 404) {
      // "Database does not exist" is a fatal config error — throw immediately
      if (text.indexOf('does not exist') !== -1 && text.indexOf('database') !== -1) {
        throw new Error('Firestore database not created. Visit Google Cloud Console > Firestore to create it. Details: ' + text);
      }
      // Normal 404 = single document not found — return null
      return null;
    }
    // All other errors must throw — Firestore is the source of truth,
    // so callers must know when it fails (no silent fallback).
    throw new Error('Firestore HTTP ' + code + ': ' + text);
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
  '02_Permissions':         'permissions',
  '16_AuditLog':            'audit_log',
  '21_NotificationQueue':   'notification_queue',
  '22_EmailTemplates':      'email_templates',
  '24_AuditeeResponses':    'auditee_responses'
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
  '02_Permissions':         'permission_id',
  '16_AuditLog':            'log_id',
  '21_NotificationQueue':   'notification_id',
  '22_EmailTemplates':      'template_code',
  '24_AuditeeResponses':    'response_id'
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
 * ⚠️  This REPLACES the entire document.  If you only need to change a few
 *     fields on an existing document, use firestoreUpdate() instead.
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
 * Partial update: modifies ONLY the specified fields, leaving all others intact.
 * Uses Firestore updateMask so existing fields are never deleted.
 *
 * Use this instead of firestoreSet() when you want to add/change a few fields
 * on an existing document without reading the full document first.
 *
 * @param {string} sheetName - Sheet tab name (e.g., SHEETS.WORK_PAPERS)
 * @param {string} docId - Document ID (primary key value)
 * @param {Object} fields - Key-value pairs to update (only these fields are touched)
 */
function firestoreUpdate(sheetName, docId, fields) {
  if (!isFirestoreEnabled()) return;

  var collection = getFirestoreCollection_(sheetName);
  var fieldNames = Object.keys(fields);
  if (fieldNames.length === 0) return;

  // Build updateMask query string — tells Firestore to only touch these fields
  var maskParams = fieldNames.map(function(f) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(f);
  }).join('&');

  var docPath = collection + '/' + encodeURIComponent(docId) + '?' + maskParams;
  var payload = { fields: objectToFirestoreFields_(fields) };
  firestoreRequest_('patch', docPath, payload);
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

    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + getFirestoreAccessToken_() },
      payload: JSON.stringify({ writes: batchWrites }),
      muteHttpExceptions: true
    });

    var batchCode = response.getResponseCode();
    if (batchCode >= 400) {
      var batchText = response.getContentText();
      throw new Error('Firestore batchWrite failed (HTTP ' + batchCode + '): ' + batchText.substring(0, 300));
    }
  }
}


// ─────────────────────────────────────────────────────────────
// Dual-write helpers (keep Sheets + Firestore in sync)
// ─────────────────────────────────────────────────────────────

/**
 * Sync a record to Firestore (primary) and optionally queue/skip Sheet backup.
 * Called by service files after building the data object.
 * In the current architecture Firestore is the primary store;
 * this function ensures Firestore has the data.
 *
 * @param {string} sheetName - Sheet tab name (e.g., SHEETS.WORK_PAPERS)
 * @param {string} docId - Primary key value
 * @param {Object} data - The full object to persist
 */
function syncToFirestore(sheetName, docId, data) {
  try {
    firestoreSet(sheetName, docId, data);
  } catch (e) {
    console.warn('Firestore sync failed for ' + sheetName + '/' + docId + ':', e.message);
  }
  // In incremental mode, queue this document for the next Sheet batch sync
  if (typeof getSheetBackupMode === 'function' && getSheetBackupMode() === 'incremental') {
    queueBackupChange_(sheetName, docId, 'upsert');
  }
}

/**
 * Delete a record from Firestore and optionally queue/skip Sheet backup.
 */
function deleteFromFirestore(sheetName, docId) {
  try {
    firestoreDelete(sheetName, docId);
  } catch (e) {
    console.warn('Firestore delete failed for ' + sheetName + '/' + docId + ':', e.message);
  }
  // In incremental mode, queue the delete for the next Sheet batch sync
  if (typeof getSheetBackupMode === 'function' && getSheetBackupMode() === 'incremental') {
    queueBackupChange_(sheetName, docId, 'delete');
  }
}

/**
 * Check whether the caller should proceed with a direct Sheet write.
 * Service files can wrap their sheet.appendRow / sheet.getRange().setValues()
 * calls with this check to respect the backup mode.
 *
 * Usage:
 *   if (shouldWriteToSheet()) {
 *     sheet.appendRow(row);
 *   }
 *
 * @return {boolean} true if Sheet writes should happen (realtime mode), false otherwise
 */
function shouldWriteToSheet() {
  if (typeof getSheetBackupMode !== 'function') return true; // Safety fallback
  return getSheetBackupMode() === 'realtime';
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
// Recovery: Restore Firestore from Sheet backup
// ─────────────────────────────────────────────────────────────

/**
 * RECOVERY: Restore work_papers Firestore collection from the Sheet backup.
 *
 * Use this when Firestore work paper documents have been corrupted
 * (e.g. by a partial firestoreSet that replaced full docs with only a few fields).
 *
 * Steps:
 *   1. Purge all docs from the Firestore work_papers collection
 *   2. Re-migrate the full data from the 09_WorkPapers Sheet
 *   3. Safely apply response tracking fields to "Sent to Auditee" WPs
 *      using firestoreUpdate (partial update with updateMask)
 *   4. Invalidate caches
 *
 * RUN: Script Editor → Run → recoverWorkPapersFromSheet
 */
function recoverWorkPapersFromSheet() {
  if (!isFirestoreEnabled()) {
    throw new Error('Firestore not configured');
  }

  var report = [];
  report.push('═══════════════════════════════════════════════════');
  report.push('  WORK PAPERS RECOVERY');
  report.push('  Run: ' + new Date().toLocaleString());
  report.push('═══════════════════════════════════════════════════');

  // ── STEP 1: Purge corrupted Firestore collection ──
  report.push('\n── STEP 1: PURGE CORRUPTED FIRESTORE DOCS ──');
  var purged = purgeFirestoreCollection(SHEETS.WORK_PAPERS);
  report.push('✅ Purged ' + purged + ' corrupted doc(s) from Firestore');

  // ── STEP 2: Re-migrate from Sheet ──
  report.push('\n── STEP 2: RE-MIGRATE FROM SHEET ──');
  var migrated = migrateSheetToFirestore(SHEETS.WORK_PAPERS);
  report.push('✅ Migrated ' + migrated + ' doc(s) from Sheet → Firestore');

  // ── STEP 3: Apply response fields to Sent to Auditee WPs ──
  report.push('\n── STEP 3: APPLY RESPONSE FIELDS (SAFE PARTIAL UPDATE) ──');
  var allWPs = firestoreGetAll(SHEETS.WORK_PAPERS);
  var fixed = 0;

  if (allWPs && allWPs.length > 0) {
    allWPs.forEach(function(wp) {
      if (wp.status === STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
        var wpId = wp.work_paper_id;
        if (!wpId) return;

        // Calculate deadline from sent_to_auditee_date
        var deadlineDays = (typeof RESPONSE_DEFAULTS !== 'undefined' && RESPONSE_DEFAULTS.DEADLINE_DAYS)
          ? RESPONSE_DEFAULTS.DEADLINE_DAYS : 14;
        var sentDate = wp.sent_to_auditee_date ? new Date(wp.sent_to_auditee_date) : new Date();
        var responseDeadline = new Date(sentDate.getTime() + deadlineDays * 24 * 60 * 60 * 1000);

        // Use firestoreUpdate (partial) — NOT firestoreSet (full replace)
        firestoreUpdate(SHEETS.WORK_PAPERS, wpId, {
          response_status: STATUS.RESPONSE.PENDING,
          response_deadline: responseDeadline,
          response_round: 0,
          response_submitted_by: '',
          response_submitted_date: '',
          response_reviewed_by: '',
          response_review_date: '',
          response_review_comments: ''
        });

        var deadlineStr = responseDeadline.toISOString().split('T')[0];
        report.push('  ✅ ' + wpId + ': response_status="Pending Response", deadline=' + deadlineStr);
        fixed++;
      }
    });
  }
  report.push('✅ Applied response fields to ' + fixed + ' Sent to Auditee WP(s)');

  // ── STEP 4: Invalidate caches ──
  report.push('\n── STEP 4: INVALIDATE CACHES ──');
  invalidateSheetData(SHEETS.WORK_PAPERS);
  try { CacheService.getScriptCache().remove('sidebar_counts_all'); } catch (e) {}
  report.push('✅ Caches invalidated');

  // ── STEP 5: Verify ──
  report.push('\n── STEP 5: VERIFY ──');
  var verifyWPs = firestoreGetAll(SHEETS.WORK_PAPERS);
  var totalDocs = verifyWPs ? verifyWPs.length : 0;
  report.push('  Total Firestore docs: ' + totalDocs);

  var schemaFields = SCHEMAS.WORK_PAPERS;
  var allGood = true;

  if (verifyWPs) {
    // Status breakdown
    var statusBreakdown = {};
    var responseBreakdown = {};
    var incomplete = [];

    verifyWPs.forEach(function(wp) {
      var wpId = wp.work_paper_id || '(unknown)';
      var s = wp.status || '(empty)';
      statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;

      var rs = wp.response_status || '(not set)';
      responseBreakdown[rs] = (responseBreakdown[rs] || 0) + 1;

      // Check schema completeness
      var missing = schemaFields.filter(function(f) { return !(f in wp); });
      if (missing.length > 0) {
        incomplete.push(wpId + ' missing ' + missing.length + ' fields');
        allGood = false;
      }
    });

    report.push('\n  WP status breakdown:');
    Object.keys(statusBreakdown).forEach(function(s) {
      report.push('    ' + s + ': ' + statusBreakdown[s]);
    });

    report.push('\n  Response status breakdown:');
    Object.keys(responseBreakdown).forEach(function(rs) {
      report.push('    ' + rs + ': ' + responseBreakdown[rs]);
    });

    if (incomplete.length > 0) {
      report.push('\n  ⚠️ WPs with missing schema fields:');
      incomplete.forEach(function(msg) { report.push('    ' + msg); });
    } else {
      report.push('\n  ✅ All ' + totalDocs + ' WPs have all ' + schemaFields.length + ' schema fields');
    }
  }

  // ── DONE ──
  report.push('\n═══════════════════════════════════════════════════');
  if (allGood && totalDocs === migrated) {
    report.push('  🎉 RECOVERY COMPLETE — All ' + totalDocs + ' work papers restored');
  } else {
    report.push('  ⚠️ RECOVERY DONE — Check warnings above');
  }
  report.push('  Purged: ' + purged + ' | Migrated: ' + migrated + ' | Response fields: ' + fixed);
  report.push('═══════════════════════════════════════════════════');

  var output = report.join('\n');
  console.log(output);
  return output;
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
  var DAY = 86400000;

  // ══════════════════════════════════════════════════════════════
  // STEP 1: Snapshot data we MUST preserve (Users + Roles)
  // ══════════════════════════════════════════════════════════════
  console.log('Step 1: Preserving users and roles...');

  // ── Preserve ALL users (active and inactive) ──
  var usersSheet = getSheet(SHEETS.USERS);
  var usersData = usersSheet.getDataRange().getValues();
  var userHeaders = usersData[0];
  var allUsers = [];
  for (var i = 1; i < usersData.length; i++) {
    var userObj = {};
    for (var j = 0; j < userHeaders.length; j++) {
      if (userHeaders[j]) userObj[userHeaders[j]] = usersData[i][j];
    }
    if (userObj.user_id) allUsers.push(userObj);
  }
  report.push('Users preserved: ' + allUsers.length);

  // ── Preserve Roles (from Sheet since it is the canonical copy) ──
  var rolesSheet = getSheet(SHEETS.ROLES);
  var rolesData = rolesSheet ? rolesSheet.getDataRange().getValues() : [];
  report.push('Roles preserved: ' + Math.max(0, rolesData.length - 1));

  // ══════════════════════════════════════════════════════════════
  // STEP 2: Purge ALL data tables (both Sheets AND Firestore)
  //         Preserve: Users, Roles, Config, Permissions, Affiliates,
  //         Audit Areas, Sub Areas, Email Templates, Field Defs, Workflows
  // ══════════════════════════════════════════════════════════════
  console.log('Step 2: Purging all data tables...');
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
    SHEETS.USERS  // Will re-populate immediately
  ];

  dataTables.forEach(function(tableName) {
    try {
      var sheetRows = purgeSheetData(tableName);
      report.push('Sheet ' + tableName + ': purged ' + sheetRows + ' rows');
    } catch (e) {
      report.push('Sheet ' + tableName + ': SKIP - ' + e.message);
    }
    try {
      var fsDocs = purgeFirestoreCollection(tableName);
      report.push('Firestore ' + getFirestoreCollection_(tableName) + ': purged ' + fsDocs + ' docs');
    } catch (e) {
      report.push('Firestore ' + tableName + ': SKIP - ' + e.message);
    }
  });

  // Invalidate ALL in-memory and script caches
  if (typeof invalidateAllSheetData === 'function') invalidateAllSheetData();
  if (typeof Cache !== 'undefined' && Cache.clearAll) Cache.clearAll();

  // ══════════════════════════════════════════════════════════════
  // STEP 3: Restore Users
  // ══════════════════════════════════════════════════════════════
  console.log('Step 3: Restoring users...');
  if (allUsers.length > 0) {
    var rows = allUsers.map(function(u) { return objectToRow('USERS', u); });
    usersSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    invalidateSheetData(SHEETS.USERS);

    var userWrites = allUsers.map(function(u) {
      return { sheetName: SHEETS.USERS, docId: u.user_id, data: u };
    });
    firestoreBatchWrite(userWrites);
    report.push('Users restored: ' + allUsers.length);
  }
  try { Index.rebuild('USER'); } catch (e) { console.warn('User index rebuild:', e); }

  // ══════════════════════════════════════════════════════════════
  // STEP 4: Gather reference data for seeding
  // ══════════════════════════════════════════════════════════════
  console.log('Step 4: Reading reference data...');
  var affiliates = getSheetData(SHEETS.AFFILIATES);
  var affHeaders = (affiliates && affiliates.length > 0) ? affiliates[0] : [];
  var affCodeIdx = affHeaders.indexOf ? affHeaders.indexOf('affiliate_code') : -1;
  var affiliateCodes = [];
  for (var a = 1; a < (affiliates ? affiliates.length : 0); a++) {
    if (affiliates[a][affCodeIdx]) affiliateCodes.push(affiliates[a][affCodeIdx]);
  }
  if (affiliateCodes.length === 0) affiliateCodes = ['HQ'];

  var areas = getSheetData(SHEETS.AUDIT_AREAS);
  var areaHeaders = (areas && areas.length > 0) ? areas[0] : [];
  var areaIdIdx = areaHeaders.indexOf ? areaHeaders.indexOf('area_id') : -1;
  var areaIds = [];
  for (var b = 1; b < (areas ? areas.length : 0); b++) {
    if (areas[b][areaIdIdx]) areaIds.push(areas[b][areaIdIdx]);
  }
  if (areaIds.length === 0) areaIds = ['AREA-001'];

  var subAreas = getSheetData(SHEETS.SUB_AREAS);
  var saHeaders = (subAreas && subAreas.length > 0) ? subAreas[0] : [];
  var saIdIdx = saHeaders.indexOf ? saHeaders.indexOf('sub_area_id') : -1;
  var subAreaIds = [];
  for (var c = 1; c < (subAreas ? subAreas.length : 0); c++) {
    if (subAreas[c][saIdIdx]) subAreaIds.push(subAreas[c][saIdIdx]);
  }
  if (subAreaIds.length === 0) subAreaIds = ['SA-001'];

  // Categorise users by role
  var activeUsers = allUsers.filter(function(u) {
    var act = u.is_active;
    return act === true || act === 'true' || act === 'TRUE' || act === 1;
  });
  var auditors = activeUsers.filter(function(u) {
    return ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'AUDITOR'].indexOf(u.role_code) >= 0;
  });
  var auditees = activeUsers.filter(function(u) {
    return u.role_code === 'AUDITEE';
  });
  if (auditors.length === 0) auditors = activeUsers.slice(0, 1);
  if (auditees.length === 0) auditees = activeUsers.slice(0, 1);

  // ══════════════════════════════════════════════════════════════
  // STEP 5: Seed 12 Work Papers (realistic status distribution)
  // ══════════════════════════════════════════════════════════════
  console.log('Step 5: Seeding work papers...');
  var wpStatuses = [
    'Draft', 'Draft',
    'Submitted', 'Under Review',
    'Revision Required',
    'Approved', 'Approved',
    'Sent to Auditee', 'Sent to Auditee', 'Sent to Auditee', 'Sent to Auditee', 'Sent to Auditee'
  ];
  var riskRatings = ['High', 'High', 'Medium', 'Medium', 'Medium', 'Low', 'Low', 'High', 'Medium', 'Low', 'High', 'Medium'];
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
    'Petty cash fund not reconciled monthly',
    'Bank reconciliation performed with excessive delays',
    'Payroll processing lacks independent verification'
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
    'Implement daily petty cash reconciliation with surprise counts',
    'Complete bank reconciliation within 5 business days of month-end',
    'Introduce payroll sign-off by both HR and Finance before disbursement'
  ];

  var wpSheet = getSheet(SHEETS.WORK_PAPERS);
  var wpWrites = [];
  var seededWPs = [];

  for (var w = 0; w < 12; w++) {
    var wpId = 'WP-' + String(w + 1).padStart(5, '0');
    var preparer = auditors[w % auditors.length];
    var reviewer = auditors[(w + 1) % auditors.length];
    var auditee = auditees[w % auditees.length];
    var daysAgo = 45 - (w * 3);
    var createdDate = new Date(now.getTime() - daysAgo * DAY);

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
      submitted_date: ['Submitted', 'Under Review', 'Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? new Date(createdDate.getTime() + DAY) : '',
      reviewed_by_id: ['Under Review', 'Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? reviewer.user_id : '',
      reviewed_by_name: ['Under Review', 'Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? (reviewer.full_name || '') : '',
      review_date: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? new Date(createdDate.getTime() + 2 * DAY) : '',
      review_comments: wpStatuses[w] === 'Revision Required' ? 'Please provide more supporting evidence.' : '',
      approved_by_id: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? reviewer.user_id : '',
      approved_by_name: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? (reviewer.full_name || '') : '',
      approved_date: ['Approved', 'Sent to Auditee'].indexOf(wpStatuses[w]) >= 0 ? new Date(createdDate.getTime() + 3 * DAY) : '',
      sent_to_auditee_date: wpStatuses[w] === 'Sent to Auditee' ? new Date(createdDate.getTime() + 4 * DAY) : '',
      created_at: createdDate,
      updated_at: now,
      work_paper_ref: affiliateCodes[w % affiliateCodes.length] + '/WP/' + String(w + 1).padStart(3, '0')
    };

    seededWPs.push(wp);
    wpSheet.appendRow(objectToRow('WORK_PAPERS', wp));
    wpWrites.push({ sheetName: SHEETS.WORK_PAPERS, docId: wpId, data: wp });
  }
  invalidateSheetData(SHEETS.WORK_PAPERS);
  firestoreBatchWrite(wpWrites);
  report.push('Work papers seeded: 12');

  // ══════════════════════════════════════════════════════════════
  // STEP 6: Seed Action Plans (comprehensive status coverage)
  //         Every status is represented so every role and UI view works.
  // ══════════════════════════════════════════════════════════════
  console.log('Step 6: Seeding action plans with full status coverage...');
  var apSheet = getSheet(SHEETS.ACTION_PLANS);
  var apHistSheet = getSheet(SHEETS.AP_HISTORY);
  var apWrites = [];
  var apHistWrites = [];

  // Explicit status list covering EVERY status in the system.
  // Each entry: [status, dueOffset in days from now, has implementation notes, auditor review status]
  var apBlueprints = [
    // ── Active / Actionable ──
    { status: 'Not Due',                dueOffset: 90,  implNotes: '',                             reviewStatus: '' },
    { status: 'Not Due',                dueOffset: 60,  implNotes: '',                             reviewStatus: '' },
    { status: 'Pending',                dueOffset: 14,  implNotes: '',                             reviewStatus: '' },
    { status: 'Pending',                dueOffset: 7,   implNotes: '',                             reviewStatus: '' },
    { status: 'Pending',                dueOffset: 3,   implNotes: '',                             reviewStatus: '' },
    { status: 'In Progress',            dueOffset: 21,  implNotes: 'Working on implementing SoD controls in ERP.', reviewStatus: '' },
    { status: 'In Progress',            dueOffset: 10,  implNotes: 'Vendor checklist drafted, pending management sign-off.', reviewStatus: '' },
    // ── Overdue (past due, not closed) ──
    { status: 'Overdue',                dueOffset: -15, implNotes: '',                             reviewStatus: '' },
    { status: 'Overdue',                dueOffset: -30, implNotes: '',                             reviewStatus: '' },
    { status: 'Overdue',                dueOffset: -7,  implNotes: 'Delayed due to system upgrade.', reviewStatus: '' },
    // ── Implementation in progress ──
    { status: 'Implemented',            dueOffset: 5,   implNotes: 'RBAC deployed and access review completed for Q1.', reviewStatus: '' },
    { status: 'Pending Verification',   dueOffset: -2,  implNotes: 'Controls have been implemented as recommended. Screenshots attached.', reviewStatus: '' },
    { status: 'Pending Verification',   dueOffset: 8,   implNotes: 'Dual approval workflow configured in ERP.', reviewStatus: '' },
    // ── Reviewed / Final ──
    { status: 'Verified',               dueOffset: -20, implNotes: 'Inventory reconciliation automated.', reviewStatus: 'Approved' },
    { status: 'Verified',               dueOffset: -10, implNotes: 'Receipt mandate enforced in expense system.', reviewStatus: 'Approved' },
    { status: 'Rejected',               dueOffset: -5,  implNotes: 'Password policy updated.',      reviewStatus: 'Rejected' },
    { status: 'Closed',                 dueOffset: -45, implNotes: 'Tender committee established and operational.', reviewStatus: 'Approved' },
    { status: 'Closed',                 dueOffset: -60, implNotes: 'Asset custodians assigned, quarterly verification on track.', reviewStatus: 'Approved' },
    { status: 'Not Implemented',        dueOffset: -90, implNotes: 'Management decided to accept the risk.', reviewStatus: '' }
  ];

  var sentWPs = seededWPs.filter(function(wp) { return wp.status === 'Sent to Auditee'; });
  var apCount = 0;
  var histCount = 0;

  for (var bp = 0; bp < apBlueprints.length; bp++) {
    var blueprint = apBlueprints[bp];
    var parentWp = sentWPs[bp % sentWPs.length];
    var apId = 'AP-' + String(apCount + 1).padStart(5, '0');
    var dueDate = new Date(now.getTime() + blueprint.dueOffset * DAY);
    var apOwner = auditees[apCount % auditees.length];
    var daysOvd = blueprint.dueOffset < 0 ? Math.abs(blueprint.dueOffset) : 0;
    // For closed/verified statuses, days_overdue should be 0
    if (['Verified', 'Closed', 'Not Implemented'].indexOf(blueprint.status) >= 0) daysOvd = 0;

    var isImpl = ['Implemented', 'Pending Verification', 'Verified', 'Closed'].indexOf(blueprint.status) >= 0;
    var isVerified = ['Verified', 'Closed'].indexOf(blueprint.status) >= 0;
    var isClosed = blueprint.status === 'Closed';
    var isRejected = blueprint.status === 'Rejected';

    var ap = {
      action_plan_id: apId,
      work_paper_id: parentWp.work_paper_id,
      action_number: bp + 1,
      action_description: recommendations[bp % recommendations.length],
      owner_ids: apOwner.user_id,
      owner_names: apOwner.full_name || '',
      due_date: dueDate,
      status: blueprint.status,
      final_status: isClosed ? 'Closed' : (blueprint.status === 'Not Implemented' ? 'Not Implemented' : ''),
      implementation_notes: blueprint.implNotes,
      implemented_date: isImpl ? new Date(now.getTime() - 5 * DAY) : '',
      auditor_review_status: blueprint.reviewStatus,
      auditor_review_by: (isVerified || isRejected) ? auditors[0].user_id : '',
      auditor_review_date: (isVerified || isRejected) ? new Date(now.getTime() - 3 * DAY) : '',
      auditor_review_comments: isRejected ? 'Evidence provided is insufficient. Please provide system screenshots showing the control in action.' : (isVerified ? 'Implementation verified. Control is operating effectively.' : ''),
      hoa_review_status: isClosed ? 'Approved' : '',
      hoa_review_by: isClosed ? auditors[0].user_id : '',
      hoa_review_date: isClosed ? new Date(now.getTime() - 1 * DAY) : '',
      hoa_review_comments: isClosed ? 'Final review complete. Action plan closed.' : '',
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

    // ── History: creation entry ──
    var histId1 = 'HIST-' + String(++histCount).padStart(5, '0');
    var hist1 = {
      history_id: histId1,
      action_plan_id: apId,
      previous_status: '',
      new_status: 'Not Due',
      comments: 'Action plan created from audit finding',
      user_id: auditors[0].user_id,
      user_name: auditors[0].full_name || '',
      changed_at: parentWp.sent_to_auditee_date || now
    };
    apHistSheet.appendRow(objectToRow('AP_HISTORY', hist1));
    apHistWrites.push({ sheetName: SHEETS.AP_HISTORY, docId: histId1, data: hist1 });

    // ── History: current-status entry (if not the creation status) ──
    if (blueprint.status !== 'Not Due') {
      var histId2 = 'HIST-' + String(++histCount).padStart(5, '0');
      var statusComment = {
        'Pending': 'Due date approaching, status changed to Pending',
        'In Progress': 'Auditee began work on implementation',
        'Overdue': 'Due date passed without implementation',
        'Implemented': 'Auditee marked action plan as implemented',
        'Pending Verification': 'Awaiting auditor verification of implementation',
        'Verified': 'Auditor verified implementation is effective',
        'Rejected': 'Auditor rejected - insufficient evidence provided',
        'Closed': 'HOA final review approved. Action plan closed.',
        'Not Implemented': 'Management accepted risk. Action plan closed as not implemented.'
      };
      var hist2 = {
        history_id: histId2,
        action_plan_id: apId,
        previous_status: 'Not Due',
        new_status: blueprint.status,
        comments: statusComment[blueprint.status] || 'Status updated',
        user_id: isVerified ? auditors[0].user_id : apOwner.user_id,
        user_name: isVerified ? (auditors[0].full_name || '') : (apOwner.full_name || ''),
        changed_at: new Date(now.getTime() - 2 * DAY)
      };
      apHistSheet.appendRow(objectToRow('AP_HISTORY', hist2));
      apHistWrites.push({ sheetName: SHEETS.AP_HISTORY, docId: histId2, data: hist2 });
    }

    apCount++;
  }

  invalidateSheetData(SHEETS.ACTION_PLANS);
  invalidateSheetData(SHEETS.AP_HISTORY);
  firestoreBatchWrite(apWrites);
  firestoreBatchWrite(apHistWrites);
  report.push('Action plans seeded: ' + apCount + ' (covering all ' + Object.keys(STATUS.ACTION_PLAN).length + ' statuses)');
  report.push('AP history records seeded: ' + histCount);

  // ══════════════════════════════════════════════════════════════
  // STEP 7: Reset ID counters
  // ══════════════════════════════════════════════════════════════
  console.log('Step 7: Resetting ID counters...');
  var idCounterResets = {
    'NEXT_WP_ID': 13,
    'NEXT_AP_ID': apCount + 1,
    'NEXT_HISTORY_ID': histCount + 1,
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
      report.push('Counter ' + key + ' = ' + idCounterResets[key]);
    } catch (e) {
      report.push('Counter ' + key + ': ERROR - ' + e.message);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // STEP 8: Rebuild ALL indexes
  // ══════════════════════════════════════════════════════════════
  console.log('Step 8: Rebuilding indexes...');
  try { rebuildWorkPaperIndex(); report.push('Work paper index rebuilt'); } catch (e) { report.push('WP index: ' + e.message); }
  try { rebuildActionPlanIndex(); report.push('Action plan index rebuilt'); } catch (e) { report.push('AP index: ' + e.message); }

  // ══════════════════════════════════════════════════════════════
  // STEP 9: Re-sync system/reference tables to Firestore
  //         This ensures Firestore has clean copies of all config
  // ══════════════════════════════════════════════════════════════
  console.log('Step 9: Syncing system tables to Firestore...');
  [SHEETS.CONFIG, SHEETS.ROLES, SHEETS.PERMISSIONS, SHEETS.AFFILIATES,
   SHEETS.AUDIT_AREAS, SHEETS.SUB_AREAS, SHEETS.EMAIL_TEMPLATES].forEach(function(sn) {
    try {
      migrateSheetToFirestore(sn);
      report.push('Firestore synced: ' + sn);
    } catch (e) {
      report.push('Firestore sync ' + sn + ': ' + e.message);
    }
  });

  // ══════════════════════════════════════════════════════════════
  // STEP 10: Clear all caches so the UI gets fresh data
  // ══════════════════════════════════════════════════════════════
  console.log('Step 10: Clearing all caches...');
  if (typeof invalidateAllSheetData === 'function') invalidateAllSheetData();
  if (typeof Cache !== 'undefined' && Cache.clearAll) Cache.clearAll();
  try {
    var scriptCache = CacheService.getScriptCache();
    scriptCache.remove('sidebar_counts_all');
  } catch (e) {}
  report.push('All caches cleared');

  // ══════════════════════════════════════════════════════════════
  // DONE
  // ══════════════════════════════════════════════════════════════
  var summary = '=== PURGE & RESTRUCTURE COMPLETE ===\n' +
    'Users: ' + allUsers.length + ' | Work Papers: 12 | Action Plans: ' + apCount + ' | History: ' + histCount + '\n\n' +
    report.join('\n');
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


// ─────────────────────────────────────────────────────────────
// Sheet Backup Settings & Incremental Sync
// ─────────────────────────────────────────────────────────────
// Backup modes:
//   'realtime'     – Write to Sheets after every Firestore write (legacy, default)
//   'incremental'  – Queue changes, batch-sync to Sheets periodically
//   'disabled'     – No Sheet writes at all (Firestore-only)

var _backupModeCache = null;

/**
 * Get the current Sheet backup mode from config.
 * Cached in memory for the duration of the execution.
 * @return {string} 'realtime' | 'incremental' | 'disabled'
 */
function getSheetBackupMode() {
  if (_backupModeCache) return _backupModeCache;
  try {
    var mode = getConfigValue('SHEET_BACKUP_MODE');
    _backupModeCache = (mode === 'incremental' || mode === 'disabled') ? mode : 'realtime';
  } catch (e) {
    _backupModeCache = 'realtime';
  }
  return _backupModeCache;
}

/**
 * Check if Sheet backup should happen synchronously (realtime mode).
 */
function isRealtimeBackup() {
  return getSheetBackupMode() === 'realtime';
}

/**
 * Check if Sheet backup is enabled at all (realtime or incremental).
 */
function isSheetBackupEnabled() {
  return getSheetBackupMode() !== 'disabled';
}

/**
 * Perform a Sheet backup write – respects backup mode.
 * In 'realtime' mode, executes the write function immediately.
 * In 'incremental' mode, records the change for later batch sync.
 * In 'disabled' mode, does nothing.
 *
 * @param {string} sheetName  – Sheet tab name (e.g. SHEETS.WORK_PAPERS)
 * @param {string} docId      – Document/record ID
 * @param {string} operation  – 'upsert' or 'delete'
 * @param {Function} writeFn  – Function that performs the actual Sheet write (only called in realtime mode)
 */
function backupToSheet(sheetName, docId, operation, writeFn) {
  var mode = getSheetBackupMode();

  if (mode === 'disabled') return;

  if (mode === 'realtime') {
    try {
      if (typeof writeFn === 'function') writeFn();
    } catch (e) {
      console.warn('Sheet backup failed for ' + sheetName + '/' + docId + ':', e.message);
    }
    return;
  }

  // incremental – queue the change
  queueBackupChange_(sheetName, docId, operation);
}

/**
 * Queue a change for incremental Sheet backup.
 * Writes to Firestore collection '_backup_queue'.
 */
function queueBackupChange_(sheetName, docId, operation) {
  if (!isFirestoreEnabled()) return;
  try {
    var queueId = sheetName + '__' + docId;
    var queueDoc = {
      sheet_name: sheetName,
      doc_id: String(docId),
      operation: operation || 'upsert',
      queued_at: new Date().toISOString()
    };
    firestoreSet({ _collection: '_backup_queue' }, queueId, queueDoc);
  } catch (e) {
    console.warn('Failed to queue backup change:', e.message);
  }
}

// Override firestoreSet routing for internal collections
var _origFirestoreSet = firestoreSet;
/**
 * firestoreSet that handles the _backup_queue pseudo-collection.
 */
firestoreSet = function(sheetName, docId, data) {
  if (sheetName && sheetName._collection) {
    // Internal collection – write directly
    var collection = sheetName._collection;
    var payload = { fields: objectToFirestoreFields_(data) };
    firestoreRequest_('patch', collection + '/' + encodeURIComponent(docId), payload);
    return;
  }
  _origFirestoreSet(sheetName, docId, data);
};

/**
 * Run incremental backup: process the _backup_queue and sync changed records to Sheets.
 * Call this on a schedule (e.g. every 30-60 minutes) or manually from Settings.
 * @return {Object} { success, processed, errors }
 */
function runIncrementalBackup() {
  if (!isFirestoreEnabled()) {
    return { success: false, error: 'Firestore not enabled' };
  }

  var mode = getSheetBackupMode();
  if (mode === 'disabled') {
    return { success: false, error: 'Sheet backup is disabled' };
  }

  var startTime = new Date();
  var processed = 0;
  var errors = [];

  // Read all queued changes
  var queueDocs = firestoreGetAll({ _collection: '_backup_queue' });

  // firestoreGetAll also needs the same override
  if (!queueDocs || queueDocs.length === 0) {
    // No queued changes – update last run timestamp
    setConfigValue('SHEET_BACKUP_LAST_RUN', startTime.toISOString());
    return { success: true, processed: 0, message: 'No changes queued' };
  }

  // Group by sheet for efficient batch processing
  var bySheet = {};
  queueDocs.forEach(function(doc) {
    var sn = doc.sheet_name;
    if (!bySheet[sn]) bySheet[sn] = [];
    bySheet[sn].push(doc);
  });

  Object.keys(bySheet).forEach(function(sheetName) {
    var changes = bySheet[sheetName];
    var sheet = getSheet(sheetName);
    if (!sheet) {
      errors.push('Sheet not found: ' + sheetName);
      return;
    }

    var headers = getSheetHeaders(sheetName);
    var idField = FIRESTORE_DOC_ID_FIELD[sheetName];
    var idIdx = idField ? headers.indexOf(idField) : 0;

    // Read current Sheet data for this sheet (once per sheet)
    var sheetData = sheet.getDataRange().getValues();
    var sheetIdMap = {};
    for (var i = 1; i < sheetData.length; i++) {
      var id = String(sheetData[i][idIdx]);
      if (id) sheetIdMap[id] = i + 1; // row number (1-indexed)
    }

    changes.forEach(function(change) {
      try {
        if (change.operation === 'delete') {
          // Delete from Sheet
          var deleteRow = sheetIdMap[change.doc_id];
          if (deleteRow) {
            sheet.deleteRow(deleteRow);
            // Adjust subsequent row numbers
            Object.keys(sheetIdMap).forEach(function(key) {
              if (sheetIdMap[key] > deleteRow) sheetIdMap[key]--;
            });
            delete sheetIdMap[change.doc_id];
          }
        } else {
          // Upsert: get current data from Firestore and write to Sheet
          var fsDoc = firestoreGet(sheetName, change.doc_id);
          if (fsDoc) {
            var rowArray = headers.map(function(h) {
              var val = fsDoc[h];
              if (val === undefined || val === null) return '';
              return val;
            });

            var existingRow = sheetIdMap[change.doc_id];
            if (existingRow) {
              // Update existing row
              sheet.getRange(existingRow, 1, 1, headers.length).setValues([rowArray]);
            } else {
              // Append new row
              sheet.appendRow(rowArray);
              sheetIdMap[change.doc_id] = sheet.getLastRow();
            }
          }
        }

        // Remove from queue
        firestoreDelete({ _collection: '_backup_queue' }, sheetName + '__' + change.doc_id);
        processed++;
      } catch (e) {
        errors.push(sheetName + '/' + change.doc_id + ': ' + e.message);
      }
    });

    invalidateSheetData(sheetName);
  });

  // Update last run timestamp
  setConfigValue('SHEET_BACKUP_LAST_RUN', startTime.toISOString());

  return {
    success: errors.length === 0,
    processed: processed,
    errors: errors,
    duration: new Date().getTime() - startTime.getTime()
  };
}

// Override firestoreGetAll for internal collections too
var _origFirestoreGetAll = firestoreGetAll;
firestoreGetAll = function(sheetName) {
  if (sheetName && sheetName._collection) {
    if (!isFirestoreEnabled()) return [];
    var collection = sheetName._collection;
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
  return _origFirestoreGetAll(sheetName);
};

// Override firestoreDelete for internal collections too
var _origFirestoreDelete = firestoreDelete;
firestoreDelete = function(sheetName, docId) {
  if (sheetName && sheetName._collection) {
    if (!isFirestoreEnabled()) return;
    var collection = sheetName._collection;
    firestoreRequest_('delete', collection + '/' + encodeURIComponent(docId));
    return;
  }
  _origFirestoreDelete(sheetName, docId);
};

/**
 * Run a full backup: dump all Firestore collections to their corresponding Sheets.
 * Clears existing Sheet data and re-writes from Firestore.
 * Use when switching from 'disabled' back to 'realtime' or 'incremental',
 * or when Sheets are out of sync.
 * @return {Object} { success, report }
 */
function runFullSheetBackup() {
  if (!isFirestoreEnabled()) {
    return { success: false, error: 'Firestore not enabled' };
  }

  var report = [];
  var totalDocs = 0;
  var collections = Object.keys(FIRESTORE_COLLECTIONS);

  collections.forEach(function(sheetName) {
    try {
      var fsDocs = firestoreGetAll(sheetName);
      if (!fsDocs || fsDocs.length === 0) {
        report.push(sheetName + ': 0 docs (skipped)');
        return;
      }

      var sheet = getSheet(sheetName);
      if (!sheet) {
        report.push(sheetName + ': Sheet not found');
        return;
      }

      var headers = getSheetHeaders(sheetName);
      if (!headers || headers.length === 0) {
        report.push(sheetName + ': No headers');
        return;
      }

      // Clear existing data rows (keep header)
      if (sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
        if (sheet.getLastRow() > 1) {
          try { sheet.deleteRows(2, sheet.getLastRow() - 1); } catch (e) {}
        }
      }

      // Build row arrays from Firestore docs
      var rows = fsDocs.map(function(doc) {
        return headers.map(function(h) {
          var val = doc[h];
          if (val === undefined || val === null) return '';
          return val;
        });
      });

      // Batch write
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }

      invalidateSheetData(sheetName);
      totalDocs += rows.length;
      report.push(sheetName + ': ' + rows.length + ' docs');
    } catch (e) {
      report.push(sheetName + ': ERROR - ' + e.message);
    }
  });

  // Clear backup queue (everything is now synced)
  try {
    purgeFirestoreCollection({ _collection: '_backup_queue' });
  } catch (e) {
    report.push('Queue clear: ' + e.message);
  }

  // Override purgeFirestoreCollection for internal collections is not needed
  // since we can just use the queue clear

  setConfigValue('SHEET_BACKUP_LAST_RUN', new Date().toISOString());

  return {
    success: true,
    totalDocs: totalDocs,
    report: report
  };
}

// Override purgeFirestoreCollection for internal collections
var _origPurgeFirestoreCollection = purgeFirestoreCollection;
purgeFirestoreCollection = function(sheetName) {
  if (sheetName && sheetName._collection) {
    if (!isFirestoreEnabled()) return 0;
    var collection = sheetName._collection;
    var deleted = 0;
    var pageToken = null;
    do {
      var url = collection + '?pageSize=300&mask.fieldPaths=__name__';
      if (pageToken) url += '&pageToken=' + pageToken;
      var response = firestoreRequest_('get', url);
      if (!response || !response.documents || response.documents.length === 0) break;
      response.documents.forEach(function(doc) {
        var parts = doc.name.split('/');
        var docId = parts[parts.length - 1];
        firestoreRequest_('delete', collection + '/' + encodeURIComponent(decodeURIComponent(docId)));
        deleted++;
      });
      pageToken = response.nextPageToken || null;
    } while (pageToken);
    return deleted;
  }
  return _origPurgeFirestoreCollection(sheetName);
};

/**
 * Get backup status for the Settings UI.
 * @return {Object} { mode, lastRun, queueSize, firestoreEnabled }
 */
function getBackupStatus() {
  var status = {
    mode: getSheetBackupMode(),
    lastRun: '',
    queueSize: 0,
    firestoreEnabled: isFirestoreEnabled(),
    interval: 60
  };

  try {
    status.lastRun = getConfigValue('SHEET_BACKUP_LAST_RUN') || '';
  } catch (e) {}

  try {
    var interval = parseInt(getConfigValue('SHEET_BACKUP_INTERVAL'));
    if (interval > 0) status.interval = interval;
  } catch (e) {}

  // Count queued changes (only if incremental mode)
  if (status.mode === 'incremental' && isFirestoreEnabled()) {
    try {
      var queueDocs = firestoreGetAll({ _collection: '_backup_queue' });
      status.queueSize = queueDocs ? queueDocs.length : 0;
    } catch (e) {
      status.queueSize = -1;
    }
  }

  return status;
}

/**
 * Save backup settings from the Settings UI.
 * @param {Object} settings - { mode, interval }
 * @return {Object} { success }
 */
function saveBackupSettings(settings) {
  if (!settings) return { success: false, error: 'No settings provided' };

  var validModes = ['realtime', 'incremental', 'disabled'];
  var mode = validModes.indexOf(settings.mode) >= 0 ? settings.mode : 'realtime';

  setConfigValue('SHEET_BACKUP_MODE', mode);
  _backupModeCache = null; // Clear in-memory cache

  if (settings.interval) {
    var interval = parseInt(settings.interval);
    if (interval >= 5 && interval <= 1440) {
      setConfigValue('SHEET_BACKUP_INTERVAL', interval);
    }
  }

  // If switching to incremental, set up the trigger
  if (mode === 'incremental') {
    setupBackupTrigger_();
  } else {
    removeBackupTrigger_();
  }

  return { success: true, mode: mode };
}

/**
 * Set up a time-based trigger for incremental backups.
 */
function setupBackupTrigger_() {
  // Remove existing backup trigger first
  removeBackupTrigger_();

  var interval = parseInt(getConfigValue('SHEET_BACKUP_INTERVAL')) || 60;

  // Google Apps Script minimum trigger interval is 1 minute,
  // but everyMinutes only supports 1, 5, 10, 15, 30
  // For larger intervals, use everyHours
  if (interval >= 60) {
    var hours = Math.max(1, Math.round(interval / 60));
    ScriptApp.newTrigger('runIncrementalBackup')
      .timeBased()
      .everyHours(hours)
      .create();
  } else {
    // Snap to nearest valid minute interval
    var validMinutes = [5, 10, 15, 30];
    var nearestMin = 30;
    for (var i = 0; i < validMinutes.length; i++) {
      if (interval <= validMinutes[i]) { nearestMin = validMinutes[i]; break; }
    }
    ScriptApp.newTrigger('runIncrementalBackup')
      .timeBased()
      .everyMinutes(nearestMin)
      .create();
  }

  console.log('Incremental backup trigger configured (interval: ' + interval + ' min)');
}

/**
 * Remove the incremental backup trigger.
 */
function removeBackupTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runIncrementalBackup') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
