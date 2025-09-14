/**
 * MAINTENANCE MODULE - System Optimization
 */

function performMaintenance() {
  cleanupOldData();
  optimizeSheets();
  validateDataIntegrity();
  return { success: true, timestamp: new Date() };
}

function cleanupOldData() {
  // Archive old completed audits
  const audits = getSheetData('Audits');
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  const oldAudits = audits.filter(a => 
    a.status === 'Completed' && 
    new Date(a.created_at) < oneYearAgo
  );
  
  // Archive logic here
  console.log(`Found ${oldAudits.length} audits to archive`);
}

function optimizeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = ss.getSheets();
  
  sheets.forEach(sheet => {
    // Remove empty rows
    const lastRow = sheet.getLastRow();
    const maxRows = sheet.getMaxRows();
    if (maxRows - lastRow > 100) {
      sheet.deleteRows(lastRow + 1, maxRows - lastRow - 100);
    }
  });
}

function validateDataIntegrity() {
  const issues = getSheetData('Issues');
  const audits = getSheetData('Audits');
  const auditIds = audits.map(a => a.id);
  
  // Check for orphaned issues
  const orphaned = issues.filter(i => !auditIds.includes(i.audit_id));
  
  if (orphaned.length > 0) {
    console.log(`Warning: ${orphaned.length} orphaned issues found`);
  }
  
  return { orphaned: orphaned.length };
}

function backupData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const backupName = `Audit_Backup_${new Date().toISOString().split('T')[0]}`;
  const backup = ss.copy(backupName);
  
  return {
    success: true,
    backupId: backup.getId(),
    backupName: backupName
  };
}
