// 04_ActionPlanService.gs - Action Plan CRUD, Workflow, Evidence, History

function createActionPlan(data, user) {
  if (!user) throw new Error('User required');
  if (!canUserPerform(user, 'create', 'ACTION_PLAN', null)) {
    throw new Error('Permission denied: Cannot create action plans');
  }
  
  if (!data.work_paper_id) {
    throw new Error('Work paper ID is required');
  }
  
  // Verify work paper exists and is sent to auditee
  const workPaper = getWorkPaperById(data.work_paper_id);
  if (!workPaper) {
    throw new Error('Work paper not found: ' + data.work_paper_id);
  }
  
  const actionPlanId = generateId('ACTION_PLAN');
  const now = new Date();
  
  // Get next action number for this work paper
  const existingPlans = getActionPlansByWorkPaperRaw(data.work_paper_id);
  const nextNum = existingPlans.length > 0 ? Math.max(...existingPlans.map(p => p.action_number || 0)) + 1 : 1;
  
  // Calculate initial status based on due date
  let initialStatus = STATUS.ACTION_PLAN.NOT_DUE;
  if (data.due_date) {
    const dueDate = new Date(data.due_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate <= today) {
      initialStatus = STATUS.ACTION_PLAN.PENDING;
    }
  }
  
  const actionPlan = {
    action_plan_id: actionPlanId,
    work_paper_id: data.work_paper_id,
    action_number: nextNum,
    action_description: sanitizeInput(data.action_description || ''),
    owner_ids: data.owner_ids || '',
    owner_names: data.owner_names || '',
    due_date: data.due_date || '',
    status: initialStatus,
    final_status: '',
    implementation_notes: '',
    implemented_date: '',
    auditor_review_status: '',
    auditor_review_by: '',
    auditor_review_date: '',
    auditor_review_comments: '',
    hoa_review_status: '',
    hoa_review_by: '',
    hoa_review_date: '',
    hoa_review_comments: '',
    days_overdue: 0,
    created_at: now,
    created_by: user.user_id,
    updated_at: now,
    updated_by: user.user_id
  };
  
  // Insert into sheet
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const row = objectToRow('ACTION_PLANS', actionPlan);
  sheet.appendRow(row);
  
  // Update index
  const rowNum = sheet.getLastRow();
  updateActionPlanIndex(actionPlanId, actionPlan, rowNum);
  
  // Add history entry
  addActionPlanHistory(actionPlanId, '', initialStatus, 'Action plan created', user);
  
  // Log audit event
  logAuditEvent('CREATE', 'ACTION_PLAN', actionPlanId, null, actionPlan, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, actionPlanId: actionPlanId, actionPlan: actionPlan });
}

/**
 * Create multiple action plans at once
 */
function createActionPlansBatch(workPaperId, plansData, user) {
  if (!user) throw new Error('User required');
  if (!Array.isArray(plansData) || plansData.length === 0) {
    throw new Error('Plans data array is required');
  }
  
  const results = [];
  const ids = generateIds('ACTION_PLAN', plansData.length);
  
  const existingPlans = getActionPlansByWorkPaperRaw(workPaperId);
  let nextNum = existingPlans.length > 0 ? Math.max(...existingPlans.map(p => p.action_number || 0)) + 1 : 1;
  
  const now = new Date();
  const rows = [];
  
  plansData.forEach((data, idx) => {
    let initialStatus = STATUS.ACTION_PLAN.NOT_DUE;
    if (data.due_date) {
      const dueDate = new Date(data.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate <= today) {
        initialStatus = STATUS.ACTION_PLAN.PENDING;
      }
    }
    
    const actionPlan = {
      action_plan_id: ids[idx],
      work_paper_id: workPaperId,
      action_number: nextNum++,
      action_description: sanitizeInput(data.action_description || ''),
      owner_ids: data.owner_ids || '',
      owner_names: data.owner_names || '',
      due_date: data.due_date || '',
      status: initialStatus,
      final_status: '',
      implementation_notes: '',
      implemented_date: '',
      auditor_review_status: '',
      auditor_review_by: '',
      auditor_review_date: '',
      auditor_review_comments: '',
      hoa_review_status: '',
      hoa_review_by: '',
      hoa_review_date: '',
      hoa_review_comments: '',
      days_overdue: 0,
      created_at: now,
      created_by: user.user_id,
      updated_at: now,
      updated_by: user.user_id
    };
    
    rows.push(objectToRow('ACTION_PLANS', actionPlan));
    results.push({ actionPlanId: ids[idx], actionPlan: actionPlan });
  });
  
  // Batch insert
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
  
  // Update indexes
  results.forEach((r, idx) => {
    updateActionPlanIndex(r.actionPlanId, r.actionPlan, startRow + idx);
  });
  
  // Log audit event
  logAuditEvent('BATCH_CREATE', 'ACTION_PLAN', workPaperId, null, { count: results.length }, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, count: results.length, actionPlans: results });
}

/**
 * Get action plan by ID
 */
function getActionPlan(actionPlanId, includeRelated) {
  if (!actionPlanId) return null;
  
  let actionPlan = null;
  if (typeof DB !== 'undefined' && DB.getById) {
    actionPlan = DB.getById('ACTION_PLAN', actionPlanId);
  } else {
    actionPlan = getActionPlanById(actionPlanId);
  }
  
  if (!actionPlan) return null;
  
  // Calculate days overdue
  actionPlan.days_overdue = calculateDaysOverdue(actionPlan.due_date);
  
  if (includeRelated) {
    actionPlan.evidence = getActionPlanEvidence(actionPlanId);
    actionPlan.history = getActionPlanHistory(actionPlanId);
    
    // Get parent work paper info
    if (actionPlan.work_paper_id) {
      const wp = getWorkPaperById(actionPlan.work_paper_id);
      if (wp) {
        actionPlan.workPaper = {
          work_paper_id: wp.work_paper_id,
          observation_title: wp.observation_title,
          risk_rating: wp.risk_rating,
          affiliate_code: wp.affiliate_code,
          status: wp.status
        };
      }
    }
  }
  
  return sanitizeForClient(actionPlan);
}

/**
 * Get action plan by ID without sanitization (for internal use)
 */
function getActionPlanRaw(actionPlanId) {
  if (!actionPlanId) return null;
  
  let actionPlan = null;
  if (typeof DB !== 'undefined' && DB.getById) {
    actionPlan = DB.getById('ACTION_PLAN', actionPlanId);
  } else {
    actionPlan = getActionPlanById(actionPlanId);
  }
  
  if (!actionPlan) return null;
  
  // Calculate days overdue
  actionPlan.days_overdue = calculateDaysOverdue(actionPlan.due_date);
  
  return actionPlan;
}

/**
 * Update action plan
 */
function updateActionPlan(actionPlanId, data, user) {
  if (!user) throw new Error('User required');
  
  const existing = getActionPlanRaw(actionPlanId);
  if (!existing) throw new Error('Action plan not found: ' + actionPlanId);
  
  if (!canUserPerform(user, 'update', 'ACTION_PLAN', existing)) {
    throw new Error('Permission denied: Cannot update this action plan');
  }
  
  const now = new Date();
  const updates = { updated_at: now, updated_by: user.user_id };
  
  // Determine which fields can be updated based on role
  const isAuditee = user.role_code === ROLES.AUDITEE;
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.JUNIOR_STAFF].includes(user.role_code);
  
  if (isAuditee) {
    // Auditees can only update implementation-related fields
    if (data.implementation_notes !== undefined) updates.implementation_notes = sanitizeInput(data.implementation_notes);
  } else if (isAuditor) {
    // Auditors can update most fields
    const editableFields = [
      'action_description', 'owner_ids', 'owner_names', 'due_date',
      'implementation_notes', 'auditor_review_comments', 'hoa_review_comments'
    ];
    
    editableFields.forEach(field => {
      if (data[field] !== undefined) {
        updates[field] = typeof data[field] === 'string' ? sanitizeInput(data[field]) : data[field];
      }
    });
  }
  
  // Apply updates
  const updated = { ...existing, ...updates };
  
  // Update sheet
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const rowIndex = existing._rowIndex;
  
  if (!rowIndex) throw new Error('Row index not found');
  
  const row = objectToRow('ACTION_PLANS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Update index
  updateActionPlanIndex(actionPlanId, updated, rowIndex);
  
  // Log audit event
  logAuditEvent('UPDATE', 'ACTION_PLAN', actionPlanId, existing, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, actionPlan: updated });
}

/**
 * Delete action plan
 */
function deleteActionPlan(actionPlanId, user) {
  if (!user) throw new Error('User required');
  
  const existing = getActionPlanRaw(actionPlanId);
  if (!existing) throw new Error('Action plan not found: ' + actionPlanId);
  
  if (!canUserPerform(user, 'delete', 'ACTION_PLAN', existing)) {
    throw new Error('Permission denied: Cannot delete this action plan');
  }
  
  // Only allow deletion if not yet implemented
  const deletableStatuses = [STATUS.ACTION_PLAN.NOT_DUE, STATUS.ACTION_PLAN.PENDING, STATUS.ACTION_PLAN.IN_PROGRESS];
  if (!deletableStatuses.includes(existing.status)) {
    throw new Error('Cannot delete action plan with status: ' + existing.status);
  }
  
  // Delete evidence first
  const evidence = getActionPlanEvidence(actionPlanId);
  evidence.forEach(ev => {
    if (ev.drive_file_id) {
      try {
        DriveApp.getFileById(ev.drive_file_id).setTrashed(true);
      } catch (e) {
        console.warn('Could not trash evidence file:', e);
      }
    }
  });
  
  // Delete from sheets (in reverse order of dependencies)
  deleteRelatedRows(SHEETS.AP_EVIDENCE, 'action_plan_id', actionPlanId);
  deleteRelatedRows(SHEETS.AP_HISTORY, 'action_plan_id', actionPlanId);
  
  // Delete main record
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  if (existing._rowIndex) {
    sheet.deleteRow(existing._rowIndex);
  }
  
  // Remove from index
  removeFromIndex(SHEETS.INDEX_ACTION_PLANS, actionPlanId);
  
  // Rebuild index (rows shifted)
  rebuildActionPlanIndex();
  
  // Log audit event
  logAuditEvent('DELETE', 'ACTION_PLAN', actionPlanId, existing, null, user.user_id, user.email);
  
  return { success: true };
}

function getActionPlans(filters, user) {
  filters = filters || {};

  const sheet = getSheet(SHEETS.ACTION_PLANS);
  if (!sheet) {
    console.error('getActionPlans: Action Plans sheet not found:', SHEETS.ACTION_PLANS);
    return [];
  }

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    console.log('getActionPlans: No data in Action Plans sheet');
    return [];
  }

  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  let results = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    if (!row[colMap['action_plan_id']]) continue;
    
    let match = true;
    
    // Apply filters
    if (filters.work_paper_id && row[colMap['work_paper_id']] !== filters.work_paper_id) match = false;
    if (filters.status && row[colMap['status']] !== filters.status) match = false;
    if (filters.owner_id) {
      const ownerIds = String(row[colMap['owner_ids']] || '').split(',').map(s => s.trim());
      if (!ownerIds.includes(filters.owner_id)) match = false;
    }
    
    // Overdue filter
    if (filters.overdue_only) {
      const dueDate = row[colMap['due_date']];
      const status = row[colMap['status']];
      const implementedStatuses = [STATUS.ACTION_PLAN.IMPLEMENTED, STATUS.ACTION_PLAN.VERIFIED];
      
      if (implementedStatuses.includes(status)) {
        match = false;
      } else if (!isPastDue(dueDate)) {
        match = false;
      }
    }
    
    // Search
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const desc = String(row[colMap['action_description']] || '').toLowerCase();
      const notes = String(row[colMap['implementation_notes']] || '').toLowerCase();
      if (!desc.includes(searchLower) && !notes.includes(searchLower)) {
        match = false;
      }
    }
    
    // Role-based filtering
    if (user) {
      const roleCode = user.role_code;
      
      // Auditees only see their own action plans
      if (roleCode === ROLES.AUDITEE) {
        const ownerIds = String(row[colMap['owner_ids']] || '').split(',').map(s => s.trim());
        if (!ownerIds.includes(user.user_id)) {
          match = false;
        }
      }
    }
    
    if (match) {
      const ap = rowToObject(headers, row);
      ap._rowIndex = i + 1;
      ap.days_overdue = calculateDaysOverdue(ap.due_date);
      results.push(ap);
    }
  }
  
  // Sort by due date ascending (nearest due first)
  results.sort((a, b) => {
    const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31');
    const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31');
    return dateA - dateB;
  });
  
  // Pagination
  if (filters.limit) {
    const offset = filters.offset || 0;
    results = results.slice(offset, offset + filters.limit);
  }
  
  return sanitizeForClient(results);
}

/**
 * Get action plans without sanitization (for internal use)
 */
function getActionPlansRaw(filters, user) {
  filters = filters || {};

  const sheet = getSheet(SHEETS.ACTION_PLANS);
  if (!sheet) {
    console.error('getActionPlansRaw: Action Plans sheet not found:', SHEETS.ACTION_PLANS);
    return [];
  }

  const data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) {
    console.log('getActionPlansRaw: No data in Action Plans sheet');
    return [];
  }

  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  let results = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    
    if (!row[colMap['action_plan_id']]) continue;
    
    let match = true;
    
    if (filters.work_paper_id && row[colMap['work_paper_id']] !== filters.work_paper_id) match = false;
    if (filters.status && row[colMap['status']] !== filters.status) match = false;
    if (filters.owner_id) {
      const ownerIds = String(row[colMap['owner_ids']] || '').split(',').map(s => s.trim());
      if (!ownerIds.includes(filters.owner_id)) match = false;
    }
    
    if (filters.overdue_only) {
      const dueDate = row[colMap['due_date']];
      const status = row[colMap['status']];
      const implementedStatuses = [STATUS.ACTION_PLAN.IMPLEMENTED, STATUS.ACTION_PLAN.VERIFIED];
      
      if (implementedStatuses.includes(status)) {
        match = false;
      } else if (!isPastDue(dueDate)) {
        match = false;
      }
    }
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const desc = String(row[colMap['action_description']] || '').toLowerCase();
      const notes = String(row[colMap['implementation_notes']] || '').toLowerCase();
      if (!desc.includes(searchLower) && !notes.includes(searchLower)) {
        match = false;
      }
    }
    
    if (user) {
      const roleCode = user.role_code;
      
      if (roleCode === ROLES.AUDITEE) {
        const ownerIds = String(row[colMap['owner_ids']] || '').split(',').map(s => s.trim());
        if (!ownerIds.includes(user.user_id)) {
          match = false;
        }
      }
    }
    
    if (match) {
      const ap = rowToObject(headers, row);
      ap._rowIndex = i + 1;
      ap.days_overdue = calculateDaysOverdue(ap.due_date);
      results.push(ap);
    }
  }
  
  results.sort((a, b) => {
    const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31');
    const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31');
    return dateA - dateB;
  });
  
  if (filters.limit) {
    const offset = filters.offset || 0;
    results = results.slice(offset, offset + filters.limit);
  }
  
  return results;
}

/**
 * Get action plans by work paper ID without sanitization (for internal use)
 */
function getActionPlansByWorkPaperRaw(workPaperId) {
  return getActionPlansRaw({ work_paper_id: workPaperId }, null);
}

/**
 * Get action plan counts
 */
function getActionPlanCounts(filters, user) {
  const plans = getActionPlansRaw(filters, user);

  if (!plans || !Array.isArray(plans)) {
    console.error('getActionPlanCounts: Invalid plans returned');
    return {
      total: 0,
      byStatus: {},
      overdue: 0,
      dueThisWeek: 0,
      dueThisMonth: 0
    };
  }

  const counts = {
    total: plans.length,
    byStatus: {},
    overdue: 0,
    dueThisWeek: 0,
    dueThisMonth: 0
  };
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  
  const monthEnd = new Date(today);
  monthEnd.setDate(monthEnd.getDate() + 30);
  
  plans.forEach(ap => {
    // By status
    const status = ap.status || 'Unknown';
    counts.byStatus[status] = (counts.byStatus[status] || 0) + 1;
    
    // Overdue
    if (ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)) {
      counts.overdue++;
    }
    
    // Due this week/month
    if (ap.due_date && !isImplementedOrVerified(ap.status)) {
      const dueDate = new Date(ap.due_date);
      dueDate.setHours(0, 0, 0, 0);
      
      if (dueDate >= today && dueDate <= weekEnd) {
        counts.dueThisWeek++;
      }
      if (dueDate >= today && dueDate <= monthEnd) {
        counts.dueThisMonth++;
      }
    }
  });
  
  return counts;
}

/**
 * Check if status is a closed/completed status (no longer active)
 */
function isImplementedOrVerified(status) {
  const closedStatuses = [
    STATUS.ACTION_PLAN.IMPLEMENTED,
    STATUS.ACTION_PLAN.VERIFIED,
    STATUS.ACTION_PLAN.NOT_IMPLEMENTED,
    STATUS.ACTION_PLAN.CLOSED,
    STATUS.ACTION_PLAN.REJECTED,
    'Implemented', 'Verified', 'Not Implemented', 'Closed', 'Rejected'  // String fallbacks
  ];
  return closedStatuses.includes(status);
}

function markAsImplemented(actionPlanId, implementationNotes, user) {
  if (!user) throw new Error('User required');
  
  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found');
  
  // Verify user is an owner or has permission
  const ownerIds = String(actionPlan.owner_ids || '').split(',').map(s => s.trim());
  const isOwner = ownerIds.includes(user.user_id);
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR].includes(user.role_code);
  
  if (!isOwner && !isAuditor) {
    throw new Error('Permission denied: Only owners can mark as implemented');
  }
  
  const now = new Date();
  const previousStatus = actionPlan.status;
  
  // Auditees mark as implemented -> goes to Pending Verification for auditor review
  // Status flow: In Progress -> Implemented (by auditee) -> Verified/Rejected (by auditor)
  const updates = {
    status: STATUS.ACTION_PLAN.IMPLEMENTED || 'Implemented',
    implementation_notes: sanitizeInput(implementationNotes || actionPlan.implementation_notes || ''),
    implemented_date: now,
    implemented_by: user.user_id,
    updated_at: now,
    updated_by: user.user_id
  };
  
  // Update sheet
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const rowIndex = actionPlan._rowIndex;
  const updated = { ...actionPlan, ...updates };
  const row = objectToRow('ACTION_PLANS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Update index
  updateActionPlanIndex(actionPlanId, updated, rowIndex);
  
  // Add history
  addActionPlanHistory(actionPlanId, previousStatus, updates.status, implementationNotes, user);
  
  // Queue notification to auditors for verification
  queueImplementationNotification(actionPlanId, updated, user);
  
  // Log audit event
  logAuditEvent('IMPLEMENT', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, actionPlan: updated, message: 'Marked as implemented. Awaiting auditor verification.' });
}

/**
 * Verify implementation (by auditor)
 * Action plan workflow: Implemented -> Verified (approved) / In Progress (rejected/returned)
 */
function verifyImplementation(actionPlanId, action, comments, user) {
  if (!user) throw new Error('User required');
  
  // Only auditors can verify
  const auditorRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
  if (!auditorRoles.includes(user.role_code)) {
    throw new Error('Permission denied: Only auditors can verify implementation');
  }
  
  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found');
  
  // Can only verify if status is Implemented (awaiting verification)
  if (actionPlan.status !== STATUS.ACTION_PLAN.IMPLEMENTED && actionPlan.status !== 'Implemented') {
    throw new Error('Action plan must be marked as implemented before verification');
  }
  
  const now = new Date();
  const previousStatus = actionPlan.status;
  
  const updates = {
    auditor_review_by: user.user_id,
    auditor_review_date: now,
    auditor_review_comments: sanitizeInput(comments || ''),
    updated_at: now,
    updated_by: user.user_id
  };
  
  if (action === 'approve' || action === 'verify') {
    // Approved - mark as Verified (final positive status)
    updates.auditor_review_status = STATUS.REVIEW.APPROVED;
    updates.status = STATUS.ACTION_PLAN.VERIFIED || 'Verified';
    updates.verified_date = now;
    updates.verified_by = user.user_id;
  } else if (action === 'reject') {
    // Rejected - mark as Rejected (final negative status)
    updates.auditor_review_status = STATUS.REVIEW.REJECTED;
    updates.status = STATUS.ACTION_PLAN.REJECTED || 'Rejected';
  } else if (action === 'return') {
    // Returned for rework - back to In Progress
    updates.auditor_review_status = STATUS.REVIEW.RETURNED;
    updates.status = STATUS.ACTION_PLAN.IN_PROGRESS || 'In Progress';
  } else {
    throw new Error('Invalid action: ' + action + '. Use approve, reject, or return.');
  }
  
  // Update sheet
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const rowIndex = actionPlan._rowIndex;
  const updated = { ...actionPlan, ...updates };
  const row = objectToRow('ACTION_PLANS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Update index
  updateActionPlanIndex(actionPlanId, updated, rowIndex);
  
  // Add history
  addActionPlanHistory(actionPlanId, previousStatus, updates.status, comments, user);
  
  // Queue notification to owners
  queueVerificationNotification(actionPlanId, updated, action, user);
  
  // Log audit event
  logAuditEvent('VERIFY', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, actionPlan: updated });
}

/**
 * HOA Final Review
 */
function hoaReview(actionPlanId, action, comments, user) {
  if (!user) throw new Error('User required');
  
  // Only HOA can do final review
  if (user.role_code !== ROLES.SUPER_ADMIN && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Permission denied: Only Head of Audit can perform final review');
  }
  
  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found');
  
  const now = new Date();
  
  const updates = {
    hoa_review_by: user.user_id,
    hoa_review_date: now,
    hoa_review_comments: sanitizeInput(comments || ''),
    updated_at: now,
    updated_by: user.user_id
  };
  
  if (action === 'approve') {
    updates.hoa_review_status = STATUS.REVIEW.APPROVED;
  } else if (action === 'reject') {
    updates.hoa_review_status = STATUS.REVIEW.REJECTED;
  }
  
  // Update sheet
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const rowIndex = actionPlan._rowIndex;
  const updated = { ...actionPlan, ...updates };
  const row = objectToRow('ACTION_PLANS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Add history
  addActionPlanHistory(actionPlanId, actionPlan.status, updated.status, comments, user);
  
  // Log audit event
  logAuditEvent('HOA_REVIEW', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, actionPlan: updated });
}

/**
 * Update status based on due date (called by daily trigger)
 */
function updateOverdueStatuses() {
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  const statusIdx = colMap['status'];
  const daysOverdueIdx = colMap['days_overdue'];
  const dueDateIdx = colMap['due_date'];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let updatedCount = 0;
  const activeStatuses = [STATUS.ACTION_PLAN.NOT_DUE, STATUS.ACTION_PLAN.PENDING, STATUS.ACTION_PLAN.IN_PROGRESS];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const currentStatus = row[statusIdx];
    const dueDate = row[dueDateIdx];
    
    if (!dueDate || !activeStatuses.includes(currentStatus)) continue;
    
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    
    const daysOverdue = Math.floor((today - due) / (1000 * 60 * 60 * 24));
    
    // Update days overdue
    if (daysOverdue > 0) {
      sheet.getRange(i + 1, daysOverdueIdx + 1).setValue(daysOverdue);
      
      // Update status to Overdue if past due
      if (currentStatus !== STATUS.ACTION_PLAN.OVERDUE && daysOverdue > 0) {
        sheet.getRange(i + 1, statusIdx + 1).setValue(STATUS.ACTION_PLAN.OVERDUE);
        updatedCount++;
      }
    } else if (currentStatus === STATUS.ACTION_PLAN.NOT_DUE && daysOverdue <= 0 && daysOverdue >= -30) {
      // Update to Pending if due within 30 days
      sheet.getRange(i + 1, statusIdx + 1).setValue(STATUS.ACTION_PLAN.PENDING);
      updatedCount++;
    }
  }
  
  console.log('Updated overdue statuses:', updatedCount);
  return updatedCount;
}

function addActionPlanEvidence(actionPlanId, evidenceData, user) {
  if (!user) throw new Error('User required');
  
  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found');
  
  // Verify user can add evidence
  const ownerIds = String(actionPlan.owner_ids || '').split(',').map(s => s.trim());
  const isOwner = ownerIds.includes(user.user_id);
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR].includes(user.role_code);
  
  if (!isOwner && !isAuditor) {
    throw new Error('Permission denied: Cannot add evidence');
  }
  
  const evidenceId = generateId('EVIDENCE');
  const now = new Date();
  
  const evidence = {
    evidence_id: evidenceId,
    action_plan_id: actionPlanId,
    file_name: sanitizeInput(evidenceData.file_name || ''),
    file_description: sanitizeInput(evidenceData.file_description || ''),
    drive_file_id: evidenceData.drive_file_id || '',
    drive_url: evidenceData.drive_url || '',
    file_size: evidenceData.file_size || 0,
    mime_type: evidenceData.mime_type || '',
    uploaded_by: user.user_id,
    uploaded_at: now
  };
  
  const sheet = getSheet(SHEETS.AP_EVIDENCE);
  const row = objectToRow('AP_EVIDENCE', evidence);
  sheet.appendRow(row);
  
  // Add history entry
  addActionPlanHistory(actionPlanId, actionPlan.status, actionPlan.status, 
    'Evidence uploaded: ' + evidence.file_name, user);
  
  logAuditEvent('ADD_EVIDENCE', 'ACTION_PLAN', actionPlanId, null, evidence, user.user_id, user.email);
  
  return sanitizeForClient({ success: true, evidenceId: evidenceId, evidence: evidence });
}

/**
 * Delete evidence
 */
function deleteActionPlanEvidence(evidenceId, user) {
  if (!user) throw new Error('User required');
  
  const sheet = getSheet(SHEETS.AP_EVIDENCE);
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idIdx = headers.indexOf('evidence_id');
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === evidenceId) {
      const existing = rowToObject(headers, allData[i]);
      
      // Trash from Drive
      if (existing.drive_file_id) {
        try {
          DriveApp.getFileById(existing.drive_file_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash evidence file:', e);
        }
      }
      
      sheet.deleteRow(i + 1);
      
      logAuditEvent('DELETE_EVIDENCE', 'ACTION_PLAN', existing.action_plan_id, existing, null, user.user_id, user.email);
      
      return { success: true };
    }
  }
  
  throw new Error('Evidence not found: ' + evidenceId);
}

function addActionPlanHistory(actionPlanId, previousStatus, newStatus, comments, user) {
  const historyId = generateId('HISTORY');
  const now = new Date();
  
  const history = {
    history_id: historyId,
    action_plan_id: actionPlanId,
    previous_status: previousStatus || '',
    new_status: newStatus || '',
    comments: sanitizeInput(comments || ''),
    user_id: user.user_id,
    user_name: user.full_name,
    changed_at: now
  };
  
  const sheet = getSheet(SHEETS.AP_HISTORY);
  const row = objectToRow('AP_HISTORY', history);
  sheet.appendRow(row);
  
  return history;
}

function updateActionPlanIndex(actionPlanId, actionPlan, rowNumber) {
  const indexSheet = getSheet(SHEETS.INDEX_ACTION_PLANS);
  const data = indexSheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('action_plan_id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === actionPlanId) {
      const row = buildActionPlanIndexRow(actionPlanId, actionPlan, rowNumber);
      indexSheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  
  // Add new entry
  const row = buildActionPlanIndexRow(actionPlanId, actionPlan, rowNumber);
  indexSheet.appendRow(row);
}

/**
 * Build index row
 */
function buildActionPlanIndexRow(actionPlanId, actionPlan, rowNumber) {
  return [
    actionPlanId,
    rowNumber,
    actionPlan.work_paper_id,
    actionPlan.status,
    actionPlan.due_date,
    actionPlan.owner_ids,
    actionPlan.days_overdue || 0,
    new Date()
  ];
}

/**
 * Rebuild action plan index
 */
function rebuildActionPlanIndex() {
  const dataSheet = getSheet(SHEETS.ACTION_PLANS);
  const indexSheet = getSheet(SHEETS.INDEX_ACTION_PLANS);
  
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  
  if (indexSheet.getLastRow() > 1) {
    indexSheet.getRange(2, 1, indexSheet.getLastRow() - 1, indexSheet.getLastColumn()).clearContent();
  }
  
  const indexRows = [];
  const idIdx = headers.indexOf('action_plan_id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx]) {
      const ap = rowToObject(headers, data[i]);
      indexRows.push(buildActionPlanIndexRow(data[i][idIdx], ap, i + 1));
    }
  }
  
  if (indexRows.length > 0) {
    indexSheet.getRange(2, 1, indexRows.length, indexRows[0].length).setValues(indexRows);
  }
  
  console.log('Rebuilt action plan index:', indexRows.length, 'entries');
  return indexRows.length;
}

function queueImplementationNotification(actionPlanId, actionPlan, implementer) {
  const auditors = getUsersDropdown().filter(u => 
    [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN, ROLES.SUPER_ADMIN].includes(u.roleCode)
  );
  
  auditors.forEach(auditor => {
    queueNotification({
      template_code: 'AP_IMPLEMENTED',
      recipient_user_id: auditor.id,
      recipient_email: auditor.email,
      subject: 'Action Plan Marked as Implemented',
      body: `Action plan ${actionPlanId} has been marked as implemented by ${implementer.full_name} and requires verification.`,
      module: 'ACTION_PLAN',
      record_id: actionPlanId
    });
  });
}

function queueVerificationNotification(actionPlanId, actionPlan, action, verifier) {
  const ownerIds = String(actionPlan.owner_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  
  const actionText = action === 'approve' ? 'verified' : action === 'reject' ? 'rejected' : 'returned for revision';
  
  ownerIds.forEach(ownerId => {
    const owner = getUserById(ownerId);
    if (owner) {
      queueNotification({
        template_code: 'AP_VERIFIED',
        recipient_user_id: owner.user_id,
        recipient_email: owner.email,
        subject: 'Action Plan Verification Update',
        body: `Your action plan ${actionPlanId} has been ${actionText} by ${verifier.full_name}.`,
        module: 'ACTION_PLAN',
        record_id: actionPlanId
      });
    }
  });
}

function deleteRelatedRows(sheetName, foreignKeyColumn, foreignKeyValue) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const fkIdx = headers.indexOf(foreignKeyColumn);
  
  // Delete from bottom to top to avoid index shifting issues
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][fkIdx] === foreignKeyValue) {
      sheet.deleteRow(i + 1);
    }
  }
}

/**
 * Sanitize object for safe transport to browser via google.script.run
 * Converts Date objects to ISO strings and removes undefined values
 */
function sanitizeForClient(obj) {
  return JSON.parse(JSON.stringify(obj, function (key, value) {
    // Convert Date objects to ISO strings (Dates break postMessage)
    if (value instanceof Date) {
      return value.toISOString();
    }
    
    // Replace undefined with null (undefined breaks transport)
    if (value === undefined) {
      return null;
    }
    
    return value;
  }));
}
