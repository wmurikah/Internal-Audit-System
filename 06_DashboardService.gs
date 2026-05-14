// 06_DashboardService.gs - Dashboard Statistics, Charts, Role-based Views, Recent Activity

function getDashboardData(user) {
  console.log('getDashboardData called for user:', user ? user.email : 'null');

  try {
    // Attempt to get user from session if not provided
    if (!user) {
      try {
        const email = Session.getActiveUser().getEmail();
        user = getUserByEmail(email);
      } catch (e) {
        console.error('Error getting user from session:', e);
        return { 
          success: false, 
          error: 'User not found', 
          errorDetail: 'Failed to retrieve user from session: ' + e.message 
        };
      }
    }

    if (!user) {
      console.error('getDashboardData: No user provided or found');
      return { 
        success: false, 
        error: 'User not found', 
        errorDetail: 'No user object available. User may not exist in the system or session has expired.' 
      };
    }

    const roleCode = user.role_code || '';
    console.log('Building dashboard for role:', roleCode);

    // Build dashboard based on role - with error handling for each section
    const dashboard = {
      success: true,
      user: {
        user_id: user.user_id || '',
        full_name: user.full_name || 'Unknown User',
        email: user.email || '',
        role_code: roleCode,
        role_name: '',
        affiliate_code: user.affiliate_code || ''
      },
      summary: { workPapers: {}, actionPlans: {} },
      recentActivity: [],
      charts: {},
      alerts: [],
      quickLinks: [],
      errors: [] // Track non-fatal errors for debugging
    };

    // Get role name
    try {
      dashboard.user.role_name = getRoleName(roleCode) || roleCode;
    } catch (e) {
      console.error('Error getting role name:', e);
      dashboard.user.role_name = roleCode;
      dashboard.errors.push('Failed to load role name: ' + e.message);
    }

    // Get summary stats
    try {
      dashboard.summary = getSummaryStats(user);
      console.log('Summary stats loaded');
    } catch (e) {
      console.error('Error loading summary stats:', e);
      dashboard.summary = {
        workPapers: { total: 0, draft: 0, submitted: 0, underReview: 0, approved: 0, sentToAuditee: 0, byRisk: {}, byAffiliate: {} },
        actionPlans: { total: 0, overdue: 0, dueThisWeek: 0, dueThisMonth: 0, implemented: 0, verified: 0, notImplemented: 0, byStatus: {} }
      };
      dashboard.errors.push('Failed to load summary stats: ' + e.message);
    }

    // Get recent activity
    try {
      dashboard.recentActivity = getRecentActivity(user, 10);
      console.log('Recent activity loaded:', dashboard.recentActivity.length, 'items');
    } catch (e) {
      console.error('Error loading recent activity:', e);
      dashboard.recentActivity = [];
      dashboard.errors.push('Failed to load recent activity: ' + e.message);
    }

    // Get chart data
    try {
      dashboard.charts = getChartData(user);
      console.log('Chart data loaded');
    } catch (e) {
      console.error('Error loading chart data:', e);
      dashboard.charts = { wpStatusChart: {}, apStatusChart: {}, riskChart: {}, affiliateChart: {}, trendChart: {} };
      dashboard.errors.push('Failed to load chart data: ' + e.message);
    }

    // Get alerts
    try {
      dashboard.alerts = getAlerts(user);
      console.log('Alerts loaded:', dashboard.alerts.length, 'alerts');
    } catch (e) {
      console.error('Error loading alerts:', e);
      dashboard.alerts = [];
      dashboard.errors.push('Failed to load alerts: ' + e.message);
    }

    // Get quick links
    try {
      dashboard.quickLinks = getQuickLinks(roleCode);
    } catch (e) {
      console.error('Error loading quick links:', e);
      dashboard.quickLinks = [];
      dashboard.errors.push('Failed to load quick links: ' + e.message);
    }

    // Add role-specific data with error handling
    try {
      const permissions = getUserPermissions(roleCode);
      
      if (roleCode === ROLES.JUNIOR_STAFF) {
        dashboard.myActionPlans = getMyActionPlans(user);
      } else if (permissions.canCreateWorkPaper && !permissions.canReviewWorkPaper) {
        // Junior staff equivalent - can create but not review
        dashboard.myWorkPapers = getMyWorkPapers(user);
      } else if (permissions.canReviewWorkPaper) {
        // Reviewers - senior auditors, HOA, super admin
        dashboard.pendingReviews = getPendingReviews(user);
        dashboard.teamStats = getTeamStats(user);
        // Add pending auditee responses for auditor review
        try {
          dashboard.pendingResponses = getPendingAuditeeResponsesForAuditor(user);
        } catch (respErr) {
          console.warn('Failed to load pending responses:', respErr.message);
          dashboard.pendingResponses = [];
        }
      }
    } catch (e) {
      console.error('Error loading role-specific data:', e);
      dashboard.errors.push('Failed to load role-specific data: ' + e.message);
    }

    // Log any non-fatal errors that occurred
    if (dashboard.errors.length > 0) {
      console.warn('Dashboard loaded with errors:', dashboard.errors);
    }

    console.log('getDashboardData completed successfully');
    return sanitizeForClient(dashboard);

  } catch (e) {
    // Catch-all for any unexpected errors
    console.error('Unexpected error in getDashboardData:', e);
    return { 
      success: false, 
      error: 'Failed to load dashboard', 
      errorDetail: 'Unexpected error: ' + e.message 
    };
  }
}

/**
 * Get sidebar counts - lightweight API for updating badges
 * Reads directly from DB sheets to get accurate counts
 */
function getSidebarCounts(user) {
  try {
    const roleCode = user ? user.role_code : '';
    const userId = user ? user.user_id : '';

    // ── CACHE: avoid repeated SQL queries on every sidebar refresh ──
    var cache = CacheService.getScriptCache();
    var cacheKey = 'sidebar_counts_all';
    var cached = cache.get(cacheKey);
    var allCounts = null;

    if (cached) {
      try { allCounts = JSON.parse(cached); } catch (e) { allCounts = null; }
    }

    if (!allCounts) {
      // ── Work Paper counts via SQL ──
      var wpStatusRows = tursoQuery_SQL(
        'SELECT status, assigned_auditor_id, prepared_by_id, responsible_ids, response_status,' +
        ' COUNT(*) as cnt FROM work_papers WHERE deleted_at IS NULL GROUP BY status, assigned_auditor_id, prepared_by_id, responsible_ids, response_status',
        []
      );

      // Simpler scalar queries for well-defined counts
      var pendingReviewAll = 0;
      var approvedQueueAll = 0;
      var pendingResponsesAll = 0;
      var pendingAssignmentsAll = 0;
      var totalWps = 0;
      var wpByCreator = {};
      var obsByResponsible = {};
      var totalPendingObservations = 0;

      // Load all WPs for in-memory aggregations that need composite logic
      var allWPs = tursoGetAll('09_WorkPapers');
      allWPs.forEach(function(wp) {
        totalWps++;
        var st = wp.status || '';
        if (st === 'Submitted') pendingReviewAll++;
        if (st === 'Approved' && wp.responsible_ids) approvedQueueAll++;
        if (wp.response_status === 'Response Submitted') pendingResponsesAll++;
        if (st === 'Draft' && wp.assigned_auditor_id) pendingAssignmentsAll++;
        if (wp.prepared_by_id) {
          wpByCreator[wp.prepared_by_id] = (wpByCreator[wp.prepared_by_id] || 0) + 1;
        }
        if (st === 'Sent to Auditee' && wp.response_status !== 'Accepted') {
          totalPendingObservations++;
          String(wp.responsible_ids || '').split(',').forEach(function(id) {
            id = id.trim();
            if (id) obsByResponsible[id] = (obsByResponsible[id] || 0) + 1;
          });
        }
      });

      // ── Action Plan counts via SQL ──
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var closedStatuses = ['Implemented', 'Verified', 'Not Implemented', 'Closed', 'Rejected'];

      var allAPs = tursoGetAll('13_ActionPlans');
      var overdueAll = 0;
      var overdueByOwner = {};
      var activeApByOwner = {};
      var totalActiveAps = 0;

      allAPs.forEach(function(ap) {
        var apStatus = ap.status || '';
        var apDue = ap.due_date;
        var apOwners = String(ap.owner_ids || '').split(',');

        if (!closedStatuses.includes(apStatus)) {
          totalActiveAps++;
          apOwners.forEach(function(oid) {
            oid = oid.trim();
            if (oid) activeApByOwner[oid] = (activeApByOwner[oid] || 0) + 1;
          });
        }

        if (!closedStatuses.includes(apStatus) && apDue) {
          var due = new Date(apDue);
          due.setHours(0, 0, 0, 0);
          if (due < today) {
            overdueAll++;
            apOwners.forEach(function(oid) {
              oid = oid.trim();
              if (oid) overdueByOwner[oid] = (overdueByOwner[oid] || 0) + 1;
            });
          }
        }
      });

      allCounts = {
        pendingReview: pendingReviewAll,
        overdueAll: overdueAll,
        overdueByOwner: overdueByOwner,
        approvedQueue: approvedQueueAll,
        pendingResponses: pendingResponsesAll,
        wpByCreator: wpByCreator,
        totalWps: totalWps,
        activeApByOwner: activeApByOwner,
        totalActiveAps: totalActiveAps,
        obsByResponsible: obsByResponsible,
        totalPendingObservations: totalPendingObservations,
        pendingAssignments: pendingAssignmentsAll
      };
      cache.put(cacheKey, JSON.stringify(allCounts), 20);
    }

    // Role-specific result
    var pendingReview = allCounts.pendingReview;
    var overdueActionPlans = allCounts.overdueAll;

    // Per-user overdue
    var myOverdue = 0;
    if (userId) {
      myOverdue = allCounts.overdueByOwner[userId] || 0;
    }
    if (roleCode === ROLES.JUNIOR_STAFF || roleCode === ROLES.UNIT_MANAGER || roleCode === ROLES.SENIOR_MGMT) {
      overdueActionPlans = myOverdue;
    }
    // SUPER_ADMIN sees global overdue
    if (roleCode === ROLES.SUPER_ADMIN) {
      myOverdue = allCounts.overdueAll;
    }

    var approvedQueue = allCounts.approvedQueue || 0;
    // Only show send queue count for reviewers
    if (roleCode !== ROLES.SUPER_ADMIN && roleCode !== ROLES.SENIOR_AUDITOR) {
      approvedQueue = 0;
    }

    var pendingResponses = allCounts.pendingResponses || 0;
    // Only show pending responses count for auditor roles
    var auditorRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
    if (!auditorRoles.includes(roleCode)) {
      pendingResponses = 0;
    }

    // My Work Papers count
    var myWorkPapers = 0;
    if (roleCode === ROLES.SUPER_ADMIN) {
      myWorkPapers = allCounts.totalWps || 0;
    } else if (auditorRoles.includes(roleCode) || roleCode === ROLES.BOARD_MEMBER) {
      myWorkPapers = userId ? (allCounts.wpByCreator[userId] || 0) : 0;
    }

    // My Action Plans count
    var myActionPlans = 0;
    if (roleCode === ROLES.SUPER_ADMIN) {
      myActionPlans = allCounts.totalActiveAps || 0;
    } else if (userId) {
      myActionPlans = allCounts.activeApByOwner[userId] || 0;
    }

    // My Observations count
    var myObservations = 0;
    var obsRoles = [ROLES.SENIOR_MGMT, ROLES.UNIT_MANAGER, ROLES.JUNIOR_STAFF];
    if (roleCode === ROLES.SUPER_ADMIN) {
      myObservations = allCounts.totalPendingObservations || 0;
    } else if (obsRoles.includes(roleCode) && userId) {
      myObservations = allCounts.obsByResponsible[userId] || 0;
    }

    // Pending assignments (SUPER_ADMIN only)
    var pendingAssignments = 0;
    if (roleCode === ROLES.SUPER_ADMIN) {
      pendingAssignments = allCounts.pendingAssignments || 0;
    }

    return {
      success: true,
      pendingReview: pendingReview,
      overdueActionPlans: overdueActionPlans,
      approvedQueue: approvedQueue,
      pendingResponses: pendingResponses,
      myWorkPapers: myWorkPapers,
      myActionPlans: myActionPlans,
      myOverdue: myOverdue,
      myObservations: myObservations,
      pendingAssignments: pendingAssignments
    };
  } catch (e) {
    console.error('Error getting sidebar counts:', e);
    return { success: false, error: e.message, pendingReview: 0, overdueActionPlans: 0 };
  }
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
  const permissions = getUserPermissions(roleCode);
  
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
  
  // Pending reviews - based on database permissions
  if (permissions.canReviewWorkPaper) {
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
  }
  
  // Pending verification - based on database permissions
  if (permissions.canVerifyActionPlan) {
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
 * Get quick links based on role - reads from database permissions
 */
function getQuickLinks(roleCode) {
  const links = [];
  const permissions = getUserPermissions(roleCode);
  
  // Dashboard - always visible
  links.push({
    icon: 'bi-speedometer2',
    title: 'Dashboard',
    href: '#dashboard',
    color: '#1a365d'
  });
  
  // New Work Paper - if can create
  if (permissions.canCreateWorkPaper) {
    links.push({
      icon: 'bi-file-earmark-plus',
      title: 'New Work Paper',
      href: '#work-papers/new',
      color: '#28a745'
    });
  }
  
  // Work Papers list - if can view
  if (permissions.canViewWorkPapers) {
    links.push({
      icon: 'bi-folder2-open',
      title: 'Work Papers',
      href: '#work-papers',
      color: '#17a2b8'
    });
  }
  
  // Action Plans - if can view
  if (permissions.canViewActionPlans) {
    links.push({
      icon: 'bi-list-check',
      title: 'Action Plans',
      href: '#action-plans',
      color: '#ffc107'
    });
  }
  
  // Reports - if can view
  if (permissions.canViewReports) {
    links.push({
      icon: 'bi-bar-chart-fill',
      title: 'Reports',
      href: '#reports',
      color: '#6f42c1'
    });
  }
  
  // Users - if can manage
  if (permissions.canManageUsers) {
    links.push({
      icon: 'bi-people-fill',
      title: 'Users',
      href: '#users',
      color: '#fd7e14'
    });
  }
  
  // Settings - if can manage
  if (permissions.canManageSettings) {
    links.push({
      icon: 'bi-gear-fill',
      title: 'Settings',
      href: '#settings',
      color: '#6c757d'
    });
  }
  
  return links;
}

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
    // Find the work paper to get affiliate (FIX-4: normalize affiliate_id vs affiliate_code)
    const wp = workPapers.find(w => w.work_paper_id === ap.work_paper_id);
    const code = ap.affiliate_code || ap.affiliate_id || (wp ? wp.affiliate_code : '') || 'Unknown';
    
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
  
  return sanitizeForClient({
    generatedAt: new Date(),
    filters: filters,
    summary: {
      totalWorkPapers: workPapers.length,
      totalActionPlans: actionPlans.length,
      overdueActionPlans: actionPlans.filter(ap => ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)).length
    },
    byAffiliate: Object.values(byAffiliate)
  });
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
  
  return sanitizeForClient({
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
  });
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
  
  return sanitizeForClient({
    generatedAt: new Date(),
    filters: filters,
    byRisk: Object.values(byRisk).filter(r => r.count > 0)
  });
}

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

function getInitData(sessionToken) {
  // First try to get user from session token
  if (sessionToken) {
    const sessionResult = validateSession(sessionToken);
    if (sessionResult.valid) {
      const user = getUserByEmail(sessionResult.user.email);
      
      if (user && isActive(user.is_active)) {
        return sanitizeForClient({
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
        });
      }
    }
  }
  
  // No valid session - require login
  return { success: false, requireLogin: true };
}

function canViewDashboard(user) {
  if (!user) return false;
  if (user.role_code === ROLES.SUPER_ADMIN) return true;
  return checkPermission(user.role_code, 'REPORT', 'view');
}

function canViewAIAssist(user) {
  if (!user) return false;
  if (user.role_code === ROLES.SUPER_ADMIN) return true;
  return checkPermission(user.role_code, 'AI_ASSIST', 'view');
}

function canViewAuditWorkbench(user) {
  if (!user) return false;
  if (user.role_code === ROLES.SUPER_ADMIN) return true;
  return checkPermission(user.role_code, 'WORK_PAPERS', 'view');
}

/**
 * Get permissions for a role - READS FROM DATABASE
 * Maps database CRUD permissions to UI feature flags.
 * Handles both old naming (WORK_PAPER / can_read) and new naming (WORK_PAPERS / view).
 */
function getUserPermissions(roleCode) {
  // Default permissions - all false
  const permissions = {
    // Work Paper permissions
    canCreateWorkPaper: false,
    canViewWorkPapers: false,
    canEditWorkPaper: false,
    canDeleteWorkPaper: false,
    canReviewWorkPaper: false,
    canApproveWorkPaper: false,

    // Action Plan permissions
    canCreateActionPlan: false,
    canViewActionPlans: false,
    canEditActionPlan: false,
    canDeleteActionPlan: false,
    canVerifyActionPlan: false,

    // User Management
    canManageUsers: false,
    canCreateUser: false,
    canEditUser: false,
    canDeleteUser: false,

    // Reports
    canViewReports: false,
    canExportData: false,

    // Dashboard - visible to ALL roles (shell frame is always served)
    canViewDashboard: true,
    canExportDashboard: false,

    // AI Assist
    canViewAIAssist: false,
    canGenerateAIInsights: false,

    // Audit Workbench
    canViewAuditWorkbench: false,

    // Settings/Config
    canManageSettings: false,
    canManageRoles: false
  };

  // SUPER_ADMIN: all permissions true
  if (roleCode === ROLES.SUPER_ADMIN) {
    Object.keys(permissions).forEach(function(k) { permissions[k] = true; });
    return permissions;
  }

  // Load permissions from database (with fallback to hardcoded constant)
  const dbPermissions = getPermissionsFresh(roleCode);

  // Helper: read a flag from DB using new names (view/create/...) or old names (can_read/can_create/...)
  function dbFlag(moduleNew, moduleOld, actionNew, actionOld) {
    var mod = dbPermissions[moduleNew] || dbPermissions[moduleOld] || null;
    if (!mod) return false;
    var val = (actionNew && mod[actionNew] !== undefined) ? mod[actionNew] : mod[actionOld];
    return val === true || val === 1;
  }

  // WORK_PAPERS module (new: WORK_PAPERS/view, old: WORK_PAPER/can_read)
  permissions.canCreateWorkPaper  = dbFlag('WORK_PAPERS', 'WORK_PAPER', 'create',  'can_create');
  permissions.canViewWorkPapers   = dbFlag('WORK_PAPERS', 'WORK_PAPER', 'view',    'can_read');
  permissions.canEditWorkPaper    = dbFlag('WORK_PAPERS', 'WORK_PAPER', 'update',  'can_update');
  permissions.canDeleteWorkPaper  = dbFlag('WORK_PAPERS', 'WORK_PAPER', 'delete',  'can_delete');
  permissions.canApproveWorkPaper = dbFlag('WORK_PAPERS', 'WORK_PAPER', 'approve', 'can_approve');
  permissions.canReviewWorkPaper  = permissions.canApproveWorkPaper;

  // ACTION_PLANS module
  permissions.canCreateActionPlan = dbFlag('ACTION_PLANS', 'ACTION_PLAN', 'create',  'can_create');
  permissions.canViewActionPlans  = dbFlag('ACTION_PLANS', 'ACTION_PLAN', 'view',    'can_read');
  permissions.canEditActionPlan   = dbFlag('ACTION_PLANS', 'ACTION_PLAN', 'update',  'can_update');
  permissions.canDeleteActionPlan = dbFlag('ACTION_PLANS', 'ACTION_PLAN', 'delete',  'can_delete');
  permissions.canVerifyActionPlan = dbFlag('ACTION_PLANS', 'ACTION_PLAN', 'approve', 'can_approve');

  // USERS module
  permissions.canManageUsers = dbFlag('USERS', 'USER', 'view',   'can_read');
  permissions.canCreateUser  = dbFlag('USERS', 'USER', 'create', 'can_create');
  permissions.canEditUser    = dbFlag('USERS', 'USER', 'update', 'can_update');
  permissions.canDeleteUser  = dbFlag('USERS', 'USER', 'delete', 'can_delete');

  // REPORT module
  permissions.canViewReports   = dbFlag('REPORT', 'REPORT', 'view',   'can_read');
  permissions.canExportData    = dbFlag('REPORT', 'REPORT', 'export', 'can_export');
  permissions.canExportDashboard = dbFlag('REPORT', 'DASHBOARD', 'export', 'can_export');

  // AI_ASSIST module
  permissions.canViewAIAssist       = dbFlag('AI_ASSIST', 'AI_ASSIST', 'view',   'can_read');
  permissions.canGenerateAIInsights = dbFlag('AI_ASSIST', 'AI_ASSIST', 'create', 'can_create');

  // Audit Workbench — visible to all auditor roles
  permissions.canViewAuditWorkbench = permissions.canViewWorkPapers || permissions.canViewActionPlans;

  // CONFIG module
  permissions.canManageSettings = dbFlag('CONFIG', 'CONFIG', 'update', 'can_update');
  permissions.canManageRoles    = permissions.canManageSettings;

  // Dashboard always visible (it's a shell — data is role-filtered)
  permissions.canViewDashboard = true;

  console.log('getUserPermissions for role', roleCode, '- loaded from database');

  return permissions;
}

// ============================================================
// COMPREHENSIVE REPORT ENGINE
// Industry-standard scoring methodology for internal audit
// Based on IIA (Institute of Internal Auditors) frameworks
// ============================================================

/**
 * Get comprehensive report data with scoring, analytics, and detailed breakdowns.
 * Single endpoint that powers all report views (Executive Summary, Findings,
 * Action Plan Tracker, Risk Assessment, Performance Scorecard, Aging Analysis).
 *
 * Scoring Methodology:
 *   Audit Area Score (0-100):
 *     - Implementation Rate (40%): % of action plans resolved
 *     - Timeliness (35%): inverse of overdue rate
 *     - Risk Profile (25%): penalty for high-severity open findings
 *
 *   Control Effectiveness Rating:
 *     - Effective:           score >= 80
 *     - Needs Improvement:   score 60-79
 *     - Ineffective:         score < 60
 *
 *   Overall Audit Health Score (0-100):
 *     - Implementation Rate (35%)
 *     - On-Time Closure Rate (25%)
 *     - Risk Posture (20%): inverse of weighted avg risk
 *     - Overdue Penalty (20%): fewer overdue = higher score
 */
function getComprehensiveReportData(filters) {
  filters = filters || {};
  var startTime = new Date().getTime();

  var workPapers = getWorkPapers(filters, null);
  var actionPlans = getActionPlans(filters, null);

  // Build area lookup: area_id -> area_name
  var areaLookup = {};
  try {
    var areaData = tursoGetAll('07_AuditAreas');
    areaData.forEach(function(area) {
      if (area.area_id) areaLookup[area.area_id] = area.area_name || area.area_code || area.area_id;
      if (area.area_code && !areaLookup[area.area_code]) areaLookup[area.area_code] = area.area_name || area.area_code;
    });
  } catch(e) { console.warn('Failed to load audit areas lookup:', e); }

  // Enrich work papers with area_name from lookup
  workPapers.forEach(function(wp) {
    if (!wp.audit_area_name && wp.audit_area_id && areaLookup[wp.audit_area_id]) {
      wp.audit_area_name = areaLookup[wp.audit_area_id];
    }
  });

  // Build lookup: work_paper_id -> work paper
  var wpLookup = {};
  workPapers.forEach(function(wp) { wpLookup[wp.work_paper_id] = wp; });

  // Build lookup: work_paper_id -> action plans[]
  var apByWp = {};
  actionPlans.forEach(function(ap) {
    var wpId = ap.work_paper_id;
    if (!apByWp[wpId]) apByWp[wpId] = [];
    apByWp[wpId].push(ap);
  });

  var totalFindings = workPapers.length;
  var totalAPs = actionPlans.length;
  var closedAPs = actionPlans.filter(function(ap) { return isImplementedOrVerified(ap.status); });
  var overdueAPs = actionPlans.filter(function(ap) {
    return (ap.days_overdue > 0) && !isImplementedOrVerified(ap.status);
  });

  var implementationRate = totalAPs > 0 ? Math.round((closedAPs.length / totalAPs) * 100) : 0;

  // On-time closure: closed items that were NOT overdue at closure (approximate)
  var closedOnTime = closedAPs.filter(function(ap) { return (ap.days_overdue || 0) <= 0; });
  var onTimeRate = closedAPs.length > 0 ? Math.round((closedOnTime.length / closedAPs.length) * 100) : 0;

  // --- Risk Distribution ---
  var riskDistribution = { Extreme: 0, High: 0, Medium: 0, Low: 0 };
  workPapers.forEach(function(wp) {
    if (riskDistribution.hasOwnProperty(wp.risk_rating)) riskDistribution[wp.risk_rating]++;
  });

  var riskWeights = { Extreme: 100, High: 75, Medium: 50, Low: 25 };
  var totalRiskScore = 0;
  var riskCount = 0;
  workPapers.forEach(function(wp) {
    var w = riskWeights[wp.risk_rating];
    if (w !== undefined) { totalRiskScore += w; riskCount++; }
  });
  var avgRiskScore = riskCount > 0 ? Math.round(totalRiskScore / riskCount) : 0;

  // Overall health score
  var overallScore = Math.round(
    (implementationRate * 0.35) +
    (onTimeRate * 0.25) +
    ((100 - avgRiskScore) * 0.20) +
    (Math.min(100, Math.max(0, 100 - (overdueAPs.length * 5))) * 0.20)
  );
  overallScore = Math.min(100, Math.max(0, overallScore));

  // --- By Affiliate ---
  var byAffiliate = {};
  workPapers.forEach(function(wp) {
    var code = wp.affiliate_code || 'Unknown';
    if (!byAffiliate[code]) {
      byAffiliate[code] = {
        code: code, name: code, findings: 0, actionPlans: 0,
        closedAPs: 0, overdueAPs: 0, implementationRate: 0, score: 0,
        riskDistribution: { Extreme: 0, High: 0, Medium: 0, Low: 0 }
      };
    }
    byAffiliate[code].findings++;
    if (riskDistribution.hasOwnProperty(wp.risk_rating)) {
      byAffiliate[code].riskDistribution[wp.risk_rating]++;
    }
  });

  actionPlans.forEach(function(ap) {
    var wp = wpLookup[ap.work_paper_id];
    // FIX-4: Normalize affiliate — AP may have affiliate_id instead of affiliate_code
    var code = ap.affiliate_code || ap.affiliate_id || (wp ? (wp.affiliate_code || 'Unknown') : 'Unknown');
    if (!byAffiliate[code]) {
      byAffiliate[code] = {
        code: code, name: code, findings: 0, actionPlans: 0,
        closedAPs: 0, overdueAPs: 0, implementationRate: 0, score: 0,
        riskDistribution: { Extreme: 0, High: 0, Medium: 0, Low: 0 }
      };
    }
    byAffiliate[code].actionPlans++;
    if (isImplementedOrVerified(ap.status)) byAffiliate[code].closedAPs++;
    if (ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)) byAffiliate[code].overdueAPs++;
  });

  Object.keys(byAffiliate).forEach(function(key) {
    var a = byAffiliate[key];
    if (a.actionPlans > 0) {
      a.implementationRate = Math.round((a.closedAPs / a.actionPlans) * 100);
      var overdueRate = (a.overdueAPs / a.actionPlans) * 100;
      a.score = Math.round(
        (a.implementationRate * 0.50) +
        ((100 - overdueRate) * 0.30) +
        (Math.max(0, 100 - (a.findings * 5)) * 0.20)
      );
      a.score = Math.min(100, Math.max(0, a.score));
    } else {
      a.implementationRate = 0;
      a.score = a.findings === 0 ? 100 : 40;
    }
  });

  // --- By Audit Area (Performance Scorecard) ---
  var byAuditArea = {};
  workPapers.forEach(function(wp) {
    var areaId = wp.audit_area_id || 'Unknown';
    var areaName = wp.audit_area_name || areaId;
    if (!byAuditArea[areaId]) {
      byAuditArea[areaId] = {
        id: areaId, name: areaName, findings: 0, actionPlans: 0,
        closedAPs: 0, overdueAPs: 0, implementationRate: 0,
        score: 0, rating: 'N/A',
        riskDistribution: { Extreme: 0, High: 0, Medium: 0, Low: 0 }
      };
    }
    byAuditArea[areaId].findings++;
    if (byAuditArea[areaId].riskDistribution.hasOwnProperty(wp.risk_rating)) {
      byAuditArea[areaId].riskDistribution[wp.risk_rating]++;
    }
  });

  actionPlans.forEach(function(ap) {
    var wp = wpLookup[ap.work_paper_id];
    // FIX-2: Use AP's own audit_area_id (denormalized) or fall back to parent WP
    var areaId = ap.audit_area_id || (wp ? (wp.audit_area_id || 'Unknown') : 'Unknown');
    if (!byAuditArea[areaId]) {
      var areaName = ap.audit_area_name || (wp ? (wp.audit_area_name || areaId) : areaId);
      byAuditArea[areaId] = {
        id: areaId, name: areaName, findings: 0, actionPlans: 0,
        closedAPs: 0, overdueAPs: 0, implementationRate: 0,
        score: 0, rating: 'N/A',
        riskDistribution: { Extreme: 0, High: 0, Medium: 0, Low: 0 }
      };
    }
    byAuditArea[areaId].actionPlans++;
    if (isImplementedOrVerified(ap.status)) byAuditArea[areaId].closedAPs++;
    if (ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)) byAuditArea[areaId].overdueAPs++;
  });

  Object.keys(byAuditArea).forEach(function(key) {
    var a = byAuditArea[key];
    if (a.actionPlans > 0) {
      a.implementationRate = Math.round((a.closedAPs / a.actionPlans) * 100);
      var overdueRate = (a.overdueAPs / a.actionPlans) * 100;
      a.score = Math.round(
        (a.implementationRate * 0.40) +
        ((100 - overdueRate) * 0.35) +
        (Math.max(0, 100 - (a.findings * 3)) * 0.25)
      );
      a.score = Math.min(100, Math.max(0, a.score));
    } else {
      a.implementationRate = 0;
      a.score = a.findings === 0 ? 100 : 40;
    }
    // Control effectiveness rating
    if (a.score >= 80) a.rating = 'Effective';
    else if (a.score >= 60) a.rating = 'Needs Improvement';
    else a.rating = 'Ineffective';
  });

  // --- Aging Analysis ---
  var aging = {
    current:       { count: 0, items: [] },
    overdue1to30:  { count: 0, items: [] },
    overdue31to60: { count: 0, items: [] },
    overdue61to90: { count: 0, items: [] },
    overdue90plus: { count: 0, items: [] }
  };

  actionPlans.forEach(function(ap) {
    if (isImplementedOrVerified(ap.status)) return;
    var d = ap.days_overdue || 0;
    var wp = wpLookup[ap.work_paper_id];
    var item = {
      id: ap.action_plan_id,
      description: (ap.action_description || '').substring(0, 120),
      owner: ap.owner_names || '',
      dueDate: ap.due_date,
      daysOverdue: d,
      status: ap.status,
      riskRating: wp ? (wp.risk_rating || '') : '',
      affiliate: wp ? (wp.affiliate_code || '') : ''
    };
    if (d <= 0)       { aging.current.count++;       aging.current.items.push(item); }
    else if (d <= 30) { aging.overdue1to30.count++;  aging.overdue1to30.items.push(item); }
    else if (d <= 60) { aging.overdue31to60.count++; aging.overdue31to60.items.push(item); }
    else if (d <= 90) { aging.overdue61to90.count++; aging.overdue61to90.items.push(item); }
    else              { aging.overdue90plus.count++;  aging.overdue90plus.items.push(item); }
  });

  // --- 12-Month Trends ---
  var months = [];
  var now = new Date();
  for (var i = 11; i >= 0; i--) {
    var date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      year: date.getFullYear(),
      month: date.getMonth()
    });
  }

  var trends = {
    labels: months.map(function(m) { return m.label; }),
    findingsCreated:    new Array(12).fill(0),
    actionPlansCreated: new Array(12).fill(0),
    actionPlansClosed:  new Array(12).fill(0)
  };

  workPapers.forEach(function(wp) {
    var created = wp.created_at ? new Date(wp.created_at) : null;
    if (created) {
      months.forEach(function(m, idx) {
        if (created.getFullYear() === m.year && created.getMonth() === m.month) {
          trends.findingsCreated[idx]++;
        }
      });
    }
  });

  actionPlans.forEach(function(ap) {
    var created = ap.created_at ? new Date(ap.created_at) : null;
    if (created) {
      months.forEach(function(m, idx) {
        if (created.getFullYear() === m.year && created.getMonth() === m.month) {
          trends.actionPlansCreated[idx]++;
        }
      });
    }
    if (isImplementedOrVerified(ap.status)) {
      var closed = ap.updated_at ? new Date(ap.updated_at) : null;
      if (closed) {
        months.forEach(function(m, idx) {
          if (closed.getFullYear() === m.year && closed.getMonth() === m.month) {
            trends.actionPlansClosed[idx]++;
          }
        });
      }
    }
  });

  // --- Status Distributions ---
  var wpStatusDist = {};
  workPapers.forEach(function(wp) {
    wpStatusDist[wp.status] = (wpStatusDist[wp.status] || 0) + 1;
  });
  var apStatusDist = {};
  actionPlans.forEach(function(ap) {
    apStatusDist[ap.status] = (apStatusDist[ap.status] || 0) + 1;
  });

  // --- Detailed Findings (sorted by risk severity) ---
  var riskOrder = { Extreme: 0, High: 1, Medium: 2, Low: 3 };
  var findings = workPapers.map(function(wp) {
    var wpAPs = apByWp[wp.work_paper_id] || [];
    return {
      id: wp.work_paper_id,
      title: wp.observation_title || '',
      description: (wp.observation_description || '').substring(0, 250),
      affiliate: wp.affiliate_code || '',
      auditArea: wp.audit_area_name || wp.audit_area_id || '',
      riskRating: wp.risk_rating || '',
      status: wp.status || '',
      date: wp.work_paper_date || wp.created_at || '',
      preparedBy: wp.prepared_by_name || '',
      recommendation: (wp.recommendation || '').substring(0, 250),
      actionPlansTotal: wpAPs.length,
      actionPlansClosed: wpAPs.filter(function(ap) { return isImplementedOrVerified(ap.status); }).length,
      actionPlansOverdue: wpAPs.filter(function(ap) { return ap.days_overdue > 0 && !isImplementedOrVerified(ap.status); }).length
    };
  });
  findings.sort(function(a, b) { return (riskOrder[a.riskRating] || 99) - (riskOrder[b.riskRating] || 99); });

  console.log('getComprehensiveReportData completed in', new Date().getTime() - startTime, 'ms');

  return sanitizeForClient({
    generatedAt: new Date(),
    filters: filters,
    workPapers: workPapers,
    actionPlans: actionPlans,
    executive: {
      totalFindings: totalFindings,
      totalActionPlans: totalAPs,
      closedActionPlans: closedAPs.length,
      overdueActionPlans: overdueAPs.length,
      implementationRate: implementationRate,
      onTimeClosureRate: onTimeRate,
      avgRiskScore: avgRiskScore,
      riskDistribution: riskDistribution,
      overallScore: overallScore
    },
    byAffiliate: Object.keys(byAffiliate).map(function(k) { return byAffiliate[k]; })
                  .filter(function(a) { return a.findings > 0 || a.actionPlans > 0; }),
    byAuditArea: Object.keys(byAuditArea).map(function(k) { return byAuditArea[k]; })
                  .filter(function(a) { return a.findings > 0; }),
    wpStatusDistribution: wpStatusDist,
    apStatusDistribution: apStatusDist,
    aging: aging,
    trends: trends,
    findings: findings
  });
}

// ─────────────────────────────────────────────────────────────
// Dashboard V2 — Single-call API for redesigned dashboard
// ─────────────────────────────────────────────────────────────

/**
 * getDashboardDataV2(params, callerUser)
 *
 * Returns observations and action plans with computed fields, scoped by role:
 *  - SUPER_ADMIN / SENIOR_AUDITOR / AUDITOR: full data via getFullDashboardData_
 *  - SENIOR_MGMT / UNIT_MANAGER / BOARD_MEMBER / EXTERNAL_AUDITOR: management view
 *  - JUNIOR_STAFF / AUDITEE: own action plans + sent observations only
 */
function getDashboardDataV2(params, callerUser) {
  try {
    if (!callerUser) return { success: false, error: 'Auth required' };

    params = params || {};

    var isSuperOrSenior = callerUser.role_code === ROLES.SUPER_ADMIN ||
                          callerUser.role_code === ROLES.SENIOR_AUDITOR;
    var isAuditTeam     = isSuperOrSenior ||
                          callerUser.role_code === ROLES.AUDITOR;
    var isManagement    = callerUser.role_code === ROLES.SENIOR_MGMT ||
                          callerUser.role_code === ROLES.UNIT_MANAGER ||
                          callerUser.role_code === ROLES.BOARD_MEMBER ||
                          callerUser.role_code === ROLES.EXTERNAL_AUDITOR;
    var isAuditee       = callerUser.role_code === ROLES.JUNIOR_STAFF;

    if (isAuditTeam)    return getFullDashboardData_(callerUser, isSuperOrSenior);
    if (isManagement)   return getManagementDashboardData_(callerUser);
    if (isAuditee)      return getAuditeeDashboardData_(callerUser);

    return { success: false, error: 'Access denied' };

  } catch (e) {
    console.error('getDashboardDataV2 error:', e);
    return { success: false, error: 'Failed to load dashboard data: ' + e.message };
  }
}

/**
 * Full dashboard data for audit team (SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR).
 */
function getFullDashboardData_(callerUser, isAdmin) {
  var startTime = new Date().getTime();

  var workPapers  = getWorkPapers({}, null);
  var actionPlans = getActionPlans({}, null);

  var result = buildDashboardPayload_(workPapers, actionPlans, callerUser);

  console.log('getFullDashboardData_ completed in', new Date().getTime() - startTime, 'ms',
    '— observations:', result.observations.length, ', actionPlans:', result.actionPlans.length);

  return sanitizeForClient(result);
}

/**
 * Management/Board view: approved/sent work papers + visible action plan counts only.
 * No work-in-progress or draft observations.
 */
function getManagementDashboardData_(callerUser) {
  var startTime = new Date().getTime();

  var workPapers = getWorkPapers({ status: 'Approved' }, null)
    .concat(getWorkPapers({ status: 'Sent to Auditee' }, null));

  // Visible action plans: closed/verified statuses only for read-only roles
  var actionPlans;
  var readOnlyRoles = [ROLES.BOARD_MEMBER, ROLES.EXTERNAL_AUDITOR];
  if (readOnlyRoles.indexOf(callerUser.role_code) >= 0) {
    actionPlans = getActionPlans({}, null).filter(function(ap) {
      return ['Implemented', 'Verified', 'Closed'].indexOf(ap.status) >= 0;
    });
  } else {
    actionPlans = getActionPlans({}, null);
  }

  var result = buildDashboardPayload_(workPapers, actionPlans, callerUser);

  console.log('getManagementDashboardData_ completed in', new Date().getTime() - startTime, 'ms');

  return sanitizeForClient(result);
}

/**
 * Auditee view: own action plans + observations sent to this user only.
 */
function getAuditeeDashboardData_(callerUser) {
  var startTime = new Date().getTime();
  var userId = callerUser.user_id || '';

  // Only observations sent to this auditee (Sent to Auditee status, responsible_ids includes user)
  var allWPs = getWorkPapers({ status: 'Sent to Auditee' }, null);
  var workPapers = allWPs.filter(function(wp) {
    var responsible = String(wp.responsible_ids || '').split(',').map(function(s) { return s.trim(); });
    return responsible.indexOf(userId) >= 0;
  });

  // Only action plans owned by this user
  var actionPlans = userId ? getActionPlans({ owner_id: userId }, callerUser) : [];

  var result = buildDashboardPayload_(workPapers, actionPlans, callerUser);

  console.log('getAuditeeDashboardData_ completed in', new Date().getTime() - startTime, 'ms');

  return sanitizeForClient(result);
}

/**
 * Shared payload builder: enriches work papers and action plans, computes metadata.
 */
function buildDashboardPayload_(workPapers, actionPlans, callerUser) {
  // ── Build area lookup for enrichment ──
  var areaLookup = {};
  try {
    var areaData = tursoGetAll('07_AuditAreas');
    areaData.forEach(function(area) {
      if (area.area_id) areaLookup[area.area_id] = area.area_name || area.area_code || area.area_id;
      if (area.area_code && !areaLookup[area.area_code]) areaLookup[area.area_code] = area.area_name || area.area_code;
    });
  } catch (e) { console.warn('buildDashboardPayload_: area lookup failed:', e.message); }

  // ── Build lookup: work_paper_id → action plans[] ──
  var apByWp = {};
  actionPlans.forEach(function(ap) {
    var wpId = ap.work_paper_id;
    if (!apByWp[wpId]) apByWp[wpId] = [];
    apByWp[wpId].push(ap);
  });

  // ── Build WP lookup for AP enrichment ──
  var wpLookup = {};
  workPapers.forEach(function(wp) { wpLookup[wp.work_paper_id] = wp; });

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var closedStatuses = ['Implemented', 'Verified', 'Not Implemented', 'Closed', 'Rejected'];

  // ── Compute per-observation fields ──
  var observations = workPapers.map(function(wp) {
    if (!wp.audit_area_name && wp.audit_area_id && areaLookup[wp.audit_area_id]) {
      wp.audit_area_name = areaLookup[wp.audit_area_id];
    }
    var linkedAPs = apByWp[wp.work_paper_id] || [];
    wp.action_plan_count = linkedAPs.length;
    wp.overdue_ap_count = linkedAPs.filter(function(ap) {
      if (closedStatuses.indexOf(ap.status) !== -1) return false;
      if (!ap.due_date) return false;
      var due = new Date(ap.due_date);
      due.setHours(0, 0, 0, 0);
      return due < today;
    }).length;
    return wp;
  });

  // ── Compute per-action-plan fields ──
  var enrichedAPs = actionPlans.map(function(ap) {
    if (closedStatuses.indexOf(ap.status) === -1 && ap.due_date) {
      var due = new Date(ap.due_date);
      due.setHours(0, 0, 0, 0);
      ap.days_overdue = Math.max(0, Math.floor((today - due) / 86400000));
    } else {
      ap.days_overdue = 0;
    }
    var parentWP = wpLookup[ap.work_paper_id];
    if (parentWP) {
      ap.affiliate_code  = ap.affiliate_code  || ap.affiliate_id || parentWP.affiliate_code  || '';
      ap.audit_area_id   = ap.audit_area_id   || parentWP.audit_area_id   || '';
      ap.audit_area_name = ap.audit_area_name || parentWP.audit_area_name || '';
      ap.risk_rating     = ap.risk_rating     || parentWP.risk_rating     || '';
    } else {
      ap.affiliate_code  = ap.affiliate_code  || ap.affiliate_id || '';
      ap.audit_area_id   = ap.audit_area_id   || '';
      ap.audit_area_name = ap.audit_area_name || '';
    }
    return ap;
  });

  // ── Extract metadata ──
  var affiliateSet = {};
  var auditAreaSet = {};
  var yearSet = {};
  var earliestDate = null;

  observations.forEach(function(wp) {
    if (wp.affiliate_code) affiliateSet[wp.affiliate_code] = true;
    var areaName = wp.audit_area_name || wp.audit_area_id;
    if (areaName) auditAreaSet[areaName] = true;
    var d = wp.created_at ? new Date(wp.created_at) : null;
    if (d && !isNaN(d.getTime())) {
      yearSet[d.getFullYear()] = true;
      if (!earliestDate || d < earliestDate) earliestDate = d;
    }
  });

  enrichedAPs.forEach(function(ap) {
    if (ap.affiliate_code) affiliateSet[ap.affiliate_code] = true;
    var dateStr = ap.created_at || ap.updated_at || ap.due_date;
    var d = dateStr ? new Date(dateStr) : null;
    if (d && !isNaN(d.getTime())) {
      yearSet[d.getFullYear()] = true;
      if (!earliestDate || d < earliestDate) earliestDate = d;
    }
  });

  return {
    success: true,
    observations: observations,
    actionPlans: enrichedAPs,
    meta: {
      affiliates:        Object.keys(affiliateSet).sort(),
      auditAreas:        Object.keys(auditAreaSet).sort(),
      years:             Object.keys(yearSet).map(Number).sort(function(a, b) { return a - b; }),
      earliestDate:      earliestDate ? earliestDate.toISOString() : null,
      totalObservations: observations.length,
      totalActionPlans:  enrichedAPs.length
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Dashboard Summary - Atomic increment/decrement helpers
// ─────────────────────────────────────────────────────────────

/**
 * Update the cached dashboard summary when a work paper status changes.
 * Uses partial Firestore update for efficiency.
 * @param {string} oldStatus - Previous status (null for new WPs)
 * @param {string} newStatus - New status (null for deleted WPs)
 */
function updateDashboardSummary_WPStatus(oldStatus, newStatus) {
  try {
    var raw = tursoGetConfig('dashboard_summary', 'GLOBAL');
    var summary = raw ? JSON.parse(raw) : {};

    var wpByStatus = summary.wp_by_status || {};
    if (oldStatus) wpByStatus[oldStatus] = Math.max(0, (wpByStatus[oldStatus] || 0) - 1);
    if (newStatus) wpByStatus[newStatus] = (wpByStatus[newStatus] || 0) + 1;

    summary.wp_by_status = wpByStatus;
    summary.last_updated = new Date().toISOString();
    tursoSetConfig('dashboard_summary', JSON.stringify(summary), 'GLOBAL');
  } catch (e) {
    console.warn('Dashboard summary update (WP) failed:', e.message);
  }
}

/**
 * Update the cached dashboard summary when an action plan status changes.
 * @param {string} oldStatus - Previous status (null for new APs)
 * @param {string} newStatus - New status (null for deleted APs)
 */
function updateDashboardSummary_APStatus(oldStatus, newStatus) {
  try {
    var raw = tursoGetConfig('dashboard_summary', 'GLOBAL');
    var summary = raw ? JSON.parse(raw) : {};

    var apByStatus = summary.ap_by_status || {};
    if (oldStatus) apByStatus[oldStatus] = Math.max(0, (apByStatus[oldStatus] || 0) - 1);
    if (newStatus) apByStatus[newStatus] = (apByStatus[newStatus] || 0) + 1;

    summary.ap_by_status = apByStatus;
    summary.last_updated = new Date().toISOString();
    tursoSetConfig('dashboard_summary', JSON.stringify(summary), 'GLOBAL');
  } catch (e) {
    console.warn('Dashboard summary update (AP) failed:', e.message);
  }
}

/**
 * Rebuild dashboard summary from scratch (run periodically or after data changes).
 * @return {Object} The rebuilt summary
 */
function rebuildDashboardSummary() {
  var wpStatusRows = tursoQuery_SQL(
    'SELECT status, COUNT(*) as cnt FROM work_papers WHERE deleted_at IS NULL GROUP BY status', []
  );
  var apStatusRows = tursoQuery_SQL(
    'SELECT status, COUNT(*) as cnt FROM action_plans WHERE deleted_at IS NULL GROUP BY status', []
  );

  var wpByStatus = {};
  var wpTotal = 0;
  wpStatusRows.forEach(function(r) { wpByStatus[r.status || 'Unknown'] = r.cnt; wpTotal += r.cnt; });

  var apByStatus = {};
  var apTotal = 0;
  apStatusRows.forEach(function(r) { apByStatus[r.status || 'Unknown'] = r.cnt; apTotal += r.cnt; });

  var summary = {
    wp_total:     wpTotal,
    ap_total:     apTotal,
    wp_by_status: wpByStatus,
    ap_by_status: apByStatus,
    last_updated: new Date().toISOString()
  };

  tursoSetConfig('dashboard_summary', JSON.stringify(summary), 'GLOBAL');
  return summary;
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)
