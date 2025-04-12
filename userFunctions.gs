// userFunctions.gs

// Check the role of the user
function getUserRole(userEmail) {
  var sheet = getSheet("User Access");
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] == userEmail) {
      return data[i][3];  // Return the user role (Admin, Auditee)
    }
  }
  return 'No Role Found';
}

// Check if the user is an admin
function isAdmin(userEmail) {
  return getUserRole(userEmail) === 'Admin';
}

// Check if the user is an auditee
function isAuditee(userEmail) {
  return getUserRole(userEmail) === 'Auditee';
}
