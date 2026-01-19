// DIAGNOSTIC_SheetCheck.gs - Script to diagnose sheet name issues
// Run this from the Apps Script editor to check sheet configuration

function diagnosticCheckSheets() {
  console.log('=== DIAGNOSTIC: Sheet Name Check ===');

  try {
    // 1. Get the spreadsheet
    const spreadsheetId = CONFIG.SPREADSHEET_ID || '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4';
    console.log('Spreadsheet ID:', spreadsheetId);

    const db = SpreadsheetApp.openById(spreadsheetId);
    console.log('Spreadsheet Name:', db.getName());

    // 2. List all actual sheet names in the spreadsheet
    const allSheets = db.getSheets();
    console.log('\n--- Actual Sheets in Spreadsheet ---');
    allSheets.forEach((sheet, idx) => {
      const name = sheet.getName();
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      console.log(`${idx + 1}. "${name}" (${lastRow} rows, ${lastCol} cols)`);
    });

    // 3. Check if expected sheets exist
    console.log('\n--- Expected Sheet Configuration ---');
    const expectedSheets = {
      'WORK_PAPERS': SHEETS.WORK_PAPERS,
      'ACTION_PLANS': SHEETS.ACTION_PLANS,
      'USERS': SHEETS.USERS,
      'INDEX_WORK_PAPERS': SHEETS.INDEX_WORK_PAPERS,
      'CONFIG': SHEETS.CONFIG
    };

    Object.entries(expectedSheets).forEach(([key, expectedName]) => {
      const sheet = db.getSheetByName(expectedName);
      if (sheet) {
        const rowCount = sheet.getLastRow();
        const colCount = sheet.getLastColumn();
        console.log(`✓ ${key}: "${expectedName}" - EXISTS (${rowCount} rows, ${colCount} cols)`);
      } else {
        console.log(`✗ ${key}: "${expectedName}" - NOT FOUND!`);
      }
    });

    // 4. Specifically test WORK_PAPERS sheet
    console.log('\n--- Testing WORK_PAPERS Sheet ---');
    console.log('Expected name:', SHEETS.WORK_PAPERS);
    const wpSheet = getSheet(SHEETS.WORK_PAPERS);

    if (!wpSheet) {
      console.error('ERROR: Work Papers sheet not found!');
      console.log('Possible matches (case-insensitive):');
      allSheets.forEach(sheet => {
        const name = sheet.getName();
        if (name.toLowerCase().includes('work') || name.toLowerCase().includes('paper')) {
          console.log(`  - "${name}"`);
        }
      });
    } else {
      console.log('✓ Work Papers sheet found');
      const data = wpSheet.getDataRange().getValues();
      console.log('  Headers:', data[0]);
      console.log('  Data rows:', data.length - 1);
      console.log('  First row sample:', data[1] ? data[1].slice(0, 3) : 'No data');
    }

    // 5. Test getWorkPapers function
    console.log('\n--- Testing getWorkPapers() Function ---');
    try {
      const workPapers = getWorkPapers({}, null);
      console.log('✓ getWorkPapers succeeded');
      console.log('  Returned:', workPapers.length, 'work papers');
    } catch (e) {
      console.error('✗ getWorkPapers failed:', e.message);
      console.error('  Stack:', e.stack);
    }

    // 6. Test getDashboardData
    console.log('\n--- Testing getDashboardData() Function ---');
    try {
      const email = Session.getActiveUser().getEmail();
      const user = getUserByEmail(email);
      console.log('Current user:', user ? user.email : 'null');

      if (user) {
        const dashboard = getDashboardData(user);
        console.log('✓ getDashboardData succeeded');
        console.log('  Success flag:', dashboard.success);
        console.log('  Summary:', JSON.stringify(dashboard.summary).substring(0, 100));
      } else {
        console.log('✗ User not found - cannot test getDashboardData');
      }
    } catch (e) {
      console.error('✗ getDashboardData failed:', e.message);
      console.error('  Stack:', e.stack);
    }

    console.log('\n=== DIAGNOSTIC COMPLETE ===');
    return 'Diagnostic complete - check logs above';

  } catch (e) {
    console.error('FATAL ERROR in diagnostic:', e.message);
    console.error('Stack:', e.stack);
    return 'Diagnostic failed: ' + e.message;
  }
}

function diagnosticTestWorkPapersDirectly() {
  console.log('=== DIRECT TEST: Reading Work Papers Sheet ===');

  try {
    // Test 1: Try to get the sheet directly
    console.log('Test 1: Get sheet by exact name');
    const db = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const sheet = db.getSheetByName('09_WorkPapers');

    if (!sheet) {
      console.error('✗ Sheet "09_WorkPapers" not found');
      console.log('Available sheets:');
      db.getSheets().forEach(s => console.log('  - "' + s.getName() + '"'));
      return 'Sheet not found';
    }

    console.log('✓ Sheet found:', sheet.getName());

    // Test 2: Get data range
    console.log('\nTest 2: Get data range');
    const range = sheet.getDataRange();
    console.log('✓ Data range:', range.getA1Notation());

    // Test 3: Get values
    console.log('\nTest 3: Get values');
    const data = range.getValues();
    console.log('✓ Retrieved', data.length, 'rows');
    console.log('  Headers:', data[0]);
    console.log('  Sample row 1:', data[1]);

    // Test 4: Check for work_paper_id column
    console.log('\nTest 4: Check column structure');
    const headers = data[0];
    const wpIdIdx = headers.indexOf('work_paper_id');
    console.log('  work_paper_id column index:', wpIdIdx);

    if (wpIdIdx === -1) {
      console.error('✗ work_paper_id column not found!');
      console.log('  Available columns:', headers);
      return 'Column structure incorrect';
    }

    // Test 5: Count valid work papers
    console.log('\nTest 5: Count valid work papers');
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i][wpIdIdx]) {
        count++;
      }
    }
    console.log('✓ Found', count, 'work papers with IDs');

    return 'All tests passed - sheet accessible with ' + count + ' work papers';

  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('Stack:', e.stack);
    return 'Test failed: ' + e.message;
  }
}
