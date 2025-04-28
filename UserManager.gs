/**
 * UserManager.gs
 * Contains all functions for user management in the Audit Tracker application
 */

/**
 * getUsers()
 * Retrieves all users from the 'User Access' sheet
 * Returns an array of user objects with properties: name, email, role, rowIndex
 */
function getUsers() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userAccessSheet = ss.getSheetByName('User Access');
    
    if (!userAccessSheet) {
      logError('getUsers', "Sheet 'User Access' not found");
      return { error: "User Access sheet not found" };
    }
    
    const data = userAccessSheet.getDataRange().getValues();
    if (data.length < 2) {
      return []; // No data or only header row
    }
    
    // Get column indices from header row
    const headers = data[0];
    const nameCol = headers.indexOf('Name');
    const emailCol = headers.indexOf('Email');
    const roleCol = headers.indexOf('Role');
    
    // Validate required columns exist
    if (nameCol < 0 || emailCol < 0 || roleCol < 0) {
      logError('getUsers', "Required columns missing in User Access sheet");
      return { error: "Required columns (Name, Email, Role) not found in User Access sheet" };
    }
    
    // Extract user data
    const users = [];
    for (let i = 1; i < data.length; i++) {
      // Skip empty rows
      if (!data[i][nameCol] && !data[i][emailCol]) continue;
      
      users.push({
        name: data[i][nameCol] || '',
        email: data[i][emailCol] || '',
        role: data[i][roleCol] || '',
        rowIndex: i + 1 // Save sheet row index for editing/deleting (1-based)
      });
    }
    
    return users;
  } catch (err) {
    logError('getUsers', err.toString());
    return { error: err.toString() };
  }
}

/**
 * addUser(userData)
 * Adds a new user to the 'User Access' sheet
 * userData should contain: name, email, role
 */
function addUser(userData) {
  try {
    if (!userData || !userData.name || !userData.email || !userData.role) {
      return { error: "Incomplete user data provided" };
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userAccessSheet = ss.getSheetByName('User Access');
    
    if (!userAccessSheet) {
      logError('addUser', "Sheet 'User Access' not found");
      return { error: "User Access sheet not found" };
    }
    
    // Get column indices from header row
    const headers = userAccessSheet.getRange(1, 1, 1, userAccessSheet.getLastColumn()).getValues()[0];
    const nameCol = headers.indexOf('Name') + 1; // Convert to 1-based
    const emailCol = headers.indexOf('Email') + 1;
    const roleCol = headers.indexOf('Role') + 1;
    
    // Validate required columns exist
    if (nameCol < 1 || emailCol < 1 || roleCol < 1) {
      logError('addUser', "Required columns missing in User Access sheet");
      return { error: "Required columns (Name, Email, Role) not found in User Access sheet" };
    }
    
    // Check if user already exists
    const data = userAccessSheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][emailCol-1] && data[i][emailCol-1].toLowerCase() === userData.email.toLowerCase()) {
        return { error: "User with this email already exists" };
      }
    }
    
    // Add new user
    const newRow = userAccessSheet.getLastRow() + 1;
    userAccessSheet.getRange(newRow, nameCol).setValue(userData.name);
    userAccessSheet.getRange(newRow, emailCol).setValue(userData.email);
    userAccessSheet.getRange(newRow, roleCol).setValue(userData.role);
    
    // Log the action
    logAudit('ADD_USER', null, `Added user: ${userData.name} (${userData.email}) as ${userData.role}`);
    
    return { success: true };
    
  } catch (err) {
    logError('addUser', err.toString());
    return { error: err.toString() };
  }
}

/**
 * updateUser(userData)
 * Updates an existing user in the 'User Access' sheet
 * userData should contain: rowIndex, name, email, role
 */
function updateUser(userData) {
  try {
    if (!userData || !userData.rowIndex || !userData.name || !userData.email || !userData.role) {
      return { error: "Incomplete user data provided" };
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userAccessSheet = ss.getSheetByName('User Access');
    
    if (!userAccessSheet) {
      logError('updateUser', "Sheet 'User Access' not found");
      return { error: "User Access sheet not found" };
    }
    
    // Get column indices from header row
    const headers = userAccessSheet.getRange(1, 1, 1, userAccessSheet.getLastColumn()).getValues()[0];
    const nameCol = headers.indexOf('Name') + 1; // Convert to 1-based
    const emailCol = headers.indexOf('Email') + 1;
    const roleCol = headers.indexOf('Role') + 1;
    
    // Validate required columns exist
    if (nameCol < 1 || emailCol < 1 || roleCol < 1) {
      logError('updateUser', "Required columns missing in User Access sheet");
      return { error: "Required columns (Name, Email, Role) not found in User Access sheet" };
    }
    
    // Check if rowIndex is valid
    const lastRow = userAccessSheet.getLastRow();
    if (userData.rowIndex < 2 || userData.rowIndex > lastRow) {
      return { error: "Invalid row index" };
    }
    
    // Check for email conflicts (only if email has changed)
    const currentEmail = userAccessSheet.getRange(userData.rowIndex, emailCol).getValue();
    if (currentEmail.toLowerCase() !== userData.email.toLowerCase()) {
      const data = userAccessSheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const rowNum = i + 1;
        if (rowNum !== userData.rowIndex && // Skip the current row
            data[i][emailCol-1] && data[i][emailCol-1].toLowerCase() === userData.email.toLowerCase()) {
          return { error: "Another user with this email already exists" };
        }
      }
    }
    
    // Update user data
    userAccessSheet.getRange(userData.rowIndex, nameCol).setValue(userData.name);
    userAccessSheet.getRange(userData.rowIndex, emailCol).setValue(userData.email);
    userAccessSheet.getRange(userData.rowIndex, roleCol).setValue(userData.role);
    
    // Log the action
    logAudit('UPDATE_USER', null, `Updated user: ${userData.name} (${userData.email}) as ${userData.role}`);
    
    return { success: true };
    
  } catch (err) {
    logError('updateUser', err.toString());
    return { error: err.toString() };
  }
}

/**
 * deleteUser(userData)
 * Deletes a user from the 'User Access' sheet
 * userData should contain: rowIndex
 */
function deleteUser(userData) {
  try {
    if (!userData || !userData.rowIndex) {
      return { error: "Row index not provided" };
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const userAccessSheet = ss.getSheetByName('User Access');
    
    if (!userAccessSheet) {
      logError('deleteUser', "Sheet 'User Access' not found");
      return { error: "User Access sheet not found" };
    }
    
    // Check if rowIndex is valid
    const lastRow = userAccessSheet.getLastRow();
    if (userData.rowIndex < 2 || userData.rowIndex > lastRow) {
      return { error: "Invalid row index" };
    }
    
    // Get user information for logging
    const headers = userAccessSheet.getRange(1, 1, 1, userAccessSheet.getLastColumn()).getValues()[0];
    const nameCol = headers.indexOf('Name') + 1;
    const emailCol = headers.indexOf('Email') + 1;
    
    let userName = "Unknown";
    let userEmail = "Unknown";
    
    if (nameCol > 0) {
      userName = userAccessSheet.getRange(userData.rowIndex, nameCol).getValue() || "Unknown";
    }
    
    if (emailCol > 0) {
      userEmail = userAccessSheet.getRange(userData.rowIndex, emailCol).getValue() || "Unknown";
    }
    
    // Delete the row
    userAccessSheet.deleteRow(userData.rowIndex);
    
    // Log the action
    logAudit('DELETE_USER', null, `Deleted user: ${userName} (${userEmail})`);
    
    return { success: true };
    
  } catch (err) {
    logError('deleteUser', err.toString());
    return { error: err.toString() };
  }
}
