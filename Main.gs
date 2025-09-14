/**
 * INTERPLANETARY AUDIT SYSTEM
 * Aggressive Engineering for Thrillionaire Investors
 * Zero-cost, Maximum Impact Architecture
 */

const SPREADSHEET_ID = '14wSwpcdDtSNu2dpGwYCDJgJWyls2w52YfS__z3zsWMk';
const EVIDENCE_FOLDER_ID = '17r19y2uyKeBu2QcKMsOMjIBeSYKu7R4R';

function doGet() {
  const tpl = HtmlService.createTemplateFromFile('MainUI');
  tpl.appInfo = { 
    user: getCurrentUser(), 
    config: getConfig(),
    timestamp: new Date().toISOString()
  };
  return tpl.evaluate()
    .setTitle('Interplanetary Audit System')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function ping() { 
  return { ok: true, time: new Date(), version: '3.0-INTERPLANETARY' }; 
}

function initializeSystem() {
  const sheets = {
    'Users': ['id','email','name','role','org_unit','active','created_at','last_login'],
    'Audits': ['id','year','affiliate','business_unit','title','scope','status','manager_email','start_date','end_date','created_by','created_at'],
    'WorkPapers': ['id','audit_id','process_area','objective','risks','controls','test_objective','status','created_by','created_at'],
    'Issues': ['id','audit_id','title','description','risk_rating','owner_email','due_date','status','created_at'],
    'Actions': ['id','issue_id','action_plan','assignee_email','due_date','status','created_at'],
    'Evidence': ['id','parent_type','parent_id','file_name','drive_url','uploader_email','uploaded_on','status'],
    'RiskRegister': ['id','unit','process','risk_statement','inherent_rating','controls','owner_email','status','created_at'],
    'Settings': ['key','value','description','updated_at']
  };
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.entries(sheets).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
  
  // Initialize with current user as admin
  const email = Session.getActiveUser().getEmail();
  const users = getSheetData('Users');
  if (!users.some(u => u.email === email)) {
    addRow('Users', {
      email: email,
      name: email.split('@')[0],
      role: 'AuditManager',
      org_unit: 'Headquarters',
      active: true,
      created_at: new Date()
    });
  }
  
  return { success: true, message: 'System initialized for interplanetary operations' };
}

// Universal data operations
function getSheetData(sheetName) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return [];
    
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    return data.slice(1)
      .filter(row => row.some(cell => cell !== ''))
      .map(row => {
        const obj = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] instanceof Date ? 
            row[i].toISOString().split('T')[0] : 
            (row[i] || '');
        });
        return obj;
      });
  } catch (e) {
    console.log(`Error reading ${sheetName}: ${e.message}`);
    return [];
  }
}

function addRow(sheetName, data) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // Auto-generate ID
  if (!data.id) {
    const prefix = {
      Users: 'USR', Audits: 'AUD', Issues: 'ISS', 
      Actions: 'ACT', WorkPapers: 'WP', Evidence: 'EVD',
      RiskRegister: 'RISK'
    }[sheetName] || 'ID';
    const count = Math.max(1, sheet.getLastRow() - 1) + 1;
    data.id = `${prefix}${String(count).padStart(3, '0')}`;
  }
  
  if (!data.created_at) data.created_at = new Date();
  
  const row = headers.map(h => data[h] || '');
  sheet.appendRow(row);
  
  return data;
}

function updateRow(sheetName, id, updates) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      Object.entries(updates).forEach(([key, value]) => {
        const col = headers.indexOf(key);
        if (col !== -1) {
          sheet.getRange(i + 1, col + 1).setValue(value);
        }
      });
      return { success: true, id };
    }
  }
  throw new Error(`Record ${id} not found`);
}

function deleteRow(sheetName, id) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
  
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      sheet.deleteRow(i + 1);
      return { success: true, id };
    }
  }
  throw new Error(`Record ${id} not found`);
}

function getConfig() {
  const settings = getSheetData('Settings');
  const config = {};
  
  settings.forEach(setting => {
    try {
      config[setting.key] = JSON.parse(setting.value);
    } catch {
      config[setting.key] = setting.value;
    }
  });
  
  // Default configuration
  const defaults = {
    riskRatings: ['Extreme', 'High', 'Medium', 'Low'],
    auditStatuses: ['Planning', 'In Progress', 'Review', 'Completed', 'Closed'],
    issueStatuses: ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed'],
    actionStatuses: ['Not Started', 'In Progress', 'Pending Review', 'Completed', 'Overdue'],
    businessUnits: ['Fleet Logistics Kenya', 'Finance', 'Operations', 'HR', 'IT', 'Compliance'],
    affiliates: ['Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'South Sudan', 'Group']
  };
  
  return { ...defaults, ...config };
}
