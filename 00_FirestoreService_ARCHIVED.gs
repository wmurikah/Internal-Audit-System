// ARCHIVED: Replaced by 00_TursoService.gs on 2026-05-06
// Retained for reference. Do not call any function in this file.
// 00_FirestoreService.gs - Firestore Integration Layer (FIRESTORE-ONLY)
// Cloud Firestore is the SOLE data store. Google Sheets removed entirely.
//
// SETUP:
//   1. Create a Firestore database in Native mode (Google Cloud Console).
//   2. Create a service account with "Cloud Datastore User" role.
//   3. Add these Script Properties:
//      - FIRESTORE_PROJECT_ID
//      - FIRESTORE_CLIENT_EMAIL
//      - FIRESTORE_PRIVATE_KEY

// ─────────────────────────────────────────────────────────────
// Auth & HTTP helpers
// ─────────────────────────────────────────────────────────────

var _firestoreTokenCache = null;

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

function getFirestoreConfig_() {
  var props = PropertiesService.getScriptProperties();
  return {
    projectId: props.getProperty('FIRESTORE_PROJECT_ID'),
    clientEmail: props.getProperty('FIRESTORE_CLIENT_EMAIL'),
    privateKey: props.getProperty('FIRESTORE_PRIVATE_KEY')
  };
}

function getFirestoreAccessToken_() {
  if (_firestoreTokenCache && _firestoreTokenCache.expiry > Date.now()) {
    return _firestoreTokenCache.token;
  }

  var config = getFirestoreConfig_();
  if (!config.projectId || !config.clientEmail || !config.privateKey) {
    throw new Error('Firestore credentials not configured.');
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
  var headerEnc = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, '');
  var claimsEnc = Utilities.base64EncodeWebSafe(JSON.stringify(claimSet)).replace(/=+$/, '');
  var toSign = headerEnc + '.' + claimsEnc;

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
    expiry: Date.now() + (tokenData.expires_in - 60) * 1000
  };

  return _firestoreTokenCache.token;
}

function getFirestoreBaseUrl_() {
  var config = getFirestoreConfig_();
  return 'https://firestore.googleapis.com/v1/projects/' +
         config.projectId + '/databases/(default)/documents';
}

function firestoreRequest_(method, path, payload) {
  var url = getFirestoreBaseUrl_() + (path ? '/' + path : '');
  var options = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getFirestoreAccessToken_() },
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
      if (text.indexOf('does not exist') !== -1 && text.indexOf('database') !== -1) {
        throw new Error('Firestore database not created. Details: ' + text);
      }
      return null;
    }
    throw new Error('Firestore HTTP ' + code + ': ' + text);
  }

  return text ? JSON.parse(text) : null;
}


// ─────────────────────────────────────────────────────────────
// Value encoding / decoding
// ─────────────────────────────────────────────────────────────

function toFirestoreValue_(value) {
  if (value === null || value === undefined || value === '') return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(function(v) { return toFirestoreValue_(v); }) } };
  }
  if (typeof value === 'object') {
    var fields = {};
    Object.keys(value).forEach(function(k) {
      if (!k.startsWith('_')) fields[k] = toFirestoreValue_(value[k]);
    });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

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
    Object.keys(fields).forEach(function(k) { obj[k] = fromFirestoreValue_(fields[k]); });
    return obj;
  }
  return null;
}

function objectToFirestoreFields_(obj) {
  var fields = {};
  Object.keys(obj).forEach(function(key) {
    if (!key.startsWith('_')) fields[key] = toFirestoreValue_(obj[key]);
  });
  return fields;
}

function firestoreDocToObject_(doc) {
  if (!doc || !doc.fields) return null;
  var obj = {};
  Object.keys(doc.fields).forEach(function(key) { obj[key] = fromFirestoreValue_(doc.fields[key]); });
  return obj;
}


// ─────────────────────────────────────────────────────────────
// Collection mappings
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
  '02_Permissions':         'permissions',
  '16_AuditLog':            'audit_log',
  '21_NotificationQueue':   'notification_queue',
  '22_EmailTemplates':      'email_templates',
  '24_AuditeeResponses':    'auditee_responses'
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
  '02_Permissions':         'permission_id',
  '16_AuditLog':            'log_id',
  '21_NotificationQueue':   'notification_id',
  '22_EmailTemplates':      'template_code',
  '24_AuditeeResponses':    'response_id'
};

function getFirestoreCollection_(sheetName) {
  return FIRESTORE_COLLECTIONS[sheetName] || sheetName.replace(/^[0-9]+_/, '').toLowerCase();
}


// ─────────────────────────────────────────────────────────────
// CRUD operations
// ─────────────────────────────────────────────────────────────

function firestoreGet(sheetName, docId) {
  if (!isFirestoreEnabled()) return null;
  var collection = getFirestoreCollection_(sheetName);
  var doc = firestoreRequest_('get', collection + '/' + encodeURIComponent(docId));
  return doc ? firestoreDocToObject_(doc) : null;
}

function firestoreGetAll(sheetName) {
  if (!isFirestoreEnabled()) return [];
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

function firestoreQuery(sheetName, field, op, value) {
  if (!isFirestoreEnabled()) return [];
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

function firestoreSet(sheetName, docId, data) {
  if (!isFirestoreEnabled()) return;
  var collection = getFirestoreCollection_(sheetName);
  var payload = { fields: objectToFirestoreFields_(data) };
  firestoreRequest_('patch', collection + '/' + encodeURIComponent(docId), payload);
}

function firestoreUpdate(sheetName, docId, fields) {
  if (!isFirestoreEnabled()) return;
  var collection = getFirestoreCollection_(sheetName);
  var fieldNames = Object.keys(fields);
  if (fieldNames.length === 0) return;
  var maskParams = fieldNames.map(function(f) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(f);
  }).join('&');
  var docPath = collection + '/' + encodeURIComponent(docId) + '?' + maskParams;
  var payload = { fields: objectToFirestoreFields_(fields) };
  firestoreRequest_('patch', docPath, payload);
}

function firestoreDelete(sheetName, docId) {
  if (!isFirestoreEnabled()) return;
  var collection = getFirestoreCollection_(sheetName);
  firestoreRequest_('delete', collection + '/' + encodeURIComponent(docId));
}

function firestoreBatchWrite(writes) {
  if (!isFirestoreEnabled() || !writes || writes.length === 0) return;
  var config = getFirestoreConfig_();
  var baseUrl = 'projects/' + config.projectId + '/databases/(default)/documents';
  var batchSize = 500;
  for (var i = 0; i < writes.length; i += batchSize) {
    var batch = writes.slice(i, i + batchSize);
    var batchWrites = batch.map(function(w) {
      var collection = getFirestoreCollection_(w.sheetName);
      var docPath = baseUrl + '/' + collection + '/' + encodeURIComponent(w.docId);
      return { update: { name: docPath, fields: objectToFirestoreFields_(w.data) } };
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
      throw new Error('Firestore batchWrite failed (HTTP ' + batchCode + '): ' + response.getContentText().substring(0, 300));
    }
  }
}


// ─────────────────────────────────────────────────────────────
// System Settings helpers (counters, dashboard summary)
// ─────────────────────────────────────────────────────────────

function firestoreGetSystemSettings(docId) {
  var doc = firestoreRequest_('get', 'system_settings/' + encodeURIComponent(docId));
  return doc ? firestoreDocToObject_(doc) : null;
}

function firestoreSetSystemSettings(docId, data) {
  var payload = { fields: objectToFirestoreFields_(data) };
  firestoreRequest_('patch', 'system_settings/' + encodeURIComponent(docId), payload);
}

function firestoreUpdateSystemSettings(docId, fields) {
  var fieldNames = Object.keys(fields);
  if (fieldNames.length === 0) return;
  var maskParams = fieldNames.map(function(f) {
    return 'updateMask.fieldPaths=' + encodeURIComponent(f);
  }).join('&');
  var docPath = 'system_settings/' + encodeURIComponent(docId) + '?' + maskParams;
  var payload = { fields: objectToFirestoreFields_(fields) };
  firestoreRequest_('patch', docPath, payload);
}


// ─────────────────────────────────────────────────────────────
// Purge & Recovery utilities (admin use)
// ─────────────────────────────────────────────────────────────

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

function verifyFirestoreHealth() {
  var report = [];
  Object.keys(FIRESTORE_COLLECTIONS).forEach(function(sheetName) {
    var collName = FIRESTORE_COLLECTIONS[sheetName];
    try {
      var docs = firestoreGetAll(sheetName);
      report.push(collName + ': ' + (docs ? docs.length : 0) + ' docs');
    } catch (e) { report.push(collName + ': ERROR - ' + e.message); }
  });
  try {
    var c = firestoreGetSystemSettings('counters');
    report.push('system_settings/counters: ' + (c ? 'OK' : 'MISSING'));
  } catch (e) { report.push('system_settings/counters: ERROR'); }
  try {
    var d = firestoreGetSystemSettings('dashboard_summary');
    report.push('system_settings/dashboard_summary: ' + (d ? 'OK' : 'MISSING'));
  } catch (e) { report.push('system_settings/dashboard_summary: ERROR'); }
  var summary = report.join('\n');
  console.log(summary);
  return summary;
}


// ─────────────────────────────────────────────────────────────
// Legacy write aliases (called by 03_WorkPaperService.gs,
// 04_ActionPlanService.gs, 07_AuthService.gs)
// ─────────────────────────────────────────────────────────────

function syncToFirestore(sheetName, docId, data) {
  firestoreSet(sheetName, docId, data);
}

function deleteFromFirestore(sheetName, docId) {
  firestoreDelete(sheetName, docId);
}
