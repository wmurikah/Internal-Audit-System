# Workflow Status Report — Internal Audit System Re-Audit

**Generated:** 2026-05-14  
**Auditor:** Automated re-audit (all 13 .gs files read in full)  
**Baseline:** `docs/WORKFLOWS.md`  
**Branch:** `claude/audit-gs-files-workflows-PbUm8`

---

## Summary Table

| Section | Total Items | FIXED | BROKEN | PARTIAL | NEW BUG |
|---------|-------------|-------|--------|---------|---------|
| 1. Critical Bugs | 6 | 6 | 0 | 0 | 0 |
| 2. Silent Failures | 7 | 7 | 0 | 0 | 0 |
| 3. Hardcoded Values | 12 | 10 | 0 | 1 | 1 |
| 4. Performance & Triggers | 4 | 2 | 0 | 0 | 2 |
| 5. Notification Pipeline | 6 | 3 | 0 | 0 | 3 |
| 6. Work Paper Form & Dropdowns | 5 | 5 | 0 | 0 | 0 |
| 7. New Bugs Found | 10 | — | — | — | 10 |
| **TOTAL** | **50** | **33** | **0** | **1** | **16** |

---

## Section 1: Critical Bugs

These are the six bugs documented in WORKFLOWS.md as "critical" — each caused data loss, incorrect DB state, or a complete feature failure.

---

### 1.1 Permission writes going to Google Sheets instead of Turso

**Status: FIXED**  
**File:** `09_AnalyticsService.gs`  
**Function:** `updatePermissions()` (line 241)

`updatePermissions()` now issues a Turso SQL write and immediately invalidates the cache:

```javascript
tursoQuery_SQL(
  'INSERT OR REPLACE INTO role_permissions ' +
  '(role_code, module_code, action_code, is_allowed, updated_at) VALUES (?, ?, ?, ?, ?)',
  [permData.role_code, permData.module_code, permData.action_code,
   permData.is_allowed ? 1 : 0, new Date().toISOString()]
);
CacheService.getScriptCache().remove('perm_db_' + permData.role_code);
```

No Google Sheets calls remain.

---

### 1.2 `getPermissions()` reading from hardcoded in-memory matrix

**Status: FIXED**  
**File:** `01_Core.gs`  
**Function:** `getPermissionsFresh()` (line 474)

Live DB query against `role_permissions`:

```javascript
tursoQuery_SQL(
  'SELECT module_code, action_code, is_allowed FROM role_permissions WHERE role_code = ?',
  [roleCode]
)
```

Cache key uses `'perm_db_' + roleCode` with TTL from `getConfigInt('PERMISSION_CACHE_TTL_SECONDS', 600)`.

---

### 1.3 `setupAllTriggers()` missing / triggers never registered

**Status: FIXED** *(see Section 4.2 for a related new bug)*  
**File:** `08_WebApp.gs`  
**Function:** `setupAllTriggers()` (line 1476)

Function exists and creates five triggers. However, see NEW BUG 4.2 — one of those five triggers references a non-existent function.

---

### 1.4 `getUsers()` reading from Google Sheets

**Status: FIXED**  
**File:** `07_AuthService.gs`  
**Function:** `getUsers()` (line 1197)

```javascript
tursoQuery_SQL(
  'SELECT id, email, full_name, role_code, ... FROM users WHERE deleted_at IS NULL ORDER BY full_name',
  []
)
```

No Spreadsheet API call remains.

---

### 1.5 `deactivateUser()` not flagging orphaned work papers / action plans

**Status: FIXED**  
**File:** `07_AuthService.gs`  
**Function:** `deactivateUser()` (line 1021)

Three-step procedure confirmed:
- **STEP A:** Queries `work_papers` for orphaned WPs where `assigned_auditor_id = userId AND status IN ('Draft','In Review')`
- **STEP B:** Queries `action_plans` for orphaned APs where user is an owner and status is open
- **STEP C:** Returns `{ orphanedWorkPapers, orphanedActionPlans }` counts to the caller

---

### 1.6 `login()` not updating `last_login` field

**Status: FIXED**  
**File:** `07_AuthService.gs`  
**Function:** `login()` (line 97)

Immediately after `createSession()` succeeds, a synchronous `tursoUpdate('05_Users', userId, { last_login: new Date() })` is called. The old async-only path is gone.

---

## Section 2: Silent Failures

These are the seven bugs documented in WORKFLOWS.md as "silent" — they returned `{ success: true }` but produced no visible effect.

---

### 2.1 `unlockUser()` silently missing / undefined

**Status: FIXED**  
**File:** `07_AuthService.gs`  
**Function:** `unlockUser()` (line 1291)

Function fully implemented: validates SUPER_ADMIN role, validates token, then:

```javascript
tursoUpdate('05_Users', userId, { locked_until: null, login_attempts: 0 });
```

---

### 2.2 WP_ASSIGNMENT notification not sent on work paper creation

**Status: FIXED**  
**File:** `03_WorkPaperService.gs`  
**Function:** `createWorkPaper()` (line 106)

```javascript
queueNotification({
  type: NOTIFICATION_TYPES.WP_ASSIGNMENT,
  recipient_user_id: data.assigned_auditor_id,
  data: { ... }
});
```

---

### 2.3 WP_ASSIGNMENT notification not sent on auditor reassignment

**Status: FIXED**  
**File:** `03_WorkPaperService.gs`  
**Function:** `updateWorkPaper()` (line 292)

Detects `data.assigned_auditor_id !== existing.assigned_auditor_id` and queues `WP_ASSIGNMENT` to the new auditor.

---

### 2.4 `updateOverdueStatuses()` SQL moving records in wrong direction

**Status: FIXED**  
**File:** `04_ActionPlanService.gs`  
**Function:** `updateOverdueStatuses()` (line 859)

Two separate, correctly ordered SQL queries:

**Query 1 — Not Due → Pending** (same due date, not yet past):
```sql
WHERE status = 'Not Due'
  AND date(due_date) <= date(?)
  AND date(due_date) >= date(?)
```

**Query 2 — → Overdue** (genuinely past due):
```sql
WHERE status IN ('Not Due', 'Pending', 'In Progress')
  AND date(due_date) < date(?)
```

The SQL inversion that reversed status transitions is gone.

---

### 2.5 Dashboard permission checks hardcoded to `true`

**Status: FIXED**  
**File:** `06_DashboardService.gs`  
**Functions:** `canViewDashboard()` (line 952), `canViewAIAssist()` (line 958), `canViewAuditWorkbench()` (line 964)

All three now call `checkPermission(user.role_code, module, action)` which reads live from the `role_permissions` table via `getPermissionsCached()`.

---

### 2.6 Auditee response responsible-party lookup ignoring junction table

**Status: FIXED**  
**File:** `10_AuditeeService.gs`  
**Functions:** `submitAuditeeResponse()` (line 280), `saveDraftResponse()` (line 232), `reviewAuditeeResponse()` (line 474)

All functions query `work_paper_responsibles` junction table directly:

```javascript
tursoQuery_SQL(
  'SELECT user_id FROM work_paper_responsibles WHERE work_paper_id = ?',
  [workPaperId]
)
```

The old `wp.responsible_ids` string-split path is replaced.

---

### 2.7 `AI_REJECTION_THRESHOLD` hardcoded to 50

**Status: FIXED**  
**File:** `05_AIService.gs`  
**Function:** `evaluateAuditeeResponse()` (line 780)

```javascript
var threshold = parseInt(aiSettings.AI_REJECTION_THRESHOLD || '50', 10);
```

`getAISettings()` queries `config WHERE config_key LIKE 'AI%'`, making the threshold configurable without code changes.

---

## Section 3: Hardcoded Values

Every value that WORKFLOWS.md identified as needing to be config-driven is audited here.

---

### 3.1 `AP_DEFAULT_DUE_DATE_DAYS` in `sendToAuditee()`

**Status: FIXED**  
**File:** `03_WorkPaperService.gs`  
**Function:** `sendToAuditee()` (line 977)

```javascript
var defaultDueDays = getConfigInt('AP_DEFAULT_DUE_DATE_DAYS', 30);
```

---

### 3.2 `AP_DEFAULT_DUE_DATE_DAYS` in `batchSendToAuditees()`

**Status: NEW BUG**  
**File:** `03_WorkPaperService.gs`  
**Function:** `batchSendToAuditees()` (line 1403)

```javascript
var defaultDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
```

The literal `30` is hardcoded. `sendToAuditee()` was fixed but the batch path was missed. Should be:

```javascript
var defaultDueDays = getConfigInt('AP_DEFAULT_DUE_DATE_DAYS', 30);
var defaultDue = new Date(now.getTime() + defaultDueDays * 24 * 60 * 60 * 1000);
```

---

### 3.3 `AP_MAX_DUE_DATE_MONTHS` in `createActionPlan()`

**Status: FIXED**  
**File:** `04_ActionPlanService.gs`  
**Function:** `createActionPlan()` (line 30)

```javascript
var maxMonths = getConfigInt('AP_MAX_DUE_DATE_MONTHS', 6);
```

---

### 3.4 `AP_MAX_DUE_DATE_MONTHS` in `createAuditeeActionPlan()`

**Status: PARTIAL**  
**File:** `10_AuditeeService.gs`  
**Function:** `createAuditeeActionPlan()` (line 629)

```javascript
var maxDueDate = new Date();
maxDueDate.setMonth(maxDueDate.getMonth() + 6);
```

The literal `6` is hardcoded. `createActionPlan()` was fixed in `04_ActionPlanService.gs` but the parallel auditee path was missed. Should call `getConfigInt('AP_MAX_DUE_DATE_MONTHS', 6)`.

---

### 3.5 `EMAIL_BATCH_SIZE` in `processEmailQueue()`

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `processEmailQueue()` (line 605)

```javascript
var batchSize = getConfigInt('EMAIL_BATCH_SIZE', 50);
```

---

### 3.6 `EMAIL_LOCK_WAIT_MS` in `processEmailQueue()`

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `processEmailQueue()` (line 595)

```javascript
var lockWaitMs = getConfigInt('EMAIL_LOCK_WAIT_MS', 10000);
```

---

### 3.7 `OUTLOOK_TOKEN_CACHE_SECONDS` in `getOutlookAccessToken()`

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `getOutlookAccessToken()` (line 170)

```javascript
var tokenCacheSecs = getConfigInt('OUTLOOK_TOKEN_CACHE_SECONDS', 3000);
```

---

### 3.8 `STALE_REMINDER_DAYS` in `sendStaleAssignmentReminders()`

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `sendStaleAssignmentReminders()` (line 448)

```javascript
var staleDays = getConfigInt('STALE_REMINDER_DAYS', 3);
```

---

### 3.9 `PERMISSION_CACHE_TTL_SECONDS`

**Status: FIXED**  
**File:** `01_Core.gs`  
**Function:** `getPermissionsCached()` (line 489)

```javascript
CacheService.getScriptCache().put(cacheKey, JSON.stringify(perms),
  getConfigInt('PERMISSION_CACHE_TTL_SECONDS', 600));
```

The old `CONFIG.CACHE_TTL.PERMISSIONS = 600` constant is still defined at line 7 but is no longer used for the permission cache TTL.

---

### 3.10 `reply-to` email address in `sendEmailViaOutlook()`

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `sendEmailViaOutlook()` (line 229)

`replyTo` is populated from `getReplyToEmailList()` which reads from Script Properties. The hardcoded `audit@hasspetroleum.com` is gone.

---

### 3.11 `PBKDF2_ITERATIONS` intentionally hardcoded

**Status: FIXED** (by design)  
**File:** `07_AuthService.gs`  
**Constant:** `AUTH_CONFIG.PBKDF2_ITERATIONS = 1000` (line 13)

This value must be stable across all existing password hashes. Making it config-driven would silently invalidate all existing passwords. Hardcoding is correct here.

---

### 3.12 `SCHEMAS.NOTIFICATION_QUEUE` schema constant out of sync

**Status: NEW BUG**  
**File:** `02_Config.gs`  
**Constant:** `SCHEMAS.NOTIFICATION_QUEUE` (line 103)

The schema constant still lists legacy columns:

```javascript
SCHEMAS.NOTIFICATION_QUEUE = {
  subject: ...,
  body: ...,
  module: ...,
  record_id: ...
}
```

The actual `notification_queue` table used by `queueNotification()` uses:  
`batch_type`, `priority`, `payload`, `related_entity_type`, `related_entity_id`, `rendered_subject`, `rendered_body`

This constant is used for documentation and any auto-generated insert validation. It is completely wrong. If any code relies on `SCHEMAS.NOTIFICATION_QUEUE` to construct inserts, those inserts will use wrong column names.

---

## Section 4: Performance & Trigger Setup

---

### 4.1 `keepWarm()` not implemented

**Status: FIXED**  
**File:** `01_Core.gs`  
**Function:** `keepWarm()` (line 778)

```javascript
function keepWarm() {
  try {
    var url = getSystemUrl();
    UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true });
  } catch (e) { /* non-fatal */ }
}
```

Registered as a 5-minute trigger in `setupAllTriggers()`.

---

### 4.2 `setupAllTriggers()` registers non-existent `sendWeeklySummary`

**Status: NEW BUG**  
**File:** `08_WebApp.gs`  
**Function:** `setupAllTriggers()` (line 1491–1492)

```javascript
ScriptApp.newTrigger('sendWeeklySummary')
  .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
```

The function `sendWeeklySummary` **does not exist anywhere in the codebase**. A grep across all 13 `.gs` files finds only two references to `'sendWeeklySummary'` — both are string literals (a cleanup list in `05_NotificationService.gs:2657` and this trigger registration). When this Monday trigger fires, Apps Script will throw `ScriptError: Cannot find function sendWeeklySummary`. The weekly email summary is permanently broken.

Furthermore, there are **two competing trigger setup functions**:

| Function | File | Registers |
|---|---|---|
| `setupAllTriggers()` | `08_WebApp.gs:1476` | `processEmailQueue`, `runScheduledMaintenance`, `sendWeeklySummary` (missing!), `warmAllCaches`, `keepWarm` |
| `setupNotificationTriggers()` | `05_NotificationService.gs:2638` | `processEmailQueue`, `dailyMaintenance`, `processBatchedDelegationNotifications`, `weeklyReminderRunner` |

No documentation or comment specifies which function is authoritative. If both are run, duplicate `processEmailQueue` triggers will send duplicate emails.

---

### 4.3 `warmAllCaches()` — cache warming

**Status: FIXED**  
**File:** `08_WebApp.gs`  
**Function:** `warmAllCaches()` (line 907)

Warms dropdown data, user list, and permission caches. Registered as a 6-hour trigger by `setupAllTriggers()`.

---

### 4.4 `getConfigInt()` — config-driven integer helper

**Status: FIXED**  
**File:** `01_Core.gs`  
**Function:** `getConfigInt()` (line 222)

Reads from Turso `config` table via `tursoGetConfig(key, 'GLOBAL')`, falls back to `fallback` integer. Used throughout the codebase for all previously-hardcoded thresholds.

---

## Section 5: Notification Pipeline

---

### 5.1 `STATUS.NOTIFICATION.BATCHED` constant causing errors

**Status: FIXED**  
**File:** `02_Config.gs` (line 153)

`STATUS.NOTIFICATION` defines: `PENDING`, `SENDING`, `SENT`, `FAILED`, `CANCELLED`, `DEAD_LETTER`. No `BATCHED` constant. Any code that referenced `STATUS.NOTIFICATION.BATCHED` would have received `undefined` — that dead reference is gone.

---

### 5.2 Outlook fallback to MailApp

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `sendEmail()` (line 301)

```javascript
var outlookResult = sendEmailViaOutlook(recipientEmail, subject, htmlBody, ccEmails, replyTo);
if (outlookResult.success) { return outlookResult; }
if (!outlookResult.fallback) { return outlookResult; }
// Fallback: MailApp
MailApp.sendEmail(emailOptions);
```

`outlookResult.fallback` flag controls graceful degradation.

---

### 5.3 Microsoft Graph token not cached

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `getOutlookAccessToken()` (line 170)

Token is cached in `CacheService` for `getConfigInt('OUTLOOK_TOKEN_CACHE_SECONDS', 3000)` seconds. Previously fetched a new token on every email send.

---

### 5.4 `queueNotification()` rows silently skipped by `processEmailQueue()`

**Status: NEW BUG** — CRITICAL  
**File:** `05_NotificationService.gs`  
**Functions:** `queueNotification()` (line 76), `processEmailQueue()` (line 591)

`queueNotification()` writes rows to `notification_queue` with these columns:

```
notification_id, organization_id, batch_type, priority,
recipient_user_id, recipient_email, is_cc, payload,
related_entity_type, related_entity_id, status, created_at, sent_at
```

`processEmailQueue()` reads:

```javascript
const subject = row.rendered_subject;  // line 632
const body    = row.rendered_body;     // line 633
...
if (!recipientEmail || !subject) continue;  // line 637 — skips if null
```

`queueNotification()` **never writes `rendered_subject` or `rendered_body`**. Those columns are `NULL` for every row it creates. The `if (!subject) continue` guard on line 637 therefore silently skips every notification queued via `queueNotification()`.

**Impact:** The following notification types are permanently dead:

| Notification Type | Queued via | Delivered? |
|---|---|---|
| `WP_ASSIGNMENT` | `queueNotification()` | ❌ Never |
| `STALE_REMINDER` | `queueNotification()` | ❌ Never |
| `OVERDUE_REMINDER` | `queueNotification()` | ❌ Never |
| `RESPONSE_SUBMITTED` | `queueNotification()` | ❌ Never |
| `RESPONSE_REVIEWED` | `queueNotification()` | ❌ Never |
| `AP_DELEGATION` | `queueNotification()` | ❌ Never |
| Password reset | Direct INSERT with `rendered_subject` | ✅ Works |
| Welcome email | Direct INSERT with `rendered_subject` | ✅ Works |

Only `07_AuthService.gs` writes `rendered_subject`/`rendered_body` directly (lines 721, 913, 1152). All other notification types use `queueNotification()` and are never delivered.

**Fix required:** Either populate `rendered_subject`/`rendered_body` inside `queueNotification()` (by rendering from a template or from `params.data`), or change `processEmailQueue()` to fall back to rendering from `payload` when `rendered_subject` is NULL.

---

### 5.5 `queueEmail()` / `queueTemplatedEmail()` write incompatible columns

**Status: NEW BUG**  
**File:** `05_NotificationService.gs`  
**Functions:** `queueEmail()` (line 323), `queueTemplatedEmail()` (line 356)

`queueEmail()` inserts with legacy columns: `subject`, `body`, `module`, `record_id`. `processEmailQueue()` reads `rendered_subject` / `rendered_body`. These rows are also silently skipped (same bug as 5.4, different code path).

`queueTemplatedEmail()` is still in the file despite the comment on line 434:

> `// queueAssignmentNotification, queueWPChangeNotification, queueWPStatusChangeNotification`  
> `// removed — all replaced by universal queueNotification() with NOTIFICATION_TYPES constants`

`queueTemplatedEmail()` was not removed and is still called in some fallback paths. Its output is never delivered.

---

### 5.6 Overdue reminder escalation schedule is config-driven

**Status: FIXED**  
**File:** `05_NotificationService.gs`  
**Function:** `sendOverdueReminders()` (line 1290)

Escalation schedule (first/second/weekly/biweekly thresholds) is read from `getConfigValue('OVERDUE_REMINDER_SCHEDULE')` with a hardcoded fallback object. Per-AP deduplication is checked against `notification_queue` before sending.

---

## Section 6: Work Paper Form & Dropdowns

---

### 6.1 `getAffiliatesDropdownData()` session-gated

**Status: FIXED**  
**File:** `11_DropdownService.gs`  
**Function:** `getAffiliatesDropdownData()` (line 308)

Validates session token, returns only `is_active == 1` affiliates ordered by `display_order`. Reads from Turso `06_Affiliates` table.

---

### 6.2 `getAuditAreasDropdownData()` session-gated

**Status: FIXED**  
**File:** `11_DropdownService.gs`  
**Function:** `getAuditAreasDropdownData()` (line 322)

Same pattern — session validation, active filter, display_order sort, Turso read.

---

### 6.3 `getSubAreasDropdownData()` filters by area

**Status: FIXED**  
**File:** `11_DropdownService.gs`  
**Function:** `getSubAreasDropdownData()` (line 336)

Filters `08_ProcessSubAreas` by `area_id` and `is_active == 1`. Returns empty array for missing `areaId`.

---

### 6.4 `getUsersForWorkPaper()` returns live user roster

**Status: FIXED**  
**File:** `11_DropdownService.gs`  
**Function:** `getUsersForWorkPaper()` (line 351)

Reads from `05_Users` Turso table, only `is_active == 1`, returns `user_id`, `full_name`, `email`, `role_code`, `affiliate_code`. No Sheets API call.

---

### 6.5 `getSubAreaTemplate()` / `saveSubAreaTemplate()` defined

**Status: FIXED**  
**File:** `08_WebApp.gs`  
**Functions:** `getSubAreaTemplate()` (line 2427), `saveSubAreaTemplate()` (line 2443)

Both session-validated. `getSubAreaTemplate` reads `audit_area_templates` from Turso by `sub_area_id`. `saveSubAreaTemplate` writes back with `tursoSet`.

---

## Section 7: New Bugs Found

The following bugs were **not documented in WORKFLOWS.md**. They were discovered during this re-audit.

---

### NB-1 `workPaper` variable undefined in 5 Action Plan functions

**Severity: HIGH — ReferenceError at runtime**  
**File:** `04_ActionPlanService.gs`  
**Functions:** `markAsImplemented` (line 650), `verifyImplementation` (line 745), `hoaReview` (line 821), `delegateActionPlan` (line 968), `addActionPlanHistory` (line 1081)

All five functions reference `workPaper.organization_id` but the variable `workPaper` is never declared or assigned in any of those scopes. The local variable at each call site is named `actionPlan` or `updated`. Example from `markAsImplemented`:

```javascript
// Line ~650:
organization_id: workPaper.organization_id  // ReferenceError: workPaper is not defined
```

Any call to these functions will throw `ReferenceError: workPaper is not defined` before completing. The implementation, verification, HOA review, delegation, and history-logging flows are all broken at runtime.

**Fix:** Replace `workPaper.organization_id` with `actionPlan.organization_id` (or `updated.organization_id` in `delegateActionPlan`).

---

### NB-2 `ROLES.AUDITEE` does not exist — always evaluates to `undefined`

**Severity: MEDIUM — wrong dashboard branch for hypothetical AUDITEE role**  
**File:** `06_DashboardService.gs`  
**Function:** `getDashboardDataV2()` (line 1459–1460)

```javascript
var isAuditee = callerUser.role_code === ROLES.JUNIOR_STAFF ||
                callerUser.role_code === ROLES.AUDITEE;   // ← ROLES.AUDITEE is undefined
```

`ROLES` constant in `02_Config.gs` (line 163–172) defines: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `JUNIOR_STAFF`, `SENIOR_MGMT`, `BOARD_MEMBER`, `AUDITOR`, `UNIT_MANAGER`, `EXTERNAL_AUDITOR`. There is no `AUDITEE` key.

`ROLES.AUDITEE` evaluates to `undefined`. The comparison `callerUser.role_code === undefined` is always `false`. In practice this is harmless today because auditees use `JUNIOR_STAFF`, but if the DB ever contains a user with `role_code = 'AUDITEE'`, they fall through to `return { success: false, error: 'Access denied' }`.

**Fix:** Remove `callerUser.role_code === ROLES.AUDITEE` from the condition, or add `AUDITEE: 'AUDITEE'` to the ROLES constant.

---

### NB-3 `delegateActionPlan()` deletes `owner_ids` before using it in notifications

**Severity: HIGH — delegation notifications never reach new owners**  
**File:** `04_ActionPlanService.gs`  
**Function:** `delegateActionPlan()` (lines 947–976)

```javascript
// Line 947
delete updated.owner_ids;      // ← removes the field

// Line 976 (later in the same function)
var newOwnerIds = parseIdList(updated.owner_ids);  // updated.owner_ids is now undefined → []
```

`parseIdList(undefined)` returns `[]`. The `forEach` loop that queues `AP_DELEGATION` notifications to new owners iterates zero times. Delegated action plan owners are never notified.

**Fix:** Save `owner_ids` to a local variable before deleting it from `updated`:

```javascript
var newOwnerIds = parseIdList(updated.owner_ids);
delete updated.owner_ids;
// ... then use newOwnerIds for notifications
```

---

### NB-4 `batchSendToAuditees()` hardcodes 30-day default due date

**Severity: MEDIUM — batch path ignores config, inconsistent with single-send path**  
**File:** `03_WorkPaperService.gs`  
**Function:** `batchSendToAuditees()` (line 1403)

```javascript
var defaultDue = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
```

The individual `sendToAuditee()` (line 977) uses `getConfigInt('AP_DEFAULT_DUE_DATE_DAYS', 30)`. The batch path hardcodes `30`. Changing the config key has no effect on bulk sends.

---

### NB-5 `processEmailQueue()` never delivers notifications from `queueNotification()`

*(Cross-listed from Section 5.4 — included here for completeness in the new-bug inventory)*

**Severity: CRITICAL — entire modern notification pipeline is silently dead**  
**File:** `05_NotificationService.gs`  
**Functions:** `queueNotification()` (line 76), `processEmailQueue()` (line 591)

`queueNotification()` never writes `rendered_subject` / `rendered_body`. `processEmailQueue()` reads those columns and skips rows where `subject` is falsy. All business-workflow notifications (WP assignment, stale reminder, overdue reminder, response submitted, response reviewed, delegation) are permanently undelivered.

---

### NB-6 `sendWeeklySummary` trigger points to a non-existent function

**Severity: HIGH — weekly trigger fires and crashes every Monday**  
**File:** `08_WebApp.gs`  
**Function:** `setupAllTriggers()` (line 1491)

```javascript
ScriptApp.newTrigger('sendWeeklySummary')
  .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
```

`sendWeeklySummary` is not defined in any `.gs` file. Every Monday at 8 AM the trigger fires, Apps Script throws `Cannot find function sendWeeklySummary`, and the summary email is never sent. The Apps Script execution log accumulates weekly errors.

The correct weekly runner — `weeklyReminderRunner` (defined at `05_NotificationService.gs:2730`) — exists but is only registered by `setupNotificationTriggers()`, not by `setupAllTriggers()`.

---

### NB-7 Two conflicting trigger setup functions

**Severity: MEDIUM — double-triggers cause duplicate email sends**  
**File:** `08_WebApp.gs:1476` and `05_NotificationService.gs:2638`  
**Functions:** `setupAllTriggers()`, `setupNotificationTriggers()`

`setupAllTriggers()` deletes **all** project triggers before re-creating five. `setupNotificationTriggers()` deletes only a named list before re-creating four. If both are run (e.g. by different team members), `processEmailQueue` will be registered twice, sending every email twice. No documentation designates which function is canonical.

The trigger sets do not overlap cleanly:

| Trigger function | `setupAllTriggers` | `setupNotificationTriggers` |
|---|---|---|
| `processEmailQueue` | ✅ | ✅ |
| `runScheduledMaintenance` | ✅ | ❌ |
| `sendWeeklySummary` (missing!) | ✅ | ❌ |
| `warmAllCaches` | ✅ | ❌ |
| `keepWarm` | ✅ | ❌ |
| `dailyMaintenance` | ❌ | ✅ |
| `weeklyReminderRunner` | ❌ | ✅ |
| `processBatchedDelegationNotifications` | ❌ | ✅ |

---

### NB-8 `queueEmail()` and `queueTemplatedEmail()` produce undeliverable rows

*(Cross-listed from Section 5.5)*

**Severity: MEDIUM — fallback notification path silently broken**  
**File:** `05_NotificationService.gs` (lines 323–432)

`queueEmail()` writes `subject`/`body`/`module`/`record_id` columns. `queueTemplatedEmail()` calls `queueEmail()`. `processEmailQueue()` reads `rendered_subject`/`rendered_body`. These functions produce rows that are permanently skipped.

---

### NB-9 `SCHEMAS.NOTIFICATION_QUEUE` has wrong column names

*(Cross-listed from Section 3.12)*

**Severity: LOW — misleading constant, potential INSERT breakage if relied upon**  
**File:** `02_Config.gs` (line 103)

The constant documents `subject`, `body`, `module`, `record_id`. The actual table uses `batch_type`, `priority`, `payload`, `rendered_subject`, `rendered_body`, `related_entity_type`, `related_entity_id`. Any code that auto-generates INSERTs from `SCHEMAS.NOTIFICATION_QUEUE` will use wrong column names.

---

### NB-10 `diagnoseDashboardIssues()` still references Google Sheets

**Severity: LOW — diagnostic function gives incorrect results**  
**File:** `08_WebApp.gs`  
**Function:** `diagnoseDashboardIssues()` (line 1526)

Lines 1553–1569 check for existence of Sheets tabs (`00_Config`, `01_Roles`, `02_Permissions`, `05_Users`, etc.) using `SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)`. The system has migrated to Turso but the diagnostic tool still tests Sheets. It will report sheets as "MISSING" even on a healthy Turso-backed deployment, producing false alarm diagnostics.

---

## Priority Fix List

| Priority | Bug | File | Function | Line |
|---|---|---|---|---|
| **P0** | NB-5: `processEmailQueue()` skips all `queueNotification()` rows — entire notification pipeline silent | `05_NotificationService.gs` | `queueNotification`, `processEmailQueue` | 76, 632 |
| **P0** | NB-6: `sendWeeklySummary` trigger points to non-existent function | `08_WebApp.gs` | `setupAllTriggers` | 1491 |
| **P1** | NB-1: `workPaper` undefined in 5 AP functions — ReferenceError at runtime | `04_ActionPlanService.gs` | `markAsImplemented`, `verifyImplementation`, `hoaReview`, `delegateActionPlan`, `addActionPlanHistory` | 650, 745, 821, 968, 1081 |
| **P1** | NB-3: `delegateActionPlan` deletes `owner_ids` before notification | `04_ActionPlanService.gs` | `delegateActionPlan` | 947–976 |
| **P1** | NB-7: Dual conflicting trigger setup functions | `08_WebApp.gs`, `05_NotificationService.gs` | `setupAllTriggers`, `setupNotificationTriggers` | 1476, 2638 |
| **P2** | NB-2: `ROLES.AUDITEE` undefined | `06_DashboardService.gs` | `getDashboardDataV2` | 1460 |
| **P2** | NB-4: `batchSendToAuditees` hardcodes 30 days | `03_WorkPaperService.gs` | `batchSendToAuditees` | 1403 |
| **P2** | NB-8: `queueEmail`/`queueTemplatedEmail` produce undeliverable rows | `05_NotificationService.gs` | `queueEmail`, `queueTemplatedEmail` | 323, 356 |
| **P3** | 3.12 / NB-9: `SCHEMAS.NOTIFICATION_QUEUE` has wrong column names | `02_Config.gs` | — | 103 |
| **P3** | 3.4: `createAuditeeActionPlan` hardcodes 6-month cap | `10_AuditeeService.gs` | `createAuditeeActionPlan` | 629 |
| **P3** | NB-10: `diagnoseDashboardIssues` tests Sheets, not Turso | `08_WebApp.gs` | `diagnoseDashboardIssues` | 1526 |

---

*End of report. 13 `.gs` files read in full. Reference: `docs/WORKFLOWS.md`.*
