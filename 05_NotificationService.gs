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
    replyTo: { name: 'Hass Audit Team', email: 'hassaudit@outlook.com' },
    to: toList,
    subject: subject,
    htmlContent: htmlBody,
    headers: {
      'X-Mailer': 'Hass Petroleum Audit System',
      'Organization': 'Hass Petroleum - Internal Audit'
    }
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
 * Currently uses MailApp (sends from wmurikah@gmail.com).
 * To switch back to Brevo later, uncomment the Brevo block below.
 */
function sendEmail(recipientEmail, subject, body, htmlBody, ccEmails, fromName, replyTo) {
  // --- BREVO (disabled for now — uncomment to re-enable) ---
  // var brevoResult = sendEmailViaBrevo(recipientEmail, subject, htmlBody, ccEmails);
  // if (brevoResult.success) { return brevoResult; }
  // if (!brevoResult.fallback) { return brevoResult; }

  // Send via MailApp (sends from the Google account: wmurikah@gmail.com)
  var emailOptions = {
    to: recipientEmail,
    subject: subject,
    body: body,
    name: fromName || 'Hass Audit',
    replyTo: replyTo || 'wmurikah@gmail.com',
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
    const replyTo = 'wmurikah@gmail.com';
    
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
 * Format email body as clean branded HTML (no top header bar)
 */
function formatEmailHtml(subject, body) {
  const navy = '#1a365d';
  const gold = '#c9a227';
  const year = new Date().getFullYear();

  const htmlBody = linkifyUrls(body).replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @media only screen and (max-width: 620px) {
      .email-outer { padding: 4px !important; }
      .email-inner { width: 100% !important; min-width: 100% !important; }
      .email-content { padding: 20px 16px !important; }
      .email-footer { padding: 16px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; background-color:#edf0f5; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    ${subject} &mdash; Hass Petroleum Internal Audit &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edf0f5;" class="email-outer">
    <tr><td align="center" style="padding:20px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px; background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);" class="email-inner">
        <!-- SUBJECT BANNER -->
        <tr>
          <td style="background-color:#f8f9fb; padding:18px 32px; border-bottom:1px solid #e5e7eb;">
            <p style="margin:0; color:${navy}; font-size:17px; font-weight:600;">${subject}</p>
          </td>
        </tr>
        <!-- MAIN CONTENT -->
        <tr>
          <td style="padding:28px 32px 32px 32px;" class="email-content">
            <div style="color:#374151; line-height:1.75; font-size:14px;">${htmlBody}</div>
          </td>
        </tr>
        <!-- FOOTER -->
        <tr>
          <td style="background-color:${navy}; padding:16px 32px;" class="email-footer">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center">
                  <p style="margin:0 0 4px 0; color:${gold}; font-size:11px; font-weight:600; letter-spacing:1px;">HASS PETROLEUM</p>
                  <p style="margin:0; color:#64748b; font-size:10px;">Internal Audit &bull; &copy; ${year}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Format email with a professional data table
 * @param {string} subject - Email subject
 * @param {string} intro - Intro paragraph text
 * @param {string[]} headers - Table column headers
 * @param {string[][]} rows - Table data rows
 * @param {string} [outro] - Optional closing paragraph
 */
function formatTableEmailHtml(subject, intro, headers, rows, outro) {
  const navy = '#1a365d';
  const gold = '#c9a227';
  const year = new Date().getFullYear();

  // Build table header cells
  const thCells = headers.map(h =>
    `<th style="background-color:${navy}; color:#ffffff; padding:10px 12px; text-align:left; font-size:12px; font-weight:600; letter-spacing:0.5px; border-bottom:2px solid ${gold};">${h}</th>`
  ).join('');

  // Build table body rows
  const trRows = rows.map((row, idx) => {
    const bg = idx % 2 === 0 ? '#ffffff' : '#f8f9fb';
    const cells = row.map(cell =>
      `<td style="padding:9px 12px; font-size:13px; color:#374151; border-bottom:1px solid #e5e7eb;">${cell}</td>`
    ).join('');
    return `<tr style="background-color:${bg};">${cells}</tr>`;
  }).join('');

  const outroHtml = outro ? `<div style="color:#374151; line-height:1.6; font-size:14px; margin-top:20px;">${linkifyUrls(outro).replace(/\n/g, '<br>')}</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    @media only screen and (max-width: 620px) {
      .email-outer { padding: 4px !important; }
      .email-inner { width: 100% !important; min-width: 100% !important; }
      .email-content { padding: 16px 12px !important; }
      .email-footer { padding: 12px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Arial, Helvetica, sans-serif; background-color:#edf0f5;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
    ${subject} &mdash; Hass Petroleum Internal Audit &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#edf0f5;" class="email-outer">
    <tr><td align="center" style="padding:20px 8px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:700px; background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.08);" class="email-inner">
        <!-- SUBJECT -->
        <tr>
          <td style="background-color:#f8f9fb; padding:18px 28px; border-bottom:1px solid #e5e7eb;">
            <p style="margin:0; color:${navy}; font-size:17px; font-weight:600;">${subject}</p>
          </td>
        </tr>
        <!-- CONTENT + TABLE -->
        <tr>
          <td style="padding:24px 28px;" class="email-content">
            <div style="color:#374151; line-height:1.6; font-size:14px; margin-bottom:18px;">${intro}</div>
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb; border-radius:6px; border-collapse:separate; overflow:hidden;">
              <thead><tr>${thCells}</tr></thead>
              <tbody>${trRows}</tbody>
            </table>
            ${outroHtml}
          </td>
        </tr>
        <!-- FOOTER -->
        <tr>
          <td style="background-color:${navy}; padding:16px 28px;" class="email-footer">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center">
                  <p style="margin:0 0 4px 0; color:${gold}; font-size:11px; font-weight:600; letter-spacing:1px;">HASS PETROLEUM</p>
                  <p style="margin:0; color:#64748b; font-size:10px;">Internal Audit &bull; &copy; ${year}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Helper: truncate text to N words
 */
function truncateWords(text, maxWords) {
  if (!text) return '';
  var words = String(text).split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '...';
}

/**
 * Rating badge HTML for email tables
 */
function ratingBadge(rating) {
  if (!rating) return '<span style="color:#9ca3af;">-</span>';
  var r = String(rating).toUpperCase();
  var bg = '#6b7280'; var color = '#ffffff';
  if (r === 'HIGH' || r === 'CRITICAL') { bg = '#dc2626'; }
  else if (r === 'MEDIUM') { bg = '#f59e0b'; color = '#1a1a1a'; }
  else if (r === 'LOW') { bg = '#16a34a'; }
  return '<span style="display:inline-block; background-color:' + bg + '; color:' + color + '; padding:2px 8px; border-radius:3px; font-size:11px; font-weight:600;">' + r + '</span>';
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

/**
 * Send batched auditee notification with professional table.
 * Called when work papers are sent to auditees — groups by auditee and sends ONE email per person.
 * @param {Object[]} workPapers - Array of work paper objects sent to this auditee
 * @param {string} auditeeEmail - Recipient email
 * @param {string} auditeeUserId - Recipient user ID
 * @param {string} auditeeName - Recipient name
 */
function sendBatchedAuditeeNotification(workPapers, auditeeEmail, auditeeUserId, auditeeName) {
  if (!workPapers || workPapers.length === 0 || !auditeeEmail) return;

  var subject = workPapers.length === 1
    ? 'Audit Finding Requires Your Response'
    : workPapers.length + ' Audit Findings Require Your Response';

  var intro = 'Dear ' + (auditeeName || 'Auditee') + ',<br><br>' +
    'The following audit finding' + (workPapers.length > 1 ? 's have' : ' has') +
    ' been reviewed and approved. Please respond with your action plan' + (workPapers.length > 1 ? 's.' : '.');

  var headers = ['Observation', 'Details', 'Rating'];
  var rows = workPapers.map(function(wp) {
    return [
      String(wp.observation_title || wp.work_paper_id || '-'),
      truncateWords(wp.observation_description || wp.risk_description || '', 10),
      ratingBadge(wp.risk_rating)
    ];
  });

  var outro = 'Please log in to the system and submit your action plans at your earliest convenience.';
  var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);

  sendEmail(auditeeEmail, subject, subject, htmlBody, null, 'Hass Audit', 'wmurikah@gmail.com');
}

// Send daily overdue reminders with professional table (called by daily trigger)
function sendOverdueReminders() {
  const actionPlans = getActionPlansRaw({ overdue_only: true }, null);

  if (actionPlans.length === 0) {
    console.log('No overdue action plans');
    return 0;
  }

  // Group by owner
  const byOwner = {};
  actionPlans.forEach(function(ap) {
    var ownerIds = String(ap.owner_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    ownerIds.forEach(function(ownerId) {
      if (!byOwner[ownerId]) byOwner[ownerId] = [];
      byOwner[ownerId].push(ap);
    });
  });

  let notificationCount = 0;
  const tableHeaders = ['Observation', 'Summary', 'Rating', 'Due', 'Days Overdue'];

  // Send one table-formatted email per owner
  Object.keys(byOwner).forEach(function(ownerId) {
    const owner = getUserById(ownerId);
    if (!owner || !owner.email) return;

    const plans = byOwner[ownerId];
    const subject = 'Action Required: ' + plans.length + ' Overdue Action Plan(s)';
    const intro = 'Dear ' + (owner.full_name || 'Colleague') + ',<br><br>' +
      'You have <strong>' + plans.length + '</strong> overdue action plan(s) that require your immediate attention:';

    const rows = plans.map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysOver = ap.days_overdue ? '<span style="color:#dc2626; font-weight:600;">' + ap.days_overdue + '</span>' : '-';
      return [
        String(ap.action_description || ap.action_plan_id || '-').substring(0, 40),
        truncateWords(ap.action_description || '', 8),
        ratingBadge(ap.risk_rating || ''),
        dueStr,
        daysOver
      ];
    });

    const outro = 'Please log in and update the status of these items immediately.';
    const htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);
    sendEmail(owner.email, subject, subject, htmlBody, null, 'Hass Audit', 'wmurikah@gmail.com');
    notificationCount++;
  });

  // Auditor summary with full table
  const auditors = getUsersDropdown().filter(function(u) {
    return [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].includes(u.roleCode);
  });

  if (actionPlans.length > 0 && auditors.length > 0) {
    const summarySubject = 'Daily Summary: ' + actionPlans.length + ' Overdue Action Plans';
    const summaryIntro = 'The following action plans are currently overdue across all owners:';
    const summaryRows = actionPlans.slice(0, 50).map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysOver = ap.days_overdue ? '<span style="color:#dc2626; font-weight:600;">' + ap.days_overdue + '</span>' : '-';
      return [
        String(ap.action_description || ap.action_plan_id || '-').substring(0, 40),
        truncateWords(ap.action_description || '', 8),
        ratingBadge(ap.risk_rating || ''),
        dueStr,
        daysOver
      ];
    });
    var summaryOutro = actionPlans.length > 50 ? '... and ' + (actionPlans.length - 50) + ' more overdue items.' : '';
    var summaryHtml = formatTableEmailHtml(summarySubject, summaryIntro, tableHeaders, summaryRows, summaryOutro);

    auditors.forEach(function(auditor) {
      sendEmail(auditor.email, summarySubject, summarySubject, summaryHtml, null, 'Hass Audit', 'wmurikah@gmail.com');
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
    const replyTo = 'wmurikah@gmail.com';
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
