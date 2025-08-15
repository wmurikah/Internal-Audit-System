/** users.gs - User access control logic
 * - Domain-restricted sign-in (@hasspetroleum.com)
 * - Super Admin (AuditManager) can create/modify users
 * - Email invite on create (placeholder MailApp)
 */

function createOrUpdateUser(userObj){
  try{
    const current = getCurrentUser();
    if (!current.permissions || !current.permissions.includes('manage_users')){
      throw new Error('Insufficient permissions');
    }

    // Basic validation
    if (!userObj || !userObj.email) throw new Error('Email required');
    if (!String(userObj.email).toLowerCase().endsWith('@hasspetroleum.com')){
      throw new Error('Only @hasspetroleum.com emails are allowed');
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = ss.getSheetByName('Users') || ss.insertSheet('Users');
    if (sh.getLastRow() < 1) sh.getRange(1,1,1,8).setValues([["id","email","name","role","org_unit","active","created_at","last_login"]]);

    const data = sh.getDataRange().getValues();
    const headers = data[0];
    const emailIdx = headers.indexOf('email');
    let rowIndex = -1;
    for (let r=1; r<data.length; r++){
      if ((data[r][emailIdx]||'').toString().toLowerCase() === userObj.email.toLowerCase()){
        rowIndex = r+1; // 1-based
        break;
      }
    }

    const idIdx = headers.indexOf('id');
    const nameIdx = headers.indexOf('name');
    const roleIdx = headers.indexOf('role');
    const unitIdx = headers.indexOf('org_unit');
    const activeIdx = headers.indexOf('active');

    if (rowIndex === -1){
      // create new
      const newId = 'USR' + Utilities.formatString('%03d', Math.max(1, sh.getLastRow()));
      sh.appendRow([
        newId,
        userObj.email,
        userObj.name || userObj.email.split('@')[0],
        userObj.role || 'Auditor',
        userObj.org_unit || 'Audit',
        userObj.active !== false,
        new Date(),
        ''
      ]);
      try{
        MailApp.sendEmail({to: userObj.email, subject: 'Audit System Access', body: 'You have been added. Please sign in using your corporate Microsoft account.'});
      }catch(e){ Logger.log('Mail send failed: '+e); }
      return { success:true, created:true };
    } else {
      // update existing
      if (userObj.name !== undefined) sh.getRange(rowIndex, nameIdx+1).setValue(userObj.name);
      if (userObj.role !== undefined) sh.getRange(rowIndex, roleIdx+1).setValue(userObj.role);
      if (userObj.org_unit !== undefined) sh.getRange(rowIndex, unitIdx+1).setValue(userObj.org_unit);
      if (userObj.active !== undefined) sh.getRange(rowIndex, activeIdx+1).setValue(!!userObj.active);
      return { success:true, updated:true };
    }
  }catch(e){
    return { success:false, error:e.message };
  }
}
