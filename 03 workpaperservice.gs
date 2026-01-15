/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Work Paper Service v2.0 - Performance Optimized
 * 
 * CRUD operations for Work Papers
 * Implements: Batch reads, reduced sheet access, optimized queries
 */

// ============================================================
// LIST WORK PAPERS (Optimized)
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
    
    // Single read for work papers
    let workPapers = getSheetData('09_WorkPapers');
    
    // Apply filters efficiently
    if (filters.year) {
      const yearVal = parseInt(filters.year);
      workPapers = workPapers.filter(wp => wp.year == yearVal);
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
    const roleCode = user.role_code;
    const userId = user.user_id;
    
    if (roleCode === 'UNIT_MANAGER') {
      workPapers = workPapers.filter(wp => 
        wp.status === 'Sent to Auditee' && 
        (wp.unit_head_id === userId || 
         (wp.responsible_ids && wp.responsible_ids.includes(userId)) ||
         (wp.cc_recipients && wp.cc_recipients.includes(userId)))
      );
    } else if (roleCode === 'JUNIOR_STAFF') {
      workPapers = workPapers.filter(wp => 
        wp.status === 'Sent to Auditee' && 
        wp.affiliate_code === user.affiliate_code
      );
    } else if (roleCode === 'EXTERNAL_AUDITOR') {
      workPapers = workPapers.filter(wp => 
        ['Approved', 'Sent to Auditee'].includes(wp.status)
      );
    }
    
    // Get audit area names - single read, build lookup map
    const auditAreas = getSheetData('07_AuditAreas');
    const areaMap = {};
    auditAreas.forEach(a => areaMap[a.area_id] = a.area_name);
    
    // Enrich with area names and format dates
    workPapers = workPapers.map(wp => ({
      ...wp,
      audit_area_name: areaMap[wp.audit_area_id] || '',
      work_paper_date_formatted: formatDate(wp.work_paper_date)
    }));
    
    // Sort by date descending
    workPapers.sort((a, b) => new Date(b.work_paper_date || 0) - new Date(a.work_paper_date || 0));
    
    return { success: true, data: workPapers };
  } catch (error) {
    console.error('listWorkPapers error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// GET SINGLE WORK PAPER (Optimized - batch related data)
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
    
    // Batch read all needed data in parallel conceptually
    const [workPapers, requirements, files, actionPlans, revisions, auditAreas, subAreas, apEvidence] = [
      getSheetData('09_WorkPapers'),
      getSheetData('10_WorkPaperRequirements'),
      getSheetData('11_WorkPaperFiles'),
      getSheetData('13_ActionPlans'),
      getSheetData('12_WorkPaperRevisions'),
      getSheetData('07_AuditAreas'),
      getSheetData('08_ProcessSubAreas'),
      getSheetData('14_ActionPlanEvidence')
    ];
    
    const wp = workPapers.find(w => w.work_paper_id === workPaperId);
    
    if (!wp) {
      return { success: false, error: 'Work paper not found' };
    }
    
    // Filter related data
    const wpRequirements = requirements
      .filter(r => r.work_paper_id === workPaperId)
      .sort((a, b) => a.requirement_number - b.requirement_number);
    
    const wpFiles = files
      .filter(f => f.work_paper_id === workPaperId)
      .map(f => ({
        id: f.file_id,
        name: f.file_name,
        size: f.file_size || 0,
        drive_url: f.drive_url,
        drive_file_id: f.drive_file_id,
        status: 'done'
      }));
    
    const wpActionPlans = actionPlans
      .filter(ap => ap.work_paper_id === workPaperId)
      .sort((a, b) => a.action_number - b.action_number);
    
    // Attach evidence to action plans
    wpActionPlans.forEach(ap => {
      ap.evidence = apEvidence.filter(e => e.action_plan_id === ap.action_plan_id);
    });
    
    const wpRevisions = revisions
      .filter(r => r.work_paper_id === workPaperId)
      .sort((a, b) => new Date(b.action_date || 0) - new Date(a.action_date || 0));
    
    // Lookup names
    const area = auditAreas.find(a => a.area_id === wp.audit_area_id);
    const subArea = subAreas.find(s => s.sub_area_id === wp.sub_area_id);
    
    return {
      success: true,
      data: {
        ...wp,
        audit_area_name: area ? area.area_name : '',
        sub_area_name: subArea ? subArea.sub_area_name : '',
        requirements: wpRequirements,
        files: wpFiles,
        actionPlans: wpActionPlans,
        revisions: wpRevisions
      }
    };
  } catch (error) {
    console.error('getWorkPaper error:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================
// CREATE WORK PAPER (Optimized - batch writes)
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
    
    // Process responsible_ids and cc_recipients
    const responsibleIds = Array.isArray(data.responsible_ids) 
      ? data.responsible_ids.join(',') 
      : (data.responsible_ids || data.unit_head_id || '');
    
    const ccRecipients = Array.isArray(data.cc_recipients) 
      ? data.cc_recipients.join(',') 
      : (data.cc_recipients || '');
    
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
        case 'responsible_ids': return responsibleIds;
        case 'unit_head_id': return responsibleIds.split(',')[0] || '';
        case 'cc_recipients': return ccRecipients;
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
    
    // Handle file uploads if provided
    if (data.supporting_files && data.supporting_files.length > 0) {
      saveWorkPaperFiles(workPaperId, data.supporting_files, data.supporting_folder_id, user);
    }
    
    // Log audit
    logAudit('CREATE', 'WORK_PAPER', workPaperId, null, data, user.user_id);
    
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
// UPDATE WORK PAPER (Optimized - batch updates)
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
        rowIndex = i + 1;
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
    
    // Check if user can edit based on status
    if (!canEditWorkPaper(user, oldData)) {
      return { success: false, error: 'Cannot edit work paper in current status' };
    }
    
    const currentStatus = oldData.status;
    const now = new Date();
    
    // Build update values array for batch update
    const updateRow = [...allData[rowIndex - 1]];
    
    headers.forEach((header, idx) => {
      if (restrictedFields.includes(header)) return;
      if (['work_paper_id', 'year', 'prepared_by_id', 'prepared_by_name', 'prepared_date', 'created_at'].includes(header)) return;
      
      if (header === 'updated_at') {
        updateRow[idx] = now;
      } else if (header === 'responsible_ids' && data.responsible_ids) {
        updateRow[idx] = Array.isArray(data.responsible_ids) ? data.responsible_ids.join(',') : data.responsible_ids;
      } else if (header === 'unit_head_id' && data.responsible_ids) {
        const ids = Array.isArray(data.responsible_ids) ? data.responsible_ids : data.responsible_ids.split(',');
        updateRow[idx] = ids[0] || '';
      } else if (header === 'cc_recipients' && data.cc_recipients) {
        updateRow[idx] = Array.isArray(data.cc_recipients) ? data.cc_recipients.join(',') : data.cc_recipients;
      } else if (header === 'submitted_date' && data.status === 'Submitted' && !oldData.submitted_date) {
        updateRow[idx] = now;
      } else if (data[header] !== undefined) {
        updateRow[idx] = data[header];
      }
    });
    
    // Single batch write
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updateRow]);
    
    // Update requirements if provided
    if (data.requirements) {
      saveRequirements(workPaperId, data.requirements, user);
    }
    
    // Update action plans if provided
    if (data.action_plans) {
      saveActionPlansForWorkPaper(workPaperId, data.action_plans, user);
    }
    
    // Handle new file uploads
    if (data.supporting_files && data.supporting_files.length > 0) {
      const newFiles = data.supporting_files.filter(f => f.isNew);
      if (newFiles.length > 0) {
        saveWorkPaperFiles(workPaperId, newFiles, data.supporting_folder_id, user);
      }
    }
    
    // Log audit
    logAudit('UPDATE', 'WORK_PAPER', workPaperId, oldData, data, user.user_id);
    
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
  
  if (roleCode === 'SUPER_ADMIN') return true;
  
  if (roleCode === 'AUDITOR') {
    if (['Draft', 'Revision Requested'].includes(status)) {
      return workPaper.prepared_by_id === user.user_id;
    }
    return false;
  }
  
  if (roleCode === 'UNIT_MANAGER') {
    const responsibleIds = (workPaper.responsible_ids || workPaper.unit_head_id || '').split(',');
    const ccIds = (workPaper.cc_recipients || '').split(',');
    return status === 'Sent to Auditee' && 
           (responsibleIds.includes(user.user_id) || ccIds.includes(user.user_id));
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
  
  // Batch status-specific updates
  const updates = {};
  
  if (newStatus === 'Submitted') {
    updates['submitted_date'] = now;
    queueNotification('WP_SUBMITTED', workPaperId, user);
  }
  
  if (newStatus === 'Under Review') {
    updates['reviewed_by_id'] = user.user_id;
    updates['reviewed_by_name'] = user.full_name;
  }
  
  if (newStatus === 'Approved') {
    updates['approved_by_id'] = user.user_id;
    updates['approved_by_name'] = user.full_name;
    updates['approved_date'] = now;
  }
  
  if (newStatus === 'Sent to Auditee') {
    updates['sent_to_auditee_date'] = now;
    queueNotification('WP_APPROVED', workPaperId, user);
  }
  
  if (newStatus === 'Revision Requested') {
    const revCountIdx = headers.indexOf('revision_count');
    const currentCount = allData.find(row => row[idIdx] === workPaperId)[revCountIdx] || 0;
    updates['revision_count'] = currentCount + 1;
    queueNotification('WP_REVISION_REQUESTED', workPaperId, user);
  }
  
  // Apply updates
  Object.entries(updates).forEach(([field, value]) => {
    const colIdx = headers.indexOf(field);
    if (colIdx !== -1) {
      sheet.getRange(rowIndex, colIdx + 1).setValue(value);
    }
  });
}

function recordRevision(workPaperId, action, comments, user) {
  const sheet = getSheet('12_WorkPaperRevisions');
  const revisionId = getNextId('LOG');
  
  // Get revision count
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
    '',
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
    
    const result = getWorkPaper(sessionToken, workPaperId);
    if (!result.success) return result;
    
    const wp = result.data;
    
    if (!['Draft', 'Revision Requested'].includes(wp.status)) {
      return { success: false, error: 'Can only submit Draft or Revision Requested work papers' };
    }
    
    const validation = validateWorkPaperForSubmission(wp);
    if (!validation.valid) {
      return { success: false, error: validation.errors.join(', ') };
    }
    
    return updateWorkPaper(sessionToken, workPaperId, { status: 'Submitted' });
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
    
    const result = getWorkPaper(sessionToken, workPaperId);
    if (!result.success) return result;
    
    const wp = result.data;
    
    if (wp.status !== 'Submitted' && wp.status !== 'Under Review') {
      return { success: false, error: 'Can only approve Submitted or Under Review work papers' };
    }
    
    const now = new Date();
    const updateResult = updateWorkPaper(sessionToken, workPaperId, {
      status: 'Sent to Auditee',
      review_comments: comments,
      reviewed_by_id: user.user_id,
      reviewed_by_name: user.full_name,
      review_date: now,
      approved_by_id: user.user_id,
      approved_by_name: user.full_name,
      approved_date: now,
      sent_to_auditee_date: now
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
// REQUIREMENTS MANAGEMENT (Optimized - batch operations)
// ============================================================
function saveRequirements(workPaperId, requirements, user) {
  const sheet = getSheet('10_WorkPaperRequirements');
  const now = new Date();
  
  // Get all data once
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const wpIdIdx = headers.indexOf('work_paper_id');
  
  // Find and delete existing rows (from bottom to top)
  const rowsToDelete = [];
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][wpIdIdx] === workPaperId) {
      rowsToDelete.push(i + 1);
    }
  }
  
  // Delete from bottom to top to preserve indices
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  // Batch add new requirements
  const newRows = [];
  requirements.forEach((req, index) => {
    if (req.requirement_description) {
      const reqId = getNextId('REQUIREMENT');
      newRows.push([
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
  
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
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
// SAVE ACTION PLANS FOR WORK PAPER (Optimized)
// ============================================================
function saveActionPlansForWorkPaper(workPaperId, actionPlans, user) {
  const sheet = getSheet('13_ActionPlans');
  const now = new Date();
  
  // Get all data once
  const allData = sheet.getDataRange().getValues();
  const headers = allData[0];
  const wpIdIdx = headers.indexOf('work_paper_id');
  
  // Find and delete existing rows
  const rowsToDelete = [];
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][wpIdIdx] === workPaperId) {
      rowsToDelete.push(i + 1);
    }
  }
  
  // Delete from bottom to top
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  // Batch add new action plans
  const newRows = [];
  actionPlans.forEach((ap, index) => {
    if (ap.action_description) {
      const apId = getNextId('ACTION_PLAN');
      
      // Handle owner_ids
      let ownerIdsStr = '';
      if (ap.owner_ids && Array.isArray(ap.owner_ids)) {
        ownerIdsStr = ap.owner_ids.join(',');
      } else if (ap.owner_ids) {
        ownerIdsStr = String(ap.owner_ids);
      } else if (ap.action_owner_id) {
        ownerIdsStr = String(ap.action_owner_id);
      }
      
      newRows.push([
        apId,
        workPaperId,
        index + 1,
        ap.action_description,
        ownerIdsStr.split(',')[0] || '',
        ap.action_owner_name || '',
        ap.due_date || '',
        'Not Due',
        'Open',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        0,
        now,
        user.user_id,
        now,
        user.user_id,
        ownerIdsStr
      ]);
    }
  });
  
  if (newRows.length > 0) {
    // Ensure we have the right number of columns
    const lastRow = sheet.getLastRow();
    const numCols = sheet.getLastColumn();
    
    // Pad rows if needed
    newRows.forEach(row => {
      while (row.length < numCols) row.push('');
    });
    
    sheet.getRange(lastRow + 1, 1, newRows.length, numCols).setValues(newRows);
  }
}

// ============================================================
// FILE MANAGEMENT (Optimized)
// ============================================================
function saveWorkPaperFiles(workPaperId, files, parentFolderId, user) {
  const sheet = getSheet('11_WorkPaperFiles');
  const now = new Date();
  
  // Get or create folder for this work paper
  let folder;
  try {
    const parentFolder = DriveApp.getFolderById(parentFolderId);
    const wpFolderName = workPaperId;
    const existing = parentFolder.getFoldersByName(wpFolderName);
    folder = existing.hasNext() ? existing.next() : parentFolder.createFolder(wpFolderName);
  } catch (e) {
    console.error('Folder access error:', e);
    folder = DriveApp.getRootFolder();
  }
  
  // Process each file
  const newRows = [];
  files.forEach(f => {
    if (f.data) {
      try {
        const blob = Utilities.newBlob(Utilities.base64Decode(f.data), f.type, f.name);
        const file = folder.createFile(blob);
        const fileId = getNextId('FILE');
        
        newRows.push([
          fileId,
          workPaperId,
          'Supporting',
          f.name,
          '',
          file.getId(),
          file.getUrl(),
          f.size || blob.getBytes().length,
          f.type,
          user.user_id,
          now
        ]);
      } catch (e) {
        console.error('File upload error:', e);
      }
    }
  });
  
  if (newRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
}

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
        const fileInfo = {};
        headers.forEach((h, idx) => fileInfo[h] = data[i][idx]);
        
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
    
    const folderId = getConfig('WORK_PAPERS_FOLDER_ID');
    if (!folderId) {
      return { success: false, error: 'Work papers folder not configured' };
    }
    
    const year = new Date().getFullYear().toString();
    const yearFolder = getOrCreateSubfolder(folderId, year);
    const wpFolder = getOrCreateSubfolder(yearFolder.getId(), workPaperId);
    
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, fileName);
    const file = wpFolder.createFile(blob);
    
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
    
    const decodedData = Utilities.base64Decode(base64Data);
    const blob = Utilities.newBlob(decodedData, mimeType, fileName);
    
    let folder;
    try {
      const parentFolder = DriveApp.getFolderById(parentFolderId);
      const wpFolderName = workPaperId === 'NEW' ? 'Temp_' + new Date().getTime() : workPaperId;
      const existing = parentFolder.getFoldersByName(wpFolderName);
      folder = existing.hasNext() ? existing.next() : parentFolder.createFolder(wpFolderName);
    } catch (e) {
      console.error('Folder access error:', e);
      folder = DriveApp.getRootFolder();
    }
    
    const file = folder.createFile(blob);
    const driveFileId = file.getId();
    const driveUrl = file.getUrl();
    
    const fileId = getNextId('FILE');
    
    if (workPaperId !== 'NEW') {
      const sheet = getSheet('11_WorkPaperFiles');
      sheet.appendRow([
        fileId,
        workPaperId,
        'Supporting',
        fileName,
        '',
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
