/**
 * Auth.gs
 * Authentication and user utility functions.
 */

/**
 * getUserRole(email)
 * Returns the role of a user given their email, or null if not found.
 */
function getUserRole(email) {
  if (!email) return null;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userAccessSheet = ss.getSheetByName('User Access');
  if (!userAccessSheet) {
    logError('getUserRole', "Sheet 'User Access' not found");
    return null;
  }

  var data = userAccessSheet.getDataRange().getValues();
  if (data.length < 2) return null; // no data or only header
  var headers = data[0];
  var emailCol = headers.indexOf('Email');
  var roleCol = headers.indexOf('Role');
  if (emailCol < 0 || roleCol < 0) {
    logError('getUserRole', "'User Access' sheet is missing 'Email' or 'Role' column");
    return null;
  }

  // Search for the email in the sheet
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailCol]).toLowerCase() === email.toLowerCase()) {
      return data[i][roleCol];
    }
  }
  return null; // not found
}

/**
 * getUserEmailByName(name)
 * Returns the user email for a given Name (full name), or null if not found.
 */
function getUserEmailByName(name) {
  if (!name) return null;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const userAccessSheet = ss.getSheetByName('User Access');
  if (!userAccessSheet) {
    logError('getUserEmailByName', "Sheet 'User Access' not found");
    return null;
  }

  var data = userAccessSheet.getDataRange().getValues();
  if (data.length < 2) return null;
  var headers = data[0];
  var nameCol = headers.indexOf('Name');
  var emailCol = headers.indexOf('Email');
  if (nameCol < 0 || emailCol < 0) {
    logError('getUserEmailByName', "'User Access' sheet is missing 'Name' or 'Email' column");
    return null;
  }

  // Search for the name in the sheet
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][nameCol]).toLowerCase() === name.toLowerCase()) {
      return data[i][emailCol];
    }
  }
  return null;
}
