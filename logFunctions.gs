// logFunctions.gs

// Log every action in the Audit Logs sheet
function logAuditAction(action, taskId, user, details) {
  var sheet = getSheet("Audit Logs");
  sheet.appendRow([new Date(), action, taskId, user, details]);
}
