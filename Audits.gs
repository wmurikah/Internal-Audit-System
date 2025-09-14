/**
 * AUDIT MANAGEMENT - Galactic Compliance Operations
 */

function createAudit(auditData) {
  const user = getCurrentUser();
  auditData.created_by = user.email;
  auditData.status = auditData.status || 'Planning';
  return addRow('Audits', auditData);
}

function updateAudit(id, updates) {
  return updateRow('Audits', id, updates);
}

function listAudits() {
  const user = getCurrentUser();
  const audits = getSheetData('Audits');
  
  // Filter based on role
  if (user.role === 'AuditManager' || user.role === 'Board') {
    return audits;
  } else if (user.role === 'Auditor') {
    return audits.filter(a => a.manager_email === user.email);
  } else {
    // Auditees see audits where they have issues
    const issues = getSheetData('Issues');
    const userIssues = issues.filter(i => i.owner_email === user.email);
    const auditIds = [...new Set(userIssues.map(i => i.audit_id))];
    return audits.filter(a => auditIds.includes(a.id));
  }
}

function getAudit(id) {
  return getSheetData('Audits').find(a => a.id === id);
}

function completeAudit(id) {
  return updateRow('Audits', id, { 
    status: 'Completed',
    end_date: new Date()
  });
}
