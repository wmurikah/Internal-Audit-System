// DIAGNOSTIC_WebApp.gs - Web App Specific Diagnostics
// Run these from the Apps Script editor to diagnose web app authentication issues

/**
 * Test the complete authentication and dashboard flow
 * This simulates what happens when the web app calls getDashboardData
 */
function testWebAppDashboardFlow() {
  console.log('==========================================');
  console.log('=== WEB APP DASHBOARD FLOW TEST START ===');
  console.log('==========================================');

  const results = {
    sessionTest: {},
    authTest: {},
    dashboardTest: {},
    errors: []
  };

  // Test 1: Check if there are any valid sessions
  console.log('\n=== TEST 1: Check Active Sessions ===');
  try {
    const sessionsSheet = getSheet(SHEETS.SESSIONS);
    if (!sessionsSheet) {
      console.error('Sessions sheet not found!');
      results.errors.push('Sessions sheet not found');
    } else {
      const data = sessionsSheet.getDataRange().getValues();
      const headers = data[0];
      const validIdx = headers.indexOf('is_valid');
      const expiresIdx = headers.indexOf('expires_at');
      const userIdIdx = headers.indexOf('user_id');
      const tokenIdx = headers.indexOf('session_token');

      let validSessions = [];
      const now = new Date();

      for (let i = 1; i < data.length; i++) {
        const isValid = data[i][validIdx];
        const expiresAt = new Date(data[i][expiresIdx]);
        const userId = data[i][userIdIdx];
        const token = data[i][tokenIdx];

        if (isValid && expiresAt > now) {
          validSessions.push({
            userId: userId,
            token: token.substring(0, 10) + '...',
            expiresAt: expiresAt
          });
        }
      }

      results.sessionTest.totalSessions = data.length - 1;
      results.sessionTest.validSessions = validSessions.length;
      console.log('Total sessions:', data.length - 1);
      console.log('Valid sessions:', validSessions.length);

      if (validSessions.length > 0) {
        console.log('Sample valid session user IDs:', validSessions.map(s => s.userId));

        // Test 2: Try to authenticate with a valid session token
        console.log('\n=== TEST 2: Test Session Authentication ===');
        const testSession = validSessions[0];
        const fullToken = data.find((row, idx) => idx > 0 && row[userIdIdx] === testSession.userId)[tokenIdx];

        console.log('Testing with session token for user:', testSession.userId);
        const sessionResult = validateSession(fullToken);
        results.authTest.sessionValid = sessionResult.valid;
        console.log('Session validation:', sessionResult.valid ? 'VALID' : 'INVALID');

        if (sessionResult.valid) {
          console.log('Session user:', sessionResult.user.email);

          // Test 3: Try to get full user object
          console.log('\n=== TEST 3: Get Full User Object ===');
          console.log('Attempting getUserById with:', sessionResult.user.user_id);
          let user = getUserById(sessionResult.user.user_id);
          results.authTest.getUserByIdSuccess = !!user;
          console.log('getUserById result:', user ? 'SUCCESS (' + user.email + ')' : 'FAILED');

          if (!user) {
            console.log('getUserById failed, trying getUserByEmail...');
            user = getUserByEmail(sessionResult.user.email);
            results.authTest.getUserByEmailSuccess = !!user;
            console.log('getUserByEmail result:', user ? 'SUCCESS (' + user.email + ')' : 'FAILED');
          }

          if (!user) {
            console.error('Both getUserById and getUserByEmail failed!');
            results.errors.push('Cannot retrieve user from database despite valid session');
            user = sessionResult.user; // Fallback
          }

          // Test 4: Try to call getDashboardData
          console.log('\n=== TEST 4: Call getDashboardData ===');
          console.log('User object has _rowIndex:', !!user._rowIndex);
          console.log('Calling getDashboardData...');

          try {
            const dashboardData = getDashboardData(user);
            results.dashboardTest.success = dashboardData && dashboardData.success !== false;
            results.dashboardTest.hasData = !!dashboardData;
            results.dashboardTest.hasSummary = !!(dashboardData && dashboardData.summary);
            results.dashboardTest.hasCharts = !!(dashboardData && dashboardData.charts);

            console.log('getDashboardData result:', dashboardData ? 'SUCCESS' : 'FAILED (null)');
            if (dashboardData) {
              console.log('Dashboard success flag:', dashboardData.success);
              console.log('Has summary:', !!dashboardData.summary);
              console.log('Has charts:', !!dashboardData.charts);
              console.log('Has alerts:', !!dashboardData.alerts);

              if (dashboardData.errors && dashboardData.errors.length > 0) {
                console.warn('Dashboard non-fatal errors:', dashboardData.errors);
                results.dashboardTest.dashboardErrors = dashboardData.errors;
              }

              if (dashboardData.success === false) {
                console.error('Dashboard returned error:', dashboardData.error);
                results.errors.push('Dashboard error: ' + dashboardData.error);
              }
            }
          } catch (e) {
            console.error('getDashboardData threw exception:', e.message);
            console.error('Stack:', e.stack);
            results.errors.push('getDashboardData exception: ' + e.message);
            results.dashboardTest.exception = e.message;
          }

        } else {
          console.error('Session validation failed:', sessionResult.error);
          results.errors.push('Session validation failed: ' + sessionResult.error);
        }
      } else {
        console.warn('No valid sessions found - users need to log in');
        results.errors.push('No valid sessions found');
      }
    }
  } catch (e) {
    console.error('Test error:', e.message);
    console.error('Stack:', e.stack);
    results.errors.push('Test exception: ' + e.message);
  }

  // Summary
  console.log('\n==========================================');
  console.log('=== TEST RESULTS SUMMARY ===');
  console.log('==========================================');
  console.log(JSON.stringify(results, null, 2));

  if (results.errors.length > 0) {
    console.log('\n=== ERRORS FOUND ===');
    results.errors.forEach((err, i) => console.log((i + 1) + '. ' + err));
  } else {
    console.log('\n✓ All tests passed!');
  }

  // Recommendations
  console.log('\n=== RECOMMENDATIONS ===');

  if (results.sessionTest.validSessions === 0) {
    console.log('- No valid sessions found. User needs to log in via the web app.');
    console.log('- To test: Open the web app, log in, then run this diagnostic again.');
  }

  if (results.authTest.getUserByIdSuccess === false && results.authTest.getUserByEmailSuccess === false) {
    console.log('- User lookup failing! Possible index corruption.');
    console.log('- Run: rebuildAllIndexesQuickFix()');
  }

  if (results.dashboardTest.success === false) {
    console.log('- Dashboard function failing. Check errors in dashboard.errors array');
    console.log('- Review getDashboardData logs above for specific failures');
  }

  console.log('\n=== TEST COMPLETE ===');

  return results;
}

/**
 * Create a test session for a specific user
 * Use this to manually create a session for testing
 */
function createTestSessionForUser(userEmail) {
  console.log('Creating test session for:', userEmail);

  const user = getUserByEmail(userEmail);
  if (!user) {
    console.error('User not found:', userEmail);
    return { success: false, error: 'User not found' };
  }

  console.log('User found:', user.full_name);

  try {
    const session = createSession(user);
    console.log('Session created successfully');
    console.log('Session token:', session.session_token);
    console.log('Expires at:', session.expires_at);

    return {
      success: true,
      session: session,
      message: 'Session created. Use this token in sessionStorage: ' + session.session_token
    };
  } catch (e) {
    console.error('Failed to create session:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * List all active sessions with user details
 */
function listActiveSessions() {
  console.log('=== Active Sessions ===');

  try {
    const sessionsSheet = getSheet(SHEETS.SESSIONS);
    if (!sessionsSheet) {
      console.error('Sessions sheet not found');
      return [];
    }

    const data = sessionsSheet.getDataRange().getValues();
    const headers = data[0];
    const now = new Date();

    const sessions = [];

    for (let i = 1; i < data.length; i++) {
      const session = rowToObject(headers, data[i]);
      const expiresAt = new Date(session.expires_at);
      const createdAt = new Date(session.created_at);
      const isExpired = expiresAt < now;
      const isValid = session.is_valid && !isExpired;

      if (isValid) {
        const user = getUserById(session.user_id);
        sessions.push({
          userId: session.user_id,
          userEmail: user ? user.email : 'unknown',
          userName: user ? user.full_name : 'unknown',
          createdAt: createdAt,
          expiresAt: expiresAt,
          sessionToken: session.session_token.substring(0, 10) + '...',
          status: 'ACTIVE'
        });
      }
    }

    console.log('Total active sessions:', sessions.length);
    sessions.forEach((s, i) => {
      console.log((i + 1) + '.', s.userEmail, '(' + s.userName + ') - expires:', s.expiresAt);
    });

    return sessions;
  } catch (e) {
    console.error('Error listing sessions:', e.message);
    return [];
  }
}
