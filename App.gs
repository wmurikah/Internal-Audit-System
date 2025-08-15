/**
 * AUDIT MANAGEMENT SYSTEM - MAIN ENTRY POINT
 * Enterprise-grade audit management with role-based access control
 */

const SPREADSHEET_ID = '14wSwpcdDtSNu2dpGwYCDJgJWyls2w52YfS__z3zsWMk';
const EVIDENCE_FOLDER_ID = '17r19y2uyKeBu2QcKMsOMjIBeSYKu7R4R';

/**
 * Main application entry point
 */
function doGet(e) {
  try {
    const template = HtmlService.createTemplateFromFile('CoreScripts');
    
    if (e && e.parameter && e.parameter.logout === '1') {
      template.forceLogout = true;
    }
    
    return template.evaluate()
      .setTitle('Audit Management System - Instant')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
      // Removed the problematic theme-color meta tag
      
  } catch (error) {
    Logger.log('doGet error: ' + error.toString());
    return HtmlService.createHtmlOutput(`
      <div style="padding: 2rem; text-align: center; font-family: Arial;">
        <h2>System Error</h2>
        <p>Unable to load the application. Please contact your administrator.</p>
        <p><small>Error: ${error.message}</small></p>
        <button onclick="location.reload()">Retry</button>
      </div>
    `);
  }
}

/**
 * Include HTML files for separation of concerns
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (error) {
    Logger.log(`Include error for ${filename}: ${error.toString()}`);
    return `<!-- Error loading ${filename} -->`;
  }
}

/**
 * System initialization - Run once as admin
 */
function initializeSystem() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const currentUserEmail = Session.getActiveUser().getEmail();
    
    if (!currentUserEmail) {
      throw new Error('No authenticated user found');
    }
    
    // Create all required sheets
    const requiredSheets = {
      'Users': ['id', 'email', 'name', 'role', 'org_unit', 'active', 'created_at', 'last_login'],
      'Audits': ['id', 'year', 'affiliate', 'business_unit', 'title', 'scope', 'status', 'manager_email', 'start_date', 'end_date', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'WorkPapers': ['id', 'audit_id', 'audit_title', 'year', 'affiliate', 'process_area', 'objective', 'risks', 'controls', 'test_objective', 'proposed_tests', 'observation', 'observation_risk', 'reportable', 'status', 'reviewer_email', 'reviewer_comments', 'submitted_at', 'reviewed_at', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'Issues': ['id', 'audit_id', 'title', 'description', 'root_cause', 'risk_rating', 'recommendation', 'owner_email', 'due_date', 'status', 'reopened_count', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'Actions': ['id', 'issue_id', 'assignee_email', 'action_plan', 'due_date', 'status', 'closed_on', 'created_by', 'created_at', 'updated_by', 'updated_at'],
      'Evidence': ['id', 'parent_type', 'parent_id', 'file_name', 'drive_url', 'uploader_email', 'uploaded_on', 'version', 'checksum', 'created_at'],
      'Logs': ['timestamp', 'user_email', 'entity', 'entity_id', 'action', 'before_json', 'after_json'],
      'Settings': ['key', 'value', 'description', 'updated_by', 'updated_at']
    };
    
    Object.entries(requiredSheets).forEach(([sheetName, headers]) => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        
        // Format headers
        const headerRange = sheet.getRange(1, 1, 1, headers.length);
        headerRange.setFontWeight('bold');
        headerRange.setBackground('#1a237e');
        headerRange.setFontColor('white');
        
        Logger.log(`Created sheet: ${sheetName}`);
      }
    });
    
    // Initialize configuration
    getConfig();
    
    // Create admin user if doesn't exist
    const users = getSheetData('Users') || [];
    if (!users.some(u => u.email && u.email.toLowerCase() === currentUserEmail.toLowerCase())) {
      const adminUser = {
        email: currentUserEmail,
        name: currentUserEmail.split('@')[0],
        role: 'AuditManager',
        org_unit: 'Internal Audit',
        active: true
      };
      
      addRow('Users', adminUser);
      Logger.log(`Created admin user: ${currentUserEmail}`);
    }
    
    return { success: true, message: 'System initialized successfully' };
    
  } catch (error) {
    Logger.log('System initialization error: ' + error.toString());
    return { success: false, error: error.message };
  }
}
