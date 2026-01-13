/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * User Schema Update Script
 * 
 * Run this once to add authentication columns to 05_Users sheet
 */

const UPDATE_SPREADSHEET_ID = '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4';

function updateUsersSchemaForAuth() {
  const ss = SpreadsheetApp.openById(UPDATE_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('05_Users');
  
  if (!sheet) {
    console.log('05_Users sheet not found!');
    return;
  }
  
  // Get current headers
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  console.log('Current headers:', headers);
  
  // New auth columns to add
  const newColumns = [
    'password_hash',
    'password_salt', 
    'must_change_password',
    'login_attempts',
    'locked_until',
    'reset_token',
    'reset_token_expires'
  ];
  
  // Find which columns need to be added
  const columnsToAdd = newColumns.filter(col => !headers.includes(col));
  
  if (columnsToAdd.length === 0) {
    console.log('All auth columns already exist');
    return;
  }
  
  console.log('Adding columns:', columnsToAdd);
  
  // Add new columns
  const startCol = headers.length + 1;
  sheet.getRange(1, startCol, 1, columnsToAdd.length).setValues([columnsToAdd]);
  
  // Set column widths
  columnsToAdd.forEach((col, idx) => {
    sheet.setColumnWidth(startCol + idx, 150);
  });
  
  // Set default values for existing users
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const numUsers = lastRow - 1;
    
    // Find column indices for new columns
    const newHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const mustChangeIdx = newHeaders.indexOf('must_change_password') + 1;
    const attemptsIdx = newHeaders.indexOf('login_attempts') + 1;
    
    // Set must_change_password = TRUE and login_attempts = 0 for all users
    if (mustChangeIdx > 0) {
      const mustChangeDefaults = Array(numUsers).fill(['TRUE']);
      sheet.getRange(2, mustChangeIdx, numUsers, 1).setValues(mustChangeDefaults);
    }
    
    if (attemptsIdx > 0) {
      const attemptsDefaults = Array(numUsers).fill([0]);
      sheet.getRange(2, attemptsIdx, numUsers, 1).setValues(attemptsDefaults);
    }
  }
  
  console.log('Schema update complete!');
  console.log('New columns added:', columnsToAdd);
  
  // Now set temporary passwords for existing users
  setTempPasswordsForExistingUsers();
}

function setTempPasswordsForExistingUsers() {
  const ss = SpreadsheetApp.openById(UPDATE_SPREADSHEET_ID);
  const sheet = ss.getSheetByName('05_Users');
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const emailIdx = headers.indexOf('email');
  const hashIdx = headers.indexOf('password_hash');
  const saltIdx = headers.indexOf('password_salt');
  const mustChangeIdx = headers.indexOf('must_change_password');
  
  if (hashIdx === -1 || saltIdx === -1) {
    console.log('Auth columns not found. Run updateUsersSchemaForAuth first.');
    return;
  }
  
  console.log('Setting temporary passwords for users without passwords...');
  
  let updatedCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const currentHash = data[i][hashIdx];
    
    // Only set password if not already set
    if (!currentHash) {
      const email = data[i][emailIdx];
      
      // Generate temp password: first 4 chars of email + random 4 digits
      const emailPrefix = email.split('@')[0].substring(0, 4).toLowerCase();
      const randomDigits = Math.floor(1000 + Math.random() * 9000);
      const tempPassword = emailPrefix + randomDigits;
      
      // Generate salt and hash
      const salt = generateSalt();
      const hash = hashPassword(tempPassword, salt);
      
      // Update sheet
      sheet.getRange(i + 1, hashIdx + 1).setValue(hash);
      sheet.getRange(i + 1, saltIdx + 1).setValue(salt);
      sheet.getRange(i + 1, mustChangeIdx + 1).setValue('TRUE');
      
      console.log(`User: ${email} | Temp Password: ${tempPassword}`);
      updatedCount++;
    }
  }
  
  console.log(`\nUpdated ${updatedCount} users with temporary passwords.`);
  console.log('IMPORTANT: Note down these passwords and share with users securely!');
}

function generateSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  for (let i = 0; i < 32; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

function hashPassword(password, salt) {
  const input = password + salt;
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return rawHash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// Also create the Sessions sheet for session management
function createSessionsSheet() {
  const ss = SpreadsheetApp.openById(UPDATE_SPREADSHEET_ID);
  
  // Check if sheet exists
  let sheet = ss.getSheetByName('20_Sessions');
  if (sheet) {
    console.log('20_Sessions sheet already exists');
    return;
  }
  
  // Create new sheet
  sheet = ss.insertSheet('20_Sessions');
  
  // Set headers
  const headers = [
    'session_id',
    'user_id', 
    'session_token',
    'created_at',
    'expires_at',
    'ip_address',
    'user_agent',
    'is_valid'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  
  // Set column widths
  const widths = [150, 120, 300, 150, 150, 120, 250, 80];
  widths.forEach((w, idx) => sheet.setColumnWidth(idx + 1, w));
  
  // Freeze header row
  sheet.setFrozenRows(1);
  
  console.log('20_Sessions sheet created successfully');
}

// Run all setup functions
function runAuthSetup() {
  console.log('=== Starting Auth Setup ===\n');
  
  console.log('Step 1: Updating 05_Users schema...');
  updateUsersSchemaForAuth();
  
  console.log('\nStep 2: Creating Sessions sheet...');
  createSessionsSheet();
  
  console.log('\n=== Auth Setup Complete ===');
  console.log('\nNext steps:');
  console.log('1. Copy the temporary passwords shown above');
  console.log('2. Share passwords with users securely');
  console.log('3. Users will be prompted to change password on first login');
}
