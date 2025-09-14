/**
 * TRIGGERS - Automated Galactic Operations
 */

function setupTriggers() {
  // Clear existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // Daily dashboard refresh
  ScriptApp.newTrigger('refreshDashboard')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  
  // Weekly maintenance
  ScriptApp.newTrigger('performMaintenance')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
  
  // Monthly reminders
  ScriptApp.newTrigger('sendMonthlyReminders')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();
  
  return { success: true, triggers: 3 };
}

function sendMonthlyReminders() {
  const overdueActions = getOverdueActions();
  const issues = getSheetData('Issues').filter(i => i.status === 'Open');
  
  // Group by owner
  const byOwner = {};
  
  overdueActions.forEach(action => {
    const email = action.assignee_email;
    if (!byOwner[email]) byOwner[email] = { actions: [], issues: [] };
    byOwner[email].actions.push(action);
  });
  
  issues.forEach(issue => {
    const email = issue.owner_email;
    if (!byOwner[email]) byOwner[email] = { actions: [], issues: [] };
    byOwner[email].issues.push(issue);
  });
  
  // Send emails
  Object.entries(byOwner).forEach(([email, data]) => {
    sendReminderEmail(email, data);
  });
  
  return { success: true, reminders: Object.keys(byOwner).length };
}

function sendReminderEmail(email, data) {
  const subject = 'Monthly Audit Reminder - Action Required';
  const body = `
    <h2>Audit System Reminder</h2>
    <p>You have the following items requiring attention:</p>
    
    <h3>Overdue Actions: ${data.actions.length}</h3>
    <ul>
      ${data.actions.map(a => `<li>${a.action_plan} (Due: ${a.due_date})</li>`).join('')}
    </ul>
    
    <h3>Open Issues: ${data.issues.length}</h3>
    <ul>
      ${data.issues.map(i => `<li>${i.title} - ${i.risk_rating} Risk</li>`).join('')}
    </ul>
    
    <p>Please log into the system to address these items.</p>
  `;
  
  MailApp.sendEmail({
    to: email,
    subject: subject,
    htmlBody: body
  });
}
