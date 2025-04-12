// evidenceFunctions.gs

// Upload evidence for a specific task
function uploadEvidence(taskId, userEmail, fileUrl) {
  var sheet = getSheet("Evidence Uploads");
  sheet.appendRow([taskId, userEmail, fileUrl, new Date()]);
  logAction('Evidence Uploaded', taskId, userEmail, 'Evidence uploaded successfully');
}

// Upload the file to Google Drive and return the file URL
function uploadFileToDrive(file) {
  var blob = file.getBlob();
  var uploadedFile = DriveApp.createFile(blob);
  return uploadedFile.getUrl();  // Return the URL of the uploaded file
}
