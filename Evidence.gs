/**
 * EVIDENCE VAULT - Secure Document Repository
 */

function uploadEvidence(parentType, parentId, fileData) {
  const user = getCurrentUser();
  
  // Create file in Drive
  const folder = DriveApp.getFolderById(EVIDENCE_FOLDER_ID);
  const blob = Utilities.newBlob(
    Utilities.base64Decode(fileData.content),
    fileData.mimeType,
    fileData.name
  );
  const file = folder.createFile(blob);
  
  return addRow('Evidence', {
    parent_type: parentType,
    parent_id: parentId,
    file_name: fileData.name,
    drive_url: file.getUrl(),
    uploader_email: user.email,
    uploaded_on: new Date(),
    status: 'Pending Review'
  });
}

function listEvidence(parentType, parentId) {
  return getSheetData('Evidence')
    .filter(e => e.parent_type === parentType && e.parent_id === parentId);
}

function approveEvidence(id) {
  return updateRow('Evidence', id, {
    status: 'Approved',
    approved_at: new Date()
  });
}

function rejectEvidence(id, reason) {
  return updateRow('Evidence', id, {
    status: 'Rejected',
    rejection_reason: reason,
    rejected_at: new Date()
  });
}
