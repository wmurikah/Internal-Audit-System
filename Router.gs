/**
 * Router.gs
 * Main routing script for the web app: detects the user, verifies domain,
 * and serves the correct HTML page based on the user role.
 */
function doGet(e) {
  try {
    // Get the active user's email
    var email = Session.getActiveUser().getEmail();
    if (!email) {
      // If not logged in, prompt to log in
      return HtmlService.createHtmlOutputFromFile("Login")
        .setTitle('Audit Tracker - Login')
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
    }
    
    // Check that email domain is allowed
    var allowedDomain = 'hasspetroleum.com';
    /*if (email.split('@').pop().toLowerCase() !== allowedDomain) {
      return HtmlService.createHtmlOutput("Unauthorized: Your account is not from @" + allowedDomain + " domain.");
    }*/
    
    // Lookup the user's role from the User Access sheet
    var role = getUserRole(email);
    if (!role) {
      return HtmlService.createHtmlOutput("Access Denied: Your user role is not defined in the system.");
    }
    
    // Serve the HTML page based on role
    var template;
    switch (role.toLowerCase()) {
      case 'manager':
      case 'admin': // treat 'Admin' as a Manager role as well
        template = HtmlService.createTemplateFromFile('Manager'); // Manager.html
        break;
      case 'auditor':
        template = HtmlService.createTemplateFromFile('Auditor'); // Auditor.html
        break;
      case 'auditee':
        template = HtmlService.createTemplateFromFile('Auditee'); // Auditee.html
        break;
      default:
        return HtmlService.createHtmlOutput("Access Denied: Your role '" + role + "' is not recognized.");
    }
    
    // Evaluate and return the HTML, set a title and allow iframes (if needed)
    return template.evaluate()
      .setTitle('Audit Tracker')
      .setFaviconUrl('https://www.google.com/images/branding/product/1x/drive_2020q4_48dp.png')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    // Log any errors and return a message
    logError('doGet', err.toString());
    return HtmlService.createHtmlOutput("Error: " + err.toString());
  }
}

// Include function to get HTML content for includes
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
