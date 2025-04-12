// Serve login page or dashboard based on user authentication
function doGet(e) {
  var email = Session.getActiveUser().getEmail();  // Check if user is logged in

  if (!email) {
    // If the user is not logged in, show the login page
    return HtmlService.createHtmlOutputFromFile('login');  // Serve login.html
  } else {
    // If the user is logged in, show the dashboard
    return HtmlService.createHtmlOutputFromFile('dashboard');  // Serve dashboard.html
  }
}
// Fetch tasks assigned to a specific auditee
function getTasksForAuditee(email) {
  var sheet = getSheet("Audit Tasks");
  var data = sheet.getDataRange().getValues();
  var tasks = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][3] == email) { // Check if the task is assigned to the logged-in user
      tasks.push(data[i]); // Add task to the array
    }
  }
  return tasks; // Return the tasks array
}

// Update task status and log the action
function updateAuditTask(taskId, status, completionNotes) {
  var sheet = getSheet("Audit Tasks");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] == taskId) {
      sheet.getRange(i + 1, 6).setValue(status);  // Update the Status
      sheet.getRange(i + 1, 9).setValue(completionNotes);  // Update Completion Notes
      sheet.getRange(i + 1, 8).setValue(new Date());  // Set the Date Completed
      logAction('Task Updated', taskId, 'Auditee', 'Task marked as completed');
      return 'Task Updated Successfully';
    }
  }
  return 'Task Not Found';
}

// Helper function to log actions (e.g., task updates, uploads)
function logAction(action, taskId, user, details) {
  var sheet = getSheet("Audit Logs");
  sheet.appendRow([new Date(), action, taskId, user, details]);
}

// Helper function to get the Google Sheet by name
function getSheet(sheetName) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}
