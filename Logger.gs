/**
 * Logger.gs
 * Functions to log errors and audit actions to designated sheets.
 */

/**
 * logError(source, errorMessage)
 * Appends an error entry to the 'Error Logs' sheet.
 */
function logError(source, errorMessage) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const errorSheet = ss.getSheetByName('Error Logs');

    if (!errorSheet) return;

    var timestamp = new Date();
    errorSheet.appendRow([timestamp, source, errorMessage]);
  } catch (e) {
    // If logging fails, output to console
    console.error('Failed to log error in Logger.gs:', e);
  }
}

/**
 * logAudit(action, taskId, details)
 * Appends an audit log entry to the 'Audit Logs' sheet.
 * Columns assumed: [Log ID, Action, Timestamp, User Email, Task ID, Details]
 */
function logAudit(action, taskId, details) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const auditLogSheet = ss.getSheetByName('Audit Logs');

    if (!auditLogSheet) return;

    var data = auditLogSheet.getDataRange().getValues();
    var newId = data.length; // if only header, data.length==1 -> newId=1
    var userEmail = Session.getActiveUser().getEmail() || '';
    var timestamp = new Date();
    auditLogSheet.appendRow([newId, action, timestamp, userEmail, taskId, details || '']);
  } catch (e) {
    console.error('Failed to log audit action in Logger.gs:', e);
  }
}
