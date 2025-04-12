// evidenceFunctions.gs

// Process file upload from the client side
function processFileUpload(formBlob, fileName, taskId, userEmail) {
  try {
    // Create the file in Google Drive
    var folder = DriveApp.getFolderById("YOUR_FOLDER_ID"); // Replace with actual folder ID
    var file = folder.createFile(formBlob);
    file.setName(fileName);
    
    // Get the file URL and ID
    var fileUrl = file.getUrl();
    var fileId = file.getId();
    
    // Log the evidence upload in the sheet
    var evidenceSheet = getSheet("Evidence Uploads");
    var evidenceId = Utilities.getUuid(); // Generate unique ID
    var fileType = fileName.split('.').pop();
    
    evidenceSheet.appendRow([
      evidenceId,
      taskId,
      userEmail,
      fileUrl,
      new Date(),
      fileName,
      fileType
    ]);
    
    // Log the action
    logAction('Evidence Uploaded', taskId, userEmail, 'Evidence "' + fileName + '" uploaded');
    
    return {
      success: true,
      fileUrl: fileUrl,
      fileId: fileId,
      evidenceId: evidenceId
    };
  } catch (e) {
    return handleError(e.message, "processFileUpload");
  }
}
// Get evidence for a specific task
function getEvidenceForTask(taskId) {
  try {
    var sheet = getSheet("Evidence Uploads");
    var data = sheet.getDataRange().getValues();
    var evidence = [];
    
    // Skip header row
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] == taskId) {
        evidence.push(data[i]);
      }
    }
    
    return evidence;
  } catch (e) {
    return handleError(e.message, "getEvidenceForTask");
  }
}
