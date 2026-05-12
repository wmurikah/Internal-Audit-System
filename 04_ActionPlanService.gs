// 04_ActionPlanService.gs - Action Plan CRUD, Workflow, Evidence, History

function createActionPlan(data, user) {
  if (!user) throw new Error('User required');
  if (!canUserPerform(user, 'create', 'ACTION_PLAN', null)) {
    throw new Error('Permission denied: Cannot create action plans');
  }
  
  if (!data.work_paper_id) {
    throw new Error('Work paper ID is required');
  }

  // Validate mandatory fields
  var apMissing = [];
  if (!data.action_description || String(data.action_description).trim() === '') {
    apMissing.push('Action Description');
  }
  if (!data.owner_ids || String(data.owner_ids).trim() === '') {
    apMissing.push('Owner');
  }
  if (!data.due_date) {
    apMissing.push('Due Date');
  }
  if (apMissing.length > 0) {
    throw new Error('Missing required fields: ' + apMissing.join(', '));
  }

  // Validate due date: must not be more than AP_MAX_DUE_DATE_MONTHS from today
  if (data.due_date) {
    var maxMonths = getConfigInt('AP_MAX_DUE_DATE_MONTHS', 6);
    var dueDateCheck = new Date(data.due_date);
    var maxDueDate = new Date();
    maxDueDate.setMonth(maxDueDate.getMonth() + maxMonths);
    if (dueDateCheck > maxDueDate) {
      throw new Error('Due date cannot be more than ' + maxMonths + ' months from today. Maximum allowed: ' +
        maxDueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
  }

  // Verify work paper exists and is sent to auditee (SUPER_ADMIN bypasses status check)
  const workPaper = getWorkPaperById(data.work_paper_id);
  if (!workPaper) {
    throw new Error('Work paper not found: ' + data.work_paper_id);
  }
  if (workPaper.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE && user.role_code !== ROLES.SUPER_ADMIN) {
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
    organization_id: user.organization_id || workPaper.organization_id || 'HASS',
    work_paper_id: data.work_paper_id,
    action_number: nextNum,
    action_description: sanitizeInput(data.action_description || ''),
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
    created_at: new Date().toISOString(),
    created_by: user.user_id,
    updated_at: now,
    updated_by: user.user_id,
    created_by_role: user.role_code || '',
    auditee_proposed: false,
    response_id: data.response_id || null,
    audit_area_id: workPaper ? (workPaper.audit_area_id || '') : '',
    affiliate_code: workPaper ? (workPaper.affiliate_code || '') : ''
  };

  tursoSet('13_ActionPlans', actionPlanId, actionPlan);

  const ownerIds = (data.owner_ids || '').split(',').filter(Boolean);
  ownerIds.forEach(function(userId) {
    tursoQuery_SQL(
      'INSERT OR IGNORE INTO action_plan_owners (action_plan_id, user_id, is_original, is_current, added_by, added_at) VALUES (?,?,1,1,?,?)',
      [actionPlanId, userId.trim(), user.user_id, new Date().toISOString()]
    );
  });

  // Add history entry
  addActionPlanHistory(actionPlanId, '', initialStatus, 'Action plan created', user, 'STATUS_CHANGE');

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
  if (workPaper.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Action plans can only be created after work paper is sent to auditee');
  }

  // Validate all due dates: must not be more than AP_MAX_DUE_DATE_MONTHS from today
  var maxMonths = getConfigInt('AP_MAX_DUE_DATE_MONTHS', 6);
  var maxDueDateBatch = new Date();
  maxDueDateBatch.setMonth(maxDueDateBatch.getMonth() + maxMonths);
  plansData.forEach(function(pd, idx) {
    if (pd.due_date) {
      var dd = new Date(pd.due_date);
      if (dd > maxDueDateBatch) {
        throw new Error('Action plan #' + (idx + 1) + ': Due date cannot be more than ' + maxMonths + ' months from today.');
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
      created_at: new Date().toISOString(),
      created_by: user.user_id,
      updated_at: now,
      updated_by: user.user_id,
      created_by_role: user.role_code || '',
      auditee_proposed: data.auditee_proposed || false,
      response_id: data.response_id || null,
      audit_area_id: workPaper ? (workPaper.audit_area_id || '') : '',
      affiliate_code: workPaper ? (workPaper.affiliate_code || '') : ''
    };

    results.push({ actionPlanId: ids[idx], actionPlan: actionPlan });
  });

  var batchWrites = results.map(function(r) {
    return { sheetName: '13_ActionPlans', docId: r.actionPlanId, data: r.actionPlan };
  });
  tursoBatchWrite(batchWrites);

  // Insert junction owners for each plan
  results.forEach(function(r) {
    var planOwnerIds = (plansData[results.indexOf(r)].owner_ids || '').split(',').filter(Boolean);
    planOwnerIds.forEach(function(userId) {
      tursoQuery_SQL(
        'INSERT OR IGNORE INTO action_plan_owners (action_plan_id, user_id, is_original, is_current, added_by, added_at) VALUES (?,?,1,1,?,?)',
        [r.actionPlanId, userId.trim(), user.user_id, new Date().toISOString()]
      );
    });
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

  var actionPlan = getActionPlanById(actionPlanId);

  if (!actionPlan) return null;

  var apOwners = tursoQuery_SQL(
    'SELECT user_id FROM action_plan_owners WHERE action_plan_id = ? AND is_current = 1',
    [actionPlanId]
  );
  actionPlan.owner_ids = apOwners.map(function(r) { return r.user_id; }).join(',');

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

  var rawOwners = tursoQuery_SQL(
    'SELECT user_id FROM action_plan_owners WHERE action_plan_id = ? AND is_current = 1',
    [actionPlanId]
  );
  actionPlan.owner_ids = rawOwners.map(function(r) { return r.user_id; }).join(',');

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

  // Validate due date if being updated: must not be more than AP_MAX_DUE_DATE_MONTHS from today
  if (data.due_date) {
    var maxMonths = getConfigInt('AP_MAX_DUE_DATE_MONTHS', 6);
    var dueDateCheck = new Date(data.due_date);
    var maxDueDate = new Date();
    maxDueDate.setMonth(maxDueDate.getMonth() + maxMonths);
    if (dueDateCheck > maxDueDate) {
      throw new Error('Due date cannot be more than ' + maxMonths + ' months from today. Maximum allowed: ' +
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

  tursoSet('13_ActionPlans', actionPlanId, updated);

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
  
  // Only allow deletion if not yet implemented (SUPER_ADMIN can delete any status)
  const deletableStatuses = [STATUS.ACTION_PLAN.NOT_DUE, STATUS.ACTION_PLAN.PENDING, STATUS.ACTION_PLAN.IN_PROGRESS];
  if (!deletableStatuses.includes(existing.status) && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Cannot delete action plan with status: ' + existing.status);
  }
  
  // Delete evidence first
  const evidence = getActionPlanEvidence(actionPlanId);
  evidence.forEach(ev => {
    if (ev.storage_id) {
      try {
        DriveApp.getFileById(ev.storage_id).setTrashed(true);
      } catch (e) {
        console.warn('Could not trash evidence file:', e);
      }
    }
  });

  tursoDelete('13_ActionPlans', actionPlanId);
  tursoQuery_SQL(
    'UPDATE files SET deleted_at = ? WHERE file_id IN (SELECT file_id FROM file_attachments WHERE entity_type = ? AND entity_id = ?)',
    [new Date().toISOString(), 'ACTION_PLAN', actionPlanId]
  );

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

  // Evidence is mandatory to mark as implemented (SUPER_ADMIN can bypass)
  const evidence = getActionPlanEvidence(actionPlanId);
  if ((!evidence || evidence.length === 0) && user.role_code !== ROLES.SUPER_ADMIN) {
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

  tursoSet('13_ActionPlans', actionPlanId, updated);

  // Add history
  addActionPlanHistory(actionPlanId, previousStatus, updates.status, implementationNotes, user, 'STATUS_CHANGE');

  // Queue AP_IMPLEMENTED notification to auditors for verification
  try {
    var implParentWp = updated.work_paper_id ? getWorkPaperById(updated.work_paper_id) : null;
    var implData = {
      action_plan_id: actionPlanId,
    organization_id: user.organization_id || workPaper.organization_id || 'HASS',
      action_description: updated.action_description || '',
      implementer_name: user.full_name || '',
      implementation_notes: updated.implementation_notes || '',
      observation_title: implParentWp ? implParentWp.observation_title : '',
      risk_rating: updated.risk_rating || (implParentWp ? implParentWp.risk_rating : '')
    };
    var implAuditors = getUsersDropdown().filter(function(u) {
      return [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].indexOf(u.roleCode) >= 0;
    });
    implAuditors.forEach(function(auditor) {
      queueNotification({
        type: NOTIFICATION_TYPES.AP_IMPLEMENTED,
        recipient_user_id: auditor.id,
        data: implData
      });
    });
  } catch (e) { console.warn('AP_IMPLEMENTED notification failed:', e.message); }

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
  // SUPER_ADMIN can verify any status
  const verifiableStatuses = [
    STATUS.ACTION_PLAN.PENDING_VERIFICATION,
    'Pending Verification',
    STATUS.ACTION_PLAN.IMPLEMENTED,
    'Implemented'
  ];
  if (!verifiableStatuses.includes(actionPlan.status) && user.role_code !== ROLES.SUPER_ADMIN) {
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

  tursoSet('13_ActionPlans', actionPlanId, updated);

  // Add history
  addActionPlanHistory(actionPlanId, previousStatus, updates.status, comments, user, 'STATUS_CHANGE');

  // Queue AP_VERIFIED notification to owners
  try {
    var verifyParentWp = updated.work_paper_id ? getWorkPaperById(updated.work_paper_id) : null;
    var verifyActionText = action === 'approve' ? 'Verified' : action === 'reject' ? 'Rejected' : 'Returned for Revision';
    var verifyData = {
      action_plan_id: actionPlanId,
    organization_id: user.organization_id || workPaper.organization_id || 'HASS',
      action_description: updated.action_description || '',
      verifier_name: user.full_name || '',
      action: verifyActionText,
      comments: updated.auditor_review_comments || '',
      observation_title: verifyParentWp ? verifyParentWp.observation_title : '',
      risk_rating: updated.risk_rating || (verifyParentWp ? verifyParentWp.risk_rating : '')
    };
    var verifyOwnerIds = parseIdList(updated.owner_ids);
    verifyOwnerIds.forEach(function(ownerId) {
      queueNotification({
        type: NOTIFICATION_TYPES.AP_VERIFIED,
        recipient_user_id: ownerId,
        data: verifyData
      });
    });
    queueHoaCcNotifications({ type: NOTIFICATION_TYPES.AP_VERIFIED, data: verifyData }, user.user_id);
  } catch (e) { console.warn('AP_VERIFIED notification failed:', e.message); }

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

  tursoSet('13_ActionPlans', actionPlanId, updated);

  // Add history
  addActionPlanHistory(actionPlanId, previousStatus, updated.status, comments, user, 'STATUS_CHANGE');

  // Queue AP_HOA_REVIEWED notification to AP owners and assigned auditor
  try {
    var hoaParentWp = updated.work_paper_id ? getWorkPaperById(updated.work_paper_id) : null;
    var hoaActionText = action === 'approve' ? 'Approved' : 'Rejected';
    var hoaReviewData = {
      action_plan_id: actionPlanId,
    organization_id: user.organization_id || workPaper.organization_id || 'HASS',
      action_description: updated.action_description || '',
      hoa_action: hoaActionText,
      comments: comments || '',
      reviewer_name: user.full_name || '',
      observation_title: hoaParentWp ? hoaParentWp.observation_title : '',
      risk_rating: updated.risk_rating || (hoaParentWp ? hoaParentWp.risk_rating : '')
    };
    // Notify AP owners
    var hoaOwnerIds = parseIdList(updated.owner_ids);
    hoaOwnerIds.forEach(function(ownerId) {
      queueNotification({
        type: NOTIFICATION_TYPES.AP_HOA_REVIEWED,
        recipient_user_id: ownerId,
        data: hoaReviewData
      });
    });
    // Notify auditor who verified (if recorded)
    if (updated.auditor_review_by && updated.auditor_review_by !== user.user_id) {
      queueNotification({
        type: NOTIFICATION_TYPES.AP_HOA_REVIEWED,
        recipient_user_id: updated.auditor_review_by,
        data: hoaReviewData
      });
    }
    // CC other HOA users
    queueHoaCcNotifications({ type: NOTIFICATION_TYPES.AP_HOA_REVIEWED, data: hoaReviewData }, user.user_id);
  } catch (e) { console.warn('AP_HOA_REVIEWED notification failed:', e.message); }

  // Log audit event
  logAuditEvent('HOA_REVIEW', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);

  return sanitizeForClient({ success: true, actionPlan: updated });
}

/**
 * Update status based on due date (called by daily trigger)
 */
function updateOverdueStatuses() {
  var now = new Date().toISOString();

  tursoQuery_SQL(
    "UPDATE action_plans SET status='Overdue', updated_at=? WHERE status IN ('Not Due','Pending','In Progress') AND due_date < ? AND deleted_at IS NULL",
    [now, now]
  );

  tursoQuery_SQL(
    "UPDATE action_plans SET status='Pending', updated_at=? WHERE status='Not Due' AND due_date >= ? AND deleted_at IS NULL",
    [now, now]
  );

  console.log('updateOverdueStatuses: direct SQL update complete');
  return 0;
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

  // Cannot delegate closed/verified action plans (SUPER_ADMIN can delegate any status)
  var closedStatuses = [STATUS.ACTION_PLAN.VERIFIED, STATUS.ACTION_PLAN.CLOSED, STATUS.ACTION_PLAN.NOT_IMPLEMENTED];
  if (closedStatuses.includes(actionPlan.status) && user.role_code !== ROLES.SUPER_ADMIN) {
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

  // Update action_plan_owners junction
  tursoQuery_SQL(
    'UPDATE action_plan_owners SET is_current=0, removed_at=?, removed_by=? WHERE action_plan_id=? AND is_current=1',
    [now.toISOString(), user.user_id, actionPlanId]
  );
  String(newOwnerIds || '').split(',').filter(Boolean).forEach(function(userId) {
    tursoQuery_SQL(
      'INSERT OR IGNORE INTO action_plan_owners (action_plan_id, user_id, is_original, is_current, added_by, added_at) VALUES (?,?,0,1,?,?)',
      [actionPlanId, userId.trim(), user.user_id, now.toISOString()]
    );
  });

  // Strip owner_ids/owner_names from updates object before writing to action_plans table
  delete updated.owner_ids;
  delete updated.owner_names;
  delete updated.original_owner_ids;

  tursoSet('13_ActionPlans', actionPlanId, updated);

  // Add history
  var historyComment = 'Delegated from ' + (actionPlan.owner_ids || 'previous owner') +
    ' to ' + (newOwnerNames || newOwnerIds) +
    (notes ? '. Reason: ' + notes : '');
  addActionPlanHistory(actionPlanId, previousStatus, previousStatus, historyComment, user, 'DELEGATION');

  // Log audit event
  logAuditEvent('DELEGATE', 'ACTION_PLAN', actionPlanId, actionPlan, updated, user.user_id, user.email);

  // Queue AP_DELEGATED notification to new owners
  try {
    var delegParentWp = updated.work_paper_id ? getWorkPaperById(updated.work_paper_id) : null;
    var delegData = {
      action_plan_id: actionPlanId,
    organization_id: user.organization_id || workPaper.organization_id || 'HASS',
      action_description: updated.action_description || '',
      delegator_name: user.full_name || '',
      delegation_notes: updated.delegation_notes || '',
      parent_observation: delegParentWp ? delegParentWp.observation_title : '',
      due_date: updated.due_date || '',
      risk_rating: updated.risk_rating || (delegParentWp ? delegParentWp.risk_rating : '')
    };
    var delegOwnerIds = parseIdList(updated.owner_ids);
    delegOwnerIds.forEach(function(ownerId) {
      queueNotification({
        type: NOTIFICATION_TYPES.AP_DELEGATED,
        recipient_user_id: ownerId,
        data: delegData
      });
    });
    queueHoaCcNotifications({ type: NOTIFICATION_TYPES.AP_DELEGATED, data: delegData }, user.user_id);
  } catch (e) { console.warn('AP_DELEGATED notification failed:', e.message); }

  return sanitizeForClient({ success: true, actionPlan: updated, message: 'Action plan delegated successfully.' });
}

// queueDelegationNotification removed — replaced by universal queueNotification()

function addActionPlanEvidence(actionPlanId, evidenceData, user) {
  if (!user) throw new Error('User required');

  const actionPlan = getActionPlanRaw(actionPlanId);
  if (!actionPlan) throw new Error('Action plan not found');

  const ownerIds = parseIdList(actionPlan.owner_ids);
  const isOwner = ownerIds.includes(user.user_id);
  const isAuditor = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR].includes(user.role_code);

  if (!isOwner && !isAuditor) {
    throw new Error('Permission denied: Cannot add evidence');
  }

  const fileId = generateId('EVIDENCE');
  tursoSet('14_ActionPlanEvidence', fileId, {
    file_id:          fileId,
    organization_id:  user.organization_id || 'HASS',
    storage_provider: 'gdrive',
    storage_id:       evidenceData.storage_id || '',
    storage_url:      evidenceData.storage_url || '',
    file_name:        sanitizeInput(evidenceData.file_name || ''),
    file_description: evidenceData.file_description ? sanitizeInput(evidenceData.file_description) : null,
    file_size:        evidenceData.file_size || null,
    mime_type:        evidenceData.mime_type || null,
    uploaded_by:      user.user_id,
    uploaded_at:      new Date().toISOString()
  });

  if (evidenceData.storage_id) {
    try { moveFileToSubfolder(evidenceData.storage_id, 'DRIVE_AP_EVIDENCE_FOLDER_ID'); } catch (e) {}
  }

  const attachId = generateId('ATT');
  tursoQuery_SQL(
    'INSERT INTO file_attachments (attachment_id, file_id, entity_type, entity_id, file_category, attached_by, attached_at) VALUES (?,?,?,?,?,?,?)',
    [attachId, fileId, 'ACTION_PLAN', actionPlanId, evidenceData.file_category || 'Evidence', user.user_id, new Date().toISOString()]
  );

  addActionPlanHistory(actionPlanId, actionPlan.status, actionPlan.status,
    'Evidence uploaded: ' + sanitizeInput(evidenceData.file_name || ''), user, 'EVIDENCE_ADDED');

  logAuditEvent('ADD_EVIDENCE', 'ACTION_PLAN', actionPlanId, null, { file_id: fileId }, user.user_id, user.email);

  return sanitizeForClient({ success: true, evidenceId: fileId, evidence: { file_id: fileId } });
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
      if (existing.storage_id) {
        try {
          DriveApp.getFileById(existing.storage_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash evidence file:', e);
        }
      }

      tursoDelete('14_ActionPlanEvidence', evidenceId);

      logAuditEvent('DELETE_EVIDENCE', 'ACTION_PLAN', existing.action_plan_id, existing, null, user.user_id, user.email);

      return { success: true };
    }
  }

  throw new Error('Evidence not found: ' + evidenceId);
}

function addActionPlanHistory(actionPlanId, previousStatus, newStatus, comments, user, eventType) {
  const historyId = generateId('HISTORY');
  const now = new Date();

  const history = {
    history_id: historyId,
    action_plan_id: actionPlanId,
    organization_id: user.organization_id || workPaper.organization_id || 'HASS',
    event_type: eventType || 'STATUS_CHANGE',
    previous_status: previousStatus || '',
    new_status: newStatus || '',
    comments: sanitizeInput(comments || ''),
    user_id: user.user_id,
    user_name: user.full_name,
    changed_at: now
  };

  tursoSet('15_ActionPlanHistory', historyId, history);

  return history;
}

// queueImplementationNotification and queueVerificationNotification removed
// — replaced by universal queueNotification() in 05_NotificationService.gs

function deleteRelatedRows(sheetName, foreignKeyColumn, foreignKeyValue) {
  var table = sheetName === '13_ActionPlans' ? 'action_plans'
            : sheetName === '15_ActionPlanHistory' ? 'action_plan_history'
            : null;
  if (!table) return;
  tursoQuery_SQL(
    'UPDATE ' + table + ' SET deleted_at = ? WHERE ' + foreignKeyColumn + ' = ?',
    [new Date().toISOString(), foreignKeyValue]
  );
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)
