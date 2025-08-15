/**
 * ===============================================================================
 * PHASE 4: COMPREHENSIVE TESTING SUITE
 * This is a separate file: SystemTesting.gs
 * ===============================================================================
 */

function testEntireSystem() {
  console.log('🧪 TESTING REVOLUTIONARY SYSTEM');
  console.log('===============================');
  
  const startTime = Date.now();
  const results = {};
  
  // Test 1: Sheet architecture
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    results.sheets = {
      count: sheets.length,
      names: sheets.map(s => s.getName()),
      status: sheets.length >= 8 ? '✅ EXCELLENT' : '❌ INCOMPLETE'
    };
    console.log(`${results.sheets.status} Sheets: ${results.sheets.names.join(', ')}`);
  } catch (error) {
    results.sheets = { status: '❌ FAILED', error: error.message };
  }
  
  // Test 2: Data loading performance
  const dataTests = ['Users', 'Audits', 'Issues', 'Actions'];
  results.performance = {};
  
  dataTests.forEach(sheetName => {
    try {
      const testStart = Date.now();
      const data = getSheetDataDirect(sheetName);
      const testTime = Date.now() - testStart;
      
      results.performance[sheetName] = {
        time: testTime,
        records: data.length,
        status: testTime < 500 ? '🚀 LIGHTNING' : testTime < 1000 ? '✅ FAST' : '⚠️ SLOW'
      };
      console.log(`${results.performance[sheetName].status} ${sheetName}: ${testTime}ms, ${data.length} records`);
    } catch (error) {
      results.performance[sheetName] = { status: '❌ FAILED', error: error.message };
    }
  });
  
  // Test 3: Dashboard snapshot
  try {
    const snapStart = Date.now();
    const snapshot = buildDashboardSnapshot();
    const snapTime = Date.now() - snapStart;
    
    results.dashboard = {
      time: snapTime,
      success: snapshot.success,
      status: snapshot.success && snapTime < 2000 ? '🚀 BLAZING' : '⚠️ NEEDS_WORK'
    };
    console.log(`${results.dashboard.status} Dashboard snapshot: ${snapTime}ms`);
  } catch (error) {
    results.dashboard = { status: '❌ FAILED', error: error.message };
  }
  
  const totalTime = Date.now() - startTime;
  results.totalTime = totalTime;
  
  console.log('===============================');
  console.log(`🏁 TOTAL TEST TIME: ${totalTime}ms`);
  
  // Performance verdict
  const performanceGood = Object.values(results.performance)
    .every(test => !test.error && test.time < 1000);
  const dashboardGood = results.dashboard.success && results.dashboard.time < 3000;
  
  if (performanceGood && dashboardGood) {
    console.log('🚀 VERDICT: INVESTOR-READY PERFORMANCE!');
    console.log('💎 System ready for billion-dollar presentation!');
  } else {
    console.log('⚠️ VERDICT: Performance optimization needed');
  }
  
  return results;
}

function testIssuesPerformance() {
  console.log('📋 TESTING ISSUES PERFORMANCE');
  console.log('=============================');
  
  try {
    // Test complete Issues flow
    const start1 = Date.now();
    const rawIssues = getSheetDataDirect('Issues');
    const time1 = Date.now() - start1;
    console.log(`✅ Raw Issues access: ${time1}ms - ${rawIssues.length} records`);
    
    const start2 = Date.now();
    const user = getCurrentUserUltra();
    const time2 = Date.now() - start2;
    console.log(`✅ User context: ${time2}ms - ${user.email} (${user.role})`);
    
    const start3 = Date.now();
    const issuesData = getIssuesData();
    const time3 = Date.now() - start3;
    console.log(`✅ getIssuesData: ${time3}ms - ${issuesData.length} records`);
    
    const totalTime = time1 + time2 + time3;
    console.log(`🏁 TOTAL ISSUES TEST: ${totalTime}ms`);
    
    if (totalTime < 2000) {
      console.log('🚀 ISSUES PERFORMANCE: EXCELLENT!');
    } else {
      console.log('⚠️ ISSUES PERFORMANCE: NEEDS IMPROVEMENT');
    }
    
    return {
      success: true,
      totalTime: totalTime,
      recordCount: issuesData.length
    };
    
  } catch (error) {
    console.log(`❌ Issues test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function listAllSheets() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheets = ss.getSheets();
    
    console.log('📋 CURRENT SHEETS:');
    console.log('==================');
    sheets.forEach((sheet, index) => {
      try {
        const name = sheet.getName();
        const rows = sheet.getMaxRows();
        const cols = sheet.getMaxColumns();
        console.log(`${index + 1}. ${name} (${rows}x${cols})`);
      } catch (e) {
        console.log(`${index + 1}. [ERROR READING SHEET]: ${e.message}`);
      }
    });
    
    return { success: true, count: sheets.length };
  } catch (error) {
    console.log(`❌ Error listing sheets: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function verifyAnalyticsData() {
  const data = getDashboardDataWithAnalytics();
  console.log('Analytics data:', data.executiveAnalytics);
  console.log('Business units:', data.executiveAnalytics?.businessUnits);
  return data;
}
