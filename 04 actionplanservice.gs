/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Action Plan Service v2.0
 * 
 * CRUD operations for Action Plans
 * Updated to support multiple owners per action plan
 */

// ============================================================
// LIST ACTION PLANS
// ============================================================
function listActionPlans(sessionToken, filters = {}) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'ACTION_PLAN', 'read')) {
      return { success: false, error: 'Permission denied' };
    }
    
    let actionPlans = getSheetData('13_ActionPlans');
    
    // Get work paper info for filtering
    const workPapers = getSheetData('09_WorkPapers');
    const wpMap = {};
    workPapers.forEach(wp => {
      wpMap[wp.work_paper_id] = wp;
    });
    
    // Get users for owner name resolution
    const users = getSheetData('01_Users');
    const userMap = {};
    users.forEach(u => {
      userMap[u.user_id] = u;
    });
    
    // Enrich with work paper info and resolve owner names
    actionPlans = actionPlans.map(ap => {
      const wp = wpMap[ap.work_paper_id] || {};
      
      // Parse owner_ids (comma-separated string to array)
      const ownerIds = parseOwnerIds(ap.owner_ids);
      const ownerNames = ownerIds.map(id => {
        const u = userMap[id];
        return u ? u.full_name : id;
      });
      
      return {
        ...ap,
        affiliate_code: wp.affiliate_code,
        audit_area_id: wp.audit_area_id,
        observation_title: wp.observation_title,
        risk_rating: wp.risk_rating,
        wp_year: wp.year,
        owner_ids_array: ownerIds,
        owner_names_array: ownerNames,
        action_owner_name: ownerNames.join(', ') // For display compatibility
      };
    });
    
    // Apply filters
    if (filters.year) {
      actionPlans = actionPlans.filter(ap => ap.wp_year == filters.year);
    }
    
    if (filters.status) {
      actionPlans = actionPlans.filter(ap => ap.status === filters.status);
    }
    
    if (filters.final_status) {
      actionPlans = actionPlans.filter(ap => ap.final_status === filters.final_status);
    }
    
    if (filters.work_paper_id) {
      actionPlans = actionPlans.filter(ap => ap.work_paper_id === filters.work_paper_id);
    }
    
    // Filter by owner - now checks if user is in owner_ids array
    if (filters.action_owner_id) {
      actionPlans = actionPlans.filter(ap => 
        ap.owner_ids_array.includes(filters.action_owner_id)
      );
    }
    
    if (filters.affiliate_code) {
      actionPlans = actionPlans.filter(ap => ap.affiliate_code === filters.affiliate_code);
    }
    
    // Role-based filtering
    if (user.role_code === 'UNIT_MANAGER') {
      // See action plans they own or for work papers sent to them
      actionPlans = actionPlans.filter(ap => {
        const wp = wpMap[ap.work_paper_id];
        const isOwner = ap.owner_ids_array.includes(user.user_id);
        const isResponsible = wp && isUserResponsible(wp, user.user_id);
        return isOwner || isResponsible;
      });
    } else if (user.role_code === 'JUNIOR_STAFF') {
      // See only action plans they own
      actionPlans = actionPlans.filter(ap => 
        ap.owner_ids_array.includes(user.user_id)
      );
    }
    
    // Calculate overdue status
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    actionPlans = actionPlans.map(ap => {
      const dueDate = ap.due_date ? new Date(ap.due_date) : null;
      let isOverdue = false;
      let daysOverdue = 0;
      
      if (dueDate && ap.final_status === 'Open') {
        dueDate.setHours(0, 0, 0, 0);
        if (dueDate < today) {
          isOverdue = true;
          daysOverdue = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
        }
      }
      
      return {
        ...ap,
        is_overdue: isOverdue,
        days_overdue: daysOverdue,
        due_date_formatted: formatDate(ap.due_date)
      };
    });
    
    // Sort by due date
    actionPlans.sort((a, b) => {
      const dateA = a.due_date ? new Date(a.due_date) : new Date('9999-12-31');
      const dateB = b.due_date ? new Date(b.due_date) : new Date('9999-12-31');
      return dateA - dateB;
    });
    
    return { success: true, data: actionPlans };
  } catch (error) {
    console.error('listActionPlans error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// HELPER: Parse owner IDs from comma-separated string
// ============================================================
function parseOwnerIds(ownerIds) {
  if (!ownerIds) return [];
  if (Array.isArray(ownerIds)) return ownerIds;
  return String(ownerIds).split(',').map(id => id.trim()).filter(id => id);
}

// ============================================================
// HELPER: Format owner IDs array to comma-separated string
// ============================================================
function formatOwnerIds(ownerIds) {
  if (!ownerIds) return '';
  if (Array.isArray(ownerIds)) return ownerIds.join(',');
  return String(ownerIds);
}

// ============================================================
// HELPER: Check if user is in responsible list for work paper
// ============================================================
function isUserResponsible(wp, userId) {
  // Check old single unit_head_id field
  if (wp.unit_head_id === userId) return true;
  
  // Check new responsible_ids field (comma-separated)
  if (wp.responsible_ids) {
    const responsibleIds = parseOwnerIds(wp.responsible_ids);
    if (responsibleIds.includes(userId)) return true;
  }
  
  return false;
}

// ============================================================
// HELPER: Get owner names from IDs
// ============================================================
function getOwnerNames(ownerIds) {
  if (!ownerIds || ownerIds.length === 0) return '';
  
  const users = getSheetData('01_Users');
  const userMap = {};
  users.forEach(u => {
    userMap[u.user_id] = u.full_name;
  });
  
  const ids = parseOwnerIds(ownerIds);
  return ids.map(id => userMap[id] || id).join(', ');
}

// ============================================================
// GET SINGLE ACTION PLAN
// ============================================================
function getActionPlan(sessionToken, actionPlanId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const actionPlans = getSheetData('13_ActionPlans');
    const ap = actionPlans.find(a => a.action_plan_id === actionPlanId);
    
    if (!ap) {
      return { success: false, error: 'Action plan not found' };
    }
    
    // Parse owner_ids
    const ownerIds = parseOwnerIds(ap.owner_ids);
    
    // Get users for owner name resolution
    const users = getSheetData('01_Users');
    const userMap = {};
    users.forEach(u => {
      userMap[u.user_id] = u;
    });
    
    const ownerNames = ownerIds.map(id => {
      const u = userMap[id];
      return u ? u.full_name : id;
    });
    
    // Get evidence
    const evidence = getSheetData('14_ActionPlanEvidence')
      .filter(e => e.action_plan_id === actionPlanId);
    
    // Get history
    const history = getSheetData('15_ActionPlanHistory')
      .filter(h => h.action_plan_id === actionPlanId)
      .sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
    
    // Get work paper info
    const workPapers = getSheetData('09_WorkPapers');
    const wp = workPapers.find(w => w.work_paper_id === ap.work_paper_id);
    
    return {
      success: true,
      data: {
        ...ap,
        owner_ids_array: ownerIds,
        owner_names_array: ownerNames,
        action_owner_name: ownerNames.join(', '),
        evidence,
        history,
        work_paper: wp ? {
          observation_title: wp.observation_title,
          risk_rating: wp.risk_rating,
          affiliate_code: wp.affiliate_code,
          recommendation: wp.recommendation
        } : null
      }
    };
  } catch (error) {
    console.error('getActionPlan error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// CREATE ACTION PLAN (by Auditee or Auditor)
// ============================================================
function createActionPlan(sessionToken, workPaperId, data) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'ACTION_PLAN', 'create')) {
      return { success: false, error: 'Permission denied' };
    }
    
    // Verify work paper exists
    const wpResult = getWorkPaper(sessionToken, workPaperId);
    if (!wpResult.success) {
      return { success: false, error: 'Work paper not found' };
    }
    
    const wp = wpResult.data;
    
    // Auditors can create action plans at submission; Auditees only after "Sent to Auditee"
    const isAuditor = ['SUPER_ADMIN', 'AUDITOR'].includes(user.role_code);
    if (!isAuditor && wp.status !== 'Sent to Auditee') {
      return { success: false, error: 'Can only add action plans to work papers sent to auditee' };
    }
    
    // Check max action plans
    const maxAPs = getConfig('MAX_ACTION_PLANS_PER_WP') || 10;
    const existingAPs = getSheetData('13_ActionPlans')
      .filter(ap => ap.work_paper_id === workPaperId);
    
    if (existingAPs.length >= maxAPs) {
      return { success: false, error: `Maximum ${maxAPs} action plans allowed per work paper` };
    }
    
    const sheet = getSheet('13_ActionPlans');
    const headers = getSheetHeaders('13_ActionPlans');
    
    // Generate ID
    const actionPlanId = getNextId('ACTION_PLAN');
    const now = new Date();
    const actionNumber = existingAPs.length + 1;
    
    // Process owner_ids - accept both array and single value
    let ownerIdsStr = '';
    if (data.owner_ids && Array.isArray(data.owner_ids)) {
      ownerIdsStr = data.owner_ids.join(',');
    } else if (data.owner_ids) {
      ownerIdsStr = String(data.owner_ids);
    } else if (data.action_owner_id) {
      // Backward compatibility with single owner
      ownerIdsStr = String(data.action_owner_id);
    }
    
    // Get owner names for display
    const ownerNames = getOwnerNames(ownerIdsStr);
    
    // Build row
    const row = headers.map(header => {
      switch (header) {
        case 'action_plan_id': return actionPlanId;
        case 'work_paper_id': return workPaperId;
        case 'action_number': return actionNumber;
        case 'action_description': return data.action_description || '';
        case 'owner_ids': return ownerIdsStr;
        case 'owner_names': return ownerNames;
        // Keep old fields for backward compatibility
        case 'action_owner_id': return ownerIdsStr.split(',')[0] || '';
        case 'action_owner_name': return ownerNames;
        case 'due_date': return data.due_date ? new Date(data.due_date) : '';
        case 'status': return 'Not Due';
        case 'final_status': return 'Open';
        case 'days_overdue': return 0;
        case 'created_at': return now;
        case 'created_by': return user.user_id;
        case 'updated_at': return now;
        case 'updated_by': return user.user_id;
        default: return '';
      }
    });
    
    sheet.appendRow(row);
    
    // Log audit
    logAudit('CREATE', 'ACTION_PLAN', actionPlanId, null, data);
    
    // Record history
    recordActionPlanHistory(actionPlanId, '', 'Not Due', 'Created', user);
    
    return { success: true, data: { action_plan_id: actionPlanId } };
  } catch (error) {
    console.error('createActionPlan error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// UPDATE ACTION PLAN
// ============================================================
function updateActionPlan(sessionToken, actionPlanId, data) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'ACTION_PLAN', 'update')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const sheet = getSheet('13_ActionPlans');
    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const idIdx = headers.indexOf('action_plan_id');
    
    // Find row
    let rowIndex = -1;
    let oldData = {};
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][idIdx] === actionPlanId) {
        rowIndex = i + 1;
        headers.forEach((h, idx) => oldData[h] = allData[i][idx]);
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'Action plan not found' };
    }
    
    // Parse old owner_ids for permission check
    oldData.owner_ids_array = parseOwnerIds(oldData.owner_ids || oldData.action_owner_id);
    
    // Check if user can edit
    if (!canEditActionPlan(user, oldData)) {
      return { success: false, error: 'Cannot edit this action plan' };
    }
    
    const now = new Date();
    
    // Process owner_ids if provided
    if (data.owner_ids !== undefined) {
      if (Array.isArray(data.owner_ids)) {
        data.owner_ids = data.owner_ids.join(',');
      }
      data.owner_names = getOwnerNames(data.owner_ids);
      // Update backward-compatible fields
      data.action_owner_id = data.owner_ids.split(',')[0] || '';
      data.action_owner_name = data.owner_names;
    }
    
    // Update fields
    headers.forEach((header, idx) => {
      if (['action_plan_id', 'work_paper_id', 'action_number', 'created_at', 'created_by'].includes(header)) {
        return;
      }
      
      if (header === 'updated_at') {
        sheet.getRange(rowIndex, idx + 1).setValue(now);
      } else if (header === 'updated_by') {
        sheet.getRange(rowIndex, idx + 1).setValue(user.user_id);
      } else if (data[header] !== undefined) {
        sheet.getRange(rowIndex, idx + 1).setValue(data[header]);
      }
    });
    
    // Log audit
    logAudit('UPDATE', 'ACTION_PLAN', actionPlanId, oldData, data);
    
    return { success: true, data: { action_plan_id: actionPlanId } };
  } catch (error) {
    console.error('updateActionPlan error:', error);
    return { success: false, error: error.message };
  }
}

function canEditActionPlan(user, actionPlan) {
  const roleCode = user.role_code;
  const status = actionPlan.status;
  const finalStatus = actionPlan.final_status;
  
  // Super admin can always edit
  if (roleCode === 'SUPER_ADMIN') return true;
  
  // Auditors can edit
  if (roleCode === 'AUDITOR') return true;
  
  // Closed action plans cannot be edited by non-admins
  if (finalStatus === 'Closed') return false;
  
  // Get owner IDs array
  const ownerIds = actionPlan.owner_ids_array || parseOwnerIds(actionPlan.owner_ids || actionPlan.action_owner_id);
  const isOwner = ownerIds.includes(user.user_id);
  
  // Unit Manager can edit if they are an owner
  if (roleCode === 'UNIT_MANAGER') {
    return isOwner || ['Not Due', 'Not Implemented'].includes(status);
  }
  
  // Junior staff can only edit if they are an owner
  if (roleCode === 'JUNIOR_STAFF') {
    return isOwner;
  }
  
  return false;
}

// ============================================================
// MARK AS IMPLEMENTED (by Auditee)
// ============================================================
function markActionPlanImplemented(sessionToken, actionPlanId, implementationNotes) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    // Get current action plan
    const result = getActionPlan(sessionToken, actionPlanId);
    if (!result.success) return result;
    
    const ap = result.data;
    
    // Validate
    if (ap.final_status === 'Closed') {
      return { success: false, error: 'Action plan is already closed' };
    }
    
    if (!['Not Due', 'Not Implemented'].includes(ap.status)) {
      return { success: false, error: 'Action plan is already pending review' };
    }
    
    // Check if evidence is uploaded
    if (!ap.evidence || ap.evidence.length === 0) {
      return { success: false, error: 'Please upload evidence before marking as implemented' };
    }
    
    const oldStatus = ap.status;
    
    // Update
    const updateResult = updateActionPlan(sessionToken, actionPlanId, {
      status: 'Implemented',
      implementation_notes: implementationNotes,
      implemented_date: new Date(),
      auditor_review_status: 'Pending'
    });
    
    if (updateResult.success) {
      recordActionPlanHistory(actionPlanId, oldStatus, 'Implemented', implementationNotes, user);
      
      // Notify auditor
      queueNotification('AP_IMPLEMENTED', actionPlanId, user);
    }
    
    return updateResult;
  } catch (error) {
    console.error('markActionPlanImplemented error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// AUDITOR REVIEW
// ============================================================
function auditorReviewActionPlan(sessionToken, actionPlanId, decision, comments) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!['SUPER_ADMIN', 'AUDITOR'].includes(user.role_code)) {
      return { success: false, error: 'Only auditors can review action plans' };
    }
    
    // Get current action plan
    const result = getActionPlan(sessionToken, actionPlanId);
    if (!result.success) return result;
    
    const ap = result.data;
    
    if (ap.status !== 'Implemented') {
      return { success: false, error: 'Can only review implemented action plans' };
    }
    
    const oldStatus = ap.status;
    let newStatus;
    let updateData = {
      auditor_review_by: user.user_id,
      auditor_review_date: new Date(),
      auditor_review_comments: comments
    };
    
    if (decision === 'approve') {
      newStatus = 'Pending HoA Review';
      updateData.status = newStatus;
      updateData.auditor_review_status = 'Approved';
    } else {
      newStatus = 'Not Implemented';
      updateData.status = newStatus;
      updateData.auditor_review_status = 'Rejected';
      updateData.implemented_date = '';
      updateData.implementation_notes = '';
    }
    
    const updateResult = updateActionPlan(sessionToken, actionPlanId, updateData);
    
    if (updateResult.success) {
      recordActionPlanHistory(actionPlanId, oldStatus, newStatus, comments, user);
      
      if (decision === 'reject') {
        queueNotification('AP_REJECTED', actionPlanId, user);
      }
    }
    
    return updateResult;
  } catch (error) {
    console.error('auditorReviewActionPlan error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// HOA FINAL REVIEW
// ============================================================
function hoaReviewActionPlan(sessionToken, actionPlanId, decision, comments) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only Head of Audit can give final approval' };
    }
    
    // Get current action plan
    const result = getActionPlan(sessionToken, actionPlanId);
    if (!result.success) return result;
    
    const ap = result.data;
    
    if (ap.status !== 'Pending HoA Review') {
      return { success: false, error: 'Action plan is not pending HoA review' };
    }
    
    const oldStatus = ap.status;
    let updateData = {
      hoa_review_by: user.user_id,
      hoa_review_date: new Date(),
      hoa_review_comments: comments
    };
    
    if (decision === 'approve') {
      updateData.status = 'Implemented';
      updateData.final_status = 'Closed';
      updateData.hoa_review_status = 'Approved';
      
      recordActionPlanHistory(actionPlanId, oldStatus, 'Closed', comments, user);
      
      // Check if all action plans for this work paper are closed
      checkWorkPaperClosure(ap.work_paper_id);
    } else {
      updateData.status = 'Not Implemented';
      updateData.hoa_review_status = 'Rejected';
      updateData.auditor_review_status = '';
      updateData.implemented_date = '';
      updateData.implementation_notes = '';
      
      recordActionPlanHistory(actionPlanId, oldStatus, 'Not Implemented', comments, user);
      queueNotification('AP_REJECTED', actionPlanId, user);
    }
    
    return updateActionPlan(sessionToken, actionPlanId, updateData);
  } catch (error) {
    console.error('hoaReviewActionPlan error:', error);
    return { success: false, error: error.message };
  }
}

function checkWorkPaperClosure(workPaperId) {
  const actionPlans = getSheetData('13_ActionPlans')
    .filter(ap => ap.work_paper_id === workPaperId);
  
  if (actionPlans.length === 0) return;
  
  const allClosed = actionPlans.every(ap => ap.final_status === 'Closed');
  
  if (allClosed) {
    // Close the work paper
    const sheet = getSheet('09_WorkPapers');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('work_paper_id');
    const finalStatusIdx = headers.indexOf('final_status');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === workPaperId) {
        sheet.getRange(i + 1, finalStatusIdx + 1).setValue('Closed');
        break;
      }
    }
  }
}

// ============================================================
// ACTION PLAN HISTORY
// ============================================================
function recordActionPlanHistory(actionPlanId, previousStatus, newStatus, comments, user) {
  const sheet = getSheet('15_ActionPlanHistory');
  const historyId = getNextId('LOG');
  
  sheet.appendRow([
    historyId,
    actionPlanId,
    previousStatus,
    newStatus,
    comments || '',
    user.user_id,
    user.full_name,
    new Date()
  ]);
}

// ============================================================
// ACTION PLAN EVIDENCE
// ============================================================
function uploadActionPlanEvidence(sessionToken, actionPlanId, base64Data, fileName, mimeType, description) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    // Get action plan
    const result = getActionPlan(sessionToken, actionPlanId);
    if (!result.success) return result;
    
    const ap = result.data;
    
    // Check permission
    if (!canEditActionPlan(user, ap)) {
      return { success: false, error: 'Permission denied' };
    }
    
    // Get folder
    const folderId = getConfig('ACTION_PLAN_EVIDENCE_FOLDER_ID');
    if (!folderId) {
      return { success: false, error: 'Evidence folder not configured' };
    }
    
    // Create subfolder for this action plan
    const apFolder = getOrCreateSubfolder(folderId, actionPlanId);
    
    // Upload file
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = apFolder.createFile(blob);
    
    // Save to database
    const sheet = getSheet('14_ActionPlanEvidence');
    const evidenceId = getNextId('FILE');
    
    sheet.appendRow([
      evidenceId,
      actionPlanId,
      fileName,
      description || '',
      file.getId(),
      file.getUrl(),
      blob.getBytes().length,
      mimeType,
      user.user_id,
      new Date()
    ]);
    
    logAudit('CREATE', 'ACTION_PLAN_EVIDENCE', evidenceId, null, { actionPlanId, fileName });
    
    return { success: true, data: { evidence_id: evidenceId, drive_url: file.getUrl() } };
  } catch (error) {
    console.error('uploadActionPlanEvidence error:', error);
    return { success: false, error: error.message };
  }
}

function getActionPlanEvidence(sessionToken, actionPlanId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const evidence = getSheetData('14_ActionPlanEvidence')
      .filter(e => e.action_plan_id === actionPlanId);
    
    return { success: true, data: evidence };
  } catch (error) {
    console.error('getActionPlanEvidence error:', error);
    return { success: false, error: error.message };
  }
}

function deleteActionPlanEvidence(sessionToken, evidenceId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const sheet = getSheet('14_ActionPlanEvidence');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('evidence_id');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === evidenceId) {
        const evidenceInfo = {};
        headers.forEach((h, idx) => evidenceInfo[h] = data[i][idx]);
        
        // Trash file in Drive
        try {
          DriveApp.getFileById(evidenceInfo.drive_file_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash Drive file:', e);
        }
        
        sheet.deleteRow(i + 1);
        logAudit('DELETE', 'ACTION_PLAN_EVIDENCE', evidenceId, evidenceInfo, null);
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'Evidence not found' };
  } catch (error) {
    console.error('deleteActionPlanEvidence error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// BULK CREATE ACTION PLANS (from Work Paper form)
// ============================================================
function createActionPlansFromWorkPaper(sessionToken, workPaperId, actionPlans) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const results = [];
    
    for (const ap of actionPlans) {
      if (ap.action_description && ap.action_description.trim()) {
        // Map owner_ids from frontend format
        const apData = {
          action_description: ap.action_description,
          owner_ids: ap.owner_ids || [], // Array of user IDs
          due_date: ap.due_date || ''
        };
        
        const result = createActionPlan(sessionToken, workPaperId, apData);
        results.push(result);
        
        if (!result.success) {
          // Log error but continue with other action plans
          console.warn('Failed to create action plan:', result.error);
        }
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    if (failCount > 0 && successCount === 0) {
      return { success: false, error: 'Failed to create action plans', details: results };
    }
    
    return { 
      success: true, 
      data: { 
        created: successCount, 
        failed: failCount,
        results: results 
      } 
    };
  } catch (error) {
    console.error('createActionPlansFromWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// UPDATE OVERDUE STATUS (called by trigger)
// ============================================================
function updateOverdueStatus() {
  try {
    const sheet = getSheet('13_ActionPlans');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const statusIdx = headers.indexOf('status');
    const finalStatusIdx = headers.indexOf('final_status');
    const dueDateIdx = headers.indexOf('due_date');
    const daysOverdueIdx = headers.indexOf('days_overdue');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 1; i < data.length; i++) {
      const finalStatus = data[i][finalStatusIdx];
      const status = data[i][statusIdx];
      const dueDate = data[i][dueDateIdx];
      
      if (finalStatus === 'Open' && dueDate) {
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        
        if (due < today) {
          // Overdue
          const daysOverdue = Math.floor((today - due) / (1000 * 60 * 60 * 24));
          sheet.getRange(i + 1, daysOverdueIdx + 1).setValue(daysOverdue);
          
          if (status === 'Not Due') {
            sheet.getRange(i + 1, statusIdx + 1).setValue('Not Implemented');
          }
        } else {
          sheet.getRange(i + 1, daysOverdueIdx + 1).setValue(0);
        }
      }
    }
    
    console.log('Overdue status updated');
  } catch (error) {
    console.error('updateOverdueStatus error:', error);
  }
}

// ============================================================
// GET ACTION PLANS FOR WORK PAPER (for editing)
// ============================================================
function getActionPlansForWorkPaper(sessionToken, workPaperId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const actionPlans = getSheetData('13_ActionPlans')
      .filter(ap => ap.work_paper_id === workPaperId)
      .sort((a, b) => a.action_number - b.action_number);
    
    // Get users for owner name resolution
    const users = getSheetData('01_Users');
    const userMap = {};
    users.forEach(u => {
      userMap[u.user_id] = u;
    });
    
    // Enrich with parsed owner data
    const enriched = actionPlans.map(ap => {
      const ownerIds = parseOwnerIds(ap.owner_ids || ap.action_owner_id);
      const ownerNames = ownerIds.map(id => {
        const u = userMap[id];
        return u ? u.full_name : id;
      });
      
      return {
        ...ap,
        owner_ids: ownerIds, // Return as array for frontend
        owner_names: ownerNames,
        action_owner_name: ownerNames.join(', '),
        due_date: ap.due_date ? formatDateISO(ap.due_date) : ''
      };
    });
    
    return { success: true, data: enriched };
  } catch (error) {
    console.error('getActionPlansForWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// HELPER: Format date to ISO string (YYYY-MM-DD)
// ============================================================
function formatDateISO(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}
