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
    response_status: '',
    response_deadline: '',
    response_round: 0,
    response_submitted_by: '',
    response_submitted_date: '',
    response_reviewed_by: '',
    response_review_date: '',
    response_review_comments: '',
    created_at: now,
    updated_at: now,
    work_paper_ref: workPaperId
  };

  // Insert into sheet with lock to make appendRow + getLastRow atomic
  const sheet = getSheet(SHEETS.WORK_PAPERS);
  if (!sheet) {
    return { success: false, error: 'Work papers sheet not found' };
  }

  // Firestore is the primary write
  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, workPaper);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Sheet backup (if enabled)
  if (shouldWriteToSheet()) {
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
      console.warn('Sheet backup for work paper create failed:', lockErr.message);
    }
    if (rowNum) {
      updateWorkPaperIndex(workPaperId, workPaper, rowNum);
    }
  }

  // Log audit event
  logAuditEvent('CREATE', 'WORK_PAPER', workPaperId, null, workPaper, user.user_id, user.email);

  return sanitizeForClient({ success: true, workPaperId: workPaperId, workPaper: workPaper });
}

/**
 * Get work paper by ID
 */
function getWorkPaper(workPaperId, includeRelated) {
  if (!workPaperId) return null;

  var workPaper = getWorkPaperById(workPaperId);
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
  
  // Firestore is the primary write
  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updated);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Sheet backup (only if row index is known and backup is enabled)
  const rowIndex = existing._rowIndex;
  if (rowIndex && shouldWriteToSheet()) {
    const sheet = getSheet(SHEETS.WORK_PAPERS);
    const row = objectToRow('WORK_PAPERS', updated);
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    updateWorkPaperIndex(workPaperId, updated, rowIndex);
  }

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

  // Delete from Firestore (primary)
  deleteFromFirestore(SHEETS.WORK_PAPERS, workPaperId);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Delete from Sheet backup (if enabled)
  const rowIndex = existing._rowIndex;
  if (shouldWriteToSheet()) {
    if (rowIndex) {
      const sheet = getSheet(SHEETS.WORK_PAPERS);
      sheet.deleteRow(rowIndex);
    }
    removeFromIndex(SHEETS.INDEX_WORK_PAPERS, workPaperId);
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
  return getWorkPaperById(workPaperId);
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

  var data = getSheetData(SHEETS.WORK_PAPERS);
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
  
  const updated = { ...workPaper, ...updates };

  // Firestore is the primary write
  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updated);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Sheet backup (only if row index is known and backup is enabled)
  const rowIndex = workPaper._rowIndex;
  if (rowIndex && shouldWriteToSheet()) {
    const sheet = getSheet(SHEETS.WORK_PAPERS);
    const statusIdx = getColumnIndex('WORK_PAPERS', 'status');
    const submittedIdx = getColumnIndex('WORK_PAPERS', 'submitted_date');
    const updatedIdx = getColumnIndex('WORK_PAPERS', 'updated_at');
    sheet.getRange(rowIndex, statusIdx + 1).setValue(updates.status);
    sheet.getRange(rowIndex, submittedIdx + 1).setValue(updates.submitted_date);
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(updates.updated_at);
    updateWorkPaperIndex(workPaperId, updated, rowIndex);
  }

  // Add revision history
  addWorkPaperRevision(workPaperId, 'Submitted', 'Submitted for review', user);

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
  
  const updated = { ...workPaper, ...updates };

  // Firestore is the primary write
  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updated);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Sheet backup (only if row index is known and backup is enabled)
  const rowIndex = workPaper._rowIndex;
  if (rowIndex && shouldWriteToSheet()) {
    const sheet = getSheet(SHEETS.WORK_PAPERS);
    const row = objectToRow('WORK_PAPERS', updated);
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    updateWorkPaperIndex(workPaperId, updated, rowIndex);
  }

  // Add revision history
  addWorkPaperRevision(workPaperId, revisionAction, comments, user);

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

  // Calculate response deadline: configurable per WP or default 14 days
  var deadlineDays = RESPONSE_DEFAULTS ? RESPONSE_DEFAULTS.DEADLINE_DAYS : 14;
  var responseDeadline = new Date(now.getTime() + deadlineDays * 24 * 60 * 60 * 1000);

  const updates = {
    status: STATUS.WORK_PAPER.SENT_TO_AUDITEE,
    final_status: STATUS.WORK_PAPER.SENT_TO_AUDITEE,
    sent_to_auditee_date: now,
    response_status: STATUS.RESPONSE.PENDING,
    response_deadline: responseDeadline,
    response_round: 0,
    updated_at: now
  };

  const updated = { ...workPaper, ...updates };

  // Firestore is the primary write
  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updated);

  // Invalidate in-memory cache so subsequent reads (e.g. createActionPlan)
  // see the new SENT_TO_AUDITEE status instead of stale APPROVED status
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Sheet backup (only if row index is known and backup is enabled)
  const rowIndex = workPaper._rowIndex;
  if (rowIndex && shouldWriteToSheet()) {
    const sheet = getSheet(SHEETS.WORK_PAPERS);
    const row = objectToRow('WORK_PAPERS', updated);
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    updateWorkPaperIndex(workPaperId, updated, rowIndex);
  }

  // Add revision history
  addWorkPaperRevision(workPaperId, 'Sent to Auditee', 'Work paper sent to auditee for response', user);

  // ── AUTO-CREATE ACTION PLAN for auditees ──
  // Creates a skeleton action plan so that responsible parties see it
  // immediately in their portal. They fill in their response/action.
  try {
    var existingAPs = getActionPlansByWorkPaperRaw(workPaperId);
    if (existingAPs.length === 0) {
      // Resolve owner names from responsible_ids
      var ownerIds = String(workPaper.responsible_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      var ownerNames = ownerIds.map(function(id) {
        var u = getUserById(id);
        return u ? u.full_name : id;
      }).join(', ');

      // Default due date: 30 days from now
      var defaultDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      createActionPlan({
        work_paper_id: workPaperId,
        action_description: workPaper.recommendation || workPaper.observation_title || 'Respond to audit finding',
        owner_ids: workPaper.responsible_ids,
        owner_names: ownerNames,
        due_date: defaultDue
      }, user);

      console.log('Auto-created action plan for work paper:', workPaperId);
    } else {
      console.log('Action plans already exist for work paper:', workPaperId, '- skipping auto-create');
    }
  } catch (apError) {
    // Non-fatal: log but don't fail the send-to-auditee operation
    console.error('Auto-create action plan failed (non-fatal):', apError.message);
  }

  // Invalidate cached counts so sidebar updates immediately
  try {
    CacheService.getScriptCache().remove('sidebar_counts_all');
  } catch (e) {}

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
  if (shouldWriteToSheet()) {
    sheet.appendRow(row);
  }

  logAuditEvent('ADD_REQUIREMENT', 'WORK_PAPER', workPaperId, null, requirement, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, requirementId: requirementId, requirement: requirement });
}

/**
 * Update requirement
 */
function updateWorkPaperRequirement(requirementId, data, user) {
  if (!user) throw new Error('User required');

  var allData = getSheetData(SHEETS.WP_REQUIREMENTS);
  if (!allData || allData.length < 2) throw new Error('Requirement not found: ' + requirementId);
  var headers = allData[0];
  var idIdx = headers.indexOf('requirement_id');

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === requirementId) {
      const existing = rowToObject(headers, allData[i]);

      // Update fields
      const updated = { ...existing };
      if (data.requirement_description !== undefined) updated.requirement_description = sanitizeInput(data.requirement_description);
      if (data.status !== undefined) updated.status = data.status;
      if (data.notes !== undefined) updated.notes = sanitizeInput(data.notes);

      // Sync to Firestore
      syncToFirestore(SHEETS.WP_REQUIREMENTS, requirementId, updated);

      if (shouldWriteToSheet()) {
        var sheet = getSheet(SHEETS.WP_REQUIREMENTS);
        const row = objectToRow('WP_REQUIREMENTS', updated);
        sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      }
      invalidateSheetData(SHEETS.WP_REQUIREMENTS);

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

  var allData = getSheetData(SHEETS.WP_REQUIREMENTS);
  if (!allData || allData.length < 2) throw new Error('Requirement not found: ' + requirementId);
  var headers = allData[0];
  var idIdx = headers.indexOf('requirement_id');

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === requirementId) {
      const existing = rowToObject(headers, allData[i]);

      // Delete from Firestore
      deleteFromFirestore(SHEETS.WP_REQUIREMENTS, requirementId);

      if (shouldWriteToSheet()) {
        var sheet = getSheet(SHEETS.WP_REQUIREMENTS);
        sheet.deleteRow(i + 1);
      }
      invalidateSheetData(SHEETS.WP_REQUIREMENTS);

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
  if (shouldWriteToSheet()) {
    sheet.appendRow(row);
  }

  logAuditEvent('ADD_FILE', 'WORK_PAPER', workPaperId, null, file, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, fileId: fileId, file: file });
}

/**
 * Delete file from work paper
 */
function deleteWorkPaperFile(fileId, user) {
  if (!user) throw new Error('User required');

  var allData = getSheetData(SHEETS.WP_FILES);
  if (!allData || allData.length < 2) throw new Error('File not found: ' + fileId);
  var headers = allData[0];
  var idIdx = headers.indexOf('file_id');

  for (var i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === fileId) {
      var existing = rowToObject(headers, allData[i]);

      // Optionally delete from Drive
      if (existing.drive_file_id) {
        try {
          DriveApp.getFileById(existing.drive_file_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash Drive file:', e);
        }
      }

      // Delete from Firestore
      deleteFromFirestore(SHEETS.WP_FILES, fileId);

      if (shouldWriteToSheet()) {
        var sheet = getSheet(SHEETS.WP_FILES);
        sheet.deleteRow(i + 1);
      }
      invalidateSheetData(SHEETS.WP_FILES);

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
  if (shouldWriteToSheet()) {
    sheet.appendRow(row);
  }

  return revision;
}

function updateWorkPaperIndex(workPaperId, workPaper, rowNumber) {
  if (!shouldWriteToSheet()) return;
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
  if (!shouldWriteToSheet()) return false;
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
  if (!shouldWriteToSheet()) return;
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

/**
 * Get approved work papers grouped by auditee for the Send Queue UI.
 * Returns all work papers with status "Approved" that have responsible_ids assigned.
 * Groups them by auditee so the UI can show a consolidated table per person.
 */
function getApprovedSendQueue(user) {
  if (!user) throw new Error('User required');

  // Only reviewers/admins can access the send queue
  var reviewerRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR];
  if (!reviewerRoles.includes(user.role_code)) {
    return { success: false, error: 'Permission denied: Only reviewers can access the send queue' };
  }

  var approvedWPs = getWorkPapersRaw({ status: STATUS.WORK_PAPER.APPROVED }, null);

  // Filter to only those with responsible_ids assigned
  approvedWPs = approvedWPs.filter(function(wp) { return wp.responsible_ids; });

  // Build grouped-by-auditee structure
  var byAuditee = {};
  var usersCache = {};

  approvedWPs.forEach(function(wp) {
    var ids = String(wp.responsible_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    ids.forEach(function(userId) {
      if (!byAuditee[userId]) {
        // Resolve auditee info
        if (!usersCache[userId]) {
          var u = getUserById(userId);
          usersCache[userId] = u ? { user_id: u.user_id, email: u.email, full_name: u.full_name } : { user_id: userId, email: '', full_name: userId };
        }
        byAuditee[userId] = { auditee: usersCache[userId], workPapers: [] };
      }
      byAuditee[userId].workPapers.push({
        work_paper_id: wp.work_paper_id,
        observation_title: wp.observation_title || '',
        observation_description: wp.observation_description || '',
        risk_rating: wp.risk_rating || '',
        affiliate_code: wp.affiliate_code || '',
        audit_area_id: wp.audit_area_id || '',
        approved_date: wp.approved_date || '',
        recommendation: wp.recommendation || '',
        cc_recipients: wp.cc_recipients || ''
      });
    });
  });

  // Resolve affiliate and area names for display
  var affiliates = {};
  var areas = {};
  try {
    getAffiliatesDropdown().forEach(function(a) { affiliates[a.code] = a.name; });
    getAuditAreasDropdown().forEach(function(a) { areas[a.id] = a.name; areas[a.code] = a.name; });
  } catch (e) { /* non-fatal */ }

  // Enrich work papers with display names
  Object.keys(byAuditee).forEach(function(userId) {
    byAuditee[userId].workPapers.forEach(function(wp) {
      wp.affiliate_name = affiliates[wp.affiliate_code] || wp.affiliate_code;
      wp.audit_area_name = areas[wp.audit_area_id] || wp.audit_area_id;
    });
  });

  var groups = Object.keys(byAuditee).map(function(k) { return byAuditee[k]; });
  var totalWPs = approvedWPs.length;

  return sanitizeForClient({ success: true, groups: groups, totalWorkPapers: totalWPs });
}

/**
 * Batch send approved work papers to auditees.
 * Accepts an optional list of work paper IDs; if empty/null, sends ALL approved WPs.
 * Groups by auditee and sends ONE combined email per person.
 * Creates action plans, updates statuses, logs events.
 */
function batchSendToAuditees(workPaperIds, user) {
  if (!user) throw new Error('User required');

  var reviewerRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR];
  if (!reviewerRoles.includes(user.role_code)) {
    throw new Error('Permission denied: Only reviewers can batch-send to auditees');
  }

  // Get approved WPs
  var allApproved = getWorkPapersRaw({ status: STATUS.WORK_PAPER.APPROVED }, null);

  // Filter to selected IDs if provided
  var toSend;
  if (workPaperIds && workPaperIds.length > 0) {
    var idSet = {};
    workPaperIds.forEach(function(id) { idSet[id] = true; });
    toSend = allApproved.filter(function(wp) { return idSet[wp.work_paper_id]; });
  } else {
    toSend = allApproved.filter(function(wp) { return wp.responsible_ids; });
  }

  if (toSend.length === 0) {
    return { success: true, sent: 0, message: 'No approved work papers to send' };
  }

  var now = new Date();
  var sheet = getSheet(SHEETS.WORK_PAPERS);
  var sentCount = 0;
  var errors = [];

  // Process each work paper: update status, create action plans
  toSend.forEach(function(wp) {
    try {
      if (!wp.responsible_ids) {
        errors.push(wp.work_paper_id + ': No responsible parties assigned');
        return;
      }

      // Update status to Sent to Auditee
      var batchDeadlineDays = RESPONSE_DEFAULTS ? RESPONSE_DEFAULTS.DEADLINE_DAYS : 14;
      var batchResponseDeadline = new Date(now.getTime() + batchDeadlineDays * 24 * 60 * 60 * 1000);
      var updates = {
        status: STATUS.WORK_PAPER.SENT_TO_AUDITEE,
        final_status: STATUS.WORK_PAPER.SENT_TO_AUDITEE,
        sent_to_auditee_date: now,
        response_status: STATUS.RESPONSE.PENDING,
        response_deadline: batchResponseDeadline,
        response_round: 0,
        updated_at: now
      };

      var updated = {};
      for (var key in wp) { updated[key] = wp[key]; }
      for (var key in updates) { updated[key] = updates[key]; }

      // Firestore is the primary write
      syncToFirestore(SHEETS.WORK_PAPERS, wp.work_paper_id, updated);

      // Sheet backup (only if row index is known and backup is enabled)
      var rowIndex = wp._rowIndex;
      if (rowIndex && shouldWriteToSheet()) {
        var row = objectToRow('WORK_PAPERS', updated);
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
        updateWorkPaperIndex(wp.work_paper_id, updated, rowIndex);
      }

      // Add revision history
      addWorkPaperRevision(wp.work_paper_id, 'Sent to Auditee', 'Batch sent to auditee', user);

      // Auto-create action plan
      try {
        var existingAPs = getActionPlansByWorkPaperRaw(wp.work_paper_id);
        if (existingAPs.length === 0) {
          var ownerIds = String(wp.responsible_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          var ownerNames = ownerIds.map(function(id) {
            var u = getUserById(id);
            return u ? u.full_name : id;
          }).join(', ');

          var defaultDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

          createActionPlan({
            work_paper_id: wp.work_paper_id,
            action_description: wp.recommendation || wp.observation_title || 'Respond to audit finding',
            owner_ids: wp.responsible_ids,
            owner_names: ownerNames,
            due_date: defaultDue
          }, user);
        }
      } catch (apErr) {
        console.error('Auto-create AP failed for', wp.work_paper_id, ':', apErr.message);
      }

      // Log audit event
      logAuditEvent('SEND_TO_AUDITEE', 'WORK_PAPER', wp.work_paper_id, wp, updated, user.user_id, user.email);

      // Store updated WP back for the email step
      wp._updated = updated;
      sentCount++;

    } catch (wpErr) {
      errors.push(wp.work_paper_id + ': ' + wpErr.message);
    }
  });

  // Invalidate caches
  invalidateSheetData(SHEETS.WORK_PAPERS);
  try { CacheService.getScriptCache().remove('sidebar_counts_all'); } catch (e) {}

  // ── SEND BATCHED EMAILS (one per auditee) ──
  var sentWPs = toSend.filter(function(wp) { return wp._updated; }).map(function(wp) { return wp._updated; });
  if (sentWPs.length > 0) {
    sendBatchedAuditeeNotifications(sentWPs);
  }

  return sanitizeForClient({
    success: true,
    sent: sentCount,
    errors: errors.length > 0 ? errors : undefined,
    message: sentCount + ' work paper(s) sent to auditees'
  });
}

// sanitizeInput() is defined in 01_Core.gs (canonical)
// sanitizeForClient() is defined in 01_Core.gs (canonical)
