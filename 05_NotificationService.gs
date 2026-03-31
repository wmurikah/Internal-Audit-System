// 05_NotificationService.gs - Email Queue, Templates, Reminders, Alerts

/**
 * Get a fresh access token from Microsoft using the stored refresh token.
 * Uses OAuth2 client credentials + refresh token flow.
 * Caches the access token for 50 minutes (tokens expire in 60 min).
 */
function getOutlookAccessToken() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('outlook_access_token');
  if (cached) return cached;

  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('OUTLOOK_CLIENT_ID');
  var clientSecret = props.getProperty('OUTLOOK_CLIENT_SECRET');
  var refreshToken = props.getProperty('OUTLOOK_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  var tokenUrl = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
  var payload = 'client_id=' + encodeURIComponent(clientId) +
    '&scope=' + encodeURIComponent('offline_access Mail.Send') +
    '&refresh_token=' + encodeURIComponent(refreshToken) +
    '&grant_type=refresh_token' +
    '&client_secret=' + encodeURIComponent(clientSecret);

  var options = {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: payload,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(tokenUrl, options);
    var code = response.getResponseCode();
    var result = JSON.parse(response.getContentText());

    if (code === 200 && result.access_token) {
      // Cache for 50 minutes (token valid for 60 min)
      cache.put('outlook_access_token', result.access_token, 3000);

      // If Microsoft returned a new refresh token, store it
      if (result.refresh_token) {
        props.setProperty('OUTLOOK_REFRESH_TOKEN', result.refresh_token);
      }

      return result.access_token;
    } else {
      console.error('Outlook token refresh failed (HTTP ' + code + '):', JSON.stringify(result));
      return null;
    }
  } catch (e) {
    console.error('Outlook token refresh error:', e.message);
    return null;
  }
}

/**
 * Send email via Microsoft Graph API (sends directly from hassaudit@outlook.com).
 * Uses OAuth2 access token obtained from refresh token flow.
 * Falls back to MailApp if Outlook is not configured.
 */
function sendEmailViaOutlook(recipientEmail, subject, htmlBody, ccEmails) {
  var accessToken = getOutlookAccessToken();

  if (!accessToken) {
    console.log('Outlook not configured, falling back to MailApp');
    return { success: false, fallback: true };
  }

  var toRecipients = [{ emailAddress: { address: recipientEmail } }];

  var message = {
    subject: subject,
    body: {
      contentType: 'HTML',
      content: htmlBody
    },
    toRecipients: toRecipients
  };

  if (ccEmails) {
    var ccList = String(ccEmails).split(',').map(function(e) {
      return { emailAddress: { address: e.trim() } };
    }).filter(function(e) { return e.emailAddress.address; });
    if (ccList.length > 0) {
      message.ccRecipients = ccList;
    }
  }

  var payload = {
    message: message,
    saveToSentItems: true
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch('https://graph.microsoft.com/v1.0/me/sendMail', options);
    var code = response.getResponseCode();

    if (code === 202) {
      return { success: true, via: 'outlook' };
    } else {
      var errorText = response.getContentText();
      console.error('Graph API error (HTTP ' + code + '):', errorText);
      return { success: false, error: 'Outlook send failed (HTTP ' + code + ')' };
    }
  } catch (e) {
    console.error('Graph API fetch error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Unified email sending function.
 * Primary: Microsoft Graph API (sends from hassaudit@outlook.com).
 * Fallback: Google Apps Script MailApp.
 */
function sendEmail(recipientEmail, subject, body, htmlBody, ccEmails, fromName, replyTo) {
  // Try Outlook (Microsoft Graph API) first
  var outlookResult = sendEmailViaOutlook(recipientEmail, subject, htmlBody, ccEmails);
  if (outlookResult.success) { return outlookResult; }
  if (!outlookResult.fallback) { return outlookResult; }

  // Fallback: Send via MailApp (sends from the Google account)
  var emailOptions = {
    to: recipientEmail,
    subject: subject,
    body: body,
    name: fromName || 'Hass Audit',
    replyTo: replyTo || 'hassaudit@outlook.com',
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
    
    // Write to Firestore
    syncToFirestore(SHEETS.NOTIFICATION_QUEUE, notificationId, notification);
    invalidateSheetData(SHEETS.NOTIFICATION_QUEUE);
    
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
    // Fall back to contextual notification based on template code and variables
    var fallbackSubject = 'Audit System Notification';
    var fallbackBody = 'You have a new notification in the Internal Audit System.';

    if (variables) {
      var obsTitle = variables.observation_title || '';
      if (templateCode === 'WP_SUBMITTED' && obsTitle) {
        fallbackSubject = 'Work Paper Submitted for Review: ' + obsTitle;
        fallbackBody = 'Dear Colleague,\n\n' +
          (variables.submitter_name || 'A preparer') + ' has submitted a work paper for your review.\n\n' +
          'Observation: ' + obsTitle + '\n' +
          'Risk Rating: ' + (variables.risk_rating || '-') + '\n' +
          'Affiliate: ' + (variables.affiliate_name || variables.affiliate_code || '-') + '\n\n' +
          'Please log in to review.';
      } else if (templateCode === 'WP_STATUS_CHANGE' && obsTitle) {
        fallbackSubject = 'Work Paper ' + (variables.new_status || 'Updated') + ': ' + obsTitle;
        fallbackBody = 'Dear Colleague,\n\n' +
          'The status of work paper "' + obsTitle + '" has been changed from ' +
          (variables.previous_status || '-') + ' to ' + (variables.new_status || '-') +
          ' by ' + (variables.reviewer_name || 'a reviewer') + '.\n\n' +
          'Please log in to review.';
      } else if (templateCode === 'AP_IMPLEMENTED') {
        fallbackSubject = 'Action Plan Marked as Implemented: ' + (variables.action_description || '').substring(0, 50);
        fallbackBody = 'Dear Colleague,\n\n' +
          (variables.implementer_name || 'An auditee') + ' has marked an action plan as implemented and it is awaiting your verification.\n\n' +
          'Action Plan: ' + (variables.action_description || '-') + '\n\n' +
          'Please log in to verify.';
      } else if (obsTitle) {
        fallbackSubject = 'Audit Notification: ' + obsTitle;
      }
    }

    return queueEmail({
      template_code: templateCode,
      recipient_email: recipientEmail,
      recipient_user_id: recipientUserId,
      subject: fallbackSubject,
      body: fallbackBody,
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
      // Escape regex special characters in the placeholder to ensure literal match
      const escaped = placeholder.replace(/[{}.*+?^$|\\()[\]]/g, '\\$&');
      const value = variables[key] || '';
      subject = subject.replace(new RegExp(escaped, 'g'), value);
      body = body.replace(new RegExp(escaped, 'g'), value);
    });
  }

  // Remove any remaining unreplaced template variables (e.g. {{unknown_var}})
  subject = subject.replace(/\{\{[a-zA-Z_]+\}\}/g, '');
  body = body.replace(/\{\{[a-zA-Z_]+\}\}/g, '');
  
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
  
  var data = getSheetData(SHEETS.EMAIL_TEMPLATES);
  if (!data || data.length < 2) return null;
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
  var data = getSheetData(SHEETS.EMAIL_TEMPLATES);
  if (!data || data.length < 2) return [];
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
  var data = getSheetData(SHEETS.NOTIFICATION_QUEUE);
  if (!data || data.length < 2) { lock.releaseLock(); return { sent: 0, failed: 0, skipped: false }; }
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
    const templateCode = row[colMap['template_code']] || '';

    if (!recipientEmail || !subject) continue;

    const rowIndex = i + 1;
    const replyTo = 'hassaudit@outlook.com';

    // Determine CC: audit team CC on all notifications except welcome/password emails
    var privateTemplates = ['WELCOME', 'PASSWORD_RESET', 'RESET_PASSWORD', 'NEW_USER'];
    var ccString = '';
    if (privateTemplates.indexOf(templateCode) === -1) {
      ccString = buildAuditTeamCc(recipientEmail) || '';
    }

    try {
      // Send email via unified sender (Outlook Graph API with MailApp fallback)
      const htmlBody = formatEmailHtml(subject, body);
      const result = sendEmail(recipientEmail, subject, body, htmlBody, ccString, fromName, replyTo);
      if (!result.success) {
        throw new Error(result.error || 'Email send failed');
      }

      // Update status to Sent in Firestore
      var sentObj = rowToObject(headers, data[i]);
      sentObj.status = STATUS.NOTIFICATION.SENT;
      sentObj.sent_at = now;
      var notifId = sentObj.notification_id || row[colMap['notification_id']];
      syncToFirestore(SHEETS.NOTIFICATION_QUEUE, notifId, sentObj);

      sentCount++;

    } catch (e) {
      // Mark as failed in Firestore
      var failedObj = rowToObject(headers, data[i]);
      failedObj.status = STATUS.NOTIFICATION.FAILED;
      failedObj.error_message = e.message;
      var failNotifId = failedObj.notification_id || row[colMap['notification_id']];
      syncToFirestore(SHEETS.NOTIFICATION_QUEUE, failNotifId, failedObj);

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
 * Get the current web-app URL for embedding in emails.
 * Uses the deployed web-app URL (ends with /exec) so recipients
 * land on the login page, NOT a Google Drive file-open page.
 * Falls back to a config value if ScriptApp is unavailable (e.g. in triggers).
 */
function getSystemUrl() {
  // 1. Try the live deployed web-app URL
  try {
    var url = ScriptApp.getService().getUrl();
    if (url) return url;
  } catch (e) { /* ignore - may fail in certain trigger contexts */ }

  // 2. Fallback: read from script properties (set once via Settings or manually)
  try {
    var stored = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
    if (stored) return stored;
  } catch (e) { /* ignore */ }

  return '';
}

/**
 * Build a branded CTA button row for emails.
 * @param {string} url - The URL to link to
 * @param {string} [label] - Button text (default: "Click Here to Access the Audit System")
 */
function buildCtaButton(url, label) {
  if (!url) return '';
  label = label || 'Open Audit System';
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">' +
    '<tr><td align="center">' +
    '<a href="' + url + '" style="display:inline-block; background-color:#007AFF; color:#ffffff; padding:12px 32px; ' +
    'text-decoration:none; border-radius:16px; font-weight:600; font-size:15px; height:44px; line-height:20px; ' +
    'font-family:system-ui,-apple-system,sans-serif;">' +
    label + '</a>' +
    '</td></tr></table>';
}

/**
 * Strip raw URLs from text so they don't show alongside the CTA button.
 * Returns the cleaned text.
 */
function stripUrls(text) {
  if (!text) return '';
  return text.replace(/(https?:\/\/[^\s<]+)/g, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * Convert plain URLs in text to styled button links (hides ugly raw URLs)
 */
function linkifyUrls(text) {
  if (!text) return '';
  return text.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="display:inline-block; background-color:#007AFF; color:#ffffff; padding:12px 32px; text-decoration:none; border-radius:16px; font-weight:600; font-size:14px; margin:8px 0; font-family:system-ui,-apple-system,sans-serif;">Open Audit System</a>'
  );
}

/**
 * Format email body as clean branded HTML
 * Apple-minimalist responsive design
 */
function formatEmailHtml(subject, body) {
  var year = new Date().getFullYear();

  // Strip raw URLs from body text
  var cleanBody = stripUrls(body);

  // Detect category tag from subject
  var categoryLabel = 'Notification';
  if (/Submitted/i.test(subject)) categoryLabel = 'Response Received';
  else if (/Accepted/i.test(subject)) categoryLabel = 'Response Accepted';
  else if (/Rejected|Revision/i.test(subject)) categoryLabel = 'Review Feedback';
  else if (/Delegat/i.test(subject)) categoryLabel = 'Assignment Update';
  else if (/Overdue/i.test(subject)) categoryLabel = 'Status Update';
  else if (/Evidence/i.test(subject)) categoryLabel = 'Follow-Up';
  else if (/Not Yet Sent/i.test(subject)) categoryLabel = 'Follow-Up';
  else if (/Verification|Verify/i.test(subject)) categoryLabel = 'Review Requested';
  else if (/Approved/i.test(subject)) categoryLabel = 'Status Update';
  else if (/Summary/i.test(subject)) categoryLabel = 'Periodic Summary';

  // Extract "Dear X," greeting if present
  var greetingHtml = '';
  var bodyForCard = cleanBody;
  var dearMatch = cleanBody.match(/^Dear\s+([^,]+),/);
  if (dearMatch) {
    greetingHtml = '<p style="margin:0 0 16px 0; color:#424245; font-size:15px; line-height:1.6; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">Dear ' + dearMatch[1] + ',</p>';
    bodyForCard = cleanBody.replace(/^Dear\s+[^,]+,\s*\n?/, '');
  }

  var htmlBody = bodyForCard.replace(/\n/g, '<br>');

  // Always append a branded CTA button
  var systemUrl = getSystemUrl();
  var ctaHtml = buildCtaButton(systemUrl);

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="utf-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->' +
'  <style>' +
'    @media only screen and (max-width: 620px) {' +
'      .email-outer { padding: 0 !important; }' +
'      .email-inner { width: 100% !important; min-width: 100% !important; border-radius: 0 !important; }' +
'      .email-content { padding: 24px 20px !important; }' +
'      .email-header { padding: 20px 20px !important; }' +
'      .email-footer-inner { padding: 16px 20px !important; }' +
'    }' +
'  </style>' +
'</head>' +
'<body style="margin:0; padding:0; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif; background-color:#f5f5f7; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">' +
'  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">' +
'    ' + subject + ' &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' +
'  </div>' +
'  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;" class="email-outer">' +
'    <tr><td align="center" style="padding:40px 16px;">' +
'      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); border-top:4px solid #c9a83e;" class="email-inner">' +
'        <!-- HEADER -->' +
'        <tr>' +
'          <td style="padding:28px 36px 0 36px; border-bottom:none;" class="email-header">' +
'            <p style="margin:0 0 2px 0; color:#86868b; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">HASS PETROLEUM</p>' +
'            <p style="margin:0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">Internal Audit</p>' +
'          </td>' +
'        </tr>' +
'        <!-- SEPARATOR -->' +
'        <tr><td style="padding:16px 36px 0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td></tr>' +
'        <!-- CATEGORY TAG -->' +
'        <tr>' +
'          <td style="padding:20px 36px 0 36px;">' +
'            <div style="border-left:3px solid #2563eb; padding-left:12px; color:#2563eb; font-weight:600; font-size:12px; letter-spacing:1px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + categoryLabel + '</div>' +
'          </td>' +
'        </tr>' +
'        <!-- SUBJECT -->' +
'        <tr>' +
'          <td style="padding:16px 36px 0 36px;" class="email-content">' +
'            <p style="margin:0 0 20px 0; color:#1a202c; font-size:24px; font-weight:700; line-height:1.3; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + subject + '</p>' +
'          </td>' +
'        </tr>' +
'        <!-- MAIN CONTENT -->' +
'        <tr>' +
'          <td style="padding:0 36px 36px 36px;" class="email-content">' +
             greetingHtml +
'            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:20px; margin:0 0 16px 0;">' +
'              <div style="color:#424245; line-height:1.6; font-size:14px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + htmlBody + '</div>' +
'            </div>' +
             ctaHtml +
'          </td>' +
'        </tr>' +
'        <!-- FOOTER -->' +
'        <tr>' +
'          <td style="padding:0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td>' +
'        </tr>' +
'        <tr>' +
'          <td style="padding:16px 36px;" class="email-footer-inner">' +
'            <p style="margin:0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif; text-align:center; line-height:1.5;">' +
'              &copy; ' + year + ' Hass Petroleum &middot; Internal Audit</p>' +
'          </td>' +
'        </tr>' +
'      </table>' +
'    </td></tr>' +
'  </table>' +
'</body>' +
'</html>';
}

/**
 * Format email with a professional data table
 * Apple-minimalist responsive design
 * @param {string} subject - Email subject
 * @param {string} intro - Intro paragraph text
 * @param {string[]} headers - Table column headers
 * @param {string[][]} rows - Table data rows
 * @param {string} [outro] - Optional closing paragraph
 */
function formatTableEmailHtml(subject, intro, headers, rows, outro) {
  var year = new Date().getFullYear();

  // Detect category tag from subject
  var categoryLabel = 'Notification';
  if (/Submitted/i.test(subject)) categoryLabel = 'Response Received';
  else if (/Accepted/i.test(subject)) categoryLabel = 'Response Accepted';
  else if (/Rejected|Revision/i.test(subject)) categoryLabel = 'Review Feedback';
  else if (/Delegat/i.test(subject)) categoryLabel = 'Assignment Update';
  else if (/Overdue/i.test(subject)) categoryLabel = 'Status Update';
  else if (/Evidence/i.test(subject)) categoryLabel = 'Follow-Up';
  else if (/Not Yet Sent/i.test(subject)) categoryLabel = 'Follow-Up';
  else if (/Verification|Verify/i.test(subject)) categoryLabel = 'Review Requested';
  else if (/Approved/i.test(subject)) categoryLabel = 'Status Update';
  else if (/Summary/i.test(subject)) categoryLabel = 'Periodic Summary';

  // Build table header cells with navy background
  var thCells = headers.map(function(h) {
    return '<th style="padding:12px 14px; text-align:left; font-size:11px; font-weight:600; color:#ffffff; background-color:#1a365d; text-transform:uppercase; letter-spacing:0.5px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif; white-space:nowrap;">' + h + '</th>';
  }).join('');

  // Build table body rows with alternating backgrounds
  var trRows = rows.map(function(row, idx) {
    var bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    var cells = row.map(function(cell) {
      return '<td style="padding:11px 14px; font-size:14px; color:#1d1d1f; border-bottom:1px solid #e2e8f0; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif; line-height:1.5;">' + cell + '</td>';
    }).join('');
    return '<tr style="background-color:' + bg + ';">' + cells + '</tr>';
  }).join('');

  var outroClean = outro ? stripUrls(outro) : '';
  var outroHtml = outroClean ? '<div style="background:#eff6ff; border-left:3px solid #2563eb; border-radius:6px; padding:16px 20px; margin-top:24px;"><div style="color:#1e40af; line-height:1.6; font-size:14px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + outroClean.replace(/\n/g, '<br>') + '</div></div>' : '';

  // Always append CTA button linking to system
  var systemUrl = getSystemUrl();
  var ctaHtml = buildCtaButton(systemUrl);

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="utf-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->' +
'  <style>' +
'    @media only screen and (max-width: 620px) {' +
'      .email-outer { padding: 0 !important; }' +
'      .email-inner { width: 100% !important; min-width: 100% !important; border-radius: 0 !important; }' +
'      .email-content { padding: 20px 16px !important; }' +
'      .email-header { padding: 20px 16px !important; }' +
'      .email-footer-inner { padding: 20px 16px !important; }' +
'      .email-divider { margin: 0 16px !important; }' +
'      .email-table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch !important; }' +
'    }' +
'  </style>' +
'</head>' +
'<body style="margin:0; padding:0; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif; background-color:#f5f5f7; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">' +
'  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">' +
'    ' + subject + ' &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' +
'  </div>' +
'  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;" class="email-outer">' +
'    <tr><td align="center" style="padding:40px 16px;">' +
'      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); border-top:4px solid #c9a83e;" class="email-inner">' +
'        <!-- HEADER -->' +
'        <tr>' +
'          <td style="padding:28px 36px 0 36px; border-bottom:none;" class="email-header">' +
'            <p style="margin:0 0 2px 0; color:#86868b; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">HASS PETROLEUM</p>' +
'            <p style="margin:0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">Internal Audit</p>' +
'          </td>' +
'        </tr>' +
'        <!-- SEPARATOR -->' +
'        <tr><td style="padding:16px 36px 0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td></tr>' +
'        <!-- CATEGORY TAG -->' +
'        <tr>' +
'          <td style="padding:20px 36px 0 36px;">' +
'            <div style="border-left:3px solid #2563eb; padding-left:12px; color:#2563eb; font-weight:600; font-size:12px; letter-spacing:1px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + categoryLabel + '</div>' +
'          </td>' +
'        </tr>' +
'        <!-- SUBJECT -->' +
'        <tr>' +
'          <td style="padding:16px 36px 0 36px;" class="email-content">' +
'            <p style="margin:0 0 20px 0; color:#1a202c; font-size:24px; font-weight:700; line-height:1.3; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + subject + '</p>' +
'          </td>' +
'        </tr>' +
'        <!-- INTRO + TABLE -->' +
'        <tr>' +
'          <td style="padding:0 36px 36px 36px;" class="email-content">' +
'            <p style="color:#424245; line-height:1.6; font-size:14px; margin:0 0 20px 0; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif;">' + intro + '</p>' +
'            <div class="email-table-wrap" style="border-radius:10px; overflow:hidden; border:1px solid #e2e8f0;">' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; min-width:100%;">' +
'              <thead><tr>' + thCells + '</tr></thead>' +
'              <tbody>' + trRows + '</tbody>' +
'            </table>' +
'            </div>' +
'            ' + outroHtml +
             ctaHtml +
'          </td>' +
'        </tr>' +
'        <!-- FOOTER -->' +
'        <tr>' +
'          <td style="padding:0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td>' +
'        </tr>' +
'        <tr>' +
'          <td style="padding:16px 36px;" class="email-footer-inner">' +
'            <p style="margin:0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,Arial,Helvetica,sans-serif; text-align:center; line-height:1.5;">' +
'              &copy; ' + year + ' Hass Petroleum &middot; Internal Audit</p>' +
'          </td>' +
'        </tr>' +
'      </table>' +
'    </td></tr>' +
'  </table>' +
'</body>' +
'</html>';
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
  if (!rating) return '<span style="color:#9ca3af; font-family:system-ui,-apple-system,sans-serif;">-</span>';
  var r = String(rating).charAt(0).toUpperCase() + String(rating).slice(1).toLowerCase();
  var bg = '#6b7280'; var color = '#ffffff';
  if (r === 'Extreme' || r === 'Critical') { bg = '#991b1b'; }
  else if (r === 'High') { bg = '#dc2626'; }
  else if (r === 'Medium') { bg = '#d97706'; color = '#ffffff'; }
  else if (r === 'Low') { bg = '#059669'; }
  return '<span style="display:inline-block; background-color:' + bg + '; color:' + color + '; padding:3px 10px; border-radius:4px; font-size:10px; font-weight:600; letter-spacing:0.3px; font-family:system-ui,-apple-system,sans-serif; white-space:nowrap;">' + r + '</span>';
}

/**
 * Retry failed emails
 */
function retryFailedEmails() {
  var data = getSheetData(SHEETS.NOTIFICATION_QUEUE);
  if (!data || data.length < 2) return 0;
  const headers = data[0];

  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);

  let resetCount = 0;

  for (let i = 1; i < data.length; i++) {
    const status = data[i][colMap['status']];

    if (status === STATUS.NOTIFICATION.FAILED) {
      // Reset to pending in Firestore
      var updatedObj = rowToObject(headers, data[i]);
      updatedObj.status = STATUS.NOTIFICATION.PENDING;
      updatedObj.error_message = '';
      var notifId = updatedObj.notification_id || data[i][colMap['notification_id']];
      syncToFirestore(SHEETS.NOTIFICATION_QUEUE, notifId, updatedObj);
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
 * Build HTML for grouped observations with nested action plan tables.
 * Each observation becomes a shaded header row with risk badge,
 * followed by AP rows showing description and due date.
 * @param {Object[]} workPapers - Array of work paper objects
 * @param {Object} actionPlansByWp - Map of work_paper_id → array of action plan objects
 * @returns {string} HTML string for the grouped table
 */
function buildGroupedObservationApHtml(workPapers, actionPlansByWp) {
  var html = '';

  workPapers.forEach(function(wp) {
    var wpId = wp.work_paper_id || '';
    var obsTitle = wp.observation_title || wp.work_paper_id || 'Observation';
    var riskRating = wp.risk_rating || '';

    // Observation header row (full-width, shaded)
    html += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:4px; margin-top:16px;">' +
      '<tr><td style="background-color:#f1f5f9; padding:12px 16px; border-radius:8px 8px 0 0; border:1px solid #e2e8f0; border-bottom:none;">' +
      '<span style="font-size:14px; font-weight:600; color:#1d1d1f; font-family:system-ui,-apple-system,sans-serif;">' +
      ratingBadge(riskRating) + '&nbsp;&nbsp;' + obsTitle +
      '</span></td></tr></table>';

    // Action plan rows under this observation
    var aps = actionPlansByWp[wpId] || [];
    if (aps.length > 0) {
      html += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0; border-radius:0 0 8px 8px; border-collapse:collapse; margin-bottom:12px;">';
      // AP table header
      html += '<thead><tr>' +
        '<th style="padding:8px 14px; text-align:left; font-size:11px; font-weight:600; color:#86868b; border-bottom:1px solid #e5e5e5; font-family:system-ui,-apple-system,sans-serif; width:40px;">#</th>' +
        '<th style="padding:8px 14px; text-align:left; font-size:11px; font-weight:600; color:#86868b; border-bottom:1px solid #e5e5e5; font-family:system-ui,-apple-system,sans-serif;">Action Plan</th>' +
        '<th style="padding:8px 14px; text-align:left; font-size:11px; font-weight:600; color:#86868b; border-bottom:1px solid #e5e5e5; font-family:system-ui,-apple-system,sans-serif; width:120px;">Due Date</th>' +
        '</tr></thead><tbody>';
      aps.forEach(function(ap, idx) {
        var bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        var dueStr = ap.due_date
          ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : '-';
        html += '<tr style="background-color:' + bg + ';">' +
          '<td style="padding:8px 14px; font-size:13px; color:#6b7280; border-bottom:1px solid #f0f0f0; font-family:system-ui,-apple-system,sans-serif;">' + (idx + 1) + '</td>' +
          '<td style="padding:8px 14px; font-size:13px; color:#1d1d1f; border-bottom:1px solid #f0f0f0; font-family:system-ui,-apple-system,sans-serif; line-height:1.5;">' + (ap.action_description || '-') + '</td>' +
          '<td style="padding:8px 14px; font-size:13px; color:#1d1d1f; border-bottom:1px solid #f0f0f0; font-family:system-ui,-apple-system,sans-serif; white-space:nowrap;">' + dueStr + '</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    } else {
      // No APs yet for this observation
      html += '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0; border-radius:0 0 8px 8px; margin-bottom:12px;">' +
        '<tr><td style="padding:10px 16px; font-size:13px; color:#9ca3af; font-style:italic; font-family:system-ui,-apple-system,sans-serif;">Action plans will be created upon review.</td></tr></table>';
    }
  });

  return html;
}

/**
 * Build a callout box for emails (info or warning variant).
 * @param {string} text - Callout text (HTML allowed)
 * @param {string} [variant] - 'info' (blue) or 'warning' (amber). Default: 'info'
 * @returns {string} HTML for the callout box
 */
function buildCalloutBox(text, variant) {
  var bg, border, color;
  if (variant === 'warning') {
    bg = '#fffbeb'; border = '#fde68a'; color = '#92400e';
  } else {
    bg = '#eff6ff'; border = '#bfdbfe'; color = '#1e40af';
  }
  return '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">' +
    '<tr><td style="background-color:' + bg + '; border:1px solid ' + border + '; border-radius:8px; padding:14px 18px;">' +
    '<p style="margin:0; color:' + color + '; font-size:13px; line-height:1.6; font-family:system-ui,-apple-system,sans-serif;">' + text + '</p>' +
    '</td></tr></table>';
}

/**
 * Send batched auditee notification with professional grouped table.
 * Called when work papers are sent to auditees — groups by auditee and sends ONE email per person.
 *
 * Email format:
 *   Audit Observations Assigned
 *   Dear [First Name],
 *   [Context line]
 *   [Grouped table: Observation headers with risk badge → AP rows underneath with due dates]
 *   [Callout: evidence requirements + upcoming reminders]
 *   CTA: View in Audit System
 *
 * @param {Object[]} workPapers - Array of work paper objects sent to this auditee
 * @param {string} auditeeEmail - Recipient email
 * @param {string} auditeeUserId - Recipient user ID
 * @param {string} auditeeName - Recipient full name
 * @param {string} auditeeFirstName - Recipient first name for greeting
 * @param {string} [ccEmails] - Optional comma-separated CC emails from work paper cc_recipients
 * @param {Object} [actionPlansByWp] - Optional map of work_paper_id → action plan array. If not provided, will be fetched.
 */
function sendBatchedAuditeeNotification(workPapers, auditeeEmail, auditeeUserId, auditeeName, auditeeFirstName, ccEmails, actionPlansByWp) {
  if (!workPapers || workPapers.length === 0 || !auditeeEmail) return;

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
    contextLine = 'The following audit observation' + (workPapers.length > 1 ? 's have' : ' has') +
      ' been reviewed and approved.';
  }

  // Use first name only for greeting
  var firstName = auditeeFirstName || (auditeeName || '').split(' ')[0] || 'Auditee';

  // Fetch action plans per WP if not provided
  if (!actionPlansByWp) {
    actionPlansByWp = {};
    workPapers.forEach(function(wp) {
      var wpId = wp.work_paper_id;
      if (wpId && !actionPlansByWp[wpId]) {
        try {
          actionPlansByWp[wpId] = getActionPlansByWorkPaperRaw(wpId);
        } catch (e) {
          console.error('Failed to fetch APs for WP', wpId, ':', e.message);
          actionPlansByWp[wpId] = [];
        }
      }
    });
  }

  var subjectSuffix = ctx.auditAreaName ? ' \u2013 ' + ctx.auditAreaName : '';
  var subject = 'Audit Observations Assigned' + subjectSuffix;

  // Build email body with grouped observation/AP layout
  var year = new Date().getFullYear();
  var systemUrl = getSystemUrl();

  var introHtml = '<p style="margin:0 0 6px 0; color:#86868b; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; font-family:system-ui,-apple-system,sans-serif;">Audit Observations Assigned</p>' +
    '<p style="margin:0 0 16px 0; color:#1d1d1f; font-size:20px; font-weight:600; line-height:1.3; font-family:system-ui,-apple-system,sans-serif;">New Audit Observations, ' + firstName + '</p>' +
    '<p style="margin:0 0 20px 0; color:#424245; font-size:14px; line-height:1.6; font-family:system-ui,-apple-system,sans-serif;">' +
    'Dear ' + (auditeeName || firstName) + ',<br><br>' +
    'The following audit observations and action plans have been assigned to you. Please log in to review, provide your management response, and upload supporting evidence before the due dates.</p>' +
    (contextLine ? '<p style="margin:0 0 8px 0; color:#424245; font-size:14px; line-height:1.6; font-family:system-ui,-apple-system,sans-serif;">' + contextLine + '</p>' : '');

  // Grouped observations + APs
  var groupedTableHtml = buildGroupedObservationApHtml(workPapers, actionPlansByWp);

  // Callout box about evidence and reminders
  var calloutHtml = buildCalloutBox(
    'You will receive periodic reminders as due dates approach. Supporting documentation should be uploaded when marking action plans as implemented.',
    'info'
  );

  // CTA button
  var ctaHtml = buildCtaButton(systemUrl, 'View in Audit System');

  // Footer
  var footerHtml = '<p style="margin:0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,sans-serif; text-align:center; line-height:1.5;">' +
    '&copy; ' + year + ' Hass Petroleum &middot; Internal Audit</p>';

  // Assemble full email HTML
  var htmlBody = '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="utf-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->' +
'  <style>' +
'    @media only screen and (max-width: 620px) {' +
'      .email-outer { padding: 0 !important; }' +
'      .email-inner { width: 100% !important; min-width: 100% !important; border-radius: 0 !important; }' +
'      .email-content { padding: 20px 16px !important; }' +
'      .email-header { padding: 20px 16px !important; }' +
'      .email-footer-inner { padding: 20px 16px !important; }' +
'    }' +
'  </style>' +
'</head>' +
'<body style="margin:0; padding:0; font-family:system-ui,-apple-system,\'SF Pro Display\',\'Helvetica Neue\',Arial,sans-serif; background-color:#f5f5f7; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">' +
'  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">' +
'    ' + subject + ' &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' +
'  </div>' +
'  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;" class="email-outer">' +
'    <tr><td align="center" style="padding:40px 16px;">' +
'      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:680px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);" class="email-inner">' +
'        <!-- HEADER -->' +
'        <tr>' +
'          <td style="padding:28px 36px 0 36px; border-bottom:none;" class="email-header">' +
'            <p style="margin:0 0 2px 0; color:#86868b; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; font-family:system-ui,-apple-system,sans-serif;">HASS PETROLEUM</p>' +
'            <p style="margin:0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,sans-serif;">Internal Audit</p>' +
'          </td>' +
'        </tr>' +
'        <tr><td style="padding:16px 36px 0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td></tr>' +
'        <!-- CONTENT -->' +
'        <tr>' +
'          <td style="padding:24px 36px 36px 36px;" class="email-content">' +
             introHtml +
             groupedTableHtml +
             calloutHtml +
             ctaHtml +
'          </td>' +
'        </tr>' +
'        <!-- FOOTER -->' +
'        <tr><td style="padding:0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td></tr>' +
'        <tr><td style="padding:16px 36px;" class="email-footer-inner">' + footerHtml + '</td></tr>' +
'      </table>' +
'    </td></tr>' +
'  </table>' +
'</body>' +
'</html>';

  // CC audit team + existing CC recipients (deduplicated)
  var auditTeamCc = buildAuditTeamCc(auditeeEmail, ccEmails);
  sendEmail(auditeeEmail, subject, subject, htmlBody, auditTeamCc, 'Hass Audit', 'hassaudit@outlook.com');
}

function sendBatchedResponseNotification(responses, auditorEmail, auditorName) {
  if (!responses || responses.length === 0 || !auditorEmail) return;

  var firstName = (auditorName || '').split(' ')[0] || 'Auditor';
  var subject = responses.length + ' Auditee Response(s) Received for Review';

  var intro = 'Dear ' + firstName + ',<br><br>' +
    '<strong>' + responses.length + '</strong> auditee response(s) have been submitted and require your review:';

  var headers = ['Observation', 'Response Summary', 'Action Plans', 'Status'];
  var rows = responses.map(function(r) {
    return [
      String(r.observation_title || r.work_paper_id || '-'),
      truncateWords(r.management_response || '', 15),
      String(r.action_plan_count || 0) + ' plan(s)',
      'Submitted'
    ];
  });

  var systemUrl = getSystemUrl();
  var loginLink = systemUrl
    ? '<a href="' + systemUrl + '" style="color:#007AFF; text-decoration:underline; font-weight:600;">log in</a>'
    : 'log in';
  var outro = '<p style="color:#86868b; font-size:13px; text-align:center; font-family:system-ui,-apple-system,sans-serif;">Please ' + loginLink + ' to review and accept or reject each response.</p>';

  var htmlBody = formatTableEmailHtml(subject, intro, headers, rows, outro);
  var ccString = buildAuditTeamCc(auditorEmail);
  sendEmail(auditorEmail, subject, subject, htmlBody, ccString, 'Hass Audit', 'hassaudit@outlook.com');
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
    if (!owner || !owner.email || !isActive(owner.is_active)) return;

    const plans = byOwner[ownerId];
    const subject = 'Status Update: ' + plans.length + ' Action Plan(s) Past Target Date';
    const ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';
    const intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      'You have <strong>' + plans.length + '</strong> overdue action plan(s) that have passed their target completion date. Please review and provide an updated status or revised timeline:';

    const rows = plans.map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysOver = ap.days_overdue ? '<span style="color:#92400e; font-weight:500;">' + ap.days_overdue + '</span>' : '-';
      return [
        String(ap._observation_title || ap.action_plan_id || '-').substring(0, 50),
        truncateWords(ap.action_description || '', 8),
        ratingBadge(ap._risk_rating),
        dueStr,
        daysOver
      ];
    });

    const loginLink = loginUrl
      ? 'Please <a href="' + loginUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> and review these items and provide an update.'
      : 'Please log in and review these items and provide an update.';
    const outro = loginLink;
    const htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);
    // CC audit team on overdue reminders
    var overdueCc = buildAuditTeamCc(owner.email);
    sendEmail(owner.email, subject, subject, htmlBody, overdueCc, 'Hass Audit', 'hassaudit@outlook.com');
    notificationCount++;
  });

  // Auditor summary with full table
  const auditors = getUsersDropdown().filter(function(u) {
    return [ROLES.SENIOR_AUDITOR, ROLES.SUPER_ADMIN].includes(u.roleCode);
  });

  if (actionPlans.length > 0 && auditors.length > 0) {
    const summarySubject = 'Weekly Status Summary: ' + actionPlans.length + ' Action Plan(s) Past Target Date';
    const summaryIntro = 'The following action plans are currently overdue across all owners:';
    const summaryRows = actionPlans.slice(0, 50).map(function(ap) {
      var dueStr = ap.due_date ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
      var daysOver = ap.days_overdue ? '<span style="color:#92400e; font-weight:500;">' + ap.days_overdue + '</span>' : '-';
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
      sendEmail(auditor.email, summarySubject, summarySubject, summaryHtml, null, 'Hass Audit', 'hassaudit@outlook.com');
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
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) { console.log('No action plan data'); return 0; }
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
    if (!owner || !owner.email || !isActive(owner.is_active)) return;

    var plans = byOwner[ownerId];
    var subject = 'Upcoming Due Dates: ' + plans.length + ' Action Plan(s) Due Within Two Weeks';
    var ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';
    var intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      'You have <strong>' + plans.length + '</strong> action plan(s) are approaching their target completion dates within the next two weeks:';

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

    var loginLink = loginUrl
      ? 'Please <a href="' + loginUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to ensure these items are completed before their due dates.'
      : 'Please ensure these items are completed before their due dates.';
    var outro = loginLink;
    var htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);
    var upcomingCc = buildAuditTeamCc(owner.email);
    sendEmail(owner.email, subject, subject, htmlBody, upcomingCc, 'Hass Audit', 'hassaudit@outlook.com');
    notificationCount++;
  });

  console.log('Queued upcoming due reminders:', notificationCount);
  return notificationCount;
}

/**
 * Send evidence upload reminders for action plans approaching their due date.
 * Sends ONLY if the AP has zero evidence files uploaded.
 * Triggers on exact days: day -7 (7 days before due) and day 0 (due date).
 * Groups all qualifying APs per owner into ONE email.
 * NO CC on pre-due reminders (owner only).
 *
 * Called by daily trigger (dailyMaintenance or dailyReminderRunner).
 */
function sendEvidenceReminders() {
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) { console.log('sendEvidenceReminders: No action plan data'); return 0; }
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var systemUrl = getSystemUrl();

  // Collect APs due in exactly 7 days or exactly 0 days with no evidence
  var qualifying = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[colMap['status']];
    var dueDate = row[colMap['due_date']];

    if (!dueDate) continue;
    // Only target active APs that are not yet implemented/closed
    if (isImplementedOrVerified(status)) continue;
    // Specifically target 'Not Implemented', 'Pending', 'In Progress', 'Not Due', 'Overdue' statuses
    // Skip 'Implemented', 'Verified', 'Closed', 'Rejected'

    var due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    var daysUntilDue = Math.round((due - today) / (1000 * 60 * 60 * 24));

    // Only trigger on exact day -7 or day 0
    if (daysUntilDue !== 7 && daysUntilDue !== 0) continue;

    var ap = rowToObject(headers, data[i]);
    ap._daysUntilDue = daysUntilDue;
    ap._reminderType = daysUntilDue === 7 ? 'day_minus_7' : 'day_0';

    // Check evidence count for this AP
    var hasEvidence = false;
    try {
      var evidenceRecords = firestoreQuery(SHEETS.AP_EVIDENCE, 'action_plan_id', 'EQUAL', ap.action_plan_id);
      if (evidenceRecords && evidenceRecords.length > 0) {
        // Count only records with actual drive_file_id (not orphaned metadata)
        var realEvidence = evidenceRecords.filter(function(ev) { return ev.drive_file_id; });

        // For small batches, verify Drive file accessibility
        if (realEvidence.length > 0 && realEvidence.length <= 5) {
          realEvidence = realEvidence.filter(function(ev) {
            try { DriveApp.getFileById(ev.drive_file_id); return true; } catch (e) { return false; }
          });
        }

        hasEvidence = realEvidence.length > 0;
      }
    } catch (e) {
      console.error('sendEvidenceReminders: Evidence check failed for', ap.action_plan_id, ':', e.message);
    }

    if (hasEvidence) continue; // Skip — evidence already uploaded

    // Enrich with parent work paper data
    if (ap.work_paper_id) {
      var wp = getWorkPaperById(ap.work_paper_id);
      ap._observation_title = wp ? wp.observation_title : '';
      ap._risk_rating = ap.risk_rating || (wp ? wp.risk_rating : '');
    }

    qualifying.push(ap);
  }

  if (qualifying.length === 0) {
    console.log('sendEvidenceReminders: No APs need evidence reminders today');
    return 0;
  }

  // Group by owner
  var byOwner = {};
  qualifying.forEach(function(ap) {
    var ownerIds = String(ap.owner_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    ownerIds.forEach(function(ownerId) {
      if (!byOwner[ownerId]) byOwner[ownerId] = [];
      byOwner[ownerId].push(ap);
    });
  });

  var notificationCount = 0;

  Object.keys(byOwner).forEach(function(ownerId) {
    var owner = getUserById(ownerId);
    if (!owner || !owner.email || !isActive(owner.is_active)) return;

    var plans = byOwner[ownerId];
    var ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';

    // Determine subject based on whether any are due today
    var hasDueToday = plans.some(function(ap) { return ap._reminderType === 'day_0'; });
    var primaryObsTitle = (plans[0] && plans[0]._observation_title) || 'Action Plan';
    var subject = hasDueToday
      ? 'Reminder: Supporting Documentation Due \u2014 ' + primaryObsTitle
      : 'Upcoming: Supporting Documentation Reminder \u2014 ' + primaryObsTitle + ' \u2014 Due by ' + new Date(plans[0].due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    // Group APs by observation for the email
    var byObservation = {};
    plans.forEach(function(ap) {
      var obsKey = ap._observation_title || ap.work_paper_id || 'Other';
      if (!byObservation[obsKey]) byObservation[obsKey] = { risk: ap._risk_rating, aps: [] };
      byObservation[obsKey].aps.push(ap);
    });

    // Build intro
    var intro = 'Dear ' + ownerFirstName + ',<br><br>' +
      'The following action plans are ' + (hasDueToday ? '<strong>due today</strong>' : 'due soon') +
      '. Supporting documentation has not yet been uploaded for these items:';

    // Build table rows: AP Description | Observation | Due Date | Evidence Status
    var tableHeaders = ['Action Plan', 'Observation', 'Due Date', 'Evidence'];
    var rows = plans.map(function(ap) {
      var dueStr = ap.due_date
        ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';
      var daysLabel = ap._daysUntilDue === 0
        ? '<span style="color:#92400e; font-weight:500;">Target date today</span>'
        : '<span style="color:#f59e0b; font-weight:600;">' + ap._daysUntilDue + ' days left</span>';
      return [
        truncateWords(ap.action_description || '-', 10),
        String(ap._observation_title || '-').substring(0, 40),
        dueStr + '<br>' + daysLabel,
        '<span style="color:#6b7280; font-style:italic;">Not yet uploaded</span>'
      ];
    });

    // Callout
    var calloutHtml = buildCalloutBox(
      'Supporting documentation is needed to close action plans. Please upload relevant documents at your earliest convenience.',
      'info'
    );

    var loginLink = systemUrl
      ? 'Please <a href="' + systemUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to upload evidence for your action plans.'
      : 'Please log in to upload evidence for your action plans.';
    var outro = loginLink + calloutHtml;

    var htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);

    // CC audit team on evidence reminders
    var evidenceCc = buildAuditTeamCc(owner.email);
    sendEmail(owner.email, subject, subject, htmlBody, evidenceCc, 'Hass Audit', 'hassaudit@outlook.com');
    notificationCount++;
  });

  console.log('Sent evidence reminders:', notificationCount);
  return notificationCount;
}

/**
 * Send overdue evidence escalation emails for action plans past their due date
 * with no evidence uploaded. Escalates by CC'ing the work paper's cc_recipients.
 *
 * Escalation cadence:
 *   Day +1 overdue: Owner + CC recipients (overdue, action needed)
 *   Day +7 overdue: Owner + CC recipients (firmer tone, management visibility)
 *
 * Groups all overdue APs per owner into ONE email.
 * Called by daily trigger.
 */
function sendOverdueEvidenceEscalation() {
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) { console.log('sendOverdueEvidenceEscalation: No action plan data'); return 0; }
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var systemUrl = getSystemUrl();

  // Collect APs overdue by exactly 1 day or exactly 7 days with no evidence
  var qualifying = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[colMap['status']];
    var dueDate = row[colMap['due_date']];

    if (!dueDate) continue;
    if (isImplementedOrVerified(status)) continue;

    var due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    var daysOverdue = Math.round((today - due) / (1000 * 60 * 60 * 24));

    // Only trigger on exact day +1 or day +7
    if (daysOverdue !== 1 && daysOverdue !== 7) continue;

    var ap = rowToObject(headers, data[i]);
    ap._daysOverdue = daysOverdue;
    ap._escalationLevel = daysOverdue === 1 ? 'day_plus_1' : 'day_plus_7';

    // Check evidence count
    var hasEvidence = false;
    try {
      var evidenceRecords = firestoreQuery(SHEETS.AP_EVIDENCE, 'action_plan_id', 'EQUAL', ap.action_plan_id);
      if (evidenceRecords && evidenceRecords.length > 0) {
        var realEvidence = evidenceRecords.filter(function(ev) { return ev.drive_file_id; });
        if (realEvidence.length > 0 && realEvidence.length <= 5) {
          realEvidence = realEvidence.filter(function(ev) {
            try { DriveApp.getFileById(ev.drive_file_id); return true; } catch (e) { return false; }
          });
        }
        hasEvidence = realEvidence.length > 0;
      }
    } catch (e) {
      console.error('sendOverdueEvidenceEscalation: Evidence check failed for', ap.action_plan_id, ':', e.message);
    }

    if (hasEvidence) continue;

    // Enrich with parent work paper data + CC recipients
    if (ap.work_paper_id) {
      var wp = getWorkPaperById(ap.work_paper_id);
      ap._observation_title = wp ? wp.observation_title : '';
      ap._risk_rating = ap.risk_rating || (wp ? wp.risk_rating : '');
      ap._cc_recipients = wp ? (wp.cc_recipients || '') : '';
    }

    qualifying.push(ap);
  }

  if (qualifying.length === 0) {
    console.log('sendOverdueEvidenceEscalation: No overdue APs need escalation today');
    return 0;
  }

  // Group by owner
  var byOwner = {};
  qualifying.forEach(function(ap) {
    var ownerIds = String(ap.owner_ids || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    ownerIds.forEach(function(ownerId) {
      if (!byOwner[ownerId]) byOwner[ownerId] = [];
      byOwner[ownerId].push(ap);
    });
  });

  var notificationCount = 0;

  Object.keys(byOwner).forEach(function(ownerId) {
    var owner = getUserById(ownerId);
    if (!owner || !owner.email || !isActive(owner.is_active)) return;

    var plans = byOwner[ownerId];
    var ownerFirstName = owner.first_name || (owner.full_name || '').split(' ')[0] || 'Colleague';

    // Determine escalation level (use the most severe in the batch)
    var hasDay7 = plans.some(function(ap) { return ap._escalationLevel === 'day_plus_7'; });
    var maxDaysOverdue = Math.max.apply(null, plans.map(function(ap) { return ap._daysOverdue; }));

    // Build subject
    var primaryObs = plans[0]._observation_title || 'Action Plan';
    var subject;
    if (hasDay7) {
      subject = 'Follow-Up: Action Plan Documentation Outstanding \u2014 ' + primaryObs;
    } else {
      subject = 'Follow-Up: Action Plan Documentation Pending \u2014 ' + primaryObs;
    }

    // Build intro with appropriate tone
    var intro;
    if (hasDay7) {
      intro = 'Dear ' + ownerFirstName + ',<br><br>' +
        'The following action plan(s) have been <strong>overdue for ' + maxDaysOverdue + ' day(s)</strong> with no evidence submitted. ' +
        'Please provide an update on the status of these items or arrange for delegation if appropriate.';
    } else {
      intro = 'Dear ' + ownerFirstName + ',<br><br>' +
        'The following action plan(s) are now <strong>overdue</strong> with no evidence uploaded. ' +
        'Please provide an update at your earliest convenience.';
    }

    // Build table
    var tableHeaders = ['Action Plan', 'Observation', 'Due Date', 'Days Overdue', 'Evidence'];
    var rows = plans.map(function(ap) {
      var dueStr = ap.due_date
        ? new Date(ap.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';
      return [
        truncateWords(ap.action_description || '-', 10),
        String(ap._observation_title || '-').substring(0, 40),
        dueStr,
        '<span style="color:#92400e; font-weight:500;">' + ap._daysOverdue + '</span>',
        '<span style="color:#6b7280; font-style:italic;">Not yet uploaded</span>'
      ];
    });

    // Collect CC recipients from all work papers in this batch, deduplicate against owner
    var ccMap = {};
    plans.forEach(function(ap) {
      String(ap._cc_recipients || '').split(',').map(function(e) { return e.trim(); }).filter(Boolean).forEach(function(email) {
        if (email.toLowerCase() !== owner.email.toLowerCase()) {
          ccMap[email.toLowerCase()] = email;
        }
      });
    });
    var ccString = Object.keys(ccMap).length > 0 ? Object.values(ccMap).join(',') : null;

    var loginLink = systemUrl
      ? 'Please <a href="' + systemUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to update your action plans and upload evidence.'
      : 'Please log in to update your action plans and upload evidence.';
    var outro = loginLink;

    var htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);

    // CC audit team + work paper CC recipients (merged and deduplicated)
    var escalationCc = buildAuditTeamCc(owner.email, ccString);
    sendEmail(owner.email, subject, subject, htmlBody, escalationCc, 'Hass Audit', 'hassaudit@outlook.com');
    notificationCount++;
  });

  console.log('Sent overdue evidence escalations:', notificationCount);
  return notificationCount;
}

/**
 * Nudge auditors who have approved work papers that haven't been sent to auditees
 * within 48 hours. Sends ONE reminder email per auditor listing all unsent WPs.
 *
 * LOW priority — runs as part of daily maintenance.
 */
function sendAuditorUnsentWorkPaperNudge() {
  var allWPs = getWorkPapersRaw({ status: STATUS.WORK_PAPER.APPROVED }, null);
  if (!allWPs || allWPs.length === 0) {
    console.log('sendAuditorUnsentWorkPaperNudge: No approved WPs');
    return 0;
  }

  var now = new Date();
  var cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

  // Filter to WPs approved > 48 hours ago that have responsible_ids but haven't been sent
  var unsent = allWPs.filter(function(wp) {
    // Must have responsible parties assigned
    if (!wp.responsible_ids) return false;
    // Must be still in Approved status (not yet Sent to Auditee)
    if (wp.status !== STATUS.WORK_PAPER.APPROVED) return false;
    // Check approved_date or updated_at to see if it's been > 48 hours
    var approvedDate = wp.approved_date || wp.updated_at || wp.created_at;
    if (!approvedDate) return false;
    return new Date(approvedDate) < cutoff;
  });

  if (unsent.length === 0) {
    console.log('sendAuditorUnsentWorkPaperNudge: No overdue unsent WPs');
    return 0;
  }

  var systemUrl = getSystemUrl();

  // Group by preparer/auditor (prepared_by_id)
  var byAuditor = {};
  unsent.forEach(function(wp) {
    var auditorId = wp.prepared_by_id || wp.reviewed_by_id || '';
    if (!auditorId) return;
    if (!byAuditor[auditorId]) byAuditor[auditorId] = [];
    byAuditor[auditorId].push(wp);
  });

  var notificationCount = 0;

  Object.keys(byAuditor).forEach(function(auditorId) {
    var auditor = getUserById(auditorId);
    if (!auditor || !auditor.email || !isActive(auditor.is_active)) return;

    var wps = byAuditor[auditorId];
    var firstName = auditor.first_name || (auditor.full_name || '').split(' ')[0] || 'Auditor';

    var subject = 'Follow-Up: ' + wps.length + ' Approved Work Paper(s) Pending Dispatch';
    var intro = 'Dear ' + firstName + ',<br><br>' +
      'You have <strong>' + wps.length + '</strong> approved work paper(s) with assigned auditees but have not yet been dispatched. ' +
      'Please review and send them at your earliest convenience:';

    var tableHeaders = ['Observation', 'Risk Rating', 'Approved Since', 'Auditees Assigned'];
    var rows = wps.map(function(wp) {
      var approvedDate = wp.approved_date || wp.updated_at || '';
      var dateStr = approvedDate
        ? new Date(approvedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : '-';
      var hoursAgo = approvedDate ? Math.round((now - new Date(approvedDate)) / (1000 * 60 * 60)) : 0;
      return [
        String(wp.observation_title || wp.work_paper_id || '-').substring(0, 50),
        ratingBadge(wp.risk_rating || ''),
        dateStr + ' <span style="color:#6b7280; font-size:12px;">(' + hoursAgo + 'h ago)</span>',
        String(wp.responsible_ids || '').split(',').length + ' person(s)'
      ];
    });

    var loginLink = systemUrl
      ? 'Please <a href="' + systemUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to the Send Queue and dispatch these work papers.'
      : 'Please log in to the Send Queue and dispatch these work papers.';
    var outro = loginLink;

    var htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);
    var nudgeCc = buildAuditTeamCc(auditor.email);
    sendEmail(auditor.email, subject, subject, htmlBody, nudgeCc, 'Hass Audit', 'hassaudit@outlook.com');
    notificationCount++;
  });

  console.log('Sent auditor unsent WP nudges:', notificationCount);
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

  var subject = 'Internal Audit \u2014 Periodic Summary Report';
  var intro = 'Here is your biweekly audit summary as of <strong>' +
    new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) + '</strong>.' +
    '<br><br><strong>Work Papers (' + wpCounts.total + ' total):</strong>';

  // Build combined HTML: WP table + AP table
  var wpTableHtml = formatTableEmailHtml(subject, intro, wpHeaders, wpRows,
    '<strong>Action Plans (' + apCounts.total + ' total):</strong>');

  // For the AP table, embed it manually after the WP section
  var apTableIntro = '';
  var apOutro = loginUrl
    ? '<br>Please <a href="' + loginUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to review and take action on outstanding items.'
    : '<br>Please log in to review and take action on outstanding items.';
  var apTableHtml = formatTableEmailHtml(subject, apTableIntro, apHeaders, apRows, apOutro);

  // Use the WP table email as the main body (it includes both sections)
  var htmlBody = wpTableHtml;

  // Get configured recipients from system config, or fall back to role-based
  var recipientEmails = getConfiguredSummaryRecipients();

  let notificationCount = 0;

  recipientEmails.forEach(function(email) {
    sendEmail(email, subject, subject, htmlBody, null, 'Hass Audit', 'hassaudit@outlook.com');
    notificationCount++;
  });

  console.log('Queued biweekly summaries:', notificationCount);
  return notificationCount;
}

/**
 * Get configured summary report recipients.
 * Reads from system config SUMMARY_RECIPIENTS; falls back to role-based lookup.
 */

function getNotificationBulkRoles_() {
  return [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR, ROLES.SENIOR_MGMT];
}

function getAllowedNotificationRecipientEmails_() {
  var allowedRoles = getNotificationBulkRoles_();
  var users = getUsersDropdown().filter(function(u) {
    return allowedRoles.indexOf(u.roleCode) >= 0;
  });
  return users.map(function(u) { return String(u.email || '').toLowerCase().trim(); }).filter(Boolean);
}

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

  // Fallback: eligible notification roles
  var recipients = getUsersDropdown().filter(function(u) {
    return getNotificationBulkRoles_().indexOf(u.roleCode) >= 0;
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
  var cleaned = String(emailsString || '').split(',').map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean);
  var unique = [];
  cleaned.forEach(function(e) { if (unique.indexOf(e) === -1) unique.push(e); });

  var allowedEmails = getAllowedNotificationRecipientEmails_();
  var invalid = unique.filter(function(email) { return allowedEmails.indexOf(email) === -1; });
  if (invalid.length > 0) {
    return { success: false, error: 'Only existing Admin/Auditor/Management users can be selected. Invalid: ' + invalid.join(', ') };
  }

  var props = PropertiesService.getScriptProperties();
  props.setProperty('SUMMARY_RECIPIENTS', unique.join(', '));
  logAuditEvent('SET_SUMMARY_RECIPIENTS', 'CONFIG', 'NOTIFICATION', null, { recipients: unique.join(', ') }, user.user_id, user.email);
  return { success: true };
}

/**
 * Get saved summary recipient emails (for Settings UI)
 */
function getSummaryRecipients() {
  var props = PropertiesService.getScriptProperties();
  return { success: true, recipients: props.getProperty('SUMMARY_RECIPIENTS') || '' };
}

// ─────────────────────────────────────────────────────────────
// Audit Team CC Helper
// ─────────────────────────────────────────────────────────────

/**
 * Get email addresses of all active audit team members (SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR).
 * Results are cached for 1 hour since the team rarely changes.
 * @param {string} [excludeEmail] - Optional email to exclude (e.g. primary recipient to avoid duplicate)
 * @returns {string[]} Array of email addresses
 */
function getAuditTeamEmails(excludeEmail) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'audit_team_emails';
  var cached = cache.get(cacheKey);
  var emails;

  if (cached) {
    try { emails = JSON.parse(cached); } catch (e) { emails = null; }
  }

  if (!emails) {
    var users = getUsersDropdown();
    var auditRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.AUDITOR];
    emails = users
      .filter(function(u) { return auditRoles.indexOf(u.roleCode) >= 0 && u.email; })
      .map(function(u) { return u.email.toLowerCase().trim(); });
    // Deduplicate
    var seen = {};
    emails = emails.filter(function(e) {
      if (seen[e]) return false;
      seen[e] = true;
      return true;
    });
    cache.put(cacheKey, JSON.stringify(emails), 3600);
  }

  if (excludeEmail) {
    var excludeLower = excludeEmail.toLowerCase().trim();
    return emails.filter(function(e) { return e !== excludeLower; });
  }
  return emails;
}

/**
 * Build a CC string for audit team, excluding the primary recipient and any already-present CC emails.
 * @param {string} primaryRecipientEmail - The To: address (excluded from CC)
 * @param {string} [existingCc] - Existing CC string to merge with
 * @returns {string|null} Comma-separated CC string, or null if empty
 */
function buildAuditTeamCc(primaryRecipientEmail, existingCc) {
  var teamEmails = getAuditTeamEmails(primaryRecipientEmail);

  // Merge with existing CC, deduplicating
  var ccSet = {};
  teamEmails.forEach(function(e) { ccSet[e.toLowerCase()] = e; });

  if (existingCc) {
    String(existingCc).split(',').map(function(e) { return e.trim(); }).filter(Boolean).forEach(function(e) {
      var lower = e.toLowerCase();
      if (lower !== (primaryRecipientEmail || '').toLowerCase()) {
        ccSet[lower] = e;
      }
    });
  }

  var result = Object.values(ccSet);
  return result.length > 0 ? result.join(',') : null;
}

// ─────────────────────────────────────────────────────────────
// Delegation Notification Batching
// ─────────────────────────────────────────────────────────────

/**
 * Calculate the next 8:00 AM EAT (East Africa Time, UTC+3) for batch scheduling.
 * If current EAT time is before 8 AM, returns 8 AM today.
 * If current EAT time is at or after 8 AM, returns 8 AM tomorrow.
 * @returns {Date} The scheduled send time in UTC
 */
function getNextBatchSendTime() {
  var now = new Date();
  // EAT is UTC+3. 8:00 AM EAT = 5:00 AM UTC
  var utcHour = now.getUTCHours();
  var utcMinutes = now.getUTCMinutes();

  // Current EAT hour = UTC hour + 3
  var eatHour = utcHour + 3;
  var isAfter8AM_EAT = (eatHour > 8) || (eatHour === 8 && utcMinutes > 0);

  var sendTime = new Date(now);
  sendTime.setUTCHours(5, 0, 0, 0); // 5:00 AM UTC = 8:00 AM EAT

  if (isAfter8AM_EAT || eatHour >= 24) {
    // Schedule for tomorrow 8 AM EAT
    sendTime.setUTCDate(sendTime.getUTCDate() + 1);
  }

  return sendTime;
}

/**
 * Queue a delegation notification for batched delivery at 8 AM EAT.
 * Instead of sending immediately, stores the notification with batch metadata.
 * @param {string} recipientEmail - Delegatee email
 * @param {string} recipientUserId - Delegatee user ID
 * @param {Object} batchData - AP details to include in the batched email
 */
function queueBatchedDelegationNotification(recipientEmail, recipientUserId, batchData) {
  try {
    var notificationId = generateId('NOTIFICATION');
    var now = new Date();
    var scheduledFor = getNextBatchSendTime();

    var notification = {
      notification_id: notificationId,
      template_code: 'DELEGATION_BATCH',
      recipient_user_id: recipientUserId,
      recipient_email: recipientEmail,
      subject: 'Action Plans Delegated to You',
      body: '',
      module: 'ACTION_PLAN',
      record_id: batchData.action_plan_id || '',
      status: STATUS.NOTIFICATION.BATCHED,
      scheduled_for: scheduledFor,
      sent_at: '',
      error_message: '',
      created_at: now,
      batch_type: 'delegation',
      batch_data: JSON.stringify(batchData)
    };

    syncToFirestore(SHEETS.NOTIFICATION_QUEUE, notificationId, notification);
    invalidateSheetData(SHEETS.NOTIFICATION_QUEUE);
  } catch (e) {
    console.error('Failed to queue batched delegation notification:', e.message);
  }
}

/**
 * Process batched delegation notifications.
 * Groups all pending delegation notifications by recipient and sends ONE consolidated email per person.
 * Called by daily trigger at 5:00 AM UTC (8:00 AM EAT).
 */
function processBatchedDelegationNotifications() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    console.log('Batch delegation processor already running');
    return { sent: 0 };
  }

  try {
    var data = getSheetData(SHEETS.NOTIFICATION_QUEUE);
    if (!data || data.length < 2) { lock.releaseLock(); return { sent: 0 }; }
    var headers = data[0];

    var colMap = {};
    headers.forEach(function(h, i) { colMap[h] = i; });

    var now = new Date();
    var byRecipient = {};
    var notificationIds = {};

    // Collect all batched delegation notifications that are due
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var status = row[colMap['status']];
      var batchType = row[colMap['batch_type']];
      var scheduledFor = row[colMap['scheduled_for']];

      if (status !== STATUS.NOTIFICATION.BATCHED) continue;
      if (batchType !== 'delegation') continue;
      if (scheduledFor && new Date(scheduledFor) > now) continue;

      var recipientEmail = row[colMap['recipient_email']];
      var recipientUserId = row[colMap['recipient_user_id']];
      var batchDataStr = row[colMap['batch_data']];
      var notifId = row[colMap['notification_id']];

      if (!recipientEmail) continue;

      var emailKey = recipientEmail.toLowerCase();
      if (!byRecipient[emailKey]) {
        byRecipient[emailKey] = { email: recipientEmail, userId: recipientUserId, items: [] };
        notificationIds[emailKey] = [];
      }

      try {
        var batchItem = JSON.parse(batchDataStr);
        byRecipient[emailKey].items.push(batchItem);
      } catch (e) {
        console.warn('Invalid batch_data for notification', notifId);
      }

      notificationIds[emailKey].push({ notifId: notifId, rowData: rowToObject(headers, data[i]) });
    }

    var sentCount = 0;
    var systemUrl = getSystemUrl();

    Object.keys(byRecipient).forEach(function(emailKey) {
      var recipient = byRecipient[emailKey];
      var items = recipient.items;
      if (items.length === 0) return;

      // Resolve recipient name
      var recipientUser = getUserById(recipient.userId);
      var recipientName = recipientUser ? (recipientUser.first_name || (recipientUser.full_name || '').split(' ')[0]) : 'Colleague';

      // Build consolidated email
      var subject = 'Action Plans Delegated to You (' + items.length + ' item' + (items.length > 1 ? 's' : '') + ')';
      var intro = 'Dear ' + recipientName + ',<br><br>' +
        'The following <strong>' + items.length + '</strong> action plan(s) have been delegated to you:';

      var tableHeaders = ['#', 'Action Plan', 'Parent Observation', 'Delegated By', 'Due Date', 'Risk'];
      var rows = items.map(function(item, idx) {
        var dueStr = item.due_date
          ? new Date(item.due_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : '-';
        return [
          String(idx + 1),
          truncateWords(item.action_description || '-', 12),
          String(item.observation_title || '-').substring(0, 40),
          String(item.delegated_by_name || '-'),
          dueStr,
          ratingBadge(item.risk_rating || '')
        ];
      });

      var loginLink = systemUrl
        ? 'Please <a href="' + systemUrl + '" style="color:#1a73e8; text-decoration:underline; font-weight:600;">log in</a> to review and take action on these items.'
        : 'Please log in to review and take action on these items.';
      var outro = loginLink;

      var htmlBody = formatTableEmailHtml(subject, intro, tableHeaders, rows, outro);

      // CC audit team on delegation batch emails
      var ccString = buildAuditTeamCc(recipient.email);

      sendEmail(recipient.email, subject, subject, htmlBody, ccString, 'Hass Audit', 'hassaudit@outlook.com');

      // Mark all processed notifications as Sent
      notificationIds[emailKey].forEach(function(entry) {
        var updated = entry.rowData;
        updated.status = STATUS.NOTIFICATION.SENT;
        updated.sent_at = now;
        syncToFirestore(SHEETS.NOTIFICATION_QUEUE, entry.notifId, updated);
      });

      sentCount++;
    });

    invalidateSheetData(SHEETS.NOTIFICATION_QUEUE);
    console.log('Processed batched delegation notifications. Recipients:', sentCount);
    return { sent: sentCount };
  } finally {
    lock.releaseLock();
  }
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
  // Persist the web-app URL so that time-driven triggers can include it in emails.
  // ScriptApp.getService().getUrl() only works when called from a user context,
  // so we store it now while we have access.
  try {
    var webAppUrl = ScriptApp.getService().getUrl();
    if (webAppUrl) {
      PropertiesService.getScriptProperties().setProperty('WEB_APP_URL', webAppUrl);
      console.log('Stored WEB_APP_URL:', webAppUrl);
    }
  } catch (e) {
    console.warn('Could not store WEB_APP_URL:', e.message);
  }

  // Remove existing triggers for these functions
  const functionNames = [
    'processEmailQueue',
    'sendOverdueReminders',
    'sendUpcomingDueReminders',
    'sendWeeklySummary',
    'sendBiweeklySummary',
    'weeklyReminderRunner',
    'dailyMaintenance',
    'processBatchedDelegationNotifications'
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

  // Process batched delegation notifications at 5 AM UTC (8 AM EAT) daily
  ScriptApp.newTrigger('processBatchedDelegationNotifications')
    .timeBased()
    .atHour(5)
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

  // Run daily evidence reminders (day -7 and day 0)
  var evidenceReminders = 0;
  try {
    evidenceReminders = sendEvidenceReminders();
  } catch (e) {
    console.error('dailyMaintenance: sendEvidenceReminders failed:', e.message);
  }

  // Run overdue evidence escalation (day +1 and day +7)
  var overdueEscalations = 0;
  try {
    overdueEscalations = sendOverdueEvidenceEscalation();
  } catch (e) {
    console.error('dailyMaintenance: sendOverdueEvidenceEscalation failed:', e.message);
  }

  // Nudge auditors with unsent approved work papers (> 48 hours)
  var auditorNudges = 0;
  try {
    auditorNudges = sendAuditorUnsentWorkPaperNudge();
  } catch (e) {
    console.error('dailyMaintenance: sendAuditorUnsentWorkPaperNudge failed:', e.message);
  }

  console.log('Daily maintenance completed. Evidence reminders:', evidenceReminders,
    'Overdue escalations:', overdueEscalations, 'Auditor nudges:', auditorNudges);

  return {
    overdueUpdated,
    cleaned,
    evidenceReminders,
    overdueEscalations,
    auditorNudges
  };
}

/**
 * Clean up old sent notifications
 */
function cleanupOldNotifications(daysOld) {
  var data = getSheetData(SHEETS.NOTIFICATION_QUEUE);
  if (!data || data.length < 2) return 0;
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
        // Delete from Firestore
        var notificationId = data[i][colMap['notification_id']];
        if (notificationId) {
          deleteFromFirestore(SHEETS.NOTIFICATION_QUEUE, notificationId);
        }
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
    const replyTo = 'hassaudit@outlook.com';
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
  var data = getSheetData(SHEETS.NOTIFICATION_QUEUE);
  if (!data || data.length < 2) return sanitizeForClient({ pending: 0, sent: 0, failed: 0, total: 0 });
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

  var data = getSheetData(SHEETS.NOTIFICATION_QUEUE);
  if (!data || data.length < 2) return sanitizeForClient([]);
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
 * Get Outlook email configuration status (for Settings UI)
 */
function getOutlookStatus() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty('OUTLOOK_CLIENT_ID');
  var refreshToken = props.getProperty('OUTLOOK_REFRESH_TOKEN');

  if (clientId && refreshToken) {
    var masked = clientId.substring(0, 8) + '...';
    return { configured: true, clientIdMasked: masked };
  }
  return { configured: false };
}

/**
 * Send a test email via Outlook (Microsoft Graph API) to verify configuration
 */
function testOutlookEmailAction(recipientEmail, user) {
  if (!recipientEmail) {
    return { success: false, error: 'No recipient email provided' };
  }

  var subject = 'Test Email - Hass Petroleum Audit System';
  var body = 'This is a test email from the Internal Audit System.\n\nIf you received this, your Outlook email integration is working correctly.\n\nSent from: hassaudit@outlook.com via Microsoft Graph API\nSent at: ' + new Date().toISOString();
  var htmlBody = formatEmailHtml(subject, body);

  var result = sendEmailViaOutlook(recipientEmail, subject, htmlBody, null);

  if (result.success) {
    return { success: true };
  } else if (result.fallback) {
    return { success: false, error: 'Outlook credentials not configured. Please set OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, and OUTLOOK_REFRESH_TOKEN in Script Properties.' };
  } else {
    return { success: false, error: result.error || 'Test email failed' };
  }
}

/**
 * Format a professional welcome email for new users.
 * Includes credentials, role, and a branded login button.
 * @param {Object} opts - { fullName, firstName, email, tempPassword, roleName, loginUrl }
 */
function formatWelcomeEmailHtml(opts) {
  var year = new Date().getFullYear();
  var subject = 'Welcome to Hass Petroleum Internal Audit System';

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="utf-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->' +
'  <style>' +
'    @media only screen and (max-width: 620px) {' +
'      .email-outer { padding: 0 !important; }' +
'      .email-inner { width: 100% !important; min-width: 100% !important; border-radius: 0 !important; }' +
'      .email-content { padding: 24px 20px !important; }' +
'      .email-header { padding: 20px 20px !important; }' +
'      .email-footer-inner { padding: 20px 20px !important; }' +
'      .cred-table { margin-left: 0 !important; margin-right: 0 !important; }' +
'    }' +
'  </style>' +
'</head>' +
'<body style="margin:0; padding:0; font-family:system-ui,-apple-system,\'SF Pro Display\',\'Helvetica Neue\',Arial,sans-serif; background-color:#f5f5f7; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">' +
'  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">' +
'    Welcome to the Internal Audit System &mdash; Your account is ready &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' +
'  </div>' +
'  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;" class="email-outer">' +
'    <tr><td align="center" style="padding:32px 16px;">' +
'      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);" class="email-inner">' +
'        <!-- HEADER -->' +
'        <tr>' +
'          <td style="padding:28px 36px; text-align:center;" class="email-header">' +
'            <p style="margin:0 0 4px 0; color:#86868b; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; font-family:system-ui,-apple-system,sans-serif;">HASS PETROLEUM</p>' +
'            <p style="margin:0 0 16px 0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,sans-serif;">Internal Audit Department</p>' +
'            <p style="margin:0; color:#1d1d1f; font-size:22px; font-weight:600; font-family:system-ui,-apple-system,sans-serif; line-height:1.3;">Welcome to the Audit System</p>' +
'          </td>' +
'        </tr>' +
'        <!-- SEPARATOR -->' +
'        <tr><td style="padding:0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td></tr>' +
'        <!-- CONTENT -->' +
'        <tr>' +
'          <td style="padding:32px 36px;" class="email-content">' +
'            <p style="margin:0 0 16px 0; color:#1d1d1f; font-size:16px; font-weight:600; font-family:system-ui,-apple-system,sans-serif;">Dear ' + (opts.firstName || 'Colleague') + ',</p>' +
'            <p style="margin:0 0 20px 0; color:#424245; font-size:14px; line-height:1.75; font-family:system-ui,-apple-system,sans-serif;">' +
'              Your account has been created for the Hass Petroleum Internal Audit System. You have been assigned the role of <strong style="color:#1d1d1f;">' + (opts.roleName || opts.email) + '</strong>. Please use the credentials below to log in.</p>' +
'            <!-- CREDENTIALS BOX -->' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e5e7eb; margin:0 0 24px 0;" class="cred-table">' +
'              <tr>' +
'                <td style="padding:20px 24px;">' +
'                  <table width="100%" cellpadding="0" cellspacing="0" border="0">' +
'                    <tr>' +
'                      <td style="padding:6px 0; color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; font-family:system-ui,-apple-system,sans-serif; width:120px;">Email</td>' +
'                      <td style="padding:6px 0; color:#1d1d1f; font-size:14px; font-weight:600; font-family:system-ui,-apple-system,sans-serif;">' + opts.email + '</td>' +
'                    </tr>' +
'                    <tr><td colspan="2" style="padding:0;"><div style="height:1px; background-color:#e5e7eb; margin:6px 0;"></div></td></tr>' +
'                    <tr>' +
'                      <td style="padding:6px 0; color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; font-family:system-ui,-apple-system,sans-serif;">Password</td>' +
'                      <td style="padding:6px 0; color:#1d1d1f; font-size:14px; font-weight:600; font-family:\'Courier New\',monospace; letter-spacing:1px;">' + opts.tempPassword + '</td>' +
'                    </tr>' +
'                  </table>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'            <!-- CTA BUTTON -->' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
'              <tr>' +
'                <td align="center" style="padding:4px 0 24px 0;">' +
'                  <a href="' + opts.loginUrl + '" style="display:inline-block; background-color:#007AFF; color:#ffffff; padding:12px 32px; text-decoration:none; border-radius:16px; font-weight:600; font-size:15px; height:44px; line-height:20px; font-family:system-ui,-apple-system,sans-serif;">Open Audit System</a>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'            <!-- SECURITY NOTE -->' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fffbeb; border-radius:8px; border:1px solid #fde68a;">' +
'              <tr>' +
'                <td style="padding:14px 18px;">' +
'                  <p style="margin:0; color:#92400e; font-size:12px; line-height:1.6; font-family:system-ui,-apple-system,sans-serif;">' +
'                    <strong>Security Notice:</strong> You will be required to change your password on first login. Please do not share your credentials with anyone.</p>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'          </td>' +
'        </tr>' +
'        <!-- FOOTER -->' +
'        <tr>' +
'          <td style="padding:0 36px;">' +
'            <div style="height:1px; background-color:#e5e7eb;"></div>' +
'          </td>' +
'        </tr>' +
'        <tr>' +
'          <td style="padding:20px 36px 24px 36px;" class="email-footer-inner">' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0">' +
'              <tr>' +
'                <td align="center">' +
'                  <p style="margin:0 0 4px 0; color:#9ca3af; font-size:11px; font-family:system-ui,-apple-system,sans-serif; line-height:1.5;">' +
'                    &copy; ' + year + ' Hass Petroleum &middot; Internal Audit Department</p>' +
'                  <p style="margin:0; color:#9ca3af; font-size:10px; font-family:system-ui,-apple-system,sans-serif;">All replies go directly to <a href="mailto:audit@hasspetroleum.com" style="color:#1a73e8; text-decoration:underline;">audit@hasspetroleum.com</a></p>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'          </td>' +
'        </tr>' +
'      </table>' +
'    </td></tr>' +
'  </table>' +
'</body>' +
'</html>';
}

/**
 * Format a branded HTML email for password reset / forgot password.
 * Displays the temporary password in a styled credentials box and
 * includes a prominent blue CTA button linking to the system.
 *
 * @param {Object} opts
 * @param {string} opts.firstName - Recipient first name
 * @param {string} opts.email - Recipient email address
 * @param {string} opts.tempPassword - The new temporary password
 * @param {string} opts.loginUrl - System login URL
 * @param {string} opts.reason - 'admin_reset' or 'forgot'
 */
function formatPasswordResetEmailHtml(opts) {
  var year = new Date().getFullYear();
  var subject = 'Password Reset - Hass Petroleum Audit System';

  var introParagraph = opts.reason === 'forgot'
    ? 'A password reset was requested for your account. Please use the new temporary credentials below to log in.'
    : 'Your password has been reset by an administrator. Please use the new temporary credentials below to log in.';

  var warningNote = opts.reason === 'forgot'
    ? 'If you did not request this reset, please contact your administrator immediately.'
    : 'If you did not expect this reset, please contact your administrator immediately.';

  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="utf-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->' +
'  <style>' +
'    @media only screen and (max-width: 620px) {' +
'      .email-outer { padding: 0 !important; }' +
'      .email-inner { width: 100% !important; min-width: 100% !important; border-radius: 0 !important; }' +
'      .email-content { padding: 24px 20px !important; }' +
'      .email-header { padding: 20px 20px !important; }' +
'      .email-footer-inner { padding: 20px 20px !important; }' +
'      .cred-table { margin-left: 0 !important; margin-right: 0 !important; }' +
'    }' +
'  </style>' +
'</head>' +
'<body style="margin:0; padding:0; font-family:system-ui,-apple-system,\'SF Pro Display\',\'Helvetica Neue\',Arial,sans-serif; background-color:#f5f5f7; -webkit-text-size-adjust:100%; -webkit-font-smoothing:antialiased;">' +
'  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">' +
'    Your password has been reset &mdash; Hass Petroleum Internal Audit &nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;' +
'  </div>' +
'  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f5f7;" class="email-outer">' +
'    <tr><td align="center" style="padding:32px 16px;">' +
'      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,0.08);" class="email-inner">' +
'        <!-- HEADER -->' +
'        <tr>' +
'          <td style="padding:28px 36px; text-align:center;" class="email-header">' +
'            <p style="margin:0 0 4px 0; color:#86868b; font-size:11px; font-weight:600; letter-spacing:1px; text-transform:uppercase; font-family:system-ui,-apple-system,sans-serif;">HASS PETROLEUM</p>' +
'            <p style="margin:0 0 14px 0; color:#86868b; font-size:11px; font-family:system-ui,-apple-system,sans-serif;">Internal Audit Department</p>' +
'            <p style="margin:0; color:#1d1d1f; font-size:20px; font-weight:600; font-family:system-ui,-apple-system,sans-serif; line-height:1.3;">Password Reset</p>' +
'          </td>' +
'        </tr>' +
'        <!-- SEPARATOR -->' +
'        <tr><td style="padding:0 36px;"><div style="height:1px; background-color:#e5e5e5;"></div></td></tr>' +
'        <!-- CONTENT -->' +
'        <tr>' +
'          <td style="padding:32px 36px;" class="email-content">' +
'            <p style="margin:0 0 16px 0; color:#1d1d1f; font-size:16px; font-weight:600; font-family:system-ui,-apple-system,sans-serif;">Dear ' + (opts.firstName || 'Colleague') + ',</p>' +
'            <p style="margin:0 0 20px 0; color:#424245; font-size:14px; line-height:1.75; font-family:system-ui,-apple-system,sans-serif;">' + introParagraph + '</p>' +
'            <!-- CREDENTIALS BOX -->' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8fafc; border-radius:10px; border:1px solid #e5e7eb; margin:0 0 24px 0;" class="cred-table">' +
'              <tr>' +
'                <td style="padding:20px 24px;">' +
'                  <table width="100%" cellpadding="0" cellspacing="0" border="0">' +
'                    <tr>' +
'                      <td style="padding:6px 0; color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; font-family:system-ui,-apple-system,sans-serif; width:160px;">Email</td>' +
'                      <td style="padding:6px 0; color:#1d1d1f; font-size:14px; font-weight:600; font-family:system-ui,-apple-system,sans-serif;">' + opts.email + '</td>' +
'                    </tr>' +
'                    <tr><td colspan="2" style="padding:0;"><div style="height:1px; background-color:#e5e7eb; margin:6px 0;"></div></td></tr>' +
'                    <tr>' +
'                      <td style="padding:6px 0; color:#6b7280; font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; font-family:system-ui,-apple-system,sans-serif;">Temporary Password</td>' +
'                      <td style="padding:6px 0; color:#1d1d1f; font-size:14px; font-weight:600; font-family:\'Courier New\',monospace; letter-spacing:1px;">' + opts.tempPassword + '</td>' +
'                    </tr>' +
'                  </table>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'            <!-- CTA BUTTON -->' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">' +
'              <tr>' +
'                <td align="center" style="padding:4px 0 24px 0;">' +
'                  <a href="' + opts.loginUrl + '" style="display:inline-block; background-color:#007AFF; color:#ffffff; padding:12px 32px; text-decoration:none; border-radius:16px; font-weight:600; font-size:15px; height:44px; line-height:20px; font-family:system-ui,-apple-system,sans-serif;">Open Audit System</a>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'            <!-- SECURITY NOTE -->' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fffbeb; border-radius:8px; border:1px solid #fde68a;">' +
'              <tr>' +
'                <td style="padding:14px 18px;">' +
'                  <p style="margin:0; color:#92400e; font-size:12px; line-height:1.6; font-family:system-ui,-apple-system,sans-serif;">' +
'                    <strong>Security Notice:</strong> You will be required to change your password on first login. ' + warningNote + '</p>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'          </td>' +
'        </tr>' +
'        <!-- FOOTER -->' +
'        <tr>' +
'          <td style="padding:0 36px;">' +
'            <div style="height:1px; background-color:#e5e7eb;"></div>' +
'          </td>' +
'        </tr>' +
'        <tr>' +
'          <td style="padding:20px 36px 24px 36px;" class="email-footer-inner">' +
'            <table width="100%" cellpadding="0" cellspacing="0" border="0">' +
'              <tr>' +
'                <td align="center">' +
'                  <p style="margin:0 0 4px 0; color:#9ca3af; font-size:11px; font-family:system-ui,-apple-system,sans-serif; line-height:1.5;">' +
'                    &copy; ' + year + ' Hass Petroleum &middot; Internal Audit Department</p>' +
'                  <p style="margin:0; color:#9ca3af; font-size:10px; font-family:system-ui,-apple-system,sans-serif;">All replies go directly to <a href="mailto:audit@hasspetroleum.com" style="color:#1a73e8; text-decoration:underline;">audit@hasspetroleum.com</a></p>' +
'                </td>' +
'              </tr>' +
'            </table>' +
'          </td>' +
'        </tr>' +
'      </table>' +
'    </td></tr>' +
'  </table>' +
'</body>' +
'</html>';
}

/**
 * Get all email templates (for Settings editor).
 * Returns all templates including inactive ones for admin editing.
 */
function getEmailTemplatesAll() {
  var data = getSheetData(SHEETS.EMAIL_TEMPLATES);
  if (!data || data.length < 2) return sanitizeForClient([]);
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

  var data = getSheetData(SHEETS.EMAIL_TEMPLATES);
  if (!data || data.length < 2) return { success: false, error: 'No template data found' };
  var headers = data[0];
  var codeIdx = headers.indexOf('template_code');

  for (var i = 1; i < data.length; i++) {
    if (data[i][codeIdx] === templateCode) {
      var existing = rowToObject(headers, data[i]);
      if (updates.subject_template !== undefined) existing.subject_template = sanitizeInput(updates.subject_template);
      if (updates.body_template !== undefined) existing.body_template = sanitizeInput(updates.body_template);
      if (updates.is_active !== undefined) existing.is_active = updates.is_active;

      // Write to Firestore
      syncToFirestore(SHEETS.EMAIL_TEMPLATES, existing.template_code || templateCode, existing);
      invalidateSheetData(SHEETS.EMAIL_TEMPLATES);

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
