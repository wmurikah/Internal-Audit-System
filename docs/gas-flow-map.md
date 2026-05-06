# GAS Codebase Flow Map — Internal Audit System

Generated: 2026-05-06  
Source: `/home/user/Internal-Audit-System/*.gs` + `db/schema.sql`

---

## Section 1 — .gs File Inventory

| File | Purpose |
|------|---------|
| `00_FirestoreService.gs` | Sole Firestore integration layer: JWT auth, token caching, HTTP CRUD helpers, value encoding/decoding, batch write, `system_settings` helpers, and collection/docId maps. |
| `01_Core.gs` | Core framework: `DB` query object, `Cache` wrapper, `Security` helpers, `getSheetData()` Firestore collection reader, audit logging, permission checking, and input sanitization utilities. |
| `02_Config.gs` | All application constants: `SHEETS`, `SCHEMAS`, `STATUS` enum objects, `ROLES`, `ROLE_PERMISSIONS` matrix, dropdown builder functions, and ID generation via Firestore counter. |
| `03_WorkPaperService.gs` | Work paper CRUD and full workflow (create → submit → review → approve → send-to-auditee), plus requirements, file attachments, and revision history. |
| `04_ActionPlanService.gs` | Action plan CRUD and workflow (create → implement → verify → HOA review → close), overdue status sweeper, delegation, evidence uploads, and history logging. |
| `05_AIService.gs` | AI integration layer: routes calls to OpenAI, Anthropic, or Google AI; provides work paper insights, action plan quality scoring, analytics interpretation, and auditee response auto-evaluation. |
| `05_NotificationService.gs` | Notification queue writer (`queueNotification`), Microsoft Graph API email sender with MailApp fallback, digest processor (`processEmailQueue`), stale-assignment reminder sweeper, and email template renderer. |
| `06_DashboardService.gs` | Dashboard data orchestration: sidebar counts, summary stats, cached dashboard summary in `00_Config`, comprehensive report data, and analytics aggregations. |
| `07_AuthService.gs` | Authentication and user management: login, session creation/validation/invalidation, user CRUD, password management, failed-attempt tracking, and privacy-consent recording. |
| `08_WebApp.gs` | HTTP entry points (`doGet`/`doPost`), API router (`routeAction`), file upload handler, server-side rendering bootstrap, and JSON response utilities. |
| `09_AnalyticsService.gs` | Analytics data aggregation by year, user stats, audit log retrieval, CSV export for work papers and action plans, and system config value management. |
| `10_AuditeeService.gs` | Auditee-facing functions: finding retrieval, draft/submit/review of responses, action plan creation by auditees, delegation acceptance/rejection, and pending-response views for auditors. |
| `11_DropdownService.gs` | SUPER_ADMIN-only CRUD for system dropdown collections (audit areas, sub-areas, affiliates, config-based dropdowns) with reference checking before delete and display-order management. |

---

## Section 2 — Firestore Read/Write Functions

### `00_FirestoreService.gs`

| Function | Operation | Collection(s) | Fields Read / Written | Status Literals Used |
|----------|-----------|--------------|----------------------|---------------------|
| `firestoreGet(sheetName, docId)` | Read | Any via `FIRESTORE_COLLECTIONS` map | All fields of target document | — |
| `firestoreGetAll(sheetName)` | Read | Any | All fields | — |
| `firestoreQuery(sheetName, field, op, value)` | Read | Any | All fields matching query | — |
| `firestoreSet(sheetName, docId, data)` | Write | Any | All fields in `data` object | — |
| `firestoreUpdate(sheetName, docId, updates)` | Write (partial) | Any | Only fields in `updates` | — |
| `firestoreDelete(sheetName, docId)` | Delete | Any | — | — |
| `firestoreBatchWrite(writes[])` | Write | Any (array of targets) | Per-write fields | — |
| `firestoreGetSystemSettings(key)` | Read | `system_settings` (NOT in `FIRESTORE_COLLECTIONS`) | `counters`, `dashboard_summary` documents | — |
| `firestoreSetSystemSettings(key, data)` | Write | `system_settings` | All fields in `data` | — |
| `syncToFirestore(sheetName, docId, data)` | Write (alias for `firestoreSet`) | Any | All fields in `data` | — |
| `deleteFromFirestore(sheetName, docId)` | Delete (alias) | Any | — | — |

**Collection map** (`FIRESTORE_COLLECTIONS`):

| Sheet Key | Firestore Collection |
|-----------|---------------------|
| `05_Users` | `users` |
| `06_Affiliates` | `affiliates` |
| `07_AuditAreas` | `audit_areas` |
| `08_ProcessSubAreas` | `sub_areas` |
| `09_WorkPapers` | `work_papers` |
| `10_WorkPaperRequirements` | `wp_requirements` |
| `11_WorkPaperFiles` | `wp_files` |
| `12_WorkPaperRevisions` | `wp_revisions` |
| `13_ActionPlans` | `action_plans` |
| `14_ActionPlanEvidence` | `ap_evidence` |
| `15_ActionPlanHistory` | `ap_history` |
| `20_Sessions` | `sessions` |
| `00_Config` | `config` |
| `01_Roles` | `roles` |
| `02_Permissions` | `permissions` |
| `16_AuditLog` | `audit_log` |
| `21_NotificationQueue` | `notification_queue` |
| `22_EmailTemplates` | `email_templates` |
| `24_AuditeeResponses` | `auditee_responses` |

---

### `01_Core.gs`

| Function | Operation | Collection | Fields |
|----------|-----------|-----------|--------|
| `getSheetData(sheetName)` | Read | Any | All (converts to `[[headers],[rows]]`) |
| `logAudit(action, entityType, entityId, oldData, newData, user)` | Write | `16_AuditLog` | `log_id, action, entity_type, entity_id, old_data, new_data, user_id, user_email, timestamp, ip_address` |
| `setConfig(key, value)` | Write | `00_Config` | `config_key, config_value, updated_at` |
| `getConfigValue(key)` | Read | `00_Config` | `config_key, config_value` |

---

### `02_Config.gs`

| Function | Operation | Collection | Fields |
|----------|-----------|-----------|--------|
| `generateId(prefix)` | Read + Write | `00_Config` | `config_key` (`ID_COUNTER_<PREFIX>`), `config_value` (counter integer), `updated_at` |
| `generateIds(prefix, count)` | Read + Write | `00_Config` | Same counter field with block allocation |
| `getAffiliatesDropdown()` | Read | `06_Affiliates` | `affiliate_code, affiliate_name, is_active` |
| `getAuditAreasDropdown()` | Read | `07_AuditAreas` | `area_id, area_code, area_name, is_active, display_order` |
| `getSubAreasDropdown()` | Read | `08_ProcessSubAreas` | `sub_area_id, area_id, sub_area_code, sub_area_name, is_active, display_order` |
| `getUsersDropdown()` | Read | `05_Users` | `user_id, full_name, email, role_code, is_active` |
| `getRiskRatings()` | Read | `00_Config` | `config_key` = `DROPDOWN_RISK_RATINGS`, `config_value` |
| `getControlClassifications()` | Read | `00_Config` | `config_key` = `DROPDOWN_CONTROL_CLASSIFICATIONS` |
| `getControlTypes()` | Read | `00_Config` | `config_key` = `DROPDOWN_CONTROL_TYPES` |
| `getControlFrequencies()` | Read | `00_Config` | `config_key` = `DROPDOWN_CONTROL_FREQUENCIES` |

---

### `03_WorkPaperService.gs`

| Function | Operation | Collection | Fields Written | Status Literals Used |
|----------|-----------|-----------|---------------|---------------------|
| `createWorkPaper(data, user)` | Write | `09_WorkPapers` | Full schema from `SCHEMAS.WORK_PAPERS`: `work_paper_id, work_paper_ref, affiliate_code, audit_area_id, sub_area_id, observation_title, criteria, condition, cause, effect, risk_rating, control_classification, control_type, control_frequency, recommendation, management_comment, responsible_ids, cc_recipients, owner_ids, audit_period_from, audit_period_to, assigned_auditor_id, status, created_by, created_at, updated_at` | `status: 'Draft'` |
| `getWorkPapers(filters, user)` | Read | `09_WorkPapers` | All fields | Filters on `'Draft','Submitted','Under Review','Revision Required','Approved','Sent to Auditee'` |
| `getWorkPaper(workPaperId)` | Read | `09_WorkPapers`, `10_WorkPaperRequirements`, `11_WorkPaperFiles`, `12_WorkPaperRevisions` | All fields | — |
| `updateWorkPaper(workPaperId, data, user)` | Read + Write | `09_WorkPapers` | Updated fields + `updated_at` | Checks `editableStatuses = ['Draft','Revision Required']` |
| `deleteWorkPaper(workPaperId, user)` | Read + Delete | `09_WorkPapers` | — | Checks `existing.status !== 'Draft'` |
| `submitWorkPaper(workPaperId, user)` | Read + Write | `09_WorkPapers`, `12_WorkPaperRevisions`, `16_AuditLog` | `status, updated_at`; `revision_id, work_paper_id, revision_number, action, comments, user_id, user_name, action_date` | Sets `status: 'Submitted'` |
| `reviewWorkPaper(workPaperId, action, comments, user)` | Read + Write | `09_WorkPapers`, `12_WorkPaperRevisions`, `16_AuditLog` | `status, reviewed_by, reviewed_at, review_comments, updated_at` | Sets `'Approved'`, `'Revision Required'`, or `'Under Review'` via `transitionMap` |
| `sendToAuditee(workPaperId, user)` | Read + Write | `09_WorkPapers` | `status, final_status, response_status, sent_to_auditee_at, sent_by, updated_at` | Sets `status: 'Sent to Auditee'`, `final_status: 'Sent to Auditee'`, `response_status: 'Pending Response'` |
| `batchSendToAuditees(workPaperIds, user)` | Read + Write | `09_WorkPapers` | Same as `sendToAuditee` | Same literals: `'Sent to Auditee'`, `'Pending Response'` |
| `getAutoPopulateData()` | Read | `09_WorkPapers` | `status, audit_area_id, sub_area_id, affiliate_code` | Checks `completedStatuses = ['Approved','Sent to Auditee']` |
| `getWorkPaperCounts(filters, user)` | Read | `09_WorkPapers` | `status` | Counts by `'Draft','Submitted','Under Review','Revision Required','Approved','Sent to Auditee'` |
| `addWorkPaperRequirement(workPaperId, data, user)` | Write | `10_WorkPaperRequirements` | `requirement_id, work_paper_id, requirement_text, status, assigned_to, due_date, created_by, created_at` | `status: data.status \|\| 'Pending'` |
| `updateWorkPaperRequirement(requirementId, data, user)` | Write | `10_WorkPaperRequirements` | Updated fields + `updated_at` | — |
| `deleteWorkPaperRequirement(requirementId, user)` | Delete | `10_WorkPaperRequirements` | — | — |
| `addWorkPaperFile(workPaperId, data, user)` | Write | `11_WorkPaperFiles` | `file_id, work_paper_id, file_category, file_name, file_description, drive_file_id, drive_url, file_size, mime_type, uploaded_by, uploaded_at` | — |
| `deleteWorkPaperFile(fileId, user)` | Delete | `11_WorkPaperFiles` | — | — |
| `addWorkPaperRevision(workPaperId, action, comments, user)` | Write | `12_WorkPaperRevisions` | `revision_id, work_paper_id, revision_number, action, comments, changes_summary, user_id, user_name, action_date` | — |
| `requestWorkPaperChange(data, user)` | Write | `09_WorkPapers`, `12_WorkPaperRevisions` | `status, updated_at`; revision fields | — |

---

### `04_ActionPlanService.gs`

| Function | Operation | Collection | Fields Written | Status Literals Used |
|----------|-----------|-----------|---------------|---------------------|
| `createActionPlan(data, user)` | Read + Write | `13_ActionPlans` | `action_plan_id, work_paper_id, action_description, responsible_party, owner_ids, due_date, priority, status, auditee_proposed, created_by, created_by_role, created_at, updated_at` | Sets `status: 'Not Due'` or `'Pending'`; reads WP checks `workPaper.status !== 'Sent to Auditee'` |
| `createActionPlansBatch(workPaperId, plans, user)` | Write | `13_ActionPlans` | Same as above, batched | Same initial statuses |
| `getActionPlans(filters, user)` | Read | `13_ActionPlans` | All fields | Filters on `'Not Due','Pending','In Progress','Implemented','Pending Verification','Verified','Overdue','Closed','Rejected','Not Implemented'` |
| `getActionPlan(actionPlanId)` | Read | `13_ActionPlans`, `14_ActionPlanEvidence`, `15_ActionPlanHistory` | All fields | — |
| `getActionPlansRaw(filters, user)` | Read | `13_ActionPlans` | All fields | `viewableStatuses = ['Implemented','Verified','Closed']` for BOARD_MEMBER/EXTERNAL_AUDITOR |
| `updateActionPlan(actionPlanId, data, user)` | Read + Write | `13_ActionPlans` | Updated fields + `updated_at` | Checks `editableStatuses` |
| `deleteActionPlan(actionPlanId, user)` | Read + Delete | `13_ActionPlans`, `14_ActionPlanEvidence`, `15_ActionPlanHistory` | — | Checks `deletableStatuses = ['Not Due','Pending','In Progress']` |
| `markAsImplemented(actionPlanId, notes, user)` | Read + Write | `13_ActionPlans`, `15_ActionPlanHistory` | `status, implementation_notes, implemented_at, updated_at` | Sets `status: 'Pending Verification'` |
| `verifyImplementation(actionPlanId, action, comments, user)` | Read + Write | `13_ActionPlans`, `15_ActionPlanHistory` | `status, auditor_review_status, verified_by, verified_at, rejection_reason, updated_at` | 'approve'→`'Verified'`, `auditor_review_status:'Approved'`; 'reject'→`'Rejected'`, `auditor_review_status:'Rejected'`; 'return'→`'In Progress'`, `auditor_review_status:'Returned for Revision'` |
| `hoaReview(actionPlanId, action, comments, user)` | Read + Write | `13_ActionPlans`, `15_ActionPlanHistory` | `status, hoa_review_status, hoa_reviewed_by, hoa_reviewed_at, updated_at` | 'approve'→`hoa_review_status:'Approved'`, `status:'Closed'`; 'reject'→`hoa_review_status:'Rejected'`, `status:'In Progress'` |
| `updateOverdueStatuses()` | Read + Write | `13_ActionPlans` | `status, updated_at` | `activeStatuses = ['Not Due','Pending','In Progress']`; sets `'Overdue'` or `'Pending'` |
| `delegateActionPlan(actionPlanId, newOwnerIds, newOwnerNames, notes, user)` | Read + Write | `13_ActionPlans` | `owner_ids, owner_names, delegation_notes, delegated_by, delegated_at, updated_at` | `closedStatuses = ['Verified','Closed','Not Implemented']` |
| `addActionPlanEvidence(actionPlanId, data, user)` | Write | `14_ActionPlanEvidence` | `evidence_id, action_plan_id, file_name, file_description, drive_file_id, drive_url, file_size, mime_type, uploaded_by, uploaded_at` | — |
| `addActionPlanHistory(actionPlanId, previousStatus, newStatus, comments, user)` | Write | `15_ActionPlanHistory` | `history_id, action_plan_id, previous_status, new_status, comments, user_id, user_name, changed_at` | Passes through whatever status strings the callers use |

---

### `05_AIService.gs`

| Function | Operation | Collection | Fields |
|----------|-----------|-----------|--------|
| `getWorkPaperInsights(workPaperId, user)` | Read + Write | `09_WorkPapers`, `16_AuditLog` | Reads WP fields; writes audit log |
| `validateActionPlan(actionPlanId, user)` | Read | `13_ActionPlans` | All fields |
| `getAnalyticsInsights(data, user)` | Read | `09_WorkPapers`, `13_ActionPlans` | Aggregated data passed to AI |
| `evaluateAuditeeResponse(workPaperId, responseText, user)` | Read + Write | `09_WorkPapers`, `24_AuditeeResponses` | May write `response_status: STATUS.RESPONSE.REJECTED` = `'Response Rejected'` on auto-rejection |
| `setAIApiKey(provider, apiKey, user)` | Write | `00_Config` | `config_key` (`AI_API_KEY_<PROVIDER>`), `config_value`, `updated_at` |
| `removeAIApiKey(provider, user)` | Delete | `00_Config` | `config_key` |

---

### `05_NotificationService.gs`

| Function | Operation | Collection | Fields Written | Status Literals Used |
|----------|-----------|-----------|---------------|---------------------|
| `queueNotification(params)` | Write | `21_NotificationQueue` | `notification_id, batch_type, priority, recipient_user_id, recipient_email, cc, subject, body, data (JSON), status, created_at, sent_at` | Sets `status: 'Pending'` (`STATUS.NOTIFICATION.PENDING`) |
| `queueEmail(data)` | Write | `21_NotificationQueue` | Same as `queueNotification` | Sets `status: 'Pending'` |
| `queueTemplatedEmail(templateCode, recipient, data)` | Read + Write | `22_EmailTemplates`, `21_NotificationQueue` | Reads template; writes notification record | Sets `status: 'Pending'` |
| `processEmailQueue()` | Read + Write | `21_NotificationQueue` | `status, sent_at` (on success); `status, error_message` (on failure) | Reads `status === 'Pending'`; sets `'Sent'` or `'Failed'` |
| `sendEmail(to, subject, body, htmlBody, cc, fromName, replyTo)` | — (HTTP) | — | Microsoft Graph API or MailApp | — |
| `sendEmailViaOutlook(to, subject, htmlBody, cc, fromName, replyTo)` | — (HTTP) | `00_Config` (reads Graph token config) | — | — |
| `queueHoaCcNotifications(params, excludeUserId)` | Read + Write | `05_Users`, `21_NotificationQueue` | Reads SUPER_ADMIN users; writes notification records | — |
| `sendStaleAssignmentReminders()` | Read + Write | `09_WorkPapers`, `21_NotificationQueue` | Reads WPs with `status === 'Draft'`; writes notification records | `'Draft'` |
| `getEmailTemplate(templateCode)` | Read | `22_EmailTemplates` | `template_code, subject, body, is_active` | — |
| `getEmailTemplates()` | Read | `22_EmailTemplates` | All fields | — |

---

### `06_DashboardService.gs`

| Function | Operation | Collection | Fields | Status Literals |
|----------|-----------|-----------|--------|----------------|
| `getDashboardData(user)` | Read (orchestrator) | `09_WorkPapers`, `13_ActionPlans`, `07_AuditAreas`, `05_Users` | All | Delegates to sub-functions below |
| `getSidebarCounts(user)` | Read | `09_WorkPapers`, `13_ActionPlans` | `status, response_status, assigned_auditor_id, responsible_ids` | `'Submitted','Approved','Sent to Auditee','Draft','Response Submitted'` |
| `getSummaryStats(user)` | Read | `09_WorkPapers`, `13_ActionPlans` | `status` | All `STATUS.WORK_PAPER.*` and `STATUS.ACTION_PLAN.*` literals |
| `updateDashboardSummary_WPStatus(workPaperId, oldStatus, newStatus)` | Read + Write | `00_Config` | `config_key` = `dashboard_summary`, `config_value` (JSON) | `'Draft','Submitted','Under Review','Revision Required','Approved','Sent to Auditee'` |
| `updateDashboardSummary_APStatus(actionPlanId, oldStatus, newStatus)` | Read + Write | `00_Config` | Same doc | All AP status literals |
| `rebuildDashboardSummary()` | Read + Write | `09_WorkPapers`, `13_ActionPlans`, `00_Config` | Counts all; writes `dashboard_summary` | All status literals |
| `getComprehensiveReportData(filters, user)` | Read | `09_WorkPapers`, `13_ActionPlans`, `07_AuditAreas` | All | `'Extreme','High','Medium','Low'` (risk); all status literals |
| `isImplementedOrVerified(status)` | — (helper) | — | — | `'Implemented','Verified','Not Implemented','Closed','Rejected'` |

---

### `07_AuthService.gs`

| Function | Operation | Collection | Fields Written | Status Literals |
|----------|-----------|-----------|---------------|----------------|
| `login(email, password)` | Read + Write | `05_Users`, `20_Sessions` | Reads user; calls `createSession` | — |
| `createSession(user)` | Write | `20_Sessions` | `session_id, user_id, session_token (raw plaintext), created_at, expires_at, ip_address, user_agent, is_valid: true` | — |
| `validateSession(token)` | Read | `20_Sessions` | `session_token, is_valid, expires_at` | — |
| `getSessionByToken(token)` | Read | `20_Sessions` | Queries on `session_token` field (raw, unhashed) | — |
| `invalidateSession(sessionId)` | Write | `20_Sessions` | `is_valid: false, updated_at` | — |
| `createUser(userData, adminUser)` | Write | `05_Users` | `user_id, email, full_name, role_code, affiliate_code, department, password_hash, is_active: true, must_change_password, created_at, updated_at` | — |
| `updateUser(userId, data, adminUser)` | Read + Write | `05_Users` | Updated fields + `updated_at` | — |
| `updateUserProfile(data, user)` | Write | `05_Users` | `full_name, department, updated_at` | — |
| `changePassword(userId, currentPw, newPw)` | Read + Write | `05_Users` | `password_hash, must_change_password: false, updated_at` | — |
| `resetPassword(userId, adminUser)` | Write | `05_Users` | `password_hash, must_change_password: true, updated_at` | — |
| `forgotPassword(email)` | Read + Write | `05_Users`, `21_NotificationQueue` | Reads user; queues reset email | — |
| `deactivateUser(userId, adminUser)` | Write | `05_Users` | `is_active: false, updated_at` | — |
| `incrementFailedAttempts(userId)` | Write | `05_Users` | `login_attempts, locked_until` | — |
| `resetFailedAttempts(userId)` | Write | `05_Users` | `login_attempts: 0, locked_until: ''` | — |
| `updateLastLogin(userId)` | Write | `05_Users` | `last_login` | — |
| `postLoginCleanup(data)` | Write | `05_Users` | `login_attempts: 0, locked_until: '', last_login` | — |
| `acceptPrivacyConsent(data, user)` | Write | `05_Users` | `privacy_consent_accepted: 'true', privacy_consent_date, privacy_consent_version` | — |
| `logAudit(action, entity, id, old, new, user)` | Write | `16_AuditLog` | `log_id, action, entity_type, entity_id, old_data, new_data, user_id, user_email, timestamp, ip_address` | — |
| `getUserByIdCached(userId)` | Read | `05_Users` | All fields (with CacheService wrapper) | — |

---

### `09_AnalyticsService.gs`

| Function | Operation | Collection | Fields | Status Literals |
|----------|-----------|-----------|--------|----------------|
| `getAnalyticsData(year, user)` | Read | `09_WorkPapers`, `13_ActionPlans` | All | `'Draft','Submitted','Under Review','Approved','Sent to Auditee','Implemented','Verified','Overdue','Extreme','High'` |
| `getUserStats(user)` | Read | `05_Users` | `role_code, is_active, created_at` | — |
| `getAuditLogs(filters, user)` | Read | `16_AuditLog` | All fields | — |
| `exportWorkPapersCSV(filters, user)` | Read | `09_WorkPapers` | All fields | — |
| `exportActionPlansCSV(filters, user)` | Read | `13_ActionPlans` | All fields | — |
| `saveSystemConfigValues(values, user)` | Write | `00_Config` | `config_key, config_value, updated_at` | — |

---

### `10_AuditeeService.gs`

| Function | Operation | Collection | Fields Written | Status Literals |
|----------|-----------|-----------|---------------|----------------|
| `getAuditeeFindings(user)` | Read | `09_WorkPapers` | All | Filters `wp.status !== 'Sent to Auditee'`; sorts by `'Pending Response','Draft Response','Response Rejected'` |
| `getPendingAuditeeResponsesForAuditor(user)` | Read | `09_WorkPapers` | `status, response_status, responsible_ids` | `'Sent to Auditee','Response Submitted'` |
| `saveDraftResponse(workPaperId, responseText, user)` | Write | `09_WorkPapers` | `response_status, draft_response_text, draft_saved_at, updated_at` | Sets `response_status: 'Draft Response'` |
| `submitAuditeeResponse(workPaperId, responseText, attachments, user)` | Write | `24_AuditeeResponses`, `09_WorkPapers`, `13_ActionPlans` | Response: `response_id, work_paper_id, response_text, status, submitted_by, submitted_at`; WP: `response_status, response_submitted_at` | Response record: `status: 'Pending Review'`; WP: `response_status: 'Response Submitted'` |
| `reviewAuditeeResponse(action, responseId, workPaperId, comments, user)` | Read + Write | `24_AuditeeResponses`, `09_WorkPapers` | Response: `status, reviewed_by, reviewed_at, review_comments`; WP: `response_status` | 'accept'→response `'Approved'`, WP `'Response Accepted'`; 'reject'→response `'Rejected'`, WP `'Response Rejected'` or `'Escalated'` |
| `createAuditeeActionPlan(workPaperId, planData, user)` | Write | `13_ActionPlans` | Same as `createActionPlan` + `auditee_proposed: true, created_by_role` | — |
| `respondToDelegation(actionPlanId, action, user)` | Read + Write | `13_ActionPlans` | `delegation_accepted`, `delegation_rejected`, `owner_ids` (revert on reject) | — |
| `getResponseHistory(workPaperId)` | Read | `24_AuditeeResponses` | All fields | — |

---

### `11_DropdownService.gs`

| Function | Operation | Collection | Fields Written |
|----------|-----------|-----------|---------------|
| `getDropdownItems(params, user)` | Read | `07_AuditAreas`, `08_ProcessSubAreas`, `06_Affiliates`, `00_Config` | All fields |
| `createDropdownItem(params, user)` | Write | `07_AuditAreas` or `08_ProcessSubAreas` or `06_Affiliates` | Area: `area_id, area_code, area_name, description, is_active, display_order`; Sub: `sub_area_id, area_id, sub_area_code, sub_area_name, control_objectives, risk_description, test_objective, testing_steps, is_active, display_order`; Affiliate: `affiliate_code, affiliate_name, country, region, is_active, display_order` |
| `updateDropdownItem(params, user)` | Read + Write | `07_AuditAreas`, `08_ProcessSubAreas`, or `06_Affiliates` | Merged with existing + `updated_at` |
| `deleteDropdownItem(params, user)` | Read + Delete | Any of the above; reads `09_WorkPapers`, `05_Users` for ref checks | — |
| `updateDropdownOrder(params, user)` | Read + Write | Any dropdown collection | `display_order, updated_at` |
| `saveConfigDropdown(params, user)` | Write | `00_Config` | `config_key, config_value (JSON array), description, updated_at` |

---

## Section 3 — UI Dropdown / Status Fields with Hardcoded Options

### Work Paper Status (`STATUS.WORK_PAPER`)
Defined in `02_Config.gs`. Used in filters, workflow guards, and writes throughout:
```
'Draft'  |  'Submitted'  |  'Under Review'  |  'Revision Required'  |  'Approved'  |  'Sent to Auditee'
```

### Action Plan Status (`STATUS.ACTION_PLAN`)
Defined in `02_Config.gs`:
```
'Not Due'  |  'Pending'  |  'In Progress'  |  'Overdue'  |  'Implemented'
'Pending Verification'  |  'Verified'  |  'Rejected'  |  'Not Implemented'  |  'Closed'
```

### Response Status (`STATUS.RESPONSE`)
Defined in `02_Config.gs`; written to `work_papers.response_status`:
```
'Pending Response'  |  'Draft Response'  |  'Response Submitted'
'Response Accepted'  |  'Response Rejected'  |  'Escalated'
```

### Review Status (`STATUS.REVIEW`)
Defined in `02_Config.gs`; written to `auditee_responses.status`:
```
'Pending Review'  |  'Approved'  |  'Rejected'  |  'Returned for Revision'
```

### Notification Status (`STATUS.NOTIFICATION`)
Defined in `02_Config.gs`; written to `notification_queue.status`:
```
'Pending'  |  'Sent'  |  'Failed'  |  'Batched'
```

### Risk Rating
Config-driven via `getRiskRatings()` (default hardcoded in `02_Config.gs`):
```
'Extreme'  |  'High'  |  'Medium'  |  'Low'
```

### Control Classification
Config-driven via `getControlClassifications()`:
```
'Preventive'  |  'Detective'  |  'Corrective'  |  'Directive'
```

### Control Type
Config-driven via `getControlTypes()`:
```
'Manual'  |  'Automated'  |  'IT-Dependent Manual'  |  'Hybrid'
```

### Control Frequency
Config-driven via `getControlFrequencies()`:
```
'Ad-hoc'  |  'Daily'  |  'Weekly'  |  'Monthly'  |  'Quarterly'  |  'Semi-Annual'  |  'Annual'
```

### Requirement Status
Hardcoded default in `addWorkPaperRequirement`:
```
'Pending'  |  'Provided'  |  'N/A'
```

### Roles Dropdown
Config-driven via `getRolesDropdown()` — reads from `01_Roles` collection. Role codes:
```
'SUPER_ADMIN'  |  'HEAD_OF_AUDIT'  |  'SENIOR_AUDITOR'  |  'JUNIOR_STAFF'
'BOARD_MEMBER'  |  'EXTERNAL_AUDITOR'  |  'AUDITEE'
```

### Year Options
Computed by `getYearOptions()` — current year ± 3 (no hardcoded values).

### Priority (Notification Queue)
Not defined in `02_Config.gs`; only referenced in `queueNotification` via `params.priority`:
```
'urgent'  |  'normal'  |  'low'   (implied by new schema CHECK constraint)
```

---

## Section 4 — Email Notification Functions

### Notification Types (`05_NotificationService.gs`)

```
NOTIFICATION_TYPES = {
  WP_SUBMITTED:           'WP_SUBMITTED'
  WP_ASSIGNED:            'WP_ASSIGNED'
  WP_APPROVED:            'WP_APPROVED'
  WP_REVISION_REQUIRED:   'WP_REVISION_REQUIRED'
  WP_SENT_TO_AUDITEE:     'WP_SENT_TO_AUDITEE'
  AP_CREATED:             'AP_CREATED'
  AP_OVERDUE:             'AP_OVERDUE'
  AP_IMPLEMENTED:         'AP_IMPLEMENTED'
  AP_VERIFIED:            'AP_VERIFIED'
  AP_REJECTED:            'AP_REJECTED'
  RESPONSE_SUBMITTED:     'RESPONSE_SUBMITTED'
  RESPONSE_ACCEPTED:      'RESPONSE_ACCEPTED'
  RESPONSE_REJECTED:      'RESPONSE_REJECTED'
  STALE_REMINDER:         'WP_STALE_REMINDER'
  DELEGATION:             'AP_DELEGATION'
}
```

### Trigger → Recipient → Status Transition Map

| Trigger Function | Email Notification Type | Recipient Fields | Status Transition That Triggers Email |
|-----------------|------------------------|-----------------|--------------------------------------|
| `submitWorkPaper()` (`03_WorkPaperService.gs`) | `WP_SUBMITTED` | `assigned_auditor_id` (reviewer); CC: HOA (SUPER_ADMIN) | `'Draft'` → `'Submitted'` |
| `reviewWorkPaper()` – approve (`03_WorkPaperService.gs`) | `WP_APPROVED` | `created_by` (submitting auditor); CC: HOA | `'Under Review'` → `'Approved'` |
| `reviewWorkPaper()` – revision (`03_WorkPaperService.gs`) | `WP_REVISION_REQUIRED` | `created_by`; CC: HOA | `'Under Review'` → `'Revision Required'` |
| `sendToAuditee()` (`03_WorkPaperService.gs`) | `WP_SENT_TO_AUDITEE` | `responsible_ids` (auditee contacts); CC: `cc_recipients` | `'Approved'` → `'Sent to Auditee'` |
| `batchSendToAuditees()` (`03_WorkPaperService.gs`) | `WP_SENT_TO_AUDITEE` (per WP) | Same as `sendToAuditee` | Same transition |
| `createActionPlan()` (`04_ActionPlanService.gs`) | `AP_CREATED` | `owner_ids` (responsible party); CC: HOA | Initial creation |
| `updateOverdueStatuses()` (`04_ActionPlanService.gs`) | `AP_OVERDUE` | `owner_ids`; CC: HOA | Calculated overdue: `'Not Due'/'Pending'/'In Progress'` → `'Overdue'` |
| `markAsImplemented()` (`04_ActionPlanService.gs`) | `AP_IMPLEMENTED` | `assigned_auditor_id` (verifier); CC: HOA | `'In Progress'` → `'Pending Verification'` |
| `verifyImplementation()` – approve (`04_ActionPlanService.gs`) | `AP_VERIFIED` | `owner_ids`; CC: HOA | `'Pending Verification'` → `'Verified'` |
| `verifyImplementation()` – reject (`04_ActionPlanService.gs`) | `AP_REJECTED` | `owner_ids`; CC: HOA | `'Pending Verification'` → `'Rejected'` |
| `submitAuditeeResponse()` (`10_AuditeeService.gs`) | `RESPONSE_SUBMITTED` | `assigned_auditor_id`; CC: HOA | `response_status` → `'Response Submitted'` |
| `reviewAuditeeResponse()` – accept (`10_AuditeeService.gs`) | `RESPONSE_ACCEPTED` | `responsible_ids` (auditee); CC: HOA | `response_status` → `'Response Accepted'` |
| `reviewAuditeeResponse()` – reject (`10_AuditeeService.gs`) | `RESPONSE_REJECTED` | `responsible_ids`; CC: HOA | `response_status` → `'Response Rejected'` or `'Escalated'` |
| `delegateActionPlan()` (`04_ActionPlanService.gs`) | `DELEGATION` | New `owner_ids`; CC: original owner | Any non-closed status → delegation |
| `sendStaleAssignmentReminders()` (`05_NotificationService.gs`) | `STALE_REMINDER` | `assigned_auditor_id`; CC: HOA | Time-based trigger: WP `'Draft'` for > 3 days |
| `createUser()` (`07_AuthService.gs`) | Template: `WELCOME` | `user.email` (new user only — no CC) | User creation |
| `forgotPassword()` (`07_AuthService.gs`) | Template: `PASSWORD_RESET` | `user.email` (no CC) | Password reset request |
| `resetPassword()` (`07_AuthService.gs`) | Template: `RESET_PASSWORD` | `user.email` (no CC) | Admin-forced reset |

**HOA CC mechanism**: `queueHoaCcNotifications()` queries `05_Users` for all `role_code === 'SUPER_ADMIN'` users and queues a separate notification for each, excluding the triggering user. HOA CC is suppressed for `WELCOME`, `PASSWORD_RESET`, `RESET_PASSWORD`, `NEW_USER` template codes.

---

## Section 5 — GAS Function → Firestore Collection → New Turso Table

| GAS Function | Firestore Collection (Sheet Key) | New Turso Table |
|-------------|----------------------------------|----------------|
| `createWorkPaper` | `09_WorkPapers` | `work_papers` |
| `updateWorkPaper` | `09_WorkPapers` | `work_papers` |
| `deleteWorkPaper` | `09_WorkPapers` | `work_papers` |
| `submitWorkPaper` | `09_WorkPapers`, `12_WorkPaperRevisions`, `16_AuditLog` | `work_papers`, `work_paper_revisions`, `audit_log` |
| `reviewWorkPaper` | `09_WorkPapers`, `12_WorkPaperRevisions`, `16_AuditLog` | `work_papers`, `work_paper_revisions`, `audit_log` |
| `sendToAuditee` | `09_WorkPapers` | `work_papers` |
| `batchSendToAuditees` | `09_WorkPapers` | `work_papers` |
| `getWorkPapers` | `09_WorkPapers` | `work_papers` |
| `getWorkPaper` | `09_WorkPapers`, `10_WorkPaperRequirements`, `11_WorkPaperFiles`, `12_WorkPaperRevisions` | `work_papers`, `wp_requirements`, `files`/`file_attachments`, `work_paper_revisions` |
| `addWorkPaperRequirement` | `10_WorkPaperRequirements` | `wp_requirements` |
| `updateWorkPaperRequirement` | `10_WorkPaperRequirements` | `wp_requirements` |
| `deleteWorkPaperRequirement` | `10_WorkPaperRequirements` | `wp_requirements` |
| `addWorkPaperFile` | `11_WorkPaperFiles` | `files` + `file_attachments` |
| `deleteWorkPaperFile` | `11_WorkPaperFiles` | `files` / `file_attachments` |
| `addWorkPaperRevision` | `12_WorkPaperRevisions` | `work_paper_revisions` |
| `createActionPlan` | `13_ActionPlans` | `action_plans` |
| `createActionPlansBatch` | `13_ActionPlans` | `action_plans` |
| `updateActionPlan` | `13_ActionPlans` | `action_plans` |
| `deleteActionPlan` | `13_ActionPlans`, `14_ActionPlanEvidence`, `15_ActionPlanHistory` | `action_plans`, `file_attachments`, `action_plan_history` |
| `markAsImplemented` | `13_ActionPlans`, `15_ActionPlanHistory` | `action_plans`, `action_plan_history` |
| `verifyImplementation` | `13_ActionPlans`, `15_ActionPlanHistory` | `action_plans`, `action_plan_history` |
| `hoaReview` | `13_ActionPlans`, `15_ActionPlanHistory` | `action_plans`, `action_plan_history` |
| `delegateActionPlan` | `13_ActionPlans` | `action_plans` |
| `updateOverdueStatuses` | `13_ActionPlans` | `action_plans` |
| `addActionPlanEvidence` | `14_ActionPlanEvidence` | `files` + `file_attachments` |
| `addActionPlanHistory` | `15_ActionPlanHistory` | `action_plan_history` |
| `queueNotification` / `queueEmail` | `21_NotificationQueue` | `notification_queue` |
| `processEmailQueue` | `21_NotificationQueue` | `notification_queue` |
| `queueTemplatedEmail` | `22_EmailTemplates`, `21_NotificationQueue` | `email_templates`, `notification_queue` |
| `getEmailTemplate` / `getEmailTemplates` | `22_EmailTemplates` | `email_templates` |
| `login` | `05_Users`, `20_Sessions` | `users`, `sessions` |
| `createSession` | `20_Sessions` | `sessions` |
| `validateSession` / `getSessionByToken` | `20_Sessions` | `sessions` |
| `invalidateSession` | `20_Sessions` | `sessions` |
| `createUser` | `05_Users` | `users` |
| `updateUser` / `updateUserProfile` | `05_Users` | `users` |
| `changePassword` / `resetPassword` / `forgotPassword` | `05_Users` | `users` |
| `deactivateUser` | `05_Users` | `users` |
| `acceptPrivacyConsent` | `05_Users` | `users` |
| `incrementFailedAttempts` / `resetFailedAttempts` | `05_Users` | `users` |
| `logAudit` / `logAuditEvent` | `16_AuditLog` | `audit_log` |
| `getAuditLogs` | `16_AuditLog` | `audit_log` |
| `getDropdownItems` | `07_AuditAreas`, `08_ProcessSubAreas`, `06_Affiliates`, `00_Config` | `audit_areas`, `sub_areas`, `affiliates`, `config` |
| `createDropdownItem` | `07_AuditAreas`, `08_ProcessSubAreas`, or `06_Affiliates` | `audit_areas`, `sub_areas`, or `affiliates` |
| `updateDropdownItem` | Same as above | Same |
| `deleteDropdownItem` | Same + ref check on `09_WorkPapers`, `05_Users` | Same |
| `updateDropdownOrder` | Dropdown collections | Same |
| `saveConfigDropdown` | `00_Config` | `config` |
| `generateId` / `generateIds` | `00_Config` | `config` |
| `setConfig` / `getConfigValue` | `00_Config` | `config` |
| `getAffiliatesDropdown` | `06_Affiliates` | `affiliates` |
| `getAuditAreasDropdown` | `07_AuditAreas` | `audit_areas` |
| `getSubAreasDropdown` | `08_ProcessSubAreas` | `sub_areas` |
| `getUsersDropdown` | `05_Users` | `users` |
| `getWorkPaperInsights` | `09_WorkPapers`, `16_AuditLog` | `work_papers`, `audit_log` |
| `evaluateAuditeeResponse` | `09_WorkPapers`, `24_AuditeeResponses` | `work_papers`, `auditee_responses` |
| `setAIApiKey` / `removeAIApiKey` | `00_Config` | `config` |
| `getAuditeeFindings` | `09_WorkPapers` | `work_papers` |
| `saveDraftResponse` | `09_WorkPapers` | `work_papers` |
| `submitAuditeeResponse` | `24_AuditeeResponses`, `09_WorkPapers`, `13_ActionPlans` | `auditee_responses`, `work_papers`, `action_plans` |
| `reviewAuditeeResponse` | `24_AuditeeResponses`, `09_WorkPapers` | `auditee_responses`, `work_papers` |
| `createAuditeeActionPlan` | `13_ActionPlans` | `action_plans` |
| `respondToDelegation` | `13_ActionPlans` | `action_plans` |
| `getResponseHistory` | `24_AuditeeResponses` | `auditee_responses` |
| `getDashboardData` / `getSummaryStats` | `09_WorkPapers`, `13_ActionPlans`, `07_AuditAreas`, `05_Users` | Multiple tables |
| `rebuildDashboardSummary` | `09_WorkPapers`, `13_ActionPlans`, `00_Config` | `work_papers`, `action_plans`, `config` |
| `getAnalyticsData` | `09_WorkPapers`, `13_ActionPlans` | `work_papers`, `action_plans` |
| `firestoreGetSystemSettings` / `firestoreSetSystemSettings` | `system_settings` (Firestore only — NO sheet key) | **No Turso equivalent** |

---

## Section 6 — Breaking Change Flags

The following are mismatches between GAS status/field literals and the new Turso schema's CHECK constraints or column definitions. Each will cause runtime failures if not addressed before migration.

---

### FLAG-001 🔴 CRITICAL — WP Status: Mixed-Case vs UPPER_SNAKE_CASE

**Scope**: Every function that writes or filters `work_papers.status`  
**GAS writes**: `'Draft'`, `'Submitted'`, `'Under Review'`, `'Revision Required'`, `'Approved'`, `'Sent to Auditee'`  
**Turso `WP_STATUS` enum values**: `'DRAFT'`, `'SUBMITTED'`, `'UNDER_REVIEW'`, `'REVISION_REQUIRED'`, `'APPROVED'`, `'SENT_TO_AUDITEE'`, `'CLOSED'`

**Affected functions** (all write to `work_papers.status`):
- `createWorkPaper` → writes `'Draft'`
- `updateWorkPaper` → may write any status string
- `submitWorkPaper` → writes `'Submitted'`
- `reviewWorkPaper` → writes `'Approved'`, `'Revision Required'`, `'Under Review'`
- `sendToAuditee` / `batchSendToAuditees` → writes `'Sent to Auditee'`
- `updateOverdueStatuses` → writes `'Overdue'`, `'Pending'`
- `getSidebarCounts`, `getSummaryStats`, `rebuildDashboardSummary`, `getWorkPapers`, `getAnalyticsData` → filter/compare on all WP status literals

**Fix required**: Add a translation layer (e.g. `STATUS_MAP`) or update all literal values to UPPER_SNAKE_CASE before SQL INSERT/WHERE.

---

### FLAG-002 🔴 CRITICAL — AP Status: Mixed-Case vs UPPER_SNAKE_CASE

**Scope**: Every function that writes or filters `action_plans.status`  
**GAS writes**: `'Not Due'`, `'Pending'`, `'In Progress'`, `'Overdue'`, `'Implemented'`, `'Pending Verification'`, `'Verified'`, `'Rejected'`, `'Not Implemented'`, `'Closed'`  
**Turso `AP_STATUS` enum values**: `'NOT_DUE'`, `'PENDING'`, `'IN_PROGRESS'`, `'OVERDUE'`, `'IMPLEMENTED'`, `'PENDING_VERIFICATION'`, `'VERIFIED'`, `'CLOSED'`, `'REJECTED'`, `'NOT_IMPLEMENTED'`

**Affected functions**:
- `createActionPlan` / `createActionPlansBatch` → `'Not Due'` or `'Pending'`
- `updateActionPlan`, `deleteActionPlan`, `delegateActionPlan` → status guards
- `markAsImplemented` → `'Pending Verification'`
- `verifyImplementation` → `'Verified'`, `'Rejected'`, `'In Progress'`
- `hoaReview` → `'Closed'`, `'In Progress'`
- `updateOverdueStatuses` → `'Overdue'`, `'Pending'`
- `addActionPlanHistory` → passes through raw status strings to `action_plan_history.previous_status` / `new_status`
- `getActionPlansRaw`, `getActionPlanCounts`, `getSummaryStats`, `getAnalyticsData` → filter on all AP status literals

---

### FLAG-003 🔴 CRITICAL — Notification Queue Status: Title-Case vs lowercase

**Scope**: `05_NotificationService.gs` — `queueNotification`, `queueEmail`, `processEmailQueue`  
**GAS writes**: `'Pending'` (`STATUS.NOTIFICATION.PENDING`), `'Sent'` (`STATUS.NOTIFICATION.SENT`), `'Failed'` (`STATUS.NOTIFICATION.FAILED`), `'Batched'` (unused in queue but defined)  
**Turso `notification_queue.status` CHECK**: `('pending','sending','sent','failed','cancelled','dead_letter')` — all **lowercase**

**Specific mismatches**:
- GAS `'Pending'` ≠ Turso `'pending'`
- GAS `'Sent'` ≠ Turso `'sent'`
- GAS `'Failed'` ≠ Turso `'failed'`
- GAS `'Batched'` has no equivalent in new schema (closest is `'cancelled'` or new field needed)

---

### FLAG-004 🔴 CRITICAL — Session Token: Raw Plaintext vs Hashed

**Scope**: `07_AuthService.gs` — `createSession`, `validateSession`, `getSessionByToken`  
**GAS column**: `session_token` — stores the **raw plaintext token** and queries directly on it  
**Turso column**: `session_token_hash` — stores a **hash** of the token; the column name itself is different

**Impact**: The lookup `WHERE session_token = ?` will not work against `session_token_hash`. All session reads and writes require hashing logic in the migration layer.

---

### FLAG-005 🟠 HIGH — File Attachment Fields: Drive-specific Names vs Unified Schema

**Scope**: `addWorkPaperFile` writes to `11_WorkPaperFiles`; `addActionPlanEvidence` writes to `14_ActionPlanEvidence`  
**GAS fields**:
- `drive_file_id` — Google Drive file ID
- `drive_url` — Google Drive share URL

**Turso `files` table columns**:
- `storage_id` (replaces `drive_file_id`)
- `storage_url` (replaces `drive_url`)

Additionally, GAS uses separate collections `11_WorkPaperFiles` / `14_ActionPlanEvidence`, but the new schema unifies these into `files` + `file_attachments` (junction table). The `file_category` field from WP files and the evidence-specific `evidence_id` field have no direct equivalents.

---

### FLAG-006 🟠 HIGH — auditee_responses.status vs RESPONSE_STATUS Enum

**Scope**: `10_AuditeeService.gs` — `submitAuditeeResponse`, `reviewAuditeeResponse`  
**GAS writes to `auditee_responses.status`** (using `STATUS.REVIEW.*`):
- `'Pending Review'`, `'Approved'`, `'Rejected'`, `'Returned for Revision'`

**Turso `RESPONSE_STATUS` enum** (used for `auditee_responses.status`):
- `'Pending Response'`, `'Draft Response'`, `'Response Submitted'`, `'Response Accepted'`, `'Response Rejected'`, `'Escalated'`

**Mismatch**: GAS uses `STATUS.REVIEW` values for the response-record's own `status` field, but the new schema's `RESPONSE_STATUS` enum matches `STATUS.RESPONSE` values (which GAS writes to `work_papers.response_status`). The values `'Pending Review'`, `'Approved'`, `'Rejected'`, `'Returned for Revision'` are **not in the new `RESPONSE_STATUS` CHECK constraint**.

**Fix required**: Either add a separate `review_status` column/enum to the `auditee_responses` table, or remap the values before writing.

---

### FLAG-007 🟠 HIGH — system_settings Collection Has No Turso Equivalent

**Scope**: `00_FirestoreService.gs` — `firestoreGetSystemSettings`, `firestoreSetSystemSettings`  
**Firestore collection**: `system_settings` (documents: `counters`, `dashboard_summary`)  
**New schema**: No `system_settings` table exists. The `config` table (mapped from `00_Config`) serves a similar purpose but uses a different key structure.

**Impact**: The counter increment pattern in `generateId`/`generateIds` (reads/writes `system_settings/counters`) and the dashboard summary cache (`system_settings/dashboard_summary` via `updateDashboardSummary_WPStatus`, `rebuildDashboardSummary`) will need to be redirected to either the `config` table or new dedicated tables.

---

### FLAG-008 🟡 MEDIUM — CSV Multi-Valued Fields vs Junction Tables

**Scope**: Multiple functions across `03_WorkPaperService.gs`, `04_ActionPlanService.gs`, `10_AuditeeService.gs`  
**GAS storage**: Comma-separated strings in single columns:
- `work_papers.responsible_ids` — e.g. `"USR001,USR002"`
- `work_papers.cc_recipients` — e.g. `"USR003,USR004"`
- `action_plans.owner_ids` — e.g. `"USR001,USR003"`

**New Turso schema**: Normalized junction tables:
- `work_paper_responsibles(work_paper_id, user_id)`
- `work_paper_cc_recipients(work_paper_id, user_id)`
- `action_plan_owners(action_plan_id, user_id)`

**Impact**: Every write that includes these CSV fields (`createWorkPaper`, `updateWorkPaper`, `createActionPlan`, `delegateActionPlan`, `respondToDelegation`, `sendToAuditee`) must be decomposed into separate INSERT rows in the junction table. Every read that filters on them (e.g. `getAuditeeFindings` filtering by `responsible_ids`) must use JOINs.

---

### FLAG-009 🟡 MEDIUM — work_paper_revisions Missing from_status / to_status

**Scope**: `addWorkPaperRevision`, `submitWorkPaper`, `reviewWorkPaper`  
**GAS fields written to `12_WorkPaperRevisions`**: `revision_id, work_paper_id, revision_number, action, comments, changes_summary, user_id, user_name, action_date`  
**New Turso `work_paper_revisions` table adds**: `from_status`, `to_status` columns

**Impact**: GAS writes the free-text `action` field (e.g. `'submitted'`, `'approved'`) but does NOT write separate `from_status`/`to_status` fields. These must be derived and populated during migration or added to GAS write calls.

---

### FLAG-010 🟡 MEDIUM — action_plan_history Missing event_type

**Scope**: `addActionPlanHistory`  
**GAS fields written to `15_ActionPlanHistory`**: `history_id, action_plan_id, previous_status, new_status, comments, user_id, user_name, changed_at`  
**New Turso `action_plan_history` adds**: `event_type` column (likely an enum such as `'status_change'`, `'delegation'`, `'comment'`)

**Impact**: GAS never writes `event_type`. If the column is `NOT NULL`, all INSERTs will fail. A default value or migration-time derivation is required.

---

### FLAG-011 🟡 MEDIUM — Notification Queue Field Name Mismatches

**Scope**: `queueNotification`, `processEmailQueue`  
**GAS field names in `21_NotificationQueue`**:
- `data` — JSON payload blob
- `batch_type` — notification type code
- `recipient_user_id`, `recipient_email`

**New Turso `notification_queue` column names** (from schema.sql):
- `payload` (replaces `data`)
- `module` / `record_id` (replaces `batch_type` for entity linkage, or `related_entity_type` / `related_entity_id`)
- Column names for recipient may also differ

**Impact**: Field-name mismatches will cause silent NULL writes or schema constraint failures when GAS notification records are migrated or written directly.

---

### FLAG-012 🟢 LOW — auditor_review_status / hoa_review_status: Free-Text Strings

**Scope**: `verifyImplementation`, `hoaReview` (`04_ActionPlanService.gs`)  
**GAS writes**:
- `auditor_review_status`: `'Approved'`, `'Rejected'`, `'Returned for Revision'`
- `hoa_review_status`: `'Approved'`, `'Rejected'`

**New schema**: If these are plain `TEXT` columns with no CHECK constraint they will work as-is. However, if the new schema adds CHECK constraints for these review status fields (e.g., `'APPROVED'`, `'REJECTED'`), the mixed-case values will fail.

**Recommendation**: Verify whether these columns have CHECK constraints in the final Turso schema and apply the same UPPER_SNAKE_CASE normalization if so.

---

### FLAG-013 🟢 LOW — privacy_consent_accepted Stored as String 'true'

**Scope**: `acceptPrivacyConsent` (`07_AuthService.gs`)  
**GAS writes**: `privacy_consent_accepted: 'true'` (string, not boolean)  
**Turso**: SQLite does not have a native BOOLEAN type but typically stores `0`/`1` or `TRUE`/`FALSE`. If the new schema uses `INTEGER DEFAULT 0` (SQLite boolean convention), the string `'true'` will be stored as `0` due to type affinity coercion, silently breaking consent tracking.

---

### Summary of Breaking Changes by Severity

| Flag | Severity | Area | Affected Functions (count) |
|------|----------|------|---------------------------|
| FLAG-001 | 🔴 CRITICAL | WP status literals | 10+ |
| FLAG-002 | 🔴 CRITICAL | AP status literals | 12+ |
| FLAG-003 | 🔴 CRITICAL | Notification queue status case | 3 |
| FLAG-004 | 🔴 CRITICAL | Session token column name + hashing | 3 |
| FLAG-005 | 🟠 HIGH | File attachment field names | 2 |
| FLAG-006 | 🟠 HIGH | auditee_responses.status enum mismatch | 2 |
| FLAG-007 | 🟠 HIGH | system_settings — no Turso table | 4 |
| FLAG-008 | 🟡 MEDIUM | CSV multi-value → junction tables | 8+ |
| FLAG-009 | 🟡 MEDIUM | work_paper_revisions missing from/to_status | 3 |
| FLAG-010 | 🟡 MEDIUM | action_plan_history missing event_type | 5 |
| FLAG-011 | 🟡 MEDIUM | Notification queue field name mismatches | 2 |
| FLAG-012 | 🟢 LOW | Review sub-status free-text strings | 2 |
| FLAG-013 | 🟢 LOW | privacy_consent_accepted string vs boolean | 1 |
