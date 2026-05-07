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
    organization_id: user.organization_id || data.organization_id || 'HASS',
    created_by:      user.user_id,
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
    assigned_auditor_id: data.assigned_auditor_id || '',
    assigned_auditor_name: '',
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
    assigned_auditor_id: data.assigned_auditor_id || '',
    assigned_auditor_name: data.assigned_auditor_name || '',
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

  // Resolve assigned auditor name
  if (workPaper.assigned_auditor_id) {
    var assignedUser = getUserById(workPaper.assigned_auditor_id);
    if (assignedUser) {
      workPaper.assigned_auditor_name = assignedUser.full_name || '';
    }
  }

  tursoSet('09_WorkPapers', workPaperId, workPaper);

  const responsibleIds = (data.responsible_ids || '').split(',').filter(Boolean);
  const ccList = (data.cc_recipients || '').split(',').filter(Boolean);
  responsibleIds.forEach(function(userId) {
    tursoQuery_SQL(
      'INSERT OR IGNORE INTO work_paper_responsibles (work_paper_id, user_id, role_in_finding, added_by) VALUES (?, ?, ?, ?)',
      [workPaperId, userId.trim(), 'PRIMARY', user.user_id]
    );
  });
  ccList.forEach(function(email) {
    tursoQuery_SQL(
      'INSERT OR IGNORE INTO work_paper_cc_recipients (work_paper_id, email, added_at) VALUES (?, ?, ?)',
      [workPaperId, email.trim(), new Date().toISOString()]
    );
  });

  // Log audit event
  logAuditEvent('CREATE', 'WORK_PAPER', workPaperId, null, workPaper, user.user_id, user.email);

  // Queue assignment notification if auditor was assigned on create
  if (workPaper.assigned_auditor_id) {
    try {
      queueNotification({
        type: NOTIFICATION_TYPES.WP_ASSIGNMENT,
        recipient_user_id: workPaper.assigned_auditor_id,
        data: {
          work_paper_id: workPaper.work_paper_id,
          work_paper_ref: workPaper.work_paper_ref || workPaper.work_paper_id,
          observation_title: workPaper.observation_title || 'Untitled',
          risk_rating: workPaper.risk_rating || 'Not Rated',
          affiliate_code: workPaper.affiliate_code || '-',
          audit_area_id: workPaper.audit_area_id || '',
          assigned_by: user.full_name || 'Head of Internal Audit',
          assigned_at: new Date().toISOString()
        }
      });
      queueHoaCcNotifications({
        type: NOTIFICATION_TYPES.WP_ASSIGNMENT,
        data: {
          work_paper_id: workPaper.work_paper_id,
          work_paper_ref: workPaper.work_paper_ref || workPaper.work_paper_id,
          observation_title: workPaper.observation_title || 'Untitled',
          risk_rating: workPaper.risk_rating || 'Not Rated',
          affiliate_code: workPaper.affiliate_code || '-',
          audit_area_id: workPaper.audit_area_id || '',
          assigned_by: user.full_name || 'Head of Internal Audit',
          assigned_at: new Date().toISOString()
        }
      }, user.user_id);
    } catch(e) { console.warn('Assignment notification queue failed:', e.message); }
  }

  return sanitizeForClient({ success: true, workPaperId: workPaperId, workPaper: workPaper });
}

/**
 * Get work paper by ID
 */
function getWorkPaper(workPaperId, includeRelated) {
  if (!workPaperId) return null;

  var workPaper = getWorkPaperById(workPaperId);
  if (!workPaper) return null;

  var wpResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [workPaperId]
  );
  workPaper.responsible_ids = wpResponsibles.map(function(r) { return r.user_id; }).join(',');

  var wpCcRows = tursoQuery_SQL(
    'SELECT email FROM work_paper_cc_recipients WHERE work_paper_id = ?',
    [workPaperId]
  );
  workPaper.cc_recipients = wpCcRows.map(function(r) { return r.email; }).join(',');

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
  // SUPER_ADMIN bypasses all status restrictions
  const editableStatuses = [STATUS.WORK_PAPER.DRAFT, STATUS.WORK_PAPER.REVISION_REQUIRED];
  if (!editableStatuses.includes(existing.status) && user.role_code !== ROLES.SUPER_ADMIN) {
    // Allow specific fields for reviewers even in non-editable status
    const isReviewer = user.role_code === ROLES.SENIOR_AUDITOR;
    if (!isReviewer) {
      throw new Error('Work paper cannot be edited in current status: ' + existing.status);
    }
  }

  const now = new Date();
  
  // Build update object (only update provided fields)
  const updates = {};
  const allEditableFields = [
    'year', 'affiliate_code', 'audit_area_id', 'sub_area_id',
    'work_paper_date', 'audit_period_from', 'audit_period_to',
    'control_objectives', 'control_classification', 'control_type', 'control_frequency', 'control_standards',
    'risk_description', 'test_objective', 'testing_steps',
    'observation_title', 'observation_description', 'risk_rating', 'risk_summary', 'recommendation',
    'management_response', 'responsible_ids', 'cc_recipients',
    'assigned_auditor_id', 'assigned_auditor_name',
    'evidence_override'
  ];

  // Assigned auditors can only edit testing/evidence fields (backend enforcement)
  const auditorEditableFields = [
    'control_objectives', 'risk_description', 'test_objective', 'testing_steps',
    'control_classification', 'control_type', 'control_frequency', 'control_standards',
    'observation_description', 'recommendation'
  ];

  var editableFields = allEditableFields;
  if (user.role_code !== ROLES.SUPER_ADMIN &&
      existing.assigned_auditor_id && existing.assigned_auditor_id === user.user_id) {
    // Assigned auditor: restrict to testing/evidence fields only
    editableFields = auditorEditableFields;
  }

  editableFields.forEach(field => {
    if (data[field] !== undefined) {
      updates[field] = typeof data[field] === 'string' ? sanitizeInput(data[field]) : data[field];
    }
  });

  // evidence_override is SUPER_ADMIN-only — strip if non-SUPER_ADMIN
  if (user.role_code !== ROLES.SUPER_ADMIN) {
    delete updates.evidence_override;
  }

  // If assigned_auditor_id is being changed, look up the name
  if (updates.assigned_auditor_id && updates.assigned_auditor_id !== existing.assigned_auditor_id) {
    var assignedUser = getUserById(updates.assigned_auditor_id);
    if (assignedUser) {
      updates.assigned_auditor_name = assignedUser.full_name || '';
    }
  }

  updates.updated_at = now;

  // Handle junction tables for responsible_ids and cc_recipients
  const newResponsibleIds = updates.responsible_ids;
  const newCcRecipients = updates.cc_recipients;
  delete updates.responsible_ids;
  delete updates.cc_recipients;

  if (newResponsibleIds !== undefined) {
    tursoQuery_SQL('DELETE FROM work_paper_responsibles WHERE work_paper_id = ?', [workPaperId]);
    String(newResponsibleIds || '').split(',').filter(Boolean).forEach(function(userId) {
      tursoQuery_SQL(
        'INSERT OR IGNORE INTO work_paper_responsibles (work_paper_id, user_id, role_in_finding, added_by) VALUES (?, ?, ?, ?)',
        [workPaperId, userId.trim(), 'PRIMARY', user.user_id]
      );
    });
  }

  if (newCcRecipients !== undefined) {
    tursoQuery_SQL('DELETE FROM work_paper_cc_recipients WHERE work_paper_id = ?', [workPaperId]);
    String(newCcRecipients || '').split(',').filter(Boolean).forEach(function(email) {
      tursoQuery_SQL(
        'INSERT OR IGNORE INTO work_paper_cc_recipients (work_paper_id, email, added_at) VALUES (?, ?, ?)',
        [workPaperId, email.trim(), new Date().toISOString()]
      );
    });
  }

  // Snapshot before applying updates (for change notification)
  var oldWP = { ...existing };

  // Apply updates to existing
  const updated = { ...existing, ...updates };

  tursoSet('09_WorkPapers', workPaperId, updated);

  // Log audit event
  logAuditEvent('UPDATE', 'WORK_PAPER', workPaperId, existing, updated, user.user_id, user.email);

  // Queue assignment notification if assigned_auditor_id changed
  if (updated.assigned_auditor_id && updated.assigned_auditor_id !== existing.assigned_auditor_id) {
    try {
      var assignData = {
        work_paper_id: updated.work_paper_id,
        work_paper_ref: updated.work_paper_ref || updated.work_paper_id,
        observation_title: updated.observation_title || 'Untitled',
        risk_rating: updated.risk_rating || 'Not Rated',
        affiliate_code: updated.affiliate_code || '-',
        audit_area_id: updated.audit_area_id || '',
        assigned_by: user.full_name || 'Head of Internal Audit',
        assigned_at: new Date().toISOString()
      };
      queueNotification({
        type: NOTIFICATION_TYPES.WP_ASSIGNMENT,
        recipient_user_id: updated.assigned_auditor_id,
        data: assignData
      });
      queueHoaCcNotifications({ type: NOTIFICATION_TYPES.WP_ASSIGNMENT, data: assignData }, user.user_id);
    } catch(e) { console.warn('Assignment notification queue failed:', e.message); }
  }

  // Queue change notification to assigned auditor if someone else edited their WP
  if (updated.assigned_auditor_id && updated.assigned_auditor_id !== user.user_id) {
    try {
      var wpChanges = computeWPChangeSummary(oldWP, updates);
      if (wpChanges.length > 0) {
        var changeData = {
          work_paper_id: updated.work_paper_id,
          work_paper_ref: updated.work_paper_ref || updated.work_paper_id,
          observation_title: updated.observation_title || 'Untitled',
          changes: wpChanges,
          changed_by: user.full_name || 'A team member',
          changed_at: new Date().toISOString()
        };
        queueNotification({
          type: NOTIFICATION_TYPES.WP_CHANGE,
          recipient_user_id: updated.assigned_auditor_id,
          data: changeData
        });
        queueHoaCcNotifications({ type: NOTIFICATION_TYPES.WP_CHANGE, data: changeData }, user.user_id);
      }
    } catch (e) {
      console.warn('WP change notification queue failed:', e.message);
    }
  }

  return sanitizeForClient({ success: true, workPaper: updated });
}

// queueAssignmentBatch and queueChangeBatch removed — replaced by universal queueNotification()

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
  
  // Only allow deletion of drafts (SUPER_ADMIN can delete any status)
  if (existing.status !== STATUS.WORK_PAPER.DRAFT && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Only draft work papers can be deleted');
  }

  tursoDelete('09_WorkPapers', workPaperId);

  // Log audit event
  logAuditEvent('DELETE', 'WORK_PAPER', workPaperId, existing, null, user.user_id, user.email);

  return { success: true };
}

/**
 * Get work paper by ID without sanitization (for internal use)
 */
function getWorkPaperRaw(workPaperId) {
  if (!workPaperId) return null;
  var wp = getWorkPaperById(workPaperId);
  if (!wp) return null;

  var rawResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [workPaperId]
  );
  wp.responsible_ids = rawResponsibles.map(function(r) { return r.user_id; }).join(',');

  var rawCc = tursoQuery_SQL(
    'SELECT email FROM work_paper_cc_recipients WHERE work_paper_id = ?',
    [workPaperId]
  );
  wp.cc_recipients = rawCc.map(function(r) { return r.email; }).join(',');

  return wp;
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

      // JUNIOR_STAFF (Audit Client), SENIOR_MGMT, UNIT_MANAGER: NO ACCESS to Work Papers module
      // They interact with observations via Path 2 (AuditeeFindings/AuditeeResponse)
      if (roleCode === ROLES.JUNIOR_STAFF || roleCode === ROLES.SENIOR_MGMT || roleCode === ROLES.UNIT_MANAGER) {
        match = false;
      }

      // BOARD_MEMBER and EXTERNAL_AUDITOR can only see approved/sent work papers
      if (roleCode === ROLES.BOARD_MEMBER || roleCode === ROLES.EXTERNAL_AUDITOR) {
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
  
  // Validate status (SUPER_ADMIN can submit from any status)
  const allowedStatuses = [STATUS.WORK_PAPER.DRAFT, STATUS.WORK_PAPER.REVISION_REQUIRED];
  if (!allowedStatuses.includes(workPaper.status) && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Work paper cannot be submitted from status: ' + workPaper.status);
  }
  
  // Role-based required field validation
  var basicRequired = ['observation_title', 'risk_rating', 'affiliate_code', 'audit_area_id', 'year'];
  var auditorRequired = basicRequired.concat([
    'sub_area_id', 'work_paper_date', 'audit_period_from', 'audit_period_to',
    'observation_description', 'risk_summary', 'recommendation',
    'control_objectives', 'risk_description', 'test_objective', 'testing_steps',
    'control_classification', 'control_type', 'control_frequency'
  ]);

  var requiredFields = (user.role_code === ROLES.SUPER_ADMIN) ? basicRequired : auditorRequired;
  const missing = requiredFields.filter(f => !workPaper[f] || String(workPaper[f]).trim() === '');
  if (missing.length > 0) {
    throw new Error('Missing required fields: ' + missing.join(', '));
  }

  // Evidence check for non-SUPER_ADMIN (skip if evidence_override is set)
  if (user.role_code !== ROLES.SUPER_ADMIN) {
    var evidenceOverride = workPaper.evidence_override === true || workPaper.evidence_override === 'true';
    if (!evidenceOverride) {
      var wpFiles = getWorkPaperFiles(workPaperId);
      if (!wpFiles || wpFiles.length === 0) {
        throw new Error('At least one evidence document is required before submitting for review.');
      }
    }
  }
  
  const now = new Date();
  const updates = {
    status: STATUS.WORK_PAPER.SUBMITTED,
    submitted_date: now,
    updated_at: now
  };
  
  const updated = { ...workPaper, ...updates };

  // Critical: update the work paper first
  tursoSet('09_WorkPapers', workPaperId, updated);

  // Batch secondary writes (revision + audit log) in one HTTP call
  try {
    var revisionId = generateId('REVISION');
    var logId = generateId('LOG');

    // Get next revision number
    var existingRevisions = getWorkPaperRevisions(workPaperId);
    var nextNum = existingRevisions.length > 0 ? Math.max(...existingRevisions.map(r => r.revision_number || 0)) + 1 : 1;

    var revisionObj = {
      revision_id: revisionId,
      work_paper_id: workPaperId,
      revision_number: nextNum,
      action: 'Submitted',
      from_status: workPaper.status,
      to_status: STATUS.WORK_PAPER.SUBMITTED,
      comments: 'Submitted for review',
      changes_summary: '',
      user_id: user.user_id,
      user_name: user.full_name,
      action_date: now
    };

    var logObj = {
      log_id: logId,
      action: 'SUBMIT',
      entity_type: 'WORK_PAPER',
      entity_id: workPaperId,
      old_data: JSON.stringify(workPaper),
      new_data: JSON.stringify(updated),
      user_id: user.user_id || '',
      user_email: user.email || '',
      timestamp: new Date().toISOString(),
      ip_address: ''
    };

    tursoBatchWrite([
      { sheetName: '12_WorkPaperRevisions', docId: revisionId, data: revisionObj },
      { sheetName: '16_AuditLog', docId: logId, data: logObj }
    ]);
  } catch(e) { console.warn('Secondary writes failed (non-fatal):', e.message); }

  // Queue WP_SUBMITTED notifications to all HOA/Senior Auditor users
  try {
    var submitData = {
      work_paper_id: workPaperId,
      work_paper_ref: updated.work_paper_ref || workPaperId,
      observation_title: updated.observation_title || '',
      risk_rating: updated.risk_rating || '',
      affiliate_code: updated.affiliate_code || '',
      submitter_name: user.full_name || ''
    };
    var reviewers = getUsersDropdown().filter(function(u) {
      return u.roleCode === ROLES.SENIOR_AUDITOR || u.roleCode === ROLES.SUPER_ADMIN;
    });
    reviewers.forEach(function(reviewer) {
      queueNotification({
        type: NOTIFICATION_TYPES.WP_SUBMITTED,
        recipient_user_id: reviewer.id,
        data: submitData
      });
    });
  } catch(e) { console.warn('WP_SUBMITTED notification failed:', e.message); }

  return sanitizeForClient({ success: true, workPaper: updated });
}

/**
 * Get auto-populate data for testing fields based on matching work papers or sub-area templates.
 * Priority: 1) Existing completed WP with same audit_area + sub_area + affiliate, 2) Sub-area template data.
 */
function getAutoPopulateData(auditAreaId, subAreaId, affiliateCode) {
  if (!auditAreaId || !subAreaId) return null;

  // Try to find a completed work paper with matching criteria
  try {
    var allWps = getSheetData(SHEETS.WORK_PAPERS);
    if (allWps && allWps.length > 1) {
      var headers = allWps[0];
      var areaIdx = headers.indexOf('audit_area_id');
      var subIdx = headers.indexOf('sub_area_id');
      var affIdx = headers.indexOf('affiliate_code');
      var statusIdx = headers.indexOf('status');
      var createdIdx = headers.indexOf('created_at');
      var wpIdIdx = headers.indexOf('work_paper_id');

      var completedStatuses = ['Approved', 'Sent to Auditee'];
      var matches = [];

      for (var i = 1; i < allWps.length; i++) {
        var row = allWps[i];
        if (row[areaIdx] === auditAreaId && row[subIdx] === subAreaId &&
            (!affiliateCode || row[affIdx] === affiliateCode) &&
            completedStatuses.indexOf(row[statusIdx]) !== -1) {
          var obj = {};
          headers.forEach(function(h, idx) { obj[h] = row[idx]; });
          matches.push(obj);
        }
      }

      if (matches.length > 0) {
        // Sort by created_at descending
        matches.sort(function(a, b) {
          return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });
        var wp = matches[0];
        return sanitizeForClient({
          source: 'existing_wp',
          wp_id: wp.work_paper_id || '',
          control_objectives: wp.control_objectives || '',
          risk_description: wp.risk_description || '',
          test_objective: wp.test_objective || '',
          testing_steps: wp.testing_steps || '',
          control_classification: wp.control_classification || '',
          control_type: wp.control_type || '',
          control_frequency: wp.control_frequency || '',
          control_standards: wp.control_standards || ''
        });
      }
    }
  } catch (e) {
    console.warn('getAutoPopulateData WP lookup failed:', e.message);
  }

  // Fallback: try sub-area template data
  try {
    var subAreas = getSheetData(SHEETS.SUB_AREAS);
    if (subAreas && subAreas.length > 1) {
      var saHeaders = subAreas[0];
      var saIdIdx = saHeaders.indexOf('sub_area_id');

      for (var j = 1; j < subAreas.length; j++) {
        if (subAreas[j][saIdIdx] === subAreaId) {
          var sa = {};
          saHeaders.forEach(function(h, idx) { sa[h] = subAreas[j][idx]; });
          return sanitizeForClient({
            source: 'sub_area',
            control_objectives: sa.control_objectives || '',
            risk_description: sa.risk_description || '',
            test_objective: sa.test_objective || '',
            testing_steps: sa.testing_steps || ''
          });
        }
      }
    }
  } catch (e) {
    console.warn('getAutoPopulateData sub-area lookup failed:', e.message);
  }

  return null;
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
  
  // Validate status (SUPER_ADMIN can review from any status)
  if (workPaper.status !== STATUS.WORK_PAPER.SUBMITTED && workPaper.status !== STATUS.WORK_PAPER.UNDER_REVIEW && user.role_code !== ROLES.SUPER_ADMIN) {
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
  if (!transition.from.includes(workPaper.status) && user.role_code !== ROLES.SUPER_ADMIN) {
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

  tursoSet('09_WorkPapers', workPaperId, updated);

  // Add revision history
  addWorkPaperRevision(workPaperId, revisionAction, comments, user, workPaper.status, updates.status);

  // Queue WP_REVIEWED notification to preparer
  try {
    if (action !== 'start_review') {
      var reviewAction = action === 'approve' ? 'Approved' : 'Returned for Revision';
      var reviewData = {
        work_paper_id: workPaperId,
        work_paper_ref: updated.work_paper_ref || workPaperId,
        observation_title: updated.observation_title || '',
        action: reviewAction,
        reviewer_name: user.full_name || '',
        comments: comments || '',
        previous_status: workPaper.status,
        new_status: updated.status
      };

      // Notify preparer
      if (updated.prepared_by_id && updated.prepared_by_id !== user.user_id) {
        queueNotification({
          type: NOTIFICATION_TYPES.WP_REVIEWED,
          recipient_user_id: updated.prepared_by_id,
          data: reviewData
        });
      }

      // Notify assigned auditor (if different from preparer and reviewer)
      if (updated.assigned_auditor_id && updated.assigned_auditor_id !== user.user_id && updated.assigned_auditor_id !== updated.prepared_by_id) {
        queueNotification({
          type: NOTIFICATION_TYPES.WP_REVIEWED,
          recipient_user_id: updated.assigned_auditor_id,
          data: reviewData
        });
      }

      // CC HOA
      queueHoaCcNotifications({ type: NOTIFICATION_TYPES.WP_REVIEWED, data: reviewData }, user.user_id);
    }
  } catch(e) {
    console.warn('WP_REVIEWED notification failed:', e.message);
  }

  // Log audit event
  logAuditEvent('REVIEW', 'WORK_PAPER', workPaperId, workPaper, updated, user.user_id, user.email);

  // ── AUTO-QUEUE: On approval, automatically send to auditee if ready ──
  if (action === 'approve' && updated.responsible_ids) {
    try {
      var autoSendResult = sendToAuditee(workPaperId, user);
      if (autoSendResult && autoSendResult.success) {
        console.log('Auto-queued: Work paper', workPaperId, 'sent to auditee on approval');
        return sanitizeForClient({ success: true, workPaper: autoSendResult.workPaper || updated, autoQueued: true });
      }
    } catch (autoSendErr) {
      console.warn('Auto-queue on approval failed (non-fatal):', autoSendErr.message);
    }
  }

  return sanitizeForClient({ success: true, workPaper: updated });
}

/**
 * Send work paper to auditee
 */
function sendToAuditee(workPaperId, user) {
  if (!user) throw new Error('User required');

  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');

  // Must be approved (SUPER_ADMIN can send from any status)
  if (workPaper.status !== STATUS.WORK_PAPER.APPROVED && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Work paper must be approved before sending to auditee');
  }

  // Validate mandatory fields before sending to auditee
  var sendMissing = [];
  if (!workPaper.responsible_ids || String(workPaper.responsible_ids).trim() === '') {
    sendMissing.push('Responsible Parties');
  }
  if (!workPaper.cc_recipients || String(workPaper.cc_recipients).trim() === '') {
    sendMissing.push('CC Recipients');
  }
  if (!workPaper.observation_title || String(workPaper.observation_title).trim() === '') {
    sendMissing.push('Observation Title');
  }
  if (!workPaper.observation_description || String(workPaper.observation_description).trim() === '') {
    sendMissing.push('Observation Description');
  }
  if (!workPaper.risk_rating || String(workPaper.risk_rating).trim() === '') {
    sendMissing.push('Risk Rating');
  }
  if (sendMissing.length > 0) {
    throw new Error('Cannot send to auditee. Missing required fields: ' + sendMissing.join(', '));
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

  tursoSet('09_WorkPapers', workPaperId, updated);

  // Verify critical fields were persisted
  var verification = tursoGet('09_WorkPapers', workPaperId);
  if (!verification || verification.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
    console.error('sendToAuditee: write verification FAILED for', workPaperId,
      'Expected status:', STATUS.WORK_PAPER.SENT_TO_AUDITEE,
      'Got:', verification ? verification.status : 'null document');
    throw new Error('Failed to update work paper status in database. Please try again.');
  }
  var verifyResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [workPaperId]
  );
  if (!verifyResponsibles || verifyResponsibles.length === 0) {
    console.error('sendToAuditee: responsible_ids is empty after write for', workPaperId);
    throw new Error('Responsible parties were not saved correctly. Please verify and try again.');
  }
  console.log('sendToAuditee: Verified —', workPaperId,
    'status:', verification.status,
    'responsible_ids:', verifyResponsibles.map(function(r) { return r.user_id; }).join(','),
    'response_status:', verification.response_status);

  // Add revision history
  addWorkPaperRevision(workPaperId, 'Sent to Auditee', 'Work paper sent to auditee for response', user,
    STATUS.WORK_PAPER.APPROVED, STATUS.WORK_PAPER.SENT_TO_AUDITEE);

  // ── AUTO-CREATE ACTION PLAN for auditees ──
  // Creates a skeleton action plan so that responsible parties see it
  // immediately in their portal. They fill in their response/action.
  try {
    var existingAPs = getActionPlansByWorkPaperRaw(workPaperId);
    if (existingAPs.length === 0) {
      // Resolve owner names from responsible_ids
      var ownerIds = parseIdList(workPaper.responsible_ids);
      // Filter out inactive responsible parties
      var activeOwnerIds = ownerIds.filter(function(id) {
        var u = getUserById(id);
        return u && isActive(u.is_active);
      });
      if (activeOwnerIds.length === 0) {
        throw new Error('All assigned responsible parties are inactive. Please reassign before sending.');
      }
      ownerIds = activeOwnerIds;
      var ownerNames = ownerIds.map(function(id) {
        var u = getUserById(id);
        return u ? u.full_name : id;
      }).join(', ');

      // Default due date: 30 days from now
      var defaultDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      createActionPlan({
        work_paper_id: workPaperId,
        action_description: workPaper.recommendation || workPaper.observation_title || 'Respond to audit observation',
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

  // Queue WP_SENT_TO_AUDITEE notifications to each responsible party (URGENT)
  try {
    var sendResponsibles = tursoQuery_SQL(
      'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
      [workPaperId]
    );
    var responsibleUserIds = sendResponsibles.map(function(r) { return r.user_id; });
    var auditeeData = {
      work_paper_id: workPaperId,
      work_paper_ref: updated.work_paper_ref || workPaperId,
      observation_title: updated.observation_title || '',
      observation_description: updated.observation_description || '',
      risk_rating: updated.risk_rating || '',
      recommendation: updated.recommendation || '',
      affiliate_code: updated.affiliate_code || '',
      audit_area_id: updated.audit_area_id || '',
      response_deadline: updated.response_deadline ? new Date(updated.response_deadline).toISOString() : '',
      sent_by: user.full_name || ''
    };
    responsibleUserIds.forEach(function(userId) {
      queueNotification({
        type: NOTIFICATION_TYPES.WP_SENT_TO_AUDITEE,
        recipient_user_id: userId,
        data: auditeeData,
        priority: 'urgent'
      });
    });
    // CC HOA
    queueHoaCcNotifications({ type: NOTIFICATION_TYPES.WP_SENT_TO_AUDITEE, data: auditeeData, priority: 'urgent' }, user.user_id);
  } catch (e) {
    console.warn('WP_SENT_TO_AUDITEE notification failed:', e.message);
  }

  // Log audit event
  logAuditEvent('SEND_TO_AUDITEE', 'WORK_PAPER', workPaperId, workPaper, updated, user.user_id, user.email);

  // Notify assigned auditor that WP was sent to auditee (if different from sender)
  if (updated.assigned_auditor_id && updated.assigned_auditor_id !== user.user_id) {
    try {
      queueNotification({
        type: NOTIFICATION_TYPES.WP_SENT_TO_AUDITEE,
        recipient_user_id: updated.assigned_auditor_id,
        data: {
          work_paper_id: workPaperId,
          work_paper_ref: updated.work_paper_ref || workPaperId,
          observation_title: updated.observation_title || '',
          risk_rating: updated.risk_rating || '',
          action: 'Sent to Auditee',
          sent_by: user.full_name || ''
        },
        priority: 'urgent'
      });
    } catch (e) {
      console.warn('WP sent-to-auditee notification to assigned auditor failed:', e.message);
    }
  }

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
  
  tursoSet('10_WorkPaperRequirements', requirementId, requirement);

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

      tursoSet('10_WorkPaperRequirements', requirementId, updated);

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

      tursoDelete('10_WorkPaperRequirements', requirementId);

      logAuditEvent('DELETE_REQUIREMENT', 'WORK_PAPER', existing.work_paper_id, existing, null, user.user_id, user.email);

      return { success: true };
    }
  }

  throw new Error('Requirement not found: ' + requirementId);
}

function addWorkPaperFile(workPaperId, data, user) {
  if (!user) throw new Error('User required');

  const workPaper = getWorkPaperRaw(workPaperId);
  if (!workPaper) throw new Error('Work paper not found');

  const fileId = generateId('FILE');
  tursoSet('11_WorkPaperFiles', fileId, {
    file_id:          fileId,
    organization_id:  user.organization_id || 'HASS',
    storage_provider: 'gdrive',
    storage_id:       data.storage_id || '',
    storage_url:      data.storage_url || '',
    file_name:        sanitizeInput(data.file_name || ''),
    file_description: data.file_description ? sanitizeInput(data.file_description) : null,
    file_size:        data.file_size || null,
    mime_type:        data.mime_type || null,
    uploaded_by:      user.user_id,
    uploaded_at:      new Date().toISOString()
  });

  if (data.storage_id) {
    try { moveFileToSubfolder(data.storage_id, 'DRIVE_WP_FILES_FOLDER_ID'); } catch (e) {}
  }

  const attachId = generateId('ATT');
  tursoQuery_SQL(
    'INSERT INTO file_attachments (attachment_id, file_id, entity_type, entity_id, file_category, attached_by, attached_at) VALUES (?,?,?,?,?,?,?)',
    [attachId, fileId, 'WORK_PAPER', workPaperId, data.file_category || 'Evidence', user.user_id, new Date().toISOString()]
  );

  logAuditEvent('ADD_FILE', 'WORK_PAPER', workPaperId, null, { file_id: fileId }, user.user_id, user.email);

  return sanitizeForClient({ success: true, fileId: fileId, file: { file_id: fileId } });
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
      if (existing.storage_id) {
        try {
          DriveApp.getFileById(existing.storage_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash Drive file:', e);
        }
      }

      tursoDelete('11_WorkPaperFiles', fileId);

      logAuditEvent('DELETE_FILE', 'WORK_PAPER', existing.work_paper_id, existing, null, user.user_id, user.email);

      return { success: true };
    }
  }

  throw new Error('File not found: ' + fileId);
}

function addWorkPaperRevision(workPaperId, action, comments, user, fromStatus, toStatus) {
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
    from_status: fromStatus || '',
    to_status: toStatus || '',
    comments: sanitizeInput(comments || ''),
    changes_summary: '',
    user_id: user.user_id,
    user_name: user.full_name,
    action_date: now
  };

  tursoSet('12_WorkPaperRevisions', revisionId, revision);

  return revision;
}

// queueReviewNotification and queueStatusNotification removed — replaced by universal queueNotification()

// queueAuditeeNotification, sendBatchedAuditeeNotifications, and old queueNotification
// removed — replaced by universal queueNotification() in 05_NotificationService.gs

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
        organization_id: user.organization_id || wp.organization_id || 'HASS',
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

      tursoSet('09_WorkPapers', wp.work_paper_id, updated);

      // Add revision history
      addWorkPaperRevision(wp.work_paper_id, 'Sent to Auditee', 'Batch sent to auditee', user,
        STATUS.WORK_PAPER.APPROVED, STATUS.WORK_PAPER.SENT_TO_AUDITEE);

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
            action_description: wp.recommendation || wp.observation_title || 'Respond to audit observation',
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

  // Invalidate script cache
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

/**
 * Request a change to a locked field on a work paper.
 * Notifies all SUPER_ADMIN (HOA) users and logs a revision.
 */
function requestWorkPaperChange(params, user) {
  var workPaperId = params.workPaperId;
  var field = params.field;
  var description = params.description;

  if (!workPaperId || !field || !description) {
    throw new Error('Missing required parameters: workPaperId, field, and description are required.');
  }

  // Get work paper details
  var wp = getWorkPaperById(workPaperId);
  if (!wp) throw new Error('Work paper not found: ' + workPaperId);

  var wpRef = wp.work_paper_ref || workPaperId;
  var obsTitle = wp.observation_title || 'Untitled';

  // Find HOA users (SUPER_ADMIN)
  var allUsers = getUsersDropdown();
  var hoaUsers = allUsers.filter(function(u) { return u.roleCode === ROLES.SUPER_ADMIN; });

  // Queue notification to each HOA user
  var subject = 'Change Requested: ' + wpRef + ' — ' + sanitizeInput(field);
  var body = 'A change has been requested by ' + (user.full_name || user.email) + '.\n\n' +
    'Work Paper: ' + wpRef + '\n' +
    'Observation: ' + obsTitle + '\n' +
    'Field: ' + sanitizeInput(field) + '\n' +
    'Description: ' + sanitizeInput(description);

  hoaUsers.forEach(function(hoa) {
    queueNotification({
      template_code: 'WP_CHANGE_REQUEST',
      recipient_user_id: hoa.id,
      recipient_email: hoa.email,
      subject: subject,
      body: body,
      module: 'WORK_PAPER',
      record_id: workPaperId
    });
  });

  // Log revision
  addWorkPaperRevision(workPaperId, 'Change Requested', sanitizeInput(field) + ': ' + sanitizeInput(description), user);

  return sanitizeForClient({ success: true });
}

// sanitizeInput() is defined in 01_Core.gs (canonical)
// sanitizeForClient() is defined in 01_Core.gs (canonical)
