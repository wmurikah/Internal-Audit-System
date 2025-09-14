/**
 * ISSUE TRACKING - Anomaly Detection & Resolution
 */

function createIssue(issueData) {
  const user = getCurrentUser();
  issueData.created_by = user.email;
  issueData.status = 'Open';
  return addRow('Issues', issueData);
}

function updateIssue(id, updates) {
  return updateRow('Issues', id, updates);
}

function listIssues() {
  const user = getCurrentUser();
  const issues = getSheetData('Issues');
  
  if (user.permissions.includes('all')) {
    return issues;
  } else if (user.role === 'Auditee') {
    return issues.filter(i => i.owner_email === user.email);
  }
  
  return issues;
}

function resolveIssue(id) {
  return updateRow('Issues', id, {
    status: 'Resolved',
    resolved_at: new Date()
  });
}

function escalateIssue(id) {
  return updateRow('Issues', id, {
    risk_rating: 'High',
    escalated: true,
    escalated_at: new Date()
  });
}
