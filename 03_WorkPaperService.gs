/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Work Paper Service v3.0
 * 
 * FILE: 03_WorkPaperService.gs
 * 
 * Provides:
 * - Work paper CRUD operations
 * - Requirements management
 * - File attachments
 * - Revision history
 * - Status workflow
 * - Batch operations
 * 
 * DEPENDS ON: 01_Core.gs, 02_Config.gs
 */

// ============================================================
// WORK PAPER CRUD OPERATIONS
// ============================================================

/**
 * Create a new work paper
 */
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
    work_paper_ref: sanitizeInput(data.work_paper_ref || '')
  };

  // Insert into sheet
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const row = objectToRow('WORK_PAPERS', workPaper);
  sheet.appendRow(row);
  
  // Update index
  const rowNum = sheet.getLastRow();
  updateWorkPaperIndex(workPaperId, workPaper, rowNum);
  
  // Log audit event
  logAuditEvent('CREATE', 'WORK_PAPER', workPaperId, null, workPaper, user.user_id, user.email);
  
  return { success: true, workPaperId: workPaperId, workPaper: workPaper };
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
  
  return workPaper;
}

/**
 * Update work paper
 */
function updateWorkPaper(workPaperId, data, user) {
  if (!user) throw new Error('User required');
  
  const existing = getWorkPaper(workPaperId, false);
  if (!existing) throw new Error('Work paper not found: ' + workPaperId);
  
  if (!canUserPerform(user, 'update', 'WORK_PAPER', existing)) {
    throw new Error('Permission denied: Cannot update this work paper');
  }
  
  // Check status - can only edit draft or revision required
  const editableStatuses = [STATUS.WORK_PAPER.DRAFT, STATUS.WORK_PAPER.REVISION_REQUIRED];
  if (!editableStatuses.includes(existing.status)) {
    // Allow specific fields for reviewers even in non-editable status
    const isReviewer = user.role_code === ROLES.HEAD_OF_AUDIT || user.role_code === ROLES.SENIOR_AUDITOR;
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
    'management_response', 'responsible_ids', 'cc_recipients', 'work_paper_ref'
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
  
  return { success: true, workPaper: updated };
}

/**
 * Delete work paper (soft delete or archive)
 */
function deleteWorkPaper(workPaperId, user) {
  if (!user) throw new Error('User required');
  
  const existing = getWorkPaper(workPaperId, false);
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

// ============================================================
// WORK PAPER LIST & SEARCH
// ============================================================

/**
 * Get work papers with filters
 */
function getWorkPapers(filters, user) {
  filters = filters || {};
  
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // Build column index map
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  let results = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    // Skip empty rows
    if (!row[colMap['work_paper_id']]) continue;
    
    // Apply filters
    let match = true;
    
    if (filters.year && row[colMap['year']] != filters.year) match = false;
    if (filters.affiliate_code && row[colMap['affiliate_code']] !== filters.affiliate_code) match = false;
    if (filters.audit_area_id && row[colMap['audit_area_id']] !== filters.audit_area_id) match = false;
    if (filters.status && row[colMap['status']] !== filters.status) match = false;
    if (filters.risk_rating && row[colMap['risk_rating']] !== filters.risk_rating) match = false;
    if (filters.prepared_by_id && row[colMap['prepared_by_id']] !== filters.prepared_by_id) match = false;
    
    // Search in observation title
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const title = String(row[colMap['observation_title']] || '').toLowerCase();
      const desc = String(row[colMap['observation_description']] || '').toLowerCase();
      if (!title.includes(searchLower) && !desc.includes(searchLower)) {
        match = false;
      }
    }
    
    // Role-based filtering
    if (user) {
      const roleCode = user.role_code;
      
      // Auditees only see work papers sent to them
      if (roleCode === ROLES.AUDITEE) {
        if (row[colMap['status']] !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
          match = false;
        }
        // Check if user is in responsible_ids
        const responsibleIds = String(row[colMap['responsible_ids']] || '').split(',').map(s => s.trim());
        if (!responsibleIds.includes(user.user_id)) {
          match = false;
        }
      }
      
      // Junior staff only see their own work papers
      if (roleCode === ROLES.JUNIOR_STAFF) {
        if (row[colMap['prepared_by_id']] !== user.user_id) {
          match = false;
        }
      }
      
      // Filter by user's affiliate if they have one
      if (user.affiliate_code && roleCode !== ROLES.SUPER_ADMIN && roleCode !== ROLES.HEAD_OF_AUDIT) {
        const userAffiliates = String(user.affiliate_code).split(',').map(s => s.trim());
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
  
  // Sort by date descending
  results.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  
  // Pagination
  if (filters.limit) {
    const offset = filters.offset || 0;
    results = results.slice(offset, offset + filters.limit);
  }
  
  return results;
}

/**
 * Get work paper counts by status
 */
function getWorkPaperCounts(filters, user) {
  const workPapers = getWorkPapers(filters, user);
  
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

// ============================================================
// STATUS WORKFLOW
// ============================================================

/**
 * Submit work paper for review
 */
function submitWorkPaper(workPaperId, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaper(workPaperId, false);
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
  
  return { success: true, workPaper: updated };
}

/**
 * Review work paper (approve, reject, or return for revision)
 */
function reviewWorkPaper(workPaperId, action, comments, user) {
  if (!user) throw new Error('User required');
  
  // Only reviewers can review
  const reviewerRoles = [ROLES.SUPER_ADMIN, ROLES.HEAD_OF_AUDIT, ROLES.SENIOR_AUDITOR];
  if (!reviewerRoles.includes(user.role_code)) {
    throw new Error('Permission denied: Only reviewers can review work papers');
  }
  
  const workPaper = getWorkPaper(workPaperId, false);
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
  
  let revisionAction = '';
  
  switch (action) {
    case 'approve':
      updates.status = STATUS.WORK_PAPER.APPROVED;
      updates.approved_by_id = user.user_id;
      updates.approved_by_name = user.full_name;
      updates.approved_date = now;
      revisionAction = 'Approved';
      break;
      
    case 'reject':
    case 'return':
      updates.status = STATUS.WORK_PAPER.REVISION_REQUIRED;
      updates.revision_count = (workPaper.revision_count || 0) + 1;
      revisionAction = 'Returned for Revision';
      break;
      
    case 'start_review':
      updates.status = STATUS.WORK_PAPER.UNDER_REVIEW;
      revisionAction = 'Review Started';
      break;
      
    default:
      throw new Error('Invalid review action: ' + action);
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
  
  return { success: true, workPaper: updated };
}

/**
 * Send work paper to auditee
 */
function sendToAuditee(workPaperId, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaper(workPaperId, false);
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
  
  return { success: true, workPaper: updated };
}

// ============================================================
// REQUIREMENTS MANAGEMENT
// ============================================================

/**
 * Add requirement to work paper
 */
function addWorkPaperRequirement(workPaperId, requirementData, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaper(workPaperId, false);
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
  
  return { success: true, requirementId: requirementId, requirement: requirement };
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
      
      return { success: true, requirement: updated };
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

// ============================================================
// FILE ATTACHMENTS
// ============================================================

/**
 * Add file to work paper
 */
function addWorkPaperFile(workPaperId, fileData, user) {
  if (!user) throw new Error('User required');
  
  const workPaper = getWorkPaper(workPaperId, false);
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
  
  return { success: true, fileId: fileId, file: file };
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

// ============================================================
// REVISION HISTORY
// ============================================================

/**
 * Add revision entry
 */
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

// ============================================================
// INDEX MANAGEMENT
// ============================================================

/**
 * Update work paper index entry
 */
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

// ============================================================
// NOTIFICATION HELPERS
// ============================================================

/**
 * Queue notification for reviewers
 */
function queueReviewNotification(workPaperId, workPaper, submitter) {
  // Get reviewers (Senior Auditors and Head of Audit)
  const users = getUsersDropdown();
  const reviewers = users.filter(u => 
    u.roleCode === ROLES.SENIOR_AUDITOR || 
    u.roleCode === ROLES.HEAD_OF_AUDIT ||
    u.roleCode === ROLES.SUPER_ADMIN
  );
  
  reviewers.forEach(reviewer => {
    queueNotification({
      template_code: 'WP_SUBMITTED',
      recipient_user_id: reviewer.id,
      recipient_email: reviewer.email,
      subject: 'Work Paper Submitted for Review: ' + workPaper.observation_title,
      body: `Work paper ${workPaperId} has been submitted by ${submitter.full_name} and is ready for your review.`,
      module: 'WORK_PAPER',
      record_id: workPaperId
    });
  });
}

/**
 * Queue notification for status change
 */
function queueStatusNotification(workPaperId, workPaper, previousStatus, reviewer) {
  const preparer = getUserById(workPaper.prepared_by_id);
  if (!preparer) return;
  
  queueNotification({
    template_code: 'WP_STATUS_CHANGE',
    recipient_user_id: preparer.user_id,
    recipient_email: preparer.email,
    subject: 'Work Paper Status Updated: ' + workPaper.observation_title,
    body: `Your work paper ${workPaperId} status has been changed from ${previousStatus} to ${workPaper.status} by ${reviewer.full_name}.`,
    module: 'WORK_PAPER',
    record_id: workPaperId
  });
}

/**
 * Queue notification for auditees
 */
function queueAuditeeNotification(workPaperId, workPaper, sender) {
  const responsibleIds = String(workPaper.responsible_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  
  responsibleIds.forEach(userId => {
    const auditee = getUserById(userId);
    if (auditee) {
      queueNotification({
        template_code: 'WP_SENT_TO_AUDITEE',
        recipient_user_id: auditee.user_id,
        recipient_email: auditee.email,
        subject: 'Audit Finding Requires Your Response: ' + workPaper.observation_title,
        body: `An audit finding has been assigned to you. Please review and respond with action plans.`,
        module: 'WORK_PAPER',
        record_id: workPaperId
      });
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

// ============================================================
// INPUT SANITIZATION
// ============================================================

/**
 * Sanitize user input to prevent formula injection
 */
function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  
  // Remove leading characters that could trigger formula execution
  let sanitized = value;
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r', '\n'];
  
  while (dangerousChars.includes(sanitized.charAt(0))) {
    sanitized = sanitized.substring(1);
  }
  
  // Also escape any remaining formula-like patterns
  sanitized = sanitized.replace(/^=/, "'=");
  
  return sanitized.trim();
}

// ============================================================
// TEST FUNCTION
// ============================================================
function testWorkPaperService() {
  console.log('=== Testing 03_WorkPaperService.gs ===\n');
  
  // Get current user
  const email = Session.getActiveUser().getEmail();
  const user = getUserByEmail(email);
  
  if (!user) {
    console.log('FAIL: Current user not found in database');
    return;
  }
  
  console.log('Testing as user:', user.full_name, '(' + user.role_code + ')');
  
  // Test get work papers
  console.log('\n1. Testing getWorkPapers...');
  try {
    const workPapers = getWorkPapers({ limit: 5 }, user);
    console.log('Work papers found:', workPapers.length);
    console.log('getWorkPapers: PASS');
  } catch (e) {
    console.log('getWorkPapers: FAIL -', e.message);
  }
  
  // Test get counts
  console.log('\n2. Testing getWorkPaperCounts...');
  try {
    const counts = getWorkPaperCounts({}, user);
    console.log('Total work papers:', counts.total);
    console.log('By status:', JSON.stringify(counts.byStatus));
    console.log('getWorkPaperCounts: PASS');
  } catch (e) {
    console.log('getWorkPaperCounts: FAIL -', e.message);
  }
  
  // Test create (only if user has permission)
  console.log('\n3. Testing createWorkPaper...');
  if (canUserPerform(user, 'create', 'WORK_PAPER', null)) {
    try {
      const result = createWorkPaper({
        year: new Date().getFullYear(),
        affiliate_code: 'KE',
        observation_title: 'TEST - Delete Me',
        observation_description: 'This is a test work paper created by testWorkPaperService'
      }, user);
      console.log('Created work paper:', result.workPaperId);
      console.log('createWorkPaper: PASS');
      
      // Clean up - delete the test work paper
      console.log('\n4. Testing deleteWorkPaper...');
      try {
        deleteWorkPaper(result.workPaperId, user);
        console.log('Deleted test work paper');
        console.log('deleteWorkPaper: PASS');
      } catch (e) {
        console.log('deleteWorkPaper: FAIL -', e.message);
      }
    } catch (e) {
      console.log('createWorkPaper: FAIL -', e.message);
    }
  } else {
    console.log('createWorkPaper: SKIPPED (no permission)');
  }
  
  // Test index rebuild
  console.log('\n5. Testing rebuildWorkPaperIndex...');
  try {
    const count = rebuildWorkPaperIndex();
    console.log('Index entries:', count);
    console.log('rebuildWorkPaperIndex: PASS');
  } catch (e) {
    console.log('rebuildWorkPaperIndex: FAIL -', e.message);
  }
  
  console.log('\n=== 03_WorkPaperService.gs Tests Complete ===');
}
