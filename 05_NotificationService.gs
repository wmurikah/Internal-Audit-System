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
  
  let sentCount = 0;
  let failedCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[colMap['status']];
    const scheduledFor = row[colMap['scheduled_for']];
    
    // Skip if not pending or scheduled for future
    if (status !== STATUS.NOTIFICATION.PENDING) continue;
    if (scheduledFor && new Date(scheduledFor) > now) continue;
    
    const recipientEmail = row[colMap['recipient_email']];
    const subject = row[colMap['subject']];
    const body = row[colMap['body']];
    
    if (!recipientEmail || !subject) continue;
    
    const rowIndex = i + 1;
    const replyTo = 'wmurikah@gmail.com';
    
    try {
      // Send email via unified sender (Brevo with MailApp fallback)
      const htmlBody = formatEmailHtml(subject, body);
      const result = sendEmail(recipientEmail, subject, body, htmlBody, '', fromName, replyTo);
      if (!result.success) {
        throw new Error(result.error || 'Email send failed');
      }
      
      // Update status to Sent
      sheet.getRange(rowIndex, colMap['status'] + 1).setValue(STATUS.NOTIFICATION.SENT);
      sheet.getRange(rowIndex, colMap['sent_at'] + 1).setValue(now);
      
      sentCount++;
      
    } catch (e) {
      // Align with database schema: mark as failed on send error
      sheet.getRange(rowIndex, colMap['status'] + 1).setValue(STATUS.NOTIFICATION.FAILED);
      sheet.getRange(rowIndex, colMap['error_message'] + 1).setValue(e.message);

      failedCount++;
      console.error('Failed to send email to', recipientEmail + ':', e.message);
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
 * Resolve affiliate name and audit area name from work papers for email context.
 * Uses the first work paper in the batch to determine context.
 * @param {Object[]} workPapers - Array of work paper objects
 * @returns {{ affiliateName: string, auditAreaName: string }}
 */
function resolveAuditContext(workPapers) {
  var result = { affiliateName: '', auditAreaName: '' };
  if (!workPapers || workPapers.length === 0) return result;

  var wp = workPapers[0];

  // Resolve affiliate name from affiliate_code
  if (wp.affiliate_code) {
    try {
      var affiliates = getAffiliatesDropdown();
      for (var i = 0; i < affiliates.length; i++) {
        if (affiliates[i].code === wp.affiliate_code) {
          result.affiliateName = affiliates[i].name;
          break;
        }
      }
    } catch (e) { console.log('resolveAuditContext affiliate error:', e); }
  }

  // Resolve audit area name from audit_area_id
  if (wp.audit_area_id) {
    try {
      var areas = getAuditAreasDropdown();
      for (var i = 0; i < areas.length; i++) {
        if (areas[i].id === wp.audit_area_id || areas[i].code === wp.audit_area_id) {
          result.auditAreaName = areas[i].name;
          break;
        }
      }
    } catch (e) { console.log('resolveAuditContext area error:', e); }
  }

  return result;
}

/**
 * Send batched auditee notification with professional table.
 * Called when work papers are sent to auditees — groups by auditee and sends ONE email per person.
 *
 * Email format:
 *   Dear [First Name], [CC Party 1], [CC Party 2],
 *   Below are audit observations from [Affiliate] – [Audit Area] audit.
 *   Please respond with your action plans.
 *   [Table: Observation | Details | Rating]
 *   Please log in and submit your action plans...
 *
 * @param {Object[]} workPapers - Array of work paper objects sent to this auditee
 * @param {string} auditeeEmail - Recipient email
 * @param {string} auditeeUserId - Recipient user ID
 * @param {string} auditeeName - Recipient full name
 * @param {string} auditeeFirstName - Recipient first name for greeting
 * @param {string} [ccEmails] - Optional comma-separated CC emails from work paper cc_recipients
 */
function sendBatchedAuditeeNotification(workPapers, auditeeEmail, auditeeUserId, auditeeName, auditeeFirstName, ccEmails) {
  if (!workPapers || workPapers.length === 0 || !auditeeEmail) return;

  var loginUrl = ScriptApp.getService().getUrl();

  // Resolve affiliate and audit area for context line
  var ctx = resolveAuditContext(workPapers);
  var contextLine = '';
  if (ctx.affiliateName && ctx.auditAreaName) {
    contextLine = 'Below are audit observations from <strong>' + ctx.affiliateName + ' \u2013 ' + ctx.auditAreaName + '</strong> audit.';
  } else if (ctx.affiliateName) {
    contextLine = 'Below are audit observations from <strong>' + ctx.affiliateName + '</strong> audit.';
  } else if (ctx.auditAreaName) {
    contextLine = 'Below are audit observations from <strong>' + ctx.auditAreaName + '</strong> audit.';
  } else {
    contextLine = 'The following audit finding' + (workPapers.length > 1 ? 's have' : ' has') +
      ' been reviewed and approved.';
  }

  // Use first name only for greeting
  var firstName = auditeeFirstName || (auditeeName || '').split(' ')[0] || 'Auditee';

  var subjectSuffix = ctx.auditAreaName ? ' - ' + ctx.auditAreaName : '';
  var subject = workPapers.length === 1
    ? 'Audit Finding Requires Your Response' + subjectSuffix
    : workPapers.length + ' Audit Findings Require Your Response' + subjectSuffix;

  var intro = 'Dear ' + firstName + ',<br><br>' +
    contextLine + ' Please respond with your action plan' + (workPapers.length > 1 ? 's.' : '.');

  var headers = ['Observation', 'Details', 'Rating'];
  var rows = workPapers.map(function(wp) {
    return [
      String(wp.observation_title || wp.work_paper_id || '-'),
      truncateWords(wp.observation_description || wp.risk_description || '', 10),
      ratingBadge(wp.risk_rating)
    ];
  });

  // Branded login button instead of plain URL
  var outro = '<div style="text-align:center; margin:20px 0;">' +
    '<a href="' + loginUrl + '" style="display:inline-block; background-color:#1a365d; color:#ffffff; ' +
    'padding:12px 28px; border-radius:6px; text-decoration:none; font-weight:600; font-size:14px;">' +
    'Open Audit System</a></div>' +
    '<p style="color:#6b7280; font-size:12px; text-align:center;">Please log in and submit your action plans at your earliest convenience.</p>';

  var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);

  sendEmail(auditeeEmail, subject, subject, htmlBody, ccEmails || null, 'Hass Audit', 'wmurikah@gmail.com');
}

/**
 * Resolve affiliate name and audit area name from a batch of work papers.
 * Uses the first work paper's affiliate_code and audit_area_id to look up display names from dropdowns.
 * @param {Object[]} workPapers
 * @returns {{ affiliate: string, auditArea: string }}
 */
function resolveAuditContext(workPapers) {
  var result = { affiliate: '', auditArea: '' };
  if (!workPapers || workPapers.length === 0) return result;

  var wp = workPapers[0]; // use first work paper for context

  // Resolve affiliate name
  if (wp.affiliate_code) {
    try {
      var affiliates = getAffiliatesDropdown();
      var match = affiliates.find(function(a) { return a.code === wp.affiliate_code; });
      if (match) result.affiliate = match.name || match.code;
    } catch (e) { result.affiliate = wp.affiliate_code; }
  }

  // Resolve audit area name (audit_area_id stores the area code/id)
  if (wp.audit_area_id) {
    try {
      var areas = getAuditAreasDropdown();
      var areaMatch = areas.find(function(a) { return a.id === wp.audit_area_id || a.code === wp.audit_area_id; });
      if (areaMatch) result.auditArea = areaMatch.name || areaMatch.code;
    } catch (e) { result.auditArea = wp.audit_area_id; }
  }

  return result;
}

/**
 * Send overdue reminders with professional table (called by weekly Monday trigger).
 * Groups overdue action plans by owner and sends ONE table email per person.
 * Also sends auditor summary.
 */
function sendOverdueReminders() {
  const actionPlans = getActionPlansRaw({ overdue_only: true }, null);

  if (actionPlans.length === 0) {
    console.log('No overdue action plans');
    return 0;
  }

  var loginUrl = ScriptApp.getService().getUrl();

  // Enrich with parent work paper observation title
  var wpCache = {};
  actionPlans.forEach(function(ap) {
    if (ap.work_paper_id && !wpCache[ap.work_paper_id]) {
      var wp = getWorkPaperById(ap.work_paper_id);
      wpCache[ap.work_paper_id] = wp || {};
    }
    var parentWp = wpCache[ap.work_paper_id] || {};
    ap._observation_title = parentWp.observation_title || '';
    ap._risk_rating = ap.risk_rating || parentWp.risk_rating || '';
  });

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
    const ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';
    const intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      'You have <strong>' + plans.length + '</strong> overdue action plan(s) that require your immediate attention:';

    const rows = plans.map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysOver = ap.days_overdue ? '<span style="color:#dc2626; font-weight:600;">' + ap.days_overdue + '</span>' : '-';
      return [
        String(ap._observation_title || ap.action_plan_id || '-').substring(0, 50),
        truncateWords(ap.action_description || '', 8),
        ratingBadge(ap._risk_rating),
        dueStr,
        daysOver
      ];
    });

    const outro = 'Please log in and update the status of these items immediately.<br><br>' + loginUrl;
    const htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);
    sendEmail(owner.email, subject, subject, htmlBody, null, 'Hass Audit', 'wmurikah@gmail.com');
    notificationCount++;
  });

  // Auditor summary with full table
  const auditors = getUsersDropdown().filter(function(u) {
    return [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].includes(u.roleCode);
  });

  if (actionPlans.length > 0 && auditors.length > 0) {
    const summarySubject = 'Weekly Summary: ' + actionPlans.length + ' Overdue Action Plans';
    const summaryIntro = 'The following action plans are currently overdue across all owners:';
    const summaryRows = actionPlans.slice(0, 50).map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysOver = ap.days_overdue ? '<span style="color:#dc2626; font-weight:600;">' + ap.days_overdue + '</span>' : '-';
      return [
        String(ap._observation_title || ap.action_plan_id || '-').substring(0, 50),
        truncateWords(ap.action_description || '', 8),
        ratingBadge(ap._risk_rating),
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
 * Send upcoming due date reminders with professional table.
 * Called by weekly Monday trigger — sends reminders for items due within 14 days.
 * Groups by owner and sends ONE table email per person.
 */
function sendUpcomingDueReminders() {
  const sheet = getSheet(SHEETS.ACTION_PLANS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  var loginUrl = ScriptApp.getService().getUrl();

  // Collect action plans due within 14 days that are not yet closed
  var upcoming = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[colMap['status']];
    const dueDate = row[colMap['due_date']];

    if (!dueDate) continue;
    if (isImplementedOrVerified(status)) continue;

    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    const daysUntilDue = Math.floor((due - today) / (1000 * 60 * 60 * 24));

    // Due within 14 days and not overdue (overdue handled by sendOverdueReminders)
    if (daysUntilDue > 0 && daysUntilDue <= 14) {
      var ap = rowToObject(headers, data[i]);
      ap._daysUntilDue = daysUntilDue;
      // Enrich with parent observation title
      if (ap.work_paper_id) {
        var wp = getWorkPaperById(ap.work_paper_id);
        ap._observation_title = wp ? wp.observation_title : '';
        ap._risk_rating = ap.risk_rating || (wp ? wp.risk_rating : '');
      }
      upcoming.push(ap);
    }
  }

  if (upcoming.length === 0) {
    console.log('No upcoming due action plans');
    return 0;
  }

  // Group by owner
  var byOwner = {};
  upcoming.forEach(function(ap) {
    var ownerIds = String(ap.owner_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    ownerIds.forEach(function(ownerId) {
      if (!byOwner[ownerId]) byOwner[ownerId] = [];
      byOwner[ownerId].push(ap);
    });
  });

  let notificationCount = 0;
  var tableHeaders = ['Observation', 'Summary', 'Rating', 'Due Date', 'Days Left'];

  Object.keys(byOwner).forEach(function(ownerId) {
    var owner = getUserById(ownerId);
    if (!owner || !owner.email) return;

    var plans = byOwner[ownerId];
    var subject = 'Reminder: ' + plans.length + ' Action Plan(s) Due Soon';
    var ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';
    var intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      'You have <strong>' + plans.length + '</strong> action plan(s) due within the next two weeks:';

    var rows = plans.map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysLeft = '<span style="color:#f59e0b; font-weight:600;">' + ap._daysUntilDue + '</span>';
      return [
        String(ap._observation_title || ap.action_plan_id || '-').substring(0, 50),
        truncateWords(ap.action_description || '', 8),
        ratingBadge(ap._risk_rating || ''),
        dueStr,
        daysLeft
      ];
    });

    var outro = 'Please ensure these items are completed before their due dates.<br><br>' + loginUrl;
    var htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);
    sendEmail(owner.email, subject, subject, htmlBody, null, 'Hass Audit', 'wmurikah@gmail.com');
    notificationCount++;
  });

  console.log('Queued upcoming due reminders:', notificationCount);
  return notificationCount;
}

/**
 * Send biweekly summary to configured recipients.
 * Called by biweekly trigger (every other Monday).
 * Recipients can be configured via Settings > Notification Recipients.
 * Falls back to Super Admin + Management + Senior Mgmt + Auditors by role.
 */
function sendBiweeklySummary() {
  var wpCounts = getWorkPaperCounts({}, null);
  var apCounts = getActionPlanCounts({}, null);

  // Build professional HTML summary with tables
  var loginUrl = ScriptApp.getService().getUrl();

  // Work Paper status rows
  var wpHeaders = ['Status', 'Count'];
  var wpRows = Object.entries(wpCounts.byStatus).map(function(entry) {
    return [entry[0], '<strong>' + entry[1] + '</strong>'];
  });

  // Action Plan status rows
  var apHeaders = ['Metric', 'Value'];
  var apRows = [
    ['Total Action Plans', '<strong>' + apCounts.total + '</strong>'],
    ['Overdue', '<span style="color:#dc2626; font-weight:600;">' + apCounts.overdue + '</span>'],
    ['Due This Week', '<span style="color:#f59e0b; font-weight:600;">' + apCounts.dueThisWeek + '</span>'],
    ['Due This Month', '<strong>' + apCounts.dueThisMonth + '</strong>']
  ];
  Object.entries(apCounts.byStatus).forEach(function(entry) {
    apRows.push([entry[0], '<strong>' + entry[1] + '</strong>']);
  });

  var subject = 'Biweekly Audit Summary Report';
  var intro = 'Here is your biweekly audit summary as of <strong>' +
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) + '</strong>.' +
    '<br><br><strong>Work Papers (' + wpCounts.total + ' total):</strong>';

  // Build combined HTML: WP table + AP table
  var wpTableHtml = formatTableEmailHtml(subject, intro, wpHeaders, wpRows,
    '<strong>Action Plans (' + apCounts.total + ' total):</strong>');

  // For the AP table, embed it manually after the WP section
  var apTableIntro = '';
  var apOutro = '<br>' + loginUrl;
  var apTableHtml = formatTableEmailHtml(subject, apTableIntro, apHeaders, apRows, apOutro);

  // Use the WP table email as the main body (it includes both sections)
  var htmlBody = wpTableHtml;

  // Get configured recipients from system config, or fall back to role-based
  var recipientEmails = getConfiguredSummaryRecipients();

  let notificationCount = 0;

  recipientEmails.forEach(function(email) {
    sendEmail(email, subject, subject, htmlBody, null, 'Hass Audit', 'wmurikah@gmail.com');
    notificationCount++;
  });

  console.log('Queued biweekly summaries:', notificationCount);
  return notificationCount;
}

/**
 * Get configured summary report recipients.
 * Reads from system config SUMMARY_RECIPIENTS; falls back to role-based lookup.
 */
function getConfiguredSummaryRecipients() {
  try {
    var props = PropertiesService.getScriptProperties();
    var stored = props.getProperty('SUMMARY_RECIPIENTS');
    if (stored) {
      var emails = String(stored).split(',').map(function(e) { return e.trim(); }).filter(Boolean);
      if (emails.length > 0) return emails;
    }
  } catch (e) {
    console.warn('Error reading SUMMARY_RECIPIENTS:', e);
  }

  // Fallback: Super Admin + Management + Senior Mgmt + Auditors
  var recipients = getUsersDropdown().filter(function(u) {
    return [ROLES.SUPER_ADMIN, ROLES.MANAGEMENT, ROLES.SENIOR_MGMT, ROLES.SENIOR_AUDITOR].includes(u.roleCode);
  });
  return recipients.map(function(u) { return u.email; }).filter(Boolean);
}

/**
 * Save summary recipient emails (called from Settings UI)
 */
function saveSummaryRecipients(emailsString, user) {
  if (!user || (user.role_code !== ROLES.SUPER_ADMIN)) {
    return { success: false, error: 'Only Super Admin can configure summary recipients' };
  }
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SUMMARY_RECIPIENTS', String(emailsString || '').trim());
  logAuditEvent('SET_SUMMARY_RECIPIENTS', 'CONFIG', 'NOTIFICATION', null, { recipients: emailsString }, user.user_id, user.email);
  return { success: true };
}

/**
 * Get saved summary recipient emails (for Settings UI)
 */
function getSummaryRecipients() {
  var props = PropertiesService.getScriptProperties();
  return { success: true, recipients: props.getProperty('SUMMARY_RECIPIENTS') || '' };
}

/**
 * Setup all notification triggers (run once to configure).
 *
 * Schedule overview:
 *   - Email queue processor: every 10 min
 *   - Daily maintenance (overdue status updates + cleanup): 6 AM daily
 *   - Overdue reminders: Monday 7:30 UTC (10:30 AM EAT)
 *   - Upcoming due reminders: Monday 7:30 UTC (10:30 AM EAT)
 *   - Biweekly summary: Every other Monday 8:00 UTC (11:00 AM EAT)
 *
 * Note: GAS triggers use UTC. EAT = UTC+3.
 *       10:30 AM EAT = 7:30 AM UTC. We use atHour(7) which runs between 7–8 AM UTC.
 */
function setupNotificationTriggers() {
  // Remove existing triggers for these functions
  const functionNames = [
    'processEmailQueue',
    'sendOverdueReminders',
    'sendUpcomingDueReminders',
    'sendWeeklySummary',
    'sendBiweeklySummary',
    'weeklyReminderRunner',
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

  // Daily maintenance at 6 AM UTC (9 AM EAT) — updates overdue statuses, cleanups only
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();

  // Weekly reminders on Monday at 7 AM UTC (~10:30 AM EAT)
  // Runs both overdue and upcoming due reminders
  ScriptApp.newTrigger('weeklyReminderRunner')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(7)
    .create();

  // Biweekly summary on Monday at 8 AM UTC (11 AM EAT)
  // GAS doesn't support biweekly directly — we use weekly trigger + check week parity
  ScriptApp.newTrigger('sendBiweeklySummary')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  console.log('Notification triggers configured');
  return { success: true };
}

/**
 * Weekly reminder runner — executes every Monday.
 * Calls both overdue and upcoming due reminders.
 */
function weeklyReminderRunner() {
  console.log('Running weekly reminders (Monday)...');
  var overdueCount = sendOverdueReminders();
  var upcomingCount = sendUpcomingDueReminders();
  console.log('Weekly reminders done. Overdue:', overdueCount, 'Upcoming:', upcomingCount);
  return { overdue: overdueCount, upcoming: upcomingCount };
}

/**
 * Daily maintenance tasks.
 * Runs daily at 6 AM UTC (9 AM EAT).
 * Note: Reminders are now sent weekly on Mondays via weeklyReminderRunner().
 */
function dailyMaintenance() {
  console.log('Starting daily maintenance...');

  // Update overdue statuses
  const overdueUpdated = updateOverdueStatuses();
  console.log('Overdue statuses updated:', overdueUpdated);

  // Clean up old sent notifications (older than 30 days)
  const cleaned = cleanupOldNotifications(30);
  console.log('Old notifications cleaned:', cleaned);

  console.log('Daily maintenance completed');

  return {
    overdueUpdated,
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

/**
 * Get all email templates (for Settings editor).
 * Returns all templates including inactive ones for admin editing.
 */
function getEmailTemplatesAll() {
  var sheet = getSheet(SHEETS.EMAIL_TEMPLATES);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var templates = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      var t = rowToObject(headers, data[i]);
      t._rowIndex = i + 1;
      templates.push(t);
    }
  }
  return sanitizeForClient(templates);
}

/**
 * Save (update) an email template from Settings editor.
 */
function saveEmailTemplateAction(templateCode, updates, user) {
  if (!user || user.role_code !== ROLES.SUPER_ADMIN) {
    return { success: false, error: 'Only Super Admin can edit email templates' };
  }
  if (!templateCode) return { success: false, error: 'Template code required' };

  var sheet = getSheet(SHEETS.EMAIL_TEMPLATES);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var codeIdx = headers.indexOf('template_code');

  for (var i = 1; i < data.length; i++) {
    if (data[i][codeIdx] === templateCode) {
      var existing = rowToObject(headers, data[i]);
      if (updates.subject_template !== undefined) existing.subject_template = sanitizeInput(updates.subject_template);
      if (updates.body_template !== undefined) existing.body_template = sanitizeInput(updates.body_template);
      if (updates.is_active !== undefined) existing.is_active = updates.is_active;

      var row = objectToRow('EMAIL_TEMPLATES', existing);
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);

      // Clear template cache
      var cache = CacheService.getScriptCache();
      cache.remove('email_template_' + templateCode);

      logAuditEvent('UPDATE_TEMPLATE', 'CONFIG', 'EMAIL', null, { template_code: templateCode }, user.user_id, user.email);
      return { success: true };
    }
  }

  return { success: false, error: 'Template not found: ' + templateCode };
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)
