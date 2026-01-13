/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Notification Service v1.0
 * 
 * Email notifications and reminders
 */

// ============================================================
// QUEUE NOTIFICATION
// ============================================================
function queueNotification(templateCode, recordId, triggeredByUser) {
  try {
    const template = getEmailTemplate(templateCode);
    if (!template) {
      console.warn('Email template not found:', templateCode);
      return;
    }
    
    // Get record data based on template type
    const recordData = getRecordDataForNotification(templateCode, recordId);
    if (!recordData) {
      console.warn('Record data not found for notification');
      return;
    }
    
    // Get recipients
    const recipients = getRecipientsForNotification(templateCode, recordData);
    if (recipients.length === 0) {
      console.warn('No recipients for notification');
      return;
    }
    
    // Parse template
    const subject = parseTemplate(template.subject_template, recordData);
    const body = parseTemplate(template.body_template, recordData);
    
    const sheet = getSheet('18_NotificationQueue');
    const now = new Date();
    
    // Queue for each recipient
    recipients.forEach(recipient => {
      const notificationId = getNextId('NOTIFICATION');
      
      sheet.appendRow([
        notificationId,
        templateCode,
        recipient.user_id,
        recipient.email,
        subject,
        body,
        getModuleFromTemplate(templateCode),
        recordId,
        'Pending',
        now, // scheduled_for
        '', // sent_at
        '', // error_message
        now // created_at
      ]);
    });
    
    // Try to send immediately
    processNotificationQueue();
    
  } catch (error) {
    console.error('queueNotification error:', error);
  }
}

// ============================================================
// GET EMAIL TEMPLATE
// ============================================================
function getEmailTemplate(templateCode) {
  const templates = getSheetData('19_EmailTemplates');
  return templates.find(t => t.template_code === templateCode && t.is_active);
}

// ============================================================
// GET RECORD DATA FOR NOTIFICATION
// ============================================================
function getRecordDataForNotification(templateCode, recordId) {
  const module = getModuleFromTemplate(templateCode);
  
  if (module === 'WORK_PAPER') {
    const result = getWorkPaper(recordId);
    if (!result.success) return null;
    
    const wp = result.data;
    
    // Get unit head info
    const users = getSheetData('05_Users');
    const unitHead = users.find(u => u.user_id === wp.unit_head_id);
    const preparedBy = users.find(u => u.user_id === wp.prepared_by_id);
    
    // Get affiliate name
    const affiliates = getSheetData('06_Affiliates');
    const affiliate = affiliates.find(a => a.affiliate_code === wp.affiliate_code);
    
    return {
      work_paper_id: wp.work_paper_id,
      observation_title: wp.observation_title,
      risk_rating: wp.risk_rating,
      affiliate_name: affiliate ? affiliate.affiliate_name : wp.affiliate_code,
      submitted_by: preparedBy ? preparedBy.full_name : '',
      auditor_name: preparedBy ? preparedBy.full_name : '',
      auditee_name: unitHead ? unitHead.full_name : '',
      reviewer_name: 'Head of Internal Audit',
      review_comments: wp.review_comments || ''
    };
  }
  
  if (module === 'ACTION_PLAN') {
    const result = getActionPlan(recordId);
    if (!result.success) return null;
    
    const ap = result.data;
    
    // Get owner info
    const users = getSheetData('05_Users');
    const owner = users.find(u => u.user_id === ap.action_owner_id);
    
    return {
      action_plan_id: ap.action_plan_id,
      work_paper_id: ap.work_paper_id,
      action_description: ap.action_description,
      due_date: formatDate(ap.due_date),
      days_until_due: calculateDaysUntilDue(ap.due_date),
      days_overdue: ap.days_overdue || 0,
      owner_name: owner ? owner.full_name : ap.action_owner_name
    };
  }
  
  return null;
}

function calculateDaysUntilDue(dueDate) {
  if (!dueDate) return 0;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  
  return Math.ceil((due - today) / (1000 * 60 * 60 * 24));
}

// ============================================================
// GET RECIPIENTS FOR NOTIFICATION
// ============================================================
function getRecipientsForNotification(templateCode, recordData) {
  const users = getSheetData('05_Users');
  const recipients = [];
  
  switch (templateCode) {
    case 'WP_SUBMITTED':
      // Notify HoA (Super Admin)
      users.filter(u => u.role_code === 'SUPER_ADMIN' && u.is_active)
        .forEach(u => recipients.push({ user_id: u.user_id, email: u.email }));
      break;
    
    case 'WP_APPROVED':
      // Notify unit head
      if (recordData.unit_head_id) {
        const unitHead = users.find(u => u.user_id === recordData.unit_head_id);
        if (unitHead) {
          recipients.push({ user_id: unitHead.user_id, email: unitHead.email });
        }
      }
      break;
    
    case 'WP_REVISION_REQUESTED':
      // Notify preparer
      if (recordData.prepared_by_id) {
        const preparer = users.find(u => u.user_id === recordData.prepared_by_id);
        if (preparer) {
          recipients.push({ user_id: preparer.user_id, email: preparer.email });
        }
      }
      break;
    
    case 'AP_DUE_REMINDER':
    case 'AP_OVERDUE':
    case 'AP_REJECTED':
      // Notify action owner
      if (recordData.action_owner_id) {
        const owner = users.find(u => u.user_id === recordData.action_owner_id);
        if (owner) {
          recipients.push({ user_id: owner.user_id, email: owner.email });
        }
      }
      break;
    
    case 'AP_IMPLEMENTED':
      // Notify auditors
      users.filter(u => ['SUPER_ADMIN', 'AUDITOR'].includes(u.role_code) && u.is_active)
        .forEach(u => recipients.push({ user_id: u.user_id, email: u.email }));
      break;
  }
  
  return recipients;
}

function getModuleFromTemplate(templateCode) {
  if (templateCode.startsWith('WP_')) return 'WORK_PAPER';
  if (templateCode.startsWith('AP_')) return 'ACTION_PLAN';
  return 'SYSTEM';
}

// ============================================================
// PARSE TEMPLATE
// ============================================================
function parseTemplate(template, data) {
  if (!template) return '';
  
  let result = template;
  
  for (const [key, value] of Object.entries(data)) {
    const placeholder = `{{${key}}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value || '');
  }
  
  return result;
}

// ============================================================
// PROCESS NOTIFICATION QUEUE
// ============================================================
function processNotificationQueue() {
  try {
    const sheet = getSheet('18_NotificationQueue');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const statusIdx = headers.indexOf('status');
    const emailIdx = headers.indexOf('recipient_email');
    const subjectIdx = headers.indexOf('subject');
    const bodyIdx = headers.indexOf('body');
    const sentAtIdx = headers.indexOf('sent_at');
    const errorIdx = headers.indexOf('error_message');
    
    const fromName = getConfig('EMAIL_FROM_NAME') || 'Hass Audit System';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][statusIdx] === 'Pending') {
        const email = data[i][emailIdx];
        const subject = data[i][subjectIdx];
        const body = data[i][bodyIdx];
        
        try {
          // Send email
          MailApp.sendEmail({
            to: email,
            subject: subject,
            body: body,
            name: fromName
          });
          
          // Update status
          sheet.getRange(i + 1, statusIdx + 1).setValue('Sent');
          sheet.getRange(i + 1, sentAtIdx + 1).setValue(new Date());
          
        } catch (sendError) {
          sheet.getRange(i + 1, statusIdx + 1).setValue('Failed');
          sheet.getRange(i + 1, errorIdx + 1).setValue(sendError.message);
        }
      }
    }
  } catch (error) {
    console.error('processNotificationQueue error:', error);
  }
}

// ============================================================
// SEND DUE DATE REMINDERS (called by daily trigger)
// ============================================================
function sendDueDateReminders() {
  try {
    const reminderDays = getConfig('REMINDER_DAYS_BEFORE_DUE');
    if (!reminderDays) return;
    
    const daysArray = reminderDays.split(',').map(d => parseInt(d.trim()));
    
    const actionPlans = getSheetData('13_ActionPlans')
      .filter(ap => ap.final_status === 'Open' && ap.due_date);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    actionPlans.forEach(ap => {
      const dueDate = new Date(ap.due_date);
      dueDate.setHours(0, 0, 0, 0);
      
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      if (daysArray.includes(daysUntilDue)) {
        queueNotification('AP_DUE_REMINDER', ap.action_plan_id, null);
      }
    });
    
    console.log('Due date reminders processed');
  } catch (error) {
    console.error('sendDueDateReminders error:', error);
  }
}

// ============================================================
// SEND OVERDUE REMINDERS (called by daily trigger)
// ============================================================
function sendOverdueReminders() {
  try {
    const intervalDays = getConfig('OVERDUE_REMINDER_INTERVAL_DAYS') || 7;
    
    const actionPlans = getSheetData('13_ActionPlans')
      .filter(ap => ap.final_status === 'Open' && ap.status === 'Not Implemented' && ap.days_overdue > 0);
    
    actionPlans.forEach(ap => {
      // Send reminder if days overdue is multiple of interval
      if (ap.days_overdue % intervalDays === 0) {
        queueNotification('AP_OVERDUE', ap.action_plan_id, null);
      }
    });
    
    console.log('Overdue reminders processed');
  } catch (error) {
    console.error('sendOverdueReminders error:', error);
  }
}

// ============================================================
// DAILY TRIGGER FUNCTION
// ============================================================
function dailyMaintenance() {
  console.log('Running daily maintenance...');
  
  // Update overdue status
  updateOverdueStatus();
  
  // Send reminders
  sendDueDateReminders();
  sendOverdueReminders();
  
  // Process any pending notifications
  processNotificationQueue();
  
  console.log('Daily maintenance complete');
}

// ============================================================
// SETUP TRIGGERS
// ============================================================
function setupTriggers() {
  // Remove existing triggers
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'dailyMaintenance') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create daily trigger at 6 AM
  ScriptApp.newTrigger('dailyMaintenance')
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();
  
  console.log('Daily maintenance trigger created');
}
