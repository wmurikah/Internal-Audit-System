/**
 * ENTERPRISE PERFORMANCE OPTIMIZER
 * Server-side caching and optimization for lightning-fast performance
 */

/**
 * High-performance cached data retrieval
 */
function getSheetDataCached(sheetName, cacheTTL = 300) {
  const cache = CacheService.getScriptCache();
  const cacheKey = `sheet_${sheetName}_v2`;
  
  // Try to get from cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      Logger.log(`⚡ Cache HIT for ${sheetName}: ${parsed.length} records`);
      return parsed;
    } catch (e) {
      Logger.log(`Cache parse error for ${sheetName}: ${e.message}`);
      // Fall through to fresh fetch
    }
  }
  
  // Cache miss - fetch from sheet
  const startTime = Date.now();
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(sheetName);
    
    if (!sheet || sheet.getLastRow() <= 1) {
      const emptyResult = [];
      cache.put(cacheKey, JSON.stringify(emptyResult), cacheTTL);
      return emptyResult;
    }
    
    // Optimized data reading
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    const data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = data[0];
    
    const result = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Skip completely empty rows
      if (row.every(cell => cell === '' || cell === null || cell === undefined)) {
        continue;
      }
      
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        const value = row[j];
        obj[headers[j]] = value instanceof Date ? 
          value.toISOString().split('T')[0] : 
          (value || '');
      }
      
      // Only include rows with valid IDs
      if (obj.id && obj.id !== '') {
        result.push(obj);
      }
    }
    
    // Cache the result
    cache.put(cacheKey, JSON.stringify(result), cacheTTL);
    
    const loadTime = Date.now() - startTime;
    Logger.log(`📊 Fresh fetch for ${sheetName}: ${result.length} records in ${loadTime}ms`);
    
    return result;
    
  } catch (error) {
    Logger.log(`Error fetching ${sheetName}: ${error.message}`);
    // Cache empty array on error to prevent repeated failures
    cache.put(cacheKey, JSON.stringify([]), 60); // 1 minute cache on error
    return [];
  }
}

/**
 * Optimized dashboard data with parallel loading
 */
function getDashboardDataOptimized() {
  const startTime = Date.now();
  
  try {
    const user = getCurrentUser();
    if (!user || !user.authenticated) {
      return getEmptyDashboard();
    }
    
    // Load all data in parallel using cached functions
    const [audits, issues, actions] = [
      getSheetDataCached('Audits'),
      getSheetDataCached('Issues'), 
      getSheetDataCached('Actions')
    ];
    
    // Apply role-based filtering in memory (fast)
    const filteredAudits = filterAuditsByRole(audits, user);
    const filteredIssues = filterIssuesByRole(issues, user);
    const filteredActions = filterActionsByRole(actions, user);
    
    // Calculate metrics efficiently
    const dashboardData = {
      activeAudits: countByStatus(filteredAudits, ['Planning', 'In Progress', 'Review']),
      openIssues: countByStatus(filteredIssues, ['Open', 'In Progress', 'Under Review']),
      completedActions: countByStatus(filteredActions, ['Completed']),
      overdueItems: calculateOverdueItems(filteredIssues, filteredActions),
      
      recentAudits: getRecentItems(filteredAudits, 5),
      riskDistribution: calculateRiskDistribution(filteredIssues),
      
      userRole: user.role,
      userPermissions: user.permissions,
      
      // Performance metrics for monitoring
      performance: {
        loadTime: Date.now() - startTime,
        dataPoints: filteredAudits.length + filteredIssues.length + filteredActions.length,
        cacheStatus: 'optimized'
      }
    };
    
    Logger.log(`🚀 Dashboard loaded in ${Date.now() - startTime}ms`);
    return dashboardData;
    
  } catch (error) {
    Logger.log(`Dashboard error: ${error.message}`);
    return {
      ...getEmptyDashboard(),
      error: error.message,
      performance: { loadTime: Date.now() - startTime, failed: true }
    };
  }
}

/**
 * Efficient role-based filtering functions
 */
function filterAuditsByRole(audits, user) {
  if (['AuditManager', 'SeniorManagement', 'Board'].includes(user.role)) {
    return audits;
  }
  
  if (user.role === 'Auditor') {
    return audits.filter(audit => 
      audit.manager_email && audit.manager_email.toLowerCase() === user.email.toLowerCase()
    );
  }
  
  if (user.role === 'Auditee') {
    // For auditees, show audits where they have related issues
    const userIssues = getSheetDataCached('Issues').filter(issue =>
      issue.owner_email && issue.owner_email.toLowerCase() === user.email.toLowerCase()
    );
    const auditIds = new Set(userIssues.map(issue => issue.audit_id));
    return audits.filter(audit => auditIds.has(audit.id));
  }
  
  return audits;
}

function filterIssuesByRole(issues, user) {
  if (['AuditManager', 'SeniorManagement', 'Board'].includes(user.role)) {
    return issues;
  }
  
  if (user.role === 'Auditee') {
    return issues.filter(issue => 
      issue.owner_email && issue.owner_email.toLowerCase() === user.email.toLowerCase()
    );
  }
  
  if (user.role === 'Auditor') {
    const userAudits = filterAuditsByRole(getSheetDataCached('Audits'), user);
    const auditIds = new Set(userAudits.map(audit => audit.id));
    return issues.filter(issue => auditIds.has(issue.audit_id));
  }
  
  return issues;
}

function filterActionsByRole(actions, user) {
  if (['AuditManager', 'SeniorManagement', 'Board'].includes(user.role)) {
    return actions;
  }
  
  if (user.role === 'Auditee') {
    return actions.filter(action => 
      action.assignee_email && action.assignee_email.toLowerCase() === user.email.toLowerCase()
    );
  }
  
  if (user.role === 'Auditor') {
    const userIssues = filterIssuesByRole(getSheetDataCached('Issues'), user);
    const issueIds = new Set(userIssues.map(issue => issue.id));
    return actions.filter(action => issueIds.has(action.issue_id));
  }
  
  return actions;
}

/**
 * Fast calculation functions
 */
function countByStatus(items, statuses) {
  return items.filter(item => item && item.status && statuses.includes(item.status)).length;
}

function calculateOverdueItems(issues, actions) {
  const today = new Date();
  let count = 0;
  
  // Count overdue issues
  for (const issue of issues) {
    if (issue && issue.due_date && issue.status && !['Resolved', 'Closed'].includes(issue.status)) {
      try {
        if (new Date(issue.due_date) < today) count++;
      } catch (e) { /* Skip invalid dates */ }
    }
  }
  
  // Count overdue actions
  for (const action of actions) {
    if (action && action.due_date && action.status !== 'Completed') {
      try {
        if (new Date(action.due_date) < today) count++;
      } catch (e) { /* Skip invalid dates */ }
    }
  }
  
  return count;
}

function calculateRiskDistribution(issues) {
  const distribution = { 'Extreme': 0, 'High': 0, 'Medium': 0, 'Low': 0 };
  
  for (const issue of issues) {
    if (issue && issue.risk_rating && distribution.hasOwnProperty(issue.risk_rating)) {
      distribution[issue.risk_rating]++;
    }
  }
  
  return distribution;
}

function getRecentItems(items, limit = 5) {
  return items
    .filter(item => item && item.id)
    .sort((a, b) => {
      try {
        const dateA = new Date(a.updated_at || a.created_at || 0);
        const dateB = new Date(b.updated_at || b.created_at || 0);
        return dateB - dateA;
      } catch (e) {
        return 0;
      }
    })
    .slice(0, limit)
    .map(item => ({
      id: item.id,
      title: item.title || 'Untitled',
      business_unit: item.business_unit || 'N/A',
      status: item.status || 'Unknown',
      updated_at: item.updated_at || item.created_at
    }));
}

function getEmptyDashboard() {
  return {
    activeAudits: 0,
    openIssues: 0,
    completedActions: 0,
    overdueItems: 0,
    recentAudits: [],
    riskDistribution: { 'Extreme': 0, 'High': 0, 'Medium': 0, 'Low': 0 },
    userRole: 'Guest',
    userPermissions: [],
    performance: { loadTime: 0, dataPoints: 0, cacheStatus: 'empty' }
  };
}

/**
 * Cache management functions
 */
function clearSystemCache() {
  const cache = CacheService.getScriptCache();
  cache.removeAll(['sheet_Audits_v2', 'sheet_Issues_v2', 'sheet_Actions_v2', 'sheet_Users_v2', 'sheet_WorkPapers_v2']);
  Logger.log('🧹 System cache cleared');
  return { success: true, message: 'Cache cleared successfully' };
}

function preWarmCache() {
  const startTime = Date.now();
  Logger.log('🔥 Pre-warming cache...');
  
  try {
    getSheetDataCached('Audits');
    getSheetDataCached('Issues');
    getSheetDataCached('Actions');
    getSheetDataCached('Users');
    getSheetDataCached('WorkPapers');
    
    const warmTime = Date.now() - startTime;
    Logger.log(`🔥 Cache pre-warmed in ${warmTime}ms`);
    return { success: true, warmTime };
  } catch (error) {
    Logger.log(`❌ Cache pre-warm failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
