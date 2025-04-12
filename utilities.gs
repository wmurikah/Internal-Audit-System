// utilities.gs

// Central error handling function
function handleError(errorMsg, source) {
  var errorSheet = getSheet("Error Logs");
  if (!errorSheet) {
    SpreadsheetApp.getActiveSpreadsheet().insertSheet("Error Logs");
    errorSheet = getSheet("Error Logs");
    errorSheet.appendRow(["Timestamp", "Source", "Error Message"]);
  }
  
  errorSheet.appendRow([new Date(), source || "Unknown", errorMsg]);
  Logger.log("ERROR: " + errorMsg + " (Source: " + source + ")");
  
  return "An error occurred. Please try again or contact support.";
}

// Helper function to get Google Sheet by name
function getSheet(sheetName) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}
