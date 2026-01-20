// DIAGNOSTIC_SessionData.gs - Inspect raw session data to debug validation issues

/**
 * Inspect the raw is_valid values in the Sessions sheet
 * This helps diagnose why session validation might be failing
 */
function inspectSessionDataTypes() {
  console.log('==========================================');
  console.log('=== SESSION DATA TYPE INSPECTION ===');
  console.log('==========================================');

  try {
    const sessionsSheet = getSheet(SHEETS.SESSIONS);
    if (!sessionsSheet) {
      console.error('Sessions sheet not found!');
      return { success: false, error: 'Sessions sheet not found' };
    }

    const data = sessionsSheet.getDataRange().getValues();
    const headers = data[0];
    const validIdx = headers.indexOf('is_valid');
    const expiresIdx = headers.indexOf('expires_at');
    const userIdIdx = headers.indexOf('user_id');
    const tokenIdx = headers.indexOf('session_token');

    console.log('\n=== Column Indexes ===');
    console.log('is_valid index:', validIdx);
    console.log('expires_at index:', expiresIdx);
    console.log('user_id index:', userIdIdx);
    console.log('session_token index:', tokenIdx);

    console.log('\n=== Analyzing Each Session ===');
    console.log('Total sessions:', data.length - 1);

    const now = new Date();
    const results = [];

    for (let i = 1; i < data.length; i++) {
      const rawIsValid = data[i][validIdx];
      const expiresAt = new Date(data[i][expiresIdx]);
      const userId = data[i][userIdIdx];
      const token = data[i][tokenIdx];

      // Test what JavaScript sees
      const jsType = typeof rawIsValid;
      const jsValue = rawIsValid;
      const jsStringValue = String(rawIsValid);
      const isTruthy = !!rawIsValid;
      const isExpired = expiresAt < now;

      // Test isActive function
      const isActiveResult = isActive(rawIsValid);
      const notIsActiveResult = !isActive(rawIsValid);

      const analysis = {
        rowNumber: i + 1,
        userId: userId,
        tokenPrefix: token ? token.substring(0, 10) + '...' : 'null',
        expiresAt: expiresAt,
        isExpired: isExpired,
        rawValue: jsValue,
        type: jsType,
        stringValue: jsStringValue,
        isTruthy: isTruthy,
        isActiveResult: isActiveResult,
        notIsActiveResult: notIsActiveResult,
        wouldPass: isActiveResult && !isExpired,
        wouldFail: !isActiveResult || isExpired
      };

      results.push(analysis);

      console.log('\n--- Session Row ' + (i + 1) + ' ---');
      console.log('User ID:', userId);
      console.log('Token:', token ? token.substring(0, 10) + '...' : 'null');
      console.log('Raw is_valid value:', jsValue);
      console.log('  Type:', jsType);
      console.log('  String value:', jsStringValue);
      console.log('  Is truthy (!!value):', isTruthy);
      console.log('  isActive(value):', isActiveResult);
      console.log('  !isActive(value):', notIsActiveResult);
      console.log('Expires at:', expiresAt);
      console.log('Is expired:', isExpired);
      console.log('VALIDATION RESULT:', analysis.wouldPass ? 'WOULD PASS' : 'WOULD FAIL');
      console.log('  Reason:', analysis.wouldFail ? (notIsActiveResult ? 'is_valid check failed' : 'expired') : 'valid');
    }

    console.log('\n==========================================');
    console.log('=== SUMMARY ===');
    console.log('==========================================');

    const wouldPass = results.filter(r => r.wouldPass).length;
    const wouldFail = results.filter(r => r.wouldFail).length;
    const failedIsValid = results.filter(r => r.notIsActiveResult).length;
    const failedExpired = results.filter(r => !r.notIsActiveResult && r.isExpired).length;

    console.log('Total sessions:', results.length);
    console.log('Would pass validation:', wouldPass);
    console.log('Would fail validation:', wouldFail);
    console.log('  Failed due to is_valid:', failedIsValid);
    console.log('  Failed due to expiration:', failedExpired);

    // Show unique is_valid values
    const uniqueValues = {};
    results.forEach(r => {
      const key = r.type + ':' + r.stringValue;
      if (!uniqueValues[key]) {
        uniqueValues[key] = {
          type: r.type,
          value: r.rawValue,
          stringValue: r.stringValue,
          isActiveResult: r.isActiveResult,
          count: 0
        };
      }
      uniqueValues[key].count++;
    });

    console.log('\n=== Unique is_valid Values Found ===');
    Object.keys(uniqueValues).forEach(key => {
      const info = uniqueValues[key];
      console.log('Type:', info.type, '| Value:', info.value, '| String:', info.stringValue,
                  '| isActive():', info.isActiveResult, '| Count:', info.count);
    });

    console.log('\n=== DIAGNOSTIC COMPLETE ===');

    return {
      success: true,
      totalSessions: results.length,
      wouldPass: wouldPass,
      wouldFail: wouldFail,
      uniqueValues: uniqueValues,
      details: results
    };

  } catch (e) {
    console.error('Error during inspection:', e.message);
    console.error('Stack:', e.stack);
    return { success: false, error: e.message };
  }
}

/**
 * Test the isActive function with various inputs
 */
function testIsActiveFunction() {
  console.log('==========================================');
  console.log('=== TESTING isActive() FUNCTION ===');
  console.log('==========================================');

  const testCases = [
    { input: true, description: 'boolean true' },
    { input: false, description: 'boolean false' },
    { input: 1, description: 'number 1' },
    { input: 0, description: 'number 0' },
    { input: 'TRUE', description: 'string "TRUE"' },
    { input: 'FALSE', description: 'string "FALSE"' },
    { input: 'true', description: 'string "true"' },
    { input: 'false', description: 'string "false"' },
    { input: 'yes', description: 'string "yes"' },
    { input: 'no', description: 'string "no"' },
    { input: '1', description: 'string "1"' },
    { input: '0', description: 'string "0"' },
    { input: 'active', description: 'string "active"' },
    { input: 'inactive', description: 'string "inactive"' },
    { input: '', description: 'empty string' },
    { input: null, description: 'null' },
    { input: undefined, description: 'undefined' }
  ];

  console.log('\nTesting isActive() with various inputs:\n');

  testCases.forEach(test => {
    try {
      const result = isActive(test.input);
      const notResult = !isActive(test.input);
      console.log('Input:', test.description);
      console.log('  Value:', test.input);
      console.log('  Type:', typeof test.input);
      console.log('  isActive(value):', result);
      console.log('  !isActive(value):', notResult);
      console.log('  Would pass validation:', result ? 'YES' : 'NO');
      console.log('');
    } catch (e) {
      console.error('Error testing', test.description, ':', e.message);
    }
  });

  console.log('=== TEST COMPLETE ===');
}

/**
 * Check if the code changes are actually deployed
 */
function verifyCodeDeployment() {
  console.log('==========================================');
  console.log('=== CODE DEPLOYMENT VERIFICATION ===');
  console.log('==========================================');

  console.log('\nChecking validateSession function...');

  try {
    // Get the function source code
    const funcSource = validateSession.toString();

    console.log('\nSearching for key patterns in validateSession():');

    // Check if the fix is present
    const hasFix = funcSource.includes('isActive(session.is_valid)');
    const hasOldBug = funcSource.includes('!session.is_valid') && !funcSource.includes('isActive');

    console.log('Contains "isActive(session.is_valid)":', hasFix ? 'YES ✓' : 'NO ✗');
    console.log('Contains old buggy pattern "!session.is_valid" (without isActive):', hasOldBug ? 'YES ✗' : 'NO ✓');

    if (hasFix) {
      console.log('\n✓ FIX IS DEPLOYED - The code is using isActive() correctly');
    } else if (hasOldBug) {
      console.log('\n✗ OLD BUGGY CODE IS STILL RUNNING - The fix is NOT deployed');
      console.log('  ACTION REQUIRED: Save the 07_AuthService.gs file and refresh the script editor');
    } else {
      console.log('\n? UNCERTAIN - Cannot determine deployment status from function source');
    }

    // Check isActive function exists
    console.log('\nChecking if isActive() function is available...');
    try {
      const testResult = isActive(true);
      console.log('isActive() function: AVAILABLE ✓');
      console.log('  Test: isActive(true) =', testResult);
    } catch (e) {
      console.error('isActive() function: NOT AVAILABLE ✗');
      console.error('  Error:', e.message);
    }

    console.log('\n=== VERIFICATION COMPLETE ===');

    return {
      hasFix: hasFix,
      hasOldBug: hasOldBug,
      isActiveAvailable: typeof isActive === 'function'
    };

  } catch (e) {
    console.error('Error during verification:', e.message);
    return { error: e.message };
  }
}

/**
 * Complete diagnostic - runs all checks
 */
function runCompleteSessionDiagnostic() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  COMPLETE SESSION DIAGNOSTIC SUITE    ║');
  console.log('╔════════════════════════════════════════╗');

  console.log('\n\n');
  console.log('STEP 1: Verify Code Deployment');
  console.log('================================');
  const deploymentCheck = verifyCodeDeployment();

  console.log('\n\n');
  console.log('STEP 2: Test isActive() Function');
  console.log('==================================');
  testIsActiveFunction();

  console.log('\n\n');
  console.log('STEP 3: Inspect Session Data Types');
  console.log('====================================');
  const dataInspection = inspectSessionDataTypes();

  console.log('\n\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║         DIAGNOSTIC COMPLETE           ║');
  console.log('╚════════════════════════════════════════╝');

  return {
    deploymentCheck: deploymentCheck,
    dataInspection: dataInspection
  };
}
