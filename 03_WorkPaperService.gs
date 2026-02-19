// 03_WorkPaperService.gs - Work Paper CRUD, Requirements, Files, Revisions, Workflow

function createWorkPaper(data, user) {
  if (!user) throw new Error('User required');
  if (!canUserPerform(user, 'create', 'WORK_PAPER', null)) {
    throw new Error('Permission denied: Cannot create work papers');
  }
  
  const workPaperId = generateId('WORK_PAPER');
  const now = new Date();
  
  const workPaper = {
    work_paper_id: workPaperId,
    year: data.year || now.getFullYear(),
    affiliate_code: data.affiliate_code || '',
    audit_area_id: data.audit_area_id || '',
    sub_area_id: data.sub_area_id || '',
    work_paper_date: data.work_paper_date || now,
    audit_period_from: data.audit_period_from || '',
    audit_period_to: data.audit_period_to || '',
    control_objectives: sanitizeInput(data.control_objectives || ''),
    control_classification: data.control_classification || '',
    control_type: data.control_type || '',
    control_frequency: data.control_frequency || '',
    control_standards: sanitizeInput(data.control_standards || ''),
    risk_description: sanitizeInput(data.risk_description || ''),
    test_objective: sanitizeInput(data.test_objective || ''),
    testing_steps: sanitizeInput(data.testing_steps || ''),
    observation_title: sanitizeInput(data.observation_title || ''),
    observation_description: sanitizeInput(data.observation_description || ''),
    risk_rating: data.risk_rating || '',
    risk_summary: sanitizeInput(data.risk_summary || ''),
    recommendation: sanitizeInput(data.recommendation || ''),
    management_response: sanitizeInput(data.management_response || ''),
    responsible_ids: data.responsible_ids || '',
    cc_recipients: data.cc_recipients || '',
    status: STATUS.WORK_PAPER.DRAFT,
    final_status: '',
    revision_count: 0,
    prepared_by_id: user.user_id,
    prepared_by_name: user.full_name,
    prepared_date: now,
    submitted_date: '',
    reviewed_by_id: '',
    reviewed_by_name: '',
    review_date: '',
    review_comments: '',
    approved_by_id: '',
    approved_by_name: '',
    approved_date: '',
    sent_to_auditee_date: '',
    created_at: now,
    updated_at: now,
    work_paper_ref: workPaperId
  };

  // Insert into sheet with lock to make appendRow + getLastRow atomic
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  if (!sheet) {
    return { success: false, error: 'Work papers sheet not found' };
  }
  const row = objectToRow('WORK_PAPERS', workPaper);

  const lock = LockService.getScriptLock();
  let rowNum;
  try {
    lock.waitLock(15000);
    sheet.appendRow(row);
    rowNum = sheet.getLastRow();
    lock.releaseLock();
  } catch (lockErr) {
    try { lock.releaseLock(); } catch (ignored) {}
    throw lockErr;
  }

  // Update index
  updateWorkPaperIndex(workPaperId, workPaper, rowNum);
  
  // Log audit event
  logAuditEvent('CREATE', 'WORK_PAPER', workPaperId, null, workPaper, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, workPaperId: workPaperId, workPaper: workPaper });
}

/**
 * Get work paper by ID
 */
function getWorkPaper(workPaperId, includeRelated) {
  if (!workPaperId) return null;
  
  // Try index lookup first
  let workPaper = null;
  if (typeof DB !== 'undefined' && DB.getById) {
    workPaper = DB.getById('WORK_PAPER', workPaperId);
  } else {
    workPaper = getWorkPaperById(workPaperId);
  }
  
  if (!workPaper) return null;
  
  if (includeRelated) {
    workPaper.requirements = getWorkPaperRequirements(workPaperId);
    workPaper.files = getWorkPaperFiles(workPaperId);
    workPaper.revisions = getWorkPaperRevisions(workPaperId);
    workPaper.actionPlans = getActionPlansByWorkPaper(workPaperId);
  }
  
  return sanitizeForClient(workPaper);
}

/**
 * Update work paper
 */
function updateWorkPaper(workPaperId, data, user) {
  if (!user) throw new Error('User required');
  
  const existing = getWorkPaperRaw(workPaperId);
  if (!existing) throw new Error('Work paper not found: ' + workPaperId);

  if (!canUserPerform(user, 'update', 'WORK_PAPER', existing)) {
    throw new Error('Permission denied: Cannot update this work paper');
  }

  // Optimistic locking: reject if record was modified by another user since it was loaded
  if (data._loadedAt && existing.updated_at) {
    var loadedTime = new Date(data._loadedAt).getTime();
    var serverTime = new Date(existing.updated_at).getTime();
    if (serverTime > loadedTime) {
      throw new Error('This record was modified by another user. Please refresh and try again.');
    }
  }

  // Check status - can only edit draft or revision required
  const editableStatuses = [STATUS.WORK_PAPER.DRAFT, STATUS.WORK_PAPER.REVISION_REQUIRED];
  if (!editableStatuses.includes(existing.status)) {
    // Allow specific fields for reviewers even in non-editable status
    const isReviewer = user.role_code === ROLES.SUPER_ADMIN || user.role_code === ROLES.SENIOR_AUDITOR;
    if (!isReviewer) {
      throw new Error('Work paper cannot be edited in current status: ' + existing.status);
    }
  }

  const now = new Date();
  
  // Build update object (only update provided fields)
  const updates = {};
  const editableFields = [
    'year', 'affiliate_code', 'audit_area_id', 'sub_area_id',
    'work_paper_date', 'audit_period_from', 'audit_period_to',
    'control_objectives', 'control_classification', 'control_type', 'control_frequency', 'control_standards',
    'risk_description', 'test_objective', 'testing_steps',
    'observation_title', 'observation_description', 'risk_rating', 'risk_summary', 'recommendation',
    'management_response', 'responsible_ids', 'cc_recipients'
  ];
  
  editableFields.forEach(field => {
    if (data[field] !== undefined) {
      updates[field] = typeof data[field] === 'string' ? sanitizeInput(data[field]) : data[field];
    }
  });
  
  updates.updated_at = now;
  
  // Apply updates to existing
  const updated = { ...existing, ...updates };
  
  // Update sheet
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const rowIndex = existing._rowIndex;
  
  if (!rowIndex) {
    throw new Error('Row index not found for work paper');
  }
  
  const row = objectToRow('WORK_PAPERS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Update index
  updateWorkPaperIndex(workPaperId, updated, rowIndex);
  
  // Log audit event
  logAuditEvent('UPDATE', 'WORK_PAPER', workPaperId, existing, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, workPaper: updated });
}

/**
 * Delete work paper (soft delete or archive)
 */
function deleteWorkPaper(workPaperId, user) {
  if (!user) throw new Error('User required');
  
  const existing = getWorkPaperRaw(workPaperId);
  if (!existing) throw new Error('Work paper not found: ' + workPaperId);
  
  if (!canUserPerform(user, 'delete', 'WORK_PAPER', existing)) {
    throw new Error('Permission denied: Cannot delete this work paper');
  }
  
  // Only allow deletion of drafts
  if (existing.status !== STATUS.WORK_PAPER.DRAFT) {
    throw new Error('Only draft work papers can be deleted');
  }
  
  // Delete the row
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const rowIndex = existing._rowIndex;
  
  if (rowIndex) {
    sheet.deleteRow(rowIndex);
    
    // Remove from index
    removeFromIndex(SHEETS.INDEX_WORK_PAPERS, workPaperId);
    
    // Rebuild indexes for affected rows (rows after deleted one shifted up)
    rebuildWorkPaperIndex();
  }
  
  // Log audit event
  logAuditEvent('DELETE', 'WORK_PAPER', workPaperId, existing, null, user.user_id, user.email);
  
  return { success: true };
}

/**
 * Get work paper by ID without sanitization (for internal use)
 */
function getWorkPaperRaw(workPaperId) {
  if (!workPaperId) return null;
  
  let workPaper = null;
  if (typeof DB !== 'undefined' && DB.getById) {
    workPaper = DB.getById('WORK_PAPER', workPaperId);
  } else {
    workPaper = getWorkPaperById(workPaperId);
  }
  
  return workPaper;
}

function getWorkPapers(filters, user) {
  var results = getWorkPapersRaw(filters, user);
  return sanitizeForClient(applyFieldRestrictions(results, user ? user.role_code : null, 'WORK_PAPER'));
}

/**
 * Get work paper counts by status
 */
function getWorkPaperCounts(filters, user) {
  const workPapers = getWorkPapersRaw(filters, user);

  if (!workPapers || !Array.isArray(workPapers)) {
    console.error('getWorkPaperCounts: Invalid workPapers returned');
    return {
      total: 0,
      byStatus: {},
      byRisk: {},
      byAffiliate: {}
    };
  }

  const counts = {
    total: workPapers.length,
    byStatus: {},
    byRisk: {},
    byAffiliate: {}
  };

  workPapers.forEach(wp => {
    // By status
    const status = wp.status || 'Unknown';
    counts.byStatus[status] = (counts.byStatus[status] || 0) + 1;
    
    // By risk rating
    const risk = wp.risk_rating || 'Not Rated';
    counts.byRisk[risk] = (counts.byRisk[risk] || 0) + 1;
    
    // By affiliate
    const affiliate = wp.affiliate_code || 'Unknown';
    counts.byAffiliate[affiliate] = (counts.byAffiliate[affiliate] || 0) + 1;
  });
  
  return counts;
}

/**
 * Get work papers without sanitization (for internal use)
 */
function getWorkPapersRaw(filters, user) {
  filters = filters || {};

  const sheet = getSheet(SHEETS.WORK_PAPERS);
  if (!sheet) {
    console.error('getWorkPapersRaw: Work Papers sheet not found:', SHEETS.WORK_PAPERS);
    return [];
  }

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    console.log('getWorkPapersRaw: No data in Work Papers sheet');
    return [];
  }

  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  let results = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    if (!row[colMap['work_paper_id']]) continue;
    
    let match = true;
    
    if (filters.year && row[colMap['year']] != filters.year) match = false;
    if (filters.affiliate_code && row[colMap['affiliate_code']] !== filters.affiliate_code) match = false;
    if (filters.audit_area_id && row[colMap['audit_area_id']] !== filters.audit_area_id) match = false;
    if (filters.status && row[colMap['status']] !== filters.status) match = false;
    if (filters.risk_rating && row[colMap['risk_rating']] !== filters.risk_rating) match = false;
    if (filters.prepared_by_id && row[colMap['prepared_by_id']] !== filters.prepared_by_id) match = false;
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const title = String(row[colMap['observation_title']] || '').toLowerCase();
      const desc = String(row[colMap['observation_description']] || '').toLowerCase();
      if (!title.includes(searchLower) && !desc.includes(searchLower)) {
        match = false;
      }
    }
    
    if (user) {
      const roleCode = user.role_code;
      
      if (roleCode === ROLES.AUDITEE) {
        if (row[colMap['status']] !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
          match = false;
        }
        const responsibleIds = String(row[colMap['responsible_ids']] || '').split(',').map(s => s.trim());
        if (!responsibleIds.includes(user.user_id)) {
          match = false;
        }
      }
      
      if (roleCode === ROLES.JUNIOR_STAFF) {
        if (row[colMap['prepared_by_id']] !== user.user_id) {
          match = false;
        }
      }

      // OBSERVER and EXTERNAL_AUDITOR can only see approved/sent work papers
      if (roleCode === ROLES.OBSERVER || roleCode === ROLES.EXTERNAL_AUDITOR) {
        const viewableStatuses = [STATUS.WORK_PAPER.APPROVED, STATUS.WORK_PAPER.SENT_TO_AUDITEE];
        if (!viewableStatuses.includes(row[colMap['status']])) {
          match = false;
        }
      }

      if (user.affiliate_code && roleCode !== ROLES.SUPER_ADMIN && roleCode !== ROLES.SENIOR_AUDITOR) {
        const userAffiliates = parseIdList(user.affiliate_code);
        if (!userAffiliates.includes(row[colMap['affiliate_code']])) {
          match = false;
        }
      }
    }
    
    if (match) {
      const wp = rowToObject(headers, row);
      wp._rowIndex = i + 1;
      results.push(wp);
    }
  }
  
  results.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  
  if (filters.limit) {
    const offset = filters.offset || 0;
    results = results.slice(offset, offset + filters.limit);
  }
  
  return results;
}

function submitWorkPaper(workPaperId, user) {
  if (!user) throw new Error('User required');

  if (!canUserPerform(user, 'create', 'WORK_PAPER', null)) {
    throw new Error('Permission denied: Cannot submit work papers');
  }
  
  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');
  
  // Validate status
  const allowedStatuses = [STATUS.WORK_PAPER.DRAFT, STATUS.WORK_PAPER.REVISION_REQUIRED];
  if (!allowedStatuses.includes(workPaper.status)) {
    throw new Error('Work paper cannot be submitted from status: ' + workPaper.status);
  }
  
  // Validate required fields
  const requiredFields = ['observation_title', 'observation_description', 'risk_rating', 'recommendation'];
  const missing = requiredFields.filter(f => !workPaper[f]);
  if (missing.length > 0) {
    throw new Error('Missing required fields: ' + missing.join(', '));
  }
  
  const now = new Date();
  const updates = {
    status: STATUS.WORK_PAPER.SUBMITTED,
    submitted_date: now,
    updated_at: now
  };
  
  // Update sheet
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const rowIndex = workPaper._rowIndex;
  
  const statusIdx = getColumnIndex('WORK_PAPERS', 'status');
  const submittedIdx = getColumnIndex('WORK_PAPERS', 'submitted_date');
  const updatedIdx = getColumnIndex('WORK_PAPERS', 'updated_at');
  
  sheet.getRange(rowIndex, statusIdx + 1).setValue(updates.status);
  sheet.getRange(rowIndex, submittedIdx + 1).setValue(updates.submitted_date);
  sheet.getRange(rowIndex, updatedIdx + 1).setValue(updates.updated_at);
  
  // Add revision history
  addWorkPaperRevision(workPaperId, 'Submitted', 'Submitted for review', user);
  
  // Update index
  const updated = { ...workPaper, ...updates };
  updateWorkPaperIndex(workPaperId, updated, rowIndex);
  
  // Queue notification to reviewers
  queueReviewNotification(workPaperId, updated, user);
  
  // Log audit event
  logAuditEvent('SUBMIT', 'WORK_PAPER', workPaperId, workPaper, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, workPaper: updated });
}

/**
 * Review work paper (approve, reject, or return for revision)
 */
function reviewWorkPaper(workPaperId, action, comments, user) {
  if (!user) throw new Error('User required');
  
  // Only reviewers can review
  const reviewerRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR];
  if (!reviewerRoles.includes(user.role_code)) {
    throw new Error('Permission denied: Only reviewers can review work papers');
  }
  
  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');
  
  // Validate status
  if (workPaper.status !== STATUS.WORK_PAPER.SUBMITTED && workPaper.status !== STATUS.WORK_PAPER.UNDER_REVIEW) {
    throw new Error('Work paper is not pending review');
  }
  
  const now = new Date();
  const updates = {
    reviewed_by_id: user.user_id,
    reviewed_by_name: user.full_name,
    review_date: now,
    review_comments: sanitizeInput(comments || ''),
    updated_at: now
  };
  
  const transitionMap = {
    approve: {
      from: [STATUS.WORK_PAPER.SUBMITTED, STATUS.WORK_PAPER.UNDER_REVIEW],
      to: STATUS.WORK_PAPER.APPROVED,
      revisionAction: 'Approved'
    },
    reject: {
      from: [STATUS.WORK_PAPER.SUBMITTED, STATUS.WORK_PAPER.UNDER_REVIEW],
      to: STATUS.WORK_PAPER.REVISION_REQUIRED,
      revisionAction: 'Returned for Revision'
    },
    return: {
      from: [STATUS.WORK_PAPER.SUBMITTED, STATUS.WORK_PAPER.UNDER_REVIEW],
      to: STATUS.WORK_PAPER.REVISION_REQUIRED,
      revisionAction: 'Returned for Revision'
    },
    start_review: {
      from: [STATUS.WORK_PAPER.SUBMITTED],
      to: STATUS.WORK_PAPER.UNDER_REVIEW,
      revisionAction: 'Review Started'
    }
  };

  const transition = transitionMap[action];
  if (!transition) {
    throw new Error('Invalid review action: ' + action);
  }
  if (!transition.from.includes(workPaper.status)) {
    throw new Error('Action "' + action + '" is not allowed from status: ' + workPaper.status);
  }

  updates.status = transition.to;
  const revisionAction = transition.revisionAction;

  if (action === 'approve') {
    updates.approved_by_id = user.user_id;
    updates.approved_by_name = user.full_name;
    updates.approved_date = now;
  }
  if (action === 'reject' || action === 'return') {
    updates.revision_count = (workPaper.revision_count || 0) + 1;
  }
  
  // Update sheet
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const rowIndex = workPaper._rowIndex;
  const updated = { ...workPaper, ...updates };
  const row = objectToRow('WORK_PAPERS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Add revision history
  addWorkPaperRevision(workPaperId, revisionAction, comments, user);
  
  // Update index
  updateWorkPaperIndex(workPaperId, updated, rowIndex);
  
  // Queue notification to preparer
  queueStatusNotification(workPaperId, updated, workPaper.status, user);
  
  // Log audit event
  logAuditEvent('REVIEW', 'WORK_PAPER', workPaperId, workPaper, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, workPaper: updated });
}

/**
 * Send work paper to auditee
 */
function sendToAuditee(workPaperId, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');
  
  // Must be approved
  if (workPaper.status !== STATUS.WORK_PAPER.APPROVED) {
    throw new Error('Work paper must be approved before sending to auditee');
  }
  
  // Must have responsible parties
  if (!workPaper.responsible_ids) {
    throw new Error('No responsible parties assigned');
  }
  
  const now = new Date();
  const updates = {
    status: STATUS.WORK_PAPER.SENT_TO_AUDITEE,
    final_status: STATUS.WORK_PAPER.SENT_TO_AUDITEE,
    sent_to_auditee_date: now,
    updated_at: now
  };
  
  // Update sheet
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const rowIndex = workPaper._rowIndex;
  const updated = { ...workPaper, ...updates };
  const row = objectToRow('WORK_PAPERS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Add revision history
  addWorkPaperRevision(workPaperId, 'Sent to Auditee', 'Work paper sent to auditee for response', user);
  
  // Update index
  updateWorkPaperIndex(workPaperId, updated, rowIndex);
  
  // Queue notifications to responsible parties
  queueAuditeeNotification(workPaperId, updated, user);
  
  // Log audit event
  logAuditEvent('SEND_TO_AUDITEE', 'WORK_PAPER', workPaperId, workPaper, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, workPaper: updated });
}

function addWorkPaperRequirement(workPaperId, requirementData, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');
  
  const requirementId = generateId('REQUIREMENT');
  const now = new Date();
  
  // Get next requirement number
  const existing = getWorkPaperRequirements(workPaperId);
  const nextNum = existing.length > 0 ? Math.max(...existing.map(r => r.requirement_number || 0)) + 1 : 1;
  
  const requirement = {
    requirement_id: requirementId,
    work_paper_id: workPaperId,
    requirement_number: nextNum,
    requirement_description: sanitizeInput(requirementData.requirement_description || ''),
    date_requested: requirementData.date_requested || now,
    status: requirementData.status || 'Pending',
    notes: sanitizeInput(requirementData.notes || ''),
    created_at: now,
    created_by: user.user_id
  };
  
  const sheet = getSheet(SHEETS.WP_REQUIREMENTS);
  const row = objectToRow('WP_REQUIREMENTS', requirement);
  sheet.appendRow(row);
  
  logAuditEvent('ADD_REQUIREMENT', 'WORK_PAPER', workPaperId, null, requirement, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, requirementId: requirementId, requirement: requirement });
}

/**
 * Update requirement
 */
function updateWorkPaperRequirement(requirementId, data, user) {
  if (!user) throw new Error('User required');
  
  const sheet = getSheet(SHEETS.WP_REQUIREMENTS);
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idIdx = headers.indexOf('requirement_id');
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === requirementId) {
      const existing = rowToObject(headers, allData[i]);
      
      // Update fields
      const updated = { ...existing };
      if (data.requirement_description !== undefined) updated.requirement_description = sanitizeInput(data.requirement_description);
      if (data.status !== undefined) updated.status = data.status;
      if (data.notes !== undefined) updated.notes = sanitizeInput(data.notes);
      
      const row = objectToRow('WP_REQUIREMENTS', updated);
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      
      logAuditEvent('UPDATE_REQUIREMENT', 'WORK_PAPER', existing.work_paper_id, existing, updated, user.user_id, user.email);
      
      return sanitizeForClient({ success: true, requirement: updated });
    }
  }
  
  throw new Error('Requirement not found: ' + requirementId);
}

/**
 * Delete requirement
 */
function deleteWorkPaperRequirement(requirementId, user) {
  if (!user) throw new Error('User required');
  
  const sheet = getSheet(SHEETS.WP_REQUIREMENTS);
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idIdx = headers.indexOf('requirement_id');
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === requirementId) {
      const existing = rowToObject(headers, allData[i]);
      sheet.deleteRow(i + 1);
      
      logAuditEvent('DELETE_REQUIREMENT', 'WORK_PAPER', existing.work_paper_id, existing, null, user.user_id, user.email);
      
      return { success: true };
    }
  }
  
  throw new Error('Requirement not found: ' + requirementId);
}

function addWorkPaperFile(workPaperId, fileData, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');
  
  const fileId = generateId('FILE');
  const now = new Date();
  
  const file = {
    file_id: fileId,
    work_paper_id: workPaperId,
    file_category: fileData.file_category || 'Supporting Document',
    file_name: sanitizeInput(fileData.file_name || ''),
    file_description: sanitizeInput(fileData.file_description || ''),
    drive_file_id: fileData.drive_file_id || '',
    drive_url: fileData.drive_url || '',
    file_size: fileData.file_size || 0,
    mime_type: fileData.mime_type || '',
    uploaded_by: user.user_id,
    uploaded_at: now
  };
  
  const sheet = getSheet(SHEETS.WP_FILES);
  const row = objectToRow('WP_FILES', file);
  sheet.appendRow(row);
  
  logAuditEvent('ADD_FILE', 'WORK_PAPER', workPaperId, null, file, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, fileId: fileId, file: file });
}

/**
 * Delete file from work paper
 */
function deleteWorkPaperFile(fileId, user) {
  if (!user) throw new Error('User required');
  
  const sheet = getSheet(SHEETS.WP_FILES);
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idIdx = headers.indexOf('file_id');
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === fileId) {
      const existing = rowToObject(headers, allData[i]);
      
      // Optionally delete from Drive
      if (existing.drive_file_id) {
        try {
          DriveApp.getFileById(existing.drive_file_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash Drive file:', e);
        }
      }
      
      sheet.deleteRow(i + 1);
      
      logAuditEvent('DELETE_FILE', 'WORK_PAPER', existing.work_paper_id, existing, null, user.user_id, user.email);
      
      return { success: true };
    }
  }
  
  throw new Error('File not found: ' + fileId);
}

function addWorkPaperRevision(workPaperId, action, comments, user) {
  const revisionId = generateId('REVISION');
  const now = new Date();
  
  // Get next revision number
  const existing = getWorkPaperRevisions(workPaperId);
  const nextNum = existing.length > 0 ? Math.max(...existing.map(r => r.revision_number || 0)) + 1 : 1;
  
  const revision = {
    revision_id: revisionId,
    work_paper_id: workPaperId,
    revision_number: nextNum,
    action: action,
    comments: sanitizeInput(comments || ''),
    changes_summary: '',
    user_id: user.user_id,
    user_name: user.full_name,
    action_date: now
  };
  
  const sheet = getSheet(SHEETS.WP_REVISIONS);
  const row = objectToRow('WP_REVISIONS', revision);
  sheet.appendRow(row);
  
  return revision;
}

function updateWorkPaperIndex(workPaperId, workPaper, rowNumber) {
  const indexSheet = getSheet(SHEETS.INDEX_WORK_PAPERS);
  const data = indexSheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('work_paper_id');
  
  // Check if entry exists
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === workPaperId) {
      // Update existing entry
      const row = buildIndexRow(workPaperId, workPaper, rowNumber);
      indexSheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  
  // Add new entry
  const row = buildIndexRow(workPaperId, workPaper, rowNumber);
  indexSheet.appendRow(row);
}

/**
 * Build index row for work paper
 */
function buildIndexRow(workPaperId, workPaper, rowNumber) {
  return [
    workPaperId,
    rowNumber,
    workPaper.status,
    workPaper.year,
    workPaper.affiliate_code,
    workPaper.audit_area_id,
    workPaper.risk_rating,
    workPaper.prepared_by_id,
    new Date()
  ];
}

/**
 * Remove entry from index
 */
function removeFromIndex(indexSheetName, entityId) {
  const sheet = getSheet(indexSheetName);
  const data = sheet.getDataRange().getValues();
  const idIdx = 0; // ID is always first column
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === entityId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

/**
 * Rebuild entire work paper index
 */
function rebuildWorkPaperIndex() {
  const dataSheet = getSheet(SHEETS.WORK_PAPERS);
  const indexSheet = getSheet(SHEETS.INDEX_WORK_PAPERS);
  
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  
  // Clear existing index (keep headers)
  if (indexSheet.getLastRow() > 1) {
    indexSheet.getRange(2, 1, indexSheet.getLastRow() - 1, indexSheet.getLastColumn()).clearContent();
  }
  
  const indexRows = [];
  const idIdx = headers.indexOf('work_paper_id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx]) {
      const wp = rowToObject(headers, data[i]);
      indexRows.push(buildIndexRow(data[i][idIdx], wp, i + 1));
    }
  }
  
  if (indexRows.length > 0) {
    indexSheet.getRange(2, 1, indexRows.length, indexRows[0].length).setValues(indexRows);
  }
  
  console.log('Rebuilt work paper index:', indexRows.length, 'entries');
  return indexRows.length;
}

function queueReviewNotification(workPaperId, workPaper, submitter) {
  // Get reviewers (Senior Auditors and Head of Audit)
  const users = getUsersDropdown();
  const reviewers = users.filter(u =>
    u.roleCode === ROLES.SENIOR_AUDITOR ||
    u.roleCode === ROLES.SUPER_ADMIN
  );

  // Resolve affiliate name from code for template variable
  var affiliateName = workPaper.affiliate_code || '';
  try {
    var affiliates = getAffiliatesDropdown();
    var match = affiliates.find(function(a) { return a.code === workPaper.affiliate_code; });
    if (match) affiliateName = match.name || match.code;
  } catch (e) { /* keep code as fallback */ }

  reviewers.forEach(reviewer => {
    queueTemplatedEmail('WP_SUBMITTED', reviewer.email, reviewer.id, {
      work_paper_id: workPaperId,
      observation_title: workPaper.observation_title || '',
      submitter_name: submitter.full_name || '',
      submitted_by: submitter.full_name || '',
      status: workPaper.status || '',
      risk_rating: workPaper.risk_rating || '',
      affiliate_name: affiliateName,
      affiliate_code: workPaper.affiliate_code || '',
      recommendation: workPaper.recommendation || '',
      observation_description: workPaper.observation_description || ''
    }, 'WORK_PAPER', workPaperId);
  });
}

/**
 * Queue notification for status change
 */
function queueStatusNotification(workPaperId, workPaper, previousStatus, reviewer) {
  const preparer = getUserById(workPaper.prepared_by_id);
  if (!preparer) return;

  // Resolve affiliate name from code for template variable
  var affiliateName = workPaper.affiliate_code || '';
  try {
    var affiliates = getAffiliatesDropdown();
    var match = affiliates.find(function(a) { return a.code === workPaper.affiliate_code; });
    if (match) affiliateName = match.name || match.code;
  } catch (e) { /* keep code as fallback */ }

  queueTemplatedEmail('WP_STATUS_CHANGE', preparer.email, preparer.user_id, {
    work_paper_id: workPaperId,
    observation_title: workPaper.observation_title || '',
    previous_status: previousStatus || '',
    new_status: workPaper.status || '',
    reviewer_name: reviewer.full_name || '',
    submitted_by: workPaper.prepared_by_name || preparer.full_name || '',
    risk_rating: workPaper.risk_rating || '',
    affiliate_name: affiliateName,
    affiliate_code: workPaper.affiliate_code || '',
    recommendation: workPaper.recommendation || '',
    observation_description: workPaper.observation_description || ''
  }, 'WORK_PAPER', workPaperId);
}

/**
 * Queue notification for auditees — groups by auditee to avoid spam.
 * Collects work papers per auditee and sends ONE batched table email.
 * CC recipients from the work paper's cc_recipients field are included.
 */
function queueAuditeeNotification(workPaperId, workPaper, sender) {
  var responsibleIds = String(workPaper.responsible_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);

  // Collect CC emails from work paper's cc_recipients field
  var ccEmails = String(workPaper.cc_recipients || '').trim() || null;

  responsibleIds.forEach(function(userId) {
    var auditee = getUserById(userId);
    if (auditee && auditee.email) {
      var firstName = auditee.first_name || (auditee.full_name || '').split(' ')[0] || 'Auditee';
      // Send immediately using the batched table format with CC
      // Parameters: workPapers, email, userId, fullName, firstName, ccEmails
      sendBatchedAuditeeNotification([workPaper], auditee.email, auditee.user_id, auditee.full_name, firstName, ccEmails);
    }
  });
}

/**
 * Batch send auditee notifications for multiple work papers at once.
 * Call this when approving/sending multiple WPs to avoid spamming auditees.
 * Groups by auditee and sends ONE email per person with a table of all findings.
 * Collects all unique CC recipients across the batch.
 */
function sendBatchedAuditeeNotifications(workPapers) {
  if (!workPapers || workPapers.length === 0) return;

  // Group by auditee user ID + collect all CC emails
  var byAuditee = {};
  var allCcEmails = {};
  workPapers.forEach(function(wp) {
    var ids = String(wp.responsible_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    ids.forEach(function(userId) {
      if (!byAuditee[userId]) byAuditee[userId] = [];
      byAuditee[userId].push(wp);
    });
    // Collect CC emails from each work paper
    String(wp.cc_recipients || '').split(',').map(function(e) { return e.trim(); }).filter(Boolean).forEach(function(email) {
      allCcEmails[email] = true;
    });
  });

  var ccString = Object.keys(allCcEmails).join(',') || null;

  Object.keys(byAuditee).forEach(function(userId) {
    var auditee = getUserById(userId);
    if (auditee && auditee.email) {
      sendBatchedAuditeeNotification(byAuditee[userId], auditee.email, auditee.user_id, auditee.full_name, auditee.first_name, ccString);
    }
  });
}

/**
 * Add notification to queue
 */
function queueNotification(data) {
  try {
    const notificationId = generateId('NOTIFICATION');
    const now = new Date();
    
    const notification = {
      notification_id: notificationId,
      template_code: data.template_code || '',
      recipient_user_id: data.recipient_user_id || '',
      recipient_email: data.recipient_email || '',
      subject: data.subject || '',
      body: data.body || '',
      module: data.module || '',
      record_id: data.record_id || '',
      status: STATUS.NOTIFICATION.PENDING,
      scheduled_for: data.scheduled_for || now,
      sent_at: '',
      error_message: '',
      created_at: now
    };
    
    const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
    const row = objectToRow('NOTIFICATION_QUEUE', notification);
    sheet.appendRow(row);
    
    return notificationId;
  } catch (e) {
    console.error('Failed to queue notification:', e);
    return null;
  }
}

// sanitizeInput() is defined in 01_Core.gs (canonical)
// sanitizeForClient() is defined in 01_Core.gs (canonical)
