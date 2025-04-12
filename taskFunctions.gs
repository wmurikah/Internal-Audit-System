// taskFunctions.gs

// Create a new audit task
function createAuditTask(taskName, description, assignedAuditee, dueDate) {
  try {
    var sheet = getSheet("Audit Tasks");
    sheet.appendRow([taskName, description, assignedAuditee, dueDate, 'Pending', new Date(), '', '']);
    logAction('Task Created', taskName, 'Admin', 'Task successfully created');
    return 'Task Created Successfully';
  } catch (e) {
    handleError(e.message);
  }
}

// Update an existing task (status, completion notes)
function updateAuditTask(taskId, status, completionNotes) {
  try {
    var sheet = getSheet("Audit Tasks");
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == taskId) {
        sheet.getRange(i + 1, 6).setValue(status);  // Status
        sheet.getRange(i + 1, 9).setValue(completionNotes);  // Completion Notes
        sheet.getRange(i + 1, 8).setValue(new Date());  // Date Completed
        logAction('Task Updated', taskId, 'Admin', 'Task updated with new status');
        return 'Task Updated Successfully';
      }
    }
    return 'Task Not Found';
  } catch (e) {
    handleError(e.message);
  }
}

// Delete a task from the sheet
function deleteAuditTask(taskId) {
  try {
    var sheet = getSheet("Audit Tasks");
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] == taskId) {
        sheet.deleteRow(i + 1);
        logAction('Task Deleted', taskId, 'Admin', 'Task successfully deleted');
        return 'Task Deleted Successfully';
      }
    }
    return 'Task Not Found';
  } catch (e) {
    handleError(e.message);
  }
}

// Retrieve tasks assigned to a specific auditee
function getTasksForAuditee(auditeeEmail) {
  try {
    var sheet = getSheet("Audit Tasks");
    var data = sheet.getDataRange().getValues();
    var tasks = [];
    for (var i = 1; i < data.length; i++) {
      if (data[i][3] == auditeeEmail) {
        tasks.push(data[i]);
      }
    }
    return tasks;
  } catch (e) {
    handleError(e.message);
  }
}
