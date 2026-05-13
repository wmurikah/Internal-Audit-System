// 11_DropdownService.gs - Backend CRUD for system dropdown management
// All functions require SUPER_ADMIN role.

/**
 * Verify the user has SUPER_ADMIN role. Throws if not.
 */
function requireSuperAdmin_(user) {
  if (!user || (user.role_code !== 'SUPER_ADMIN' && user.role_code !== 'HEAD_OF_AUDIT')) {
    throw new Error('Permission denied. SUPER_ADMIN or HEAD_OF_AUDIT role required.');
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
    var allConfig = tursoQuery_SQL(
      "SELECT * FROM config WHERE config_key LIKE 'DROPDOWN_%'", []
    );
    return { success: true, items: allConfig };
  }

  var sheetName = DROPDOWN_COLLECTION_MAP[collection];
  if (!sheetName) {
    return { success: false, error: 'Unknown collection: ' + collection };
  }

  var items = tursoGetAll(sheetName);
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
    var existingAreas = tursoGetAll('07_AuditAreas');
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
      is_active: 1,
      display_order: maxOrder + 1
    };
    tursoSet('07_AuditAreas', areaId, areaDoc);
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
    var parentArea = tursoGet('07_AuditAreas', data.area_id);
    if (!parentArea) {
      return { success: false, error: 'Parent audit area not found: ' + data.area_id };
    }
    var existingSubs = tursoGetAll('08_ProcessSubAreas');
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
      is_active: 1,
      display_order: maxSubOrder + 1
    };
    tursoSet('08_ProcessSubAreas', subId, subDoc);
    invalidateDropdownCache();
    return { success: true, item: subDoc };

  } else if (collection === 'affiliates') {
    if (!data.affiliate_code || !data.affiliate_name) {
      return { success: false, error: 'affiliate_code and affiliate_name are required.' };
    }
    // Check if affiliate_code already exists
    var existingAff = tursoGet('06_Affiliates', data.affiliate_code);
    if (existingAff) {
      return { success: false, error: 'Affiliate code already exists: ' + data.affiliate_code };
    }
    var allAffs = tursoGetAll('06_Affiliates');
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
      is_active: 1,
      display_order: maxAffOrder + 1
    };
    tursoSet('06_Affiliates', data.affiliate_code, affDoc);
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

  var existing = tursoGet(sheetName, docId);
  if (!existing) {
    return { success: false, error: 'Document not found: ' + docId };
  }

  // For affiliates, do not allow changing affiliate_code (it's the doc ID)
  if (collection === 'affiliates' && data.affiliate_code && data.affiliate_code !== docId) {
    return { success: false, error: 'Cannot change affiliate_code. It is the document ID.' };
  }

  // For sub_areas, validate new area_id if being changed
  if (collection === 'sub_areas' && data.area_id && data.area_id !== existing.area_id) {
    var newParent = tursoGet('07_AuditAreas', data.area_id);
    if (!newParent) {
      return { success: false, error: 'Parent audit area not found: ' + data.area_id };
    }
  }

  // Merge data into existing document
  var updated = {};
  Object.keys(existing).forEach(function(k) { updated[k] = existing[k]; });
  Object.keys(data).forEach(function(k) { updated[k] = data[k]; });
  updated.updated_at = now;

  tursoSet(sheetName, docId, updated);
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

  var existing = tursoGet(sheetName, docId);
  if (!existing) {
    return { success: false, error: 'Document not found: ' + docId };
  }

  // Count references via SQL
  var references = {};
  if (collection === 'audit_areas') {
    var subAreaCnt = tursoQuery_SQL(
      'SELECT COUNT(*) as cnt FROM sub_areas WHERE area_id = ? AND deleted_at IS NULL', [docId]
    );
    var wpAreaCnt = tursoQuery_SQL(
      'SELECT COUNT(*) as cnt FROM work_papers WHERE audit_area_id = ? AND deleted_at IS NULL', [docId]
    );
    references = {
      sub_areas:   subAreaCnt[0] ? subAreaCnt[0].cnt : 0,
      work_papers: wpAreaCnt[0]  ? wpAreaCnt[0].cnt  : 0
    };

  } else if (collection === 'sub_areas') {
    var wpSubCnt = tursoQuery_SQL(
      'SELECT COUNT(*) as cnt FROM work_papers WHERE sub_area_id = ? AND deleted_at IS NULL', [docId]
    );
    references = { work_papers: wpSubCnt[0] ? wpSubCnt[0].cnt : 0 };

  } else if (collection === 'affiliates') {
    var userCnt = tursoQuery_SQL(
      'SELECT COUNT(*) as cnt FROM users WHERE affiliate_code = ? AND deleted_at IS NULL', [docId]
    );
    var wpAffCnt = tursoQuery_SQL(
      'SELECT COUNT(*) as cnt FROM work_papers WHERE affiliate_code = ? AND deleted_at IS NULL', [docId]
    );
    references = {
      users:       userCnt[0]   ? userCnt[0].cnt   : 0,
      work_papers: wpAffCnt[0]  ? wpAffCnt[0].cnt  : 0
    };
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
  tursoDelete(sheetName, docId);
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

  var updatedCount = 0;
  for (var i = 0; i < orderedIds.length; i++) {
    tursoUpdate(sheetName, orderedIds[i], { display_order: i + 1 });
    updatedCount++;
  }

  invalidateDropdownCache();
  return { success: true, updated: updatedCount };
}

// ─────────────────────────────────────────────────────────────
// Token-authenticated dropdown loaders for direct google.script.run calls
// ─────────────────────────────────────────────────────────────

/**
 * Return active affiliates for the work paper form.
 * Called directly via google.script.run — validates session token.
 */
function getAffiliatesDropdownData(token) {
  var session = getSessionByToken(token);
  if (!session) throw new Error('SESSION_EXPIRED');
  return tursoGetAll('06_Affiliates').filter(function(a) {
    return a.is_active == 1;
  }).sort(function(a, b) {
    return (parseInt(a.display_order) || 0) - (parseInt(b.display_order) || 0);
  });
}

/**
 * Return active audit areas for the work paper form.
 * Called directly via google.script.run — validates session token.
 */
function getAuditAreasDropdownData(token) {
  var session = getSessionByToken(token);
  if (!session) throw new Error('SESSION_EXPIRED');
  return tursoGetAll('07_AuditAreas').filter(function(a) {
    return a.is_active == 1;
  }).sort(function(a, b) {
    return (parseInt(a.display_order) || 0) - (parseInt(b.display_order) || 0);
  });
}

/**
 * Return active sub areas filtered by audit area.
 * Called directly via google.script.run — validates session token.
 */
function getSubAreasDropdownData(token, areaId) {
  var session = getSessionByToken(token);
  if (!session) throw new Error('SESSION_EXPIRED');
  if (!areaId) return [];
  return tursoGetAll('08_ProcessSubAreas').filter(function(s) {
    return s.area_id === areaId && s.is_active == 1;
  }).sort(function(a, b) {
    return (parseInt(a.display_order) || 0) - (parseInt(b.display_order) || 0);
  });
}

/**
 * Return all active users for the work paper form autocomplete.
 * Called directly via google.script.run — validates session token.
 */
function getUsersForWorkPaper(token) {
  var session = getSessionByToken(token);
  if (!session) throw new Error('SESSION_EXPIRED');
  return tursoGetAll('05_Users').filter(function(u) {
    return u.is_active == 1;
  }).map(function(u) {
    return {
      user_id: u.user_id,
      full_name: u.full_name || ((u.first_name || '') + ' ' + (u.last_name || '')).trim() || u.email,
      email: u.email,
      role_code: u.role_code,
      affiliate_code: u.affiliate_code || ''
    };
  });
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

  tursoSetConfig(configKey, JSON.stringify(values), 'GLOBAL');
  invalidateDropdownCache();
  return { success: true, saved: true, configKey: configKey, values: values };
}
