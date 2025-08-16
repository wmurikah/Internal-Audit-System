/**
 * Safe Reset & Monthly Reminders (code.gs)
 * - Adds a SAFE reset routine that aligns sheet structure WITHOUT renaming existing files or nuking data
 * - Seeds minimum dummy data (>=10 rows per sheet) for local verification
 * - Schedules and runs monthly reminders for open issues grouped by process owner (Auditee)
 * - Keeps performance by batching reads/writes and using cache-friendly helpers
 */

/** Safe reset: verify sheets/headers exist; add missing columns; seed minimum data */
function safeResetAndSeed() {
  const started = new Date();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const required = {
    'Users': ['id','email','name','role','org_unit','active','created_at','last_login'],
    'Audits': ['id','year','affiliate','business_unit','title','scope','status','manager_email','start_date','end_date','created_by','created_at','updated_by','updated_at'],
    'WorkPapers': ['id','audit_id','audit_title','year','affiliate','process_area','objective','risks','controls','test_objective','proposed_tests','observation','observation_risk','reportable','status','reviewer_email','reviewer_comments','submitted_at','reviewed_at','created_by','created_at','updated_by','updated_at'],
    'Issues': ['id','audit_id','title','description','root_cause','risk_rating','recommendation','owner_email','due_date','status','reopened_count','created_by','created_at','updated_by','updated_at'],
    'Actions': ['id','issue_id','assignee_email','action_plan','due_date','status','closed_on','created_by','created_at','updated_by','updated_at'],
    'Evidence': ['id','parent_type','parent_id','file_name','drive_url','uploader_email','uploaded_on','version','checksum','status','reviewer_email','review_comment','reviewed_at','manager_email','manager_decision','manager_review_comment','manager_reviewed_at','created_at'],
    'Logs': ['timestamp','user_email','entity','entity_id','action','before_json','after_json'],
    'Settings': ['key','value','description','updated_by','updated_at'],
    'RiskRegister': ['id','unit','process','risk_statement','inherent_rating','controls','owner_email','status','due_date','residual_risk','links','created_at','updated_at']
  };

  const summary = { created: [], updatedHeaders: [], seeded: {}, started, completed: null };

  Object.keys(required).forEach(function(sheetName){
    let sh = ss.getSheetByName(sheetName);
    if (!sh) {
      sh = ss.insertSheet(sheetName);
      sh.getRange(1,1,1,required[sheetName].length).setValues([required[sheetName]]);
      try { sh.setFrozenRows(1); } catch(e){}
      summary.created.push(sheetName);
    } else {
      // Ensure header row exists and contains all required columns; append missing columns at the end (non-destructive)
      const lastCol = Math.max(1, sh.getLastColumn());
      let headers = sh.getRange(1,1,1,lastCol).getValues()[0];
      if (!headers || headers.length === 0 || headers[0] === '') {
        headers = [];
      }
      const missing = required[sheetName].filter(h => headers.indexOf(h) === -1);
      if (missing.length) {
        // Append missing columns at the end
        const newHeaders = headers.concat(missing);
        sh.getRange(1,1,1,newHeaders.length).setValues([newHeaders]);
        summary.updatedHeaders.push({ sheet: sheetName, added: missing });
      }
    }
  });

  // Seed data to ensure at least 10 rows per sheet (idempotent — only tops up)
  const gens = {
    Users: genUserRow_,
    Audits: genAuditRow_,
    Issues: genIssueRow_,
    Actions: genActionRow_,
    WorkPapers: genWorkPaperRow_,
    Evidence: genEvidenceRow_,
    RiskRegister: genRiskRow_
  };

  Object.keys(gens).forEach(function(sheetName){
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return;
    const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const want = 10;
    const have = Math.max(0, sh.getLastRow() - 1);
    if (have < want) {
      const rows = [];
      for (let i = have + 1; i <= want; i++) rows.push(toRow_(headers, gens[sheetName](i)));
      if (rows.length) sh.getRange(sh.getLastRow()+1, 1, rows.length, headers.length).setValues(rows);
      summary.seeded[sheetName] = rows.length;
    } else {
      summary.seeded[sheetName] = 0;
    }
  });

  // Apply validations where available and set up monthly trigger
  try { applyStandardValidations(); } catch(e){ Logger.log('applyStandardValidations (safe) error: '+e); }
  try { ensureMonthlyReminderTrigger(); } catch(e){ Logger.log('ensureMonthlyReminderTrigger error: '+e); }

  summary.completed = new Date();
  logAction('System', 'reset', 'safe_reset_and_seed', {}, summary);
  return { success:true, summary };
}

function toRow_(headers, obj){ return headers.map(function(h){ return (obj && obj.hasOwnProperty(h)) ? obj[h] : ''; }); }

// === Generators (lightweight, deterministic) ===
function genUserRow_(n){
  return { id: 'USR'+('000'+n).slice(-3), email: 'user'+n+'@company.com', name: 'User '+n, role: n===1?'AuditManager':(n%5===0?'SeniorManagement':(n%4===0?'Board':(n%3===0?'Auditor':'Auditee'))), org_unit: 'Unit '+((n%5)+1), active: true, created_at: new Date(), last_login: '' };
}
function genAuditRow_(n){
  const bu = ['Fleet Logistics Kenya','Finance','Operations','HR','IT','Compliance','Procurement'];
  const aff = ['Group','Kenya','Uganda','Tanzania','Rwanda','South Sudan'];
  return { id:'AUD'+('000'+n).slice(-3), year: new Date().getFullYear(), affiliate: aff[n%aff.length], business_unit: bu[n%bu.length], title: bu[n%bu.length]+' Audit', scope: 'Scope '+n, status: ['Planning','In Progress','Review','Completed','Closed'][n%5], manager_email:'audit.manager@company.com', start_date:new Date(), end_date:new Date(), created_by:'audit.manager@company.com', created_at:new Date(), updated_by:'', updated_at:'' };
}
function genIssueRow_(n){
  return { id:'ISS'+('000'+n).slice(-3), audit_id:'AUD'+('000'+((n%10)+1)).slice(-3), title:'Issue '+n, description:'Description '+n, root_cause:'Cause '+n, risk_rating: ['Extreme','High','Medium','Low'][n%4], recommendation:'Recommendation '+n, owner_email:'owner'+((n%5)+1)+'@company.com', due_date: new Date(), status: ['Open','In Progress','Under Review','Resolved','Closed'][n%5], reopened_count:0, created_by:'auditor@company.com', created_at:new Date(), updated_by:'', updated_at:'' };
}
function genActionRow_(n){
  return { id:'ACT'+('000'+n).slice(-3), issue_id:'ISS'+('000'+((n%10)+1)).slice(-3), assignee_email:'owner'+((n%5)+1)+'@company.com', action_plan:'Action plan '+n, due_date:new Date(), status:['Not Started','In Progress','Pending Review','Completed','Overdue'][n%5], closed_on:'', created_by:'auditor@company.com', created_at:new Date(), updated_by:'', updated_at:'' };
}
function genWorkPaperRow_(n){
  const aid = 'AUD'+('000'+((n%10)+1)).slice(-3);
  return { id:'WP'+('000'+n).slice(-3), audit_id:aid, audit_title:'Audit '+aid, year:new Date().getFullYear(), affiliate:'Group', process_area:'Process '+n, objective:'Objective '+n, risks:'Risks...', controls:'Controls...', test_objective:'Test obj', proposed_tests:'Proposed tests', observation:'Observation', observation_risk:['Low','Medium','High'][n%3], reportable: (n%3===0?'Yes':'No'), status:['Draft','Submitted for Review','Approved','Returned'][n%4], reviewer_email:'audit.manager@company.com', reviewer_comments:'', submitted_at:'', reviewed_at:'', created_by:'auditor@company.com', created_at:new Date(), updated_by:'', updated_at:'' };
}
function genEvidenceRow_(n){
  const types = ['Audit','Issue','Action','WorkPaper'];
  const parentType = types[n%types.length];
  const parentId = (parentType==='Audit'?'AUD':parentType==='Issue'?'ISS':parentType==='Action'?'ACT':'WP') + ('000'+((n%10)+1)).slice(-3);
  return { id:'EVD'+('000'+n).slice(-3), parent_type:parentType, parent_id:parentId, file_name:'File_'+n+'.pdf', drive_url:'https://drive.google.com/file/d/sample-EVD'+('000'+n).slice(-3), uploader_email:'owner1@company.com', uploaded_on:new Date(), version:1, checksum:'checksum-'+n, status:'Submitted', reviewer_email:'', review_comment:'', reviewed_at:'', manager_email:'', manager_decision:'', manager_review_comment:'', manager_reviewed_at:'', created_at:new Date() };
}
function genRiskRow_(n){
  return { id:'RISK'+('000'+n).slice(-3), unit:'Unit '+((n%5)+1), process:'Process '+n, risk_statement:'Risk statement '+n, inherent_rating:['Extreme','High','Medium','Low'][n%4], controls:'Key controls', owner_email:'owner'+((n%5)+1)+'@company.com', status:['Open','In Progress','Mitigated','Closed'][n%4], due_date:new Date(), residual_risk:['High','Medium','Low'][n%3], links:'', created_at:new Date(), updated_at:new Date() };
}

/** Ensure monthly trigger exists for reminders */
function ensureMonthlyReminderTrigger(){
  const func = 'sendMonthlyOpenIssuesReminders';
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === func);
  if (triggers.length) return { success:true, message:'Trigger exists' };
  ScriptApp.newTrigger(func).timeBased().onMonthDay(1).atHour(8).create();
  return { success:true, message:'Monthly trigger created' };
}

/** Send monthly reminders: group open issues by Auditee (owner_email) */
function sendMonthlyOpenIssuesReminders(){
  try{
    const appUrl = ScriptApp.getService().getUrl();
    const cfg = getConfig();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const issues = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('Issues') : [];
    const actions = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('Actions') : [];
    const workpapers = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('WorkPapers') : [];

    // Consider open issues (not Resolved/Closed)
    const openIssues = issues.filter(i => i.status && !['Resolved','Closed'].includes(String(i.status)));
    const byOwner = {};
    openIssues.forEach(function(iss){
      const owner = (iss.owner_email||'').toLowerCase();
      if (!owner) return;
      if (!byOwner[owner]) byOwner[owner] = [];
      // Process from related workpaper (best-effort)
      let process = '';
      try { const wp = workpapers.find(w=> String(w.audit_id)===String(iss.audit_id)); process = wp ? (wp.process_area||'') : ''; } catch(e){}
      // Due date from earliest related action (best-effort)
      let dueDate = '';
      try { const rel = actions.filter(a=> String(a.issue_id)===String(iss.id)).map(a=> a.due_date).filter(Boolean).sort(); dueDate = rel.length? rel[0]:''; } catch(e){}
      byOwner[owner].push({ id: iss.id, process: process, status: iss.status||'', due: dueDate||'' });
    });

    // Resolve CC lists
    const users = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('Users') : [];
    const cc = users.filter(u => u.role==='Auditor' || u.role==='AuditManager').map(u => u.email).filter(Boolean);

    // Send emails
    Object.keys(byOwner).forEach(function(owner){
      const rows = byOwner[owner];
      const html = buildOwnerReminderHtml_(rows, appUrl);
      const subject = 'Monthly Reminder: Open Audit Issues';
      const body = 'Please view this message in HTML.';
      try{
        MailApp.sendEmail({ to: owner, cc: cc.join(','), subject: subject, htmlBody: html, body: body, name: cfg.SYSTEM_EMAIL || 'Audit System' });
      }catch(e){ Logger.log('Mail error for '+owner+': '+e); }
    });

    logAction('Reminders', 'monthly', 'issues_open_by_owner', {}, { recipients: Object.keys(byOwner).length, totalOpen: openIssues.length });
    return { success:true, recipients: Object.keys(byOwner).length, totalOpen: openIssues.length };
  }catch(e){ Logger.log('sendMonthlyOpenIssuesReminders error: '+e); return { success:false, error:e.message }; }
}

function buildOwnerReminderHtml_(rows, appUrl){
  const table = ['<table style="border-collapse:collapse;width:100%;font-family:Arial;font-size:13px">',
    '<thead><tr>',
    '<th style="border:1px solid #ddd;padding:8px;text-align:left">Issue ID</th>',
    '<th style="border:1px solid #ddd;padding:8px;text-align:left">Process</th>',
    '<th style="border:1px solid #ddd;padding:8px;text-align:left">Status</th>',
    '<th style="border:1px solid #ddd;padding:8px;text-align:left">Action Plan Due Date</th>',
    '</tr></thead><tbody>'];
  rows.forEach(function(r){
    table.push('<tr><td style="border:1px solid #ddd;padding:8px">'+(r.id||'')+'</td><td style="border:1px solid #ddd;padding:8px">'+(r.process||'')+'</td><td style="border:1px solid #ddd;padding:8px">'+(r.status||'')+'</td><td style="border:1px solid #ddd;padding:8px">'+(r.due||'')+'</td></tr>');
  });
  table.push('</tbody></table>');
  const link = '<p><a href="'+appUrl+'" style="color:#1a237e;text-decoration:none">Open Audit Management System</a></p>';
  return '<div><p>Dear Process Owner,</p><p>This is a friendly reminder of your open audit issues. Please review and take action.</p>'+table.join('')+link+'<p>Regards,<br>Audit Team</p></div>';
}
