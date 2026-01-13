/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Dashboard Service v1.1
 * 
 * Dashboard data and statistics
 * Authentication handled at frontend level via session tokens
 */

// ============================================================
// AUDITOR DASHBOARD
// ============================================================
function getAuditorDashboard(filters = {}) {
  try {
    const year = filters.year || new Date().getFullYear();
    
    // Get work papers
    const workPapers = getSheetData('09_WorkPapers')
      .filter(wp => {
        if (wp.year) return wp.year == year;
        if (wp.work_paper_date) {
          return new Date(wp.work_paper_date).getFullYear() == year;
        }
        return false;
      });
    
    // Get action plans
    const actionPlans = getSheetData('13_ActionPlans');
    const wpIds = workPapers.map(wp => wp.work_paper_id);
    const relevantAPs = actionPlans.filter(ap => wpIds.includes(ap.work_paper_id));
    
    // Calculate KPIs
    const totalWorkPapers = workPapers.length;
    const draftWPs = workPapers.filter(wp => wp.status === 'Draft').length;
    const submittedWPs = workPapers.filter(wp => wp.status === 'Submitted').length;
    const approvedWPs = workPapers.filter(wp => ['Approved', 'Sent to Auditee'].includes(wp.status)).length;
    
    const totalActionPlans = relevantAPs.length;
    const openAPs = relevantAPs.filter(ap => ap.final_status === 'Open' || ap.final_status !== 'Closed').length;
    const closedAPs = relevantAPs.filter(ap => ap.final_status === 'Closed').length;
    const overdueAPs = relevantAPs.filter(ap => {
      if (ap.final_status === 'Closed') return false;
      if (!ap.due_date) return false;
      return new Date(ap.due_date) < new Date();
    }).length;
    const pendingReviewAPs = relevantAPs.filter(ap => 
      ['Implemented', 'Pending Auditor Review', 'Pending HoA Review'].includes(ap.status)
    ).length;
    
    // Implementation rate
    const implementationRate = totalActionPlans > 0 
      ? Math.round((closedAPs / totalActionPlans) * 100) 
      : 0;
    
    // Work papers by status
    const wpByStatus = {
      Draft: draftWPs,
      Submitted: submittedWPs,
      'Under Review': workPapers.filter(wp => wp.status === 'Under Review').length,
      'Revision Requested': workPapers.filter(wp => wp.status === 'Revision Requested').length,
      Approved: workPapers.filter(wp => wp.status === 'Approved').length,
      'Sent to Auditee': workPapers.filter(wp => wp.status === 'Sent to Auditee').length
    };
    
    // Work papers by risk rating
    const wpByRisk = {
      Extreme: workPapers.filter(wp => wp.risk_rating === 'Extreme').length,
      High: workPapers.filter(wp => wp.risk_rating === 'High').length,
      Medium: workPapers.filter(wp => wp.risk_rating === 'Medium').length,
      Low: workPapers.filter(wp => wp.risk_rating === 'Low').length
    };
    
    // Work papers by affiliate
    const affiliates = getSheetData('06_Affiliates');
    const wpByAffiliate = {};
    affiliates.forEach(a => {
      wpByAffiliate[a.affiliate_code] = workPapers.filter(wp => wp.affiliate_code === a.affiliate_code).length;
    });
    
    // Action plans by status
    const apByStatus = {
      'Not Due': relevantAPs.filter(ap => ap.status === 'Not Due').length,
      'Not Implemented': relevantAPs.filter(ap => ap.status === 'Not Implemented').length,
      'Implemented': relevantAPs.filter(ap => ap.status === 'Implemented').length,
      'Pending Auditor Review': relevantAPs.filter(ap => ap.status === 'Pending Auditor Review').length,
      'Pending HoA Review': relevantAPs.filter(ap => ap.status === 'Pending HoA Review').length
    };
    
    // Recent activity (last 10 work papers)
    const recentWPs = workPapers
      .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
      .slice(0, 10)
      .map(wp => ({
        work_paper_id: wp.work_paper_id,
        observation_title: wp.observation_title,
        status: wp.status,
        risk_rating: wp.risk_rating,
        affiliate_code: wp.affiliate_code,
        updated_at: wp.updated_at ? formatDate(wp.updated_at) : ''
      }));
    
    // Pending my review (for HoA)
    const pendingReview = workPapers
      .filter(wp => wp.status === 'Submitted' || wp.status === 'Under Review')
      .map(wp => ({
        work_paper_id: wp.work_paper_id,
        observation_title: wp.observation_title,
        risk_rating: wp.risk_rating,
        submitted_date: wp.submitted_date ? formatDate(wp.submitted_date) : '',
        prepared_by_name: wp.prepared_by_name || ''
      }));
    
    // Overdue action plans
    const overdueList = relevantAPs
      .filter(ap => {
        if (ap.final_status === 'Closed') return false;
        if (!ap.due_date) return false;
        const daysOverdue = Math.floor((new Date() - new Date(ap.due_date)) / (1000 * 60 * 60 * 24));
        return daysOverdue > 0;
      })
      .map(ap => {
        const daysOverdue = Math.floor((new Date() - new Date(ap.due_date)) / (1000 * 60 * 60 * 24));
        return {
          action_plan_id: ap.action_plan_id,
          work_paper_id: ap.work_paper_id,
          action_description: ap.action_description ? ap.action_description.substring(0, 100) + '...' : '',
          action_owner_name: ap.action_owner_name || '',
          due_date: ap.due_date ? formatDate(ap.due_date) : '',
          days_overdue: daysOverdue
        };
      })
      .sort((a, b) => b.days_overdue - a.days_overdue)
      .slice(0, 10);
    
    return {
      success: true,
      data: {
        kpis: {
          totalWorkPapers,
          draftWPs,
          submittedWPs,
          approvedWPs,
          totalActionPlans,
          openAPs,
          closedAPs,
          overdueAPs,
          pendingReviewAPs,
          implementationRate
        },
        charts: {
          wpByStatus,
          wpByRisk,
          wpByAffiliate,
          apByStatus
        },
        tables: {
          recentWPs,
          pendingReview,
          overdueList
        }
      }
    };
  } catch (error) {
    console.error('getAuditorDashboard error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// AUDITEE DASHBOARD
// ============================================================
function getAuditeeDashboard(filters = {}, userId = null) {
  try {
    const year = filters.year || new Date().getFullYear();
    
    // Get work papers sent to auditee
    const workPapers = getSheetData('09_WorkPapers')
      .filter(wp => {
        const wpYear = wp.year || (wp.work_paper_date ? new Date(wp.work_paper_date).getFullYear() : null);
        if (wpYear != year) return false;
        if (wp.status !== 'Sent to Auditee') return false;
        if (userId) {
          return wp.unit_head_id === userId || 
                 (wp.cc_recipients && wp.cc_recipients.includes(userId));
        }
        return true;
      });
    
    // Get action plans for these work papers
    const wpIds = workPapers.map(wp => wp.work_paper_id);
    const actionPlans = getSheetData('13_ActionPlans')
      .filter(ap => wpIds.includes(ap.work_paper_id) || (userId && ap.action_owner_id === userId));
    
    // KPIs
    const totalFindings = workPapers.length;
    const openFindings = workPapers.filter(wp => wp.final_status === 'Open' || wp.final_status !== 'Closed').length;
    const closedFindings = workPapers.filter(wp => wp.final_status === 'Closed').length;
    
    const myActionPlans = userId ? actionPlans.filter(ap => ap.action_owner_id === userId) : actionPlans;
    const totalMyAPs = myActionPlans.length;
    const openMyAPs = myActionPlans.filter(ap => ap.final_status !== 'Closed').length;
    const overdueMyAPs = myActionPlans.filter(ap => {
      if (ap.final_status === 'Closed') return false;
      if (!ap.due_date) return false;
      return new Date(ap.due_date) < new Date();
    }).length;
    
    // Findings awaiting response
    const awaitingResponse = workPapers
      .filter(wp => !wp.management_response)
      .map(wp => ({
        work_paper_id: wp.work_paper_id,
        observation_title: wp.observation_title,
        risk_rating: wp.risk_rating,
        sent_date: wp.sent_to_auditee_date ? formatDate(wp.sent_to_auditee_date) : ''
      }));
    
    // My action plans
    const myAPList = myActionPlans
      .sort((a, b) => {
        const aOverdue = a.due_date && new Date(a.due_date) < new Date() ? 1 : 0;
        const bOverdue = b.due_date && new Date(b.due_date) < new Date() ? 1 : 0;
        if (aOverdue !== bOverdue) return bOverdue - aOverdue;
        return new Date(a.due_date || 0) - new Date(b.due_date || 0);
      })
      .map(ap => {
        const daysOverdue = ap.due_date ? Math.floor((new Date() - new Date(ap.due_date)) / (1000 * 60 * 60 * 24)) : 0;
        return {
          action_plan_id: ap.action_plan_id,
          action_description: ap.action_description ? ap.action_description.substring(0, 100) + '...' : '',
          due_date: ap.due_date ? formatDate(ap.due_date) : '',
          status: ap.status,
          days_overdue: Math.max(0, daysOverdue),
          is_overdue: daysOverdue > 0
        };
      });
    
    // Findings by risk
    const findingsByRisk = {
      Extreme: workPapers.filter(wp => wp.risk_rating === 'Extreme').length,
      High: workPapers.filter(wp => wp.risk_rating === 'High').length,
      Medium: workPapers.filter(wp => wp.risk_rating === 'Medium').length,
      Low: workPapers.filter(wp => wp.risk_rating === 'Low').length
    };
    
    return {
      success: true,
      data: {
        kpis: {
          totalFindings,
          openFindings,
          closedFindings,
          totalMyAPs,
          openMyAPs,
          overdueMyAPs
        },
        charts: {
          findingsByRisk
        },
        tables: {
          awaitingResponse,
          myAPList
        }
      }
    };
  } catch (error) {
    console.error('getAuditeeDashboard error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// BOARD DASHBOARD
// ============================================================
function getBoardDashboard(filters = {}) {
  try {
    const year = filters.year || new Date().getFullYear();
    
    // Get all work papers for the year
    const workPapers = getSheetData('09_WorkPapers')
      .filter(wp => {
        const wpYear = wp.year || (wp.work_paper_date ? new Date(wp.work_paper_date).getFullYear() : null);
        return wpYear == year;
      });
    
    // Get all action plans
    const actionPlans = getSheetData('13_ActionPlans');
    const wpIds = workPapers.map(wp => wp.work_paper_id);
    const relevantAPs = actionPlans.filter(ap => wpIds.includes(ap.work_paper_id));
    
    // Executive KPIs
    const totalAudits = workPapers.filter(wp => 
      ['Approved', 'Sent to Auditee'].includes(wp.status)
    ).length;
    
    const criticalFindings = workPapers.filter(wp => 
      ['Extreme', 'High'].includes(wp.risk_rating) && 
      ['Approved', 'Sent to Auditee'].includes(wp.status)
    ).length;
    
    const openFindings = workPapers.filter(wp => 
      (wp.final_status === 'Open' || wp.final_status !== 'Closed') && 
      ['Approved', 'Sent to Auditee'].includes(wp.status)
    ).length;
    
    const overdueActions = relevantAPs.filter(ap => {
      if (ap.final_status === 'Closed') return false;
      if (!ap.due_date) return false;
      return new Date(ap.due_date) < new Date();
    }).length;
    
    const closedAPs = relevantAPs.filter(ap => ap.final_status === 'Closed').length;
    const implementationRate = relevantAPs.length > 0
      ? Math.round((closedAPs / relevantAPs.length) * 100)
      : 0;
    
    // Risk distribution
    const riskDistribution = {
      Extreme: workPapers.filter(wp => wp.risk_rating === 'Extreme' && ['Approved', 'Sent to Auditee'].includes(wp.status)).length,
      High: workPapers.filter(wp => wp.risk_rating === 'High' && ['Approved', 'Sent to Auditee'].includes(wp.status)).length,
      Medium: workPapers.filter(wp => wp.risk_rating === 'Medium' && ['Approved', 'Sent to Auditee'].includes(wp.status)).length,
      Low: workPapers.filter(wp => wp.risk_rating === 'Low' && ['Approved', 'Sent to Auditee'].includes(wp.status)).length
    };
    
    // Findings by affiliate
    const affiliates = getSheetData('06_Affiliates');
    const findingsByAffiliate = affiliates
      .map(a => ({
        affiliate: a.affiliate_name,
        code: a.affiliate_code,
        total: workPapers.filter(wp => wp.affiliate_code === a.affiliate_code && ['Approved', 'Sent to Auditee'].includes(wp.status)).length,
        open: workPapers.filter(wp => wp.affiliate_code === a.affiliate_code && (wp.final_status === 'Open' || wp.final_status !== 'Closed') && ['Approved', 'Sent to Auditee'].includes(wp.status)).length,
        critical: workPapers.filter(wp => wp.affiliate_code === a.affiliate_code && ['Extreme', 'High'].includes(wp.risk_rating) && ['Approved', 'Sent to Auditee'].includes(wp.status)).length
      }))
      .filter(a => a.total > 0)
      .sort((a, b) => b.critical - a.critical);
    
    // Audit areas summary
    const auditAreas = getSheetData('07_AuditAreas');
    const findingsByArea = auditAreas
      .map(a => ({
        area: a.area_name,
        total: workPapers.filter(wp => wp.audit_area_id === a.area_id && ['Approved', 'Sent to Auditee'].includes(wp.status)).length,
        critical: workPapers.filter(wp => wp.audit_area_id === a.area_id && ['Extreme', 'High'].includes(wp.risk_rating) && ['Approved', 'Sent to Auditee'].includes(wp.status)).length
      }))
      .filter(a => a.total > 0)
      .sort((a, b) => b.total - a.total);
    
    // Critical open findings
    const criticalOpen = workPapers
      .filter(wp => 
        ['Extreme', 'High'].includes(wp.risk_rating) && 
        (wp.final_status === 'Open' || wp.final_status !== 'Closed') &&
        ['Approved', 'Sent to Auditee'].includes(wp.status)
      )
      .map(wp => ({
        work_paper_id: wp.work_paper_id,
        observation_title: wp.observation_title,
        risk_rating: wp.risk_rating,
        affiliate_code: wp.affiliate_code,
        sent_date: wp.sent_to_auditee_date ? formatDate(wp.sent_to_auditee_date) : ''
      }))
      .slice(0, 10);
    
    // Aging of open action plans
    const apAging = {
      '0-30 days': 0,
      '31-60 days': 0,
      '61-90 days': 0,
      '90+ days': 0
    };
    
    relevantAPs.forEach(ap => {
      if (ap.final_status === 'Closed' || !ap.due_date) return;
      const daysOverdue = Math.floor((new Date() - new Date(ap.due_date)) / (1000 * 60 * 60 * 24));
      if (daysOverdue <= 0) return;
      if (daysOverdue <= 30) apAging['0-30 days']++;
      else if (daysOverdue <= 60) apAging['31-60 days']++;
      else if (daysOverdue <= 90) apAging['61-90 days']++;
      else apAging['90+ days']++;
    });
    
    return {
      success: true,
      data: {
        kpis: {
          totalAudits,
          criticalFindings,
          openFindings,
          overdueActions,
          implementationRate
        },
        charts: {
          riskDistribution,
          apAging
        },
        tables: {
          findingsByAffiliate,
          findingsByArea,
          criticalOpen
        }
      }
    };
  } catch (error) {
    console.error('getBoardDashboard error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// SEARCH USERS (for autocomplete)
// ============================================================
function searchUsers(query, roleFilter = null) {
  try {
    let users = getSheetData('05_Users').filter(u => u.is_active === true || u.is_active === 'TRUE');
    
    // Filter by role if specified
    if (roleFilter) {
      const roles = roleFilter.split(',');
      users = users.filter(u => roles.includes(u.role_code));
    }
    
    // Search by name or email
    if (query && query.length >= 2) {
      const lowerQuery = query.toLowerCase();
      users = users.filter(u => 
        (u.full_name && u.full_name.toLowerCase().includes(lowerQuery)) ||
        (u.email && u.email.toLowerCase().includes(lowerQuery))
      );
    }
    
    // Return limited results
    const results = users.slice(0, 10).map(u => ({
      user_id: u.user_id,
      full_name: u.full_name,
      email: u.email,
      role_code: u.role_code,
      department: u.department
    }));
    
    return { success: true, data: results };
  } catch (error) {
    console.error('searchUsers error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// EXPORT DATA (for reports)
// ============================================================
function exportWorkPapers(filters = {}, userRoleCode = null) {
  try {
    if (userRoleCode && !checkPermission(userRoleCode, 'WORK_PAPER', 'export')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const result = listWorkPapers(filters);
    if (!result.success) return result;
    
    // Format for export
    const exportData = result.data.map(wp => ({
      'Work Paper ID': wp.work_paper_id,
      'Affiliate': wp.affiliate_code,
      'Audit Area': wp.audit_area_name,
      'Observation Title': wp.observation_title,
      'Risk Rating': wp.risk_rating,
      'Status': wp.status,
      'Final Status': wp.final_status,
      'Prepared By': wp.prepared_by_name,
      'Prepared Date': wp.prepared_date ? formatDate(wp.prepared_date) : '',
      'Approved By': wp.approved_by_name,
      'Approved Date': wp.approved_date ? formatDate(wp.approved_date) : ''
    }));
    
    return { success: true, data: exportData };
  } catch (error) {
    console.error('exportWorkPapers error:', error);
    return { success: false, error: error.message };
  }
}

function exportActionPlans(filters = {}, userRoleCode = null) {
  try {
    if (userRoleCode && !checkPermission(userRoleCode, 'ACTION_PLAN', 'export')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const result = listActionPlans(filters);
    if (!result.success) return result;
    
    // Format for export
    const exportData = result.data.map(ap => ({
      'Action Plan ID': ap.action_plan_id,
      'Work Paper ID': ap.work_paper_id,
      'Action Description': ap.action_description,
      'Action Owner': ap.action_owner_name,
      'Due Date': ap.due_date ? formatDate(ap.due_date) : '',
      'Status': ap.status,
      'Final Status': ap.final_status,
      'Days Overdue': ap.days_overdue || 0,
      'Implementation Notes': ap.implementation_notes,
      'Implemented Date': ap.implemented_date ? formatDate(ap.implemented_date) : ''
    }));
    
    return { success: true, data: exportData };
  } catch (error) {
    console.error('exportActionPlans error:', error);
    return { success: false, error: error.message };
  }
}
