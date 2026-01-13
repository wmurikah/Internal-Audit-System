/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Work Paper Service v1.0
 * 
 * CRUD operations for Work Papers
 */

// ============================================================
// LIST WORK PAPERS
// ============================================================
function listWorkPapers(sessionToken, filters = {}) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'WORK_PAPER', 'read')) {
      return { success: false, error: 'Permission denied' };
    }
    
    let workPapers = getSheetData('09_WorkPapers');
    
    // Apply filters
    if (filters.year) {
      workPapers = workPapers.filter(wp => wp.year == filters.year);
    }
    
    if (filters.status) {
      workPapers = workPapers.filter(wp => wp.status === filters.status);
    }
    
    if (filters.affiliate_code) {
      workPapers = workPapers.filter(wp => wp.affiliate_code === filters.affiliate_code);
    }
    
    if (filters.audit_area_id) {
      workPapers = workPapers.filter(wp => wp.audit_area_id === filters.audit_area_id);
    }
    
    if (filters.risk_rating) {
      workPapers = workPapers.filter(wp => wp.risk_rating === filters.risk_rating);
    }
    
    // Role-based filtering
    if (user.role_code === 'UNIT_MANAGER') {
      // Unit managers see only work papers sent to them or where they are CC'd
      workPapers = workPapers.filter(wp => 
        wp.status === 'Sent to Auditee' && 
        (wp.unit_head_id === user.user_id || 
         (wp.cc_recipients && wp.cc_recipients.includes(user.user_id)))
      );
    } else if (user.role_code === 'JUNIOR_STAFF') {
      // Junior staff see only their unit's work papers
      workPapers = workPapers.filter(wp => 
        wp.status === 'Sent to Auditee' && 
        wp.affiliate_code === user.affiliate_code
      );
    } else if (user.role_code === 'EXTERNAL_AUDITOR') {
      // External auditors see only approved/sent work papers
      workPapers = workPapers.filter(wp => 
        ['Approved', 'Sent to Auditee'].includes(wp.status)
      );
    }
    
    // Get audit area names
    const auditAreas = getSheetData('07_AuditAreas');
    const areaMap = {};
    auditAreas.forEach(a => areaMap[a.area_id] = a.area_name);
    
    // Enrich with area names
    workPapers = workPapers.map(wp => ({
      ...wp,
      audit_area_name: areaMap[wp.audit_area_id] || '',
      work_paper_date_formatted: formatDate(wp.work_paper_date)
    }));
    
    // Sort by date descending
    workPapers.sort((a, b) => new Date(b.work_paper_date) - new Date(a.work_paper_date));
    
    return { success: true, data: workPapers };
  } catch (error) {
    console.error('listWorkPapers error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// GET SINGLE WORK PAPER
// ============================================================
function getWorkPaper(sessionToken, workPaperId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'WORK_PAPER', 'read')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const workPapers = getSheetData('09_WorkPapers');
    const wp = workPapers.find(w => w.work_paper_id === workPaperId);
    
    if (!wp) {
      return { success: false, error: 'Work paper not found' };
    }
    
    // Get related data
    const requirements = getSheetData('10_WorkPaperRequirements')
      .filter(r => r.work_paper_id === workPaperId)
      .sort((a, b) => a.requirement_number - b.requirement_number);
    
    const files = getSheetData('11_WorkPaperFiles')
      .filter(f => f.work_paper_id === workPaperId)
      .map(f => ({
        id: f.file_id,
        name: f.file_name,
        size: f.file_size || 0,
        drive_url: f.drive_url,
        drive_file_id: f.drive_file_id,
        status: 'done'
      }));
    
    const actionPlans = getSheetData('13_ActionPlans')
      .filter(ap => ap.work_paper_id === workPaperId)
      .sort((a, b) => a.action_number - b.action_number);
    
    // Get action plan evidence
    const apEvidence = getSheetData('14_ActionPlanEvidence');
    actionPlans.forEach(ap => {
      ap.evidence = apEvidence.filter(e => e.action_plan_id === ap.action_plan_id);
    });
    
    // Get revision history
    const revisions = getSheetData('12_WorkPaperRevisions')
      .filter(r => r.work_paper_id === workPaperId)
      .sort((a, b) => new Date(b.action_date) - new Date(a.action_date));
    
    // Get audit area and sub-area names
    const auditAreas = getSheetData('07_AuditAreas');
    const subAreas = getSheetData('08_ProcessSubAreas');
    
    const area = auditAreas.find(a => a.area_id === wp.audit_area_id);
    const subArea = subAreas.find(s => s.sub_area_id === wp.sub_area_id);
    
    return {
      success: true,
      data: {
        ...wp,
        audit_area_name: area ? area.area_name : '',
        sub_area_name: subArea ? subArea.sub_area_name : '',
        requirements,
        files,
        actionPlans,
        revisions
      }
    };
  } catch (error) {
    console.error('getWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// CREATE WORK PAPER
// ============================================================
function createWorkPaper(sessionToken, data) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'WORK_PAPER', 'create')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const sheet = getSheet('09_WorkPapers');
    const headers = getSheetHeaders('09_WorkPapers');
    
    // Generate ID
    const workPaperId = getNextId('WORK_PAPER');
    const now = new Date();
    const currentYear = now.getFullYear();
    
    // Build row
    const row = headers.map(header => {
      switch (header) {
        case 'work_paper_id': return workPaperId;
        case 'year': return data.year || currentYear;
        case 'status': return data.status || 'Draft';
        case 'final_status': return 'Open';
        case 'prepared_by_id': return user.user_id;
        case 'prepared_by_name': return user.full_name;
        case 'prepared_date': return now;
        case 'submitted_date': return data.status === 'Submitted' ? now : '';
        case 'revision_count': return 0;
        case 'created_at': return now;
        case 'updated_at': return now;
        case 'cc_recipients': 
          return Array.isArray(data.cc_recipients) ? data.cc_recipients.join(',') : (data.cc_recipients || '');
        default:
          return data[header] !== undefined ? data[header] : '';
      }
    });
    
    sheet.appendRow(row);
    
    // Save requirements if provided
    if (data.requirements && data.requirements.length > 0) {
      saveRequirements(workPaperId, data.requirements, user);
    }
    
    // Save action plans if provided
    if (data.action_plans && data.action_plans.length > 0) {
      saveActionPlansForWorkPaper(workPaperId, data.action_plans, user);
    }
    
    // Log audit
    logAudit('CREATE', 'WORK_PAPER', workPaperId, null, data);
    
    // Send notification if submitted
    if (data.status === 'Submitted') {
      queueNotification('WP_SUBMITTED', workPaperId, user);
    }
    
    return { success: true, data: { work_paper_id: workPaperId } };
  } catch (error) {
    console.error('createWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// UPDATE WORK PAPER
// ============================================================
function updateWorkPaper(sessionToken, workPaperId, data) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'WORK_PAPER', 'update')) {
      return { success: false, error: 'Permission denied' };
    }
    
    const sheet = getSheet('09_WorkPapers');
    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const idIdx = headers.indexOf('work_paper_id');
    
    // Find row
    let rowIndex = -1;
    let oldData = {};
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][idIdx] === workPaperId) {
        rowIndex = i + 1; // 1-indexed for sheet
        headers.forEach((h, idx) => oldData[h] = allData[i][idx]);
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'Work paper not found' };
    }
    
    // Check field-level permissions
    const permissions = getUserPermissions(user.role_code);
    const wpPerm = permissions['WORK_PAPER'];
    const restrictedFields = wpPerm ? wpPerm.field_restrictions : [];
    
    // Check if user can edit this work paper based on status
    const currentStatus = oldData.status;
    if (!canEditWorkPaper(user, oldData)) {
      return { success: false, error: 'Cannot edit work paper in current status' };
    }
    
    const now = new Date();
    
    // Update fields
    headers.forEach((header, idx) => {
      // Skip restricted fields
      if (restrictedFields.includes(header)) {
        return;
      }
      
      // Skip system fields
      if (['work_paper_id', 'year', 'prepared_by_id', 'prepared_by_name', 'prepared_date', 'created_at'].includes(header)) {
        return;
      }
      
      if (header === 'updated_at') {
        sheet.getRange(rowIndex, idx + 1).setValue(now);
      } else if (header === 'cc_recipients' && data.cc_recipients) {
        const value = Array.isArray(data.cc_recipients) ? data.cc_recipients.join(',') : data.cc_recipients;
        sheet.getRange(rowIndex, idx + 1).setValue(value);
      } else if (header === 'submitted_date' && data.status === 'Submitted' && !oldData.submitted_date) {
        sheet.getRange(rowIndex, idx + 1).setValue(now);
      } else if (data[header] !== undefined) {
        sheet.getRange(rowIndex, idx + 1).setValue(data[header]);
      }
    });
    
    // Update requirements if provided
    if (data.requirements) {
      saveRequirements(workPaperId, data.requirements, user);
    }
    
    // Update action plans if provided
    if (data.action_plans) {
      saveActionPlansForWorkPaper(workPaperId, data.action_plans, user);
    }
    
    // Log audit
    logAudit('UPDATE', 'WORK_PAPER', workPaperId, oldData, data);
    
    // Handle status changes
    if (data.status && data.status !== currentStatus) {
      handleWorkPaperStatusChange(workPaperId, currentStatus, data.status, user);
    }
    
    return { success: true, data: { work_paper_id: workPaperId } };
  } catch (error) {
    console.error('updateWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// WORK PAPER STATUS MANAGEMENT
// ============================================================
function canEditWorkPaper(user, workPaper) {
  const status = workPaper.status;
  const roleCode = user.role_code;
  
  // Super admin can always edit
  if (roleCode === 'SUPER_ADMIN') return true;
  
  // Auditor can edit Draft, Submitted (own), Revision Requested (own)
  if (roleCode === 'AUDITOR') {
    if (['Draft', 'Revision Requested'].includes(status)) {
      return workPaper.prepared_by_id === user.user_id;
    }
    return false;
  }
  
  // Unit Manager can edit only Sent to Auditee (management response & action plans)
  if (roleCode === 'UNIT_MANAGER') {
    return status === 'Sent to Auditee' && 
           (workPaper.unit_head_id === user.user_id || 
            (workPaper.cc_recipients && workPaper.cc_recipients.includes(user.user_id)));
  }
  
  return false;
}

function handleWorkPaperStatusChange(workPaperId, oldStatus, newStatus, user) {
  const sheet = getSheet('09_WorkPapers');
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const idIdx = headers.indexOf('work_paper_id');
  
  let rowIndex = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][idIdx] === workPaperId) {
      rowIndex = i + 1;
      break;
    }
  }
  
  if (rowIndex === -1) return;
  
  const now = new Date();
  
  // Record revision
  recordRevision(workPaperId, newStatus, '', user);
  
  // Update status-specific fields
  if (newStatus === 'Submitted') {
    const submittedIdx = headers.indexOf('submitted_date');
    sheet.getRange(rowIndex, submittedIdx + 1).setValue(now);
    queueNotification('WP_SUBMITTED', workPaperId, user);
  }
  
  if (newStatus === 'Under Review') {
    const reviewedByIdx = headers.indexOf('reviewed_by_id');
    const reviewedByNameIdx = headers.indexOf('reviewed_by_name');
    sheet.getRange(rowIndex, reviewedByIdx + 1).setValue(user.user_id);
    sheet.getRange(rowIndex, reviewedByNameIdx + 1).setValue(user.full_name);
  }
  
  if (newStatus === 'Approved') {
    const approvedByIdx = headers.indexOf('approved_by_id');
    const approvedByNameIdx = headers.indexOf('approved_by_name');
    const approvedDateIdx = headers.indexOf('approved_date');
    sheet.getRange(rowIndex, approvedByIdx + 1).setValue(user.user_id);
    sheet.getRange(rowIndex, approvedByNameIdx + 1).setValue(user.full_name);
    sheet.getRange(rowIndex, approvedDateIdx + 1).setValue(now);
  }
  
  if (newStatus === 'Sent to Auditee') {
    const sentDateIdx = headers.indexOf('sent_to_auditee_date');
    sheet.getRange(rowIndex, sentDateIdx + 1).setValue(now);
    queueNotification('WP_APPROVED', workPaperId, user);
  }
  
  if (newStatus === 'Revision Requested') {
    const revCountIdx = headers.indexOf('revision_count');
    const currentCount = allData.find(row => row[idIdx] === workPaperId)[revCountIdx] || 0;
    sheet.getRange(rowIndex, revCountIdx + 1).setValue(currentCount + 1);
    queueNotification('WP_REVISION_REQUESTED', workPaperId, user);
  }
}

function recordRevision(workPaperId, action, comments, user) {
  const sheet = getSheet('12_WorkPaperRevisions');
  const revisionId = getNextId('LOG'); // Reuse LOG sequence
  
  // Get current revision count
  const wpSheet = getSheet('09_WorkPapers');
  const wpData = wpSheet.getDataRange().getValues();
  const wpHeaders = wpData[0];
  const idIdx = wpHeaders.indexOf('work_paper_id');
  const revCountIdx = wpHeaders.indexOf('revision_count');
  
  let revisionNumber = 1;
  for (let i = 1; i < wpData.length; i++) {
    if (wpData[i][idIdx] === workPaperId) {
      revisionNumber = (wpData[i][revCountIdx] || 0) + 1;
      break;
    }
  }
  
  sheet.appendRow([
    revisionId,
    workPaperId,
    revisionNumber,
    action,
    comments,
    '', // changed_fields
    user.user_id,
    user.full_name,
    new Date()
  ]);
}

// ============================================================
// SUBMIT FOR REVIEW
// ============================================================
function submitWorkPaper(sessionToken, workPaperId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    // Get current work paper
    const result = getWorkPaper(sessionToken, workPaperId);
    if (!result.success) {
      return result;
    }
    
    const wp = result.data;
    
    // Validate status
    if (!['Draft', 'Revision Requested'].includes(wp.status)) {
      return { success: false, error: 'Can only submit Draft or Revision Requested work papers' };
    }
    
    // Validate required fields
    const validation = validateWorkPaperForSubmission(wp);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') };
    }
    
    // Update status
    return updateWorkPaper(workPaperId, { status: 'Submitted' });
  } catch (error) {
    console.error('submitWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

function validateWorkPaperForSubmission(wp) {
  const errors = [];
  const fieldDefs = getSheetData('03_FieldDefinitions')
    .filter(f => f.module === 'WORK_PAPER' && f.is_required && f.is_active);
  
  fieldDefs.forEach(field => {
    const value = wp[field.field_name];
    if (value === undefined || value === null || value === '') {
      errors.push(`${field.field_label} is required`);
    }
  });
  
  // Check requirements
  if (!wp.requirements || wp.requirements.length === 0) {
    errors.push('At least one requirement is needed');
  }
  
  return { valid: errors.length === 0, errors };
}

// ============================================================
// HOA REVIEW ACTIONS
// ============================================================
function approveWorkPaper(sessionToken, workPaperId, comments) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'WORK_PAPER', 'approve')) {
      return { success: false, error: 'Permission denied' };
    }
    
    // Get current work paper
    const result = getWorkPaper(sessionToken, workPaperId);
    if (!result.success) return result;
    
    const wp = result.data;
    
    if (wp.status !== 'Submitted' && wp.status !== 'Under Review') {
      return { success: false, error: 'Can only approve Submitted or Under Review work papers' };
    }
    
    // Update to Approved, then auto-send to auditee
    const updateResult = updateWorkPaper(sessionToken, workPaperId, {
      status: 'Sent to Auditee',
      review_comments: comments,
      reviewed_by_id: user.user_id,
      reviewed_by_name: user.full_name,
      review_date: new Date(),
      approved_by_id: user.user_id,
      approved_by_name: user.full_name,
      approved_date: new Date(),
      sent_to_auditee_date: new Date()
    });
    
    if (updateResult.success) {
      recordRevision(workPaperId, 'Approved', comments, user);
    }
    
    return updateResult;
  } catch (error) {
    console.error('approveWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

function requestRevision(sessionToken, workPaperId, comments) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    if (!checkPermission(user.role_code, 'WORK_PAPER', 'approve')) {
      return { success: false, error: 'Permission denied' };
    }
    
    // Get current work paper
    const result = getWorkPaper(sessionToken, workPaperId);
    if (!result.success) return result;
    
    const wp = result.data;
    
    if (wp.status !== 'Submitted' && wp.status !== 'Under Review') {
      return { success: false, error: 'Can only request revision for Submitted or Under Review work papers' };
    }
    
    const updateResult = updateWorkPaper(sessionToken, workPaperId, {
      status: 'Revision Requested',
      review_comments: comments,
      reviewed_by_id: user.user_id,
      reviewed_by_name: user.full_name,
      review_date: new Date()
    });
    
    if (updateResult.success) {
      recordRevision(workPaperId, 'Revision Requested', comments, user);
    }
    
    return updateResult;
  } catch (error) {
    console.error('requestRevision error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// REQUIREMENTS MANAGEMENT
// ============================================================
function saveRequirements(workPaperId, requirements, user) {
  const sheet = getSheet('10_WorkPaperRequirements');
  const now = new Date();
  
  // Get existing requirements
  const existing = getSheetData('10_WorkPaperRequirements')
    .filter(r => r.work_paper_id === workPaperId);
  
  // Delete existing (simple approach - could be optimized)
  if (existing.length > 0) {
    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const wpIdIdx = headers.indexOf('work_paper_id');
    
    // Find and delete rows (from bottom to top to maintain indices)
    for (let i = allData.length - 1; i >= 1; i--) {
      if (allData[i][wpIdIdx] === workPaperId) {
        sheet.deleteRow(i + 1);
      }
    }
  }
  
  // Add new requirements
  requirements.forEach((req, index) => {
    if (req.requirement_description) {
      const reqId = getNextId('REQUIREMENT');
      sheet.appendRow([
        reqId,
        workPaperId,
        index + 1,
        req.requirement_description,
        req.date_requested || now,
        req.status || 'Pending',
        req.notes || '',
        now,
        user.user_id
      ]);
    }
  });
}

function getRequirements(workPaperId) {
  try {
    const requirements = getSheetData('10_WorkPaperRequirements')
      .filter(r => r.work_paper_id === workPaperId)
      .sort((a, b) => a.requirement_number - b.requirement_number);
    
    return { success: true, data: requirements };
  } catch (error) {
    console.error('getRequirements error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// SAVE ACTION PLANS FOR WORK PAPER
// ============================================================
function saveActionPlansForWorkPaper(workPaperId, actionPlans, user) {
  const sheet = getSheet('13_ActionPlans');
  const now = new Date();
  
  // Get existing action plans for this work paper
  const existing = getSheetData('13_ActionPlans')
    .filter(ap => ap.work_paper_id === workPaperId);
  
  // Delete existing (simple approach)
  if (existing.length > 0) {
    const allData = sheet.getDataRange().getValues();
    const headers = allData[0];
    const wpIdIdx = headers.indexOf('work_paper_id');
    
    for (let i = allData.length - 1; i >= 1; i--) {
      if (allData[i][wpIdIdx] === workPaperId) {
        sheet.deleteRow(i + 1);
      }
    }
  }
  
  // Add new action plans
  actionPlans.forEach((ap, index) => {
    if (ap.action_description) {
      const apId = getNextId('ACTION_PLAN');
      sheet.appendRow([
        apId,                                    // action_plan_id
        workPaperId,                             // work_paper_id
        index + 1,                               // action_number
        ap.action_description,                   // action_description
        ap.action_owner_id || '',                // action_owner_id
        ap.action_owner_name || '',              // action_owner_name
        ap.due_date || '',                       // due_date
        'Not Due',                               // status
        'Open',                                  // final_status
        '',                                      // implementation_notes
        '',                                      // implemented_date
        '',                                      // auditor_review_status
        '',                                      // auditor_review_by
        '',                                      // auditor_review_date
        '',                                      // auditor_review_comments
        '',                                      // hoa_review_status
        '',                                      // hoa_review_by
        '',                                      // hoa_review_date
        '',                                      // hoa_review_comments
        0,                                       // days_overdue
        now,                                     // created_at
        user.user_id,                            // created_by
        now,                                     // updated_at
        user.user_id                             // updated_by
      ]);
    }
  });
}

// ============================================================
// FILE MANAGEMENT
// ============================================================
function saveWorkPaperFile(workPaperId, fileCategory, fileName, fileDescription, driveFileId, fileSize, mimeType) {
  try {
    const user = getCurrentUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const sheet = getSheet('11_WorkPaperFiles');
    const fileId = getNextId('FILE');
    const driveUrl = `https://drive.google.com/file/d/${driveFileId}/view`;
    
    sheet.appendRow([
      fileId,
      workPaperId,
      fileCategory,
      fileName,
      fileDescription || '',
      driveFileId,
      driveUrl,
      fileSize,
      mimeType,
      user.user_id,
      new Date()
    ]);
    
    logAudit('CREATE', 'WORK_PAPER_FILE', fileId, null, { workPaperId, fileName, fileCategory });
    
    return { success: true, data: { file_id: fileId, drive_url: driveUrl } };
  } catch (error) {
    console.error('saveWorkPaperFile error:', error);
    return { success: false, error: error.message };
  }
}

function getWorkPaperFiles(workPaperId) {
  try {
    const files = getSheetData('11_WorkPaperFiles')
      .filter(f => f.work_paper_id === workPaperId);
    
    return { success: true, data: files };
  } catch (error) {
    console.error('getWorkPaperFiles error:', error);
    return { success: false, error: error.message };
  }
}

function deleteWorkPaperFile(fileId) {
  try {
    const user = getCurrentUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    const sheet = getSheet('11_WorkPaperFiles');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIdx = headers.indexOf('file_id');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][idIdx] === fileId) {
        // Get file info before deleting
        const fileInfo = {};
        headers.forEach((h, idx) => fileInfo[h] = data[i][idx]);
        
        // Delete from Drive (optional - could keep file)
        try {
          DriveApp.getFileById(fileInfo.drive_file_id).setTrashed(true);
        } catch (e) {
          console.warn('Could not trash Drive file:', e);
        }
        
        sheet.deleteRow(i + 1);
        logAudit('DELETE', 'WORK_PAPER_FILE', fileId, fileInfo, null);
        
        return { success: true };
      }
    }
    
    return { success: false, error: 'File not found' };
  } catch (error) {
    console.error('deleteWorkPaperFile error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// UPLOAD FILE TO DRIVE
// ============================================================
function uploadFileToDrive(base64Data, fileName, mimeType, workPaperId, fileCategory) {
  try {
    const user = getCurrentUser();
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    // Get folder ID from config
    const folderId = getConfig('WORK_PAPERS_FOLDER_ID');
    if (!folderId) {
      return { success: false, error: 'Work papers folder not configured' };
    }
    
    // Create year subfolder if needed
    const year = new Date().getFullYear().toString();
    const yearFolder = getOrCreateSubfolder(folderId, year);
    
    // Create work paper subfolder if needed
    const wpFolder = getOrCreateSubfolder(yearFolder.getId(), workPaperId);
    
    // Decode and save file
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = wpFolder.createFile(blob);
    
    // Save to database
    const result = saveWorkPaperFile(
      workPaperId,
      fileCategory,
      fileName,
      '',
      file.getId(),
      blob.getBytes().length,
      mimeType
    );
    
    return result;
  } catch (error) {
    console.error('uploadFileToDrive error:', error);
    return { success: false, error: error.message };
  }
}

function getOrCreateSubfolder(parentFolderId, folderName) {
  const parent = DriveApp.getFolderById(parentFolderId);
  const existing = parent.getFoldersByName(folderName);
  
  if (existing.hasNext()) {
    return existing.next();
  }
  
  return parent.createFolder(folderName);
}

// ============================================================
// FILE UPLOAD FOR WORK PAPERS
// ============================================================
function uploadWorkPaperFile(sessionToken, workPaperId, fileName, base64Data, mimeType, parentFolderId) {
  try {
    const user = getCurrentUser(sessionToken);
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }
    
    // Decode base64 and create blob
    const decodedData = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decodedData, mimeType, fileName);
    
    // Get or create folder for this work paper
    let folder;
    try {
      const parentFolder = DriveApp.getFolderById(parentFolderId);
      const wpFolderName = workPaperId === 'NEW' ? 'Temp_' + new Date().getTime() : workPaperId;
      const existing = parentFolder.getFoldersByName(wpFolderName);
      folder = existing.hasNext() ? existing.next() : parentFolder.createFolder(wpFolderName);
    } catch (e) {
      // If parent folder access fails, use root
      console.error('Folder access error:', e);
      folder = DriveApp.getRootFolder();
    }
    
    // Create file in Drive
    const file = folder.createFile(blob);
    const driveFileId = file.getId();
    const driveUrl = file.getUrl();
    
    // Record in database if work paper exists
    const fileId = getNextId('FILE');
    
    if (workPaperId !== 'NEW') {
      const sheet = getSheet('11_WorkPaperFiles');
      sheet.appendRow([
        fileId,
        workPaperId,
        'Supporting', // file_category
        fileName,
        '', // file_description
        driveFileId,
        driveUrl,
        decodedData.length,
        mimeType,
        user.user_id,
        new Date()
      ]);
    }
    
    return {
      success: true,
      data: {
        file_id: fileId,
        drive_file_id: driveFileId,
        drive_url: driveUrl,
        file_name: fileName
      }
    };
  } catch (error) {
    console.error('uploadWorkPaperFile error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// GET WORK PAPER FILES
// ============================================================
function getWorkPaperFiles(workPaperId) {
  try {
    const files = getSheetData('11_WorkPaperFiles')
      .filter(f => f.work_paper_id === workPaperId)
      .map(f => ({
        id: f.file_id,
        name: f.file_name,
        size: f.file_size,
        drive_url: f.drive_url,
        drive_file_id: f.drive_file_id,
        status: 'done'
      }));
    
    return { success: true, data: files };
  } catch (error) {
    console.error('getWorkPaperFiles error:', error);
    return { success: false, error: error.message };
  }
}
