/**
 * DASHBOARD DEBUG SCRIPT
 *
 * Purpose: Diagnose "Error loading dashboard" issues
 * Run this in Apps Script Editor: Run > debugDashboard
 * View output: View > Logs
 *
 * Created: Diagnostic tool for Dashboard module
 */

/**
 * Main debug function - Run this to diagnose Dashboard issues
 */
function debugDashboard() {
  var results = [];
  var separator = "═".repeat(60);

  results.push(separator);
  results.push("DASHBOARD DEBUG REPORT");
  results.push("Generated: " + new Date().toISOString());
  results.push(separator);

  // ============================================================
  // TEST 1: DATABASE CONNECTIVITY
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 1: DATABASE CONNECTIVITY");
  results.push("═".repeat(60));

  try {
    var spreadsheetId = CONFIG.SPREADSHEET_ID;
    results.push("Spreadsheet ID: " + spreadsheetId);

    var db = SpreadsheetApp.openById(spreadsheetId);
    results.push("✓ Spreadsheet opened successfully");
    results.push("  Name: " + db.getName());
    results.push("  URL: " + db.getUrl());

    // List all sheets
    var sheets = db.getSheets();
    results.push("\nSheet tabs found (" + sheets.length + " total):");
    sheets.forEach(function(sheet, idx) {
      results.push("  " + (idx + 1) + ". " + sheet.getName() + " (" + sheet.getLastRow() + " rows)");
    });

  } catch (e) {
    results.push("✗ DATABASE CONNECTION FAILED: " + e.message);
    results.push("\n" + separator);
    results.push("CRITICAL: Cannot proceed without database access");
    Logger.log(results.join("\n"));
    return results.join("\n");
  }

  // ============================================================
  // TEST 2: SHEET STRUCTURE VALIDATION
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 2: SHEET STRUCTURE VALIDATION");
  results.push("═".repeat(60));

  var dashboardSheets = [
    { name: '05_Users', key: 'USERS', required: true },
    { name: '09_WorkPapers', key: 'WORK_PAPERS', required: true },
    { name: '13_ActionPlans', key: 'ACTION_PLANS', required: true },
    { name: '06_Affiliates', key: 'AFFILIATES', required: true },
    { name: '07_AuditAreas', key: 'AUDIT_AREAS', required: true },
    { name: '00_Config', key: 'CONFIG', required: true },
    { name: '01_Roles', key: 'ROLES', required: true },
    { name: '17_Index_WorkPapers', key: 'INDEX_WP', required: false },
    { name: '18_Index_ActionPlans', key: 'INDEX_AP', required: false },
    { name: '20_Sessions', key: 'SESSIONS', required: true }
  ];

  dashboardSheets.forEach(function(sheetInfo) {
    try {
      var sheet = getSheet(sheetInfo.name);
      if (sheet) {
        var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        var rowCount = sheet.getLastRow() - 1;

        results.push("\n" + sheetInfo.name + " (" + sheetInfo.key + "):");
        results.push("  ✓ Status: FOUND");
        results.push("  ✓ Rows: " + rowCount + " data rows");
        results.push("  ✓ Columns: " + headers.length);
        results.push("  ✓ Headers: " + headers.slice(0, 5).join(", ") + (headers.length > 5 ? "..." : ""));
      } else {
        results.push("\n" + sheetInfo.name + " (" + sheetInfo.key + "):");
        results.push("  ✗ Status: NOT FOUND" + (sheetInfo.required ? " [CRITICAL]" : " [Optional]"));
      }
    } catch (e) {
      results.push("\n" + sheetInfo.name + ": ✗ ERROR - " + e.message);
    }
  });

  // ============================================================
  // TEST 3: USER AUTHENTICATION CHECK
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 3: USER AUTHENTICATION CHECK");
  results.push("═".repeat(60));

  try {
    var activeEmail = Session.getActiveUser().getEmail();
    results.push("Session.getActiveUser().getEmail(): '" + activeEmail + "'");

    if (!activeEmail || activeEmail === '') {
      results.push("⚠ WARNING: getEmail() returned empty string");
      results.push("  This happens with 'Anyone with Google Account' deployment");
      results.push("  Session-based auth should be used instead");
    }

    if (activeEmail) {
      var user = getUserByEmail(activeEmail);
      if (user) {
        results.push("✓ User found in database:");
        results.push("  user_id: " + user.user_id);
        results.push("  full_name: " + user.full_name);
        results.push("  role_code: " + user.role_code);
        results.push("  is_active: " + user.is_active);
      } else {
        results.push("✗ User NOT found in 05_Users sheet");
        results.push("  The logged-in user must exist in the Users sheet");
      }
    }

    // Test getCurrentUser()
    results.push("\nTesting getCurrentUser():");
    var currentUser = getCurrentUser();
    if (currentUser) {
      results.push("✓ getCurrentUser() returned: " + currentUser.full_name);
    } else {
      results.push("✗ getCurrentUser() returned NULL");
      results.push("  This is likely the root cause of dashboard failures");
    }

  } catch (e) {
    results.push("✗ Authentication test failed: " + e.message);
  }

  // ============================================================
  // TEST 4: BACKEND FUNCTION EXECUTION
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 4: BACKEND FUNCTION EXECUTION");
  results.push("═".repeat(60));

  // Test with a mock user if getCurrentUser fails
  var testUser = getCurrentUser();
  if (!testUser) {
    results.push("⚠ No current user - attempting to use first active user from DB...");
    try {
      var usersSheet = getSheet('05_Users');
      var userData = usersSheet.getDataRange().getValues();
      var headers = userData[0];
      var activeIdx = headers.indexOf('is_active');
      var roleIdx = headers.indexOf('role_code');

      for (var i = 1; i < userData.length; i++) {
        if (isActive(userData[i][activeIdx]) && userData[i][roleIdx] === 'SUPER_ADMIN') {
          testUser = rowToObject(headers, userData[i]);
          testUser._rowIndex = i + 1;
          results.push("  Using test user: " + testUser.full_name + " (" + testUser.email + ")");
          break;
        }
      }
    } catch (e) {
      results.push("  Could not find test user: " + e.message);
    }
  }

  if (testUser) {
    // Test getDashboardData
    results.push("\n4.1 Testing getDashboardData(user):");
    try {
      var dashboardData = getDashboardData(testUser);
      results.push("  ✓ Function executed successfully");
      results.push("  ✓ summary.workPapers.total: " + (dashboardData.summary?.workPapers?.total || 0));
      results.push("  ✓ summary.actionPlans.total: " + (dashboardData.summary?.actionPlans?.total || 0));
      results.push("  ✓ summary.actionPlans.overdue: " + (dashboardData.summary?.actionPlans?.overdue || 0));
      results.push("  ✓ alerts count: " + (dashboardData.alerts?.length || 0));
      results.push("  ✓ recentActivity count: " + (dashboardData.recentActivity?.length || 0));
      results.push("  ✓ charts.wpStatusChart labels: " + (dashboardData.charts?.wpStatusChart?.labels?.length || 0));
    } catch (e) {
      results.push("  ✗ FAILED: " + e.message);
      results.push("  Stack: " + e.stack);
    }

    // Test getWorkPaperCounts
    results.push("\n4.2 Testing getWorkPaperCounts({}, user):");
    try {
      var wpCounts = getWorkPaperCounts({}, testUser);
      results.push("  ✓ Total: " + wpCounts.total);
      results.push("  ✓ By Status: " + JSON.stringify(wpCounts.byStatus));
      results.push("  ✓ By Risk: " + JSON.stringify(wpCounts.byRisk));
    } catch (e) {
      results.push("  ✗ FAILED: " + e.message);
    }

    // Test getActionPlanCounts
    results.push("\n4.3 Testing getActionPlanCounts({}, user):");
    try {
      var apCounts = getActionPlanCounts({}, testUser);
      results.push("  ✓ Total: " + apCounts.total);
      results.push("  ✓ Overdue: " + apCounts.overdue);
      results.push("  ✓ Due This Week: " + apCounts.dueThisWeek);
      results.push("  ✓ By Status: " + JSON.stringify(apCounts.byStatus));
    } catch (e) {
      results.push("  ✗ FAILED: " + e.message);
    }

    // Test getWorkPapers
    results.push("\n4.4 Testing getWorkPapers({ limit: 5 }, user):");
    try {
      var workPapers = getWorkPapers({ limit: 5 }, testUser);
      results.push("  ✓ Returned: " + workPapers.length + " work papers");
      if (workPapers.length > 0) {
        results.push("  ✓ First WP ID: " + workPapers[0].work_paper_id);
        results.push("  ✓ First WP Status: " + workPapers[0].status);
      }
    } catch (e) {
      results.push("  ✗ FAILED: " + e.message);
    }

    // Test getActionPlans
    results.push("\n4.5 Testing getActionPlans({ limit: 5 }, user):");
    try {
      var actionPlans = getActionPlans({ limit: 5 }, testUser);
      results.push("  ✓ Returned: " + actionPlans.length + " action plans");
      if (actionPlans.length > 0) {
        results.push("  ✓ First AP ID: " + actionPlans[0].action_plan_id);
        results.push("  ✓ First AP Status: " + actionPlans[0].status);
      }
    } catch (e) {
      results.push("  ✗ FAILED: " + e.message);
    }

    // Test getInitData
    results.push("\n4.6 Testing getInitDataWithUser(user):");
    try {
      var initData = getInitDataWithUser(testUser);
      results.push("  ✓ success: " + initData.success);
      if (initData.success) {
        results.push("  ✓ user.full_name: " + initData.user.full_name);
        results.push("  ✓ dropdowns loaded: " + Object.keys(initData.dropdowns || {}).length + " types");
        results.push("  ✓ permissions: " + JSON.stringify(initData.permissions).substring(0, 100) + "...");
      } else {
        results.push("  ✗ Error: " + initData.error);
      }
    } catch (e) {
      results.push("  ✗ FAILED: " + e.message);
    }
  } else {
    results.push("✗ Cannot test backend functions - no user available");
  }

  // ============================================================
  // TEST 5: DATA FORMAT VALIDATION
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 5: DATA FORMAT VALIDATION");
  results.push("═".repeat(60));

  if (testUser) {
    try {
      var sampleDashboard = getDashboardData(testUser);

      results.push("\nExpected Dashboard Structure:");
      results.push("  {");
      results.push("    user: { user_id, full_name, email, role_code, role_name, affiliate_code }");
      results.push("    summary: { workPapers: {...}, actionPlans: {...} }");
      results.push("    recentActivity: [...]");
      results.push("    charts: { wpStatusChart, apStatusChart, riskChart, trendChart }");
      results.push("    alerts: [...]");
      results.push("    quickLinks: [...]");
      results.push("  }");

      results.push("\nActual Response Structure:");
      results.push("  user: " + (sampleDashboard.user ? "✓ Present" : "✗ Missing"));
      results.push("  summary: " + (sampleDashboard.summary ? "✓ Present" : "✗ Missing"));
      results.push("    workPapers: " + (sampleDashboard.summary?.workPapers ? "✓ Present" : "✗ Missing"));
      results.push("    actionPlans: " + (sampleDashboard.summary?.actionPlans ? "✓ Present" : "✗ Missing"));
      results.push("  recentActivity: " + (Array.isArray(sampleDashboard.recentActivity) ? "✓ Array[" + sampleDashboard.recentActivity.length + "]" : "✗ Not array"));
      results.push("  charts: " + (sampleDashboard.charts ? "✓ Present" : "✗ Missing"));
      results.push("    wpStatusChart: " + (sampleDashboard.charts?.wpStatusChart ? "✓ Present" : "✗ Missing"));
      results.push("    apStatusChart: " + (sampleDashboard.charts?.apStatusChart ? "✓ Present" : "✗ Missing"));
      results.push("    riskChart: " + (sampleDashboard.charts?.riskChart ? "✓ Present" : "✗ Missing"));
      results.push("    trendChart: " + (sampleDashboard.charts?.trendChart ? "✓ Present" : "✗ Missing"));
      results.push("  alerts: " + (Array.isArray(sampleDashboard.alerts) ? "✓ Array[" + sampleDashboard.alerts.length + "]" : "✗ Not array"));

    } catch (e) {
      results.push("✗ Data format test failed: " + e.message);
    }
  }

  // ============================================================
  // TEST 6: CONFIGURATION CHECK
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 6: CONFIGURATION CHECK");
  results.push("═".repeat(60));

  try {
    results.push("\nCore Configuration:");
    results.push("  SPREADSHEET_ID: " + CONFIG.SPREADSHEET_ID);

    // Check if SHEETS constant matches actual sheets
    results.push("\nSheet Name Mappings (SHEETS constant):");
    var sheetsToCheck = ['CONFIG', 'USERS', 'WORK_PAPERS', 'ACTION_PLANS', 'SESSIONS'];
    sheetsToCheck.forEach(function(key) {
      var sheetName = SHEETS[key];
      var sheet = getSheet(sheetName);
      results.push("  " + key + " -> '" + sheetName + "': " + (sheet ? "✓ Found" : "✗ NOT FOUND"));
    });

    // Check critical config values
    results.push("\nConfig Values (from 00_Config):");
    var configKeys = ['SYSTEM_NAME', 'SESSION_DURATION_HOURS', 'MAX_LOGIN_ATTEMPTS'];
    configKeys.forEach(function(key) {
      try {
        var value = getConfigValue(key);
        results.push("  " + key + ": " + (value || "(not set)"));
      } catch (e) {
        results.push("  " + key + ": ✗ Error - " + e.message);
      }
    });

    // Check STATUS constants
    results.push("\nStatus Constants:");
    results.push("  Work Paper statuses: " + Object.values(STATUS.WORK_PAPER).join(", "));
    results.push("  Action Plan statuses: " + Object.values(STATUS.ACTION_PLAN).join(", "));

  } catch (e) {
    results.push("✗ Configuration check failed: " + e.message);
  }

  // ============================================================
  // TEST 7: SESSION VALIDATION (for session-based auth)
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("TEST 7: SESSION VALIDATION");
  results.push("═".repeat(60));

  try {
    var sessionsSheet = getSheet('20_Sessions');
    if (sessionsSheet) {
      var sessionData = sessionsSheet.getDataRange().getValues();
      var validSessions = 0;
      var expiredSessions = 0;
      var now = new Date();

      for (var i = 1; i < sessionData.length; i++) {
        var headers = sessionData[0];
        var validIdx = headers.indexOf('is_valid');
        var expiresIdx = headers.indexOf('expires_at');

        if (sessionData[i][validIdx] === true || sessionData[i][validIdx] === 'TRUE') {
          var expiresAt = new Date(sessionData[i][expiresIdx]);
          if (expiresAt > now) {
            validSessions++;
          } else {
            expiredSessions++;
          }
        }
      }

      results.push("  Total sessions: " + (sessionData.length - 1));
      results.push("  Valid (active): " + validSessions);
      results.push("  Expired: " + expiredSessions);

      if (validSessions === 0) {
        results.push("  ⚠ No valid sessions - users may need to re-login");
      }
    }
  } catch (e) {
    results.push("✗ Session check failed: " + e.message);
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  results.push("\n" + "═".repeat(60));
  results.push("SUMMARY");
  results.push("═".repeat(60));

  var failCount = results.filter(function(r) { return r.includes("✗"); }).length;
  var warnCount = results.filter(function(r) { return r.includes("⚠"); }).length;
  var passCount = results.filter(function(r) { return r.includes("✓"); }).length;

  results.push("\nTest Results:");
  results.push("  ✓ Passed: " + passCount);
  results.push("  ⚠ Warnings: " + warnCount);
  results.push("  ✗ Failed: " + failCount);

  if (failCount > 0) {
    results.push("\n⚠ ISSUES DETECTED - Review failed tests above");
    results.push("  Common causes:");
    results.push("  1. getCurrentUser() returns null - Session.getActiveUser().getEmail() empty");
    results.push("  2. User not in 05_Users sheet");
    results.push("  3. Sheet tabs renamed or missing");
    results.push("  4. Spreadsheet ID incorrect");
  } else {
    results.push("\n✓ All tests passed - Backend is functioning correctly");
    results.push("  If dashboard still fails, issue is likely in frontend");
  }

  results.push("\n" + separator);
  results.push("END OF DEBUG REPORT");
  results.push(separator);

  // Output to console
  Logger.log(results.join("\n"));
  console.log(results.join("\n"));

  return results.join("\n");
}

/**
 * Quick test for frontend-backend connection
 * Call this from browser console via google.script.run.testConnection()
 */
function testConnection() {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    message: "Backend is reachable",
    userEmail: Session.getActiveUser().getEmail() || "(empty)",
    spreadsheetId: CONFIG.SPREADSHEET_ID
  };
}

/**
 * Test apiCall function directly
 */
function testApiCall() {
  var results = [];

  results.push("Testing apiCall() function...\n");

  // Test ping (public action)
  try {
    var pingResult = apiCall('ping', {});
    results.push("1. apiCall('ping'): " + JSON.stringify(pingResult));
  } catch (e) {
    results.push("1. apiCall('ping'): ERROR - " + e.message);
  }

  // Test getInitData (requires auth)
  try {
    var initResult = apiCall('getInitData', {});
    results.push("2. apiCall('getInitData'): " + (initResult.success ? "SUCCESS" : "FAILED - " + initResult.error));
  } catch (e) {
    results.push("2. apiCall('getInitData'): ERROR - " + e.message);
  }

  // Test getDashboardData (requires auth)
  try {
    var dashResult = apiCall('getDashboardData', {});
    results.push("3. apiCall('getDashboardData'): " + (dashResult.summary ? "SUCCESS (WP: " + dashResult.summary.workPapers.total + ")" : "FAILED - " + (dashResult.error || "no data")));
  } catch (e) {
    results.push("3. apiCall('getDashboardData'): ERROR - " + e.message);
  }

  Logger.log(results.join("\n"));
  return results.join("\n");
}

/**
 * Rebuild all indexes (run if data seems out of sync)
 */
function rebuildAllIndexes() {
  var results = [];
  results.push("Rebuilding indexes...\n");

  try {
    Index.rebuild('WORK_PAPER');
    results.push("✓ Work Paper index rebuilt");
  } catch (e) {
    results.push("✗ Work Paper index failed: " + e.message);
  }

  try {
    Index.rebuild('ACTION_PLAN');
    results.push("✓ Action Plan index rebuilt");
  } catch (e) {
    results.push("✗ Action Plan index failed: " + e.message);
  }

  try {
    Index.rebuild('USER');
    results.push("✓ User index rebuilt");
  } catch (e) {
    results.push("✗ User index failed: " + e.message);
  }

  // Clear all caches
  Cache.clearAll();
  results.push("✓ Caches cleared");

  Logger.log(results.join("\n"));
  return results.join("\n");
}

/**
 * Clear all caches (run if seeing stale data)
 */
function clearAllCaches() {
  try {
    Cache.clearAll();
    invalidateDropdownCache();
    return "All caches cleared successfully";
  } catch (e) {
    return "Error clearing caches: " + e.message;
  }
}
