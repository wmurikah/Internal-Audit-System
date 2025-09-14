/**
 * QUANTUM DASHBOARD - Real-time Analytics
 */

function getDashboardData() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('dashboard_data');
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const data = computeDashboard();
  cache.put('dashboard_data', JSON.stringify(data), 300); // 5 min cache
  return data;
}

function computeDashboard() {
  const audits = getSheetData('Audits');
  const issues = getSheetData('Issues');
  const actions = getSheetData('Actions');
  const risks = getSheetData('RiskRegister');
  
  const today = new Date();
  
  // Calculate metrics
  const activeAudits = audits.filter(a => 
    ['Planning', 'In Progress'].includes(a.status)
  ).length;
  
  const openIssues = issues.filter(i => 
    i.status !== 'Resolved' && i.status !== 'Closed'
  ).length;
  
  const overdueActions = actions.filter(a => {
    if (a.status === 'Completed') return false;
    if (!a.due_date) return false;
    return new Date(a.due_date) < today;
  }).length;
  
  const completedActions = actions.filter(a => 
    a.status === 'Completed'
  ).length;
  
  // Risk distribution
  const riskDistribution = { Extreme: 0, High: 0, Medium: 0, Low: 0 };
  issues.forEach(issue => {
    if (riskDistribution[issue.risk_rating] !== undefined) {
      riskDistribution[issue.risk_rating]++;
    }
  });
  
  // Business unit analysis
  const issuesByUnit = {};
  const actionsByUnit = {};
  
  audits.forEach(audit => {
    const unit = audit.business_unit;
    if (!unit) return;
    
    issuesByUnit[unit] = issues.filter(i => i.audit_id === audit.id).length;
    
    const auditIssues = issues.filter(i => i.audit_id === audit.id);
    const issueIds = auditIssues.map(i => i.id);
    actionsByUnit[unit] = actions.filter(a => issueIds.includes(a.issue_id)).length;
  });
  
  // Recent activity
  const recentAudits = audits
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  
  return {
    metrics: {
      activeAudits,
      openIssues,
      overdueActions,
      completedActions
    },
    charts: {
      riskDistribution,
      issuesByUnit,
      actionsByUnit,
      riskHeatMap: getRiskHeatMap()
    },
    recentAudits,
    timestamp: new Date().toISOString()
  };
}

function refreshDashboard() {
  CacheService.getScriptCache().remove('dashboard_data');
  return getDashboardData();
}
