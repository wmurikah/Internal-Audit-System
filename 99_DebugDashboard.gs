/**
 * DASHBOARD DIAGNOSTIC DEBUG SCRIPT
 *
 * Run this script in Apps Script Editor to diagnose Dashboard loading issues.
 * Function: debugDashboard()
 *
 * This script tests:
 * 1. Database connectivity
 * 2. Sheet structure validation
 * 3. Backend function execution
 * 4. Data format validation
 * 5. Configuration check
 */

function debugDashboard() {
  var results = [];
  var errors = [];

  results.push("═══════════════════════════════════════════════════════════════");
  results.push("   DASHBOARD DIAGNOSTIC DEBUG SCRIPT");
  results.push("   Run Time: " + new Date().toISOString());
  results.push("═══════════════════════════════════════════════════════════════");

  // ============================================================
  // TEST 1: DATABASE CONNECTIVITY
  // ============================================================
  results.push("\n╔═══════════════════════════════════════════════════════════════╗");
  results.push("║  TEST 1: DATABASE CONNECTIVITY                                ║");
  results.push("╚═══════════════════════════════════════════════════════════════╝");

  try {
    // Check if CONFIG is defined
    var spreadsheetId = typeof CONFIG !== 'undefined' ? CONFIG.SPREADSHEET_ID : '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4';
    results.push("✓ Spreadsheet ID: " + spreadsheetId);

    // Try to open the spreadsheet
    var ss = SpreadsheetApp.openById(spreadsheetId);
    results.push("✓ Spreadsheet opened successfully");
    results.push("  Name: " + ss.getName());
    results.push("  URL: " + ss.getUrl());

    // List all sheets
    var sheets = ss.getSheets();
    results.push("\n  All sheet tabs (" + sheets.length + " total):");
    sheets.forEach(function(sheet, idx) {
      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      results.push("    " + (idx + 1) + ". " + sheet.getName() + " (" + lastRow + " rows, " + lastCol + " cols)");
    });

    results.push("\n✓ TEST 1 PASSED: Database is accessible");

  } catch (e) {
    errors.push("TEST 1 FAILED: " + e.message);
    results.push("✗ TEST 1 FAILED: " + e.message);
    results.push("  Stack: " + e.stack);
  }

  // ============================================================
  // TEST 2: SHEET STRUCTURE VALIDATION
  // ============================================================
  results.push("\n╔═══════════════════════════════════════════════════════════════╗");
  results.push("║  TEST 2: SHEET STRUCTURE VALIDATION                           ║");
  results.push("╚═══════════════════════════════════════════════════════════════╝");

  var dashboardSheets = [
    { name: '09_WorkPapers', requiredCols: ['work_paper_id', 'status', 'risk_rating', 'affiliate_code', 'prepared_by_id', 'created_at'] },
    { name: '13_ActionPlans', requiredCols: ['action_plan_id', 'work_paper_id', 'status', 'due_date', 'owner_ids', 'created_at'] },
    { name: '05_Users', requiredCols: ['user_id', 'email', 'full_name', 'role_code', 'is_active'] },
    { name: '00_Config', requiredCols: ['config_key', 'config_value'] },
    { name: '06_Affiliates', requiredCols: ['affiliate_code', 'affiliate_name', 'is_active'] }
  ];

  dashboardSheets.forEach(function(sheetInfo) {
    try {
      results.push("\n  Checking: " + sheetInfo.name);

      var sheet = SpreadsheetApp.openById(typeof CONFIG !== 'undefined' ? CONFIG.SPREADSHEET_ID : '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4').getSheetByName(sheetInfo.name);

      if (!sheet) {
        errors.push("Sheet not found: " + sheetInfo.name);
        results.push("    ✗ Sheet NOT FOUND!");
        return;
      }

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();

      results.push("    ✓ Sheet exists");
      results.push("    ✓ Data rows: " + (lastRow - 1) + " (excluding header)");
      results.push("    ✓ Columns: " + lastCol);

      // Check headers
      if (lastCol > 0) {
        var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        results.push("    ✓ Headers: " + headers.slice(0, 5).join(", ") + (headers.length > 5 ? "... (" + headers.length + " total)" : ""));

        // Check required columns
        var missingCols = [];
        sheetInfo.requiredCols.forEach(function(col) {
          if (headers.indexOf(col) === -1) {
            missingCols.push(col);
          }
        });

        if (missingCols.length > 0) {
          errors.push("Missing columns in " + sheetInfo.name + ": " + missingCols.join(", "));
          results.push("    ✗ MISSING COLUMNS: " + missingCols.join(", "));
        } else {
          results.push("    ✓ All required columns present");
        }
      }

    } catch (e) {
      errors.push("Error checking " + sheetInfo.name + ": " + e.message);
      results.push("    ✗ Error: " + e.message);
    }
  });

  results.push("\n" + (errors.length === 0 ? "✓ TEST 2 PASSED" : "✗ TEST 2 HAS ISSUES (see errors above)"));

  // ============================================================
  // TEST 3: BACKEND FUNCTION EXECUTION
  // ============================================================
  results.push("\n╔═══════════════════════════════════════════════════════════════╗");
  results.push("║  TEST 3: BACKEND FUNCTION EXECUTION                           ║");
  results.push("╚═══════════════════════════════════════════════════════════════╝");

  // Test getCurrentUser
  results.push("\n  3.1 Testing getCurrentUser()...");
  var currentUser = null;
  try {
    if (typeof getCurrentUser === 'function') {
      currentUser = getCurrentUser();
      if (currentUser) {
        results.push("    ✓ User found: " + currentUser.full_name);
        results.push("    ✓ Email: " + currentUser.email);
        results.push("    ✓ Role: " + currentUser.role_code);
      } else {
        results.push("    ⚠ getCurrentUser() returned null");
        results.push("    → This may be expected if running outside web context");

        // Try Session.getActiveUser as fallback
        var email = Session.getActiveUser().getEmail();
        results.push("    → Session email: " + (email || "(empty - try running as web app)"));

        if (email && typeof getUserByEmail === 'function') {
          currentUser = getUserByEmail(email);
          if (currentUser) {
            results.push("    ✓ Found user via getUserByEmail: " + currentUser.full_name);
          }
        }
      }
    } else {
      errors.push("getCurrentUser function not found");
      results.push("    ✗ getCurrentUser function not defined!");
    }
  } catch (e) {
    errors.push("getCurrentUser error: " + e.message);
    results.push("    ✗ Error: " + e.message);
  }

  // Test getWorkPapers
  results.push("\n  3.2 Testing getWorkPapers()...");
  try {
    if (typeof getWorkPapers === 'function') {
      var wps = getWorkPapers({ limit: 5 }, currentUser);
      results.push("    ✓ Function executed");
      results.push("    ✓ Returned: " + (Array.isArray(wps) ? wps.length + " work papers" : "type: " + typeof wps));
      if (Array.isArray(wps) && wps.length > 0) {
        results.push("    ✓ Sample: " + (wps[0].work_paper_id || wps[0].id || "ID not found"));
      }
    } else {
      errors.push("getWorkPapers function not found");
      results.push("    ✗ getWorkPapers function not defined!");
    }
  } catch (e) {
    errors.push("getWorkPapers error: " + e.message);
    results.push("    ✗ Error: " + e.message);
    results.push("    Stack: " + (e.stack || "").split("\n").slice(0,3).join("\n    "));
  }

  // Test getWorkPaperCounts
  results.push("\n  3.3 Testing getWorkPaperCounts()...");
  try {
    if (typeof getWorkPaperCounts === 'function') {
      var wpCounts = getWorkPaperCounts({}, currentUser);
      results.push("    ✓ Function executed");
      results.push("    ✓ Total: " + (wpCounts.total || 0));
      results.push("    ✓ By Status: " + JSON.stringify(wpCounts.byStatus || {}));
      results.push("    ✓ By Risk: " + JSON.stringify(wpCounts.byRisk || {}));
    } else {
      errors.push("getWorkPaperCounts function not found");
      results.push("    ✗ getWorkPaperCounts function not defined!");
    }
  } catch (e) {
    errors.push("getWorkPaperCounts error: " + e.message);
    results.push("    ✗ Error: " + e.message);
  }

  // Test getActionPlans
  results.push("\n  3.4 Testing getActionPlans()...");
  try {
    if (typeof getActionPlans === 'function') {
      var aps = getActionPlans({ limit: 5 }, currentUser);
      results.push("    ✓ Function executed");
      results.push("    ✓ Returned: " + (Array.isArray(aps) ? aps.length + " action plans" : "type: " + typeof aps));
    } else {
      errors.push("getActionPlans function not found");
      results.push("    ✗ getActionPlans function not defined!");
    }
  } catch (e) {
    errors.push("getActionPlans error: " + e.message);
    results.push("    ✗ Error: " + e.message);
  }

  // Test getActionPlanCounts
  results.push("\n  3.5 Testing getActionPlanCounts()...");
  try {
    if (typeof getActionPlanCounts === 'function') {
      var apCounts = getActionPlanCounts({}, currentUser);
      results.push("    ✓ Function executed");
      results.push("    ✓ Total: " + (apCounts.total || 0));
      results.push("    ✓ Overdue: " + (apCounts.overdue || 0));
      results.push("    ✓ Due This Week: " + (apCounts.dueThisWeek || 0));
      results.push("    ✓ By Status: " + JSON.stringify(apCounts.byStatus || {}));
    } else {
      errors.push("getActionPlanCounts function not found");
      results.push("    ✗ getActionPlanCounts function not defined!");
    }
  } catch (e) {
    errors.push("getActionPlanCounts error: " + e.message);
    results.push("    ✗ Error: " + e.message);
  }

  // Test getDashboardData (the main function)
  results.push("\n  3.6 Testing getDashboardData() [MAIN DASHBOARD FUNCTION]...");
  var dashboardData = null;
  try {
    if (typeof getDashboardData === 'function') {
      dashboardData = getDashboardData(currentUser);
      results.push("    ✓ Function executed");
      results.push("    ✓ Has user: " + (dashboardData.user ? "Yes - " + dashboardData.user.full_name : "No"));
      results.push("    ✓ Has summary: " + (dashboardData.summary ? "Yes" : "No"));
      results.push("    ✓ Has charts: " + (dashboardData.charts ? "Yes" : "No"));
      results.push("    ✓ Has alerts: " + (dashboardData.alerts ? dashboardData.alerts.length + " alerts" : "No"));
      results.push("    ✓ Has recentActivity: " + (dashboardData.recentActivity ? dashboardData.recentActivity.length + " items" : "No"));
    } else {
      errors.push("getDashboardData function not found");
      results.push("    ✗ getDashboardData function not defined!");
    }
  } catch (e) {
    errors.push("getDashboardData error: " + e.message);
    results.push("    ✗ Error: " + e.message);
    results.push("    Stack: " + (e.stack || "").split("\n").slice(0,5).join("\n    "));
  }

  results.push("\n" + (errors.length === 0 ? "✓ TEST 3 PASSED" : "✗ TEST 3 HAS ISSUES"));

  // ============================================================
  // TEST 4: DATA FORMAT VALIDATION
  // ============================================================
  results.push("\n╔═══════════════════════════════════════════════════════════════╗");
  results.push("║  TEST 4: DATA FORMAT VALIDATION                               ║");
  results.push("╚═══════════════════════════════════════════════════════════════╝");

  if (dashboardData) {
    results.push("\n  Dashboard data structure:");
    results.push("  " + JSON.stringify(Object.keys(dashboardData)));

    // Validate summary structure
    results.push("\n  4.1 Checking summary structure...");
    if (dashboardData.summary) {
      var summary = dashboardData.summary;
      results.push("    ✓ summary.workPapers exists: " + (summary.workPapers ? "Yes" : "No"));
      results.push("    ✓ summary.actionPlans exists: " + (summary.actionPlans ? "Yes" : "No"));

      if (summary.workPapers) {
        results.push("    ✓ workPapers.total: " + summary.workPapers.total);
        results.push("    ✓ workPapers.draft: " + summary.workPapers.draft);
      }
      if (summary.actionPlans) {
        results.push("    ✓ actionPlans.total: " + summary.actionPlans.total);
        results.push("    ✓ actionPlans.overdue: " + summary.actionPlans.overdue);
      }
    } else {
      errors.push("Dashboard summary is missing");
      results.push("    ✗ Summary is missing from dashboard data!");
    }

    // Validate charts structure
    results.push("\n  4.2 Checking charts structure...");
    if (dashboardData.charts) {
      var charts = dashboardData.charts;
      results.push("    ✓ charts.wpStatusChart: " + (charts.wpStatusChart ? "Yes" : "No"));
      results.push("    ✓ charts.apStatusChart: " + (charts.apStatusChart ? "Yes" : "No"));
      results.push("    ✓ charts.riskChart: " + (charts.riskChart ? "Yes" : "No"));
      results.push("    ✓ charts.trendChart: " + (charts.trendChart ? "Yes" : "No"));

      if (charts.wpStatusChart) {
        results.push("      - wpStatusChart labels: " + JSON.stringify(charts.wpStatusChart.labels));
        results.push("      - wpStatusChart data: " + JSON.stringify(charts.wpStatusChart.data));
      }
    } else {
      errors.push("Dashboard charts are missing");
      results.push("    ✗ Charts are missing from dashboard data!");
    }

    // Validate recentActivity structure
    results.push("\n  4.3 Checking recentActivity structure...");
    if (dashboardData.recentActivity && dashboardData.recentActivity.length > 0) {
      var sample = dashboardData.recentActivity[0];
      results.push("    ✓ Sample activity item:");
      results.push("      - type: " + sample.type);
      results.push("      - id: " + sample.id);
      results.push("      - title: " + (sample.title || "").substring(0, 50));
      results.push("      - status: " + sample.status);
    } else {
      results.push("    ⚠ No recent activity items (may be normal if no data)");
    }

  } else {
    errors.push("No dashboard data to validate");
    results.push("  ✗ No dashboard data available for format validation");
  }

  results.push("\n" + (errors.length === 0 ? "✓ TEST 4 PASSED" : "✗ TEST 4 HAS ISSUES"));

  // ============================================================
  // TEST 5: CONFIGURATION CHECK
  // ============================================================
  results.push("\n╔═══════════════════════════════════════════════════════════════╗");
  results.push("║  TEST 5: CONFIGURATION CHECK                                  ║");
  results.push("╚═══════════════════════════════════════════════════════════════╝");

  try {
    results.push("\n  5.1 Core configuration:");
    results.push("    ✓ SPREADSHEET_ID: " + (typeof CONFIG !== 'undefined' ? CONFIG.SPREADSHEET_ID : "(CONFIG not defined)"));

    results.push("\n  5.2 Sheet name constants (SHEETS):");
    if (typeof SHEETS !== 'undefined') {
      results.push("    ✓ WORK_PAPERS: " + SHEETS.WORK_PAPERS);
      results.push("    ✓ ACTION_PLANS: " + SHEETS.ACTION_PLANS);
      results.push("    ✓ USERS: " + SHEETS.USERS);
      results.push("    ✓ CONFIG: " + SHEETS.CONFIG);
    } else {
      errors.push("SHEETS constant not defined");
      results.push("    ✗ SHEETS constant not defined!");
    }

    results.push("\n  5.3 Status constants (STATUS):");
    if (typeof STATUS !== 'undefined') {
      results.push("    ✓ WORK_PAPER statuses: " + JSON.stringify(STATUS.WORK_PAPER));
      results.push("    ✓ ACTION_PLAN statuses: " + JSON.stringify(STATUS.ACTION_PLAN));
    } else {
      errors.push("STATUS constant not defined");
      results.push("    ✗ STATUS constant not defined!");
    }

    results.push("\n  5.4 Role constants (ROLES):");
    if (typeof ROLES !== 'undefined') {
      results.push("    ✓ Available roles: " + JSON.stringify(Object.keys(ROLES)));
    } else {
      errors.push("ROLES constant not defined");
      results.push("    ✗ ROLES constant not defined!");
    }

    results.push("\n  5.5 Config values from 00_Config sheet:");
    if (typeof getConfigValue === 'function') {
      var systemName = getConfigValue('SYSTEM_NAME');
      results.push("    ✓ SYSTEM_NAME: " + (systemName || "(not set)"));
    }

  } catch (e) {
    errors.push("Configuration check error: " + e.message);
    results.push("  ✗ Error: " + e.message);
  }

  results.push("\n" + (errors.length === 0 ? "✓ TEST 5 PASSED" : "✗ TEST 5 HAS ISSUES"));

  // ============================================================
  // SUMMARY
  // ============================================================
  results.push("\n═══════════════════════════════════════════════════════════════");
  results.push("   DIAGNOSTIC SUMMARY");
  results.push("═══════════════════════════════════════════════════════════════");

  if (errors.length === 0) {
    results.push("\n✅ ALL TESTS PASSED!");
    results.push("   The Dashboard backend appears to be functioning correctly.");
    results.push("   If you're still seeing 'Error loading dashboard', the issue");
    results.push("   may be in the frontend-to-backend communication.");
  } else {
    results.push("\n⚠️ ERRORS FOUND: " + errors.length);
    results.push("\n   Error Summary:");
    errors.forEach(function(err, idx) {
      results.push("   " + (idx + 1) + ". " + err);
    });
    results.push("\n   Please fix these errors and run the diagnostic again.");
  }

  results.push("\n═══════════════════════════════════════════════════════════════");

  // Output to console
  var output = results.join("\n");
  console.log(output);
  Logger.log(output);

  return output;
}

/**
 * Test frontend-backend connection (call this from apiCall)
 */
function testConnection() {
  return {
    success: true,
    timestamp: new Date().toISOString(),
    message: "Backend is reachable",
    user: Session.getActiveUser().getEmail() || "(empty - session auth may be required)"
  };
}

/**
 * Quick health check for Dashboard
 */
function quickHealthCheck() {
  var health = {
    timestamp: new Date().toISOString(),
    checks: {}
  };

  // Check spreadsheet access
  try {
    var ss = SpreadsheetApp.openById(typeof CONFIG !== 'undefined' ? CONFIG.SPREADSHEET_ID : '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4');
    health.checks.spreadsheet = { status: 'OK', name: ss.getName() };
  } catch (e) {
    health.checks.spreadsheet = { status: 'FAIL', error: e.message };
  }

  // Check work papers sheet
  try {
    var wpSheet = getSheet ? getSheet('09_WorkPapers') : ss.getSheetByName('09_WorkPapers');
    health.checks.workPapersSheet = { status: 'OK', rows: wpSheet.getLastRow() - 1 };
  } catch (e) {
    health.checks.workPapersSheet = { status: 'FAIL', error: e.message };
  }

  // Check action plans sheet
  try {
    var apSheet = getSheet ? getSheet('13_ActionPlans') : ss.getSheetByName('13_ActionPlans');
    health.checks.actionPlansSheet = { status: 'OK', rows: apSheet.getLastRow() - 1 };
  } catch (e) {
    health.checks.actionPlansSheet = { status: 'FAIL', error: e.message };
  }

  // Check current user
  try {
    var email = Session.getActiveUser().getEmail();
    if (email) {
      var user = typeof getUserByEmail === 'function' ? getUserByEmail(email) : null;
      health.checks.user = { status: 'OK', email: email, found: !!user };
    } else {
      health.checks.user = { status: 'WARN', message: 'No email - session auth may be required' };
    }
  } catch (e) {
    health.checks.user = { status: 'FAIL', error: e.message };
  }

  console.log(JSON.stringify(health, null, 2));
  return health;
}
