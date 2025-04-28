// TaskManager.gs

// Debug function to help troubleshoot spreadsheet access
function debugGetAllTasks() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) return {error: "Could not open spreadsheet", id: SPREADSHEET_ID};
    
    const sheet = spreadsheet.getSheetByName('Audit Tasks');
    if (!sheet) {
      const availableSheets = spreadsheet.getSheets().map(s => s.getName());
      return {
        error: "Sheet 'Audit Tasks' not found", 
        spreadsheetName: spreadsheet.getName(),
        availableSheets: availableSheets
      };
    }
    
    const data = sheet.getDataRange().getValues();
    return {
      success: true,
      rowCount: data.length,
      headers: data[0],
      sampleRow: data.length > 1 ? data[1] : null
    };
  } catch (e) {
    return {error: e.toString(), stack: e.stack};
  }
}

function getAllTasks() {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) {
      Logger.log("Error: Could not open spreadsheet with ID: " + SPREADSHEET_ID);
      return {error: "Could not open spreadsheet"};
    }
    
    const sheet = spreadsheet.getSheetByName('Audit Tasks');
    if (!sheet) {
      Logger.log("Error: Sheet 'Audit Tasks' not found in spreadsheet: " + spreadsheet.getName());
      return {error: "Sheet 'Audit Tasks' not found"};
    }

    const data = sheet.getDataRange().getValues();
    Logger.log("Data fetched from Audit Tasks sheet: " + data.length + " rows");

    const tasks = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0]) continue; // skip empty Task ID rows

      tasks.push({
        taskId: row[0],
        year: row[1],
        affiliate: row[2],
        businessUnit: row[3],
        auditName: row[4],
        observationTitle: row[5],
        description: row[6],
        rating: row[7],
        risk: row[8],
        managementResponse: row[9],
        actionPlan: row[10],
        dueDate: row[11] instanceof Date ? row[11].toISOString() : row[11],
        assignedTo: row[12],
        status: row[13],
        dateAssigned: row[14] instanceof Date ? row[14].toISOString() : row[14],
        dateCompleted: row[15] instanceof Date ? row[15].toISOString() : row[15],
        evidenceLink: row[16],
        completionNotes: row[17]
      });
    }

    Logger.log("Tasks prepared to return: " + tasks.length);
    return tasks;
  } catch (e) {
    Logger.log("Error in getAllTasks: " + e.toString());
    return {error: e.toString()};
  }
}

function getTask(taskId) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) {
      return {error: "Could not open spreadsheet"};
    }
    
    const sheet = spreadsheet.getSheetByName('Audit Tasks');
    if (!sheet) {
      return {error: "Sheet 'Audit Tasks' not found"};
    }

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[0] === taskId || String(row[0]) === String(taskId)) {
        return {
          taskId: row[0],
          year: row[1],
          affiliate: row[2],
          businessUnit: row[3],
          auditName: row[4],
          observationTitle: row[5],
          description: row[6],
          rating: row[7],
          risk: row[8],
          managementResponse: row[9],
          actionPlan: row[10],
          dueDate: row[11] instanceof Date ? row[11].toISOString() : row[11],
          assignedTo: row[12],
          status: row[13],
          dateAssigned: row[14] instanceof Date ? row[14].toISOString() : row[14],
          dateCompleted: row[15] instanceof Date ? row[15].toISOString() : row[15],
          evidenceLink: row[16],
          completionNotes: row[17]
        };
      }
    }
    return {error: "Task not found with ID: " + taskId};
  } catch (e) {
    Logger.log("Error in getTask: " + e.toString());
    return {error: e.toString()};
  }
}

function createTask(data) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) {
      return {error: "Could not open spreadsheet"};
    }
    
    const sheet = spreadsheet.getSheetByName('Audit Tasks');
    if (!sheet) {
      return {error: "Sheet 'Audit Tasks' not found"};
    }

    const newRow = [
      data.taskId || '',
      data.year || '',
      data.affiliate || '',
      data.businessUnit || '',
      data.auditName || '',
      data.observationTitle || '',
      data.description || '',
      data.rating || '',
      data.risk || '',
      data.managementResponse || '',
      data.actionPlan || '',
      data.dueDate || '',
      data.assignedTo || '',
      data.status || '',
      data.dateAssigned || '',
      data.dateCompleted || '',
      data.evidenceLink || '',
      data.completionNotes || ''
    ];

    sheet.appendRow(newRow);
    return {success: true, message: "Task created successfully"};
  } catch (e) {
    Logger.log("Error in createTask: " + e.toString());
    return {error: e.toString()};
  }
}

function updateTask(data) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) {
      return {error: "Could not open spreadsheet"};
    }
    
    const sheet = spreadsheet.getSheetByName('Audit Tasks');
    if (!sheet) {
      return {error: "Sheet 'Audit Tasks' not found"};
    }

    const dataRange = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === data.taskId || String(dataRange[i][0]) === String(data.taskId)) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex < 0) {
      return {error: "Task ID not found: " + data.taskId};
    }

    const updatedRow = [
      data.taskId || '',
      data.year || '',
      data.affiliate || '',
      data.businessUnit || '',
      data.auditName || '',
      data.observationTitle || '',
      data.description || '',
      data.rating || '',
      data.risk || '',
      data.managementResponse || '',
      data.actionPlan || '',
      data.dueDate || '',
      data.assignedTo || '',
      data.status || '',
      data.dateAssigned || '',
      data.dateCompleted || '',
      data.evidenceLink || '',
      data.completionNotes || ''
    ];

    sheet.getRange(rowIndex, 1, 1, updatedRow.length).setValues([updatedRow]);
    logAudit('UPDATE', data.taskId, 'Task updated');
    return {success: true, message: "Task updated successfully"};
  } catch (e) {
    Logger.log("Error in updateTask: " + e.toString());
    return {error: e.toString()};
  }
}

function deleteTask(taskId) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (!spreadsheet) {
      return {error: "Could not open spreadsheet"};
    }
    
    const sheet = spreadsheet.getSheetByName('Audit Tasks');
    if (!sheet) {
      return {error: "Sheet 'Audit Tasks' not found"};
    }

    const dataRange = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < dataRange.length; i++) {
      if (dataRange[i][0] === taskId || String(dataRange[i][0]) === String(taskId)) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex < 0) {
      return {error: "Task ID not found: " + taskId};
    }

    sheet.deleteRow(rowIndex);
    logAudit('DELETE', taskId, 'Task deleted');
    return {success: true, message: "Task deleted successfully"};
  } catch (e) {
    Logger.log("Error in deleteTask: " + e.toString());
    return {error: e.toString()};
  }
}

// Get current user's email
function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail();
}

// Add a doGet function for direct web app deployment
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Manager')
    .setTitle('Audit Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
