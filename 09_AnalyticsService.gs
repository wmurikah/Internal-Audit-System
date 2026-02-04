// 09_AnalyticsService.gs - Analytics Data Aggregation, Trend Analysis, Performance Metrics

function getAnalyticsData(year, user) {
  year = year || new Date().getFullYear();

  try {
    // Get all work papers for the year
    const wpSheet = getSheet(SHEETS.WORK_PAPERS);
    const wpData = wpSheet.getDataRange().getValues();
    const wpHeaders = wpData[0];

    const yearIdx = wpHeaders.indexOf('year');
    const statusIdx = wpHeaders.indexOf('status');
    const riskIdx = wpHeaders.indexOf('risk_rating');
    const affiliateIdx = wpHeaders.indexOf('affiliate_code');
    const createdIdx = wpHeaders.indexOf('created_at');
    const preparedByIdx = wpHeaders.indexOf('prepared_by_id');
    const preparedByNameIdx = wpHeaders.indexOf('prepared_by_name');
    const approvedDateIdx = wpHeaders.indexOf('approved_date');
    const submittedDateIdx = wpHeaders.indexOf('submitted_date');
    const wpIdIdx = wpHeaders.indexOf('work_paper_id');
    const titleIdx = wpHeaders.indexOf('observation_title');

    // Get all action plans
    const apSheet = getSheet(SHEETS.ACTION_PLANS);
    const apData = apSheet.getDataRange().getValues();
    const apHeaders = apData[0];

    const apIdIdx = apHeaders.indexOf('action_plan_id');
    const apWpIdIdx = apHeaders.indexOf('work_paper_id');
    const apStatusIdx = apHeaders.indexOf('status');
    const apDueDateIdx = apHeaders.indexOf('due_date');
    const apOwnerNamesIdx = apHeaders.indexOf('owner_names');
    const apDescIdx = apHeaders.indexOf('action_description');
    const apDaysOverdueIdx = apHeaders.indexOf('days_overdue');
    const apCreatedIdx = apHeaders.indexOf('created_at');
    const apImplementedDateIdx = apHeaders.indexOf('implemented_date');

    // Process work papers
    const workPapers = {
      total: 0,
      byStatus: {},
      byRisk: {},
      byAffiliate: {},
      byMonth: {}
    };

    const highRiskFindings = [];
    const auditorStats = {};

    for (let i = 1; i < wpData.length; i++) {
      const row = wpData[i];
      const wpYear = row[yearIdx];

      // Filter by year if specified
      if (year && wpYear && parseInt(wpYear) !== parseInt(year)) continue;

      workPapers.total++;

      // By Status
      const status = row[statusIdx] || 'Unknown';
      workPapers.byStatus[status] = (workPapers.byStatus[status] || 0) + 1;

      // By Risk
      const risk = row[riskIdx] || 'Not Rated';
      workPapers.byRisk[risk] = (workPapers.byRisk[risk] || 0) + 1;

      // By Affiliate
      const affiliate = row[affiliateIdx] || 'Unknown';
      workPapers.byAffiliate[affiliate] = (workPapers.byAffiliate[affiliate] || 0) + 1;

      // By Month
      const created = row[createdIdx];
      if (created) {
        const month = new Date(created).toLocaleDateString('en-US', { month: 'short' });
        workPapers.byMonth[month] = (workPapers.byMonth[month] || 0) + 1;
      }

      // High risk findings
      if (risk === 'Extreme' || risk === 'High') {
        const createdDate = created ? new Date(created) : null;
        const daysOpen = createdDate ? Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24)) : 0;

        highRiskFindings.push({
          work_paper_id: row[wpIdIdx],
          observation_title: row[titleIdx],
          risk_rating: risk,
          status: status,
          days_open: daysOpen
        });
      }

      // Auditor stats
      const preparerId = row[preparedByIdx];
      const preparerName = row[preparedByNameIdx];
      if (preparerId) {
        if (!auditorStats[preparerId]) {
          auditorStats[preparerId] = {
            id: preparerId,
            name: preparerName || 'Unknown',
            total: 0,
            draft: 0,
            submitted: 0,
            approved: 0,
            totalDaysToApprove: 0,
            approvedCount: 0
          };
        }
        auditorStats[preparerId].total++;
        if (status === 'Draft') auditorStats[preparerId].draft++;
        if (status === 'Submitted' || status === 'Under Review') auditorStats[preparerId].submitted++;
        if (status === 'Approved' || status === 'Sent to Auditee') {
          auditorStats[preparerId].approved++;
          // Calculate days to approve
          const submitted = row[submittedDateIdx];
          const approved = row[approvedDateIdx];
          if (submitted && approved) {
            const days = Math.floor((new Date(approved) - new Date(submitted)) / (1000 * 60 * 60 * 24));
            auditorStats[preparerId].totalDaysToApprove += days;
            auditorStats[preparerId].approvedCount++;
          }
        }
      }
    }

    // Process action plans
    const actionPlans = {
      total: 0,
      overdue: 0,
      implemented: 0,
      verified: 0,
      byStatus: {},
      aging: {
        '0-30 days': 0,
        '31-60 days': 0,
        '61-90 days': 0,
        '91-180 days': 0,
        '180+ days': 0
      }
    };

    const overdueActionPlans = [];
    const monthlyTrends = {};

    for (let i = 1; i < apData.length; i++) {
      const row = apData[i];
      actionPlans.total++;

      const status = row[apStatusIdx] || 'Unknown';
      actionPlans.byStatus[status] = (actionPlans.byStatus[status] || 0) + 1;

      if (status === 'Implemented') actionPlans.implemented++;
      if (status === 'Verified') actionPlans.verified++;

      const daysOverdue = row[apDaysOverdueIdx] || 0;
      if (daysOverdue > 0 || status === 'Overdue') {
        actionPlans.overdue++;
        overdueActionPlans.push({
          action_plan_id: row[apIdIdx],
          action_description: row[apDescIdx],
          owner_names: row[apOwnerNamesIdx],
          days_overdue: daysOverdue,
          due_date: row[apDueDateIdx]
        });
      }

      // Aging calculation
      const created = row[apCreatedIdx];
      if (created) {
        const age = Math.floor((new Date() - new Date(created)) / (1000 * 60 * 60 * 24));
        if (age <= 30) actionPlans.aging['0-30 days']++;
        else if (age <= 60) actionPlans.aging['31-60 days']++;
        else if (age <= 90) actionPlans.aging['61-90 days']++;
        else if (age <= 180) actionPlans.aging['91-180 days']++;
        else actionPlans.aging['180+ days']++;
      }

      // Monthly closure trends
      const implementedDate = row[apImplementedDateIdx];
      if (implementedDate) {
        const month = new Date(implementedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        monthlyTrends[month] = (monthlyTrends[month] || 0) + 1;
      }
    }

    // Calculate implementation rate
    actionPlans.implementationRate = actionPlans.total > 0
      ? Math.round(((actionPlans.implemented + actionPlans.verified) / actionPlans.total) * 100)
      : 0;

    // Build monthly trends array
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = new Date().getMonth();
    const trendsArray = [];

    for (let i = 5; i >= 0; i--) {
      const monthIdx = (currentMonth - i + 12) % 12;
      const month = monthNames[monthIdx];
      trendsArray.push({
        month: month,
        workPapers: workPapers.byMonth[month] || 0,
        actionPlansClosed: monthlyTrends[`${year} ${month}`] || monthlyTrends[month] || 0
      });
    }

    // Auditor performance array
    const auditorPerformance = Object.values(auditorStats).map(a => ({
      name: a.name,
      total: a.total,
      draft: a.draft,
      submitted: a.submitted,
      approved: a.approved,
      avgDaysToApprove: a.approvedCount > 0 ? Math.round(a.totalDaysToApprove / a.approvedCount) : null
    })).sort((a, b) => b.total - a.total);

    // Sort overdue by days overdue
    overdueActionPlans.sort((a, b) => b.days_overdue - a.days_overdue);

    // Sort high risk by days open
    highRiskFindings.sort((a, b) => b.days_open - a.days_open);

    return sanitizeForClient({
      success: true,
      data: {
        workPapers: workPapers,
        actionPlans: actionPlans,
        trends: {
          monthly: trendsArray,
          lastMonth: trendsArray[trendsArray.length - 2] || {},
          thisMonth: trendsArray[trendsArray.length - 1] || {}
        },
        highRiskFindings: highRiskFindings.slice(0, 20),
        overdueActionPlans: overdueActionPlans.slice(0, 20),
        auditorPerformance: auditorPerformance.slice(0, 15)
      }
    });

  } catch (error) {
    console.error('Analytics error:', error);
    return { success: false, error: error.message };
  }
}

function getUserStats() {
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const activeIdx = headers.indexOf('is_active');
  const lockedIdx = headers.indexOf('locked_until');

  let total = 0, active = 0, locked = 0;
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    total++;
    if (isActive(data[i][activeIdx])) active++;
    const lockedUntil = data[i][lockedIdx];
    if (lockedUntil && new Date(lockedUntil) > now) locked++;
  }

  return sanitizeForClient({ total, active, locked, inactive: total - active });
}

/**
 * Update role permissions
 */
function updatePermissions(roleCode, permissions, user) {
  if (user.role_code !== ROLES.SUPER_ADMIN && user.role_code !== 'SUPER_ADMIN') {
    return { success: false, error: 'Permission denied' };
  }

  const sheet = getSheet(SHEETS.PERMISSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const roleIdx = headers.indexOf('role_code');
  const moduleIdx = headers.indexOf('module');
  const createIdx = headers.indexOf('can_create');
  const readIdx = headers.indexOf('can_read');
  const updateIdx = headers.indexOf('can_update');
  const deleteIdx = headers.indexOf('can_delete');
  const approveIdx = headers.indexOf('can_approve');
  const exportIdx = headers.indexOf('can_export');

  // Update or insert each module's permissions
  Object.entries(permissions).forEach(([module, perms]) => {
    let found = false;
    
    // Try to find existing row
    for (let i = 1; i < data.length; i++) {
      if (data[i][roleIdx] === roleCode && data[i][moduleIdx] === module) {
        // Update existing row
        if (createIdx >= 0) sheet.getRange(i + 1, createIdx + 1).setValue(perms.can_create === true);
        if (readIdx >= 0) sheet.getRange(i + 1, readIdx + 1).setValue(perms.can_read === true);
        if (updateIdx >= 0) sheet.getRange(i + 1, updateIdx + 1).setValue(perms.can_update === true);
        if (deleteIdx >= 0) sheet.getRange(i + 1, deleteIdx + 1).setValue(perms.can_delete === true);
        if (approveIdx >= 0) sheet.getRange(i + 1, approveIdx + 1).setValue(perms.can_approve === true);
        if (exportIdx >= 0) sheet.getRange(i + 1, exportIdx + 1).setValue(perms.can_export === true);
        found = true;
        console.log('Updated permissions for', roleCode, module);
        break;
      }
    }
    
    // If not found, insert new row
    if (!found) {
      const newRow = new Array(headers.length).fill('');
      newRow[roleIdx] = roleCode;
      newRow[moduleIdx] = module;
      if (createIdx >= 0) newRow[createIdx] = perms.can_create === true;
      if (readIdx >= 0) newRow[readIdx] = perms.can_read === true;
      if (updateIdx >= 0) newRow[updateIdx] = perms.can_update === true;
      if (deleteIdx >= 0) newRow[deleteIdx] = perms.can_delete === true;
      if (approveIdx >= 0) newRow[approveIdx] = perms.can_approve === true;
      if (exportIdx >= 0) newRow[exportIdx] = perms.can_export === true;
      sheet.appendRow(newRow);
      console.log('Inserted new permissions for', roleCode, module);
    }
  });

  // Invalidate ALL permission caches to ensure changes take effect immediately
  try {
    const cache = CacheService.getScriptCache();
    // Clear cache for this specific role
    cache.remove('perm_' + roleCode);
    // Clear caches for all common roles to be safe
    const allRoles = ['SUPER_ADMIN', 'SENIOR_AUDITOR', 'JUNIOR_STAFF', 'AUDITEE', 'MANAGEMENT', 'AUDITOR', 'UNIT_MANAGER', 'BOARD', 'EXTERNAL_AUDITOR', 'OBSERVER', 'SENIOR_MGMT'];
    allRoles.forEach(r => {
      cache.remove('perm_' + r);
    });
    console.log('All permission caches invalidated');
  } catch (e) {
    console.warn('Failed to invalidate cache:', e);
  }

  logAuditEvent('UPDATE_PERMISSIONS', 'ROLE', roleCode, null, permissions, user.user_id, user.email);

  return { success: true, message: 'Permissions updated. Users must refresh or re-login to see changes.' };
}

/**
 * Get system configuration values
 */
function getSystemConfigValues() {
  const keys = [
    'SYSTEM_NAME',
    'SESSION_TIMEOUT_HOURS',
    'PASSWORD_MIN_LENGTH',
    'MAX_LOGIN_ATTEMPTS',
    'AUDIT_FILES_FOLDER_ID'
  ];

  const config = {};
  keys.forEach(key => {
    config[key] = getConfigValue(key);
  });

  return sanitizeForClient(config);
}

/**
 * Save system configuration values
 */
function saveSystemConfigValues(config, user) {
  if (user.role_code !== ROLES.SUPER_ADMIN) {
    return { success: false, error: 'Permission denied' };
  }

  Object.entries(config).forEach(([key, value]) => {
    setConfigValue(key, value);
  });

  // Clear config cache
  Cache.remove('config_all');

  logAuditEvent('UPDATE_CONFIG', 'CONFIG', 'SYSTEM', null, config, user.user_id, user.email);

  return { success: true };
}

/**
 * Get audit log entries
 */
function getAuditLogs(actionFilter, page, pageSize) {
  const sheet = getSheet(SHEETS.AUDIT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  page = page || 1;
  pageSize = pageSize || 25;

  const logs = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = data[i];
    const log = {};
    headers.forEach((h, idx) => log[h] = row[idx]);

    // Filter by action if specified
    if (actionFilter && log.action !== actionFilter) continue;

    logs.push(log);
  }

  // Paginate
  const start = (page - 1) * pageSize;
  return sanitizeForClient(logs.slice(start, start + pageSize));
}

/**
 * Get audit log count
 */
function getAuditLogCount(actionFilter) {
  const sheet = getSheet(SHEETS.AUDIT_LOG);
  if (!sheet || sheet.getLastRow() < 2) return 0;

  if (!actionFilter) {
    return sheet.getLastRow() - 1;
  }

  // Count with filter
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const actionIdx = headers.indexOf('action');

  let count = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i][actionIdx] === actionFilter) count++;
  }

  return count;
}

/**
 * Sanitize object for safe transport to browser via google.script.run
 * Converts Date objects to ISO strings and removes undefined values
 */
function sanitizeForClient(obj) {
  return JSON.parse(JSON.stringify(obj, function (key, value) {
    // Convert Date objects to ISO strings (Dates break postMessage)
    if (value instanceof Date) {
      return value.toISOString();
    }
    
    // Replace undefined with null (undefined breaks transport)
    if (value === undefined) {
      return null;
    }
    
    return value;
  }));
}
