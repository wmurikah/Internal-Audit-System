/**
 * Risk Register Module (Apps Script)
 * Centralized registry of risks per business unit/affiliate
 * Only new file added as requested
 */

/** List risks with optional filters */
function listRisks(filters){
  filters = filters || {};
  var rows = (typeof getSheetDataDirect === 'function') ? getSheetDataDirect('RiskRegister') : [];
  if (filters.unit){ rows = rows.filter(function(r){ return String(r.unit||'') === String(filters.unit); }); }
  if (filters.owner_email){ var e = String(filters.owner_email||'').toLowerCase(); rows = rows.filter(function(r){ return String(r.owner_email||'').toLowerCase() === e; }); }
  if (filters.status){ rows = rows.filter(function(r){ return String(r.status||'') === String(filters.status); }); }
  return { success:true, items: rows };
}

/** Create a new risk entry */
function createRiskEntry(payload){
  var user = getCurrentUser();
  if (!user || !user.authenticated) throw new Error('Not authenticated');
  if (!payload) payload = {};
  if (!payload.unit) throw new Error('Unit is required');
  if (!payload.process) throw new Error('Process is required');
  if (!payload.risk_statement) throw new Error('Risk statement is required');
  payload.created_at = new Date();
  payload.updated_at = new Date();
  payload.owner_email = payload.owner_email || user.email;
  payload.status = payload.status || 'Open';
  payload.inherent_rating = payload.inherent_rating || 'Medium';
  payload.residual_risk = payload.residual_risk || '';
  // ID generation
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName('RiskRegister');
  if (!sh) throw new Error('RiskRegister sheet missing');
  var nextN = Math.max(0, sh.getLastRow()-1) + 1;
  payload.id = payload.id || ('RISK' + ('000' + nextN).slice(-3));
  var headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  var row = headers.map(function(h){ return payload.hasOwnProperty(h) ? payload[h] : ''; });
  sh.appendRow(row);
  logAction('RiskRegister', payload.id, 'create', {}, payload);
  return { success:true, id: payload.id, record: payload };
}

/** Update risk entry */
function updateRiskEntry(id, changes){
  if (!id) throw new Error('id required');
  changes = changes || {};
  changes.updated_at = new Date();
  return updateRow('RiskRegister', id, changes);
}

/** Link risk to a work paper (store WP ids in links column as CSV) */
function linkRiskToWorkPaper(riskId, workPaperId){
  var rr = getRowById('RiskRegister', riskId);
  if (!rr) throw new Error('Risk not found');
  var links = String(rr.links||'').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  if (links.indexOf(workPaperId) === -1){ links.push(workPaperId); }
  return updateRow('RiskRegister', riskId, { links: links.join(', ')});
}
