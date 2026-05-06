// 09_AnalyticsService.gs - Analytics Data Aggregation, Trend Analysis, Performance Metrics

function getAnalyticsData(year, user) {
  year = year || new Date().getFullYear();

  try {
    // Get work papers for the year via filtered SQL
    var wpRows = tursoQuery_SQL(
      'SELECT * FROM work_papers WHERE year = ? AND deleted_at IS NULL',
      [year]
    );
    if (!wpRows || wpRows.length === 0) {
      return sanitizeForClient({ success: true, data: { workPapers: {total:0}, actionPlans: {total:0}, trends: {monthly:[]}, highRiskFindings: [], overdueActionPlans: [], auditorPerformance: [] } });
    }

    // Get action plans for the year (join via work_papers.year)
    var apRows = tursoQuery_SQL(
      'SELECT ap.* FROM action_plans ap' +
      ' INNER JOIN work_papers wp ON ap.work_paper_id = wp.work_paper_id' +
      ' WHERE wp.year = ? AND ap.deleted_at IS NULL',
      [year]
    );

    // Process work papers
    const workPapers = { total: 0, byStatus: {}, byRisk: {}, byAffiliate: {}, byMonth: {} };
    const highRiskFindings = [];
    const auditorStats = {};

    wpRows.forEach(function(row) {
      workPapers.total++;

      const status = row.status || 'Unknown';
      workPapers.byStatus[status] = (workPapers.byStatus[status] || 0) + 1;

      const risk = row.risk_rating || 'Not Rated';
      workPapers.byRisk[risk] = (workPapers.byRisk[risk] || 0) + 1;

      const affiliate = row.affiliate_code || 'Unknown';
      workPapers.byAffiliate[affiliate] = (workPapers.byAffiliate[affiliate] || 0) + 1;

      const created = row.created_at;
      if (created) {
        const month = new Date(created).toLocaleDateString('en-US', { month: 'short' });
        workPapers.byMonth[month] = (workPapers.byMonth[month] || 0) + 1;
      }

      if (risk === 'Extreme' || risk === 'High') {
        const createdDate = created ? new Date(created) : null;
        const daysOpen = createdDate ? Math.floor((new Date() - createdDate) / (1000 * 60 * 60 * 24)) : 0;
        highRiskFindings.push({
          work_paper_id:     row.work_paper_id,
          observation_title: row.observation_title,
          risk_rating:       risk,
          status:            status,
          days_open:         daysOpen
        });
      }

      const preparerId = row.prepared_by_id;
      if (preparerId) {
        if (!auditorStats[preparerId]) {
          auditorStats[preparerId] = {
            id: preparerId, name: row.prepared_by_name || 'Unknown',
            total: 0, draft: 0, submitted: 0, approved: 0,
            totalDaysToApprove: 0, approvedCount: 0
          };
        }
        auditorStats[preparerId].total++;
        if (status === 'Draft') auditorStats[preparerId].draft++;
        if (status === 'Submitted' || status === 'Under Review') auditorStats[preparerId].submitted++;
        if (status === 'Approved' || status === 'Sent to Auditee') {
          auditorStats[preparerId].approved++;
          if (row.submitted_date && row.approved_date) {
            const days = Math.floor((new Date(row.approved_date) - new Date(row.submitted_date)) / (1000 * 60 * 60 * 24));
            auditorStats[preparerId].totalDaysToApprove += days;
            auditorStats[preparerId].approvedCount++;
          }
        }
      }
    });

    // Process action plans
    const actionPlans = {
      total: 0, overdue: 0, implemented: 0, verified: 0,
      byStatus: {},
      aging: { '0-30 days': 0, '31-60 days': 0, '61-90 days': 0, '91-180 days': 0, '180+ days': 0 }
    };
    const overdueActionPlans = [];
    const monthlyTrends = {};

    apRows.forEach(function(row) {
      actionPlans.total++;

      const status = row.status || 'Unknown';
      actionPlans.byStatus[status] = (actionPlans.byStatus[status] || 0) + 1;

      if (status === 'Implemented') actionPlans.implemented++;
      if (status === 'Verified') actionPlans.verified++;

      const daysOverdue = row.days_overdue || 0;
      if (daysOverdue > 0 || status === 'Overdue') {
        actionPlans.overdue++;
        overdueActionPlans.push({
          action_plan_id:    row.action_plan_id,
          action_description: row.action_description,
          owner_names:       row.owner_names,
          days_overdue:      daysOverdue,
          due_date:          row.due_date
        });
      }

      const created = row.created_at;
      if (created) {
        const age = Math.floor((new Date() - new Date(created)) / (1000 * 60 * 60 * 24));
        if (age <= 30)       actionPlans.aging['0-30 days']++;
        else if (age <= 60)  actionPlans.aging['31-60 days']++;
        else if (age <= 90)  actionPlans.aging['61-90 days']++;
        else if (age <= 180) actionPlans.aging['91-180 days']++;
        else                 actionPlans.aging['180+ days']++;
      }

      if (row.implemented_date) {
        const month = new Date(row.implemented_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        monthlyTrends[month] = (monthlyTrends[month] || 0) + 1;
      }
    });

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
  var users = tursoGetAll('05_Users');
  const now = new Date();
  let total = 0, active = 0, locked = 0;
  users.forEach(function(u) {
    total++;
    if (isActive(u.is_active)) active++;
    if (u.locked_until && new Date(u.locked_until) > now) locked++;
  });
  return sanitizeForClient({ total, active, locked, inactive: total - active });
}

/**
 * Update role permissions
 */
function updatePermissions(roleCode, permissions, user) {
  return { success: false, error: 'Permissions are system-managed and cannot be modified from the UI. Contact the system administrator.' };
}

/**
 * Returns dashboard data for the read-only Access Control tab
 */
function getAccessControlDashboardData() {
  try {
    var permissions = (typeof ROLE_PERMISSIONS !== 'undefined') ? ROLE_PERMISSIONS : {};
    var workflow = (typeof ROLE_WORKFLOW_ACCESS !== 'undefined') ? ROLE_WORKFLOW_ACCESS : {};
    var roles = (typeof ROLES !== 'undefined') ? ROLES : {};
    var displayNames = (typeof ROLE_DISPLAY_NAMES !== 'undefined') ? ROLE_DISPLAY_NAMES : {};

    return sanitizeForClient({
      permissions: permissions,
      workflow: workflow,
      roles: roles,
      displayNames: displayNames
    });
  } catch (error) {
    console.error('getAccessControlDashboardData error:', error);
    return sanitizeForClient({
      error: 'Failed to load access control data: ' + error.message,
      permissions: {},
      workflow: {},
      roles: {},
      displayNames: {}
    });
  }
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
    tursoSetConfig(key, value, 'GLOBAL');
  });

  logAuditEvent('UPDATE_CONFIG', 'CONFIG', 'SYSTEM', null, config, user.user_id, user.email);

  return { success: true };
}

/**
 * Get audit log entries
 */
function getAuditLogs(actionFilter, page, pageSize) {
  page = page || 1;
  pageSize = pageSize || 25;
  const offset = (page - 1) * pageSize;

  var sql, args;
  if (actionFilter) {
    sql  = 'SELECT * FROM audit_log WHERE action = ? ORDER BY occurred_at DESC LIMIT ? OFFSET ?';
    args = [actionFilter, pageSize, offset];
  } else {
    sql  = 'SELECT * FROM audit_log ORDER BY occurred_at DESC LIMIT ? OFFSET ?';
    args = [pageSize, offset];
  }

  return sanitizeForClient(tursoQuery_SQL(sql, args));
}

/**
 * Get audit log count
 */
function getAuditLogCount(actionFilter) {
  var sql, args;
  if (actionFilter) {
    sql  = 'SELECT COUNT(*) as cnt FROM audit_log WHERE action = ?';
    args = [actionFilter];
  } else {
    sql  = 'SELECT COUNT(*) as cnt FROM audit_log';
    args = [];
  }
  var rows = tursoQuery_SQL(sql, args);
  return rows.length > 0 ? (rows[0].cnt || 0) : 0;
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)

/**
 * Export work papers as CSV data
 */
function exportWorkPapersCSV(filters, user) {
  var workPapers = getWorkPapers(filters || {}, user);

  var headers = [
    'work_paper_id', 'year', 'affiliate_code', 'audit_area', 'sub_area',
    'observation_title', 'observation_description', 'risk_rating', 'status',
    'recommendation', 'management_response', 'prepared_by_name',
    'submitted_date', 'approved_date', 'created_at'
  ];

  var rows = [headers.join(',')];

  workPapers.forEach(function(wp) {
    var row = headers.map(function(h) {
      var val = wp[h];
      if (val === null || val === undefined) return '';
      var str = String(val).replace(/"/g, '""');
      if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
        return '"' + str + '"';
      }
      return str;
    });
    rows.push(row.join(','));
  });

  return sanitizeForClient({
    success: true,
    csv: rows.join('\n'),
    filename: 'work_papers_export_' + formatDate(new Date(), 'YYYY-MM-DD') + '.csv',
    count: workPapers.length
  });
}

/**
 * Export action plans as CSV data
 */
function exportActionPlansCSV(filters, user) {
  var actionPlans = getActionPlans(filters || {}, user);

  var headers = [
    'action_plan_id', 'work_paper_id', 'action_description', 'owner_names',
    'due_date', 'status', 'days_overdue', 'implementation_notes',
    'implemented_date', 'verified_by_name', 'verified_date',
    'hoa_review_status', 'created_at'
  ];

  var rows = [headers.join(',')];

  actionPlans.forEach(function(ap) {
    var row = headers.map(function(h) {
      var val = ap[h];
      if (val === null || val === undefined) return '';
      var str = String(val).replace(/"/g, '""');
      if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
        return '"' + str + '"';
      }
      return str;
    });
    rows.push(row.join(','));
  });

  return sanitizeForClient({
    success: true,
    csv: rows.join('\n'),
    filename: 'action_plans_export_' + formatDate(new Date(), 'YYYY-MM-DD') + '.csv',
    count: actionPlans.length
  });
}
