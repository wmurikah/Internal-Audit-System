// 10_AuditeeService.gs - Auditee Response Workflow
// Handles: My Findings, management responses, response lifecycle,
// auditee-proposed action plans, delegation accept/reject, escalation.

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

var RESPONSE_DEFAULTS = {
  DEADLINE_DAYS: 14,
  MAX_ROUNDS: 3
};

// ─────────────────────────────────────────────────────────────
// My Findings — list all findings assigned to this auditee
// ─────────────────────────────────────────────────────────────

/**
 * Get all work papers assigned to the current auditee.
 * Returns only findings with status "Sent to Auditee" where
 * the user is in responsible_ids. Enriches with response status.
 */
function getAuditeeFindings(filters, user) {
  if (!user) throw new Error('User required');

  filters = filters || {};
  var workPapers = getWorkPapersRaw({}, null);
  var results = [];

  // Build a set of work paper IDs where the user owns a delegated action plan
  // This ensures delegatees see the parent observation even if they're not in responsible_ids
  var delegatedWPIds = {};
  try {
    var allActionPlans = getActionPlansRaw({}, null);
    for (var j = 0; j < allActionPlans.length; j++) {
      var ap = allActionPlans[j];
      var apOwnerIds = parseIdList(ap.owner_ids);
      if (apOwnerIds.includes(user.user_id) && ap.work_paper_id) {
        delegatedWPIds[ap.work_paper_id] = true;
      }
    }
  } catch (e) {
    console.warn('Failed to check delegated action plans:', e.message);
  }

  for (var i = 0; i < workPapers.length; i++) {
    var wp = workPapers[i];

    // Only show "Sent to Auditee" status work papers
    if (wp.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) continue;

    // Check if user is assigned as responsible party OR owns a delegated action plan for this WP
    var responsibleIds = parseIdList(wp.responsible_ids);
    if (!responsibleIds.includes(user.user_id) && !delegatedWPIds[wp.work_paper_id]) continue;

    // Apply optional filters
    if (filters.response_status && wp.response_status !== filters.response_status) continue;
    if (filters.risk_rating && wp.risk_rating !== filters.risk_rating) continue;
    if (filters.year && String(wp.year) !== String(filters.year)) continue;

    if (filters.search) {
      var searchLower = filters.search.toLowerCase();
      var title = String(wp.observation_title || '').toLowerCase();
      var desc = String(wp.observation_description || '').toLowerCase();
      if (!title.includes(searchLower) && !desc.includes(searchLower)) continue;
    }

    // Compute response deadline status
    var deadlinePassed = false;
    if (wp.response_deadline) {
      var deadline = new Date(wp.response_deadline);
      deadlinePassed = deadline < new Date();
    }

    // Get action plans count for this WP
    var actionPlans = getActionPlansByWorkPaperRaw(wp.work_paper_id);

    results.push({
      work_paper_id: wp.work_paper_id,
      work_paper_ref: wp.work_paper_ref || wp.work_paper_id,
      observation_title: wp.observation_title || '',
      observation_description: wp.observation_description || '',
      risk_rating: wp.risk_rating || '',
      recommendation: wp.recommendation || '',
      affiliate_code: wp.affiliate_code || '',
      audit_area_id: wp.audit_area_id || '',
      sent_to_auditee_date: wp.sent_to_auditee_date || '',
      response_status: wp.response_status || STATUS.RESPONSE.PENDING,
      response_deadline: wp.response_deadline || '',
      response_round: wp.response_round || 0,
      deadline_passed: deadlinePassed,
      management_response: wp.management_response || '',
      action_plan_count: actionPlans.length,
      cc_recipients: wp.cc_recipients || ''
    });
  }

  // Sort: pending responses first, then by deadline
  results.sort(function(a, b) {
    var aPending = (a.response_status === STATUS.RESPONSE.PENDING || a.response_status === STATUS.RESPONSE.DRAFT || a.response_status === STATUS.RESPONSE.REJECTED) ? 0 : 1;
    var bPending = (b.response_status === STATUS.RESPONSE.PENDING || b.response_status === STATUS.RESPONSE.DRAFT || b.response_status === STATUS.RESPONSE.REJECTED) ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return new Date(a.sent_to_auditee_date || 0) - new Date(b.sent_to_auditee_date || 0);
  });

  return sanitizeForClient(results);
}

/**
 * Get finding detail for the auditee response view.
 * Returns the work paper finding data plus response history.
 */
function getAuditeeResponseData(workPaperId, user) {
  if (!user) throw new Error('User required');
  if (!workPaperId) throw new Error('Work paper ID required');

  var wp = getWorkPaperById(workPaperId);
  if (!wp) throw new Error('Work paper not found: ' + workPaperId);

  // Verify access: user must be a responsible party, delegated AP owner, or SUPER_ADMIN
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);
  var isAuditor = [ROLES.SENIOR_AUDITOR, ROLES.AUDITOR].includes(user.role_code);
  var responsibleIds = parseIdList(wp.responsible_ids);
  var isAssigned = responsibleIds.includes(user.user_id);

  // Also check if user owns a delegated action plan for this work paper
  var isDelegatedOwner = false;
  if (!isSuperAdmin && !isAuditor && !isAssigned) {
    try {
      var wpActionPlans = getActionPlansByWorkPaperRaw(workPaperId);
      for (var di = 0; di < wpActionPlans.length; di++) {
        var apOwners = parseIdList(wpActionPlans[di].owner_ids);
        if (apOwners.includes(user.user_id)) {
          isDelegatedOwner = true;
          break;
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  if (!isSuperAdmin && !isAuditor && !isAssigned && !isDelegatedOwner) {
    throw new Error('Permission denied: You are not assigned to this observation');
  }

  // Get response history
  var responses = getResponseHistory(workPaperId);

  // Get action plans for this work paper
  var actionPlans = getActionPlansByWorkPaperRaw(workPaperId);

  // Get evidence files
  var files = getWorkPaperFiles(workPaperId);

  // Determine edit permissions
  var canEditResponse = false;
  var editableStatuses = [STATUS.RESPONSE.PENDING, STATUS.RESPONSE.DRAFT, STATUS.RESPONSE.REJECTED];
  var currentResponseStatus = wp.response_status || STATUS.RESPONSE.PENDING;

  if (isSuperAdmin) {
    canEditResponse = true; // SUPER_ADMIN can always edit
  } else if (isAssigned && editableStatuses.includes(currentResponseStatus)) {
    canEditResponse = true;
  }

  // Build the visible finding data (exclude internal audit notes)
  var finding = {
    work_paper_id: wp.work_paper_id,
    work_paper_ref: wp.work_paper_ref || wp.work_paper_id,
    observation_title: wp.observation_title || '',
    observation_description: wp.observation_description || '',
    risk_rating: wp.risk_rating || '',
    risk_summary: wp.risk_summary || '',
    recommendation: wp.recommendation || '',
    affiliate_code: wp.affiliate_code || '',
    audit_area_id: wp.audit_area_id || '',
    year: wp.year || '',
    sent_to_auditee_date: wp.sent_to_auditee_date || '',
    management_response: wp.management_response || '',
    response_status: currentResponseStatus,
    response_deadline: wp.response_deadline || '',
    response_round: wp.response_round || 0,
    responsible_ids: wp.responsible_ids || '',
    cc_recipients: wp.cc_recipients || ''
  };

  return sanitizeForClient({
    success: true,
    finding: finding,
    responses: responses,
    actionPlans: actionPlans,
    files: files,
    canEditResponse: canEditResponse,
    maxRounds: RESPONSE_DEFAULTS.MAX_ROUNDS,
    isSuperAdmin: isSuperAdmin,
    isAuditor: isAuditor
  });
}

// ─────────────────────────────────────────────────────────────
// Response CRUD
// ─────────────────────────────────────────────────────────────

/**
 * Save a draft response (auditee can return later to finish).
 */
function saveDraftResponse(workPaperId, data, user) {
  if (!user) throw new Error('User required');
  if (!workPaperId) throw new Error('Work paper ID required');

  var wp = getWorkPaperById(workPaperId);
  if (!wp) throw new Error('Work paper not found');

  // Permission check
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);
  var responsibleIds = parseIdList(wp.responsible_ids);
  if (!isSuperAdmin && !responsibleIds.includes(user.user_id)) {
    throw new Error('Permission denied');
  }

  var editableStatuses = [STATUS.RESPONSE.PENDING, STATUS.RESPONSE.DRAFT, STATUS.RESPONSE.REJECTED];
  var currentStatus = wp.response_status || STATUS.RESPONSE.PENDING;
  if (!isSuperAdmin && !editableStatuses.includes(currentStatus)) {
    throw new Error('Response cannot be edited in current status: ' + currentStatus);
  }

  var now = new Date();

  // Update work paper with draft management response
  var wpUpdates = {
    management_response: sanitizeInput(data.management_response || wp.management_response || ''),
    response_status: STATUS.RESPONSE.DRAFT,
    updated_at: now
  };

  var updatedWp = {};
  for (var k in wp) { updatedWp[k] = wp[k]; }
  for (var k2 in wpUpdates) { updatedWp[k2] = wpUpdates[k2]; }

  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updatedWp);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  logAuditEvent('DRAFT_RESPONSE', 'WORK_PAPER', workPaperId, wp, updatedWp, user.user_id, user.email);

  return sanitizeForClient({ success: true, message: 'Draft saved successfully' });
}

/**
 * Submit the auditee's formal response.
 * Creates an auditee_responses record and updates the work paper.
 */
function submitAuditeeResponse(workPaperId, data, user) {
  if (!user) throw new Error('User required');
  if (!workPaperId) throw new Error('Work paper ID required');

  var wp = getWorkPaperById(workPaperId);
  if (!wp) throw new Error('Work paper not found');

  // Permission check
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);
  var responsibleIds = parseIdList(wp.responsible_ids);
  if (!isSuperAdmin && !responsibleIds.includes(user.user_id)) {
    throw new Error('Permission denied');
  }

  var editableStatuses = [STATUS.RESPONSE.PENDING, STATUS.RESPONSE.DRAFT, STATUS.RESPONSE.REJECTED];
  var currentStatus = wp.response_status || STATUS.RESPONSE.PENDING;
  if (!isSuperAdmin && !editableStatuses.includes(currentStatus)) {
    throw new Error('Response cannot be submitted in current status: ' + currentStatus);
  }

  // Validate management response text
  var mgmtResponse = sanitizeInput(data.management_response || '');
  if (!mgmtResponse || mgmtResponse.trim().length < 10) {
    throw new Error('Management response must be at least 10 characters');
  }

  // Check max rounds
  var currentRound = (wp.response_round || 0) + 1;
  if (currentRound > RESPONSE_DEFAULTS.MAX_ROUNDS) {
    throw new Error('Maximum response rounds (' + RESPONSE_DEFAULTS.MAX_ROUNDS + ') exceeded. This observation will be escalated.');
  }

  var now = new Date();
  var responseId = generateId('AUDITEE_RESPONSE');

  // Collect action plan IDs that were submitted with this response
  var actionPlanIds = '';
  if (data.action_plan_ids && Array.isArray(data.action_plan_ids)) {
    actionPlanIds = data.action_plan_ids.join(',');
  }

  // Create auditee_responses record
  var responseRecord = {
    response_id: responseId,
    work_paper_id: workPaperId,
    round_number: currentRound,
    response_type: '',
    management_response: mgmtResponse,
    submitted_by_id: user.user_id,
    submitted_by_name: user.full_name || '',
    submitted_date: now,
    action_plan_ids: actionPlanIds,
    status: STATUS.REVIEW.PENDING,
    reviewed_by_id: '',
    reviewed_by_name: '',
    review_date: '',
    review_comments: '',
    created_at: now,
    updated_at: now
  };

  syncToFirestore(SHEETS.AUDITEE_RESPONSES, responseId, responseRecord);
  invalidateSheetData(SHEETS.AUDITEE_RESPONSES);

  // Update work paper
  var wpUpdates = {
    management_response: mgmtResponse,
    response_status: STATUS.RESPONSE.SUBMITTED,
    response_round: currentRound,
    response_submitted_by: user.user_id,
    response_submitted_date: now,
    updated_at: now
  };

  var updatedWp = {};
  for (var k in wp) { updatedWp[k] = wp[k]; }
  for (var k2 in wpUpdates) { updatedWp[k2] = wpUpdates[k2]; }

  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updatedWp);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Link action plans to this response
  if (data.action_plan_ids && data.action_plan_ids.length > 0) {
    data.action_plan_ids.forEach(function(apId) {
      try {
        var ap = getActionPlanById(apId);
        if (ap) {
          ap.response_id = responseId;
          ap.auditee_proposed = true;
          ap.updated_at = now;
          syncToFirestore(SHEETS.ACTION_PLANS, apId, ap);
        }
      } catch (e) {
        console.warn('Failed to link AP ' + apId + ' to response:', e.message);
      }
    });
    invalidateSheetData(SHEETS.ACTION_PLANS);
  }

  // Add work paper revision
  addWorkPaperRevision(workPaperId, 'Response Submitted',
    'Auditee response submitted (Round ' + currentRound + ').', user);

  // AI auto-evaluation (only if AI is configured)
  var aiStatus = getAIConfigStatus();
  if (aiStatus.aiEnabled) {
    try {
      var aiEval = evaluateAuditeeResponse(workPaperId, mgmtResponse, data.action_plan_ids || [], wp);
      if (aiEval && aiEval.autoReject) {
        // Auto-reject: update response status back to rejected
        wpUpdates.response_status = STATUS.RESPONSE.REJECTED;
        wpUpdates.response_review_comments = 'AI Assessment: ' + aiEval.feedback;
        updatedWp.response_status = STATUS.RESPONSE.REJECTED;
        updatedWp.response_review_comments = 'AI Assessment: ' + aiEval.feedback;
        responseRecord.status = STATUS.REVIEW.REJECTED;
        responseRecord.review_comments = aiEval.feedback;
        responseRecord.reviewed_by_id = 'AI_SYSTEM';
        responseRecord.reviewed_by_name = 'AI Auto-Review';
        responseRecord.review_date = now;
        syncToFirestore(SHEETS.AUDITEE_RESPONSES, responseId, responseRecord);
        syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updatedWp);
        // Queue rejection notification to auditee instead of auditor notification
        queueResponseRejectedNotification(workPaperId, updatedWp, aiEval.feedback, { user_id: 'AI_SYSTEM', full_name: 'AI Auto-Review' });
        logAuditEvent('AI_AUTO_REJECT', 'AUDITEE_RESPONSE', responseId, null, responseRecord, 'AI_SYSTEM', 'ai@system');
        return sanitizeForClient({
          success: true, responseId: responseId,
          message: 'Your response was automatically reviewed. Please revise: ' + aiEval.feedback,
          aiRejected: true
        });
      }
    } catch (aiErr) {
      console.warn('AI evaluation failed (non-fatal):', aiErr.message);
    }
  }

  // Queue notification to auditors
  queueResponseSubmittedNotification(workPaperId, updatedWp, responseRecord, user);

  logAuditEvent('SUBMIT_RESPONSE', 'AUDITEE_RESPONSE', responseId, null, responseRecord, user.user_id, user.email);

  return sanitizeForClient({
    success: true,
    responseId: responseId,
    message: 'Response submitted successfully. The audit team will review your response.'
  });
}

// ─────────────────────────────────────────────────────────────
// Auditor Review of Auditee Response
// ─────────────────────────────────────────────────────────────

/**
 * Review an auditee response (accept or reject).
 * Only auditors and SUPER_ADMIN can review.
 */
function reviewAuditeeResponse(workPaperId, action, comments, user) {
  if (!user) throw new Error('User required');

  var reviewerRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
  if (!reviewerRoles.includes(user.role_code)) {
    throw new Error('Permission denied: Only auditors can review responses');
  }

  var wp = getWorkPaperById(workPaperId);
  if (!wp) throw new Error('Work paper not found');

  if (wp.response_status !== STATUS.RESPONSE.SUBMITTED) {
    throw new Error('No pending response to review. Current status: ' + (wp.response_status || 'N/A'));
  }

  // Get the latest response record
  var responses = getResponseHistory(workPaperId);
  var latestResponse = responses.length > 0 ? responses[0] : null;

  if (!latestResponse) {
    throw new Error('No response record found for this work paper');
  }

  var now = new Date();

  // Update response record
  var responseUpdates = {
    status: action === 'accept' ? STATUS.REVIEW.APPROVED : STATUS.REVIEW.REJECTED,
    reviewed_by_id: user.user_id,
    reviewed_by_name: user.full_name || '',
    review_date: now,
    review_comments: sanitizeInput(comments || ''),
    updated_at: now
  };

  var updatedResponse = {};
  for (var rk in latestResponse) { updatedResponse[rk] = latestResponse[rk]; }
  for (var rk2 in responseUpdates) { updatedResponse[rk2] = responseUpdates[rk2]; }

  syncToFirestore(SHEETS.AUDITEE_RESPONSES, latestResponse.response_id, updatedResponse);

  // Update work paper
  var newResponseStatus;
  if (action === 'accept') {
    newResponseStatus = STATUS.RESPONSE.ACCEPTED;
  } else {
    // Check if max rounds exceeded -> escalate
    var currentRound = wp.response_round || 1;
    if (currentRound >= RESPONSE_DEFAULTS.MAX_ROUNDS) {
      newResponseStatus = STATUS.RESPONSE.ESCALATED;
    } else {
      newResponseStatus = STATUS.RESPONSE.REJECTED;
    }
  }

  var wpUpdates = {
    response_status: newResponseStatus,
    response_reviewed_by: user.user_id,
    response_review_date: now,
    response_review_comments: sanitizeInput(comments || ''),
    updated_at: now
  };

  var updatedWp = {};
  for (var k in wp) { updatedWp[k] = wp[k]; }
  for (var k2 in wpUpdates) { updatedWp[k2] = wpUpdates[k2]; }

  syncToFirestore(SHEETS.WORK_PAPERS, workPaperId, updatedWp);
  invalidateSheetData(SHEETS.WORK_PAPERS);

  // Add revision
  var revisionAction = action === 'accept' ? 'Response Accepted' : 'Response Rejected';
  addWorkPaperRevision(workPaperId, revisionAction, comments || '', user);

  // Queue notifications
  if (action === 'accept') {
    queueResponseAcceptedNotification(workPaperId, updatedWp, user);
  } else if (newResponseStatus === STATUS.RESPONSE.ESCALATED) {
    queueResponseEscalatedNotification(workPaperId, updatedWp, user);
  } else {
    queueResponseRejectedNotification(workPaperId, updatedWp, comments, user);
  }

  logAuditEvent('REVIEW_RESPONSE', 'WORK_PAPER', workPaperId, wp, updatedWp, user.user_id, user.email);

  return sanitizeForClient({
    success: true,
    workPaper: updatedWp,
    message: action === 'accept'
      ? 'Response accepted successfully.'
      : (newResponseStatus === STATUS.RESPONSE.ESCALATED
          ? 'Maximum rounds reached. Observation has been escalated to CC recipients.'
          : 'Response rejected. Auditee will be notified to revise.')
  });
}

// ─────────────────────────────────────────────────────────────
// Auditee Action Plan CRUD (proposed by auditee)
// ─────────────────────────────────────────────────────────────

/**
 * Create an action plan proposed by the auditee as part of their response.
 */
function createAuditeeActionPlan(data, user) {
  if (!user) throw new Error('User required');
  if (!data.work_paper_id) throw new Error('Work paper ID required');

  var wp = getWorkPaperById(data.work_paper_id);
  if (!wp) throw new Error('Work paper not found');

  // Permission: auditee must be assigned, or SUPER_ADMIN
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);
  var responsibleIds = parseIdList(wp.responsible_ids);
  if (!isSuperAdmin && !responsibleIds.includes(user.user_id)) {
    throw new Error('Permission denied');
  }

  // Validate due date
  if (data.due_date) {
    var dueDateCheck = new Date(data.due_date);
    var maxDueDate = new Date();
    maxDueDate.setMonth(maxDueDate.getMonth() + 6);
    if (dueDateCheck > maxDueDate) {
      throw new Error('Due date cannot be more than 6 months from today.');
    }
  }

  var actionPlanId = generateId('ACTION_PLAN');
  var now = new Date();

  // Get next action number
  var existingPlans = getActionPlansByWorkPaperRaw(data.work_paper_id);
  var nextNum = existingPlans.length > 0 ? Math.max.apply(null, existingPlans.map(function(p) { return p.action_number || 0; })) + 1 : 1;

  var initialStatus = STATUS.ACTION_PLAN.NOT_DUE;
  if (data.due_date) {
    var dueDate = new Date(data.due_date);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    dueDate.setHours(0, 0, 0, 0);
    if (dueDate <= today) {
      initialStatus = STATUS.ACTION_PLAN.PENDING;
    }
  }

  var actionPlan = {
    action_plan_id: actionPlanId,
    work_paper_id: data.work_paper_id,
    action_number: nextNum,
    action_description: sanitizeInput(data.action_description || ''),
    owner_ids: data.owner_ids || user.user_id,
    owner_names: data.owner_names || user.full_name || '',
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
    created_by_role: user.role_code || 'JUNIOR_STAFF',
    auditee_proposed: true,
    response_id: data.response_id || ''
  };

  syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, actionPlan);
  invalidateSheetData(SHEETS.ACTION_PLANS);

  addActionPlanHistory(actionPlanId, '', initialStatus, 'Action plan proposed by auditee', user);
  logAuditEvent('CREATE', 'ACTION_PLAN', actionPlanId, null, actionPlan, user.user_id, user.email);

  return sanitizeForClient({ success: true, actionPlanId: actionPlanId, actionPlan: actionPlan });
}

// ─────────────────────────────────────────────────────────────
// Response History
// ─────────────────────────────────────────────────────────────

/**
 * Get all response records for a work paper, sorted newest first.
 */
function getResponseHistory(workPaperId) {
  if (!workPaperId) return [];

  var allResponses = firestoreQuery(SHEETS.AUDITEE_RESPONSES, 'work_paper_id', 'EQUAL', workPaperId);
  if (!allResponses || allResponses.length === 0) return [];

  allResponses.sort(function(a, b) {
    return new Date(b.submitted_date || 0) - new Date(a.submitted_date || 0);
  });

  return allResponses;
}

// ─────────────────────────────────────────────────────────────
// Delegation Accept/Reject
// ─────────────────────────────────────────────────────────────

/**
 * Accept or reject a delegated action plan.
 * The delegatee confirms they will take ownership or rejects with reason.
 */
function respondToDelegation(actionPlanId, action, reason, user) {
  if (!user) throw new Error('User required');

  var ap = getActionPlanRaw(actionPlanId);
  if (!ap) throw new Error('Action plan not found');

  // Must be the current owner (delegatee)
  var ownerIds = String(ap.owner_ids || '').split(',').map(function(s) { return s.trim(); });
  if (!ownerIds.includes(user.user_id) && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('Permission denied: Only the assigned owner can respond to delegation');
  }

  var now = new Date();

  if (action === 'accept') {
    // Just acknowledge - no status change needed, ownership stays
    addActionPlanHistory(actionPlanId, ap.status, ap.status,
      'Delegation accepted by ' + (user.full_name || user.user_id), user);

    var acceptUpdates = { delegation_accepted: true, updated_at: now, updated_by: user.user_id };
    var acceptedAp = {};
    for (var k in ap) { acceptedAp[k] = ap[k]; }
    for (var k2 in acceptUpdates) { acceptedAp[k2] = acceptUpdates[k2]; }
    syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, acceptedAp);

    logAuditEvent('ACCEPT_DELEGATION', 'ACTION_PLAN', actionPlanId, ap, acceptedAp, user.user_id, user.email);

    return sanitizeForClient({ success: true, message: 'Delegation accepted.' });
  }

  if (action === 'reject') {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A reason is required when rejecting delegation (minimum 5 characters)');
    }

    // Revert to original owner
    var revertUpdates = {
      owner_ids: ap.original_owner_ids || ap.delegated_by_id || ap.owner_ids,
      owner_names: '', // Will be resolved below
      delegation_rejected: true,
      delegation_reject_reason: sanitizeInput(reason),
      delegation_rejected_by: user.user_id,
      delegation_rejected_date: now,
      updated_at: now,
      updated_by: user.user_id
    };

    // Resolve original owner names
    var origIds = String(revertUpdates.owner_ids).split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    revertUpdates.owner_names = origIds.map(function(id) {
      var u = getUserById(id);
      return u ? u.full_name : id;
    }).join(', ');

    var revertedAp = {};
    for (var rk in ap) { revertedAp[rk] = ap[rk]; }
    for (var rk2 in revertUpdates) { revertedAp[rk2] = revertUpdates[rk2]; }

    syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, revertedAp);
    invalidateSheetData(SHEETS.ACTION_PLANS);

    addActionPlanHistory(actionPlanId, ap.status, ap.status,
      'Delegation rejected by ' + (user.full_name || user.user_id) + '. Reason: ' + reason, user);

    // Notify the delegator
    queueDelegationRejectedNotification(actionPlanId, revertedAp, reason, user);

    logAuditEvent('REJECT_DELEGATION', 'ACTION_PLAN', actionPlanId, ap, revertedAp, user.user_id, user.email);

    return sanitizeForClient({ success: true, message: 'Delegation rejected. Ownership reverted to original owner.' });
  }

  throw new Error('Invalid action: ' + action + '. Use "accept" or "reject".');
}

// ─────────────────────────────────────────────────────────────
// Notification Helpers
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Pending Auditee Responses — for auditor review queue
// ─────────────────────────────────────────────────────────────

function getPendingAuditeeResponsesForAuditor(user) {
  if (!user) return [];
  var auditorRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
  if (auditorRoles.indexOf(user.role_code) === -1) return [];

  var allWPs = getWorkPapersRaw({}, null);
  var results = [];

  for (var i = 0; i < allWPs.length; i++) {
    var wp = allWPs[i];
    if (wp.status === 'Sent to Auditee' && wp.response_status === 'Response Submitted') {
      var latest = {};
      try {
        var responses = getResponseHistory(wp.work_paper_id);
        latest = (responses && responses.length > 0) ? responses[0] : {};
      } catch (e) { /* non-fatal */ }

      var apCount = 0;
      try {
        apCount = getActionPlansByWorkPaperRaw(wp.work_paper_id).length;
      } catch (e) { /* non-fatal */ }

      results.push({
        work_paper_id: wp.work_paper_id,
        observation_title: wp.observation_title || '',
        risk_rating: wp.risk_rating || '',
        affiliate_code: wp.affiliate_code || '',
        audit_area_id: wp.audit_area_id || '',
        response_round: wp.response_round || 1,
        response_status: wp.response_status,
        submitted_by_name: latest.submitted_by_name || '',
        submitted_date: latest.submitted_date || '',
        management_response_preview: (String(latest.management_response || '')).substring(0, 100),
        action_plan_count: apCount
      });
    }
  }

  // Sort by submitted_date ascending (oldest first — FIFO review)
  results.sort(function(a, b) {
    var da = a.submitted_date ? new Date(a.submitted_date).getTime() : 0;
    var db = b.submitted_date ? new Date(b.submitted_date).getTime() : 0;
    return da - db;
  });

  return sanitizeForClient(results);
}

function queueResponseSubmittedNotification(workPaperId, workPaper, response, submitter) {
  var auditors = getUsersDropdown().filter(function(u) {
    return [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].indexOf(u.roleCode) >= 0;
  });

  var loginUrl = ScriptApp.getService().getUrl();
  var subject = 'Auditee Response Received (Round ' + (response.round_number || 1) + ') \u2014 ' + (workPaper.observation_title || workPaperId);

  // Collect CC emails from the work paper, removing auditor duplicates
  var ccEmails = String(workPaper.cc_recipients || '').split(',').map(function(e) { return e.trim(); }).filter(Boolean);
  var auditorEmails = auditors.map(function(a) { return a.email; });
  var uniqueCc = ccEmails.filter(function(e) { return auditorEmails.indexOf(e) === -1; });
  var ccString = uniqueCc.join(',') || null;

  auditors.forEach(function(auditor) {
    var firstName = auditor.name ? auditor.name.split(' ')[0] : 'Auditor';
    var intro = 'Dear ' + firstName + ',<br><br>' +
      '<strong>' + (submitter.full_name || 'An auditee') + '</strong> has submitted a response to the following audit observation:';

    var headers = ['Field', 'Details'];
    var rows = [
      ['Observation', String(workPaper.observation_title || '-')],
      ['Round', String(response.round_number || 1) + ' of ' + RESPONSE_DEFAULTS.MAX_ROUNDS],
      ['Risk Rating', String(workPaper.risk_rating || '-')],
      ['Submitted By', String(submitter.full_name || '-')],
      ['Submitted Date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })]
    ];

    var outro = 'Please <a href="' + loginUrl + '">log in</a> to review the response and accept or reject it.';
    var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
    sendEmail(auditor.email, subject, subject, htmlBody, ccString, 'Hass Audit', 'hassaudit@outlook.com');
  });
}

function queueResponseAcceptedNotification(workPaperId, workPaper, reviewer) {
  var responsibleIds = parseIdList(workPaper.responsible_ids);
  var loginUrl = ScriptApp.getService().getUrl();
  var subject = 'Audit Response Accepted - ' + (workPaper.observation_title || workPaperId);

  // Collect CC emails, removing duplicates with responsible party emails
  var responsibleEmails = [];
  responsibleIds.forEach(function(uid) { var u = getUserById(uid); if (u && u.email) responsibleEmails.push(u.email); });
  var ccList = String(workPaper.cc_recipients || '').split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e && responsibleEmails.indexOf(e) === -1; });
  var ccString = ccList.join(',') || null;

  responsibleIds.forEach(function(userId) {
    var auditee = getUserById(userId);
    if (!auditee || !auditee.email || !isActive(auditee.is_active)) return;

    var firstName = auditee.first_name || (auditee.full_name || '').split(' ')[0] || 'Colleague';
    var intro = 'Dear ' + firstName + ',<br><br>' +
      'Your response to the following audit observation has been <strong>accepted</strong> by ' + (reviewer.full_name || 'the audit team') + ':';

    var headers = ['Field', 'Details'];
    var rows = [
      ['Observation', String(workPaper.observation_title || '-')],
      ['Risk Rating', String(workPaper.risk_rating || '-')],
      ['Status', '<strong style="color:#28a745;">Response Accepted</strong>'],
      ['Reviewed By', String(reviewer.full_name || '-')]
    ];

    var outro = 'Please continue to implement the agreed action plans. You can track progress by <a href="' + loginUrl + '">logging in</a>.';
    var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
    sendEmail(auditee.email, subject, subject, htmlBody, ccString, 'Hass Audit', 'hassaudit@outlook.com');
  });
}

function queueResponseRejectedNotification(workPaperId, workPaper, comments, reviewer) {
  var responsibleIds = parseIdList(workPaper.responsible_ids);
  var loginUrl = ScriptApp.getService().getUrl();
  var subject = 'Audit Response \u2014 Additional Information Requested (Round ' + (workPaper.response_round || 1) + ' of ' + RESPONSE_DEFAULTS.MAX_ROUNDS + ') \u2014 ' + (workPaper.observation_title || workPaperId);

  // Collect CC emails, removing duplicates with responsible party emails
  var responsibleEmails = [];
  responsibleIds.forEach(function(uid) { var u = getUserById(uid); if (u && u.email) responsibleEmails.push(u.email); });
  var ccList = String(workPaper.cc_recipients || '').split(',').map(function(e) { return e.trim(); }).filter(function(e) { return e && responsibleEmails.indexOf(e) === -1; });
  var ccString = ccList.join(',') || null;

  responsibleIds.forEach(function(userId) {
    var auditee = getUserById(userId);
    if (!auditee || !auditee.email || !isActive(auditee.is_active)) return;

    var firstName = auditee.first_name || (auditee.full_name || '').split(' ')[0] || 'Colleague';
    var remainingRounds = RESPONSE_DEFAULTS.MAX_ROUNDS - (workPaper.response_round || 0);
    var intro = 'Dear ' + firstName + ',<br><br>' +
      'The audit team has reviewed your response to the following observation and has requested additional information or clarification. Please review the feedback below and submit a revised response.' +
      ' You have <strong>' + remainingRounds + ' round(s)</strong> remaining to submit a revised response.';

    var headers = ['Field', 'Details'];
    var rows = [
      ['Observation', String(workPaper.observation_title || '-')],
      ['Risk Rating', String(workPaper.risk_rating || '-')],
      ['Status', '<strong style="color:#2563eb;">Additional Information Requested</strong>'],
      ['Reviewer Comments', String(comments || 'No comments provided')]
    ];

    var outro = 'Please <a href="' + loginUrl + '">log in</a> to revise your response and action plans.';
    var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
    sendEmail(auditee.email, subject, subject, htmlBody, ccString, 'Hass Audit', 'hassaudit@outlook.com');
  });
}

function queueResponseEscalatedNotification(workPaperId, workPaper, reviewer) {
  // Notify CC recipients and responsible parties about escalation
  var ccEmails = String(workPaper.cc_recipients || '').split(',').map(function(e) { return e.trim(); }).filter(Boolean);
  var responsibleIds = parseIdList(workPaper.responsible_ids);

  var allEmails = ccEmails.slice(); // start with CC
  responsibleIds.forEach(function(userId) {
    var u = getUserById(userId);
    if (u && u.email && isActive(u.is_active) && allEmails.indexOf(u.email) === -1) {
      allEmails.push(u.email);
    }
  });

  var loginUrl = ScriptApp.getService().getUrl();
  var subject = 'Management Attention Requested \u2014 Audit Observation: ' + (workPaper.observation_title || workPaperId);

  allEmails.forEach(function(email) {
    var intro = 'Dear Colleague,<br><br>' +
      'The following audit observation has reached the maximum number of response rounds (' +
      RESPONSE_DEFAULTS.MAX_ROUNDS + ') without resolution. Management review is requested to determine the appropriate path forward.';

    var headers = ['Field', 'Details'];
    var rows = [
      ['Observation', String(workPaper.observation_title || '-')],
      ['Risk Rating', String(workPaper.risk_rating || '-')],
      ['Response Rounds Used', String(workPaper.response_round || 0) + ' of ' + RESPONSE_DEFAULTS.MAX_ROUNDS],
      ['Status', '<strong style="color:#1a365d;">Referred to Management</strong>'],
      ['Escalated By', String(reviewer.full_name || '-')]
    ];

    var outro = 'This observation requires management intervention. Please <a href="' + loginUrl + '">log in</a> to review the full observation and response history.';
    var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
    sendEmail(email, subject, subject, htmlBody, null, 'Hass Audit', 'hassaudit@outlook.com');
  });
}

function queueDelegationRejectedNotification(actionPlanId, actionPlan, reason, rejector) {
  var delegatorId = actionPlan.delegated_by_id;
  if (!delegatorId) return;

  var delegator = getUserById(delegatorId);
  if (!delegator || !delegator.email || !isActive(delegator.is_active)) return;

  var parentWp = actionPlan.work_paper_id ? getWorkPaperById(actionPlan.work_paper_id) : null;
  var loginUrl = ScriptApp.getService().getUrl();
  var subject = 'Action Plan Delegation \u2014 Reassignment Needed (' + actionPlanId + ')';

  var firstName = delegator.first_name || (delegator.full_name || '').split(' ')[0] || 'Colleague';
  var intro = 'Dear ' + firstName + ',<br><br>' +
    '<strong>' + (rejector.full_name || 'The delegatee') + '</strong> has rejected the delegation of the following action plan:';

  var headers = ['Field', 'Details'];
  var rows = [
    ['Observation', String((parentWp && parentWp.observation_title) || '-')],
    ['Action Plan', truncateWords(actionPlan.action_description || '-', 15)],
    ['Rejected By', String(rejector.full_name || '-')],
    ['Reason', String(reason || '-')]
  ];

  var outro = 'Ownership has been reverted to you. Please <a href="' + loginUrl + '">log in</a> to reassign or take action.';
  var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
  sendEmail(delegator.email, subject, subject, htmlBody, null, 'Hass Audit', 'hassaudit@outlook.com');
}

// ─────────────────────────────────────────────────────────────
// Auditee Finding Counts (for sidebar/dashboard)
// ─────────────────────────────────────────────────────────────

/**
 * Get finding counts for the auditee sidebar.
 */
function getAuditeeFindingCounts(user) {
  if (!user) return { total: 0, pendingResponse: 0, accepted: 0, rejected: 0, escalated: 0 };

  var findings = getAuditeeFindings({}, user);
  var counts = {
    total: findings.length,
    pendingResponse: 0,
    draftResponse: 0,
    submitted: 0,
    accepted: 0,
    rejected: 0,
    escalated: 0
  };

  findings.forEach(function(f) {
    var rs = f.response_status || STATUS.RESPONSE.PENDING;
    if (rs === STATUS.RESPONSE.PENDING) counts.pendingResponse++;
    else if (rs === STATUS.RESPONSE.DRAFT) counts.draftResponse++;
    else if (rs === STATUS.RESPONSE.SUBMITTED) counts.submitted++;
    else if (rs === STATUS.RESPONSE.ACCEPTED) counts.accepted++;
    else if (rs === STATUS.RESPONSE.REJECTED) counts.rejected++;
    else if (rs === STATUS.RESPONSE.ESCALATED) counts.escalated++;
  });

  return counts;
}

// ─────────────────────────────────────────────────────────────
// Batch Submit Auditee Responses
// ─────────────────────────────────────────────────────────────

function batchSubmitAuditeeResponses(workPaperIds, user) {
  if (!user) throw new Error('User required');
  if (!workPaperIds || workPaperIds.length === 0) throw new Error('No work paper IDs provided');

  var results = [];
  var successCount = 0;
  var failCount = 0;

  workPaperIds.forEach(function(wpId) {
    try {
      var wp = getWorkPaperById(wpId);
      if (!wp) { failCount++; return; }
      if (wp.response_status !== STATUS.RESPONSE.DRAFT) { failCount++; return; }

      var result = submitAuditeeResponse(wpId, {
        management_response: wp.management_response || '',
        action_plan_ids: (wp.action_plan_ids || '').split(',').filter(Boolean)
      }, user);

      if (result && result.success) {
        successCount++;
        results.push({ workPaperId: wpId, success: true });
      } else {
        failCount++;
        results.push({ workPaperId: wpId, success: false, error: result ? result.error : 'Unknown error' });
      }
    } catch (e) {
      failCount++;
      results.push({ workPaperId: wpId, success: false, error: e.message });
    }
  });

  return sanitizeForClient({
    success: true,
    message: successCount + ' response(s) submitted successfully' + (failCount > 0 ? ', ' + failCount + ' failed' : ''),
    results: results,
    successCount: successCount,
    failCount: failCount
  });
}

function getQueuedResponses(user) {
  if (!user) throw new Error('User required');
  var findings = getAuditeeFindings({}, user);
  var queued = findings.filter(function(f) {
    return f.response_status === STATUS.RESPONSE.DRAFT;
  });
  return sanitizeForClient({ success: true, queued: queued, count: queued.length });
}
