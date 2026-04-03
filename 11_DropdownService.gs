// 11_DropdownService.gs - Backend CRUD for system dropdown management
// All functions require SUPER_ADMIN role.

/**
 * Verify the user has SUPER_ADMIN role. Throws if not.
 */
function requireSuperAdmin_(user) {
  if (!user || user.role_code !== 'SUPER_ADMIN') {
    throw new Error('Permission denied. SUPER_ADMIN role required.');
  }
}

/**
 * Map frontend collection names to Firestore sheet keys.
 */
var DROPDOWN_COLLECTION_MAP = {
  'audit_areas': '07_AuditAreas',
  'sub_areas': '08_ProcessSubAreas',
  'affiliates': '06_Affiliates',
  'config': '00_Config'
};

/**
 * Get all items in a dropdown collection (including inactive) for admin management.
 * @param {Object} params - { collection: 'audit_areas' | 'sub_areas' | 'affiliates' | 'config_dropdown' }
 * @param {Object} user
 */
function getDropdownItems(params, user) {
  requireSuperAdmin_(user);

  var collection = params.collection;

  if (collection === 'config_dropdown') {
    var allConfig = DB.getAll('00_Config');
    var dropdownConfigs = allConfig.filter(function(doc) {
      return doc.config_key && doc.config_key.indexOf('DROPDOWN_') === 0;
    });
    return { success: true, items: dropdownConfigs };
  }

  var sheetName = DROPDOWN_COLLECTION_MAP[collection];
  if (!sheetName) {
    return { success: false, error: 'Unknown collection: ' + collection };
  }

  var items = DB.getAll(sheetName);
  return { success: true, items: items };
}

/**
 * Create a new dropdown item.
 * @param {Object} params - { collection: string, data: object }
 * @param {Object} user
 */
function createDropdownItem(params, user) {
  requireSuperAdmin_(user);

  var collection = params.collection;
  var data = params.data || {};
  var now = new Date().toISOString();

  if (collection === 'audit_areas') {
    if (!data.area_code || !data.area_name) {
      return { success: false, error: 'area_code and area_name are required.' };
    }
    var existingAreas = DB.getAll('07_AuditAreas');
    var maxOrder = 0;
    existingAreas.forEach(function(a) {
      var ord = parseInt(a.display_order) || 0;
      if (ord > maxOrder) maxOrder = ord;
    });
    var areaId = 'AREA' + String(existingAreas.length + 1).padStart(3, '0');
    var areaDoc = {
      area_id: areaId,
      area_code: data.area_code,
      area_name: data.area_name,
      description: data.description || '',
      is_active: 'true',
      display_order: maxOrder + 1
    };
    syncToFirestore('07_AuditAreas', areaId, areaDoc);
    invalidateDropdownCache();
    return { success: true, item: areaDoc };

  } else if (collection === 'sub_areas') {
    if (!data.sub_area_code || !data.sub_area_name) {
      return { success: false, error: 'sub_area_code and sub_area_name are required.' };
    }
    if (!data.area_id) {
      return { success: false, error: 'area_id is required for sub_areas.' };
    }
    // Validate area_id exists
    var parentArea = firestoreGet('07_AuditAreas', data.area_id);
    if (!parentArea) {
      return { success: false, error: 'Parent audit area not found: ' + data.area_id };
    }
    var existingSubs = DB.getAll('08_ProcessSubAreas');
    var maxSubOrder = 0;
    existingSubs.forEach(function(s) {
      var ord = parseInt(s.display_order) || 0;
      if (ord > maxSubOrder) maxSubOrder = ord;
    });
    var subId = 'SUB' + String(existingSubs.length + 1).padStart(4, '0');
    var subDoc = {
      sub_area_id: subId,
      area_id: data.area_id,
      sub_area_code: data.sub_area_code,
      sub_area_name: data.sub_area_name,
      control_objectives: data.control_objectives || '',
      risk_description: data.risk_description || '',
      test_objective: data.test_objective || '',
      testing_steps: data.testing_steps || '',
      is_active: 'true',
      display_order: maxSubOrder + 1
    };
    syncToFirestore('08_ProcessSubAreas', subId, subDoc);
    invalidateDropdownCache();
    return { success: true, item: subDoc };

  } else if (collection === 'affiliates') {
    if (!data.affiliate_code || !data.affiliate_name) {
      return { success: false, error: 'affiliate_code and affiliate_name are required.' };
    }
    // Check if affiliate_code already exists
    var existingAff = firestoreGet('06_Affiliates', data.affiliate_code);
    if (existingAff) {
      return { success: false, error: 'Affiliate code already exists: ' + data.affiliate_code };
    }
    var allAffs = DB.getAll('06_Affiliates');
    var maxAffOrder = 0;
    allAffs.forEach(function(a) {
      var ord = parseInt(a.display_order) || 0;
      if (ord > maxAffOrder) maxAffOrder = ord;
    });
    var affDoc = {
      affiliate_code: data.affiliate_code,
      affiliate_name: data.affiliate_name,
      country: data.country || '',
      region: data.region || '',
      is_active: 'true',
      display_order: maxAffOrder + 1
    };
    syncToFirestore('06_Affiliates', data.affiliate_code, affDoc);
    invalidateDropdownCache();
    return { success: true, item: affDoc };

  } else {
    return { success: false, error: 'Unknown collection: ' + collection };
  }
}

/**
 * Update an existing dropdown item.
 * @param {Object} params - { collection: string, docId: string, data: object }
 * @param {Object} user
 */
function updateDropdownItem(params, user) {
  requireSuperAdmin_(user);

  var collection = params.collection;
  var docId = params.docId;
  var data = params.data || {};
  var now = new Date().toISOString();

  var sheetName = DROPDOWN_COLLECTION_MAP[collection];
  if (!sheetName) {
    return { success: false, error: 'Unknown collection: ' + collection };
  }

  var existing = firestoreGet(sheetName, docId);
  if (!existing) {
    return { success: false, error: 'Document not found: ' + docId };
  }

  // For affiliates, do not allow changing affiliate_code (it's the doc ID)
  if (collection === 'affiliates' && data.affiliate_code && data.affiliate_code !== docId) {
    return { success: false, error: 'Cannot change affiliate_code. It is the document ID.' };
  }

  // For sub_areas, validate new area_id if being changed
  if (collection === 'sub_areas' && data.area_id && data.area_id !== existing.area_id) {
    var newParent = firestoreGet('07_AuditAreas', data.area_id);
    if (!newParent) {
      return { success: false, error: 'Parent audit area not found: ' + data.area_id };
    }
  }

  // Merge data into existing document
  var updated = {};
  Object.keys(existing).forEach(function(k) { updated[k] = existing[k]; });
  Object.keys(data).forEach(function(k) { updated[k] = data[k]; });
  updated.updated_at = now;

  syncToFirestore(sheetName, docId, updated);
  invalidateDropdownCache();
  return { success: true, item: updated };
}

/**
 * Delete a dropdown item (with reference checking).
 * If confirmed !== true, returns reference counts without deleting.
 * @param {Object} params - { collection: string, docId: string, confirmed: boolean }
 * @param {Object} user
 */
function deleteDropdownItem(params, user) {
  requireSuperAdmin_(user);

  var collection = params.collection;
  var docId = params.docId;
  var confirmed = params.confirmed === true;

  var sheetName = DROPDOWN_COLLECTION_MAP[collection];
  if (!sheetName) {
    return { success: false, error: 'Unknown collection: ' + collection };
  }

  var existing = firestoreGet(sheetName, docId);
  if (!existing) {
    return { success: false, error: 'Document not found: ' + docId };
  }

  // Count references
  var references = {};
  if (collection === 'audit_areas') {
    var subAreas = DB.getAll('08_ProcessSubAreas');
    var subAreaRefs = subAreas.filter(function(s) { return s.area_id === docId; }).length;
    var workPapers = DB.getAll('09_WorkPapers');
    var wpRefs = workPapers.filter(function(w) { return w.audit_area_id === docId; }).length;
    references = { sub_areas: subAreaRefs, work_papers: wpRefs };

  } else if (collection === 'sub_areas') {
    var wps = DB.getAll('09_WorkPapers');
    var wpSubRefs = wps.filter(function(w) { return w.sub_area_id === docId; }).length;
    references = { work_papers: wpSubRefs };

  } else if (collection === 'affiliates') {
    var users = DB.getAll('05_Users');
    var userRefs = users.filter(function(u) { return u.affiliate_code === docId; }).length;
    var allWps = DB.getAll('09_WorkPapers');
    var wpAffRefs = allWps.filter(function(w) { return w.affiliate_code === docId; }).length;
    references = { users: userRefs, work_papers: wpAffRefs };
  }

  var totalRefs = 0;
  Object.keys(references).forEach(function(k) { totalRefs += references[k]; });

  if (!confirmed) {
    var message = totalRefs > 0
      ? 'This item is referenced by ' + totalRefs + ' record(s). Deleting it may cause data inconsistencies.'
      : 'No references found. Safe to delete.';
    return { success: true, references: references, totalReferences: totalRefs, message: message };
  }

  // Confirmed deletion
  deleteFromFirestore(sheetName, docId);
  invalidateDropdownCache();
  return { success: true, deleted: true };
}

/**
 * Update the display order of items in a dropdown collection.
 * @param {Object} params - { collection: string, orderedIds: string[] }
 * @param {Object} user
 */
function updateDropdownOrder(params, user) {
  requireSuperAdmin_(user);

  var collection = params.collection;
  var orderedIds = params.orderedIds;

  if (!orderedIds || !Array.isArray(orderedIds)) {
    return { success: false, error: 'orderedIds must be an array.' };
  }

  var sheetName = DROPDOWN_COLLECTION_MAP[collection];
  if (!sheetName) {
    return { success: false, error: 'Unknown collection: ' + collection };
  }

  var writes = [];
  for (var i = 0; i < orderedIds.length; i++) {
    var docId = orderedIds[i];
    var existing = firestoreGet(sheetName, docId);
    if (existing) {
      existing.display_order = i + 1;
      existing.updated_at = new Date().toISOString();
      writes.push({ sheetName: sheetName, docId: docId, data: existing });
    }
  }

  if (writes.length > 0) {
    firestoreBatchWrite(writes);
  }

  invalidateDropdownCache();
  return { success: true, updated: writes.length };
}

/**
 * Save a config-based dropdown (risk ratings, control types, etc.).
 * @param {Object} params - { configKey: string, values: string[] }
 * @param {Object} user
 */
function saveConfigDropdown(params, user) {
  requireSuperAdmin_(user);

  var configKey = params.configKey;
  var values = params.values;

  if (!configKey || configKey.indexOf('DROPDOWN_') !== 0) {
    return { success: false, error: 'configKey must start with DROPDOWN_' };
  }

  if (!values || !Array.isArray(values)) {
    return { success: false, error: 'values must be an array.' };
  }

  var configDoc = {
    config_key: configKey,
    config_value: JSON.stringify(values),
    description: 'Custom dropdown values',
    updated_at: new Date().toISOString()
  };

  syncToFirestore('00_Config', configKey, configDoc);
  Cache.remove('config_all');
  invalidateDropdownCache();
  return { success: true, saved: true, configKey: configKey, values: values };
}
