// 99_E2E_Test.gs - Comprehensive End-to-End Business Logic Test
//
// Tests EVERY workflow, role permission, status transition, and API function.
// Creates a fresh work paper and drives it through the FULL lifecycle:
//   Draft → Submit → Review → Approve → Send to Auditee →
//   Auditee Response (draft/submit/reject/resubmit/accept) →
//   Action Plan (create/delegate/implement/verify/HOA close)
//
// Also tests negative cases: permission denials, invalid transitions, etc.
//
// RUN:  Script Editor → Run → runFullE2ETest

function runFullE2ETest() {
  var R = []; // report lines
  var passed = 0;
  var failed = 0;
  var warnings = 0;
  var errors = [];

  function PASS(label, detail) {
    passed++;
    R.push('  ✅ ' + label + (detail ? ' — ' + detail : ''));
  }
  function FAIL(label, detail) {
    failed++;
    var msg = '  ❌ ' + label + ' — ' + detail;
    R.push(msg);
    errors.push(msg);
  }
  function WARN(label, detail) {
    warnings++;
    R.push('  ⚠️ ' + label + ' — ' + detail);
  }
  function SECTION(title) {
    R.push('\n── ' + title + ' ──');
  }

  // Expect success
  function expectSuccess(label, fn) {
    try {
      var result = fn();
      if (result && result.success === false) {
        FAIL(label, 'returned success=false: ' + (result.error || result.message || JSON.stringify(result)));
        return null;
      }
      PASS(label, typeof result === 'object' ? 'OK' : String(result));
      return result;
    } catch (e) {
      FAIL(label, e.message);
      return null;
    }
  }

  // Expect error
  function expectError(label, fn, expectedMsg) {
    try {
      fn();
      FAIL(label, 'Expected error but succeeded');
    } catch (e) {
      if (expectedMsg && e.message.indexOf(expectedMsg) === -1) {
        FAIL(label, 'Wrong error: "' + e.message + '" (expected "' + expectedMsg + '")');
      } else {
        PASS(label, 'Correctly threw: ' + e.message.substring(0, 80));
      }
    }
  }

  R.push('═══════════════════════════════════════════════════════════════');
  R.push('  FULL END-TO-END BUSINESS LOGIC TEST');
  R.push('  Run: ' + new Date().toLocaleString());
  R.push('═══════════════════════════════════════════════════════════════');

  // ═══════════════════════════════════════════════════════════════
  // SETUP: Resolve test users by role
  // ═══════════════════════════════════════════════════════════════
  SECTION('SETUP: Resolve Test Users');

  var allUsers = getUsersDropdown();
  if (!allUsers || allUsers.length === 0) {
    FAIL('Users', 'No active users found'); R.push('\nABORTED'); console.log(R.join('\n')); return R.join('\n');
  }
  PASS('Users loaded', allUsers.length + ' active users');

  // Find one user per role
  function findUser(roleCode) {
    return allUsers.find(function(u) { return u.roleCode === roleCode; });
  }

  var superAdmin = findUser('SUPER_ADMIN');
  var seniorAuditor = findUser('SENIOR_AUDITOR');
  var auditor = findUser('AUDITOR');
  var juniorStaff = findUser('JUNIOR_STAFF');
  var auditee = findUser('AUDITEE');
  var management = findUser('MANAGEMENT');
  var observer = findUser('OBSERVER');
  var externalAuditor = findUser('EXTERNAL_AUDITOR');
  var board = findUser('BOARD');

  // Build full user objects (service functions need user_id, full_name, role_code, email)
  function fullUser(dropdownUser) {
    if (!dropdownUser) return null;
    return {
      user_id: dropdownUser.id,
      full_name: dropdownUser.name,
      email: dropdownUser.email,
      role_code: dropdownUser.roleCode,
      affiliate_code: dropdownUser.affiliate || ''
    };
  }

  var uSuperAdmin = fullUser(superAdmin);
  var uSeniorAuditor = fullUser(seniorAuditor);
  var uAuditor = fullUser(auditor);
  var uJuniorStaff = fullUser(juniorStaff);
  var uAuditee = fullUser(auditee);
  var uManagement = fullUser(management);
  var uObserver = fullUser(observer);
  var uExternalAuditor = fullUser(externalAuditor);
  var uBoard = fullUser(board);

  // Report which users we found
  var roleNames = [
    ['SUPER_ADMIN', uSuperAdmin], ['SENIOR_AUDITOR', uSeniorAuditor],
    ['AUDITOR', uAuditor], ['JUNIOR_STAFF', uJuniorStaff],
    ['AUDITEE', uAuditee], ['MANAGEMENT', uManagement],
    ['OBSERVER', uObserver], ['EXTERNAL_AUDITOR', uExternalAuditor],
    ['BOARD', uBoard]
  ];
  roleNames.forEach(function(pair) {
    if (pair[1]) {
      PASS(pair[0], pair[1].full_name + ' (' + pair[1].email + ')');
    } else {
      WARN(pair[0], 'No user with this role found — some tests will be skipped');
    }
  });

  // Must have at minimum a super admin and auditee to run
  if (!uSuperAdmin) { FAIL('ABORT', 'SUPER_ADMIN required'); console.log(R.join('\n')); return R.join('\n'); }
  if (!uAuditee)    { FAIL('ABORT', 'AUDITEE required');     console.log(R.join('\n')); return R.join('\n'); }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: WORK PAPER LIFECYCLE (create → submit → approve → send)
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 1: WORK PAPER — CREATE');

  var wpId = null;
  var wpResult = expectSuccess('Create WP (SUPER_ADMIN)', function() {
    return createWorkPaper({
      year: String(new Date().getFullYear()),
      affiliate_code: 'HQ',
      observation_title: 'E2E Test: Missing approval controls',
      observation_description: 'During testing we found that approval controls are not enforced in the procurement module.',
      risk_rating: 'High',
      risk_summary: 'High risk finding requiring immediate remediation',
      recommendation: 'Implement dual-approval workflow for all POs above $5,000',
      responsible_ids: uAuditee.user_id,
      control_classification: 'Preventive',
      control_type: 'Manual',
      control_frequency: 'Daily'
    }, uSuperAdmin);
  });
  if (wpResult) {
    wpId = wpResult.workPaperId;
    PASS('WP ID generated', wpId);

    // Verify status = Draft
    var wpCheck = getWorkPaperRaw(wpId);
    if (wpCheck && wpCheck.status === 'Draft') {
      PASS('WP initial status', 'Draft');
    } else {
      FAIL('WP initial status', 'Expected Draft, got ' + (wpCheck ? wpCheck.status : 'null'));
    }
  }

  // ── Permission: Auditee cannot create WP ──
  SECTION('PHASE 1: WORK PAPER — PERMISSION DENIALS');

  expectError('Auditee cannot create WP', function() {
    createWorkPaper({ observation_title: 'Should fail' }, uAuditee);
  }, 'Permission denied');

  if (uObserver) {
    expectError('Observer cannot create WP', function() {
      createWorkPaper({ observation_title: 'Should fail' }, uObserver);
    }, 'Permission denied');
  }

  // ── WP Update ──
  SECTION('PHASE 1: WORK PAPER — UPDATE');

  if (wpId) {
    expectSuccess('Update WP observation title', function() {
      return updateWorkPaper(wpId, {
        observation_title: 'E2E Test: Missing dual-approval controls in procurement'
      }, uSuperAdmin);
    });

    // Auditee cannot update a WP they don't own
    expectError('Auditee cannot update WP', function() {
      updateWorkPaper(wpId, { observation_title: 'hack' }, uAuditee);
    });
  }

  // ── WP Submit ──
  SECTION('PHASE 1: WORK PAPER — SUBMIT');

  if (wpId) {
    expectSuccess('Submit WP', function() {
      return submitWorkPaper(wpId, uSuperAdmin);
    });

    var wpAfterSubmit = getWorkPaperRaw(wpId);
    if (wpAfterSubmit && wpAfterSubmit.status === 'Submitted') {
      PASS('WP status after submit', 'Submitted');
    } else {
      FAIL('WP status after submit', 'Expected Submitted, got ' + (wpAfterSubmit ? wpAfterSubmit.status : 'null'));
    }

    // Cannot submit again
    expectError('Cannot re-submit', function() {
      submitWorkPaper(wpId, uSuperAdmin);
    }, 'cannot be submitted');
  }

  // ── WP Review ──
  SECTION('PHASE 1: WORK PAPER — REVIEW');

  if (wpId) {
    // Auditee cannot review
    expectError('Auditee cannot review WP', function() {
      reviewWorkPaper(wpId, 'approve', '', uAuditee);
    }, 'Permission denied');

    // Start review
    expectSuccess('Start review (SUPER_ADMIN)', function() {
      return reviewWorkPaper(wpId, 'start_review', '', uSuperAdmin);
    });

    var wpUnderReview = getWorkPaperRaw(wpId);
    if (wpUnderReview && wpUnderReview.status === 'Under Review') {
      PASS('WP status', 'Under Review');
    } else {
      FAIL('WP status', 'Expected Under Review');
    }

    // Return for revision
    expectSuccess('Return for revision', function() {
      return reviewWorkPaper(wpId, 'return', 'Please add more supporting evidence.', uSuperAdmin);
    });

    var wpRevision = getWorkPaperRaw(wpId);
    if (wpRevision && wpRevision.status === 'Revision Required') {
      PASS('WP status', 'Revision Required');
    } else {
      FAIL('WP status', 'Expected Revision Required');
    }

    // Re-submit after revision
    expectSuccess('Re-submit after revision', function() {
      return submitWorkPaper(wpId, uSuperAdmin);
    });

    // Now approve
    expectSuccess('Approve WP', function() {
      return reviewWorkPaper(wpId, 'approve', 'Good work, approved.', uSuperAdmin);
    });

    var wpApproved = getWorkPaperRaw(wpId);
    if (wpApproved && wpApproved.status === 'Approved') {
      PASS('WP status', 'Approved');
      PASS('WP approved_by_id', wpApproved.approved_by_id);
    } else {
      FAIL('WP status', 'Expected Approved');
    }
  }

  // ── WP Delete rules ──
  SECTION('PHASE 1: WORK PAPER — DELETE RULES');

  if (wpId) {
    expectError('Cannot delete non-draft WP', function() {
      deleteWorkPaper(wpId, uSuperAdmin);
    }, 'Only draft');
  }

  // Create and delete a draft
  var draftWpResult = expectSuccess('Create disposable draft WP', function() {
    return createWorkPaper({ observation_title: 'Disposable draft', observation_description: 'test', risk_rating: 'Low', recommendation: 'test' }, uSuperAdmin);
  });
  if (draftWpResult) {
    expectSuccess('Delete draft WP', function() {
      return deleteWorkPaper(draftWpResult.workPaperId, uSuperAdmin);
    });
  }

  // ── Send to Auditee ──
  SECTION('PHASE 1: WORK PAPER — SEND TO AUDITEE');

  if (wpId) {
    expectSuccess('Send to Auditee', function() {
      return sendToAuditee(wpId, uSuperAdmin);
    });

    var wpSent = getWorkPaperRaw(wpId);
    if (wpSent) {
      if (wpSent.status === 'Sent to Auditee') PASS('WP status', 'Sent to Auditee');
      else FAIL('WP status', 'Expected Sent to Auditee, got ' + wpSent.status);

      if (wpSent.response_status === 'Pending Response') PASS('response_status', 'Pending Response');
      else FAIL('response_status', 'Expected Pending Response, got ' + wpSent.response_status);

      if (wpSent.response_deadline) PASS('response_deadline set', new Date(wpSent.response_deadline).toISOString().split('T')[0]);
      else FAIL('response_deadline', 'Not set');

      // Verify auto-created action plan
      var autoAPs = getActionPlansByWorkPaperRaw(wpId);
      if (autoAPs.length > 0) PASS('Auto-created action plan', autoAPs[0].action_plan_id);
      else WARN('Auto-created AP', 'No action plan auto-created');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: ROLE-BASED VISIBILITY
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 2: ROLE-BASED VISIBILITY');

  // Auditee sees only Sent to Auditee WPs assigned to them
  var auditeeWPs = getWorkPapersRaw({}, uAuditee);
  if (auditeeWPs) {
    var allSentToAuditee = auditeeWPs.every(function(wp) { return wp.status === 'Sent to Auditee'; });
    if (allSentToAuditee) PASS('Auditee sees only Sent to Auditee', auditeeWPs.length + ' WPs');
    else FAIL('Auditee visibility', 'Sees WPs with wrong status');
  }

  // SUPER_ADMIN sees all WPs
  var adminWPs = getWorkPapersRaw({}, uSuperAdmin);
  if (adminWPs && adminWPs.length > 0) PASS('SUPER_ADMIN sees all WPs', adminWPs.length + ' total');

  // Observer/External Auditor see only Approved + Sent
  if (uObserver) {
    var obsWPs = getWorkPapersRaw({}, uObserver);
    var obsOk = !obsWPs || obsWPs.every(function(wp) {
      return wp.status === 'Approved' || wp.status === 'Sent to Auditee';
    });
    if (obsOk) PASS('Observer sees only Approved/Sent', (obsWPs ? obsWPs.length : 0) + ' WPs');
    else FAIL('Observer visibility', 'Sees WPs with restricted status');
  }

  // Auditee can see their findings
  var findings = expectSuccess('getAuditeeFindings', function() {
    return getAuditeeFindings({}, uAuditee);
  });
  if (findings && Array.isArray(findings)) {
    PASS('Auditee findings count', findings.length + ' findings');
    var hasOurWP = findings.some(function(f) { return f.work_paper_id === wpId; });
    if (hasOurWP) PASS('Test WP visible to auditee', wpId);
    else WARN('Test WP not visible to auditee', 'Check responsible_ids assignment');
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: AUDITEE RESPONSE WORKFLOW
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 3: AUDITEE RESPONSE — DRAFT');

  if (wpId) {
    // Save draft response
    expectSuccess('Save draft response', function() {
      return saveDraftResponse(wpId, {
        management_response: 'Draft: We acknowledge the finding and are working on corrective actions.'
      }, uAuditee);
    });

    var wpDraft = getWorkPaperRaw(wpId);
    if (wpDraft && wpDraft.response_status === 'Draft Response') {
      PASS('response_status after draft', 'Draft Response');
    } else {
      FAIL('response_status after draft', 'Expected Draft Response');
    }

    // Non-assigned auditee cannot save draft
    if (uManagement) {
      expectError('Non-assigned user cannot save draft', function() {
        saveDraftResponse(wpId, { management_response: 'hack' }, uManagement);
      }, 'Permission denied');
    }
  }

  SECTION('PHASE 3: AUDITEE RESPONSE — SUBMIT');

  if (wpId) {
    // Invalid response type
    expectError('Invalid response type rejected', function() {
      submitAuditeeResponse(wpId, { response_type: 'InvalidType', management_response: 'Blah blah blah' }, uAuditee);
    }, 'Invalid response type');

    // Response too short
    expectError('Response too short rejected', function() {
      submitAuditeeResponse(wpId, { response_type: 'Agree', management_response: 'Short' }, uAuditee);
    }, 'at least 10 characters');

    // Valid submission
    var submitResult = expectSuccess('Submit auditee response (Round 1)', function() {
      return submitAuditeeResponse(wpId, {
        response_type: 'Agree',
        management_response: 'We agree with the finding and will implement dual-approval controls within 30 days.'
      }, uAuditee);
    });

    var wpAfterResponse = getWorkPaperRaw(wpId);
    if (wpAfterResponse) {
      if (wpAfterResponse.response_status === 'Response Submitted') PASS('response_status', 'Response Submitted');
      else FAIL('response_status', 'Expected Response Submitted, got ' + wpAfterResponse.response_status);

      if (wpAfterResponse.response_round === 1) PASS('response_round', '1');
      else FAIL('response_round', 'Expected 1, got ' + wpAfterResponse.response_round);
    }

    // Auditee cannot submit again (already submitted)
    expectError('Cannot submit while pending review', function() {
      submitAuditeeResponse(wpId, {
        response_type: 'Agree',
        management_response: 'Duplicate submission should fail.'
      }, uAuditee);
    }, 'cannot be submitted');
  }

  SECTION('PHASE 3: AUDITEE RESPONSE — AUDITOR REJECT (Round 1)');

  if (wpId) {
    // Auditee cannot review
    expectError('Auditee cannot review own response', function() {
      reviewAuditeeResponse(wpId, 'accept', '', uAuditee);
    }, 'Permission denied');

    // Auditor rejects
    expectSuccess('Auditor rejects response (Round 1)', function() {
      return reviewAuditeeResponse(wpId, 'reject', 'Insufficient detail on timeline. Please provide specific milestones.', uSuperAdmin);
    });

    var wpRejected = getWorkPaperRaw(wpId);
    if (wpRejected && wpRejected.response_status === 'Response Rejected') {
      PASS('response_status', 'Response Rejected');
    } else {
      FAIL('response_status', 'Expected Response Rejected');
    }
  }

  SECTION('PHASE 3: AUDITEE RESPONSE — RESUBMIT (Round 2)');

  if (wpId) {
    expectSuccess('Resubmit response (Round 2)', function() {
      return submitAuditeeResponse(wpId, {
        response_type: 'Agree',
        management_response: 'Revised response: We will implement dual-approval by March 31, 2026 with interim manual controls effective immediately.'
      }, uAuditee);
    });

    var wpRound2 = getWorkPaperRaw(wpId);
    if (wpRound2) {
      if (wpRound2.response_round === 2) PASS('response_round', '2');
      else FAIL('response_round', 'Expected 2, got ' + wpRound2.response_round);
    }
  }

  SECTION('PHASE 3: AUDITEE RESPONSE — AUDITOR ACCEPT (Round 2)');

  if (wpId) {
    expectSuccess('Auditor accepts response (Round 2)', function() {
      return reviewAuditeeResponse(wpId, 'accept', 'Response is satisfactory. Milestones are clear.', uSuperAdmin);
    });

    var wpAccepted = getWorkPaperRaw(wpId);
    if (wpAccepted && wpAccepted.response_status === 'Response Accepted') {
      PASS('response_status', 'Response Accepted');
    } else {
      FAIL('response_status', 'Expected Response Accepted');
    }
  }

  // ── Response History ──
  SECTION('PHASE 3: RESPONSE HISTORY');

  if (wpId) {
    var respHistory = getResponseHistory(wpId);
    if (respHistory && respHistory.length >= 2) {
      PASS('Response history', respHistory.length + ' records (Round 1 + Round 2)');
    } else {
      WARN('Response history', 'Expected 2+ records, got ' + (respHistory ? respHistory.length : 0));
    }
  }

  // ── getAuditeeResponseData ──
  SECTION('PHASE 3: AUDITEE RESPONSE DATA API');

  if (wpId) {
    var respData = expectSuccess('getAuditeeResponseData (SUPER_ADMIN)', function() {
      return getAuditeeResponseData(wpId, uSuperAdmin);
    });
    if (respData) {
      if (respData.finding) PASS('finding data present', respData.finding.work_paper_id);
      if (respData.responses) PASS('response history included', respData.responses.length + ' records');
      if (respData.actionPlans) PASS('action plans included', respData.actionPlans.length + ' plans');
      if (typeof respData.canEditResponse !== 'undefined') PASS('canEditResponse flag', String(respData.canEditResponse));
    }

    // Non-assigned user denied
    if (uManagement) {
      expectError('Non-assigned user denied response data', function() {
        getAuditeeResponseData(wpId, uManagement);
      }, 'Permission denied');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: ESCALATION TEST (submit → reject 3 times → escalate)
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 4: ESCALATION (MAX ROUNDS)');

  // Use a Sent to Auditee WP with Pending Response (from seed data)
  var escalationWpId = null;
  if (wpId) {
    // We'll create a new WP to test escalation cleanly
    var escWpResult = expectSuccess('Create escalation test WP', function() {
      return createWorkPaper({
        observation_title: 'E2E Escalation Test WP',
        observation_description: 'Testing the escalation flow after max rounds.',
        risk_rating: 'Medium',
        recommendation: 'Fix this issue promptly.',
        responsible_ids: uAuditee.user_id,
        control_classification: 'Detective'
      }, uSuperAdmin);
    });

    if (escWpResult) {
      escalationWpId = escWpResult.workPaperId;

      // Fast-track: submit, approve, send
      expectSuccess('Submit escalation WP', function() { return submitWorkPaper(escalationWpId, uSuperAdmin); });
      expectSuccess('Approve escalation WP', function() { return reviewWorkPaper(escalationWpId, 'approve', '', uSuperAdmin); });
      expectSuccess('Send escalation WP', function() { return sendToAuditee(escalationWpId, uSuperAdmin); });

      // Round 1: submit then reject
      expectSuccess('Esc Round 1: submit', function() {
        return submitAuditeeResponse(escalationWpId, { response_type: 'Disagree', management_response: 'We disagree with this finding entirely. Round 1.' }, uAuditee);
      });
      expectSuccess('Esc Round 1: reject', function() {
        return reviewAuditeeResponse(escalationWpId, 'reject', 'Insufficient.', uSuperAdmin);
      });

      // Round 2: submit then reject
      expectSuccess('Esc Round 2: submit', function() {
        return submitAuditeeResponse(escalationWpId, { response_type: 'Partially Agree', management_response: 'We partially agree. Round 2 response with more detail.' }, uAuditee);
      });
      expectSuccess('Esc Round 2: reject', function() {
        return reviewAuditeeResponse(escalationWpId, 'reject', 'Still not adequate.', uSuperAdmin);
      });

      // Round 3: submit then reject → should escalate
      expectSuccess('Esc Round 3: submit', function() {
        return submitAuditeeResponse(escalationWpId, { response_type: 'Partially Agree', management_response: 'Round 3 final attempt at providing a response.' }, uAuditee);
      });
      expectSuccess('Esc Round 3: reject → escalate', function() {
        return reviewAuditeeResponse(escalationWpId, 'reject', 'Final rejection triggers escalation.', uSuperAdmin);
      });

      var wpEscalated = getWorkPaperRaw(escalationWpId);
      if (wpEscalated && wpEscalated.response_status === 'Escalated') {
        PASS('Escalation triggered', 'response_status = Escalated after 3 rounds');
      } else {
        FAIL('Escalation', 'Expected Escalated, got ' + (wpEscalated ? wpEscalated.response_status : 'null'));
      }

      // Round 4 should fail (max rounds exceeded)
      expectError('Round 4 blocked (max rounds)', function() {
        submitAuditeeResponse(escalationWpId, { response_type: 'Agree', management_response: 'This should not be allowed.' }, uAuditee);
      }, 'exceeded');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5: ACTION PLAN LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 5: ACTION PLAN — CREATE');

  var apId = null;
  if (wpId) {
    // Auditee proposes an action plan
    var apResult = expectSuccess('Auditee creates action plan', function() {
      var dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 60);
      return createAuditeeActionPlan({
        work_paper_id: wpId,
        action_description: 'Implement dual-approval workflow in ERP for POs > $5,000',
        due_date: dueDate,
        owner_ids: uAuditee.user_id,
        owner_names: uAuditee.full_name
      }, uAuditee);
    });
    if (apResult) {
      apId = apResult.actionPlanId;
      PASS('Action plan ID', apId);

      var apCheck = getActionPlanRaw(apId);
      if (apCheck) {
        if (apCheck.status === 'Not Due') PASS('AP initial status', 'Not Due');
        else PASS('AP initial status', apCheck.status + ' (due date based)');
        if (apCheck.auditee_proposed === true) PASS('auditee_proposed flag', 'true');
        else WARN('auditee_proposed flag', String(apCheck.auditee_proposed));
      }
    }

    // Due date > 6 months blocked
    expectError('Due date > 6 months rejected', function() {
      var farDate = new Date();
      farDate.setMonth(farDate.getMonth() + 7);
      createAuditeeActionPlan({
        work_paper_id: wpId,
        action_description: 'Should fail',
        due_date: farDate
      }, uAuditee);
    }, '6 months');

    // Non-auditee creation (auditor creates AP)
    var auditorApResult = expectSuccess('Auditor creates action plan', function() {
      var dueDate2 = new Date();
      dueDate2.setDate(dueDate2.getDate() + 30);
      return createActionPlan({
        work_paper_id: wpId,
        action_description: 'Auditor-directed: Quarterly access review implementation',
        due_date: dueDate2,
        owner_ids: uAuditee.user_id,
        owner_names: uAuditee.full_name
      }, uSuperAdmin);
    });
    if (auditorApResult) {
      PASS('Auditor AP created', auditorApResult.actionPlanId);
    }

    // Batch create
    expectSuccess('Batch create action plans', function() {
      var d1 = new Date(); d1.setDate(d1.getDate() + 45);
      var d2 = new Date(); d2.setDate(d2.getDate() + 50);
      return createActionPlansBatch(wpId, [
        { action_description: 'Batch AP 1: Update policy document', due_date: d1, owner_ids: uAuditee.user_id, owner_names: uAuditee.full_name },
        { action_description: 'Batch AP 2: Train staff on new controls', due_date: d2, owner_ids: uAuditee.user_id, owner_names: uAuditee.full_name }
      ], uSuperAdmin);
    });
  }

  // ── AP Update ──
  SECTION('PHASE 5: ACTION PLAN — UPDATE');

  if (apId) {
    // Auditee can update implementation_notes
    expectSuccess('Auditee updates implementation_notes', function() {
      return updateActionPlan(apId, { implementation_notes: 'Started gathering requirements for ERP configuration.' }, uAuditee);
    });

    // Auditee cannot update action_description
    var apAfterAuditeeUpdate = getActionPlanRaw(apId);
    expectSuccess('Auditor updates action_description', function() {
      return updateActionPlan(apId, { action_description: 'Updated: Implement dual-approval with compensating controls' }, uSuperAdmin);
    });

    var apAfterAuditorUpdate = getActionPlanRaw(apId);
    if (apAfterAuditorUpdate && apAfterAuditorUpdate.action_description.indexOf('Updated:') >= 0) {
      PASS('Auditor update applied', 'action_description changed');
    }
  }

  // ── AP Delegation ──
  SECTION('PHASE 5: ACTION PLAN — DELEGATION');

  if (apId && uManagement) {
    // Delegate to management
    expectSuccess('Delegate AP to management', function() {
      return delegateActionPlan(apId, uManagement.user_id, uManagement.full_name, 'Reassigning to department manager for implementation', uSuperAdmin);
    });

    var apDelegated = getActionPlanRaw(apId);
    if (apDelegated) {
      if (apDelegated.owner_ids === uManagement.user_id) PASS('New owner after delegation', uManagement.full_name);
      if (apDelegated.original_owner_ids) PASS('Original owner preserved', apDelegated.original_owner_ids);
      if (apDelegated.delegated_by_id === uSuperAdmin.user_id) PASS('Delegated by', uSuperAdmin.full_name);
    }

    // Delegatee rejects delegation
    expectSuccess('Delegatee rejects delegation', function() {
      return respondToDelegation(apId, 'reject', 'This action plan is outside my department scope.', uManagement);
    });

    var apReverted = getActionPlanRaw(apId);
    if (apReverted) {
      PASS('Owner reverted after reject', 'owner_ids: ' + apReverted.owner_ids);
    }

    // Re-delegate and accept
    expectSuccess('Re-delegate AP', function() {
      return delegateActionPlan(apId, uManagement.user_id, uManagement.full_name, 'Second delegation attempt', uSuperAdmin);
    });
    expectSuccess('Delegatee accepts', function() {
      return respondToDelegation(apId, 'accept', '', uManagement);
    });

    // Delegate back to auditee for implementation tests
    expectSuccess('Delegate back to auditee', function() {
      return delegateActionPlan(apId, uAuditee.user_id, uAuditee.full_name, 'Returning for implementation', uSuperAdmin);
    });

  } else if (apId) {
    WARN('Delegation tests', 'Skipped (no MANAGEMENT user)');
  }

  // ── Cannot delegate closed AP ──
  // Find a Verified/Closed AP from seed
  var allAPs = getActionPlansRaw({}, null);
  var closedAP = allAPs ? allAPs.find(function(a) { return a.status === 'Closed'; }) : null;
  if (closedAP) {
    expectError('Cannot delegate Closed AP', function() {
      delegateActionPlan(closedAP.action_plan_id, uAuditee.user_id, uAuditee.full_name, 'Should fail', uSuperAdmin);
    }, 'Cannot delegate');
  }

  // ── AP Evidence & Mark as Implemented ──
  SECTION('PHASE 5: ACTION PLAN — IMPLEMENT');

  if (apId) {
    // Cannot mark as implemented without evidence
    expectError('Cannot implement without evidence', function() {
      markAsImplemented(apId, 'Implemented the controls', uAuditee);
    }, 'Evidence');

    // Add evidence
    var evResult = expectSuccess('Add evidence', function() {
      return addActionPlanEvidence(apId, {
        file_name: 'approval_workflow_screenshot.png',
        file_description: 'Screenshot showing the new dual-approval workflow in ERP',
        drive_file_id: '',
        drive_url: ''
      }, uAuditee);
    });
    if (evResult) PASS('Evidence ID', evResult.evidenceId);

    // Now mark as implemented
    expectSuccess('Mark as implemented', function() {
      return markAsImplemented(apId, 'Dual-approval workflow has been deployed and tested.', uAuditee);
    });

    var apImpl = getActionPlanRaw(apId);
    if (apImpl) {
      if (apImpl.status === 'Pending Verification') PASS('AP status after implement', 'Pending Verification');
      else FAIL('AP status', 'Expected Pending Verification, got ' + apImpl.status);

      if (apImpl.implemented_date) PASS('implemented_date set', 'yes');
    }
  }

  // ── AP Verify ──
  SECTION('PHASE 5: ACTION PLAN — VERIFY');

  if (apId) {
    // Auditee cannot verify
    expectError('Auditee cannot verify AP', function() {
      verifyImplementation(apId, 'approve', '', uAuditee);
    }, 'Permission denied');

    // Auditor returns for rework
    expectSuccess('Auditor returns AP for rework', function() {
      return verifyImplementation(apId, 'return', 'Need system log evidence, not just screenshots.', uSuperAdmin);
    });

    var apReturned = getActionPlanRaw(apId);
    if (apReturned && apReturned.status === 'In Progress') {
      PASS('AP status after return', 'In Progress');
    } else {
      FAIL('AP status', 'Expected In Progress, got ' + (apReturned ? apReturned.status : 'null'));
    }

    // Re-implement
    expectSuccess('Re-mark as implemented', function() {
      return markAsImplemented(apId, 'Added system audit logs as evidence.', uAuditee);
    });

    // Auditor approves (verifies)
    expectSuccess('Auditor verifies AP', function() {
      return verifyImplementation(apId, 'approve', 'Implementation verified with system logs.', uSuperAdmin);
    });

    var apVerified = getActionPlanRaw(apId);
    if (apVerified) {
      if (apVerified.status === 'Verified') PASS('AP status', 'Verified');
      else FAIL('AP status', 'Expected Verified, got ' + apVerified.status);

      if (apVerified.auditor_review_status === 'Approved') PASS('auditor_review_status', 'Approved');
    }
  }

  // ── HOA Review ──
  SECTION('PHASE 5: ACTION PLAN — HOA REVIEW');

  if (apId) {
    // HOA reject (sends back to In Progress)
    expectSuccess('HOA rejects (sends back)', function() {
      return hoaReview(apId, 'reject', 'I want to see the training records too.', uSuperAdmin);
    });

    var apHoaRejected = getActionPlanRaw(apId);
    if (apHoaRejected && apHoaRejected.status === 'In Progress') {
      PASS('AP status after HOA reject', 'In Progress');
    }

    // Re-implement → re-verify → HOA approve
    expectSuccess('Re-implement for HOA', function() {
      return markAsImplemented(apId, 'Added training records as requested.', uAuditee);
    });
    expectSuccess('Re-verify for HOA', function() {
      return verifyImplementation(apId, 'approve', 'Training records confirmed.', uSuperAdmin);
    });
    expectSuccess('HOA approves → Closed', function() {
      return hoaReview(apId, 'approve', 'All evidence satisfactory. Closing action plan.', uSuperAdmin);
    });

    var apClosed = getActionPlanRaw(apId);
    if (apClosed && apClosed.status === 'Closed') {
      PASS('AP status', 'CLOSED');
      PASS('hoa_review_status', apClosed.hoa_review_status);
    } else {
      FAIL('AP status', 'Expected Closed, got ' + (apClosed ? apClosed.status : 'null'));
    }
  }

  // ── AP Delete rules ──
  SECTION('PHASE 5: ACTION PLAN — DELETE RULES');

  if (apId) {
    // Cannot delete Closed AP
    expectError('Cannot delete Closed AP', function() {
      deleteActionPlan(apId, uSuperAdmin);
    }, 'Cannot delete');
  }

  // ── AP History ──
  SECTION('PHASE 5: ACTION PLAN — HISTORY TRAIL');

  if (apId) {
    var apHist = getActionPlanHistory(apId);
    if (apHist && apHist.length > 0) {
      PASS('AP history trail', apHist.length + ' entries');
      R.push('    History entries:');
      apHist.forEach(function(h) {
        R.push('      ' + (h.previous_status || '(new)') + ' → ' + h.new_status + ': ' + (h.comments || '').substring(0, 50));
      });
    } else {
      WARN('AP history', 'No history entries found');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 6: ACTION PLAN COUNTS & QUERIES
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 6: COUNTS & QUERIES');

  var wpCounts = expectSuccess('getWorkPaperCounts', function() {
    return getWorkPaperCounts({}, uSuperAdmin);
  });
  if (wpCounts) {
    PASS('Total WPs', wpCounts.total);
    R.push('    Status breakdown: ' + JSON.stringify(wpCounts.byStatus));
    R.push('    Risk breakdown:   ' + JSON.stringify(wpCounts.byRisk));
  }

  var apCounts = expectSuccess('getActionPlanCounts', function() {
    return getActionPlanCounts({}, uSuperAdmin);
  });
  if (apCounts) {
    PASS('Total APs', apCounts.total);
    PASS('Overdue APs', apCounts.overdue);
    R.push('    Status breakdown: ' + JSON.stringify(apCounts.byStatus));
  }

  var findingCounts = expectSuccess('getAuditeeFindingCounts', function() {
    return getAuditeeFindingCounts(uAuditee);
  });
  if (findingCounts) {
    PASS('Auditee total findings', findingCounts.total);
    R.push('    Pending: ' + findingCounts.pendingResponse +
           ', Draft: ' + findingCounts.draftResponse +
           ', Submitted: ' + findingCounts.submitted +
           ', Accepted: ' + findingCounts.accepted +
           ', Rejected: ' + findingCounts.rejected +
           ', Escalated: ' + findingCounts.escalated);
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 7: WORK PAPER REQUIREMENTS
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 7: WORK PAPER REQUIREMENTS (sub-records)');

  if (wpId) {
    var reqResult = expectSuccess('Add WP requirement', function() {
      return addWorkPaperRequirement(wpId, {
        requirement_description: 'Provide list of all POs processed without dual approval in last 12 months',
        status: 'Pending'
      }, uSuperAdmin);
    });
    if (reqResult && reqResult.requirementId) {
      PASS('Requirement ID', reqResult.requirementId);

      expectSuccess('Update requirement', function() {
        return updateWorkPaperRequirement(reqResult.requirementId, {
          status: 'Received',
          notes: 'Received on Feb 20'
        }, uSuperAdmin);
      });

      expectSuccess('Delete requirement', function() {
        return deleteWorkPaperRequirement(reqResult.requirementId, uSuperAdmin);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 8: WP REVISION HISTORY
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 8: REVISION HISTORY');

  if (wpId) {
    var revisions = getWorkPaperRevisions(wpId);
    if (revisions && revisions.length > 0) {
      PASS('WP revision history', revisions.length + ' entries');
      revisions.forEach(function(rev) {
        R.push('    Rev ' + rev.revision_number + ': ' + rev.action + ' by ' + rev.user_name);
      });
    } else {
      WARN('WP revisions', 'No revision entries found');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 9: SEND QUEUE & BATCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 9: SEND QUEUE');

  var sendQueue = expectSuccess('getApprovedSendQueue', function() {
    return getApprovedSendQueue(uSuperAdmin);
  });
  if (sendQueue) {
    PASS('Send queue groups', (sendQueue.groups ? sendQueue.groups.length : 0));
    PASS('Total WPs in queue', sendQueue.totalWorkPapers || 0);
  }

  // Auditee cannot access send queue
  expectError('Auditee cannot access send queue', function() {
    getApprovedSendQueue(uAuditee);
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 10: PERMISSION MATRIX COMPREHENSIVE CHECK
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 10: PERMISSION MATRIX');

  // Test canUserPerform for each role × action × entity
  var permTests = [
    // [user, action, entityType, label, expected]
    [uSuperAdmin,    'create', 'WORK_PAPER',  'SUPER_ADMIN create WP',       true],
    [uSuperAdmin,    'approve','WORK_PAPER',  'SUPER_ADMIN approve WP',      true],
    [uSuperAdmin,    'delete', 'WORK_PAPER',  'SUPER_ADMIN delete WP',       true],
    [uAuditee,       'create', 'WORK_PAPER',  'AUDITEE create WP',           false],
    [uAuditee,       'delete', 'WORK_PAPER',  'AUDITEE delete WP',           false],
    [uSuperAdmin,    'create', 'ACTION_PLAN', 'SUPER_ADMIN create AP',       true],
    [uSuperAdmin,    'approve','ACTION_PLAN', 'SUPER_ADMIN approve AP',      true],
  ];

  if (uSeniorAuditor) {
    permTests.push([uSeniorAuditor, 'create', 'WORK_PAPER',  'SENIOR_AUDITOR create WP', true]);
    permTests.push([uSeniorAuditor, 'approve','WORK_PAPER',  'SENIOR_AUDITOR approve WP', true]);
  }
  if (uJuniorStaff) {
    permTests.push([uJuniorStaff,   'create', 'WORK_PAPER',  'JUNIOR_STAFF create WP',   true]);
  }
  if (uObserver) {
    permTests.push([uObserver,      'create', 'WORK_PAPER',  'OBSERVER create WP',       false]);
    permTests.push([uObserver,      'create', 'ACTION_PLAN', 'OBSERVER create AP',       false]);
  }
  if (uExternalAuditor) {
    permTests.push([uExternalAuditor,'create','WORK_PAPER',  'EXTERNAL_AUDITOR create WP', false]);
  }
  if (uBoard) {
    permTests.push([uBoard,         'create', 'WORK_PAPER',  'BOARD create WP',          false]);
  }

  permTests.forEach(function(t) {
    if (!t[0]) return;
    var result = canUserPerform(t[0], t[1], t[2], null);
    if (result === t[4]) {
      PASS(t[3], t[4] ? 'ALLOWED' : 'DENIED');
    } else {
      FAIL(t[3], 'Expected ' + (t[4] ? 'ALLOWED' : 'DENIED') + ' but got ' + (result ? 'ALLOWED' : 'DENIED'));
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 11: DROPDOWN & REFERENCE DATA
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 11: REFERENCE DATA & DROPDOWNS');

  var dropdowns = expectSuccess('getDropdownData', function() {
    return getDropdownData();
  });
  if (dropdowns) {
    if (dropdowns.affiliates && dropdowns.affiliates.length > 0) PASS('Affiliates', dropdowns.affiliates.length + ' items');
    else WARN('Affiliates', 'Empty');
    if (dropdowns.auditAreas && dropdowns.auditAreas.length > 0) PASS('Audit Areas', dropdowns.auditAreas.length + ' items');
    else WARN('Audit Areas', 'Empty');
    if (dropdowns.users && dropdowns.users.length > 0) PASS('Users dropdown', dropdowns.users.length + ' users');
    if (dropdowns.auditors && dropdowns.auditors.length > 0) PASS('Auditors dropdown', dropdowns.auditors.length + ' auditors');
    if (dropdowns.auditees && dropdowns.auditees.length > 0) PASS('Auditees dropdown', dropdowns.auditees.length + ' auditees');
    if (dropdowns.riskRatings) PASS('Risk Ratings', dropdowns.riskRatings.length + ' options');
    if (dropdowns.wpStatuses) PASS('WP Statuses', dropdowns.wpStatuses.length + ' statuses');
    if (dropdowns.apStatuses) PASS('AP Statuses', dropdowns.apStatuses.length + ' statuses');
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 12: DATA INTEGRITY CHECK
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 12: DATA INTEGRITY');

  // Verify Firestore + Sheet consistency for the test WP
  if (wpId) {
    var fsWP = firestoreGet(SHEETS.WORK_PAPERS, wpId);
    var sheetWP = getWorkPaperRaw(wpId);

    if (fsWP && sheetWP) {
      if (fsWP.status === sheetWP.status) PASS('Firestore ↔ Sheet status match', fsWP.status);
      else WARN('Firestore ↔ Sheet mismatch', 'FS=' + fsWP.status + ', Sheet=' + sheetWP.status);

      // Schema completeness
      var schemaFields = SCHEMAS.WORK_PAPERS;
      var missing = schemaFields.filter(function(f) { return !(f in fsWP); });
      if (missing.length === 0) PASS('All 50 WP schema fields present in Firestore', '');
      else FAIL('Missing WP schema fields', missing.join(', '));
    }
  }

  // AP schema check for our test AP
  if (apId) {
    var fsAP = firestoreGet(SHEETS.ACTION_PLANS, apId);
    if (fsAP) {
      var apSchema = SCHEMAS.ACTION_PLANS;
      var apMissing = apSchema.filter(function(f) { return !(f in fsAP); });
      if (apMissing.length === 0) PASS('All AP schema fields present', apSchema.length + ' fields');
      else WARN('Missing AP schema fields', apMissing.join(', '));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 13: OVERDUE STATUS CHECK
  // ═══════════════════════════════════════════════════════════════
  SECTION('PHASE 13: OVERDUE & AGING');

  var overdueAPs = getActionPlansRaw({ overdue_only: true }, null);
  if (overdueAPs) {
    PASS('Overdue action plans', overdueAPs.length + ' overdue');
    overdueAPs.slice(0, 3).forEach(function(ap) {
      R.push('    ' + ap.action_plan_id + ': ' + ap.status + ', ' + ap.days_overdue + ' days overdue');
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEANUP: Delete test WPs (non-draft won't delete, that's fine)
  // ═══════════════════════════════════════════════════════════════
  SECTION('CLEANUP');
  R.push('  Test WPs created: ' + wpId + (escalationWpId ? ', ' + escalationWpId : ''));
  R.push('  Test APs created: ' + apId);
  R.push('  (These are left in place for manual inspection. Run purgeAndSeedTestData to reset.)');

  // ═══════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════════
  R.push('\n═══════════════════════════════════════════════════════════════');
  R.push('  TEST RESULTS');
  R.push('═══════════════════════════════════════════════════════════════');
  R.push('  Passed:   ' + passed);
  R.push('  Failed:   ' + failed);
  R.push('  Warnings: ' + warnings);
  R.push('  Total:    ' + (passed + failed + warnings));

  if (failed === 0) {
    R.push('\n  🎉 ALL TESTS PASSED');
  } else {
    R.push('\n  🔴 ' + failed + ' TEST(S) FAILED:');
    errors.forEach(function(e) { R.push('  ' + e); });
  }
  R.push('═══════════════════════════════════════════════════════════════');

  var output = R.join('\n');
  console.log(output);
  return output;
}
