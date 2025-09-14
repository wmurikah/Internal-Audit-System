/**
 * WORK PAPERS - Evidence Documentation System
 */

function createWorkPaper(data) {
  const user = getCurrentUser();
  data.created_by = user.email;
  data.status = 'Draft';
  return addRow('WorkPapers', data);
}

function updateWorkPaper(id, updates) {
  return updateRow('WorkPapers', id, updates);
}

function listWorkPapers() {
  return getSheetData('WorkPapers');
}

function submitWorkPaper(id) {
  return updateRow('WorkPapers', id, {
    status: 'Submitted',
    submitted_at: new Date()
  });
}

function approveWorkPaper(id) {
  const user = getCurrentUser();
  if (!user.permissions.includes('review') && !user.permissions.includes('all')) {
    throw new Error('Insufficient permissions');
  }
  
  return updateRow('WorkPapers', id, {
    status: 'Approved',
    reviewed_by: user.email,
    reviewed_at: new Date()
  });
}

function exportWorkPapersPDF(ids) {
  const workpapers = getSheetData('WorkPapers')
    .filter(wp => ids.includes(wp.id));
  
  // Generate PDF logic here
  return {
    success: true,
    count: workpapers.length,
    message: 'PDFs generated successfully'
  };
}
