// 05_NotificationService.gs - Email Queue, Templates, Reminders, Alerts

/**
 * Send email via Brevo (formerly Sendinblue) transactional API.
 * Sends from hassaudit@outlook.com using UrlFetchApp.
 * Falls back to MailApp.sendEmail() if Brevo is not configured.
 */
function sendEmailViaBrevo(recipientEmail, subject, htmlBody, ccEmails) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');

  if (!apiKey) {
    // Brevo not configured — fall back to GAS MailApp
    console.log('BREVO_API_KEY not set, falling back to MailApp');
    return { success: false, fallback: true };
  }

  var toList = [{ email: recipientEmail }];

  var payload = {
    sender: { name: 'Hass Audit', email: 'hassaudit@outlook.com' },
    to: toList,
    subject: subject,
    htmlContent: htmlBody
  };

  if (ccEmails) {
    var ccList = String(ccEmails).split(',').map(function(e) { return { email: e.trim() }; }).filter(function(e) { return e.email; });
    if (ccList.length > 0) {
      payload.cc = ccList;
    }
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email', options);
    var code = response.getResponseCode();
    var result = JSON.parse(response.getContentText());

    if (code === 201) {
      return { success: true, messageId: result.messageId };
    } else {
      console.error('Brevo API error (HTTP ' + code + '):', JSON.stringify(result));
      return { success: false, error: result.message || 'Brevo send failed (HTTP ' + code + ')' };
    }
  } catch (e) {
    console.error('Brevo fetch error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Unified email sending function.
 * Tries Brevo first, falls back to MailApp if Brevo is not configured.
 */
function sendEmail(recipientEmail, subject, body, htmlBody, ccEmails, fromName, replyTo) {
  // Try Brevo first
  var brevoResult = sendEmailViaBrevo(recipientEmail, subject, htmlBody, ccEmails);

  if (brevoResult.success) {
    return brevoResult;
  }

  if (!brevoResult.fallback) {
    // Brevo was configured but failed — don't silently fall back, propagate error
    return brevoResult;
  }

  // Fallback: MailApp (sends from the Google account running the script)
  var emailOptions = {
    to: recipientEmail,
    subject: subject,
    body: body,
    name: fromName || 'Internal Audit Notification',
    replyTo: replyTo || 'audit@hasspetroleum.com',
    htmlBody: htmlBody
  };
  if (ccEmails) {
    emailOptions.cc = ccEmails;
  }
  MailApp.sendEmail(emailOptions);
  return { success: true, via: 'mailapp' };
}

function queueEmail(data) {
  try {
    const notificationId = generateId('NOTIFICATION');
    const now = new Date();
    
    const notification = {
      notification_id: notificationId,
      template_code: data.template_code || '',
      recipient_user_id: data.recipient_user_id || '',
      recipient_email: data.recipient_email || '',
      cc_emails: data.cc_emails || '',
      subject: sanitizeInput(data.subject || ''),
      body: sanitizeInput(data.body || ''),
      module: data.module || '',
      record_id: data.record_id || '',
      status: STATUS.NOTIFICATION.PENDING,
      scheduled_for: data.scheduled_for || now,
      sent_at: '',
      error_message: '',
      created_at: now
    };
    
    const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
    const row = objectToRow('NOTIFICATION_QUEUE', notification);
    sheet.appendRow(row);
    
    return sanitizeForClient({ success: true, notificationId: notificationId });
  } catch (e) {
    console.error('Failed to queue email:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Queue email using template
 */
function queueTemplatedEmail(templateCode, recipientEmail, recipientUserId, variables, module, recordId) {
  const template = getEmailTemplate(templateCode);
  
  if (!template) {
    console.warn('Template not found:', templateCode);
    // Fall back to basic notification
    return queueEmail({
      recipient_email: recipientEmail,
      recipient_user_id: recipientUserId,
      subject: 'Notification',
      body: 'You have a new notification.',
      module: module,
      record_id: recordId
    });
  }
  
  // Replace variables in template
  let subject = template.subject_template || '';
  let body = template.body_template || '';
  
  if (variables) {
    Object.keys(variables).forEach(key => {
      const placeholder = '{{' + key + '}}';
      const value = variables[key] || '';
      subject = subject.replace(new RegExp(placeholder, 'g'), value);
      body = body.replace(new RegExp(placeholder, 'g'), value);
    });
  }
  
  return queueEmail({
    template_code: templateCode,
    recipient_email: recipientEmail,
    recipient_user_id: recipientUserId,
    subject: subject,
    body: body,
    module: module,
    record_id: recordId
  });
}

/**
 * Get email template by code
 */
function getEmailTemplate(templateCode) {
  const cacheKey = 'email_template_' + templateCode;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  
  const sheet = getSheet(SHEETS.EMAIL_TEMPLATES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const codeIdx = headers.indexOf('template_code');
  const activeIdx = headers.indexOf('is_active');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][codeIdx] === templateCode && isActive(data[i][activeIdx])) {
      const template = rowToObject(headers, data[i]);
      cache.put(cacheKey, JSON.stringify(template), 3600); // 1 hour cache
      return template;
    }
  }
  
  return null;
}

/**
 * Get all active email templates
 */
function getEmailTemplates() {
  const sheet = getSheet(SHEETS.EMAIL_TEMPLATES);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const activeIdx = headers.indexOf('is_active');
  
  const templates = [];
  for (let i = 1; i < data.length; i++) {
    if (isActive(data[i][activeIdx])) {
      templates.push(rowToObject(headers, data[i]));
    }
  }
  
  return sanitizeForClient(templates);
}

// Process pending emails in queue (called by time-based trigger)
function processEmailQueue() {
  // Acquire lock to prevent concurrent trigger runs from sending duplicates
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Wait up to 10 seconds
  } catch (e) {
    console.log('Email queue already being processed by another instance');
    return { sent: 0, failed: 0, skipped: true };
  }
  
  try {
  const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  const now = new Date();
  const fromName = 'Internal Audit Notification';
  const maxRetries = 3;
  
  let sentCount = 0;
  let failedCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[colMap['status']];
    const scheduledFor = row[colMap['scheduled_for']];
    const retryCount = parseInt(row[colMap['retry_count']] || 0);
    
    // Skip if not pending or scheduled for future
    if (status !== STATUS.NOTIFICATION.PENDING) continue;
    if (scheduledFor && new Date(scheduledFor) > now) continue;
    if (retryCount >= maxRetries) continue;
    
    const recipientEmail = row[colMap['recipient_email']];
    const subject = row[colMap['subject']];
    const body = row[colMap['body']];
    const ccEmails = row[colMap['cc_emails']] || '';
    
    if (!recipientEmail || !subject) continue;
    
    const rowIndex = i + 1;
    const replyTo = 'audit@hasspetroleum.com';
    
    try {
      // Send email via unified sender (Brevo with MailApp fallback)
      const htmlBody = formatEmailHtml(subject, body);
      const result = sendEmail(recipientEmail, subject, body, htmlBody, ccEmails, fromName, replyTo);
      if (!result.success) {
        throw new Error(result.error || 'Email send failed');
      }
      
      // Update status to Sent
      sheet.getRange(rowIndex, colMap['status'] + 1).setValue(STATUS.NOTIFICATION.SENT);
      sheet.getRange(rowIndex, colMap['sent_at'] + 1).setValue(now);
      
      sentCount++;
      
    } catch (e) {
      // Increment retry_count and set status based on retries remaining
      const newRetryCount = retryCount + 1;
      if (colMap['retry_count'] !== undefined) {
        sheet.getRange(rowIndex, colMap['retry_count'] + 1).setValue(newRetryCount);
      }
      if (newRetryCount >= maxRetries) {
        // Max retries exhausted — mark as permanently failed
        sheet.getRange(rowIndex, colMap['status'] + 1).setValue(STATUS.NOTIFICATION.FAILED);
      } else {
        // Keep as PENDING so it retries on next queue run
        sheet.getRange(rowIndex, colMap['status'] + 1).setValue(STATUS.NOTIFICATION.PENDING);
      }
      sheet.getRange(rowIndex, colMap['error_message'] + 1).setValue(e.message);

      failedCount++;
      console.error('Failed to send email to', recipientEmail, '(attempt ' + newRetryCount + '/' + maxRetries + '):', e.message);
    }
    
    // Rate limiting - don't send too many at once
    if (sentCount >= 50) {
      console.log('Batch limit reached, will continue in next run');
      break;
    }
  }
  
  console.log('Email queue processed. Sent:', sentCount, 'Failed:', failedCount);
  return { sent: sentCount, failed: failedCount };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Convert plain URLs in text to styled button links (hides ugly raw URLs)
 */
function linkifyUrls(text) {
  if (!text) return '';
  return text.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="display:inline-block; background-color:#1a365d; color:#ffffff; padding:10px 24px; text-decoration:none; border-radius:5px; font-weight:600; margin:4px 0;">Click Here</a>'
  );
}

/**
 * Format email body as HTML
 */
function formatEmailHtml(subject, body) {
  const systemName = 'Internal Audit Notification';
  const primaryColor = '#1a365d';
  const accentColor = '#c9a227';
  
  // Convert \n to <br> for proper line breaks in HTML
  const htmlBody = linkifyUrls(body).replace(/\n/g, '<br>');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @media only screen and (max-width: 620px) {
      .email-outer { padding: 8px !important; }
      .email-inner { width: 100% !important; min-width: 100% !important; }
      .email-content { padding: 20px 16px !important; }
      .email-header { padding: 16px !important; }
      .email-footer { padding: 16px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5;" class="email-outer">
    <tr>
      <td align="center" style="padding: 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 680px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);" class="email-inner">
          <!-- Header -->
          <tr>
            <td style="background-color: ${primaryColor}; padding: 18px 24px; text-align: center;" class="email-header">
              <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">${systemName}</h1>
            </td>
          </tr>
          <!-- Accent Bar -->
          <tr>
            <td style="background-color: ${accentColor}; height: 3px;"></td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 28px 32px;" class="email-content">
              <h2 style="color: ${primaryColor}; margin: 0 0 16px 0; font-size: 18px;">${subject}</h2>
              <div style="color: #333333; line-height: 1.7; font-size: 14px;">${htmlBody}</div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 16px 24px; text-align: center; border-top: 1px solid #dee2e6;" class="email-footer">
              <p style="color: #6c757d; margin: 0; font-size: 11px;">
                This is an automated message from ${systemName}.<br>
                Replies go to the Internal Audit team.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Retry failed emails
 */
function retryFailedEmails() {
  const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  let resetCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const status = data[i][colMap['status']];
    
    if (status === STATUS.NOTIFICATION.FAILED) {
      // Reset to pending for retry
      sheet.getRange(i + 1, colMap['status'] + 1).setValue(STATUS.NOTIFICATION.PENDING);
      sheet.getRange(i + 1, colMap['error_message'] + 1).setValue('');
      resetCount++;
    }
  }
  
  console.log('Reset failed emails for retry:', resetCount);
  return resetCount;
}

// Send daily overdue reminders (called by daily trigger)
function sendOverdueReminders() {
  const actionPlans = getActionPlansRaw({ overdue_only: true }, null);
  
  if (actionPlans.length === 0) {
    console.log('No overdue action plans');
    return 0;
  }
  
  // Group by owner
  const byOwner = {};
  
  actionPlans.forEach(ap => {
    const ownerIds = String(ap.owner_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    
    ownerIds.forEach(ownerId => {
      if (!byOwner[ownerId]) {
        byOwner[ownerId] = [];
      }
      byOwner[ownerId].push(ap);
    });
  });
  
  let notificationCount = 0;
  
  // Send one email per owner with all their overdue items
  Object.keys(byOwner).forEach(ownerId => {
    const owner = getUserById(ownerId);
    if (!owner || !owner.email) return;
    
    const plans = byOwner[ownerId];
    const plansList = plans.map(ap => 
      `- ${ap.action_plan_id}: ${ap.action_description.substring(0, 50)}... (${ap.days_overdue} days overdue)`
    ).join('\n');
    
    queueEmail({
      template_code: 'OVERDUE_REMINDER',
      recipient_email: owner.email,
      recipient_user_id: ownerId,
      subject: `Action Required: ${plans.length} Overdue Action Plan(s)`,
      body: `You have ${plans.length} overdue action plan(s) that require your attention:\n\n${plansList}\n\nPlease log in to the system and update the status of these items.`,
      module: 'ACTION_PLAN',
      record_id: ''
    });
    
    notificationCount++;
  });
  
  // Also notify auditors of all overdue items
  const auditors = getUsersDropdown().filter(u => 
    [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].includes(u.roleCode)
  );
  
  if (actionPlans.length > 0 && auditors.length > 0) {
    const summary = `Total overdue action plans: ${actionPlans.length}\n\n` +
      actionPlans.slice(0, 20).map(ap => 
        `- ${ap.action_plan_id}: ${ap.days_overdue} days overdue`
      ).join('\n') +
      (actionPlans.length > 20 ? `\n... and ${actionPlans.length - 20} more` : '');
    
    auditors.forEach(auditor => {
      queueEmail({
        template_code: 'AUDITOR_OVERDUE_SUMMARY',
        recipient_email: auditor.email,
        recipient_user_id: auditor.id,
        subject: `Daily Summary: ${actionPlans.length} Overdue Action Plans`,
        body: summary,
        module: 'ACTION_PLAN',
        record_id: ''
      });
      notificationCount++;
    });
  }
  
  console.log('Queued overdue reminders:', notificationCount);
  return notificationCount;
}

/**
 * Send upcoming due date reminders
 * Called by daily trigger
 */
function sendUpcomingDueReminders() {
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const reminderDays = [7, 3, 1]; // Send reminders 7, 3, and 1 day before due
  
  let notificationCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[colMap['status']];
    const dueDate = row[colMap['due_date']];
    const ownerIds = row[colMap['owner_ids']];
    const actionPlanId = row[colMap['action_plan_id']];
    const description = row[colMap['action_description']];
    
    // Skip if already implemented or no due date
    if (!dueDate) continue;
    if (isImplementedOrVerified(status)) continue;
    
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    
    const daysUntilDue = Math.floor((due - today) / (1000 * 60 * 60 * 24));
    
    // Check if this is a reminder day
    if (reminderDays.includes(daysUntilDue)) {
      const owners = String(ownerIds || '').split(',').map(s => s.trim()).filter(Boolean);
      
      owners.forEach(ownerId => {
        const owner = getUserById(ownerId);
        if (owner && owner.email) {
          queueEmail({
            template_code: 'DUE_DATE_REMINDER',
            recipient_email: owner.email,
            recipient_user_id: ownerId,
            subject: `Reminder: Action Plan Due in ${daysUntilDue} Day(s)`,
            body: `This is a reminder that the following action plan is due in ${daysUntilDue} day(s):\n\n` +
              `Action Plan: ${actionPlanId}\n` +
              `Description: ${description}\n` +
              `Due Date: ${formatDate(dueDate, 'YYYY-MM-DD')}\n\n` +
              `Please ensure you complete this action on time.`,
            module: 'ACTION_PLAN',
            record_id: actionPlanId
          });
          notificationCount++;
        }
      });
    }
  }
  
  console.log('Queued upcoming due reminders:', notificationCount);
  return notificationCount;
}

/**
 * Send weekly summary to management
 * Called by weekly trigger
 */
function sendWeeklySummary() {
  const wpCounts = getWorkPaperCounts({}, null);
  const apCounts = getActionPlanCounts({}, null);
  
  const summary = `
WEEKLY AUDIT SUMMARY
====================

WORK PAPERS
-----------
Total: ${wpCounts.total}
By Status:
${Object.entries(wpCounts.byStatus).map(([k, v]) => `  - ${k}: ${v}`).join('\n')}

ACTION PLANS
------------
Total: ${apCounts.total}
Overdue: ${apCounts.overdue}
Due This Week: ${apCounts.dueThisWeek}
By Status:
${Object.entries(apCounts.byStatus).map(([k, v]) => `  - ${k}: ${v}`).join('\n')}
`;

  // Send to management and HOA
  const recipients = getUsersDropdown().filter(u => 
    [ROLES.SUPER_ADMIN, ROLES.MANAGEMENT, ROLES.SENIOR_MGMT].includes(u.roleCode)
  );
  
  let notificationCount = 0;
  
  recipients.forEach(recipient => {
    queueEmail({
      template_code: 'WEEKLY_SUMMARY',
      recipient_email: recipient.email,
      recipient_user_id: recipient.id,
      subject: 'Weekly Audit Summary Report',
      body: summary,
      module: 'SYSTEM',
      record_id: ''
    });
    notificationCount++;
  });
  
  console.log('Queued weekly summaries:', notificationCount);
  return notificationCount;
}

// Setup all notification triggers (run once to configure)
function setupNotificationTriggers() {
  // Remove existing triggers for these functions
  const functionNames = [
    'processEmailQueue',
    'sendOverdueReminders',
    'sendUpcomingDueReminders',
    'sendWeeklySummary',
    'dailyMaintenance'
  ];
  
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (functionNames.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Process email queue every 10 minutes
  ScriptApp.newTrigger('processEmailQueue')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  // Daily maintenance at 6 AM
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  
  // Weekly summary on Monday at 8 AM
  ScriptApp.newTrigger('sendWeeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();
  
  console.log('Notification triggers configured');
  return { success: true };
}

/**
 * Daily maintenance tasks
 */
function dailyMaintenance() {
  console.log('Starting daily maintenance...');
  
  // Update overdue statuses
  const overdueUpdated = updateOverdueStatuses();
  console.log('Overdue statuses updated:', overdueUpdated);
  
  // Send overdue reminders
  const overdueReminders = sendOverdueReminders();
  console.log('Overdue reminders queued:', overdueReminders);
  
  // Send upcoming due reminders
  const upcomingReminders = sendUpcomingDueReminders();
  console.log('Upcoming due reminders queued:', upcomingReminders);
  
  // Clean up old sent notifications (older than 30 days)
  const cleaned = cleanupOldNotifications(30);
  console.log('Old notifications cleaned:', cleaned);
  
  // Rebuild indexes (optional, for data integrity)
  // rebuildWorkPaperIndex();
  // rebuildActionPlanIndex();
  
  console.log('Daily maintenance completed');
  
  return {
    overdueUpdated,
    overdueReminders,
    upcomingReminders,
    cleaned
  };
}

/**
 * Clean up old sent notifications
 */
function cleanupOldNotifications(daysOld) {
  const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  let deletedCount = 0;
  
  // Delete from bottom to top
  for (let i = data.length - 1; i >= 1; i--) {
    const status = data[i][colMap['status']];
    const sentAt = data[i][colMap['sent_at']];
    
    if (status === STATUS.NOTIFICATION.SENT && sentAt) {
      const sentDate = new Date(sentAt);
      if (sentDate < cutoffDate) {
        sheet.deleteRow(i + 1);
        deletedCount++;
      }
    }
  }
  
  return deletedCount;
}

// Send immediate email (bypass queue) - use sparingly for critical notifications
function sendImmediateEmail(recipientEmail, subject, body, ccEmails) {
  try {
    const fromName = 'Internal Audit Notification';
    const replyTo = 'audit@hasspetroleum.com';
    const htmlBody = formatEmailHtml(subject, body);

    const result = sendEmail(recipientEmail, subject, body, htmlBody, ccEmails, fromName, replyTo);
    if (!result.success) {
      throw new Error(result.error || 'Email send failed');
    }

    return { success: true };
  } catch (e) {
    console.error('Failed to send immediate email:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Get notification queue status
 */
function getNotificationQueueStatus() {
  const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  const counts = {
    pending: 0,
    sent: 0,
    failed: 0,
    total: data.length - 1
  };
  
  for (let i = 1; i < data.length; i++) {
    const status = data[i][colMap['status']];
    if (status === STATUS.NOTIFICATION.PENDING) counts.pending++;
    else if (status === STATUS.NOTIFICATION.SENT) counts.sent++;
    else if (status === STATUS.NOTIFICATION.FAILED) counts.failed++;
  }
  
  return sanitizeForClient(counts);
}

/**
 * Get recent notifications for a user
 */
function getUserNotifications(userId, limit) {
  limit = limit || 20;
  
  const sheet = getSheet(SHEETS.NOTIFICATION_QUEUE);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  const notifications = [];
  
  for (let i = data.length - 1; i >= 1 && notifications.length < limit; i--) {
    if (data[i][colMap['recipient_user_id']] === userId) {
      notifications.push(rowToObject(headers, data[i]));
    }
  }
  
  return sanitizeForClient(notifications);
}

/**
 * Get Brevo configuration status (for Settings UI)
 */
function getBrevoStatus() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('BREVO_API_KEY');

  if (key) {
    var masked = key.substring(0, 8) + '...' + key.substring(key.length - 4);
    return { configured: true, keyMasked: masked };
  }
  return { configured: false };
}

/**
 * Save Brevo API key (requires SUPER_ADMIN)
 */
function saveBrevoKey(apiKey, user) {
  if (!apiKey || apiKey.trim().length < 10) {
    return { success: false, error: 'Invalid API key' };
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty('BREVO_API_KEY', apiKey.trim());

  logAuditEvent('SET_BREVO_KEY', 'CONFIG', 'EMAIL', null, { provider: 'brevo' }, user.user_id, user.email);

  return { success: true };
}

/**
 * Remove Brevo API key (requires SUPER_ADMIN)
 */
function removeBrevoKeyAction(user) {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('BREVO_API_KEY');

  logAuditEvent('REMOVE_BREVO_KEY', 'CONFIG', 'EMAIL', null, null, user.user_id, user.email);

  return { success: true };
}

/**
 * Send a test email via Brevo to verify configuration
 */
function testBrevoEmailAction(recipientEmail, user) {
  if (!recipientEmail) {
    return { success: false, error: 'No recipient email provided' };
  }

  var subject = 'Test Email - Hass Petroleum Audit System';
  var body = 'This is a test email from the Internal Audit System.\n\nIf you received this, your Brevo email integration is working correctly.\n\nSent at: ' + new Date().toISOString();
  var htmlBody = formatEmailHtml(subject, body);

  var result = sendEmailViaBrevo(recipientEmail, subject, htmlBody, null);

  if (result.success) {
    return { success: true };
  } else if (result.fallback) {
    return { success: false, error: 'Brevo API key not configured. Please save a key first.' };
  } else {
    return { success: false, error: result.error || 'Test email failed' };
  }
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)
