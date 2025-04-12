// main.gs

// Serve the appropriate page based on authentication status
function doGet(e) {
  var template;
  var user = Session.getActiveUser().getEmail();
  
  if (!user || user === "") {
    template = HtmlService.createTemplateFromFile('login');
  } else {
    // Check if user exists in our system
    var role = getUserRole(user);
    if (role === 'No Role Found') {
      template = HtmlService.createTemplateFromFile('unauthorized');
    } else {
      template = HtmlService.createTemplateFromFile('dashboard');
      template.userEmail = user;
      template.userRole = role;
    }
  }
  
  return template.evaluate()
    .setTitle('Audit Tracker')
    .setFaviconUrl('https://www.example.com/favicon.ico');
}

// Authentication handler
function authenticateUser(email) {
  try {
    var role = getUserRole(email);
    
    if (role !== 'No Role Found') {
      // Update last login timestamp
      updateLastLogin(email);
      
      // Log the action
      logAction('User Login', null, email, 'User logged in successfully');
      
      return {
        success: true,
        email: email,
        role: role,
        redirectTo: 'dashboard'
      };
    } else {
      return {
        success: false,
        message: 'User not found in the system'
      };
    }
  } catch (e) {
    return handleError(e.message, "authenticateUser");
  }
}

// Update the last login time for a user
function updateLastLogin(email) {
  var sheet = getSheet("User Access");
  var data = sheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === email) {
      sheet.getRange(i + 1, 5).setValue(new Date()); // Update Last Login column
      break;
    }
  }
}
