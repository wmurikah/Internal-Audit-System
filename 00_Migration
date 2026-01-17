/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Database Migration & Restructure Script v3.0
 * 
 * RUN THIS SCRIPT ONCE TO:
 * 1. Backup existing data
 * 2. Restructure database with indexes
 * 3. Migrate data with validation
 * 4. Set up optimized configuration
 * 
 * IMPORTANT: This is a destructive operation. Backup your spreadsheet first!
 * 
 * HOW TO RUN:
 * 1. Open this script in Apps Script editor
 * 2. Select "runMigration" from the function dropdown
 * 3. Click Run
 * 4. Grant permissions when prompted
 * 5. Check execution log for progress
 */

// ============================================================
// CONFIGURATION
// ============================================================
const MIGRATION_CONFIG = {
  SPREADSHEET_ID: '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4',
  BACKUP_PREFIX: 'BACKUP_',
  VERSION: '3.0',
  MIGRATION_DATE: new Date().toISOString()
};

// ============================================================
// SHEET SCHEMAS - Optimized Structure
// ============================================================
const SHEET_SCHEMAS = {
  '00_Config': {
    headers: ['config_key', 'config_value', 'description', 'updated_at'],
    defaults: [
      ['SYSTEM_VERSION', '3.0', 'System version', new Date()],
      ['SYSTEM_NAME', 'Hass Petroleum Internal Audit System', 'Display name', new Date()],
      ['MAX_ACTION_PLANS_PER_WP', '10', 'Maximum action plans per work paper', new Date()],
      ['SESSION_TIMEOUT_HOURS', '8', 'Session timeout in hours', new Date()],
      ['MAX_LOGIN_ATTEMPTS', '5', 'Maximum failed login attempts before lockout', new Date()],
      ['LOCKOUT_DURATION_MINUTES', '30', 'Account lockout duration', new Date()],
      ['REMINDER_DAYS_BEFORE_DUE', '7,3,1', 'Days before due date to send reminders', new Date()],
      ['OVERDUE_REMINDER_INTERVAL_DAYS', '7', 'Days between overdue reminders', new Date()],
      ['PASSWORD_MIN_LENGTH', '8', 'Minimum password length', new Date()],
      ['PBKDF2_ITERATIONS', '10000', 'Password hashing iterations', new Date()],
      ['CACHE_TTL_DROPDOWNS', '1800', 'Dropdown cache TTL in seconds', new Date()],
      ['CACHE_TTL_SESSION', '300', 'Session cache TTL in seconds', new Date()],
      ['CACHE_TTL_INDEX', '600', 'Index cache TTL in seconds', new Date()],
      ['WORK_PAPERS_FOLDER_ID', '', 'Drive folder for work paper files', new Date()],
      ['ACTION_PLAN_EVIDENCE_FOLDER_ID', '', 'Drive folder for evidence files', new Date()],
      ['EMAIL_FROM_NAME', 'Hass Audit System', 'Email sender name', new Date()],
      ['NEXT_WORK_PAPER_ID', '1', 'Counter for work paper IDs', new Date()],
      ['NEXT_ACTION_PLAN_ID', '1', 'Counter for action plan IDs', new Date()],
      ['NEXT_REQUIREMENT_ID', '1', 'Counter for requirement IDs', new Date()],
      ['NEXT_FILE_ID', '1', 'Counter for file IDs', new Date()],
      ['NEXT_USER_ID', '1', 'Counter for user IDs', new Date()],
      ['NEXT_SESSION_ID', '1', 'Counter for session IDs', new Date()],
      ['NEXT_LOG_ID', '1', 'Counter for log IDs', new Date()]
    ]
  },
  
  '01_Roles': {
    headers: ['role_code', 'role_name', 'role_level', 'description', 'is_active'],
    defaults: [
      ['SUPER_ADMIN', 'Head of Internal Audit', 100, 'Full system access', true],
      ['AUDITOR', 'Internal Auditor', 80, 'Create and manage work papers', true],
      ['UNIT_MANAGER', 'Unit Manager', 60, 'Respond to findings, manage action plans', true],
      ['JUNIOR_STAFF', 'Junior Staff', 40, 'View assigned action plans', true],
      ['SENIOR_MGMT', 'Senior Management', 70, 'View dashboards and reports', true],
      ['BOARD', 'Board Member', 90, 'View executive dashboards', true],
      ['EXTERNAL_AUDITOR', 'External Auditor', 50, 'View approved work papers', true]
    ]
  },
  
  '02_Permissions': {
    headers: ['role_code', 'module', 'can_create', 'can_read', 'can_update', 'can_delete', 'can_approve', 'can_export', 'field_restrictions'],
    defaults: [
      ['SUPER_ADMIN', 'WORK_PAPER', true, true, true, true, true, true, ''],
      ['SUPER_ADMIN', 'ACTION_PLAN', true, true, true, true, true, true, ''],
      ['SUPER_ADMIN', 'USER', true, true, true, true, false, true, ''],
      ['SUPER_ADMIN', 'CONFIG', true, true, true, true, false, true, ''],
      ['SUPER_ADMIN', 'REPORT', true, true, true, true, false, true, ''],
      ['AUDITOR', 'WORK_PAPER', true, true, true, false, false, true, ''],
      ['AUDITOR', 'ACTION_PLAN', true, true, true, false, true, true, ''],
      ['AUDITOR', 'REPORT', false, true, false, false, false, true, ''],
      ['UNIT_MANAGER', 'WORK_PAPER', false, true, true, false, false, false, 'observation_title,risk_rating,recommendation'],
      ['UNIT_MANAGER', 'ACTION_PLAN', true, true, true, false, false, false, ''],
      ['JUNIOR_STAFF', 'WORK_PAPER', false, true, false, false, false, false, ''],
      ['JUNIOR_STAFF', 'ACTION_PLAN', false, true, true, false, false, false, ''],
      ['SENIOR_MGMT', 'WORK_PAPER', false, true, false, false, false, true, ''],
      ['SENIOR_MGMT', 'ACTION_PLAN', false, true, false, false, false, true, ''],
      ['SENIOR_MGMT', 'REPORT', false, true, false, false, false, true, ''],
      ['BOARD', 'WORK_PAPER', false, true, false, false, false, true, ''],
      ['BOARD', 'ACTION_PLAN', false, true, false, false, false, true, ''],
      ['BOARD', 'REPORT', false, true, false, false, false, true, ''],
      ['EXTERNAL_AUDITOR', 'WORK_PAPER', false, true, false, false, false, false, ''],
      ['EXTERNAL_AUDITOR', 'ACTION_PLAN', false, true, false, false, false, false, '']
    ]
  },
  
  '03_FieldDefinitions': {
    headers: ['field_id', 'module', 'field_name', 'field_label', 'field_type', 'is_required', 'is_active', 'validation_rule', 'display_order'],
    defaults: []
  },
  
  '04_StatusWorkflow': {
    headers: ['workflow_id', 'module', 'from_status', 'to_status', 'allowed_roles', 'requires_comment', 'notification_template'],
    defaults: [
      ['WF001', 'WORK_PAPER', 'Draft', 'Submitted', 'AUDITOR,SUPER_ADMIN', false, 'WP_SUBMITTED'],
      ['WF002', 'WORK_PAPER', 'Submitted', 'Under Review', 'SUPER_ADMIN', false, ''],
      ['WF003', 'WORK_PAPER', 'Under Review', 'Approved', 'SUPER_ADMIN', false, ''],
      ['WF004', 'WORK_PAPER', 'Approved', 'Sent to Auditee', 'SUPER_ADMIN', false, 'WP_APPROVED'],
      ['WF005', 'WORK_PAPER', 'Submitted', 'Revision Requested', 'SUPER_ADMIN', true, 'WP_REVISION_REQUESTED'],
      ['WF006', 'WORK_PAPER', 'Revision Requested', 'Submitted', 'AUDITOR,SUPER_ADMIN', false, 'WP_SUBMITTED'],
      ['WF007', 'ACTION_PLAN', 'Not Due', 'Not Implemented', 'SYSTEM', false, ''],
      ['WF008', 'ACTION_PLAN', 'Not Due', 'Implemented', 'UNIT_MANAGER,JUNIOR_STAFF', false, 'AP_IMPLEMENTED'],
      ['WF009', 'ACTION_PLAN', 'Not Implemented', 'Implemented', 'UNIT_MANAGER,JUNIOR_STAFF', false, 'AP_IMPLEMENTED'],
      ['WF010', 'ACTION_PLAN', 'Implemented', 'Pending HoA Review', 'AUDITOR', true, ''],
      ['WF011', 'ACTION_PLAN', 'Implemented', 'Not Implemented', 'AUDITOR', true, 'AP_REJECTED'],
      ['WF012', 'ACTION_PLAN', 'Pending HoA Review', 'Closed', 'SUPER_ADMIN', true, ''],
      ['WF013', 'ACTION_PLAN', 'Pending HoA Review', 'Not Implemented', 'SUPER_ADMIN', true, 'AP_REJECTED']
    ]
  },
  
  '05_Users': {
    headers: [
      'user_id', 'email', 'password_hash', 'password_salt', 'full_name', 'first_name', 'last_name',
      'role_code', 'affiliate_code', 'department', 'phone', 'is_active',
      'must_change_password', 'login_attempts', 'locked_until', 'last_login',
      'created_at', 'created_by', 'updated_at', 'updated_by'
    ],
    defaults: []
  },
  
  '06_Affiliates': {
    headers: ['affiliate_code', 'affiliate_name', 'country', 'region', 'is_active', 'display_order'],
    defaults: [
      ['HPK', 'Hass Petroleum Kenya', 'Kenya', 'East Africa', true, 1],
      ['HPU', 'Hass Petroleum Uganda', 'Uganda', 'East Africa', true, 2],
      ['HPT', 'Hass Petroleum Tanzania', 'Tanzania', 'East Africa', true, 3],
      ['HPSS', 'Hass Petroleum South Sudan', 'South Sudan', 'East Africa', true, 4],
      ['HPR', 'Hass Petroleum Rwanda', 'Rwanda', 'East Africa', true, 5],
      ['HPZ', 'Hass Petroleum Zambia', 'Zambia', 'Southern Africa', true, 6],
      ['HPM', 'Hass Petroleum Malawi', 'Malawi', 'Southern Africa', true, 7],
      ['HPDRC', 'Hass Petroleum DRC', 'DRC', 'Central Africa', true, 8],
      ['HPS', 'Hass Petroleum Somalia', 'Somalia', 'East Africa', true, 9],
      ['HPG', 'Hass Petroleum Group', 'Kenya', 'Corporate', true, 10]
    ]
  },
  
  '07_AuditAreas': {
    headers: ['area_id', 'area_code', 'area_name', 'description', 'is_active', 'display_order'],
    defaults: []
  },
  
  '08_ProcessSubAreas': {
    headers: [
      'sub_area_id', 'area_id', 'sub_area_code', 'sub_area_name',
      'control_objectives', 'risk_description', 'test_objective', 'testing_steps',
      'is_active', 'display_order'
    ],
    defaults: []
  },
  
  '09_WorkPapers': {
    headers: [
      'work_paper_id', 'year', 'affiliate_code', 'audit_area_id', 'sub_area_id',
      'work_paper_date', 'audit_period_from', 'audit_period_to',
      'control_objectives', 'control_classification', 'control_type', 'control_frequency', 'control_standards',
      'risk_description', 'test_objective', 'testing_steps',
      'observation_title', 'observation_description', 'risk_rating', 'risk_summary', 'recommendation',
      'management_response', 'responsible_ids', 'cc_recipients',
      'status', 'final_status', 'revision_count',
      'prepared_by_id', 'prepared_by_name', 'prepared_date',
      'submitted_date', 'reviewed_by_id', 'reviewed_by_name', 'review_date', 'review_comments',
      'approved_by_id', 'approved_by_name', 'approved_date', 'sent_to_auditee_date',
      'created_at', 'updated_at'
    ],
    defaults: []
  },
  
  '10_WorkPaperRequirements': {
    headers: [
      'requirement_id', 'work_paper_id', 'requirement_number', 'requirement_description',
      'date_requested', 'status', 'notes', 'created_at', 'created_by'
    ],
    defaults: []
  },
  
  '11_WorkPaperFiles': {
    headers: [
      'file_id', 'work_paper_id', 'file_category', 'file_name', 'file_description',
      'drive_file_id', 'drive_url', 'file_size', 'mime_type', 'uploaded_by', 'uploaded_at'
    ],
    defaults: []
  },
  
  '12_WorkPaperRevisions': {
    headers: [
      'revision_id', 'work_paper_id', 'revision_number', 'action', 'comments',
      'changes_summary', 'user_id', 'user_name', 'action_date'
    ],
    defaults: []
  },
  
  '13_ActionPlans': {
    headers: [
      'action_plan_id', 'work_paper_id', 'action_number', 'action_description',
      'owner_ids', 'owner_names', 'due_date', 'status', 'final_status',
      'implementation_notes', 'implemented_date',
      'auditor_review_status', 'auditor_review_by', 'auditor_review_date', 'auditor_review_comments',
      'hoa_review_status', 'hoa_review_by', 'hoa_review_date', 'hoa_review_comments',
      'days_overdue', 'created_at', 'created_by', 'updated_at', 'updated_by'
    ],
    defaults: []
  },
  
  '14_ActionPlanEvidence': {
    headers: [
      'evidence_id', 'action_plan_id', 'file_name', 'file_description',
      'drive_file_id', 'drive_url', 'file_size', 'mime_type', 'uploaded_by', 'uploaded_at'
    ],
    defaults: []
  },
  
  '15_ActionPlanHistory': {
    headers: [
      'history_id', 'action_plan_id', 'previous_status', 'new_status',
      'comments', 'user_id', 'user_name', 'changed_at'
    ],
    defaults: []
  },
  
  '16_AuditLog': {
    headers: [
      'log_id', 'action', 'entity_type', 'entity_id',
      'old_data', 'new_data', 'user_id', 'user_email', 'timestamp', 'ip_address'
    ],
    defaults: []
  },
  
  '17_Index_WorkPapers': {
    headers: ['work_paper_id', 'row_number', 'year', 'affiliate_code', 'status', 'updated_at'],
    defaults: []
  },
  
  '18_Index_ActionPlans': {
    headers: ['action_plan_id', 'row_number', 'work_paper_id', 'status', 'final_status', 'updated_at'],
    defaults: []
  },
  
  '19_Index_Users': {
    headers: ['user_id', 'row_number', 'email', 'role_code', 'is_active', 'updated_at'],
    defaults: []
  },
  
  '20_Sessions': {
    headers: [
      'session_id', 'user_id', 'session_token', 'created_at', 'expires_at',
      'ip_address', 'user_agent', 'is_valid'
    ],
    defaults: []
  },
  
  '21_NotificationQueue': {
    headers: [
      'notification_id', 'template_code', 'recipient_user_id', 'recipient_email',
      'subject', 'body', 'module', 'record_id', 'status',
      'scheduled_for', 'sent_at', 'error_message', 'created_at'
    ],
    defaults: []
  },
  
  '22_EmailTemplates': {
    headers: [
      'template_code', 'template_name', 'subject_template', 'body_template', 'is_active'
    ],
    defaults: [
      ['WP_SUBMITTED', 'Work Paper Submitted', 'Work Paper {{work_paper_id}} Submitted for Review', 
       'A new work paper has been submitted for review.\n\nWork Paper: {{work_paper_id}}\nObservation: {{observation_title}}\nRisk Rating: {{risk_rating}}\nAffiliate: {{affiliate_name}}\nSubmitted By: {{submitted_by}}\n\nPlease review at your earliest convenience.', true],
      ['WP_APPROVED', 'Work Paper Approved', 'Work Paper {{work_paper_id}} Approved and Sent',
       'Your work paper has been approved and sent to the auditee.\n\nWork Paper: {{work_paper_id}}\nObservation: {{observation_title}}\n\nThe auditee has been notified and will respond with action plans.', true],
      ['WP_REVISION_REQUESTED', 'Revision Requested', 'Work Paper {{work_paper_id}} - Revision Requested',
       'A revision has been requested for your work paper.\n\nWork Paper: {{work_paper_id}}\nObservation: {{observation_title}}\n\nReviewer Comments:\n{{review_comments}}\n\nPlease address the comments and resubmit.', true],
      ['AP_IMPLEMENTED', 'Action Plan Implemented', 'Action Plan {{action_plan_id}} Marked as Implemented',
       'An action plan has been marked as implemented and is ready for review.\n\nAction Plan: {{action_plan_id}}\nWork Paper: {{work_paper_id}}\nAction: {{action_description}}\nOwner: {{owner_name}}', true],
      ['AP_DUE_REMINDER', 'Action Plan Due Reminder', 'Action Plan {{action_plan_id}} Due in {{days_until_due}} Days',
       'Reminder: Your action plan is due soon.\n\nAction Plan: {{action_plan_id}}\nAction: {{action_description}}\nDue Date: {{due_date}}\nDays Until Due: {{days_until_due}}', true],
      ['AP_OVERDUE', 'Action Plan Overdue', 'OVERDUE: Action Plan {{action_plan_id}} is {{days_overdue}} Days Overdue',
       'URGENT: Your action plan is overdue.\n\nAction Plan: {{action_plan_id}}\nAction: {{action_description}}\nDue Date: {{due_date}}\nDays Overdue: {{days_overdue}}\n\nPlease complete and mark as implemented immediately.', true],
      ['AP_REJECTED', 'Action Plan Rejected', 'Action Plan {{action_plan_id}} - Implementation Rejected',
       'Your action plan implementation has been rejected.\n\nAction Plan: {{action_plan_id}}\nAction: {{action_description}}\n\nReviewer Comments:\n{{review_comments}}\n\nPlease address the concerns and resubmit with additional evidence.', true]
    ]
  },
  
  '23_StagingArea': {
    headers: ['staging_id', 'transaction_id', 'operation', 'target_sheet', 'row_data', 'status', 'created_at', 'processed_at'],
    defaults: []
  }
};

// ============================================================
// MAIN ENTRY POINT - RUN THIS FUNCTION
// ============================================================
function runMigration() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  HASS PETROLEUM AUDIT SYSTEM - DATABASE MIGRATION v3.0     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Started at:', new Date().toISOString());
  console.log('');
  
  try {
    const ss = SpreadsheetApp.openById(MIGRATION_CONFIG.SPREADSHEET_ID);
    console.log('✓ Connected to spreadsheet:', ss.getName());
    
    // Step 1: Create backup
    console.log('');
    console.log('━━━ STEP 1/5: Creating Full Backup ━━━');
    const backupData = createFullBackup(ss);
    console.log('✓ Backup complete. Sheets backed up:', Object.keys(backupData).length);
    
    // Step 2: Restructure sheets
    console.log('');
    console.log('━━━ STEP 2/5: Restructuring Database ━━━');
    restructureAllSheets(ss);
    console.log('✓ Database restructure complete.');
    
    // Step 3: Migrate data
    console.log('');
    console.log('━━━ STEP 3/5: Migrating Data ━━━');
    migrateData(ss, backupData);
    console.log('✓ Data migration complete.');
    
    // Step 4: Build indexes
    console.log('');
    console.log('━━━ STEP 4/5: Building Indexes ━━━');
    rebuildAllIndexes(ss);
    console.log('✓ Index build complete.');
    
    // Step 5: Validate
    console.log('');
    console.log('━━━ STEP 5/5: Validating Migration ━━━');
    const validation = validateMigration(ss, backupData);
    
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    MIGRATION SUMMARY                        ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Records Migrated:');
    console.log('  • Users:        ', validation.counts.users);
    console.log('  • Work Papers:  ', validation.counts.workPapers);
    console.log('  • Action Plans: ', validation.counts.actionPlans);
    console.log('  • Audit Areas:  ', validation.counts.auditAreas);
    console.log('  • Affiliates:   ', validation.counts.affiliates);
    console.log('  • Sub-Areas:    ', validation.counts.subAreas);
    console.log('');
    
    if (validation.success) {
      console.log('✅ MIGRATION SUCCESSFUL - All validations passed');
    } else {
      console.log('⚠️ MIGRATION COMPLETED WITH WARNINGS:');
      validation.errors.forEach(err => console.log('   - ' + err));
    }
    
    console.log('');
    console.log('Completed at:', new Date().toISOString());
    console.log('');
    console.log('NEXT STEPS:');
    console.log('1. Review the migrated data in the spreadsheet');
    console.log('2. Delete backup sheets when satisfied (use cleanBackupSheets function)');
    console.log('3. Deploy the new service layer code');
    
    return validation;
    
  } catch (error) {
    console.log('');
    console.log('❌ MIGRATION FAILED');
    console.log('Error:', error.message);
    console.log('Stack:', error.stack);
    throw error;
  }
}

// ============================================================
// STEP 1: CREATE FULL BACKUP
// ============================================================
function createFullBackup(ss) {
  const backupData = {};
  const sheets = ss.getSheets();
  const timestamp = Utilities.formatDate(new Date(), 'GMT', 'yyyyMMdd_HHmm');
  
  let backedUp = 0;
  let skipped = 0;
  
  sheets.forEach(sheet => {
    const sheetName = sheet.getName();
    
    // Skip existing backup sheets
    if (sheetName.startsWith(MIGRATION_CONFIG.BACKUP_PREFIX)) {
      skipped++;
      return;
    }
    
    // Skip empty sheets
    if (sheet.getLastRow() < 1) {
      console.log('  ⊘ Skipping empty sheet:', sheetName);
      skipped++;
      return;
    }
    
    // Store data in memory
    const data = sheet.getDataRange().getValues();
    backupData[sheetName] = data;
    
    // Rename original sheet to backup
    let backupName = MIGRATION_CONFIG.BACKUP_PREFIX + timestamp + '_' + sheetName;
    
    // Handle name length limit (max 100 chars)
    if (backupName.length > 100) {
      backupName = backupName.substring(0, 100);
    }
    
    try {
      sheet.setName(backupName);
      console.log('  ✓ Backed up:', sheetName, '→', backupName, '(' + (data.length - 1) + ' rows)');
      backedUp++;
    } catch (e) {
      console.log('  ⚠ Could not rename:', sheetName, '-', e.message);
    }
  });
  
  console.log('  Summary: ' + backedUp + ' backed up, ' + skipped + ' skipped');
  
  return backupData;
}

// ============================================================
// STEP 2: RESTRUCTURE ALL SHEETS
// ============================================================
function restructureAllSheets(ss) {
  const sheetNames = Object.keys(SHEET_SCHEMAS);
  
  console.log('  Creating', sheetNames.length, 'sheets...');
  
  sheetNames.forEach((sheetName, index) => {
    const schema = SHEET_SCHEMAS[sheetName];
    
    // Delete if exists (shouldn't after backup rename, but safety check)
    let existingSheet = ss.getSheetByName(sheetName);
    if (existingSheet) {
      ss.deleteSheet(existingSheet);
    }
    
    // Create new sheet at correct position
    const sheet = ss.insertSheet(sheetName, index);
    
    // Set headers
    if (schema.headers.length > 0) {
      const headerRange = sheet.getRange(1, 1, 1, schema.headers.length);
      headerRange.setValues([schema.headers]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#E5E7EB');
      headerRange.setWrap(false);
      
      // Freeze header row
      sheet.setFrozenRows(1);
    }
    
    // Add default data if any
    if (schema.defaults && schema.defaults.length > 0) {
      const numCols = schema.defaults[0].length;
      const dataRange = sheet.getRange(2, 1, schema.defaults.length, numCols);
      dataRange.setValues(schema.defaults);
    }
    
    // Set column widths
    setOptimalColumnWidths(sheet, schema.headers);
    
    // Log progress every 5 sheets
    if ((index + 1) % 5 === 0 || index === sheetNames.length - 1) {
      console.log('  ✓ Created', index + 1, 'of', sheetNames.length, 'sheets');
    }
  });
}

function setOptimalColumnWidths(sheet, headers) {
  headers.forEach((header, idx) => {
    let width = 120; // default
    
    if (header.includes('_id') && !header.includes('description')) width = 100;
    else if (header.includes('email')) width = 200;
    else if (header.includes('full_name') || header.includes('user_name')) width = 150;
    else if (header.includes('description') || header.includes('objectives') || header.includes('steps')) width = 300;
    else if (header.includes('date') || header.includes('_at')) width = 140;
    else if (header.includes('is_') || header.includes('can_')) width = 70;
    else if (header === 'status' || header === 'final_status') width = 110;
    else if (header.includes('comments') || header.includes('notes')) width = 250;
    else if (header.includes('token') || header.includes('hash') || header.includes('salt')) width = 100;
    else if (header === 'row_number') width = 80;
    
    sheet.setColumnWidth(idx + 1, width);
  });
}

// ============================================================
// STEP 3: MIGRATE DATA
// ============================================================
function migrateData(ss, backupData) {
  // Migrate in dependency order (referenced tables first)
  
  // 3.1 Users - needed for references
  if (backupData['05_Users']) {
    migrateUsers(ss, backupData['05_Users']);
  } else {
    console.log('  ⊘ No users to migrate');
  }
  
  // 3.2 Affiliates - may have custom data
  if (backupData['06_Affiliates']) {
    migrateGenericSheet(ss, '06_Affiliates', backupData['06_Affiliates']);
  }
  
  // 3.3 Audit Areas
  if (backupData['07_AuditAreas']) {
    migrateGenericSheet(ss, '07_AuditAreas', backupData['07_AuditAreas']);
  }
  
  // 3.4 Sub Areas
  if (backupData['08_ProcessSubAreas']) {
    migrateGenericSheet(ss, '08_ProcessSubAreas', backupData['08_ProcessSubAreas']);
  }
  
  // 3.5 Work Papers
  if (backupData['09_WorkPapers']) {
    migrateWorkPapers(ss, backupData['09_WorkPapers']);
  }
  
  // 3.6 Requirements
  if (backupData['10_WorkPaperRequirements']) {
    migrateGenericSheet(ss, '10_WorkPaperRequirements', backupData['10_WorkPaperRequirements']);
  }
  
  // 3.7 Files
  if (backupData['11_WorkPaperFiles']) {
    migrateGenericSheet(ss, '11_WorkPaperFiles', backupData['11_WorkPaperFiles']);
  }
  
  // 3.8 Revisions
  if (backupData['12_WorkPaperRevisions']) {
    migrateGenericSheet(ss, '12_WorkPaperRevisions', backupData['12_WorkPaperRevisions']);
  }
  
  // 3.9 Action Plans
  if (backupData['13_ActionPlans']) {
    migrateActionPlans(ss, backupData['13_ActionPlans']);
  }
  
  // 3.10 Evidence
  if (backupData['14_ActionPlanEvidence']) {
    migrateGenericSheet(ss, '14_ActionPlanEvidence', backupData['14_ActionPlanEvidence']);
  }
  
  // 3.11 History
  if (backupData['15_ActionPlanHistory']) {
    migrateGenericSheet(ss, '15_ActionPlanHistory', backupData['15_ActionPlanHistory']);
  }
  
  // 3.12 Sessions (clear old sessions, don't migrate)
  console.log('  ⊘ Sessions cleared (users will need to re-login)');
  
  // 3.13 Update ID counters
  updateCounters(ss);
}

function migrateUsers(ss, oldData) {
  if (oldData.length < 2) {
    console.log('  ⊘ No user data to migrate');
    return;
  }
  
  const oldHeaders = oldData[0];
  const sheet = ss.getSheetByName('05_Users');
  const newHeaders = SHEET_SCHEMAS['05_Users'].headers;
  
  const newRows = [];
  
  for (let i = 1; i < oldData.length; i++) {
    const oldRow = oldData[i];
    const oldObj = {};
    oldHeaders.forEach((h, idx) => oldObj[h] = oldRow[idx]);
    
    // Skip empty rows
    if (!oldObj.user_id && !oldObj.email) continue;
    
    // Map to new schema
    const newRow = newHeaders.map(header => {
      // Direct mapping for matching columns
      if (oldObj[header] !== undefined && oldObj[header] !== null) {
        return sanitizeValue(oldObj[header]);
      }
      
      // Handle defaults for missing columns
      switch (header) {
        case 'password_salt':
          return oldObj.password_salt || generateSecureSalt();
        case 'must_change_password':
          // Force password change if no proper hash exists
          const hasHash = oldObj.password_hash && oldObj.password_hash.length > 20;
          return oldObj.must_change_password === true || oldObj.must_change_password === 'TRUE' || !hasHash;
        case 'login_attempts':
          return parseInt(oldObj.login_attempts) || 0;
        case 'is_active':
          return oldObj.is_active === true || oldObj.is_active === 'TRUE' || oldObj.is_active === undefined;
        case 'created_at':
          return oldObj.created_at || new Date();
        case 'updated_at':
          return new Date();
        default:
          return '';
      }
    });
    
    newRows.push(newRow);
  }
  
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    console.log('  ✓ Migrated', newRows.length, 'users');
  }
}

function migrateWorkPapers(ss, oldData) {
  if (oldData.length < 2) {
    console.log('  ⊘ No work paper data to migrate');
    return;
  }
  
  const oldHeaders = oldData[0];
  const sheet = ss.getSheetByName('09_WorkPapers');
  const newHeaders = SHEET_SCHEMAS['09_WorkPapers'].headers;
  
  const newRows = [];
  
  for (let i = 1; i < oldData.length; i++) {
    const oldRow = oldData[i];
    const oldObj = {};
    oldHeaders.forEach((h, idx) => oldObj[h] = oldRow[idx]);
    
    if (!oldObj.work_paper_id) continue;
    
    const newRow = newHeaders.map(header => {
      if (oldObj[header] !== undefined && oldObj[header] !== null) {
        return sanitizeValue(oldObj[header]);
      }
      
      switch (header) {
        case 'final_status':
          return oldObj.final_status || 'Open';
        case 'revision_count':
          return parseInt(oldObj.revision_count) || 0;
        case 'updated_at':
          return oldObj.updated_at || oldObj.created_at || new Date();
        case 'created_at':
          return oldObj.created_at || new Date();
        default:
          return '';
      }
    });
    
    newRows.push(newRow);
  }
  
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    console.log('  ✓ Migrated', newRows.length, 'work papers');
  }
}

function migrateActionPlans(ss, oldData) {
  if (oldData.length < 2) {
    console.log('  ⊘ No action plan data to migrate');
    return;
  }
  
  const oldHeaders = oldData[0];
  const sheet = ss.getSheetByName('13_ActionPlans');
  const newHeaders = SHEET_SCHEMAS['13_ActionPlans'].headers;
  
  const newRows = [];
  
  for (let i = 1; i < oldData.length; i++) {
    const oldRow = oldData[i];
    const oldObj = {};
    oldHeaders.forEach((h, idx) => oldObj[h] = oldRow[idx]);
    
    if (!oldObj.action_plan_id) continue;
    
    const newRow = newHeaders.map(header => {
      if (oldObj[header] !== undefined && oldObj[header] !== null) {
        return sanitizeValue(oldObj[header]);
      }
      
      // Handle legacy column mappings
      switch (header) {
        case 'owner_ids':
          return oldObj.owner_ids || oldObj.action_owner_id || '';
        case 'owner_names':
          return oldObj.owner_names || oldObj.action_owner_name || '';
        case 'final_status':
          return oldObj.final_status || 'Open';
        case 'days_overdue':
          return parseInt(oldObj.days_overdue) || 0;
        case 'updated_at':
          return oldObj.updated_at || new Date();
        case 'created_at':
          return oldObj.created_at || new Date();
        default:
          return '';
      }
    });
    
    newRows.push(newRow);
  }
  
  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    console.log('  ✓ Migrated', newRows.length, 'action plans');
  }
}

function migrateGenericSheet(ss, sheetName, oldData) {
  if (oldData.length < 2) {
    console.log('  ⊘ No data to migrate for', sheetName);
    return;
  }
  
  if (!SHEET_SCHEMAS[sheetName]) {
    console.log('  ⊘ No schema for', sheetName);
    return;
  }
  
  const oldHeaders = oldData[0];
  const sheet = ss.getSheetByName(sheetName);
  const newHeaders = SHEET_SCHEMAS[sheetName].headers;
  
  // Check if defaults were already populated
  const existingRows = sheet.getLastRow() - 1;
  if (existingRows > 0 && sheetName !== '06_Affiliates') {
    // Don't overwrite defaults for config tables
    console.log('  ⊘ Keeping defaults for', sheetName, '(' + existingRows + ' rows)');
    return;
  }
  
  const newRows = [];
  
  for (let i = 1; i < oldData.length; i++) {
    const oldRow = oldData[i];
    const oldObj = {};
    oldHeaders.forEach((h, idx) => oldObj[h] = oldRow[idx]);
    
    // Skip completely empty rows
    const hasData = Object.values(oldObj).some(v => v !== '' && v !== null && v !== undefined);
    if (!hasData) continue;
    
    const newRow = newHeaders.map(header => {
      if (oldObj[header] !== undefined && oldObj[header] !== null) {
        return sanitizeValue(oldObj[header]);
      }
      return '';
    });
    
    newRows.push(newRow);
  }
  
  if (newRows.length > 0) {
    // For affiliates, clear defaults first if we have migration data
    if (sheetName === '06_Affiliates' && existingRows > 0) {
      sheet.getRange(2, 1, existingRows, newHeaders.length).clearContent();
    }
    
    sheet.getRange(2, 1, newRows.length, newHeaders.length).setValues(newRows);
    console.log('  ✓ Migrated', newRows.length, 'rows to', sheetName);
  }
}

// ============================================================
// STEP 4: BUILD INDEXES
// ============================================================
function rebuildAllIndexes(ss) {
  rebuildWorkPaperIndex(ss);
  rebuildActionPlanIndex(ss);
  rebuildUserIndex(ss);
}

function rebuildWorkPaperIndex(ss) {
  const dataSheet = ss.getSheetByName('09_WorkPapers');
  const indexSheet = ss.getSheetByName('17_Index_WorkPapers');
  
  if (!dataSheet || !indexSheet) return;
  
  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) {
    console.log('  ⊘ No work papers to index');
    return;
  }
  
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  
  const idIdx = headers.indexOf('work_paper_id');
  const yearIdx = headers.indexOf('year');
  const affIdx = headers.indexOf('affiliate_code');
  const statusIdx = headers.indexOf('status');
  
  const indexRows = [];
  const now = new Date();
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][idIdx]) continue;
    
    indexRows.push([
      data[i][idIdx],
      i + 1,  // row_number in sheet (1-indexed + header)
      data[i][yearIdx] || '',
      data[i][affIdx] || '',
      data[i][statusIdx] || '',
      now
    ]);
  }
  
  if (indexRows.length > 0) {
    indexSheet.getRange(2, 1, indexRows.length, 6).setValues(indexRows);
    console.log('  ✓ Indexed', indexRows.length, 'work papers');
  }
}

function rebuildActionPlanIndex(ss) {
  const dataSheet = ss.getSheetByName('13_ActionPlans');
  const indexSheet = ss.getSheetByName('18_Index_ActionPlans');
  
  if (!dataSheet || !indexSheet) return;
  
  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) {
    console.log('  ⊘ No action plans to index');
    return;
  }
  
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  
  const idIdx = headers.indexOf('action_plan_id');
  const wpIdIdx = headers.indexOf('work_paper_id');
  const statusIdx = headers.indexOf('status');
  const finalIdx = headers.indexOf('final_status');
  
  const indexRows = [];
  const now = new Date();
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][idIdx]) continue;
    
    indexRows.push([
      data[i][idIdx],
      i + 1,
      data[i][wpIdIdx] || '',
      data[i][statusIdx] || '',
      data[i][finalIdx] || '',
      now
    ]);
  }
  
  if (indexRows.length > 0) {
    indexSheet.getRange(2, 1, indexRows.length, 6).setValues(indexRows);
    console.log('  ✓ Indexed', indexRows.length, 'action plans');
  }
}

function rebuildUserIndex(ss) {
  const dataSheet = ss.getSheetByName('05_Users');
  const indexSheet = ss.getSheetByName('19_Index_Users');
  
  if (!dataSheet || !indexSheet) return;
  
  const lastRow = dataSheet.getLastRow();
  if (lastRow < 2) {
    console.log('  ⊘ No users to index');
    return;
  }
  
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  
  const idIdx = headers.indexOf('user_id');
  const emailIdx = headers.indexOf('email');
  const roleIdx = headers.indexOf('role_code');
  const activeIdx = headers.indexOf('is_active');
  
  const indexRows = [];
  const now = new Date();
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][idIdx]) continue;
    
    indexRows.push([
      data[i][idIdx],
      i + 1,
      data[i][emailIdx] || '',
      data[i][roleIdx] || '',
      data[i][activeIdx],
      now
    ]);
  }
  
  if (indexRows.length > 0) {
    indexSheet.getRange(2, 1, indexRows.length, 6).setValues(indexRows);
    console.log('  ✓ Indexed', indexRows.length, 'users');
  }
}

// ============================================================
// UPDATE COUNTERS
// ============================================================
function updateCounters(ss) {
  const configSheet = ss.getSheetByName('00_Config');
  const configData = configSheet.getDataRange().getValues();
  const headers = configData[0];
  const keyIdx = headers.indexOf('config_key');
  const valueIdx = headers.indexOf('config_value');
  
  // Calculate max IDs from migrated data
  const counters = {
    'NEXT_WORK_PAPER_ID': getMaxIdNumber(ss, '09_WorkPapers', 'work_paper_id', 'WP-') + 1,
    'NEXT_ACTION_PLAN_ID': getMaxIdNumber(ss, '13_ActionPlans', 'action_plan_id', 'AP-') + 1,
    'NEXT_REQUIREMENT_ID': getMaxIdNumber(ss, '10_WorkPaperRequirements', 'requirement_id', 'REQ-') + 1,
    'NEXT_FILE_ID': Math.max(
      getMaxIdNumber(ss, '11_WorkPaperFiles', 'file_id', 'FILE-'),
      getMaxIdNumber(ss, '14_ActionPlanEvidence', 'evidence_id', 'FILE-')
    ) + 1,
    'NEXT_USER_ID': getMaxIdNumber(ss, '05_Users', 'user_id', 'USR-') + 1,
    'NEXT_LOG_ID': getMaxIdNumber(ss, '16_AuditLog', 'log_id', 'LOG-') + 1,
    'NEXT_SESSION_ID': 1
  };
  
  // Update config rows
  for (let i = 1; i < configData.length; i++) {
    const key = configData[i][keyIdx];
    if (counters[key] !== undefined) {
      configSheet.getRange(i + 1, valueIdx + 1).setValue(counters[key]);
    }
  }
  
  console.log('  ✓ Updated ID counters');
}

function getMaxIdNumber(ss, sheetName, columnName, prefix) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const colIdx = headers.indexOf(columnName);
  
  if (colIdx === -1) return 0;
  
  let maxNum = 0;
  
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][colIdx] || '');
    if (id.startsWith(prefix)) {
      const numStr = id.replace(prefix, '').replace(/^0+/, '');
      const numVal = parseInt(numStr) || 0;
      if (numVal > maxNum) maxNum = numVal;
    }
  }
  
  return maxNum;
}

// ============================================================
// STEP 5: VALIDATE MIGRATION
// ============================================================
function validateMigration(ss, backupData) {
  const errors = [];
  const counts = {
    users: 0,
    workPapers: 0,
    actionPlans: 0,
    auditAreas: 0,
    affiliates: 0,
    subAreas: 0
  };
  
  // Count records in each table
  const countSheets = {
    '05_Users': 'users',
    '09_WorkPapers': 'workPapers',
    '13_ActionPlans': 'actionPlans',
    '07_AuditAreas': 'auditAreas',
    '06_Affiliates': 'affiliates',
    '08_ProcessSubAreas': 'subAreas'
  };
  
  Object.entries(countSheets).forEach(([sheetName, countKey]) => {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      counts[countKey] = Math.max(0, sheet.getLastRow() - 1);
    }
  });
  
  // Validate indexes match data
  const wpIndex = ss.getSheetByName('17_Index_WorkPapers');
  if (wpIndex) {
    const indexCount = Math.max(0, wpIndex.getLastRow() - 1);
    if (indexCount !== counts.workPapers && counts.workPapers > 0) {
      errors.push('Work paper index mismatch: ' + indexCount + ' indexed vs ' + counts.workPapers + ' records');
    }
  }
  
  const apIndex = ss.getSheetByName('18_Index_ActionPlans');
  if (apIndex) {
    const indexCount = Math.max(0, apIndex.getLastRow() - 1);
    if (indexCount !== counts.actionPlans && counts.actionPlans > 0) {
      errors.push('Action plan index mismatch: ' + indexCount + ' indexed vs ' + counts.actionPlans + ' records');
    }
  }
  
  const userIndex = ss.getSheetByName('19_Index_Users');
  if (userIndex) {
    const indexCount = Math.max(0, userIndex.getLastRow() - 1);
    if (indexCount !== counts.users && counts.users > 0) {
      errors.push('User index mismatch: ' + indexCount + ' indexed vs ' + counts.users + ' records');
    }
  }
  
  // Check required sheets exist
  const requiredSheets = ['00_Config', '01_Roles', '02_Permissions', '05_Users', '09_WorkPapers', '13_ActionPlans'];
  requiredSheets.forEach(name => {
    if (!ss.getSheetByName(name)) {
      errors.push('Missing required sheet: ' + name);
    }
  });
  
  return {
    success: errors.length === 0,
    errors: errors,
    counts: counts
  };
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function sanitizeValue(value) {
  if (value === null || value === undefined) return '';
  
  // Handle Date objects
  if (value instanceof Date) return value;
  
  // Handle booleans
  if (typeof value === 'boolean') return value;
  
  // Handle numbers
  if (typeof value === 'number') return value;
  
  // Convert to string for text sanitization
  const strVal = String(value);
  
  // Prevent formula injection - prepend with ' if starts with dangerous chars
  if (/^[=+\-@]/.test(strVal)) {
    return "'" + strVal;
  }
  
  return value;
}

function generateSecureSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  for (let i = 0; i < 32; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

// ============================================================
// UTILITY FUNCTIONS - RUN MANUALLY IF NEEDED
// ============================================================

/**
 * Rebuild all indexes manually
 * Run this if indexes get out of sync
 */
function rebuildIndexesManual() {
  console.log('Rebuilding indexes...');
  const ss = SpreadsheetApp.openById(MIGRATION_CONFIG.SPREADSHEET_ID);
  rebuildAllIndexes(ss);
  console.log('Done!');
}

/**
 * Validate the database structure
 * Run this to check if everything is in order
 */
function validateDatabaseManual() {
  console.log('Validating database...');
  const ss = SpreadsheetApp.openById(MIGRATION_CONFIG.SPREADSHEET_ID);
  const result = validateMigration(ss, {});
  
  console.log('');
  console.log('Record Counts:');
  Object.entries(result.counts).forEach(([key, val]) => {
    console.log('  ' + key + ': ' + val);
  });
  
  console.log('');
  if (result.success) {
    console.log('✅ All validations passed');
  } else {
    console.log('⚠️ Issues found:');
    result.errors.forEach(err => console.log('  - ' + err));
  }
}

/**
 * Delete all backup sheets
 * Run this ONLY after confirming migration was successful
 */
function cleanBackupSheets() {
  console.log('Cleaning backup sheets...');
  const ss = SpreadsheetApp.openById(MIGRATION_CONFIG.SPREADSHEET_ID);
  const sheets = ss.getSheets();
  
  let deleted = 0;
  
  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (name.startsWith(MIGRATION_CONFIG.BACKUP_PREFIX)) {
      console.log('  Deleting:', name);
      ss.deleteSheet(sheet);
      deleted++;
    }
  });
  
  console.log('Deleted', deleted, 'backup sheets');
}

/**
 * Create a default admin user if none exists
 * Run this if you need to create an initial admin account
 */
function createDefaultAdmin() {
  const ss = SpreadsheetApp.openById(MIGRATION_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName('05_Users');
  
  if (!sheet) {
    console.log('Users sheet not found!');
    return;
  }
  
  // Check if any admin exists
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const roleIdx = headers.indexOf('role_code');
  
  let hasAdmin = false;
  for (let i = 1; i < data.length; i++) {
    if (data[i][roleIdx] === 'SUPER_ADMIN') {
      hasAdmin = true;
      break;
    }
  }
  
  if (hasAdmin) {
    console.log('Admin user already exists');
    return;
  }
  
  // Create default admin
  const salt = generateSecureSalt();
  const tempPassword = 'Admin' + Math.floor(1000 + Math.random() * 9000);
  const hash = hashPasswordPBKDF2(tempPassword, salt);
  
  const newRow = SHEET_SCHEMAS['05_Users'].headers.map(header => {
    switch (header) {
      case 'user_id': return 'USR-00001';
      case 'email': return 'admin@hasspetroleum.com';
      case 'password_hash': return hash;
      case 'password_salt': return salt;
      case 'full_name': return 'System Administrator';
      case 'first_name': return 'System';
      case 'last_name': return 'Administrator';
      case 'role_code': return 'SUPER_ADMIN';
      case 'is_active': return true;
      case 'must_change_password': return true;
      case 'login_attempts': return 0;
      case 'created_at': return new Date();
      case 'updated_at': return new Date();
      default: return '';
    }
  });
  
  sheet.appendRow(newRow);
  
  // Update user index
  const indexSheet = ss.getSheetByName('19_Index_Users');
  if (indexSheet) {
    indexSheet.appendRow(['USR-00001', sheet.getLastRow(), 'admin@hasspetroleum.com', 'SUPER_ADMIN', true, new Date()]);
  }
  
  // Update counter
  const configSheet = ss.getSheetByName('00_Config');
  const configData = configSheet.getDataRange().getValues();
  for (let i = 1; i < configData.length; i++) {
    if (configData[i][0] === 'NEXT_USER_ID') {
      configSheet.getRange(i + 1, 2).setValue(2);
      break;
    }
  }
  
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║              DEFAULT ADMIN ACCOUNT CREATED                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  Email:    admin@hasspetroleum.com');
  console.log('  Password: ' + tempPassword);
  console.log('');
  console.log('  ⚠️  SAVE THIS PASSWORD - You will need to change it on first login');
  console.log('');
}

/**
 * Simple PBKDF2-like hash using HMAC iterations
 * More secure than plain SHA-256
 */
function hashPasswordPBKDF2(password, salt) {
  const iterations = 10000;
  let hash = password + salt;
  
  for (let i = 0; i < iterations; i++) {
    const signature = Utilities.computeHmacSignature(
      Utilities.MacAlgorithm.HMAC_SHA_256,
      hash,
      salt
    );
    hash = Utilities.base64Encode(signature);
  }
  
  return hash;
}
