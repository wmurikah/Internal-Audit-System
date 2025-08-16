/**
 * Evidence API (Apps Script)
 * - Secure server-side upload from base64 to Drive (EVIDENCE_FOLDER_ID)
 * - Persist metadata to Evidence sheet
 * - Lightweight listing by parent for UI hydration
 * - Enforce evidence on status change and review flow helpers
 */

/**
 * Upload evidence from base64 string.
 * @param {string} parentType - 'Audit' | 'Issue' | 'Action' | 'WorkPaper'
 * @param {string} parentId   - e.g., 'ISS001'
 * @param {string} fileName   - e.g., 'Policy.pdf'
 * @param {string} mimeType   - e.g., 'application/pdf'
 * @param {string} base64Data - raw base64 or data URL
 * @return {{success:boolean,id?:string,url?:string,record?:Object,error?:string}}
 */
function uploadEvidenceFromBase64(parentType, parentId, fileName, mimeType, base64Data) {
  try {
    if (!parentType || !parentId) throw new Error('Parent type and id are required');
    if (!fileName || !mimeType || !base64Data) throw new Error('File payload missing');

    // Enforce safe MIME types and extensions
    // Allow override from Settings.ALLOWED_EVIDENCE_MIME_TYPES if present
    var allowed = (function(){ try { var cfg = getConfig(); if (cfg && Array.isArray(cfg.ALLOWED_EVIDENCE_MIME_TYPES) && cfg.ALLOWED_EVIDENCE_MIME_TYPES.length){ return cfg.ALLOWED_EVIDENCE_MIME_TYPES.map(function(s){return String(s).toLowerCase();}); } } catch(e){} return ['application/pdf','image/png','image/jpeg','image/jpg','image/gif','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv']; })();
    if (allowed.indexOf(String(mimeType).toLowerCase()) === -1) {
      throw new Error('File type not allowed. Allowed: PDF, PNG/JPEG/GIF/WEBP, XLSX, CSV');
    }
    var okExt = /(\.pdf|\.png|\.jpe?g|\.gif|\.webp|\.xlsx|\.csv)$/i.test(String(fileName||''));
    if (!okExt) {
      throw new Error('File extension not allowed. Allowed: .pdf, .png, .jpg, .jpeg, .gif, .webp, .xlsx, .csv');
    }

    // Extract base64 payload if prefixed with data URL
    var payload = base64Data;
    var commaIdx = base64Data.indexOf(',');
    if (commaIdx > -1) payload = base64Data.substring(commaIdx + 1);

    var bytes = Utilities.base64Decode(payload);

    // Size enforcement (falls back to 10 MB if config not available)
    var maxMb = 10;
    try {
      if (typeof getDefaultConfig === 'function') {
        var cfg = getDefaultConfig();
        if (cfg && cfg.MAX_FILE_SIZE_MB) maxMb = cfg.MAX_FILE_SIZE_MB;
      }
    } catch (e) {}

    var sizeMb = bytes.length / (1024 * 1024);
    if (sizeMb > maxMb) throw new Error('File exceeds max size of ' + maxMb + ' MB');

    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    // Read evidence folder from Settings if available; fallback to constant
    var cfg2; try { cfg2 = getConfig(); } catch (e) {}
    var folderId = (cfg2 && cfg2.EVIDENCE_FOLDER_ID) ? cfg2.EVIDENCE_FOLDER_ID : EVIDENCE_FOLDER_ID;
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(blob);

    // Compute checksum (MD5)
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, bytes);
    var checksum = digest.map(function(b){ var v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');

    // Build record
    var id = generateEvidenceId_();
    var userEmail = (Session.getActiveUser() && Session.getActiveUser().getEmail()) || 'unknown@local';
    var now = new Date();

    var record = {
      id: id,
      parent_type: parentType,
      parent_id: parentId,
      file_name: fileName,
      drive_url: file.getUrl(),
      uploader_email: userEmail,
      uploaded_on: now,
      version: 1,
      checksum: checksum,
      status: 'Submitted',
      created_at: now
    };

    appendRecord_('Evidence', record);

    return { success: true, id: id, url: file.getUrl(), record: record };
  } catch (err) {
    Logger.log('uploadEvidenceFromBase64 error: ' + err);
    return { success: false, error: err.message };
  }
}

/**
 * List evidence records filtered by parent.
 * @param {string=} parentType
 * @param {string=} parentId
 * @param {number=} limit
 */
function listEvidence(parentType, parentId, limit) {
  try {
    var all = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('Evidence') : [];
    var filtered = all.filter(function(r){
      var ok = true;
      if (parentType) ok = ok && r.parent_type === parentType;
      if (parentId) ok = ok && r.parent_id === parentId;
      return ok;
    });
    if (limit && filtered.length > limit) filtered = filtered.slice(0, limit);
    return { success: true, items: filtered };
  } catch (e) {
    Logger.log('listEvidence error: ' + e);
    return { success: false, error: e.message, items: [] };
  }
}

function generateEvidenceId_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('Evidence');
  if (!sh) throw new Error('Evidence sheet missing');
  var lastRow = sh.getLastRow();
  var n = Math.max(0, lastRow - 1) + 1; // naive incremental fallback
  var id = 'EVD' + ('000' + n).slice(-3);
  // Try to ensure uniqueness by checking existing IDs
  var tries = 0;
  while (tries < 5) {
    var rng = sh.getRange(2, 1, Math.max(0, sh.getLastRow() - 1), 1).getValues().flat();
    if (rng.indexOf(id) === -1) break;
    n++;
    id = 'EVD' + ('000' + n).slice(-3);
    tries++;
  }
  return id;
}

function appendRecord_(sheetName, obj) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet ' + sheetName + ' not found');
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var row = headers.map(function(h){
    var v = obj.hasOwnProperty(h) ? obj[h] : '';
    if (v instanceof Date) return v;
    return v;
  });
  sh.appendRow(row);
}

/** Enforce evidence exists before certain status changes at server-side */
function requireEvidenceForStatusChange(entity, entityId, newStatus, actorEmail){
  try{
    const user = getCurrentUser();
    const role = user && user.role;
    const restricted = (role==='Auditor' || role==='Auditee');
    if (!restricted) return { ok: true };
    const parentType = (entity==='Issues')?'Issue':(entity==='Actions'?'Action':entity);
    const items = (typeof getSheetDataDirect==='function')? getSheetDataDirect('Evidence'): [];
    const acceptable = ['Submitted','AuditorAccepted','ManagerAccepted'];
    const has = items.some(ev => String(ev.parent_type)===String(parentType) && String(ev.parent_id)===String(entityId) && (!ev.status || acceptable.indexOf(String(ev.status))>-1));
    if (has) return { ok: true };
    return { ok: false, error: 'Evidence is required before changing status. Please upload evidence.' };
  }catch(e){ Logger.log('requireEvidenceForStatusChange error: '+e); return { ok:false, error:e.message }; }
}

/** Upload evidence from Blob (alternative to base64) */
function uploadEvidence(parentType, parentId, fileBlob, uploaderEmail){
  try{
    if (!parentType || !parentId) throw new Error('Parent type and id are required');
    if (!fileBlob) throw new Error('fileBlob is required');
    const cfg = getConfig();
    const folderId = (cfg && cfg.EVIDENCE_FOLDER_ID) ? cfg.EVIDENCE_FOLDER_ID : EVIDENCE_FOLDER_ID;
    const folder = DriveApp.getFolderById(folderId);
    const file = folder.createFile(fileBlob);
    const id = generateEvidenceId_();
    const now = new Date();
    const rec = { id, parent_type: parentType, parent_id: parentId, file_name: file.getName(), drive_url: file.getUrl(), uploader_email: uploaderEmail || (Session.getActiveUser().getEmail()||''), uploaded_on: now, version: 1, checksum: '', status: 'Submitted', created_at: now };
    appendRecord_('Evidence', rec);
    return { success:true, id, url: file.getUrl(), record: rec };
  }catch(e){ Logger.log('uploadEvidence error: '+e); return { success:false, error:e.message }; }
}

/** Generic review API determines status by reviewer role */
function reviewEvidence(evidenceId, decision, comment, reviewerEmail){
  try{
    const user = getCurrentUser();
    if (!user || !user.role) throw new Error('Not authenticated');
    const rec = getRowById('Evidence', evidenceId); if (!rec) throw new Error('Evidence not found');
    const isMgr = user.role==='AuditManager';
    const isAud = user.role==='Auditor';
    if (!isMgr && !isAud) throw new Error('Insufficient role to review');
    const accept = String(decision).toLowerCase()==='accept';
    if (isAud){ return reviewEvidenceByAuditor(evidenceId, accept?'Accept':'Reject', comment||''); }
    if (isMgr){ return managerReviewEvidence(evidenceId, accept?'Accept':'Reject', comment||''); }
    return { success:false, error:'Unsupported role' };
  }catch(e){ Logger.log('reviewEvidence error: '+e); return { success:false, error:e.message }; }
}

/** Alias to manager final decision per spec */
function managerFinalReview(evidenceId, decision, comment, managerEmail){
  return managerReviewEvidence(evidenceId, decision, comment);
}


/** Auditor reviews evidence: decision = 'Accept' | 'Reject' */
function reviewEvidenceByAuditor(evidenceId, decision, comment){
  try{
    if (!evidenceId) throw new Error('Evidence id required');
    var user = getCurrentUser();
    if (!user || (user.role!=='Auditor' && user.role!=='AuditManager')) throw new Error('Only Auditor or AuditManager can review at this step');
    var rec = getRowById('Evidence', evidenceId); if (!rec) throw new Error('Evidence not found');
    var status = (String(decision).toLowerCase()==='accept')?'AuditorAccepted':'AuditorRejected';
    var changes = { status: status, reviewer_email: user.email, review_comment: comment||'', reviewed_at: new Date() };
    updateRow('Evidence', evidenceId, changes);
    // Notify uploader on rejection
    try{ if (status==='AuditorRejected' && rec.uploader_email){ MailApp.sendEmail(rec.uploader_email, 'Evidence Rejected', 'Your evidence '+rec.file_name+' was rejected. Reason: '+(comment||'No reason provided')); } }catch(e){}
    return { success:true };
  }catch(e){ Logger.log('reviewEvidenceByAuditor error: '+e); return { success:false, error:e.message }; }
}

/** Audit Manager final review */
function managerReviewEvidence(evidenceId, decision, comment){
  try{
    if (!evidenceId) throw new Error('Evidence id required');
    var user = getCurrentUser();
    if (!user || user.role!=='AuditManager') throw new Error('Only AuditManager can make final decision');
    var rec = getRowById('Evidence', evidenceId); if (!rec) throw new Error('Evidence not found');
    var status = (String(decision).toLowerCase()==='accept')?'ManagerAccepted':'ManagerRejected';
    var changes = { manager_email: user.email, manager_decision: decision, manager_review_comment: comment||'', manager_reviewed_at: new Date(), status: status };
    updateRow('Evidence', evidenceId, changes);
    // Notify uploader on rejection with deep link
    try{ 
      if (status==='ManagerRejected' && rec.uploader_email){ 
        var appUrl = ScriptApp.getService().getUrl();
        var parent = (rec.parent_type||'')+ ' ' + (rec.parent_id||'');
        var body = 'Your evidence '+rec.file_name+' for '+parent+' was rejected by Audit Manager. Reason: '+(comment||'No reason provided')+"\n\n"+
                  'Open the system: '+appUrl;
        MailApp.sendEmail(rec.uploader_email, 'Evidence Rejected by Manager', body);
      } 
    }catch(e){}
    return { success:true };
  }catch(e){ Logger.log('managerReviewEvidence error: '+e); return { success:false, error:e.message }; }
}
