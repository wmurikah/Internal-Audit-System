// emailNotifications.gs

// Send task assignment email notification to the auditee
function sendTaskNotification(auditeeEmail, taskName, dueDate) {
  var subject = 'Audit Task Assignment: ' + taskName;
  var message = 'You have been assigned an audit task: ' + taskName + '\n' +
                'Due Date: ' + dueDate + '\n' +
                'Please login to complete the task.';
  MailApp.sendEmail(auditeeEmail, subject, message);
}

// Send reminder email to auditee before due date
function sendReminder(auditeeEmail, taskName, dueDate) {
  var subject = 'Reminder: ' + taskName + ' is Due Soon';
  var message = 'This is a reminder that your audit task, ' + taskName + ', is due on ' + dueDate + '.';
  MailApp.sendEmail(auditeeEmail, subject, message);
}

