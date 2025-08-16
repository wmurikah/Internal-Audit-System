/**
 * Reports and PDF Exports (Apps Script)
 * - Server-side PDF generation for Work Papers (single and bulk)
 * - Board/Senior Management executive summaries (aggregated metrics)
 * - Uses HtmlService templating to build HTML and converts to PDF via Blob.getAs
 * - Files are saved to the Evidence folder unless a dedicated Reports folder is configured later
 */

/**
 * Generate a PDF for a single Work Paper and save it to Drive.
 * @param {string} id Work Paper ID (e.g., WP001)
 * @return {{success:boolean, url?:string, fileId?:string, error?:string}}
 */
function generateWorkPaperPDF(id) {
  try {
    if (!id) throw new Error('Work Paper id is required');
    var wp = getRowById('WorkPapers', id);
    if (!wp) throw new Error('Work Paper not found: ' + id);

    var html = buildWorkPaperPdfHtml_(wp);
    var blob = Utilities.newBlob(html, 'text/html', (wp.id || id) + '.html').getAs('application/pdf');
    var fileName = (wp.id || id) + ' - Work Paper.pdf';
    var folderId = (typeof REPORTS_FOLDER_ID !== 'undefined' && REPORTS_FOLDER_ID) ? REPORTS_FOLDER_ID : (typeof EVIDENCE_FOLDER_ID !== 'undefined' ? EVIDENCE_FOLDER_ID : null);
    var file;
    if (folderId) {
      var folder = DriveApp.getFolderById(folderId);
      file = folder.createFile(blob).setName(fileName);
    } else {
      file = DriveApp.createFile(blob).setName(fileName);
    }

    // Log
    try { logAction('WorkPapers', id, 'export_pdf', {}, { fileId: file.getId(), url: file.getUrl() }); } catch (e) {}

    return { success: true, url: file.getUrl(), fileId: file.getId() };
  } catch (e) {
    Logger.log('generateWorkPaperPDF error: ' + e);
    return { success: false, error: e.message };
  }
}

/**
 * Bulk-generate PDFs for multiple Work Papers.
 * @param {string[]} ids Array of Work Paper IDs
 * @return {{success:boolean, files:Array<{id:string,url:string,fileId:string}>, error?:string}}
 */
function bulkGenerateWorkPapersPDF(ids) {
  try {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids array is required');
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      try {
        var res = generateWorkPaperPDF(id);
        if (res && res.success) {
          out.push({ id: id, url: res.url, fileId: res.fileId });
        }
      } catch (inner) {
        Logger.log('bulkGenerateWorkPapersPDF inner error for ' + id + ': ' + inner);
      }
    }
    return { success: true, files: out };
  } catch (e) {
    Logger.log('bulkGenerateWorkPapersPDF error: ' + e);
    return { success: false, error: e.message, files: [] };
  }
}

/**
 * Build minimal, clean HTML for Work Paper PDF.
 * This avoids creating a separate HTML template file to keep footprint small.
 */
function buildWorkPaperPdfHtml_(wp) {
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]); }); }
  var style = [
    'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;}',
    'h1{font-size:20px;margin:0 0 8px 0;}',
    'h2{font-size:14px;margin:16px 0 8px 0;border-bottom:1px solid #ddd;padding-bottom:4px;color:#1a237e;}',
    '.meta{font-size:11px;color:#555;}',
    '.grid{display:grid;grid-template-columns:180px 1fr;gap:6px;}',
    '.row{padding:4px 0;border-bottom:1px dashed #eee;}',
    '.label{color:#555;}',
    '.value{white-space:pre-wrap;}',
    '.footer{margin-top:16px;font-size:10px;color:#777;border-top:1px solid #eee;padding-top:8px;}'
  ].join('');
  function row(label, value){ return '<div class="row"><div class="label"><strong>'+esc(label)+'</strong></div><div class="value">'+esc(value||'')+'</div></div>'; }

  var html = '' +
    '<html><head><meta charset="UTF-8"><title>'+esc(wp.id)+' Work Paper</title><style>'+style+'</style></head><body>'+
    '<h1>Work Paper: '+esc(wp.id)+'</h1>'+
    '<div class="meta">Audit: '+esc(wp.audit_id)+' · Title: '+esc(wp.audit_title)+' · Year: '+esc(wp.year)+' · Affiliate: '+esc(wp.affiliate)+'</div>'+
    '<h2>A. Context</h2><div class="grid">'+
      row('Process Area', wp.process_area)+
      row('Objective', wp.objective)+
    '</div>'+
    '<h2>B. Risks</h2><div>'+esc(wp.risks)+'</div>'+
    '<h2>C. Controls</h2><div>'+esc(wp.controls)+'</div>'+
    '<h2>D. Testing Objectives & Procedures</h2><div class="grid">'+
      row('Test Objective', wp.test_objective)+
      row('Proposed Tests', wp.proposed_tests)+
    '</div>'+
    '<h2>E. Observations</h2><div class="grid">'+
      row('Observation', wp.observation)+
      row('Observation Risk', wp.observation_risk)+
      row('Reportable', wp.reportable)+
    '</div>'+
    '<h2>F. Review</h2><div class="grid">'+
      row('Status', wp.status)+
      row('Reviewer', wp.reviewer_email)+
      row('Reviewer Comments', wp.reviewer_comments)+
      row('Submitted At', wp.submitted_at)+
      row('Reviewed At', wp.reviewed_at)+
    '</div>'+
    '<div class="footer">Generated on '+(new Date()).toISOString()+' by Audit Management System</div>'+
    '</body></html>';
  return html;
}

/** Executive summary for Board/SeniorManagement */
function getExecutiveSummary(){
  try{
    const user = getCurrentUser();
    if (!user || !user.authenticated) throw new Error('Not authenticated');
    // No WorkPapers exposure here; aggregate from Audits, Issues, Actions, RiskRegister
    const audits = (typeof getSheetDataDirect==='function')? getSheetDataDirect('Audits') : [];
    const issues = (typeof getSheetDataDirect==='function')? getSheetDataDirect('Issues') : [];
    const actions = (typeof getSheetDataDirect==='function')? getSheetDataDirect('Actions') : [];
    const risks = (typeof getSheetDataDirect==='function')? getSheetDataDirect('RiskRegister') : [];

    const activeAudits = audits.filter(a=> a.status && !['Completed','Closed'].includes(String(a.status))).length;
    const riskDist = { Extreme:0, High:0, Medium:0, Low:0 };
    issues.forEach(i=>{ if (riskDist.hasOwnProperty(i.risk_rating)) riskDist[i.risk_rating]++; });
    const highRiskIssues = issues.filter(i=> ['Extreme','High'].includes(i.risk_rating)).length;
    const completedActions = actions.filter(a=> a.status==='Completed').length;
    const openIssues = issues.filter(i=> i.status && !['Resolved','Closed'].includes(String(i.status))).length;

    // Trend approximation: last 3 months issue creation
    const now = new Date(); const byMonth = {};
    for (let k=0;k<3;k++){ const d=new Date(now.getFullYear(), now.getMonth()-k, 1); const key = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); byMonth[key]=0; }
    issues.forEach(i=>{ try{ const d=new Date(i.created_at); const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); if (byMonth.hasOwnProperty(key)) byMonth[key]++; }catch(e){} });

    return { success:true, summary:{ activeAudits, openIssues, completedActions, highRiskIssues, riskDistribution: riskDist, issueTrends: byMonth, totalRisks: risks.length } };
  }catch(e){ Logger.log('getExecutiveSummary error: '+e); return { success:false, error:e.message }; }
}

/** SeniorManagement/Board friendly HTML summary */
function buildExecutiveSummaryHtml(){
  try{
    const res = getExecutiveSummary(); if (!res || !res.success) throw new Error(res && res.error ? res.error : 'Failed summary');
    const s = res.summary || {};
    const esc = function(x){ return String(x==null?'':x).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]); }); };
    const rows = Object.entries(s.riskDistribution||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    const trends = Object.entries(s.issueTrends||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
    const html = `<html><head><meta charset='UTF-8'><title>Executive Summary</title><style>body{font-family:Arial;margin:24px;color:#111;}h1{margin:0 0 8px}h2{margin:16px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px;color:#1a237e;}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px;text-align:left}</style></head><body>
      <h1>Executive Summary</h1>
      <div>Generated on ${esc((new Date()).toISOString())}</div>
      <h2>Key Metrics</h2>
      <table><tbody>
        <tr><td>Active Audits</td><td>${esc(s.activeAudits)}</td></tr>
        <tr><td>Open Issues</td><td>${esc(s.openIssues)}</td></tr>
        <tr><td>Completed Actions</td><td>${esc(s.completedActions)}</td></tr>
        <tr><td>High-Risk Issues</td><td>${esc(s.highRiskIssues)}</td></tr>
        <tr><td>Total Risks (Register)</td><td>${esc(s.totalRisks)}</td></tr>
      </tbody></table>
      <h2>Risk Distribution</h2>
      <table><thead><tr><th>Rating</th><th>Count</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Issue Trends (Last 3 Months)</h2>
      <table><thead><tr><th>Month</th><th>New Issues</th></tr></thead><tbody>${trends}</tbody></table>
    </body></html>`;
    return { success:true, html };
  }catch(e){ Logger.log('buildExecutiveSummaryHtml error: '+e); return { success:false, error:e.message }; }
}

/** Export Executive Summary to PDF */
function exportExecutiveSummaryPDF(){
  try{
    const r = buildExecutiveSummaryHtml(); if (!r || !r.success) throw new Error(r && r.error ? r.error : 'Failed to build summary');
    const blob = Utilities.newBlob(r.html, 'text/html', 'ExecutiveSummary.html').getAs('application/pdf');
    const file = DriveApp.createFile(blob).setName('Executive_Summary.pdf');
    try{ logAction('Reports','exec_summary','export_pdf',{}, {fileId:file.getId(), url:file.getUrl()}); }catch(e){}
    return { success:true, url: file.getUrl(), fileId: file.getId() };
  }catch(e){ Logger.log('exportExecutiveSummaryPDF error: '+e); return { success:false, error:e.message }; }
}