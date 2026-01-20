// DIAGNOSTIC_FullFlow.gs - Test the complete flow from login to dashboard

/**
 * Simulate the EXACT web app flow from browser login to dashboard load
 */
function simulateCompleteWebAppFlow() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  SIMULATE COMPLETE WEB APP FLOW               ║');
  console.log('╚════════════════════════════════════════════════╝');

  // STEP 1: Login
  console.log('\n=== STEP 1: LOGIN ===');
  console.log('Attempting login with test user...');

  const loginResult = login('admin@hasspetroleum.com', 'Admin@123');
  console.log('Login result:', JSON.stringify(loginResult, null, 2));

  if (!loginResult.success) {
    console.error('LOGIN FAILED!');
    console.error('Error:', loginResult.error);
    return { step: 'login', error: loginResult.error };
  }

  console.log('✓ Login successful');
  console.log('Session token:', loginResult.sessionToken.substring(0, 20) + '...');
  console.log('User:', loginResult.user.email, '(', loginResult.user.role_code, ')');

  const sessionToken = loginResult.sessionToken;

  // STEP 2: Validate Session (what happens on page load)
  console.log('\n=== STEP 2: VALIDATE SESSION ===');
  console.log('Validating session token...');

  const validationResult = validateSession(sessionToken);
  console.log('Validation result:', JSON.stringify(validationResult, null, 2));

  if (!validationResult.valid) {
    console.error('SESSION VALIDATION FAILED!');
    console.error('Error:', validationResult.error);
    return { step: 'validation', error: validationResult.error };
  }

  console.log('✓ Session validation successful');
  console.log('User from session:', validationResult.user.email);

  // STEP 3: Call getDashboardData (simulate web app request)
  console.log('\n=== STEP 3: GET DASHBOARD DATA ===');
  console.log('Simulating web app getDashboardData request...');

  try {
    // This simulates what doPost does in the web app
    const mockRequest = {
      parameter: {
        action: 'getDashboardData'
      },
      postData: {
        contents: JSON.stringify({
          action: 'getDashboardData'
        })
      }
    };

    console.log('Calling getDashboardData with authenticated user...');
    const dashboardData = getDashboardData(validationResult.user);

    console.log('\n--- Dashboard Data Result ---');
    console.log('Type:', typeof dashboardData);
    console.log('Has data:', !!dashboardData);

    if (dashboardData) {
      console.log('Keys:', Object.keys(dashboardData));
      console.log('\nSummary Stats:');
      if (dashboardData.summary) {
        console.log('  Total Work Papers:', dashboardData.summary.totalWorkPapers);
        console.log('  Total Action Plans:', dashboardData.summary.totalActionPlans);
        console.log('  Work Papers by Status:', JSON.stringify(dashboardData.summary.workPapersByStatus));
        console.log('  Action Plans by Status:', JSON.stringify(dashboardData.summary.actionPlansByStatus));
      } else {
        console.log('  Summary: MISSING');
      }

      console.log('\nRecent Items:');
      console.log('  Recent Work Papers:', dashboardData.recentWorkPapers ? dashboardData.recentWorkPapers.length : 'MISSING');
      console.log('  Recent Action Plans:', dashboardData.recentActionPlans ? dashboardData.recentActionPlans.length : 'MISSING');

      console.log('\nUser Info:');
      console.log('  Has user object:', !!dashboardData.user);
      if (dashboardData.user) {
        console.log('  User email:', dashboardData.user.email);
        console.log('  User role:', dashboardData.user.role_code);
      }
    }

    console.log('\n✓ Dashboard data retrieved successfully!');

    return {
      success: true,
      sessionToken: sessionToken,
      dashboardData: dashboardData
    };

  } catch (error) {
    console.error('\n✗ ERROR GETTING DASHBOARD DATA!');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return {
      step: 'getDashboardData',
      error: error.message,
      stack: error.stack
    };
  }
}

/**
 * Test the web app doPost handler directly
 */
function testDoPostHandler() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  TEST doPost HANDLER DIRECTLY                 ║');
  console.log('╚════════════════════════════════════════════════╝');

  // First, get a valid session token
  console.log('\n=== Getting valid session token ===');
  const loginResult = login('admin@hasspetroleum.com', 'Admin@123');

  if (!loginResult.success) {
    console.error('Login failed:', loginResult.error);
    return;
  }

  const sessionToken = loginResult.sessionToken;
  console.log('✓ Got session token:', sessionToken.substring(0, 20) + '...');

  // Now test doPost with getDashboardData request
  console.log('\n=== Testing doPost with getDashboardData ===');

  const mockRequest = {
    parameter: {},
    postData: {
      contents: JSON.stringify({
        action: 'getDashboardData',
        sessionToken: sessionToken
      }),
      type: 'application/json'
    }
  };

  console.log('Mock request:', JSON.stringify(mockRequest, null, 2));

  try {
    console.log('\nCalling doPost...');
    const response = doPost(mockRequest);

    console.log('\n--- doPost Response ---');
    console.log('Response type:', typeof response);
    console.log('Has getContent:', typeof response.getContent === 'function');

    if (response && typeof response.getContent === 'function') {
      const content = response.getContent();
      console.log('\nResponse content (first 500 chars):');
      console.log(content.substring(0, 500));

      try {
        const parsed = JSON.parse(content);
        console.log('\n✓ Response is valid JSON');
        console.log('Success:', parsed.success);
        if (!parsed.success) {
          console.error('Error in response:', parsed.error);
        } else {
          console.log('Data keys:', Object.keys(parsed.data || {}));
        }
      } catch (e) {
        console.error('✗ Response is not valid JSON:', e.message);
      }
    }

  } catch (error) {
    console.error('\n✗ ERROR IN doPost!');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
  }
}

/**
 * Check if all required functions exist and are callable
 */
function checkRequiredFunctions() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  CHECK REQUIRED FUNCTIONS                     ║');
  console.log('╚════════════════════════════════════════════════╝');

  const functions = [
    'login',
    'validateSession',
    'getDashboardData',
    'getSummaryStats',
    'getWorkPaperCounts',
    'getActionPlanCounts',
    'getWorkPapers',
    'getActionPlans',
    'doPost',
    'isActive',
    'getSheet'
  ];

  console.log('\nChecking functions:\n');

  const results = {};

  functions.forEach(funcName => {
    const exists = typeof eval(funcName) === 'function';
    results[funcName] = exists;
    console.log(funcName + ':', exists ? '✓ EXISTS' : '✗ MISSING');
  });

  const allExist = Object.values(results).every(v => v);

  console.log('\n' + (allExist ? '✓ All functions exist' : '✗ Some functions are missing'));

  return results;
}

/**
 * Run all diagnostic tests
 */
function runAllDiagnostics() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║           COMPLETE DIAGNOSTIC SUITE           ║');
  console.log('╚════════════════════════════════════════════════╝');

  console.log('\n\n');
  console.log('TEST 1: Check Required Functions');
  console.log('==================================');
  checkRequiredFunctions();

  console.log('\n\n');
  console.log('TEST 2: Simulate Complete Web App Flow');
  console.log('========================================');
  const flowResult = simulateCompleteWebAppFlow();

  console.log('\n\n');
  console.log('TEST 3: Test doPost Handler');
  console.log('============================');
  testDoPostHandler();

  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║         ALL DIAGNOSTICS COMPLETE              ║');
  console.log('╚════════════════════════════════════════════════╝');

  if (flowResult && flowResult.success) {
    console.log('\n✓✓✓ SUCCESS! Dashboard should work in the browser! ✓✓✓');
  } else {
    console.log('\n✗✗✗ FAILURE AT STEP:', flowResult ? flowResult.step : 'unknown');
    console.log('Error:', flowResult ? flowResult.error : 'unknown');
  }

  return flowResult;
}
