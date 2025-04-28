/**
 * EmailReminders.gs
 * Functions to send reminder emails for pending action plans, and an example trigger setup.
 */

/**
 * sendReminderEmails()
 * Scans tasks for pending action plans (not completed and nearing due date),
 * and sends reminder emails to the responsible persons.
 * This function can be set up as a time-driven trigger (e.g., daily).
 */
function sendReminderEmails() {
  try {
    var tasks = getAllTasks(); // from TaskManager.gs
    if (!tasks || tasks.length == 0) return;
    var today = new Date();
    var inThreeDays = new Date();
    inThreeDays.setDate(today.getDate() + 3);
    // Loop through tasks
    tasks.forEach(function(task) {
      var status = task['Status'] ? String(task['Status']).toLowerCase() : '';
      var dueDate = task['Due Date'];
      // Only consider tasks not marked as completed and with a valid due date
      if (status !== 'completed' && dueDate instanceof Date) {
        // Check if due date is within the next 3 days (including today)
        if (dueDate >= today && dueDate <= inThreeDays) {
          var responsible = task['Responsible Person'];
          var recipientEmail = '';
          // Determine email of responsible person
          if (responsible && String(responsible).indexOf('@') > -1) {
            recipientEmail = responsible;
          } else {
            // Try to look up by name
            recipientEmail = getUserEmailByName(responsible) || '';
          }
          if (recipientEmail) {
            var subject = 'Reminder: Action Plan Due for Task ID ' + task['Task ID'];
            var body = 'Hello,\n\n' +
                       'This is a reminder that the action plan for Task ID ' + task['Task ID'] +
                       ' is due on ' + Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
                       '.\n\n' +
                       'Please ensure that the responsible actions are completed by the due date.\n\n' +
                       'Thank you,\nAudit Tracker System';
            MailApp.sendEmail(recipientEmail, subject, body);
          }
        }
      }
    });
  } catch (err) {
    logError('sendReminderEmails', err.toString());
  }
}

/**
 * createReminderTrigger()
 * Example function to create a time-based trigger that runs sendReminderEmails() every day.
 * Run this function once (from the script editor) to set up the trigger.
 */
function createReminderTrigger() {
  ScriptApp.newTrigger('sendReminderEmails')
    .timeBased()
    .everyDays(1)
    .atHour(8)  // for example, 8 AM every day
    .create();
}
