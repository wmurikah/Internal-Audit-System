/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Dashboard Service v3.0
 * 
 * FILE: 06_DashboardService.gs
 * 
 * Provides:
 * - Dashboard statistics
 * - Charts data
 * - Quick summaries
 * - Role-based views
 * - Recent activity
 * - Performance metrics
 * 
 * DEPENDS ON: 01_Core.gs, 02_Config.gs, 03_WorkPaperService.gs, 04_ActionPlanService.gs
 */

// ============================================================
// MAIN DASHBOARD DATA
// ============================================================

/**
 * Get complete dashboard data for a user
 * This is the main entry point called on dashboard load
 */
function getDashboardData(user) {
  if (!user) {
    const email = Session.getActiveUser().getEmail();
    user = getUserByEmail(email);
  }
  
  if (!user) {
    throw new Error('User not found');
  }
  
  const roleCode = user.role_code;
  
  // Build dashboard based on role
  const dashboard = {
    user: {
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role_code: roleCode,
      role_name: getRoleName(roleCode),
      affiliate_code: user.affiliate_code
    },
    summary: getSummaryStats(user),
    recentActivity: getRecentActivity(user, 10),
    charts: getChartData(user),
    alerts: getAlerts(user),
    quickLinks: getQuickLinks(roleCode)
  };
  
  // Add role-specific data
  if (roleCode === ROLES.AUDITEE) {
    dashboard.myActionPlans = getMyActionPlans(user);
  } else if (roleCode === ROLES.JUNIOR_STAFF) {
    dashboard.myWorkPapers = getMyWorkPapers(user);
  } else if ([ROLES.SENIOR_AUDITOR, ROLES.HEAD_OF_AUDIT, ROLES.SUPER_ADMIN].includes(roleCode)) {
    dashboard.pendingReviews = getPendingReviews(user);
    dashboard.teamStats = getTeamStats(user);
  }
  
  return dashboard;
}

/**
 * Get summary statistics
 */
function getSummaryStats(user) {
  const wpCounts = getWorkPaperCounts({}, user);
  const apCounts = getActionPlanCounts({}, user);
  
  return {
    workPapers: {
      total: wpCounts.total,
      draft: wpCounts.byStatus[STATUS.WORK_PAPER.DRAFT] || 0,
      submitted: wpCounts.byStatus[STATUS.WORK_PAPER.SUBMITTED] || 0,
      underReview: wpCounts.byStatus[STATUS.WORK_PAPER.UNDER_REVIEW] || 0,
      approved: wpCounts.byStatus[STATUS.WORK_PAPER.APPROVED] || 0,
      sentToAuditee: wpCounts.byStatus[STATUS.WORK_PAPER.SENT_TO_AUDITEE] || 0,
      byRisk: wpCounts.byRisk,
      byAffiliate: wpCounts.byAffiliate
    },
    actionPlans: {
      total: apCounts.total,
      overdue: apCounts.overdue,
      dueThisWeek: apCounts.dueThisWeek,
      dueThisMonth: apCounts.dueThisMonth,
      implemented: apCounts.byStatus[STATUS.ACTION_PLAN.IMPLEMENTED] || 0,
      verified: apCounts.byStatus[STATUS.ACTION_PLAN.VERIFIED] || 0,
      notImplemented: apCounts.byStatus[STATUS.ACTION_PLAN.NOT_IMPLEMENTED] || 0,
      byStatus: apCounts.byStatus
    }
  };
}

/**
 * Get recent activity
 */
function getRecentActivity(user, limit) {
  limit = limit || 10;
  
  const activities = [];
  
  // Get recent work papers
  const workPapers = getWorkPapers({ limit: 5 }, user);
  workPapers.forEach(wp => {
    activities.push({
      type: 'WORK_PAPER',
      id: wp.work_paper_id,
      title: wp.observation_title || 'Work Paper',
      status: wp.status,
      date: wp.updated_at || wp.created_at,
      user: wp.prepared_by_name,
      icon: 'bi-file-earmark-text',
      color: getStatusColor(wp.status, 'WORK_PAPER')
    });
  });
  
  // Get recent action plans
  const actionPlans = getActionPlans({ limit: 5 }, user);
  actionPlans.forEach(ap => {
    activities.push({
      type: 'ACTION_PLAN',
      id: ap.action_plan_id,
      title: ap.action_description ? ap.action_description.substring(0, 50) + '...' : 'Action Plan',
      status: ap.status,
      date: ap.updated_at || ap.created_at,
      user: ap.owner_names,
      icon: 'bi-check2-square',
      color: getStatusColor(ap.status, 'ACTION_PLAN')
    });
  });
  
  // Sort by date descending
  activities.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  
  return activities.slice(0, limit);
}

/**
 * Get chart data for dashboard visualizations
 */
function getChartData(user) {
  const wpCounts = getWorkPaperCounts({}, user);
  const apCounts = getActionPlanCounts({}, user);
  
  return {
    // Work paper status distribution
    wpStatusChart: {
      labels: Object.keys(wpCounts.byStatus),
      data: Object.values(wpCounts.byStatus),
      colors: Object.keys(wpCounts.byStatus).map(s => getStatusColor(s, 'WORK_PAPER'))
    },
    
    // Action plan status distribution
    apStatusChart: {
      labels: Object.keys(apCounts.byStatus),
      data: Object.values(apCounts.byStatus),
      colors: Object.keys(apCounts.byStatus).map(s => getStatusColor(s, 'ACTION_PLAN'))
    },
    
    // Risk rating distribution
    riskChart: {
      labels: Object.keys(wpCounts.byRisk),
      data: Object.values(wpCounts.byRisk),
      colors: Object.keys(wpCounts.byRisk).map(r => getRiskColor(r))
    },
    
    // By affiliate
    affiliateChart: {
      labels: Object.keys(wpCounts.byAffiliate),
      data: Object.values(wpCounts.byAffiliate)
    },
    
    // Monthly trend (last 6 months)
    trendChart: getMonthlyTrend(user)
  };
}

/**
 * Get monthly trend data
 */
function getMonthlyTrend(user) {
  const workPapers = getWorkPapers({}, user);
  
  const months = [];
  const now = new Date();
  
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      year: date.getFullYear(),
      month: date.getMonth()
    });
  }
  
  const trend = {
    labels: months.map(m => m.label),
    created: new Array(6).fill(0),
    completed: new Array(6).fill(0)
  };
  
  workPapers.forEach(wp => {
    const created = wp.created_at ? new Date(wp.created_at) : null;
    const completed = wp.sent_to_auditee_date ? new Date(wp.sent_to_auditee_date) : null;
    
    months.forEach((m, idx) => {
      if (created && created.getFullYear() === m.year && created.getMonth() === m.month) {
        trend.created[idx]++;
      }
      if (completed && completed.getFullYear() === m.year && completed.getMonth() === m.month) {
        trend.completed[idx]++;
      }
    });
  });
  
  return trend;
}

/**
 * Get alerts and notifications
 */
function getAlerts(user) {
  const alerts = [];
  const roleCode = user.role_code;
  
  // Overdue action plans
  const overdueCount = getActionPlanCounts({ overdue_only: true }, user).total;
  if (overdueCount > 0) {
    alerts.push({
      type: 'danger',
      icon: 'bi-exclamation-triangle-fill',
      title: 'Overdue Action Plans',
      message: `${overdueCount} action plan(s) are overdue and require attention.`,
      link: '#action-plans?filter=overdue'
    });
  }
  
  // Due this week
  const dueThisWeek = getActionPlanCounts({}, user).dueThisWeek;
  if (dueThisWeek > 0) {
    alerts.push({
      type: 'warning',
      icon: 'bi-clock-fill',
      title: 'Upcoming Deadlines',
      message: `${dueThisWeek} action plan(s) due this week.`,
      link: '#action-plans?filter=due-soon'
    });
  }
  
  // Pending reviews (for reviewers)
  if ([ROLES.SENIOR_AUDITOR, ROLES.HEAD_OF_AUDIT, ROLES.SUPER_ADMIN].includes(roleCode)) {
    const pendingReview = getWorkPaperCounts({ status: STATUS.WORK_PAPER.SUBMITTED }, user).total;
    if (pendingReview > 0) {
      alerts.push({
        type: 'info',
        icon: 'bi-eye-fill',
        title: 'Pending Reviews',
        message: `${pendingReview} work paper(s) awaiting your review.`,
        link: '#work-papers?filter=submitted'
      });
    }
    
    // Pending verification
    const pendingVerification = getActionPlanCounts({ status: STATUS.ACTION_PLAN.IMPLEMENTED }, user).total;
    if (pendingVerification > 0) {
      alerts.push({
        type: 'info',
        icon: 'bi-check-circle-fill',
        title: 'Pending Verification',
        message: `${pendingVerification} action plan(s) awaiting verification.`,
        link: '#action-plans?filter=implemented'
      });
    }
  }
  
  return alerts;
}

/**
 * Get quick links based on role
 */
function getQuickLinks(roleCode) {
  const links = [];
  
  // Common links
  links.push({
    icon: 'bi-speedometer2',
    title: 'Dashboard',
    href: '#dashboard',
    color: '#1a365d'
  });
  
  if ([ROLES.SUPER_ADMIN, ROLES.HEAD_OF_AUDIT, ROLES.SENIOR_AUDITOR, ROLES.JUNIOR_STAFF].includes(roleCode)) {
    links.push({
      icon: 'bi-file-earmark-plus',
      title: 'New Work Paper',
      href: '#work-papers/new',
      color: '#28a745'
    });
    
    links.push({
      icon: 'bi-folder2-open',
      title: 'Work Papers',
      href: '#work-papers',
      color: '#17a2b8'
    });
  }
  
  links.push({
    icon: 'bi-list-check',
    title: 'Action Plans',
    href: '#action-plans',
    color: '#ffc107'
  });
  
  if ([ROLES.SUPER_ADMIN, ROLES.HEAD_OF_AUDIT].includes(roleCode)) {
    links.push({
      icon: 'bi-bar-chart-fill',
      title: 'Reports',
      href: '#reports',
      color: '#6f42c1'
    });
    
    links.push({
      icon: 'bi-people-fill',
      title: 'Users',
      href: '#users',
      color: '#fd7e14'
    });
  }
  
  return links;
}

// ============================================================
// ROLE-SPECIFIC DATA
// ============================================================

/**
 * Get action plans for auditee (their assignments)
 */
function getMyActionPlans(user) {
  const plans = getActionPlans({ owner_id: user.user_id }, user);
  
  return {
    total: plans.length,
    overdue: plans.filter(p => p.days_overdue > 0 && !isImplementedOrVerified(p.status)).length,
    pending: plans.filter(p => !isImplementedOrVerified(p.status)).length,
    implemented: plans.filter(p => p.status === STATUS.ACTION_PLAN.IMPLEMENTED).length,
    items: plans.slice(0, 10)
  };
}

/**
 * Get work papers for auditor (their work)
 */
function getMyWorkPapers(user) {
  const papers = getWorkPapers({ prepared_by_id: user.user_id }, user);
  
  return {
    total: papers.length,
    draft: papers.filter(p => p.status === STATUS.WORK_PAPER.DRAFT).length,
    submitted: papers.filter(p => p.status === STATUS.WORK_PAPER.SUBMITTED).length,
    revisionRequired: papers.filter(p => p.status === STATUS.WORK_PAPER.REVISION_REQUIRED).length,
    items: papers.slice(0, 10)
  };
}

/**
 * Get pending reviews for reviewers
 */
function getPendingReviews(user) {
  const submitted = getWorkPapers({ status: STATUS.WORK_PAPER.SUBMITTED }, user);
  const underReview = getWorkPapers({ status: STATUS.WORK_PAPER.UNDER_REVIEW }, user);
  const implemented = getActionPlans({ status: STATUS.ACTION_PLAN.IMPLEMENTED }, user);
  
  return {
    workPapers: submitted.concat(underReview),
    actionPlans: implemented,
    totalWorkPapers: submitted.length + underReview.length,
    totalActionPlans: implemented.length
  };
}

/**
 * Get team statistics for managers
 */
function getTeamStats(user) {
  const auditors = getAuditorsDropdown();
  
  const stats = auditors.map(auditor => {
    const workPapers = getWorkPapers({ prepared_by_id: auditor.id }, null);
    
    return {
      user_id: auditor.id,
      name: auditor.name,
      role: auditor.roleCode,
      workPapers: {
        total: workPapers.length,
        draft: workPapers.filter(p => p.status === STATUS.WORK_PAPER.DRAFT).length,
        completed: workPapers.filter(p => p.status === STATUS.WORK_PAPER.SENT_TO_AUDITEE).length
      }
    };
  });
  
  return stats;
}

// ============================================================
// REPORTING
// ============================================================

/**
 * Get audit summary report data
 */
function getAuditSummaryReport(filters) {
  filters = filters || {};
  
  const workPapers = getWorkPapers(filters, null);
  const actionPlans = getActionPlans(filters, null);
  
  // Group by affiliate
  const byAffiliate = {};
  
  workPapers.forEach(wp => {
    const code = wp.affiliate_code || 'Unknown';
    if (!byAffiliate[code]) {
      byAffiliate[code] = {
        affiliate_code: code,
        workPapers: { total: 0, byStatus: {}, byRisk: {} },
        actionPlans: { total: 0, byStatus: {}, overdue: 0 }
      };
    }
    
    byAffiliate[code].workPapers.total++;
    byAffiliate[code].workPapers.byStatus[wp.status] = 
      (byAffiliate[code].workPapers.byStatus[wp.status] || 0) + 1;
    byAffiliate[code].workPapers.byRisk[wp.risk_rating] = 
      (byAffiliate[code].workPapers.byRisk[wp.risk_rating] || 0) + 1;
  });
  
  actionPlans.forEach(ap => {
    // Find the work paper to get affiliate
    const wp = workPapers.find(w => w.work_paper_id === ap.work_paper_id);
    const code = wp ? wp.affiliate_code : 'Unknown';
    
    if (!byAffiliate[code]) {
      byAffiliate[code] = {
        affiliate_code: code,
        workPapers: { total: 0, byStatus: {}, byRisk: {} },
        actionPlans: { total: 0, byStatus: {}, overdue: 0 }
      };
    }
    
    byAffiliate[code].actionPlans.total++;
    byAffiliate[code].actionPlans.byStatus[ap.status] = 
      (byAffiliate[code].actionPlans.byStatus[ap.status] || 0) + 1;
    if (ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)) {
      byAffiliate[code].actionPlans.overdue++;
    }
  });
  
  return {
    generatedAt: new Date(),
    filters: filters,
    summary: {
      totalWorkPapers: workPapers.length,
      totalActionPlans: actionPlans.length,
      overdueActionPlans: actionPlans.filter(ap => ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)).length
    },
    byAffiliate: Object.values(byAffiliate)
  };
}

/**
 * Get action plan aging report
 */
function getActionPlanAgingReport() {
  const actionPlans = getActionPlans({}, null);
  
  const aging = {
    current: [],      // Not yet due
    overdue1to30: [], // 1-30 days overdue
    overdue31to60: [], // 31-60 days overdue
    overdue61to90: [], // 61-90 days overdue
    overdue90plus: []  // 90+ days overdue
  };
  
  actionPlans.forEach(ap => {
    if (isImplementedOrVerified(ap.status)) return;
    
    const daysOverdue = ap.days_overdue || 0;
    
    if (daysOverdue <= 0) {
      aging.current.push(ap);
    } else if (daysOverdue <= 30) {
      aging.overdue1to30.push(ap);
    } else if (daysOverdue <= 60) {
      aging.overdue31to60.push(ap);
    } else if (daysOverdue <= 90) {
      aging.overdue61to90.push(ap);
    } else {
      aging.overdue90plus.push(ap);
    }
  });
  
  return {
    generatedAt: new Date(),
    summary: {
      current: aging.current.length,
      overdue1to30: aging.overdue1to30.length,
      overdue31to60: aging.overdue31to60.length,
      overdue61to90: aging.overdue61to90.length,
      overdue90plus: aging.overdue90plus.length,
      totalOverdue: aging.overdue1to30.length + aging.overdue31to60.length + 
                    aging.overdue61to90.length + aging.overdue90plus.length
    },
    details: aging
  };
}

/**
 * Get risk summary report
 */
function getRiskSummaryReport(filters) {
  filters = filters || {};
  
  const workPapers = getWorkPapers(filters, null);
  
  const riskLevels = ['Extreme', 'High', 'Medium', 'Low'];
  const byRisk = {};
  
  riskLevels.forEach(risk => {
    byRisk[risk] = {
      level: risk,
      color: getRiskColor(risk),
      workPapers: [],
      count: 0,
      openActionPlans: 0,
      closedActionPlans: 0
    };
  });
  
  workPapers.forEach(wp => {
    const risk = wp.risk_rating || 'Not Rated';
    if (!byRisk[risk]) {
      byRisk[risk] = {
        level: risk,
        color: '#6c757d',
        workPapers: [],
        count: 0,
        openActionPlans: 0,
        closedActionPlans: 0
      };
    }
    
    byRisk[risk].workPapers.push(wp);
    byRisk[risk].count++;
    
    // Get action plans for this work paper
    const actionPlans = getActionPlansByWorkPaper(wp.work_paper_id);
    actionPlans.forEach(ap => {
      if (isImplementedOrVerified(ap.status)) {
        byRisk[risk].closedActionPlans++;
      } else {
        byRisk[risk].openActionPlans++;
      }
    });
  });
  
  return {
    generatedAt: new Date(),
    filters: filters,
    byRisk: Object.values(byRisk).filter(r => r.count > 0)
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Get color for status
 */
function getStatusColor(status, type) {
  if (type === 'WORK_PAPER') {
    const colors = {
      [STATUS.WORK_PAPER.DRAFT]: '#6c757d',
      [STATUS.WORK_PAPER.SUBMITTED]: '#17a2b8',
      [STATUS.WORK_PAPER.UNDER_REVIEW]: '#ffc107',
      [STATUS.WORK_PAPER.REVISION_REQUIRED]: '#fd7e14',
      [STATUS.WORK_PAPER.APPROVED]: '#28a745',
      [STATUS.WORK_PAPER.SENT_TO_AUDITEE]: '#1a365d'
    };
    return colors[status] || '#6c757d';
  }
  
  if (type === 'ACTION_PLAN') {
    const colors = {
      [STATUS.ACTION_PLAN.NOT_DUE]: '#6c757d',
      [STATUS.ACTION_PLAN.PENDING]: '#17a2b8',
      [STATUS.ACTION_PLAN.IN_PROGRESS]: '#ffc107',
      [STATUS.ACTION_PLAN.IMPLEMENTED]: '#28a745',
      [STATUS.ACTION_PLAN.VERIFIED]: '#1a365d',
      [STATUS.ACTION_PLAN.OVERDUE]: '#dc3545',
      [STATUS.ACTION_PLAN.NOT_IMPLEMENTED]: '#dc3545'
    };
    return colors[status] || '#6c757d';
  }
  
  return '#6c757d';
}

/**
 * Get color for risk rating
 */
function getRiskColor(risk) {
  const colors = {
    'Extreme': '#dc3545',
    'High': '#fd7e14',
    'Medium': '#ffc107',
    'Low': '#28a745'
  };
  return colors[risk] || '#6c757d';
}

// ============================================================
// INITIALIZATION DATA
// ============================================================

/**
 * Get initialization data for the frontend
 * Called once on page load
 */
function getInitData() {
  const email = Session.getActiveUser().getEmail();
  const user = getUserByEmail(email);
  
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  if (!isActive(user.is_active)) {
    return { success: false, error: 'Account is inactive' };
  }
  
  return {
    success: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: getRoleName(user.role_code),
      affiliate_code: user.affiliate_code,
      department: user.department
    },
    dropdowns: getDropdownData(),
    config: {
      systemName: getConfigValue('SYSTEM_NAME') || 'Hass Petroleum Internal Audit System',
      currentYear: new Date().getFullYear()
    },
    permissions: getUserPermissions(user.role_code)
  };
}

/**
 * Get permissions for a role
 */
function getUserPermissions(roleCode) {
  const permissions = {
    canCreateWorkPaper: false,
    canReviewWorkPaper: false,
    canApproveWorkPaper: false,
    canCreateActionPlan: false,
    canVerifyActionPlan: false,
    canManageUsers: false,
    canViewReports: false,
    canExportData: false
  };
  
  switch (roleCode) {
    case ROLES.SUPER_ADMIN:
      Object.keys(permissions).forEach(k => permissions[k] = true);
      break;
      
    case ROLES.HEAD_OF_AUDIT:
      permissions.canCreateWorkPaper = true;
      permissions.canReviewWorkPaper = true;
      permissions.canApproveWorkPaper = true;
      permissions.canCreateActionPlan = true;
      permissions.canVerifyActionPlan = true;
      permissions.canManageUsers = true;
      permissions.canViewReports = true;
      permissions.canExportData = true;
      break;
      
    case ROLES.SENIOR_AUDITOR:
      permissions.canCreateWorkPaper = true;
      permissions.canReviewWorkPaper = true;
      permissions.canCreateActionPlan = true;
      permissions.canVerifyActionPlan = true;
      permissions.canViewReports = true;
      break;
      
    case ROLES.JUNIOR_STAFF:
      permissions.canCreateWorkPaper = true;
      permissions.canCreateActionPlan = true;
      break;
      
    case ROLES.AUDITEE:
      // Auditees can only respond to action plans
      break;
      
    case ROLES.MANAGEMENT:
      permissions.canViewReports = true;
      break;
      
    case ROLES.OBSERVER:
      // View only
      break;
  }
  
  return permissions;
}

// ============================================================
// TEST FUNCTION
// ============================================================
function testDashboardService() {
  console.log('=== Testing 06_DashboardService.gs ===\n');
  
  const email = Session.getActiveUser().getEmail();
  const user = getUserByEmail(email);
  
  if (!user) {
    console.log('FAIL: Current user not found');
    return;
  }
  
  console.log('Testing as user:', user.full_name, '(' + user.role_code + ')');
  
  // Test get init data
  console.log('\n1. Testing getInitData...');
  try {
    const initData = getInitData();
    console.log('Init success:', initData.success);
    console.log('User:', initData.user.full_name);
    console.log('Dropdowns loaded:', Object.keys(initData.dropdowns).length, 'types');
    console.log('getInitData: PASS');
  } catch (e) {
    console.log('getInitData: FAIL -', e.message);
  }
  
  // Test get dashboard data
  console.log('\n2. Testing getDashboardData...');
  try {
    const dashboard = getDashboardData(user);
    console.log('Summary - Work Papers:', dashboard.summary.workPapers.total);
    console.log('Summary - Action Plans:', dashboard.summary.actionPlans.total);
    console.log('Alerts:', dashboard.alerts.length);
    console.log('Recent Activity:', dashboard.recentActivity.length);
    console.log('getDashboardData: PASS');
  } catch (e) {
    console.log('getDashboardData: FAIL -', e.message);
  }
  
  // Test chart data
  console.log('\n3. Testing getChartData...');
  try {
    const charts = getChartData(user);
    console.log('WP Status Chart labels:', charts.wpStatusChart.labels.length);
    console.log('AP Status Chart labels:', charts.apStatusChart.labels.length);
    console.log('Trend Chart months:', charts.trendChart.labels.length);
    console.log('getChartData: PASS');
  } catch (e) {
    console.log('getChartData: FAIL -', e.message);
  }
  
  // Test audit summary report
  console.log('\n4. Testing getAuditSummaryReport...');
  try {
    const report = getAuditSummaryReport({});
    console.log('Total Work Papers:', report.summary.totalWorkPapers);
    console.log('Total Action Plans:', report.summary.totalActionPlans);
    console.log('By Affiliate:', report.byAffiliate.length, 'affiliates');
    console.log('getAuditSummaryReport: PASS');
  } catch (e) {
    console.log('getAuditSummaryReport: FAIL -', e.message);
  }
  
  // Test aging report
  console.log('\n5. Testing getActionPlanAgingReport...');
  try {
    const aging = getActionPlanAgingReport();
    console.log('Current:', aging.summary.current);
    console.log('Overdue 1-30:', aging.summary.overdue1to30);
    console.log('Total Overdue:', aging.summary.totalOverdue);
    console.log('getActionPlanAgingReport: PASS');
  } catch (e) {
    console.log('getActionPlanAgingReport: FAIL -', e.message);
  }
  
  // Test risk report
  console.log('\n6. Testing getRiskSummaryReport...');
  try {
    const risk = getRiskSummaryReport({});
    console.log('Risk levels with data:', risk.byRisk.length);
    risk.byRisk.forEach(r => console.log('  -', r.level + ':', r.count, 'work papers'));
    console.log('getRiskSummaryReport: PASS');
  } catch (e) {
    console.log('getRiskSummaryReport: FAIL -', e.message);
  }
  
  console.log('\n=== 06_DashboardService.gs Tests Complete ===');
}
