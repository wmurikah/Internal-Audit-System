// 10_AuditeeService.gs - Auditee Response Workflow
// Handles: My Findings, management responses, response lifecycle,
// auditee-proposed action plans, delegation accept/reject, escalation.

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

function getResponseDefaults() {
  return {
    DEADLINE_DAYS: parseInt(tursoGetConfig('RESPONSE_DEADLINE_DAYS', 'GLOBAL') || '14'),
    MAX_ROUNDS:    parseInt(tursoGetConfig('RESPONSE_MAX_ROUNDS',    'GLOBAL') || '3')
  };
}

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
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);

  // Load work papers visible to this user
  var workPapers;
  if (isSuperAdmin) {
    workPapers = getWorkPapersRaw({}, null);
  } else {
    // Primary: work papers where user is a responsible party (junction table)
    var assignedWPs = tursoQuery_SQL(
      'SELECT wp.* FROM work_papers wp JOIN work_paper_responsibles wpr ON wp.work_paper_id = wpr.work_paper_id WHERE wpr.user_id = ? AND wp.deleted_at IS NULL AND wp.status = ?',
      [user.user_id, 'Sent to Auditee']
    );

    // Also include WPs where user owns a delegated action plan
    var delegatedWPIds = {};
    try {
      var delegatedAPs = tursoQuery_SQL(
        'SELECT DISTINCT ap.work_paper_id FROM action_plan_owners apo JOIN action_plans ap ON ap.action_plan_id = apo.action_plan_id WHERE apo.user_id = ? AND apo.is_current = 1 AND ap.deleted_at IS NULL',
        [user.user_id]
      );
      delegatedAPs.forEach(function(r) { delegatedWPIds[r.work_paper_id] = true; });
    } catch (e) {
      console.warn('Failed to check delegated action plans:', e.message);
    }

    var assignedIds = {};
    assignedWPs.forEach(function(w) { assignedIds[w.work_paper_id] = true; });

    // Fetch delegated WPs not already in assignedWPs
    var extraWPs = [];
    Object.keys(delegatedWPIds).forEach(function(wpId) {
      if (!assignedIds[wpId]) {
        var w = tursoQuery_SQL('SELECT * FROM work_papers WHERE work_paper_id = ? AND deleted_at IS NULL AND status = ?',
          [wpId, 'Sent to Auditee']);
        if (w && w.length > 0) extraWPs.push(w[0]);
      }
    });

    workPapers = assignedWPs.concat(extraWPs);
  }

  var results = [];

  for (var i = 0; i < workPapers.length; i++) {
    var wp = workPapers[i];

    if (!isSuperAdmin && wp.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) continue;

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
  var ardResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [workPaperId]
  );
  var responsibleIds = ardResponsibles.map(function(r) { return r.user_id; });
  var isAssigned = responsibleIds.includes(user.user_id);
  wp.responsible_ids = responsibleIds.join(',');

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
  } else if ((isAssigned || isDelegatedOwner) && editableStatuses.includes(currentResponseStatus)) {
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
    maxRounds: getResponseDefaults().MAX_ROUNDS,
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

  // Permission check — responsible_ids live in junction table
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);
  var draftResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [workPaperId]
  );
  var responsibleIds = draftResponsibles.map(function(r) { return r.user_id; });
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

  tursoSet('09_WorkPapers', workPaperId, updatedWp);

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

  // Permission check — responsible_ids live in junction table
  var isSuperAdmin = (user.role_code === ROLES.SUPER_ADMIN);
  var submitResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [workPaperId]
  );
  var responsibleIds = submitResponsibles.map(function(r) { return r.user_id; });
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
  if (currentRound > getResponseDefaults().MAX_ROUNDS) {
    throw new Error('Maximum response rounds (' + getResponseDefaults().MAX_ROUNDS + ') exceeded. This observation will be escalated.');
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
    status: 'Pending Review',
    reviewed_by_id: '',
    reviewed_by_name: '',
    review_date: '',
    review_comments: '',
    created_at: now,
    updated_at: now
  };

  tursoSet('24_AuditeeResponses', responseId, responseRecord);

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

  tursoSet('09_WorkPapers', workPaperId, updatedWp);

  // Link action plans to this response
  if (data.action_plan_ids && data.action_plan_ids.length > 0) {
    data.action_plan_ids.forEach(function(apId) {
      try {
        tursoUpdate('13_ActionPlans', apId, {
          response_id: responseId,
          auditee_proposed: 1,
          updated_at: now
        });
      } catch (e) {
        console.warn('Failed to link AP ' + apId + ' to response:', e.message);
      }
    });
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
        responseRecord.status = 'Rejected';
        responseRecord.review_comments = aiEval.feedback;
        responseRecord.reviewed_by_id = 'AI_SYSTEM';
        responseRecord.reviewed_by_name = 'AI Auto-Review';
        responseRecord.review_date = now;
        tursoSet('24_AuditeeResponses', responseId, responseRecord);
        tursoSet('09_WorkPapers', workPaperId, updatedWp);
        // Queue RESPONSE_REVIEWED rejection notification to auditee
        var aiRejResponsibles = tursoQuery_SQL(
          'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
          [workPaperId]
        );
        aiRejResponsibles.forEach(function(r) {
          var uid = r.user_id;
          queueNotification({
            type: NOTIFICATION_TYPES.RESPONSE_REVIEWED,
            recipient_user_id: uid,
            data: {
              work_paper_id: workPaperId,
              work_paper_ref: updatedWp.work_paper_ref || workPaperId,
              observation_title: updatedWp.observation_title || '',
              action: 'Rejected',
              reviewer_name: 'AI Auto-Review',
              comments: aiEval.feedback || '',
              round_number: currentRound
            }
          });
        });
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

  // Queue RESPONSE_SUBMITTED notification to HOA/Senior Auditor
  try {
    var respSubmitData = {
      work_paper_id: workPaperId,
      work_paper_ref: updatedWp.work_paper_ref || workPaperId,
      observation_title: updatedWp.observation_title || '',
      responder_name: user.full_name || '',
      round_number: currentRound,
      risk_rating: updatedWp.risk_rating || '',
      management_response_preview: mgmtResponse.substring(0, 200)
    };
    var respAuditors = getUsersDropdown().filter(function(u) {
      return [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].indexOf(u.roleCode) >= 0;
    });
    respAuditors.forEach(function(auditor) {
      queueNotification({
        type: NOTIFICATION_TYPES.RESPONSE_SUBMITTED,
        recipient_user_id: auditor.id,
        data: respSubmitData
      });
    });
  } catch (e) { console.warn('RESPONSE_SUBMITTED notification failed:', e.message); }

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

  // SUPER_ADMIN can review responses in any status
  if (wp.response_status !== STATUS.RESPONSE.SUBMITTED && user.role_code !== ROLES.SUPER_ADMIN) {
    throw new Error('No pending response to review. Current status: ' + (wp.response_status || 'N/A'));
  }

  // Get the latest response record
  var responses = getResponseHistory(workPaperId);
  var latestResponse = responses.length > 0 ? responses[0] : null;

  if (!latestResponse) {
    throw new Error('No response record found for this work paper');
  }

  var now = new Date();

  // Map action to status values per REVIEW_STATUS / RESPONSE_STATUS enums
  var responseRecordStatus;
  var newResponseStatus;
  if (action === 'accept') {
    responseRecordStatus = 'Approved';
    newResponseStatus    = 'Response Accepted';
  } else if (action === 'escalate') {
    responseRecordStatus = 'Rejected';
    newResponseStatus    = 'Escalated';
  } else if (action === 'return') {
    responseRecordStatus = 'Returned for Revision';
    newResponseStatus    = 'Response Rejected';
  } else {
    // 'reject' — or max-rounds auto-escalate
    var currentRound = wp.response_round || 1;
    responseRecordStatus = 'Rejected';
    newResponseStatus = currentRound >= getResponseDefaults().MAX_ROUNDS ? 'Escalated' : 'Response Rejected';
  }

  // Update response record
  var responseUpdates = {
    status: responseRecordStatus,
    reviewed_by_id: user.user_id,
    reviewed_by_name: user.full_name || '',
    review_date: now,
    review_comments: sanitizeInput(comments || ''),
    updated_at: now
  };

  var updatedResponse = {};
  for (var rk in latestResponse) { updatedResponse[rk] = latestResponse[rk]; }
  for (var rk2 in responseUpdates) { updatedResponse[rk2] = responseUpdates[rk2]; }

  tursoSet('24_AuditeeResponses', latestResponse.response_id, updatedResponse);

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

  tursoSet('09_WorkPapers', workPaperId, updatedWp);

  // Add revision
  var revisionAction = action === 'accept' ? 'Response Accepted' : 'Response Rejected';
  addWorkPaperRevision(workPaperId, revisionAction, comments || '', user);

  // Queue RESPONSE_REVIEWED notification to auditees
  try {
    var reviewActionLabel = action === 'accept' ? 'Accepted' : (newResponseStatus === 'Escalated' ? 'Escalated' : 'Rejected');
    var respReviewData = {
      work_paper_id: workPaperId,
      work_paper_ref: updatedWp.work_paper_ref || workPaperId,
      observation_title: updatedWp.observation_title || '',
      action: reviewActionLabel,
      reviewer_name: user.full_name || '',
      comments: comments || '',
      risk_rating: updatedWp.risk_rating || '',
      round_number: updatedWp.response_round || 0,
      max_rounds: getResponseDefaults().MAX_ROUNDS
    };
    var rrResponsibles = tursoQuery_SQL(
      'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
      [workPaperId]
    );
    var isEscalated = (newResponseStatus === 'Escalated');
    rrResponsibles.forEach(function(r) {
      queueNotification({
        type: NOTIFICATION_TYPES.RESPONSE_REVIEWED,
        recipient_user_id: r.user_id,
        data: respReviewData,
        priority: isEscalated ? 'urgent' : 'normal'
      });
    });
    // CC HOA
    queueHoaCcNotifications({
      type: NOTIFICATION_TYPES.RESPONSE_REVIEWED,
      data: respReviewData,
      priority: isEscalated ? 'urgent' : 'normal'
    }, user.user_id);
  } catch (e) { console.warn('RESPONSE_REVIEWED notification failed:', e.message); }

  logAuditEvent('REVIEW_RESPONSE', 'WORK_PAPER', workPaperId, wp, updatedWp, user.user_id, user.email);

  return sanitizeForClient({
    success: true,
    workPaper: updatedWp,
    message: action === 'accept'
      ? 'Response accepted successfully.'
      : (newResponseStatus === 'Escalated'
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
  var caapResponsibles = tursoQuery_SQL(
    'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
    [data.work_paper_id]
  );
  if (!isSuperAdmin && !caapResponsibles.some(function(r) { return r.user_id === user.user_id; })) {
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

  // Strip owner_ids from action_plans row; write to junction table instead
  var auditeeApOwnerIds = (actionPlan.owner_ids || '').split(',').filter(Boolean);
  delete actionPlan.owner_ids;
  delete actionPlan.owner_names;
  delete actionPlan.original_owner_ids;

  tursoSet('13_ActionPlans', actionPlanId, actionPlan);

  auditeeApOwnerIds.forEach(function(userId) {
    tursoQuery_SQL(
      'INSERT OR IGNORE INTO action_plan_owners (action_plan_id, user_id, is_original, is_current, added_by, added_at) VALUES (?,?,1,1,?,?)',
      [actionPlanId, userId.trim(), user.user_id, new Date().toISOString()]
    );
  });

  addActionPlanHistory(actionPlanId, '', initialStatus, 'Action plan proposed by auditee', user, 'STATUS_CHANGE');
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

  var allResponses = tursoQuery('24_AuditeeResponses', 'work_paper_id', '==', workPaperId);
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

    tursoUpdate('13_ActionPlans', actionPlanId, {
      delegation_accepted: 1,
      delegation_accepted_date: now.toISOString(),
      updated_at: now,
      updated_by: user.user_id
    });
    var acceptedAp = Object.assign({}, ap, { delegation_accepted: 1, delegation_accepted_date: now.toISOString() });

    // Queue AP_DELEGATION_RESPONSE accepted notification to the delegator
    if (ap.delegated_by_id) {
      try {
        var acceptParentWp = ap.work_paper_id ? getWorkPaperById(ap.work_paper_id) : null;
        queueNotification({
          type: NOTIFICATION_TYPES.AP_DELEGATION_RESPONSE,
          recipient_user_id: ap.delegated_by_id,
          data: {
            action_plan_id: actionPlanId,
            action_description: ap.action_description || '',
            response: 'accepted',
            responder_name: user.full_name || '',
            parent_observation: acceptParentWp ? acceptParentWp.observation_title : ''
          }
        });
      } catch (e) { console.warn('AP_DELEGATION_RESPONSE accept notification failed:', e.message); }
    }

    logAuditEvent('ACCEPT_DELEGATION', 'ACTION_PLAN', actionPlanId, ap, acceptedAp, user.user_id, user.email);

    return sanitizeForClient({ success: true, message: 'Delegation accepted.' });
  }

  if (action === 'reject') {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A reason is required when rejecting delegation (minimum 5 characters)');
    }

    // Restore original owner in action_plan_owners junction table
    tursoQuery_SQL(
      'UPDATE action_plan_owners SET is_current=1 WHERE action_plan_id=? AND is_original=1',
      [actionPlanId]
    );

    // Soft-mark delegated (non-original) current owners as removed
    tursoQuery_SQL(
      'UPDATE action_plan_owners SET is_current=0, removed_at=?, removed_by=? WHERE action_plan_id=? AND is_original=0 AND is_current=1',
      [now.toISOString(), user.user_id, actionPlanId]
    );

    tursoUpdate('13_ActionPlans', actionPlanId, {
      delegation_rejected: 1,
      delegation_reject_reason: sanitizeInput(reason),
      delegation_rejected_by: user.user_id,
      delegation_rejected_date: now,
      updated_at: now,
      updated_by: user.user_id
    });

    var revertedAp = Object.assign({}, ap, {
      delegation_rejected: 1,
      delegation_reject_reason: sanitizeInput(reason),
      delegation_rejected_by: user.user_id
    });

    addActionPlanHistory(actionPlanId, ap.status, ap.status,
      'Delegation rejected by ' + (user.full_name || user.user_id) + '. Reason: ' + reason, user, 'DELEGATION');

    // Queue AP_DELEGATION_RESPONSE notification to the delegator
    if (revertedAp.delegated_by_id) {
      try {
        var delegRespParentWp = revertedAp.work_paper_id ? getWorkPaperById(revertedAp.work_paper_id) : null;
        queueNotification({
          type: NOTIFICATION_TYPES.AP_DELEGATION_RESPONSE,
          recipient_user_id: revertedAp.delegated_by_id,
          data: {
            action_plan_id: actionPlanId,
            action_description: revertedAp.action_description || '',
            response: 'rejected',
            responder_name: user.full_name || '',
            reason: reason || '',
            parent_observation: delegRespParentWp ? delegRespParentWp.observation_title : ''
          }
        });
        queueHoaCcNotifications({
          type: NOTIFICATION_TYPES.AP_DELEGATION_RESPONSE,
          data: {
            action_plan_id: actionPlanId,
            action_description: revertedAp.action_description || '',
            response: 'rejected',
            responder_name: user.full_name || '',
            reason: reason || ''
          }
        }, user.user_id);
      } catch (e) { console.warn('AP_DELEGATION_RESPONSE notification failed:', e.message); }
    }

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

// Old notification helper functions (queueResponseSubmittedNotification, queueResponseAcceptedNotification,
// queueResponseRejectedNotification, queueResponseEscalatedNotification, queueDelegationRejectedNotification)
// removed — replaced by universal queueNotification() in 05_NotificationService.gs

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
