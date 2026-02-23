// 99_DebugActionPlans.gs - Diagnostic script for Action Plans visibility issues
// Run diagnoseActionPlansVisibility() from the Apps Script editor to debug

function diagnoseActionPlansVisibility() {
  console.log('====================================================');
  console.log('=== ACTION PLANS VISIBILITY DIAGNOSTIC            ===');
  console.log('=== Run Time: ' + new Date().toISOString() + ' ===');
  console.log('====================================================');

  var report = {
    timestamp: new Date().toISOString(),
    checks: [],
    errors: [],
    warnings: [],
    summary: ''
  };

  // ─────────────────────────────────────────────
  // CHECK 1: Firestore connectivity & status
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 1: Firestore Status ---');
  try {
    var fsEnabled = typeof isFirestoreEnabled === 'function' && isFirestoreEnabled();
    report.checks.push({ check: 'Firestore enabled', result: fsEnabled });
    console.log('Firestore enabled:', fsEnabled);

    if (!fsEnabled) {
      report.errors.push('CRITICAL: Firestore is NOT enabled. Action plans data source is unavailable.');
    }
  } catch (e) {
    report.errors.push('Firestore check failed: ' + e.message);
    console.error('Firestore check error:', e);
  }

  // ─────────────────────────────────────────────
  // CHECK 2: Raw data from getSheetData
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 2: Raw Data from getSheetData ---');
  try {
    // Force fresh read (skip cache)
    invalidateSheetData(SHEETS.ACTION_PLANS);
    var rawData = getSheetData(SHEETS.ACTION_PLANS, true);

    var hasData = rawData && rawData.length > 0;
    var headers = hasData ? rawData[0] : [];
    var rowCount = hasData ? rawData.length - 1 : 0;

    report.checks.push({ check: 'getSheetData returns data', result: hasData, rowCount: rowCount });
    console.log('getSheetData returned', rawData ? rawData.length : 0, 'rows (including headers)');
    console.log('Headers:', JSON.stringify(headers));
    console.log('Data rows:', rowCount);

    if (rowCount === 0) {
      report.errors.push('CRITICAL: getSheetData returned 0 data rows for ' + SHEETS.ACTION_PLANS +
        '. Either Firestore collection is empty or Firestore read failed silently.');
    }

    // Check if headers contain expected columns
    var expectedCols = ['action_plan_id', 'work_paper_id', 'action_description', 'owner_ids', 'status', 'due_date'];
    var missingCols = expectedCols.filter(function(col) { return headers.indexOf(col) === -1; });
    if (missingCols.length > 0) {
      report.errors.push('CRITICAL: Missing expected columns in headers: ' + missingCols.join(', ') +
        '. This indicates schema mismatch between SCHEMAS definition and Firestore documents.');
    }
    report.checks.push({ check: 'Expected columns present', result: missingCols.length === 0, missing: missingCols });

    // Sample first 3 rows
    if (rowCount > 0) {
      console.log('--- Sample rows (first 3): ---');
      for (var s = 1; s <= Math.min(3, rowCount); s++) {
        var sampleObj = {};
        for (var h = 0; h < headers.length; h++) {
          sampleObj[headers[h]] = rawData[s][h];
        }
        console.log('Row ' + s + ':', JSON.stringify(sampleObj));
      }
    }
  } catch (e) {
    report.errors.push('getSheetData call failed: ' + e.message);
    console.error('getSheetData error:', e.message, e.stack);
  }

  // ─────────────────────────────────────────────
  // CHECK 3: Firestore direct read
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 3: Firestore Direct Read ---');
  try {
    if (typeof firestoreGetAll === 'function' && typeof isFirestoreEnabled === 'function' && isFirestoreEnabled()) {
      var fsDocs = firestoreGetAll(SHEETS.ACTION_PLANS);
      var fsDocCount = fsDocs ? fsDocs.length : 0;
      report.checks.push({ check: 'Firestore direct read', result: fsDocCount > 0, docCount: fsDocCount });
      console.log('Firestore returned', fsDocCount, 'documents for', SHEETS.ACTION_PLANS);

      if (fsDocCount > 0) {
        console.log('First Firestore doc keys:', Object.keys(fsDocs[0]).join(', '));
        console.log('First doc sample:', JSON.stringify(fsDocs[0]).substring(0, 500));
      } else {
        report.errors.push('CRITICAL: Firestore collection "' + SHEETS.ACTION_PLANS +
          '" has 0 documents. Action plans may not have been synced to Firestore.');
      }
    } else {
      report.warnings.push('Firestore not available for direct read test');
      console.log('Firestore direct read skipped (not available)');
    }
  } catch (e) {
    report.errors.push('Firestore direct read failed: ' + e.message);
    console.error('Firestore direct read error:', e.message);
  }

  // ─────────────────────────────────────────────
  // CHECK 4: Google Sheet backup data (fallback comparison)
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 4: Google Sheet Backup Data ---');
  try {
    var sheet = getSheet(SHEETS.ACTION_PLANS);
    if (sheet) {
      var sheetLastRow = sheet.getLastRow();
      var sheetDataRows = sheetLastRow > 1 ? sheetLastRow - 1 : 0;
      report.checks.push({ check: 'Google Sheet backup rows', result: sheetDataRows, rows: sheetDataRows });
      console.log('Google Sheet "' + SHEETS.ACTION_PLANS + '" has', sheetDataRows, 'data rows');

      if (sheetDataRows > 0) {
        var sheetHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        console.log('Sheet headers:', JSON.stringify(sheetHeaders));
      }
    } else {
      report.warnings.push('Sheet "' + SHEETS.ACTION_PLANS + '" not found');
      console.log('Sheet not found');
    }
  } catch (e) {
    report.warnings.push('Sheet check failed: ' + e.message);
    console.error('Sheet check error:', e);
  }

  // ─────────────────────────────────────────────
  // CHECK 5: Test getActionPlansRaw with a mock SUPER_ADMIN user
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 5: getActionPlansRaw as SUPER_ADMIN ---');
  try {
    var mockSuperAdmin = {
      user_id: 'DIAG_TEST',
      email: 'diagnostic@test',
      role_code: 'SUPER_ADMIN',
      full_name: 'Diagnostic Test'
    };

    invalidateSheetData(SHEETS.ACTION_PLANS);
    var rawPlans = getActionPlansRaw({}, mockSuperAdmin);
    report.checks.push({ check: 'getActionPlansRaw(SUPER_ADMIN)', result: rawPlans.length, count: rawPlans.length });
    console.log('getActionPlansRaw returned', rawPlans.length, 'action plans for SUPER_ADMIN');

    if (rawPlans.length > 0) {
      console.log('First plan ID:', rawPlans[0].action_plan_id);
      console.log('First plan status:', rawPlans[0].status);
      console.log('First plan owner_ids:', rawPlans[0].owner_ids);
      console.log('All statuses:', JSON.stringify(rawPlans.map(function(p) { return p.status; })
        .reduce(function(acc, s) { acc[s] = (acc[s] || 0) + 1; return acc; }, {})));
    } else {
      report.errors.push('CRITICAL: getActionPlansRaw returned 0 plans even for SUPER_ADMIN. ' +
        'This means the data layer (Firestore) has no action plan records.');
    }
  } catch (e) {
    report.errors.push('getActionPlansRaw failed: ' + e.message);
    console.error('getActionPlansRaw error:', e.message, e.stack);
  }

  // ─────────────────────────────────────────────
  // CHECK 6: Test getActionPlans (with sanitization + field restrictions)
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 6: getActionPlans (with applyFieldRestrictions) as SUPER_ADMIN ---');
  try {
    var mockSuperAdmin2 = {
      user_id: 'DIAG_TEST',
      email: 'diagnostic@test',
      role_code: 'SUPER_ADMIN',
      full_name: 'Diagnostic Test'
    };

    invalidateSheetData(SHEETS.ACTION_PLANS);
    var filteredPlans = getActionPlans({}, mockSuperAdmin2);
    var isArray = Array.isArray(filteredPlans);
    var filteredCount = isArray ? filteredPlans.length : -1;

    report.checks.push({ check: 'getActionPlans(SUPER_ADMIN)', result: filteredCount, isArray: isArray });
    console.log('getActionPlans returned type:', typeof filteredPlans, 'isArray:', isArray, 'count:', filteredCount);

    if (isArray && filteredCount > 0) {
      console.log('First filtered plan keys:', Object.keys(filteredPlans[0]).join(', '));
      // Check if key fields survived field_restrictions
      var hasId = filteredPlans[0].hasOwnProperty('action_plan_id');
      var hasDesc = filteredPlans[0].hasOwnProperty('action_description');
      var hasStatus = filteredPlans[0].hasOwnProperty('status');
      console.log('Has action_plan_id:', hasId, '| Has action_description:', hasDesc, '| Has status:', hasStatus);

      if (!hasId || !hasDesc || !hasStatus) {
        report.errors.push('CRITICAL: applyFieldRestrictions is stripping essential fields! ' +
          'Check 02_Permissions sheet for SUPER_ADMIN ACTION_PLAN field_restrictions. ' +
          'Fields present: ' + Object.keys(filteredPlans[0]).join(', '));
      }
    } else if (filteredCount === 0) {
      report.warnings.push('getActionPlans returned 0 plans after filtering/sanitization');
    }
  } catch (e) {
    report.errors.push('getActionPlans failed: ' + e.message);
    console.error('getActionPlans error:', e.message, e.stack);
  }

  // ─────────────────────────────────────────────
  // CHECK 7: Test the full API route (simulates frontend call)
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 7: Full API Route Simulation ---');
  try {
    var mockUser = {
      user_id: 'DIAG_TEST',
      email: 'diagnostic@test',
      role_code: 'SUPER_ADMIN',
      full_name: 'Diagnostic Test'
    };

    invalidateSheetData(SHEETS.ACTION_PLANS);
    var routeResult = routeAction('getActionPlans', { filters: {} }, mockUser);

    console.log('routeAction result type:', typeof routeResult);
    console.log('routeAction result success:', routeResult ? routeResult.success : 'null');
    console.log('routeAction result.actionPlans is array:', routeResult ? Array.isArray(routeResult.actionPlans) : 'null');
    console.log('routeAction result.actionPlans count:', routeResult && routeResult.actionPlans ? routeResult.actionPlans.length : 'null');

    if (routeResult && routeResult.error) {
      report.errors.push('Route returned error: ' + routeResult.error);
      console.error('Route error:', routeResult.error);
    }

    if (routeResult && routeResult.success && routeResult.actionPlans) {
      report.checks.push({ check: 'Full API route', result: 'OK', count: routeResult.actionPlans.length });

      // Verify the response shape matches what frontend expects
      var sampleForFrontend = routeResult.actionPlans[0];
      if (sampleForFrontend) {
        console.log('Frontend-facing record sample:', JSON.stringify(sampleForFrontend).substring(0, 500));
      }
    } else {
      report.checks.push({ check: 'Full API route', result: 'FAIL', response: JSON.stringify(routeResult).substring(0, 300) });
    }
  } catch (e) {
    report.errors.push('Full route simulation failed: ' + e.message);
    console.error('Route simulation error:', e.message, e.stack);
  }

  // ─────────────────────────────────────────────
  // CHECK 8: Permissions for all relevant roles
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 8: Permission Check for All Roles ---');
  var rolesToCheck = ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'AUDITOR', 'SENIOR_MGMT', 'MANAGEMENT', 'AUDITEE', 'UNIT_MANAGER', 'BOARD'];

  rolesToCheck.forEach(function(role) {
    try {
      var perms = getPermissions(role);
      var apPerm = perms.ACTION_PLAN || {};
      var fieldRestrictions = apPerm.field_restrictions || [];
      console.log(role + ': can_read=' + apPerm.can_read +
        ' | can_create=' + apPerm.can_create +
        ' | can_approve=' + apPerm.can_approve +
        ' | field_restrictions=[' + fieldRestrictions.join(',') + ']');

      report.checks.push({
        check: 'Permissions for ' + role,
        can_read: apPerm.can_read,
        can_create: apPerm.can_create,
        field_restrictions: fieldRestrictions
      });

      // Flag if critical fields are restricted
      var criticalFields = ['action_plan_id', 'action_description', 'status', 'owner_ids', 'owner_names', 'due_date', 'work_paper_id'];
      var blockedCritical = fieldRestrictions.filter(function(f) { return criticalFields.indexOf(f) !== -1; });
      if (blockedCritical.length > 0) {
        report.errors.push('WARNING: Role ' + role + ' has critical fields restricted: ' + blockedCritical.join(', ') +
          '. This will hide action plan data in the UI.');
      }

      // SUPER_ADMIN bypasses all permission checks in code, so missing DB entry is OK
      if (!apPerm.can_read && ['SENIOR_AUDITOR', 'AUDITOR'].indexOf(role) !== -1) {
        report.warnings.push('Role ' + role + ' has no can_read in 02_Permissions for ACTION_PLAN (code fallback handles this).');
      }
      if (!apPerm.can_read && role === 'SUPER_ADMIN') {
        report.checks.push({ check: 'SUPER_ADMIN AP permission', result: 'OK (bypasses all checks in code)' });
      }
    } catch (e) {
      report.warnings.push('Permission check for ' + role + ' failed: ' + e.message);
    }
  });

  // ─────────────────────────────────────────────
  // CHECK 9: Test with different roles (data visibility)
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 9: Data Visibility by Role ---');

  // For AUDITEE test, find a real owner_id from the data so we get a meaningful result
  var realOwnerId = 'DIAG_AUDITEE';
  try {
    var sampleData = getSheetData(SHEETS.ACTION_PLANS);
    if (sampleData && sampleData.length > 1) {
      var ownerCol = sampleData[0].indexOf('owner_ids');
      if (ownerCol !== -1) {
        for (var oi = 1; oi < sampleData.length; oi++) {
          var oid = String(sampleData[oi][ownerCol] || '').split(',')[0].trim();
          if (oid) { realOwnerId = oid; break; }
        }
      }
    }
  } catch (e) { /* use fallback */ }
  console.log('Using real owner_id for AUDITEE test:', realOwnerId);

  var visibilityTests = [
    { role: 'SUPER_ADMIN', userId: 'DIAG_SUPER_ADMIN' },
    { role: 'AUDITOR', userId: 'DIAG_AUDITOR' },
    { role: 'SENIOR_MGMT', userId: 'DIAG_SENIOR_MGMT' },
    { role: 'AUDITEE', userId: realOwnerId },
    { role: 'OBSERVER', userId: 'DIAG_OBSERVER' }
  ];

  visibilityTests.forEach(function(test) {
    try {
      var mockUser = { user_id: test.userId, email: 'diag@test', role_code: test.role, full_name: 'Test ' + test.role };
      invalidateSheetData(SHEETS.ACTION_PLANS);
      var plans = getActionPlansRaw({}, mockUser);
      console.log(test.role + ' (user_id=' + test.userId + '): sees', plans.length, 'action plans');
      report.checks.push({ check: 'Visibility for ' + test.role, count: plans.length });

      if (test.role === 'AUDITEE' && plans.length === 0 && realOwnerId !== 'DIAG_AUDITEE') {
        report.warnings.push('AUDITEE with owner_id ' + realOwnerId + ' sees 0 plans. Check owner_ids field format in action plans.');
      }
    } catch (e) {
      report.warnings.push('Visibility test for ' + test.role + ' failed: ' + e.message);
    }
  });

  // ─────────────────────────────────────────────
  // CHECK 10: SCHEMAS definition check
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 10: SCHEMAS Check ---');
  try {
    if (typeof SCHEMAS !== 'undefined' && SCHEMAS.ACTION_PLANS) {
      console.log('SCHEMAS.ACTION_PLANS defined:', JSON.stringify(SCHEMAS.ACTION_PLANS));
      report.checks.push({ check: 'SCHEMAS.ACTION_PLANS defined', result: true, columns: SCHEMAS.ACTION_PLANS.length });
    } else {
      report.warnings.push('SCHEMAS.ACTION_PLANS not defined - headers will be inferred from first Firestore doc');
      console.log('SCHEMAS.ACTION_PLANS: not defined');
    }
  } catch (e) {
    report.warnings.push('SCHEMAS check error: ' + e.message);
  }

  // ─────────────────────────────────────────────
  // CHECK 11: canUserPerform for ACTION_PLAN CRUD (tests the fallback)
  // ─────────────────────────────────────────────
  console.log('\n--- CHECK 11: canUserPerform for ACTION_PLAN CRUD ---');
  var crudTests = [
    { role: 'SENIOR_AUDITOR', action: 'create', expected: true },
    { role: 'SENIOR_AUDITOR', action: 'update', expected: true },
    { role: 'AUDITOR', action: 'create', expected: true },
    { role: 'AUDITOR', action: 'update', expected: true },
    { role: 'AUDITOR', action: 'delete', expected: true },
    { role: 'AUDITEE', action: 'read', expected: true },
    { role: 'AUDITEE', action: 'update', expected: true },
    { role: 'AUDITEE', action: 'create', expected: false },
    { role: 'MANAGEMENT', action: 'read', expected: true }
  ];

  crudTests.forEach(function(test) {
    try {
      var mockUser = { user_id: 'DIAG_TEST', email: 'diag@test', role_code: test.role, full_name: 'Test ' + test.role };
      var result = canUserPerform(mockUser, test.action, 'ACTION_PLAN', null);
      var pass = result === test.expected;
      console.log(test.role + ' ' + test.action + ' ACTION_PLAN: ' + result + (pass ? ' OK' : ' FAIL (expected ' + test.expected + ')'));
      report.checks.push({ check: 'canUserPerform ' + test.role + ' ' + test.action, result: result, expected: test.expected });

      if (!pass) {
        report.errors.push('canUserPerform mismatch: ' + test.role + ' ' + test.action + ' ACTION_PLAN returned ' + result + ', expected ' + test.expected);
      }
    } catch (e) {
      report.errors.push('canUserPerform test failed for ' + test.role + ' ' + test.action + ': ' + e.message);
    }
  });

  // ─────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────
  console.log('\n====================================================');
  console.log('=== DIAGNOSTIC SUMMARY                           ===');
  console.log('====================================================');
  console.log('Errors:', report.errors.length);
  report.errors.forEach(function(e) { console.error('  - ' + e); });
  console.log('Warnings:', report.warnings.length);
  report.warnings.forEach(function(w) { console.warn('  - ' + w); });
  console.log('Checks passed:', report.checks.length);

  if (report.errors.length === 0) {
    report.summary = 'All checks passed. If action plans still not showing, the issue is likely in the frontend (browser console) or session/auth.';
  } else {
    report.summary = report.errors.length + ' error(s) found. See errors list above.';
  }

  console.log('Summary:', report.summary);
  console.log('====================================================');

  return report;
}

/**
 * Quick fix: If Firestore is empty but Sheet has data, resync Sheet -> Firestore
 */
function resyncActionPlansToFirestore() {
  console.log('=== Resyncing Action Plans: Sheet -> Firestore ===');

  var sheet = getSheet(SHEETS.ACTION_PLANS);
  if (!sheet) {
    console.error('Sheet not found:', SHEETS.ACTION_PLANS);
    return { success: false, error: 'Sheet not found' };
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    console.log('No data rows in sheet');
    return { success: false, error: 'No data in sheet' };
  }

  var headers = data[0];
  var idIdx = headers.indexOf('action_plan_id');
  if (idIdx === -1) {
    return { success: false, error: 'action_plan_id column not found in sheet headers' };
  }

  var synced = 0;
  var errors = 0;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var actionPlanId = row[idIdx];
    if (!actionPlanId) continue;

    var obj = {};
    for (var h = 0; h < headers.length; h++) {
      obj[headers[h]] = row[h] !== undefined && row[h] !== null ? row[h] : '';
    }

    try {
      syncToFirestore(SHEETS.ACTION_PLANS, actionPlanId, obj);
      synced++;
    } catch (e) {
      console.error('Failed to sync', actionPlanId, ':', e.message);
      errors++;
    }
  }

  invalidateSheetData(SHEETS.ACTION_PLANS);
  console.log('Resync complete. Synced:', synced, 'Errors:', errors);
  return { success: true, synced: synced, errors: errors };
}
