// 10_ReportService.gs - Professional Report Generation Engine
// Provides enterprise-grade internal audit reports with scoring, analytics, and export

/**
 * Master report dispatcher - generates any report type with filters
 */
function generateReport(reportType, filters, user) {
  filters = filters || {};

  try {
    switch (reportType) {
      case 'executive_summary':
        return generateExecutiveSummary(filters);
      case 'audit_area_scorecard':
        return generateAuditAreaScorecard(filters);
      case 'finding_tracker':
        return generateFindingTracker(filters);
      case 'action_plan_status':
        return generateActionPlanStatusReport(filters);
      case 'implementation_rate':
        return generateImplementationRateReport(filters);
      case 'overdue_aging':
        return generateOverdueAgingReport(filters);
      case 'risk_heat_map':
        return generateRiskHeatMapReport(filters);
      case 'auditor_productivity':
        return generateAuditorProductivityReport(filters);
      case 'repeat_findings':
        return generateRepeatFindingsReport(filters);
      case 'management_action_plan':
        return generateManagementActionPlanReport(filters);
      default:
        return { success: false, error: 'Unknown report type: ' + reportType };
    }
  } catch (e) {
    console.error('Report generation error:', e);
    return { success: false, error: 'Report generation failed: ' + e.message };
  }
}

// =============================================
// DATA LOADING HELPERS
// =============================================

function _loadReportData(filters) {
  var workPapers = getWorkPapers(filters, null);
  var actionPlans = getActionPlans(filters, null);
  var now = new Date();
  var year = filters.year || now.getFullYear();

  // Build work paper lookup
  var wpMap = {};
  workPapers.forEach(function(wp) { wpMap[wp.work_paper_id] = wp; });

  // Link action plans to work papers
  actionPlans.forEach(function(ap) {
    ap._wp = wpMap[ap.work_paper_id] || {};
  });

  return { workPapers: workPapers, actionPlans: actionPlans, wpMap: wpMap, now: now, year: year };
}

function _getAuditAreaName(areaId) {
  if (!areaId) return 'Unknown';
  try {
    var dropdowns = getDropdownDataCached();
    var area = (dropdowns.auditAreas || []).find(function(a) { return a.id === areaId; });
    return area ? (area.name || area.display || areaId) : areaId;
  } catch(e) { return areaId; }
}

function _getAffiliateName(code) {
  if (!code) return 'Unknown';
  try {
    var dropdowns = getDropdownDataCached();
    var aff = (dropdowns.affiliates || []).find(function(a) { return a.code === code; });
    return aff ? (aff.name || aff.display || code) : code;
  } catch(e) { return code; }
}

// =============================================
// AUDIT AREA PERFORMANCE SCORING
// =============================================

/**
 * Scores audit areas on a 0-100 scale based on:
 * - Finding severity distribution (25%)
 * - Action plan implementation rate (30%)
 * - Timeliness of implementation (20%)
 * - Repeat/recurring findings (15%)
 * - Current overdue count (10%)
 */
function scoreAuditArea(areaId, workPapers, actionPlans) {
  var areaWPs = workPapers.filter(function(wp) { return wp.audit_area_id === areaId; });
  var areaWPIds = areaWPs.map(function(wp) { return wp.work_paper_id; });
  var areaAPs = actionPlans.filter(function(ap) { return areaWPIds.indexOf(ap.work_paper_id) >= 0; });

  if (areaWPs.length === 0) return { score: null, grade: 'N/A', details: {} };

  // 1. Finding Severity Score (25%) - fewer high/extreme findings = better
  var severityWeights = { 'Extreme': 0, 'High': 25, 'Medium': 65, 'Low': 100 };
  var severityTotal = 0;
  areaWPs.forEach(function(wp) {
    severityTotal += (severityWeights[wp.risk_rating] !== undefined ? severityWeights[wp.risk_rating] : 50);
  });
  var severityScore = areaWPs.length > 0 ? severityTotal / areaWPs.length : 50;

  // 2. Implementation Rate Score (30%)
  var implementedCount = areaAPs.filter(function(ap) {
    return isImplementedOrVerified(ap.status);
  }).length;
  var implRate = areaAPs.length > 0 ? (implementedCount / areaAPs.length) * 100 : 100;

  // 3. Timeliness Score (20%) - % implemented on time vs overdue
  var onTime = 0;
  var late = 0;
  areaAPs.forEach(function(ap) {
    if (isImplementedOrVerified(ap.status)) {
      if (ap.implemented_date && ap.due_date) {
        var impl = new Date(ap.implemented_date);
        var due = new Date(ap.due_date);
        if (impl <= due) onTime++; else late++;
      } else {
        onTime++; // Assume on-time if dates missing
      }
    }
  });
  var timelinessScore = (onTime + late) > 0 ? (onTime / (onTime + late)) * 100 : 100;

  // 4. Repeat Findings Score (15%) - look for similar titles across years
  var titles = areaWPs.map(function(wp) { return (wp.observation_title || '').toLowerCase().trim(); });
  var uniqueTitles = [];
  titles.forEach(function(t) { if (t && uniqueTitles.indexOf(t) < 0) uniqueTitles.push(t); });
  var repeatRatio = titles.length > 0 ? uniqueTitles.length / titles.length : 1;
  var repeatScore = repeatRatio * 100;

  // 5. Overdue Score (10%) - fewer overdue = better
  var overdueCount = areaAPs.filter(function(ap) {
    return (ap.days_overdue > 0) && !isImplementedOrVerified(ap.status);
  }).length;
  var overdueScore = areaAPs.length > 0 ? Math.max(0, 100 - (overdueCount / areaAPs.length) * 100) : 100;

  // Weighted total
  var totalScore = Math.round(
    (severityScore * 0.25) +
    (implRate * 0.30) +
    (timelinessScore * 0.20) +
    (repeatScore * 0.15) +
    (overdueScore * 0.10)
  );

  var grade;
  if (totalScore >= 90) grade = 'A';
  else if (totalScore >= 75) grade = 'B';
  else if (totalScore >= 60) grade = 'C';
  else if (totalScore >= 45) grade = 'D';
  else grade = 'F';

  return {
    score: totalScore,
    grade: grade,
    details: {
      findingCount: areaWPs.length,
      actionPlanCount: areaAPs.length,
      severityScore: Math.round(severityScore),
      implementationRate: Math.round(implRate),
      timelinessScore: Math.round(timelinessScore),
      repeatScore: Math.round(repeatScore),
      overdueScore: Math.round(overdueScore),
      overdueCount: overdueCount,
      implementedCount: implementedCount
    }
  };
}

// =============================================
// REPORT GENERATORS
// =============================================

/**
 * 1. Executive Summary Report - Board/Audit Committee level
 */
function generateExecutiveSummary(filters) {
  var d = _loadReportData(filters);

  // Overall metrics
  var totalFindings = d.workPapers.length;
  var totalAPs = d.actionPlans.length;
  var implemented = d.actionPlans.filter(function(ap) { return isImplementedOrVerified(ap.status); }).length;
  var overdue = d.actionPlans.filter(function(ap) { return ap.days_overdue > 0 && !isImplementedOrVerified(ap.status); }).length;
  var implRate = totalAPs > 0 ? Math.round((implemented / totalAPs) * 100) : 0;

  // Risk distribution
  var riskDist = { Extreme: 0, High: 0, Medium: 0, Low: 0 };
  d.workPapers.forEach(function(wp) {
    if (riskDist[wp.risk_rating] !== undefined) riskDist[wp.risk_rating]++;
  });

  // By affiliate
  var byAffiliate = {};
  d.workPapers.forEach(function(wp) {
    var code = wp.affiliate_code || 'Unknown';
    if (!byAffiliate[code]) {
      byAffiliate[code] = { name: _getAffiliateName(code), code: code, findings: 0, high: 0, overdue: 0, implRate: 0, _impl: 0, _total: 0 };
    }
    byAffiliate[code].findings++;
    if (wp.risk_rating === 'Extreme' || wp.risk_rating === 'High') byAffiliate[code].high++;
  });

  d.actionPlans.forEach(function(ap) {
    var code = ap._wp.affiliate_code || 'Unknown';
    if (!byAffiliate[code]) {
      byAffiliate[code] = { name: _getAffiliateName(code), code: code, findings: 0, high: 0, overdue: 0, implRate: 0, _impl: 0, _total: 0 };
    }
    byAffiliate[code]._total++;
    if (isImplementedOrVerified(ap.status)) byAffiliate[code]._impl++;
    if (ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)) byAffiliate[code].overdue++;
  });

  Object.keys(byAffiliate).forEach(function(k) {
    var a = byAffiliate[k];
    a.implRate = a._total > 0 ? Math.round((a._impl / a._total) * 100) : 0;
    delete a._impl;
    delete a._total;
  });

  // Audit area scores
  var areaIds = {};
  d.workPapers.forEach(function(wp) { if (wp.audit_area_id) areaIds[wp.audit_area_id] = true; });
  var areaScores = Object.keys(areaIds).map(function(areaId) {
    var sc = scoreAuditArea(areaId, d.workPapers, d.actionPlans);
    return { areaId: areaId, areaName: _getAuditAreaName(areaId), score: sc.score, grade: sc.grade, details: sc.details };
  }).sort(function(a, b) { return (a.score || 0) - (b.score || 0); });

  // Top 5 overdue action plans
  var topOverdue = d.actionPlans.filter(function(ap) {
    return ap.days_overdue > 0 && !isImplementedOrVerified(ap.status);
  }).sort(function(a, b) { return b.days_overdue - a.days_overdue; }).slice(0, 5).map(function(ap) {
    return {
      action_plan_id: ap.action_plan_id,
      description: (ap.action_description || '').substring(0, 80),
      owner: ap.owner_names || '',
      daysOverdue: ap.days_overdue,
      dueDate: ap.due_date,
      affiliate: ap._wp.affiliate_code || '',
      auditArea: _getAuditAreaName(ap._wp.audit_area_id)
    };
  });

  return sanitizeForClient({
    success: true,
    reportType: 'executive_summary',
    title: 'Executive Summary - Internal Audit Report',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    data: {
      kpis: {
        totalFindings: totalFindings,
        totalActionPlans: totalAPs,
        implementationRate: implRate,
        overdueCount: overdue,
        highRiskFindings: riskDist.Extreme + riskDist.High,
        closureRate: totalAPs > 0 ? Math.round(((implemented) / totalAPs) * 100) : 0
      },
      riskDistribution: riskDist,
      byAffiliate: Object.values(byAffiliate).sort(function(a, b) { return b.findings - a.findings; }),
      areaScores: areaScores,
      topOverdue: topOverdue
    }
  });
}

/**
 * 2. Audit Area Scorecard - Performance scoring for each audit area
 */
function generateAuditAreaScorecard(filters) {
  var d = _loadReportData(filters);

  var areaIds = {};
  d.workPapers.forEach(function(wp) { if (wp.audit_area_id) areaIds[wp.audit_area_id] = true; });

  var scorecards = Object.keys(areaIds).map(function(areaId) {
    var sc = scoreAuditArea(areaId, d.workPapers, d.actionPlans);
    var areaWPs = d.workPapers.filter(function(wp) { return wp.audit_area_id === areaId; });

    // Risk breakdown for this area
    var riskBreakdown = { Extreme: 0, High: 0, Medium: 0, Low: 0 };
    areaWPs.forEach(function(wp) {
      if (riskBreakdown[wp.risk_rating] !== undefined) riskBreakdown[wp.risk_rating]++;
    });

    return {
      areaId: areaId,
      areaName: _getAuditAreaName(areaId),
      score: sc.score,
      grade: sc.grade,
      details: sc.details,
      riskBreakdown: riskBreakdown,
      findings: areaWPs.map(function(wp) {
        return {
          id: wp.work_paper_id,
          title: wp.observation_title,
          risk: wp.risk_rating,
          status: wp.status,
          affiliate: wp.affiliate_code
        };
      })
    };
  }).sort(function(a, b) { return (a.score || 0) - (b.score || 0); });

  return sanitizeForClient({
    success: true,
    reportType: 'audit_area_scorecard',
    title: 'Audit Area Performance Scorecard',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    scoringMethodology: {
      severity: '25% - Lower severity findings score higher',
      implementation: '30% - Higher implementation rate scores higher',
      timeliness: '20% - On-time implementations score higher',
      repeatFindings: '15% - Fewer repeat findings score higher',
      overdue: '10% - Fewer overdue items score higher'
    },
    data: { scorecards: scorecards }
  });
}

/**
 * 3. Finding Tracker - All findings with current status
 */
function generateFindingTracker(filters) {
  var d = _loadReportData(filters);

  var findings = d.workPapers.map(function(wp) {
    var wpAPs = d.actionPlans.filter(function(ap) { return ap.work_paper_id === wp.work_paper_id; });
    var totalAPs = wpAPs.length;
    var closedAPs = wpAPs.filter(function(ap) { return isImplementedOrVerified(ap.status); }).length;
    var overdueAPs = wpAPs.filter(function(ap) { return ap.days_overdue > 0 && !isImplementedOrVerified(ap.status); }).length;

    return {
      workPaperId: wp.work_paper_id,
      title: wp.observation_title,
      description: (wp.observation_description || '').substring(0, 150),
      affiliate: wp.affiliate_code,
      affiliateName: _getAffiliateName(wp.affiliate_code),
      auditArea: _getAuditAreaName(wp.audit_area_id),
      riskRating: wp.risk_rating,
      status: wp.status,
      createdAt: wp.created_at,
      totalActionPlans: totalAPs,
      closedActionPlans: closedAPs,
      overdueActionPlans: overdueAPs,
      completionPct: totalAPs > 0 ? Math.round((closedAPs / totalAPs) * 100) : 0
    };
  });

  // Sort: Extreme first, then High, etc.
  var riskOrder = { 'Extreme': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
  findings.sort(function(a, b) {
    return (riskOrder[a.riskRating] || 4) - (riskOrder[b.riskRating] || 4);
  });

  return sanitizeForClient({
    success: true,
    reportType: 'finding_tracker',
    title: 'Audit Finding Tracker',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    summary: {
      total: findings.length,
      byRisk: { Extreme: findings.filter(function(f){return f.riskRating==='Extreme';}).length, High: findings.filter(function(f){return f.riskRating==='High';}).length, Medium: findings.filter(function(f){return f.riskRating==='Medium';}).length, Low: findings.filter(function(f){return f.riskRating==='Low';}).length }
    },
    data: { findings: findings }
  });
}

/**
 * 4. Action Plan Status Report - Management view
 */
function generateActionPlanStatusReport(filters) {
  var d = _loadReportData(filters);

  var plans = d.actionPlans.map(function(ap) {
    return {
      actionPlanId: ap.action_plan_id,
      workPaperId: ap.work_paper_id,
      findingTitle: ap._wp.observation_title || '',
      description: (ap.action_description || '').substring(0, 200),
      owners: ap.owner_names || '',
      dueDate: ap.due_date,
      status: ap.status,
      daysOverdue: ap.days_overdue || 0,
      implementedDate: ap.implemented_date || '',
      verifiedDate: ap.verified_date || '',
      affiliate: ap._wp.affiliate_code || '',
      auditArea: _getAuditAreaName(ap._wp.audit_area_id),
      riskRating: ap._wp.risk_rating || ''
    };
  });

  var statusGroups = {};
  plans.forEach(function(p) {
    var s = p.status || 'Unknown';
    if (!statusGroups[s]) statusGroups[s] = [];
    statusGroups[s].push(p);
  });

  return sanitizeForClient({
    success: true,
    reportType: 'action_plan_status',
    title: 'Action Plan Status Report',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    summary: {
      total: plans.length,
      byStatus: Object.keys(statusGroups).map(function(s) { return { status: s, count: statusGroups[s].length }; }),
      implemented: plans.filter(function(p) { return p.status === 'Implemented'; }).length,
      verified: plans.filter(function(p) { return p.status === 'Verified'; }).length,
      overdue: plans.filter(function(p) { return p.daysOverdue > 0 && !isImplementedOrVerified(p.status); }).length
    },
    data: { plans: plans, byStatus: statusGroups }
  });
}

/**
 * 5. Implementation Rate Report - Trend analysis
 */
function generateImplementationRateReport(filters) {
  var d = _loadReportData(filters);

  // Monthly implementation trends
  var monthlyData = {};
  var monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  monthNames.forEach(function(m) { monthlyData[m] = { month: m, created: 0, implemented: 0, verified: 0 }; });

  d.actionPlans.forEach(function(ap) {
    if (ap.created_at) {
      var m = monthNames[new Date(ap.created_at).getMonth()];
      if (monthlyData[m]) monthlyData[m].created++;
    }
    if (ap.implemented_date) {
      var m2 = monthNames[new Date(ap.implemented_date).getMonth()];
      if (monthlyData[m2]) monthlyData[m2].implemented++;
    }
    if (ap.verified_date) {
      var m3 = monthNames[new Date(ap.verified_date).getMonth()];
      if (monthlyData[m3]) monthlyData[m3].verified++;
    }
  });

  // By affiliate
  var byAffiliate = {};
  d.actionPlans.forEach(function(ap) {
    var code = ap._wp.affiliate_code || 'Unknown';
    if (!byAffiliate[code]) byAffiliate[code] = { name: _getAffiliateName(code), total: 0, implemented: 0, verified: 0, overdue: 0 };
    byAffiliate[code].total++;
    if (ap.status === 'Implemented') byAffiliate[code].implemented++;
    if (ap.status === 'Verified') byAffiliate[code].verified++;
    if (ap.days_overdue > 0 && !isImplementedOrVerified(ap.status)) byAffiliate[code].overdue++;
  });

  Object.keys(byAffiliate).forEach(function(k) {
    var a = byAffiliate[k];
    a.rate = a.total > 0 ? Math.round(((a.implemented + a.verified) / a.total) * 100) : 0;
  });

  var totalImpl = d.actionPlans.filter(function(ap) { return isImplementedOrVerified(ap.status); }).length;

  return sanitizeForClient({
    success: true,
    reportType: 'implementation_rate',
    title: 'Action Plan Implementation Rate Analysis',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    summary: {
      totalPlans: d.actionPlans.length,
      implemented: totalImpl,
      overallRate: d.actionPlans.length > 0 ? Math.round((totalImpl / d.actionPlans.length) * 100) : 0
    },
    data: {
      monthly: Object.values(monthlyData),
      byAffiliate: Object.values(byAffiliate).sort(function(a, b) { return a.rate - b.rate; })
    }
  });
}

/**
 * 6. Overdue & Aging Report
 */
function generateOverdueAgingReport(filters) {
  var d = _loadReportData(filters);

  var openAPs = d.actionPlans.filter(function(ap) { return !isImplementedOrVerified(ap.status); });

  var buckets = {
    current: { label: 'Not Yet Due', items: [], color: '#28a745' },
    overdue1to30: { label: '1-30 Days Overdue', items: [], color: '#ffc107' },
    overdue31to60: { label: '31-60 Days Overdue', items: [], color: '#fd7e14' },
    overdue61to90: { label: '61-90 Days Overdue', items: [], color: '#dc3545' },
    overdue90plus: { label: '90+ Days Overdue', items: [], color: '#721c24' }
  };

  openAPs.forEach(function(ap) {
    var item = {
      actionPlanId: ap.action_plan_id,
      description: (ap.action_description || '').substring(0, 120),
      owners: ap.owner_names || '',
      dueDate: ap.due_date,
      daysOverdue: ap.days_overdue || 0,
      findingTitle: ap._wp.observation_title || '',
      affiliate: ap._wp.affiliate_code || '',
      riskRating: ap._wp.risk_rating || ''
    };

    var days = ap.days_overdue || 0;
    if (days <= 0) buckets.current.items.push(item);
    else if (days <= 30) buckets.overdue1to30.items.push(item);
    else if (days <= 60) buckets.overdue31to60.items.push(item);
    else if (days <= 90) buckets.overdue61to90.items.push(item);
    else buckets.overdue90plus.items.push(item);
  });

  // Sort each bucket by days overdue descending
  Object.keys(buckets).forEach(function(k) {
    buckets[k].items.sort(function(a, b) { return b.daysOverdue - a.daysOverdue; });
    buckets[k].count = buckets[k].items.length;
  });

  return sanitizeForClient({
    success: true,
    reportType: 'overdue_aging',
    title: 'Action Plan Aging & Overdue Analysis',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    summary: {
      totalOpen: openAPs.length,
      totalOverdue: openAPs.filter(function(ap) { return (ap.days_overdue || 0) > 0; }).length,
      avgDaysOverdue: openAPs.length > 0 ? Math.round(openAPs.reduce(function(sum, ap) { return sum + Math.max(0, ap.days_overdue || 0); }, 0) / Math.max(1, openAPs.filter(function(ap){return ap.days_overdue > 0;}).length)) : 0
    },
    data: { buckets: buckets }
  });
}

/**
 * 7. Risk Heat Map Report
 */
function generateRiskHeatMapReport(filters) {
  var d = _loadReportData(filters);

  // Build matrix: Affiliate x Risk Rating
  var matrix = {};
  var affiliates = [];
  var risks = ['Extreme', 'High', 'Medium', 'Low'];

  d.workPapers.forEach(function(wp) {
    var aff = wp.affiliate_code || 'Unknown';
    var risk = wp.risk_rating || 'Unrated';
    if (!matrix[aff]) {
      matrix[aff] = { affiliate: aff, affiliateName: _getAffiliateName(aff), Extreme: 0, High: 0, Medium: 0, Low: 0, Unrated: 0, total: 0 };
      affiliates.push(aff);
    }
    matrix[aff][risk] = (matrix[aff][risk] || 0) + 1;
    matrix[aff].total++;
  });

  // Also build Audit Area x Risk matrix
  var areaMatrix = {};
  d.workPapers.forEach(function(wp) {
    var area = wp.audit_area_id || 'Unknown';
    var risk = wp.risk_rating || 'Unrated';
    if (!areaMatrix[area]) {
      areaMatrix[area] = { areaId: area, areaName: _getAuditAreaName(area), Extreme: 0, High: 0, Medium: 0, Low: 0, Unrated: 0, total: 0 };
    }
    areaMatrix[area][risk] = (areaMatrix[area][risk] || 0) + 1;
    areaMatrix[area].total++;
  });

  return sanitizeForClient({
    success: true,
    reportType: 'risk_heat_map',
    title: 'Risk Heat Map',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    data: {
      byAffiliate: Object.values(matrix).sort(function(a, b) { return (b.Extreme + b.High) - (a.Extreme + a.High); }),
      byAuditArea: Object.values(areaMatrix).sort(function(a, b) { return (b.Extreme + b.High) - (a.Extreme + a.High); }),
      riskLevels: risks,
      summary: {
        totalFindings: d.workPapers.length,
        extremeHigh: d.workPapers.filter(function(wp) { return wp.risk_rating === 'Extreme' || wp.risk_rating === 'High'; }).length,
        mediumLow: d.workPapers.filter(function(wp) { return wp.risk_rating === 'Medium' || wp.risk_rating === 'Low'; }).length
      }
    }
  });
}

/**
 * 8. Auditor Productivity Report
 */
function generateAuditorProductivityReport(filters) {
  var d = _loadReportData(filters);

  var auditors = {};
  d.workPapers.forEach(function(wp) {
    var id = wp.prepared_by_id || 'unknown';
    if (!auditors[id]) {
      auditors[id] = {
        name: wp.prepared_by_name || 'Unknown',
        totalWPs: 0,
        draft: 0,
        submitted: 0,
        approved: 0,
        totalDaysToApprove: 0,
        approvedWithDates: 0,
        byRisk: { Extreme: 0, High: 0, Medium: 0, Low: 0 }
      };
    }
    auditors[id].totalWPs++;
    if (wp.status === 'Draft') auditors[id].draft++;
    if (wp.status === 'Submitted' || wp.status === 'Under Review') auditors[id].submitted++;
    if (wp.status === 'Approved' || wp.status === 'Sent to Auditee') {
      auditors[id].approved++;
      if (wp.submitted_date && wp.approved_date) {
        var days = Math.floor((new Date(wp.approved_date) - new Date(wp.submitted_date)) / 86400000);
        auditors[id].totalDaysToApprove += days;
        auditors[id].approvedWithDates++;
      }
    }
    if (auditors[id].byRisk[wp.risk_rating] !== undefined) auditors[id].byRisk[wp.risk_rating]++;
  });

  var auditorList = Object.values(auditors).map(function(a) {
    a.avgDaysToApprove = a.approvedWithDates > 0 ? Math.round(a.totalDaysToApprove / a.approvedWithDates) : null;
    a.approvalRate = a.totalWPs > 0 ? Math.round((a.approved / a.totalWPs) * 100) : 0;
    delete a.totalDaysToApprove;
    delete a.approvedWithDates;
    return a;
  }).sort(function(a, b) { return b.totalWPs - a.totalWPs; });

  return sanitizeForClient({
    success: true,
    reportType: 'auditor_productivity',
    title: 'Auditor Productivity Report',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    data: { auditors: auditorList }
  });
}

/**
 * 9. Repeat Findings Report
 */
function generateRepeatFindingsReport(filters) {
  var d = _loadReportData(filters);

  // Group by audit area, look for repeat patterns
  var byArea = {};
  d.workPapers.forEach(function(wp) {
    var area = wp.audit_area_id || 'Unknown';
    if (!byArea[area]) byArea[area] = { areaName: _getAuditAreaName(area), findings: [] };
    byArea[area].findings.push({
      id: wp.work_paper_id,
      title: wp.observation_title || '',
      year: wp.year,
      risk: wp.risk_rating,
      affiliate: wp.affiliate_code
    });
  });

  // Detect similar titles (simple approach: lowercase match)
  var repeats = [];
  Object.keys(byArea).forEach(function(area) {
    var findings = byArea[area].findings;
    var titleMap = {};
    findings.forEach(function(f) {
      var key = (f.title || '').toLowerCase().trim();
      if (!titleMap[key]) titleMap[key] = [];
      titleMap[key].push(f);
    });
    Object.keys(titleMap).forEach(function(key) {
      if (titleMap[key].length > 1) {
        repeats.push({
          auditArea: byArea[area].areaName,
          title: titleMap[key][0].title,
          occurrences: titleMap[key].length,
          instances: titleMap[key],
          years: titleMap[key].map(function(f) { return f.year; }).filter(function(v, i, a) { return a.indexOf(v) === i; })
        });
      }
    });
  });

  repeats.sort(function(a, b) { return b.occurrences - a.occurrences; });

  return sanitizeForClient({
    success: true,
    reportType: 'repeat_findings',
    title: 'Repeat & Recurring Findings Analysis',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    summary: {
      totalFindings: d.workPapers.length,
      repeatGroups: repeats.length,
      totalRepeats: repeats.reduce(function(sum, r) { return sum + r.occurrences; }, 0)
    },
    data: { repeats: repeats }
  });
}

/**
 * 10. Management Action Plan Report - Auditee/Management view
 */
function generateManagementActionPlanReport(filters) {
  var d = _loadReportData(filters);

  // Group by owner
  var byOwner = {};
  d.actionPlans.forEach(function(ap) {
    var ownerKey = ap.owner_names || 'Unassigned';
    if (!byOwner[ownerKey]) {
      byOwner[ownerKey] = { owner: ownerKey, total: 0, implemented: 0, overdue: 0, pending: 0, plans: [] };
    }
    byOwner[ownerKey].total++;
    if (isImplementedOrVerified(ap.status)) byOwner[ownerKey].implemented++;
    else if (ap.days_overdue > 0) byOwner[ownerKey].overdue++;
    else byOwner[ownerKey].pending++;

    byOwner[ownerKey].plans.push({
      actionPlanId: ap.action_plan_id,
      description: (ap.action_description || '').substring(0, 150),
      status: ap.status,
      dueDate: ap.due_date,
      daysOverdue: ap.days_overdue || 0,
      findingTitle: ap._wp.observation_title || '',
      riskRating: ap._wp.risk_rating || '',
      affiliate: ap._wp.affiliate_code || ''
    });
  });

  var ownerList = Object.values(byOwner).sort(function(a, b) { return b.overdue - a.overdue; });

  return sanitizeForClient({
    success: true,
    reportType: 'management_action_plan',
    title: 'Management Action Plan Accountability Report',
    generatedAt: new Date().toISOString(),
    period: String(d.year),
    summary: {
      totalPlans: d.actionPlans.length,
      uniqueOwners: ownerList.length,
      implemented: d.actionPlans.filter(function(ap) { return isImplementedOrVerified(ap.status); }).length,
      overdue: d.actionPlans.filter(function(ap) { return ap.days_overdue > 0 && !isImplementedOrVerified(ap.status); }).length
    },
    data: { byOwner: ownerList }
  });
}

// =============================================
// EXPORT FUNCTIONS - Word (HTML) & Excel (CSV)
// =============================================

/**
 * Generate Word-compatible HTML document for a report
 */
function exportReportAsWord(reportType, filters, user) {
  var result = generateReport(reportType, filters, user);
  if (!result.success) return result;

  var html = _buildWordHtml(result);

  return sanitizeForClient({
    success: true,
    html: html,
    filename: _sanitizeFilename(result.title) + '_' + _dateStamp() + '.doc',
    mimeType: 'application/msword'
  });
}

/**
 * Generate Excel-compatible CSV for a report
 */
function exportReportAsExcel(reportType, filters, user) {
  var result = generateReport(reportType, filters, user);
  if (!result.success) return result;

  var csv = _buildCsv(result);

  return sanitizeForClient({
    success: true,
    csv: csv,
    filename: _sanitizeFilename(result.title) + '_' + _dateStamp() + '.csv',
    mimeType: 'text/csv'
  });
}

function _dateStamp() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _sanitizeFilename(name) {
  return (name || 'report').replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '_').substring(0, 60);
}

/**
 * Build branded Word HTML document
 */
function _buildWordHtml(report) {
  var navy = '#1a365d';
  var gold = '#c9a227';
  var data = report.data || {};

  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<style>' +
    'body { font-family: Calibri, Arial, sans-serif; margin: 40px; color: #333; line-height: 1.5; }' +
    '.header { border-bottom: 3px solid ' + navy + '; padding-bottom: 15px; margin-bottom: 30px; }' +
    '.header h1 { color: ' + navy + '; font-size: 22pt; margin: 0 0 5px; }' +
    '.header .subtitle { color: ' + gold + '; font-size: 12pt; font-weight: bold; }' +
    '.header .meta { color: #666; font-size: 9pt; margin-top: 8px; }' +
    '.section { margin-bottom: 25px; page-break-inside: avoid; }' +
    '.section h2 { color: ' + navy + '; font-size: 14pt; border-bottom: 1px solid #ddd; padding-bottom: 5px; }' +
    '.section h3 { color: ' + navy + '; font-size: 12pt; }' +
    'table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9pt; }' +
    'th { background-color: ' + navy + '; color: white; padding: 8px 10px; text-align: left; font-weight: bold; }' +
    'td { padding: 6px 10px; border-bottom: 1px solid #e0e0e0; }' +
    'tr:nth-child(even) { background-color: #f8f9fb; }' +
    '.kpi-row { display: flex; gap: 20px; margin: 15px 0; }' +
    '.kpi-box { flex: 1; padding: 15px; background: #f8f9fb; border-left: 4px solid ' + navy + '; }' +
    '.kpi-box .value { font-size: 24pt; font-weight: bold; color: ' + navy + '; }' +
    '.kpi-box .label { font-size: 9pt; color: #666; text-transform: uppercase; }' +
    '.badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 8pt; font-weight: bold; color: white; }' +
    '.badge-extreme { background: #dc3545; } .badge-high { background: #fd7e14; }' +
    '.badge-medium { background: #ffc107; color: #333; } .badge-low { background: #28a745; }' +
    '.grade-a { color: #28a745; } .grade-b { color: #17a2b8; } .grade-c { color: #ffc107; } .grade-d { color: #fd7e14; } .grade-f { color: #dc3545; }' +
    '.footer { border-top: 2px solid ' + navy + '; margin-top: 40px; padding-top: 10px; font-size: 8pt; color: #999; text-align: center; }' +
    '.footer .company { color: ' + navy + '; font-weight: bold; font-size: 9pt; }' +
    '.confidential { color: #dc3545; font-weight: bold; font-size: 8pt; text-transform: uppercase; letter-spacing: 2px; }' +
    '</style></head><body>';

  // Header
  html += '<div class="header">' +
    '<p class="confidential">Confidential</p>' +
    '<h1>' + _escHtml(report.title || 'Report') + '</h1>' +
    '<div class="subtitle">Hass Petroleum - Internal Audit Department</div>' +
    '<div class="meta">Period: ' + _escHtml(report.period || '') + ' | Generated: ' + new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'}) + '</div>' +
    '</div>';

  // Report-type specific content
  switch (report.reportType) {
    case 'executive_summary':
      html += _wordExecSummary(data);
      break;
    case 'audit_area_scorecard':
      html += _wordScorecard(data);
      break;
    case 'finding_tracker':
      html += _wordFindingTracker(data, report.summary);
      break;
    case 'action_plan_status':
      html += _wordActionPlanStatus(data, report.summary);
      break;
    case 'overdue_aging':
      html += _wordOverdueAging(data, report.summary);
      break;
    case 'risk_heat_map':
      html += _wordRiskHeatMap(data);
      break;
    case 'auditor_productivity':
      html += _wordAuditorProductivity(data);
      break;
    case 'implementation_rate':
      html += _wordImplementationRate(data, report.summary);
      break;
    case 'repeat_findings':
      html += _wordRepeatFindings(data, report.summary);
      break;
    case 'management_action_plan':
      html += _wordManagementAP(data, report.summary);
      break;
    default:
      html += '<p>Report data available but no Word template for type: ' + report.reportType + '</p>';
  }

  // Footer
  html += '<div class="footer">' +
    '<div class="company">Hass Petroleum - Internal Audit Department</div>' +
    '<div>This report is confidential and intended solely for the use of authorized personnel.</div>' +
    '<div style="margin-top: 5px; border-top: 1px solid ' + gold + '; padding-top: 5px;">Page generated by Hass Petroleum Internal Audit System &copy; ' + new Date().getFullYear() + '</div>' +
    '</div>';

  html += '</body></html>';
  return html;
}

function _escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _riskBadge(r) { return '<span class="badge badge-' + (r||'').toLowerCase() + '">' + _escHtml(r) + '</span>'; }
function _gradeClass(g) { return 'grade-' + (g||'f').toLowerCase(); }

function _wordExecSummary(data) {
  var html = '';
  var kpis = data.kpis || {};

  html += '<div class="section"><h2>Key Performance Indicators</h2>';
  html += '<table><tr>';
  html += '<td style="text-align:center; padding:15px; border:1px solid #ddd;"><div style="font-size:24pt; font-weight:bold; color:#1a365d;">' + (kpis.totalFindings||0) + '</div><div style="font-size:8pt; color:#666;">TOTAL FINDINGS</div></td>';
  html += '<td style="text-align:center; padding:15px; border:1px solid #ddd;"><div style="font-size:24pt; font-weight:bold; color:#1a365d;">' + (kpis.implementationRate||0) + '%</div><div style="font-size:8pt; color:#666;">IMPLEMENTATION RATE</div></td>';
  html += '<td style="text-align:center; padding:15px; border:1px solid #ddd;"><div style="font-size:24pt; font-weight:bold; color:#dc3545;">' + (kpis.overdueCount||0) + '</div><div style="font-size:8pt; color:#666;">OVERDUE ITEMS</div></td>';
  html += '<td style="text-align:center; padding:15px; border:1px solid #ddd;"><div style="font-size:24pt; font-weight:bold; color:#fd7e14;">' + (kpis.highRiskFindings||0) + '</div><div style="font-size:8pt; color:#666;">HIGH/EXTREME RISK</div></td>';
  html += '</tr></table></div>';

  // Risk distribution
  var rd = data.riskDistribution || {};
  html += '<div class="section"><h2>Risk Distribution</h2>';
  html += '<table><tr><th>Risk Level</th><th>Count</th><th>Proportion</th></tr>';
  var total = (rd.Extreme||0)+(rd.High||0)+(rd.Medium||0)+(rd.Low||0);
  ['Extreme','High','Medium','Low'].forEach(function(r) {
    var pct = total > 0 ? Math.round(((rd[r]||0)/total)*100) : 0;
    html += '<tr><td>' + _riskBadge(r) + '</td><td>' + (rd[r]||0) + '</td><td>' + pct + '%</td></tr>';
  });
  html += '</table></div>';

  // Affiliate summary
  html += '<div class="section"><h2>Summary by Affiliate</h2>';
  html += '<table><tr><th>Affiliate</th><th>Findings</th><th>High/Extreme</th><th>Overdue APs</th><th>Implementation Rate</th></tr>';
  (data.byAffiliate||[]).forEach(function(a) {
    html += '<tr><td>' + _escHtml(a.name) + '</td><td>' + a.findings + '</td><td>' + a.high + '</td><td>' + a.overdue + '</td><td>' + a.implRate + '%</td></tr>';
  });
  html += '</table></div>';

  // Area performance
  if (data.areaScores && data.areaScores.length > 0) {
    html += '<div class="section"><h2>Audit Area Performance</h2>';
    html += '<table><tr><th>Audit Area</th><th>Score</th><th>Grade</th><th>Findings</th><th>Impl. Rate</th><th>Overdue</th></tr>';
    data.areaScores.forEach(function(a) {
      html += '<tr><td>' + _escHtml(a.areaName) + '</td><td>' + (a.score !== null ? a.score + '/100' : 'N/A') + '</td><td class="' + _gradeClass(a.grade) + '" style="font-weight:bold; font-size:14pt;">' + a.grade + '</td><td>' + (a.details.findingCount||0) + '</td><td>' + (a.details.implementationRate||0) + '%</td><td>' + (a.details.overdueCount||0) + '</td></tr>';
    });
    html += '</table></div>';
  }

  // Top overdue
  if (data.topOverdue && data.topOverdue.length > 0) {
    html += '<div class="section"><h2>Critical Overdue Items (Top 5)</h2>';
    html += '<table><tr><th>Action Plan</th><th>Owner</th><th>Days Overdue</th><th>Audit Area</th><th>Affiliate</th></tr>';
    data.topOverdue.forEach(function(o) {
      html += '<tr><td>' + _escHtml(o.description) + '</td><td>' + _escHtml(o.owner) + '</td><td style="color:#dc3545; font-weight:bold;">' + o.daysOverdue + '</td><td>' + _escHtml(o.auditArea) + '</td><td>' + _escHtml(o.affiliate) + '</td></tr>';
    });
    html += '</table></div>';
  }

  return html;
}

function _wordScorecard(data) {
  var html = '<div class="section"><h2>Scoring Methodology</h2>' +
    '<table><tr><th>Component</th><th>Weight</th><th>Description</th></tr>' +
    '<tr><td>Finding Severity</td><td>25%</td><td>Lower severity findings score higher</td></tr>' +
    '<tr><td>Implementation Rate</td><td>30%</td><td>Higher implementation rate scores higher</td></tr>' +
    '<tr><td>Timeliness</td><td>20%</td><td>On-time implementations score higher</td></tr>' +
    '<tr><td>Repeat Findings</td><td>15%</td><td>Fewer repeat findings score higher</td></tr>' +
    '<tr><td>Overdue Items</td><td>10%</td><td>Fewer overdue items score higher</td></tr>' +
    '</table></div>';

  (data.scorecards || []).forEach(function(sc) {
    html += '<div class="section"><h3>' + _escHtml(sc.areaName) + ' — <span class="' + _gradeClass(sc.grade) + '">' + sc.grade + ' (' + sc.score + '/100)</span></h3>';
    html += '<table><tr><th>Metric</th><th>Score</th></tr>';
    html += '<tr><td>Finding Severity</td><td>' + (sc.details.severityScore||0) + '/100</td></tr>';
    html += '<tr><td>Implementation Rate</td><td>' + (sc.details.implementationRate||0) + '%</td></tr>';
    html += '<tr><td>Timeliness</td><td>' + (sc.details.timelinessScore||0) + '/100</td></tr>';
    html += '<tr><td>Repeat Findings</td><td>' + (sc.details.repeatScore||0) + '/100</td></tr>';
    html += '<tr><td>Overdue Items</td><td>' + (sc.details.overdueScore||0) + '/100</td></tr>';
    html += '</table>';

    // Risk breakdown
    var rb = sc.riskBreakdown || {};
    html += '<p>Risk Breakdown: ' + _riskBadge('Extreme') + ' ' + (rb.Extreme||0) + ' | ' + _riskBadge('High') + ' ' + (rb.High||0) + ' | ' + _riskBadge('Medium') + ' ' + (rb.Medium||0) + ' | ' + _riskBadge('Low') + ' ' + (rb.Low||0) + '</p>';
    html += '</div>';
  });

  return html;
}

function _wordFindingTracker(data, summary) {
  var html = '<div class="section"><h2>Summary</h2>';
  var s = summary || {};
  var br = s.byRisk || {};
  html += '<p>Total Findings: <strong>' + (s.total||0) + '</strong> — ';
  html += _riskBadge('Extreme') + ' ' + (br.Extreme||0) + ' | ' + _riskBadge('High') + ' ' + (br.High||0) + ' | ' + _riskBadge('Medium') + ' ' + (br.Medium||0) + ' | ' + _riskBadge('Low') + ' ' + (br.Low||0) + '</p></div>';

  html += '<div class="section"><h2>Finding Details</h2>';
  html += '<table><tr><th>ID</th><th>Title</th><th>Affiliate</th><th>Audit Area</th><th>Risk</th><th>Status</th><th>APs</th><th>Complete</th></tr>';
  (data.findings || []).forEach(function(f) {
    html += '<tr><td>' + _escHtml(f.workPaperId) + '</td><td>' + _escHtml(f.title) + '</td><td>' + _escHtml(f.affiliateName) + '</td><td>' + _escHtml(f.auditArea) + '</td><td>' + _riskBadge(f.riskRating) + '</td><td>' + _escHtml(f.status) + '</td><td>' + f.totalActionPlans + '</td><td>' + f.completionPct + '%</td></tr>';
  });
  html += '</table></div>';
  return html;
}

function _wordActionPlanStatus(data, summary) {
  var s = summary || {};
  var html = '<div class="section"><h2>Summary</h2>';
  html += '<p>Total: <strong>' + (s.total||0) + '</strong> | Implemented: <strong>' + (s.implemented||0) + '</strong> | Verified: <strong>' + (s.verified||0) + '</strong> | Overdue: <strong style="color:#dc3545;">' + (s.overdue||0) + '</strong></p></div>';

  html += '<div class="section"><h2>All Action Plans</h2>';
  html += '<table><tr><th>ID</th><th>Finding</th><th>Description</th><th>Owner</th><th>Due Date</th><th>Status</th><th>Days Overdue</th></tr>';
  (data.plans || []).forEach(function(p) {
    var overdueStyle = p.daysOverdue > 0 && !isImplementedOrVerified(p.status) ? ' style="color:#dc3545; font-weight:bold;"' : '';
    html += '<tr><td>' + _escHtml(p.actionPlanId) + '</td><td>' + _escHtml(p.findingTitle) + '</td><td>' + _escHtml(p.description) + '</td><td>' + _escHtml(p.owners) + '</td><td>' + _escHtml(p.dueDate) + '</td><td>' + _escHtml(p.status) + '</td><td' + overdueStyle + '>' + (p.daysOverdue > 0 ? p.daysOverdue : '-') + '</td></tr>';
  });
  html += '</table></div>';
  return html;
}

function _wordOverdueAging(data, summary) {
  var s = summary || {};
  var html = '<div class="section"><h2>Summary</h2>';
  html += '<p>Total Open: <strong>' + (s.totalOpen||0) + '</strong> | Total Overdue: <strong style="color:#dc3545;">' + (s.totalOverdue||0) + '</strong> | Avg Days Overdue: <strong>' + (s.avgDaysOverdue||0) + '</strong></p></div>';

  var buckets = data.buckets || {};
  Object.keys(buckets).forEach(function(k) {
    var b = buckets[k];
    if (b.count === 0) return;
    html += '<div class="section"><h3 style="color:' + b.color + ';">' + _escHtml(b.label) + ' (' + b.count + ')</h3>';
    html += '<table><tr><th>Action Plan</th><th>Owner</th><th>Due Date</th><th>Days Overdue</th><th>Finding</th><th>Risk</th></tr>';
    b.items.forEach(function(item) {
      html += '<tr><td>' + _escHtml(item.description) + '</td><td>' + _escHtml(item.owners) + '</td><td>' + _escHtml(item.dueDate) + '</td><td style="font-weight:bold;">' + item.daysOverdue + '</td><td>' + _escHtml(item.findingTitle) + '</td><td>' + _riskBadge(item.riskRating) + '</td></tr>';
    });
    html += '</table></div>';
  });
  return html;
}

function _wordRiskHeatMap(data) {
  var html = '<div class="section"><h2>Risk Heat Map by Affiliate</h2>';
  html += '<table><tr><th>Affiliate</th><th style="background:#dc3545;">Extreme</th><th style="background:#fd7e14;">High</th><th style="background:#ffc107; color:#333;">Medium</th><th style="background:#28a745;">Low</th><th>Total</th></tr>';
  (data.byAffiliate||[]).forEach(function(a) {
    html += '<tr><td><strong>' + _escHtml(a.affiliateName) + '</strong></td><td style="text-align:center; background:' + (a.Extreme>0?'#fff5f5':'') + ';">' + (a.Extreme||0) + '</td><td style="text-align:center; background:' + (a.High>0?'#fff8f0':'') + ';">' + (a.High||0) + '</td><td style="text-align:center;">' + (a.Medium||0) + '</td><td style="text-align:center;">' + (a.Low||0) + '</td><td style="text-align:center; font-weight:bold;">' + a.total + '</td></tr>';
  });
  html += '</table></div>';

  html += '<div class="section"><h2>Risk Heat Map by Audit Area</h2>';
  html += '<table><tr><th>Audit Area</th><th style="background:#dc3545;">Extreme</th><th style="background:#fd7e14;">High</th><th style="background:#ffc107; color:#333;">Medium</th><th style="background:#28a745;">Low</th><th>Total</th></tr>';
  (data.byAuditArea||[]).forEach(function(a) {
    html += '<tr><td><strong>' + _escHtml(a.areaName) + '</strong></td><td style="text-align:center; background:' + (a.Extreme>0?'#fff5f5':'') + ';">' + (a.Extreme||0) + '</td><td style="text-align:center; background:' + (a.High>0?'#fff8f0':'') + ';">' + (a.High||0) + '</td><td style="text-align:center;">' + (a.Medium||0) + '</td><td style="text-align:center;">' + (a.Low||0) + '</td><td style="text-align:center; font-weight:bold;">' + a.total + '</td></tr>';
  });
  html += '</table></div>';
  return html;
}

function _wordAuditorProductivity(data) {
  var html = '<div class="section"><h2>Auditor Performance</h2>';
  html += '<table><tr><th>Auditor</th><th>Total WPs</th><th>Approved</th><th>Approval Rate</th><th>Avg Days to Approve</th><th>Extreme</th><th>High</th><th>Medium</th><th>Low</th></tr>';
  (data.auditors||[]).forEach(function(a) {
    html += '<tr><td>' + _escHtml(a.name) + '</td><td>' + a.totalWPs + '</td><td>' + a.approved + '</td><td>' + a.approvalRate + '%</td><td>' + (a.avgDaysToApprove !== null ? a.avgDaysToApprove + ' days' : '-') + '</td><td>' + (a.byRisk.Extreme||0) + '</td><td>' + (a.byRisk.High||0) + '</td><td>' + (a.byRisk.Medium||0) + '</td><td>' + (a.byRisk.Low||0) + '</td></tr>';
  });
  html += '</table></div>';
  return html;
}

function _wordImplementationRate(data, summary) {
  var s = summary || {};
  var html = '<div class="section"><h2>Summary</h2>';
  html += '<p>Total Plans: <strong>' + (s.totalPlans||0) + '</strong> | Implemented: <strong>' + (s.implemented||0) + '</strong> | Overall Rate: <strong>' + (s.overallRate||0) + '%</strong></p></div>';

  html += '<div class="section"><h2>Monthly Implementation Trend</h2>';
  html += '<table><tr><th>Month</th><th>Created</th><th>Implemented</th><th>Verified</th></tr>';
  (data.monthly||[]).forEach(function(m) {
    html += '<tr><td>' + m.month + '</td><td>' + m.created + '</td><td>' + m.implemented + '</td><td>' + m.verified + '</td></tr>';
  });
  html += '</table></div>';

  html += '<div class="section"><h2>Implementation Rate by Affiliate</h2>';
  html += '<table><tr><th>Affiliate</th><th>Total</th><th>Implemented</th><th>Overdue</th><th>Rate</th></tr>';
  (data.byAffiliate||[]).forEach(function(a) {
    html += '<tr><td>' + _escHtml(a.name) + '</td><td>' + a.total + '</td><td>' + (a.implemented+a.verified) + '</td><td style="color:#dc3545;">' + a.overdue + '</td><td><strong>' + a.rate + '%</strong></td></tr>';
  });
  html += '</table></div>';
  return html;
}

function _wordRepeatFindings(data, summary) {
  var s = summary || {};
  var html = '<div class="section"><h2>Summary</h2>';
  html += '<p>Total Findings: <strong>' + (s.totalFindings||0) + '</strong> | Repeat Groups: <strong style="color:#dc3545;">' + (s.repeatGroups||0) + '</strong> | Total Repeat Instances: <strong>' + (s.totalRepeats||0) + '</strong></p></div>';

  if ((data.repeats||[]).length === 0) {
    html += '<div class="section"><p>No repeat findings detected for this period.</p></div>';
  } else {
    html += '<div class="section"><h2>Repeat Finding Groups</h2>';
    html += '<table><tr><th>Finding Title</th><th>Audit Area</th><th>Occurrences</th><th>Years</th></tr>';
    (data.repeats||[]).forEach(function(r) {
      html += '<tr><td>' + _escHtml(r.title) + '</td><td>' + _escHtml(r.auditArea) + '</td><td style="font-weight:bold; color:#dc3545;">' + r.occurrences + '</td><td>' + (r.years||[]).join(', ') + '</td></tr>';
    });
    html += '</table></div>';
  }
  return html;
}

function _wordManagementAP(data, summary) {
  var s = summary || {};
  var html = '<div class="section"><h2>Summary</h2>';
  html += '<p>Total Plans: <strong>' + (s.totalPlans||0) + '</strong> | Owners: <strong>' + (s.uniqueOwners||0) + '</strong> | Implemented: <strong>' + (s.implemented||0) + '</strong> | Overdue: <strong style="color:#dc3545;">' + (s.overdue||0) + '</strong></p></div>';

  (data.byOwner||[]).forEach(function(owner) {
    html += '<div class="section"><h3>' + _escHtml(owner.owner) + '</h3>';
    html += '<p>Total: ' + owner.total + ' | Implemented: ' + owner.implemented + ' | Overdue: <span style="color:#dc3545;">' + owner.overdue + '</span> | Pending: ' + owner.pending + '</p>';
    html += '<table><tr><th>Description</th><th>Status</th><th>Due Date</th><th>Days Overdue</th><th>Risk</th></tr>';
    (owner.plans||[]).forEach(function(p) {
      html += '<tr><td>' + _escHtml(p.description) + '</td><td>' + _escHtml(p.status) + '</td><td>' + _escHtml(p.dueDate) + '</td><td>' + (p.daysOverdue > 0 ? '<strong style="color:#dc3545;">' + p.daysOverdue + '</strong>' : '-') + '</td><td>' + _riskBadge(p.riskRating) + '</td></tr>';
    });
    html += '</table></div>';
  });
  return html;
}

/**
 * Build CSV from report data - flattens to tabular format
 */
function _buildCsv(report) {
  var rows = [];
  var data = report.data || {};

  switch (report.reportType) {
    case 'executive_summary':
      rows.push(['Affiliate','Findings','High/Extreme Risk','Overdue APs','Implementation Rate']);
      (data.byAffiliate||[]).forEach(function(a) {
        rows.push([a.name, a.findings, a.high, a.overdue, a.implRate + '%']);
      });
      rows.push([]);
      rows.push(['Audit Area','Score','Grade','Findings','Impl Rate','Overdue']);
      (data.areaScores||[]).forEach(function(a) {
        rows.push([a.areaName, a.score, a.grade, a.details.findingCount, a.details.implementationRate+'%', a.details.overdueCount]);
      });
      break;

    case 'audit_area_scorecard':
      rows.push(['Audit Area','Score','Grade','Severity Score','Impl Rate','Timeliness','Repeat Score','Overdue Score','Findings','Action Plans']);
      (data.scorecards||[]).forEach(function(sc) {
        rows.push([sc.areaName, sc.score, sc.grade, sc.details.severityScore, sc.details.implementationRate+'%', sc.details.timelinessScore, sc.details.repeatScore, sc.details.overdueScore, sc.details.findingCount, sc.details.actionPlanCount]);
      });
      break;

    case 'finding_tracker':
      rows.push(['Work Paper ID','Title','Description','Affiliate','Audit Area','Risk Rating','Status','Action Plans','Closed APs','Completion %']);
      (data.findings||[]).forEach(function(f) {
        rows.push([f.workPaperId, f.title, f.description, f.affiliateName, f.auditArea, f.riskRating, f.status, f.totalActionPlans, f.closedActionPlans, f.completionPct+'%']);
      });
      break;

    case 'action_plan_status':
      rows.push(['Action Plan ID','Work Paper ID','Finding','Description','Owner','Due Date','Status','Days Overdue','Implemented Date','Affiliate','Audit Area','Risk']);
      (data.plans||[]).forEach(function(p) {
        rows.push([p.actionPlanId, p.workPaperId, p.findingTitle, p.description, p.owners, p.dueDate, p.status, p.daysOverdue, p.implementedDate, p.affiliate, p.auditArea, p.riskRating]);
      });
      break;

    case 'overdue_aging':
      rows.push(['Aging Bucket','Action Plan','Owner','Due Date','Days Overdue','Finding','Affiliate','Risk']);
      var buckets = data.buckets || {};
      Object.keys(buckets).forEach(function(k) {
        var b = buckets[k];
        (b.items||[]).forEach(function(item) {
          rows.push([b.label, item.description, item.owners, item.dueDate, item.daysOverdue, item.findingTitle, item.affiliate, item.riskRating]);
        });
      });
      break;

    case 'risk_heat_map':
      rows.push(['Entity','Type','Extreme','High','Medium','Low','Total']);
      (data.byAffiliate||[]).forEach(function(a) {
        rows.push([a.affiliateName, 'Affiliate', a.Extreme, a.High, a.Medium, a.Low, a.total]);
      });
      (data.byAuditArea||[]).forEach(function(a) {
        rows.push([a.areaName, 'Audit Area', a.Extreme, a.High, a.Medium, a.Low, a.total]);
      });
      break;

    case 'auditor_productivity':
      rows.push(['Auditor','Total WPs','Approved','Approval Rate','Avg Days to Approve','Extreme','High','Medium','Low']);
      (data.auditors||[]).forEach(function(a) {
        rows.push([a.name, a.totalWPs, a.approved, a.approvalRate+'%', a.avgDaysToApprove || 'N/A', a.byRisk.Extreme, a.byRisk.High, a.byRisk.Medium, a.byRisk.Low]);
      });
      break;

    case 'implementation_rate':
      rows.push(['Affiliate','Total','Implemented','Verified','Overdue','Rate']);
      (data.byAffiliate||[]).forEach(function(a) {
        rows.push([a.name, a.total, a.implemented, a.verified, a.overdue, a.rate+'%']);
      });
      break;

    case 'repeat_findings':
      rows.push(['Finding Title','Audit Area','Occurrences','Years']);
      (data.repeats||[]).forEach(function(r) {
        rows.push([r.title, r.auditArea, r.occurrences, (r.years||[]).join('; ')]);
      });
      break;

    case 'management_action_plan':
      rows.push(['Owner','Description','Status','Due Date','Days Overdue','Finding','Risk','Affiliate']);
      (data.byOwner||[]).forEach(function(owner) {
        (owner.plans||[]).forEach(function(p) {
          rows.push([owner.owner, p.description, p.status, p.dueDate, p.daysOverdue, p.findingTitle, p.riskRating, p.affiliate]);
        });
      });
      break;

    default:
      rows.push(['Report type not supported for CSV export']);
  }

  // Convert to CSV string
  return rows.map(function(row) {
    return row.map(function(cell) {
      var str = String(cell === null || cell === undefined ? '' : cell).replace(/"/g, '""');
      if (str.indexOf(',') >= 0 || str.indexOf('"') >= 0 || str.indexOf('\n') >= 0) {
        return '"' + str + '"';
      }
      return str;
    }).join(',');
  }).join('\n');
}
