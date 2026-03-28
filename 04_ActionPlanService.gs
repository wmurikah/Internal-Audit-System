// 04_ActionPlanService.gs - Action Plan CRUD, Workflow, Evidence, History

function createActionPlan(data, user) {
  if (!user) throw new Error('User required');
  if (!canUserPerform(user, 'create', 'ACTION_PLAN', null)) {
    throw new Error('Permission denied: Cannot create action plans');
  }
  
  if (!data.work_paper_id) {
    throw new Error('Work paper ID is required');
  }

  // Validate due date: must not be more than 6 months from today
  if (data.due_date) {
    var dueDateCheck = new Date(data.due_date);
    var maxDueDate = new Date();
    maxDueDate.setMonth(maxDueDate.getMonth() + 6);
    if (dueDateCheck > maxDueDate) {
      throw new Error('Due date cannot be more than 6 months from today. Maximum allowed: ' +
        maxDueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
  }

  // Verify work paper exists and is sent to auditee
  const workPaper = getWorkPaperById(data.work_paper_id);
  if (!workPaper) {
    throw new Error('Work paper not found: ' + data.work_paper_id);
  }
  if (workPaper.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
    throw new Error('Action plans can only be created after work paper is sent to auditee');
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
    delegated_by_id: '',
    delegated_by_name: '',
    delegated_date: '',
    delegation_notes: '',
    original_owner_ids: '',
    created_at: now,
    created_by: user.user_id,
    updated_at: now,
    updated_by: user.user_id,
    created_by_role: user.role_code || '',
    auditee_proposed: false,
    response_id: data.response_id || ''
  };

  // Write to Firestore
  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, actionPlan);
  invalidateSheetData(SHEETS.ACTION_PLANS);

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

  const workPaper = getWorkPaperById(workPaperId);
  if (!workPaper) {
    throw new Error('Work paper not found: ' + workPaperId);
  }
  if (workPaper.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
    throw new Error('Action plans can only be created after work paper is sent to auditee');
  }
  
  // Validate all due dates: must not be more than 6 months from today
  var maxDueDateBatch = new Date();
  maxDueDateBatch.setMonth(maxDueDateBatch.getMonth() + 6);
  plansData.forEach(function(pd, idx) {
    if (pd.due_date) {
      var dd = new Date(pd.due_date);
      if (dd > maxDueDateBatch) {
        throw new Error('Action plan #' + (idx + 1) + ': Due date cannot be more than 6 months from today.');
      }
    }
  });

  const results = [];
  const ids = generateIds('ACTION_PLAN', plansData.length);

  const existingPlans = getActionPlansByWorkPaperRaw(workPaperId);
  let nextNum = existingPlans.length > 0 ? Math.max(...existingPlans.map(p => p.action_number || 0)) + 1 : 1;
  
  const now = new Date();

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
      delegated_by_id: '',
      delegated_by_name: '',
      delegated_date: '',
      delegation_notes: '',
      original_owner_ids: '',
      created_at: now,
      created_by: user.user_id,
      updated_at: now,
      updated_by: user.user_id,
      created_by_role: user.role_code || '',
      auditee_proposed: data.auditee_proposed || false,
      response_id: data.response_id || ''
    };

    results.push({ actionPlanId: ids[idx], actionPlan: actionPlan });
  });

  // Write to Firestore (batch)
  var fsWrites = results.map(function(r) {
    return { sheetName: SHEETS.ACTION_PLANS, docId: r.actionPlanId, data: r.actionPlan };
  });
  firestoreBatchWrite(fsWrites);
  invalidateSheetData(SHEETS.ACTION_PLANS);

  // Log audit event
  logAuditEvent('BATCH_CREATE', 'ACTION_PLAN', workPaperId, null, { count: results.length }, user.user_id, user.email);

  return sanitizeForClient({ success: true, count: results.length, actionPlans: results });
}

/**
 * Get action plan by ID
 */
function getActionPlan(actionPlanId, includeRelated) {
  if (!actionPlanId) return null;

  var actionPlan = getActionPlanById(actionPlanId);
  
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

  var actionPlan = getActionPlanById(actionPlanId);
  
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

  // Optimistic locking: reject if record was modified since user loaded it
  if (data._loadedAt && existing.updated_at) {
    var loadedTime = new Date(data._loadedAt).getTime();
    var serverTime = new Date(existing.updated_at).getTime();
    if (serverTime > loadedTime) {
      throw new Error('This record was modified by another user. Please refresh and try again.');
    }
  }

  // Validate due date if being updated: must not be more than 6 months from today
  if (data.due_date) {
    var dueDateCheck = new Date(data.due_date);
    var maxDueDate = new Date();
    maxDueDate.setMonth(maxDueDate.getMonth() + 6);
    if (dueDateCheck > maxDueDate) {
      throw new Error('Due date cannot be more than 6 months from today. Maximum allowed: ' +
        maxDueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
  }

  const now = new Date();
  const updates = { updated_at: now, updated_by: user.user_id };

  // Determine which fields can be updated based on role
  const isAuditee = user.role_code === ROLES.JUNIOR_STAFF;
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR].includes(user.role_code);
  
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

  // Write to Firestore
  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, updated);
  invalidateSheetData(SHEETS.ACTION_PLANS);

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
  
  // Delete from Firestore (primary)
  deleteFromFirestore(SHEETS.ACTION_PLANS, actionPlanId);
  deleteFromFirestore(SHEETS.AP_EVIDENCE, actionPlanId);
  deleteFromFirestore(SHEETS.AP_HISTORY, actionPlanId);
  invalidateSheetData(SHEETS.ACTION_PLANS);

  invalidateSheetData(SHEETS.ACTION_PLANS);
  invalidateSheetData(SHEETS.AP_EVIDENCE);
  invalidateSheetData(SHEETS.AP_HISTORY);

  // Log audit event
  logAuditEvent('DELETE', 'ACTION_PLAN', actionPlanId, existing, null, user.user_id, user.email);

  return { success: true };
}

function getActionPlans(filters, user) {
  var results = getActionPlansRaw(filters, user);
  return sanitizeForClient(applyFieldRestrictions(results, user ? user.role_code : null, 'ACTION_PLAN'));
}

/**
 * Get action plans without sanitization (for internal use)
 */
function getActionPlansRaw(filters, user) {
  filters = filters || {};

  var data = getSheetData(SHEETS.ACTION_PLANS);
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
      const ownerIds = parseIdList(row[colMap['owner_ids']]);
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

      // Roles that see ALL action plans (no ownership filter)
      const seeAllRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR, ROLES.SENIOR_MGMT];

      // BOARD_MEMBER and EXTERNAL_AUDITOR: read-only, only see closed/verified action plans
      if (roleCode === ROLES.BOARD_MEMBER || roleCode === ROLES.EXTERNAL_AUDITOR) {
        const viewableStatuses = ['Implemented', 'Verified', 'Closed'];
        if (!viewableStatuses.includes(row[colMap['status']])) {
          match = false;
        }
      }
      // All other roles not in seeAllRoles: only see action plans assigned to them
      else if (!seeAllRoles.includes(roleCode)) {
        const ownerIds = parseIdList(row[colMap['owner_ids']]);
        if (!ownerIds.includes(user.user_id)) {
          match = false;
        }
      }
    }
    
    if (match) {
      const ap = rowToObject(headers, row);
      ap._rowIndex = i + 1;
      ap.days_overdue = calculateDaysOverdue(ap.due_date);
      // Compute days until due for UI (Kanban "due soon" indicator)
      if (ap.due_date) {
        var _due = ap.due_date instanceof Date ? new Date(ap.due_date) : new Date(ap.due_date);
        var _today = new Date();
        _due.setHours(0, 0, 0, 0);
        _today.setHours(0, 0, 0, 0);
        var _diffMs = _due.getTime() - _today.getTime();
        ap.days_until_due = Math.ceil(_diffMs / (1000 * 60 * 60 * 24));
      } else {
        ap.days_until_due = 999;
      }
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
  const ownerIds = parseIdList(actionPlan.owner_ids);
  const isOwner = ownerIds.includes(user.user_id);
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR].includes(user.role_code);

  if (!isOwner && !isAuditor) {
    throw new Error('Permission denied: Only owners can mark as implemented');
  }

  // Evidence is mandatory to mark as implemented
  const evidence = getActionPlanEvidence(actionPlanId);
  if (!evidence || evidence.length === 0) {
    throw new Error('Evidence attachment is required before marking as implemented. Please upload at least one supporting document.');
  }

  const now = new Date();
  const previousStatus = actionPlan.status;
  
  // Auditees mark as implemented -> goes to Pending Verification for auditor review
  // Status flow: In Progress -> Pending Verification (by auditee) -> Verified/Rejected (by auditor)
  const updates = {
    status: STATUS.ACTION_PLAN.PENDING_VERIFICATION || 'Pending Verification',
    implementation_notes: sanitizeInput(implementationNotes || actionPlan.implementation_notes || ''),
    implemented_date: now,
    implemented_by: user.user_id,
    updated_at: now,
    updated_by: user.user_id
  };
  
  const updated = { ...actionPlan, ...updates };

  // Firestore is the primary write
  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, updated);
  invalidateSheetData(SHEETS.ACTION_PLANS);

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
  
  // Can only verify if status is pending verification (or legacy implemented)
  const verifiableStatuses = [
    STATUS.ACTION_PLAN.PENDING_VERIFICATION,
    'Pending Verification',
    STATUS.ACTION_PLAN.IMPLEMENTED,
    'Implemented'
  ];
  if (!verifiableStatuses.includes(actionPlan.status)) {
    throw new Error('Action plan must be marked as implemented and pending verification before verification');
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
  
  const updated = { ...actionPlan, ...updates };

  // Firestore is the primary write
  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, updated);
  invalidateSheetData(SHEETS.ACTION_PLANS);

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
  if (user.role_code !== ROLES.SUPER_ADMIN && user.role_code !== ROLES.SENIOR_AUDITOR) {
    throw new Error('Permission denied: Only Head of Audit or Senior Auditor can perform final review');
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
  
  const previousStatus = actionPlan.status;

  if (action === 'approve') {
    updates.hoa_review_status = STATUS.REVIEW.APPROVED;
    // HOA approval is the final gate — mark as Closed
    if (actionPlan.status === STATUS.ACTION_PLAN.VERIFIED) {
      updates.status = 'Closed';
    }
  } else if (action === 'reject') {
    updates.hoa_review_status = STATUS.REVIEW.REJECTED;
    // HOA rejection returns the plan for rework
    updates.status = STATUS.ACTION_PLAN.IN_PROGRESS;
  }

  const updated = { ...actionPlan, ...updates };

  // Firestore is the primary write
  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, updated);
  invalidateSheetData(SHEETS.ACTION_PLANS);

  // Add history
  addActionPlanHistory(actionPlanId, previousStatus, updated.status, comments, user);

  // Log audit event
  logAuditEvent('HOA_REVIEW', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);

  return sanitizeForClient({ success: true, actionPlan: updated });
}

/**
 * Update status based on due date (called by daily trigger)
 */
function updateOverdueStatuses() {
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) return 0;
  var headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const statusIdx = colMap['status'];
  const daysOverdueIdx = colMap['days_overdue'];
  const dueDateIdx = colMap['due_date'];
  const actionPlanIdIdx = colMap['action_plan_id'];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let updatedCount = 0;
  const activeStatuses = [STATUS.ACTION_PLAN.NOT_DUE, STATUS.ACTION_PLAN.PENDING, STATUS.ACTION_PLAN.IN_PROGRESS];
  const systemUser = {
    user_id: 'SYSTEM',
    full_name: 'System Trigger',
    email: 'system@internal-audit.local'
  };

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
      var updatedObj = rowToObject(headers, row);
      updatedObj.days_overdue = daysOverdue;

      // Update status to Overdue if past due
      if (currentStatus !== STATUS.ACTION_PLAN.OVERDUE && daysOverdue > 0) {
        updatedObj.status = STATUS.ACTION_PLAN.OVERDUE;
        if (actionPlanIdIdx !== undefined) {
          const actionPlanId = row[actionPlanIdIdx];
          if (actionPlanId) {
            const notes = 'AUTO_OVERDUE: Automatically marked overdue based on due date aging';
            addActionPlanHistory(actionPlanId, currentStatus, STATUS.ACTION_PLAN.OVERDUE, notes, systemUser);
            logAuditEvent('AUTO_STATUS_UPDATE', 'ACTION_PLAN', actionPlanId, { status: currentStatus },
              { status: STATUS.ACTION_PLAN.OVERDUE, reason: 'AUTO_OVERDUE' }, systemUser.user_id, systemUser.email);
            syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, updatedObj);
          }
        }
        updatedCount++;
      }

    } else if (currentStatus === STATUS.ACTION_PLAN.NOT_DUE && daysOverdue <= 0 && daysOverdue >= -30) {
      // Update to Pending if due within 30 days
      var pendingObj = rowToObject(headers, row);
      pendingObj.status = STATUS.ACTION_PLAN.PENDING;

      if (actionPlanIdIdx !== undefined) {
        const actionPlanId = row[actionPlanIdIdx];
        if (actionPlanId) {
          const notes = 'AUTO_DUE_WINDOW: Automatically moved to pending (due within 30 days)';
          addActionPlanHistory(actionPlanId, currentStatus, STATUS.ACTION_PLAN.PENDING, notes, systemUser);
          logAuditEvent('AUTO_STATUS_UPDATE', 'ACTION_PLAN', actionPlanId, { status: currentStatus },
            { status: STATUS.ACTION_PLAN.PENDING, reason: 'AUTO_DUE_WINDOW' }, systemUser.user_id, systemUser.email);
          syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, pendingObj);
        }
      }
      updatedCount++;
    }
  }

  if (updatedCount > 0) invalidateSheetData(SHEETS.ACTION_PLANS);
  console.log('Updated overdue statuses:', updatedCount);
  return updatedCount;
}

/**
 * Delegate an action plan to different owner(s) for accountability.
 * Preserves the original owner_ids and records who delegated.
 */
function delegateActionPlan(actionPlanId, newOwnerIds, newOwnerNames, notes, user) {
  if (!user) throw new Error('User required');

  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found: ' + actionPlanId);

  // Only current owners or auditors can delegate
  var currentOwnerIds = parseIdList(actionPlan.owner_ids);
  var isCurrentOwner = currentOwnerIds.includes(user.user_id);
  var isAuditor = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR].includes(user.role_code);

  if (!isCurrentOwner && !isAuditor) {
    throw new Error('Permission denied: Only current owners or auditors can delegate action plans');
  }

  // Cannot delegate closed/verified action plans
  var closedStatuses = [STATUS.ACTION_PLAN.VERIFIED, STATUS.ACTION_PLAN.CLOSED, STATUS.ACTION_PLAN.NOT_IMPLEMENTED];
  if (closedStatuses.includes(actionPlan.status)) {
    throw new Error('Cannot delegate action plan with status: ' + actionPlan.status);
  }

  if (!newOwnerIds || String(newOwnerIds).trim() === '') {
    throw new Error('New owner(s) required for delegation');
  }

  var now = new Date();
  var previousStatus = actionPlan.status;

  var updates = {
    original_owner_ids: actionPlan.original_owner_ids || actionPlan.owner_ids,
    owner_ids: String(newOwnerIds),
    owner_names: String(newOwnerNames || ''),
    delegated_by_id: user.user_id,
    delegated_by_name: user.full_name || '',
    delegated_date: now,
    delegation_notes: sanitizeInput(notes || ''),
    updated_at: now,
    updated_by: user.user_id
  };

  var updated = {};
  for (var k in actionPlan) { updated[k] = actionPlan[k]; }
  for (var k2 in updates) { updated[k2] = updates[k2]; }

  // Firestore is the primary write
  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, updated);
  invalidateSheetData(SHEETS.ACTION_PLANS);

  // Add history
  var historyComment = 'Delegated from ' + (actionPlan.owner_names || 'previous owner') +
    ' to ' + (newOwnerNames || newOwnerIds) +
    (notes ? '. Reason: ' + notes : '');
  addActionPlanHistory(actionPlanId, previousStatus, previousStatus, historyComment, user);

  // Log audit event
  logAuditEvent('DELEGATE', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);

  // Notify new owners
  queueDelegationNotification(actionPlanId, updated, actionPlan, user);

  return sanitizeForClient({ success: true, actionPlan: updated, message: 'Action plan delegated successfully.' });
}

/**
 * Send delegation notification to the new owner(s)
 */
function queueDelegationNotification(actionPlanId, actionPlan, previousVersion, delegator) {
  var ownerIds = parseIdList(actionPlan.owner_ids);
  var parentWp = actionPlan.work_paper_id ? getWorkPaperById(actionPlan.work_paper_id) : null;
  var observationTitle = parentWp ? parentWp.observation_title : '';
  var loginUrl = ScriptApp.getService().getUrl();

  ownerIds.forEach(function(ownerId) {
    var owner = getUserById(ownerId);
    if (!owner || !owner.email || !isActive(owner.is_active)) return;

    var subject = 'Action Plan Assignment — ' + (observationTitle || actionPlanId);
    var ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';
    var intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      '<strong>' + (delegator.full_name || 'A colleague') + '</strong> has delegated the following action plan to you:';

    var headers = ['Field', 'Details'];
    var rows = [
      ['Observation', String(observationTitle || '-')],
      ['Action Plan', truncateWords(actionPlan.action_description || '-', 15)],
      ['Due Date', actionPlan.due_date ? new Date(actionPlan.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'],
      ['Status', actionPlan.status || '-'],
      ['Delegated By', String(delegator.full_name || '-')],
      ['Previous Owner(s)', String(previousVersion.owner_names || '-')]
    ];

    if (actionPlan.delegation_notes) {
      rows.push(['Delegation Notes', String(actionPlan.delegation_notes)]);
    }

    var outro = loginUrl
      ? 'Please <a href="' + loginUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to review and take action on this plan.'
      : 'Please log in to review and take action on this plan.';
    var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
    sendEmail(owner.email, subject, subject, htmlBody, null, 'Hass Audit', 'hassaudit@outlook.com');
  });
}

function addActionPlanEvidence(actionPlanId, evidenceData, user) {
  if (!user) throw new Error('User required');
  
  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found');
  
  // Verify user can add evidence
  const ownerIds = parseIdList(actionPlan.owner_ids);
  const isOwner = ownerIds.includes(user.user_id);
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR].includes(user.role_code);
  
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

  // Write to Firestore
  syncToFirestore(SHEETS.AP_EVIDENCE, evidenceId, evidence);
  invalidateSheetData(SHEETS.AP_EVIDENCE);

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

  var allData = getSheetData(SHEETS.AP_EVIDENCE);
  if (!allData || allData.length < 2) throw new Error('Evidence not found: ' + evidenceId);
  var headers = allData[0];
  var idIdx = headers.indexOf('evidence_id');

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

      // Delete from Firestore
      deleteFromFirestore(SHEETS.AP_EVIDENCE, evidenceId);
      invalidateSheetData(SHEETS.AP_EVIDENCE);

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

  // Write to Firestore
  syncToFirestore(SHEETS.AP_HISTORY, historyId, history);
  invalidateSheetData(SHEETS.AP_HISTORY);

  return history;
}

function queueImplementationNotification(actionPlanId, actionPlan, implementer) {
  const auditors = getUsersDropdown().filter(u => 
    [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].includes(u.roleCode)
  );
  
  auditors.forEach(auditor => {
    queueTemplatedEmail('AP_IMPLEMENTED', auditor.email, auditor.id, {
      action_plan_id: actionPlanId,
      implementer_name: implementer.full_name || '',
      action_description: actionPlan.action_description || ''
    }, 'ACTION_PLAN', actionPlanId);
  });
}

/**
 * Send verification notification to action plan owners using table format.
 * Includes the action plan details + parent observation context.
 */
function queueVerificationNotification(actionPlanId, actionPlan, action, verifier) {
  var ownerIds = parseIdList(actionPlan.owner_ids);
  var actionText = action === 'approve' ? 'Verified' : action === 'reject' ? 'Rejected' : 'Returned for Revision';

  // Get parent work paper for observation context
  var parentWp = actionPlan.work_paper_id ? getWorkPaperById(actionPlan.work_paper_id) : null;
  var observationTitle = parentWp ? parentWp.observation_title : '';
  var riskRating = actionPlan.risk_rating || (parentWp ? parentWp.risk_rating : '');

  var loginUrl = ScriptApp.getService().getUrl();

  ownerIds.forEach(function(ownerId) {
    var owner = getUserById(ownerId);
    if (!owner || !owner.email || !isActive(owner.is_active)) return;

    var actionTextMap = { 'approve': 'Verified', 'reject': 'Returned with Feedback', 'return': 'Returned for Additional Work' };
    var subject = 'Action Plan ' + (actionTextMap[action] || actionText) + ' — Auditor Review';
    var ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';
    var intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      'The following action plan has been <strong>' + actionText.toLowerCase() + '</strong> by ' +
      (verifier.full_name || 'an auditor') + ':';

    var headers = ['Field', 'Details'];
    var rows = [
      ['Observation', String(observationTitle || '-')],
      ['Action Plan', truncateWords(actionPlan.action_description || '-', 15)],
      ['Rating', ratingBadge(riskRating)],
      ['Status', '<strong>' + actionText + '</strong>'],
      ['Reviewed By', String(verifier.full_name || '-')],
      ['Review Date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })]
    ];

    if (actionPlan.auditor_review_comments) {
      rows.push(['Comments', String(actionPlan.auditor_review_comments)]);
    }

    var outro = '';
    if (action === 'return') {
      outro = 'Please log in, review the auditor\'s comments, and update your action plan accordingly.<br><br>' + loginUrl;
    } else if (action === 'reject') {
      outro = 'The auditor has provided feedback on this action plan. Please log in to review the comments and update your response accordingly.<br><br>' + loginUrl;
    } else {
      outro = 'Your action plan has been verified. No further action is required.<br><br>' + loginUrl;
    }

    var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
    sendEmail(owner.email, subject, subject, htmlBody, null, 'Hass Audit', 'hassaudit@outlook.com');
  });
}

function deleteRelatedRows(sheetName, foreignKeyColumn, foreignKeyValue) {
  var data = getSheetData(sheetName);
  if (!data || data.length < 2) return;
  var headers = data[0];
  var fkIdx = headers.indexOf(foreignKeyColumn);

  // Delete matching docs from Firestore
  for (var i = 1; i < data.length; i++) {
    if (data[i][fkIdx] === foreignKeyValue) {
      var entityId = data[i][0];
      if (entityId) {
        deleteFromFirestore(sheetName, entityId);
      }
    }
  }
  invalidateSheetData(sheetName);
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)
