/**
 * FileManager.gs
 * Functions to handle file uploads to Google Drive and link them to tasks.
 */

/**
 * uploadFileToDrive(formData)
 * Handles file upload from a form. Expects an object 'formData' with:
 * - formData.file: the Blob (file) sent from HTML input.
 * - formData.taskId: the Task ID to associate the file with.
 * - formData.fileName: (optional) desired file name.
 * - formData.fileType: (optional) type or description.
 *
 * Saves the file to a Drive folder and logs the upload in the 'Evidence Uploads' sheet.
 */
function uploadFileToDrive(formData) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const evidenceSheet = ss.getSheetByName('Evidence Uploads');

    if (!evidenceSheet) {
      logError('uploadFileToDrive', "Sheet 'Evidence Uploads' not found");
      return null;
    }

    var folder = DriveApp.getFolderById(EVIDENCE_FOLDER_ID);
    if (!folder) {
      logError('uploadFileToDrive', "Drive folder not found for ID: " + EVIDENCE_FOLDER_ID);
      return null;
    }

    // Get the file blob from the form (assuming formData.file is a Blob)
    var blob = formData.file;
    if (!blob) {
      logError('uploadFileToDrive', "No file blob received in formData");
      return null;
    }

    // Determine filename: use provided or original
    var fileName = formData.fileName || blob.getName();
    var uploadedFile = folder.createFile(blob).setName(fileName);
    var fileUrl = uploadedFile.getUrl();

    // Determine new Evidence ID (auto-increment)
    var data = evidenceSheet.getDataRange().getValues();
    var newId = 1;
    if (data.length > 1) {
      var idValues = data.slice(1).map(function(row) {
        return Number(row[0]);
      });
      var maxId = Math.max.apply(null, idValues.filter(function(n) { return !isNaN(n); }));
      newId = maxId + 1;
    }

    // Record upload details in the sheet
    var userEmail = Session.getActiveUser().getEmail();
    var uploadDate = new Date();
    var fileType = formData.fileType || "";

    evidenceSheet.appendRow([
      newId,
      formData.taskId,
      userEmail,
      fileUrl,
      uploadDate,
      fileName,
      fileType
    ]);

    return { status: 'success', url: fileUrl };

  } catch (err) {
    logError('uploadFileToDrive', err.toString());
    return { status: 'error', message: err.toString() };
  }
}
