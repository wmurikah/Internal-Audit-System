// accessControl.gs

// Access control function to validate user permissions
function checkUserAccess(userEmail, taskId) {
  var role = getUserRole(userEmail);
  
  // Admins can access all tasks
  if (role === 'Admin') {
    return true;
  }
  
  // Auditees can only access tasks assigned to them
  if (role === 'Auditee') {
    var sheet = getSheet("Audit Tasks");
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == taskId && data[i][3] == userEmail) {
        return true;
      }
    }
  }
  
  return false; // Deny access if the user doesn't have permission
}
