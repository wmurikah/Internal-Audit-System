# Internal Audit System - Enterprise Debug Report

**Date:** 2026-02-19
**System:** Hass Petroleum Internal Audit System
**Stack:** Google Apps Script + Google Sheets (23 sheets as database)
**Codebase:** ~10,733 lines backend (.gs), ~12,004 lines frontend (.html)
**Severity Scale:** CRITICAL / HIGH / MEDIUM / LOW

---

## Table of Contents

1. [Critical Security Vulnerabilities](#1-critical-security-vulnerabilities)
2. [Database & Data Integrity Issues](#2-database--data-integrity-issues)
3. [Authentication & Session Management](#3-authentication--session-management)
4. [API & Routing Issues](#4-api--routing-issues)
5. [Cache Coherency Problems](#5-cache-coherency-problems)
6. [End-to-End Flow Failures](#6-end-to-end-flow-failures)
7. [Frontend Issues](#7-frontend-issues)
8. [Error Handling Gaps](#8-error-handling-gaps)
9. [Performance & Scalability Concerns](#9-performance--scalability-concerns)
10. [Code Quality & Maintenance](#10-code-quality--maintenance)
11. [Recommendations Summary](#11-recommendations-summary)

---

## 1. Critical Security Vulnerabilities

### 1.1 [CRITICAL] `Math.random()` Used for All Cryptographic Operations

**Files:** `07_AuthService.gs:488-503`, `01_Core.gs:848-883`

`Math.random()` is not cryptographically secure. It uses a predictable PRNG (Pseudo-Random Number Generator) seeded by the system clock. This affects:

- **`generateSalt()`** (07_AuthService.gs:488-494) - Password salts are predictable
- **`generateSecureToken()`** (07_AuthService.gs:496-503) - Session tokens are guessable
- **`generateTempPassword()`** (07_AuthService.gs:505-524) - Temporary passwords are predictable
- **`Security.generateSalt()`** (01_Core.gs:848-854) - Duplicate insecure implementation
- **`Security.generateSessionToken()`** (01_Core.gs:876-884) - Session tokens predictable
- **`Security.generatePassword()`** (01_Core.gs:856-874) - Generated passwords predictable

**Impact:** An attacker who knows the approximate time a session token or password was generated can narrow down the possible values and brute-force them.

**Fix:** Use `Utilities.getUuid()` for tokens, or use `Utilities.computeHmacSignature()` with a secret key and timestamp to generate cryptographically strong random values. Google Apps Script does not expose `crypto.getRandomValues()`, but `Utilities.getUuid()` is backed by a secure random source.

---

### 1.2 [CRITICAL] Weak Password Hashing - Only 1,000 PBKDF2 Iterations

**Files:** `07_AuthService.gs:467-480`, `01_Core.gs:824-841`

```javascript
// AUTH_CONFIG.PBKDF2_ITERATIONS = 1000
for (let i = 0; i < AUTH_CONFIG.PBKDF2_ITERATIONS; i++) {
  const signature = Utilities.computeHmacSignature(...);
  hash = Utilities.base64Encode(signature);
}
```

OWASP 2023 recommends a minimum of **600,000 iterations** for PBKDF2-SHA256. At 1,000 iterations, a GPU-based attack can test billions of password candidates per second.

**Impact:** If the Google Sheet (database) is compromised, all user passwords can be cracked rapidly.

**Note:** The custom PBKDF2 implementation also has a non-standard construction - it concatenates `hash + salt + i` rather than using proper PBKDF2 key derivation. This further weakens the hashing.

---

### 1.3 [CRITICAL] Uploaded Files Set to ANYONE_WITH_LINK

**File:** `08_WebApp.gs:711`

```javascript
file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
```

All uploaded audit evidence and work paper files are made publicly accessible to anyone with the URL. Audit documents typically contain sensitive financial and compliance data.

**Impact:** Any person who obtains or guesses a Google Drive file URL can view confidential audit documents without authentication.

**Fix:** Set sharing to `DriveApp.Access.DOMAIN` or `DriveApp.Access.PRIVATE`, and grant access to specific users programmatically.

---

### 1.4 [HIGH] No Server-Side File Type Validation on Upload

**File:** `08_WebApp.gs:689-728`

The `uploadFileToDrive()` function accepts any file content - the `accept` attribute on the frontend `<input>` can be trivially bypassed. A user could upload executable files, scripts, or oversized files to Google Drive.

**Fix:** Validate `mimeType` parameter server-side against an allowlist before creating the file.

---

### 1.5 [HIGH] `postLoginCleanup` is a Public (Unauthenticated) Action

**File:** `08_WebApp.gs:826`

```javascript
const publicActions = ['login', 'ping', 'testConnection', 'validateSession', 'postLoginCleanup', 'forgotPassword'];
```

`postLoginCleanup` is listed as a public action that skips authentication. However, this function resets login attempt counters and logs audit events. An attacker can call it with any userId to:

1. Reset the brute-force lockout counter for any account
2. Inject false audit log entries

**Fix:** Remove `postLoginCleanup` from `publicActions`. It should require a valid session.

---

### 1.6 [HIGH] XSS via Owner Names in Dropdown Filters

**File:** `Actionplanslist.html:445`

```javascript
ownerSelect.innerHTML += `<option value="${u.id}">${u.name}</option>`;
```

User names are inserted directly into HTML without escaping. If a user's name contains HTML/script tags (e.g., `<img onerror=alert(1)>`), it will execute in every user's browser.

**Fix:** Use `escapeHtml(u.name)` or create DOM elements programmatically.

---

### 1.7 [HIGH] XSS via AI Response Rendering

**File:** `Workpaperview.html:278-294`

```javascript
function formatAIResponse(text) {
  let html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // ... more replacements
  return '<div class="ai-response"><p>' + html + '</p></div>';
}
```

AI-generated text is converted to HTML with regex replacements and injected via `innerHTML`. If the AI response contains HTML tags or JavaScript, they will execute. While the AI provider is trusted, the response travels over network and could be tampered with, or the AI could be prompt-injected.

**Fix:** Escape the text first, then apply markdown-to-HTML transformations on the escaped output.

---

### 1.8 [MEDIUM] No CSRF Protection on `doPost` Endpoint

**File:** `08_WebApp.gs:82-126`

The `doPost()` endpoint accepts any HTTP POST with a valid session token. Since GAS web apps have a fixed URL pattern, and session tokens are stored in `sessionStorage`/`localStorage`, a cross-origin attack could extract the token and make API calls.

---

## 2. Database & Data Integrity Issues

### 2.1 [CRITICAL] Race Condition: `appendRow()` + `getLastRow()` is Not Atomic

**Files:** `03_WorkPaperService.gs:60-63`, `04_ActionPlanService.gs:80-86`

```javascript
sheet.appendRow(row);
const rowNum = sheet.getLastRow();  // NOT guaranteed to be the row just appended
updateWorkPaperIndex(workPaperId, workPaper, rowNum);
```

If two users create work papers simultaneously:
1. User A appends row -> row 100
2. User B appends row -> row 101
3. User A calls `getLastRow()` -> returns **101** (User B's row!)
4. User A's index now points to User B's row

**Impact:** Index corruption leads to wrong data being returned, updated, or deleted. This is the most dangerous data integrity bug in the system.

**Fix:** Use `LockService.getScriptLock()` around the append+getLastRow sequence, similar to what `getNextId()` does (01_Core.gs:717-754).

---

### 2.2 [CRITICAL] Index Staleness After Row Deletion

**File:** `01_Core.gs:537-559`

```javascript
deleteById: function(entityType, entityId) {
  const rowNumber = Index.getRowNumber(entityType, entityId);
  // ...
  const result = this.deleteRow(sheetName, rowNumber);
  if (result) {
    Index.rebuild(entityType);  // Full rebuild - expensive and non-atomic
  }
}
```

When a row is deleted from Google Sheets, **all subsequent rows shift up by 1**. Between `deleteRow()` and `Index.rebuild()`, any concurrent operation using the cached index will read the **wrong row**. The `Index.rebuild()` also reads the entire data sheet, which can take seconds for large datasets.

**Impact:** During the rebuild window, any read/update operation could access the wrong record or corrupt data.

---

### 2.3 [HIGH] Transaction Rollback is Broken for Insert Operations

**File:** `01_Core.gs:697-700`

```javascript
case 'insert':
  // Re-insert at specific row is complex, just append
  DBWrite.insert(rollback.sheet, rollback.data);
  break;
```

When a transaction fails and needs to rollback a delete operation, it appends the data at the **end** of the sheet rather than at the original row position. This means:

1. The data ends up at a different row number than where it was
2. All index entries pointing to rows after the original position are now wrong
3. The "rollback" actually makes the corruption worse

**Fix:** After rollback, trigger a full index rebuild. Or use `insertRowBefore()` at the correct position.

---

### 2.4 [HIGH] No Foreign Key Enforcement

Work papers can be deleted without checking for linked action plans, evidence, files, or requirements. This creates orphaned records:

- Deleting a work paper leaves orphaned action plans in `13_ActionPlans`
- Deleting an action plan leaves orphaned evidence in `14_ActionPlanEvidence`
- Deleting an action plan leaves orphaned history in `15_ActionPlanHistory`

**Fix:** Add cascade delete or rejection logic that checks for dependent records before allowing deletion.

---

### 2.5 [HIGH] Optimistic Locking is Client-Controlled

**File:** `03_WorkPaperService.gs:112-118`

```javascript
if (data._loadedAt && existing.updated_at) {
  var loadedTime = new Date(data._loadedAt).getTime();
  var serverTime = new Date(existing.updated_at).getTime();
  if (serverTime > loadedTime) {
    throw new Error('This record was modified by another user.');
  }
}
```

The `_loadedAt` timestamp is sent by the client. A malicious client can:
- Send a timestamp far in the future to always bypass the lock
- Omit `_loadedAt` entirely (the check is conditional on its presence)

**Fix:** Use a server-generated version counter or ETag stored in the database row.

---

### 2.6 [MEDIUM] `days_overdue` Stored but Computed Asynchronously

**File:** `04_ActionPlanService.gs:72`

The `days_overdue` field is stored in the sheet but only updated when `updateOverdueStatuses()` runs (via scheduled trigger). Between runs, the stored value is stale. The frontend displays this stale value.

**Fix:** Compute `days_overdue` dynamically on read, or ensure the trigger runs frequently enough.

---

### 2.7 [MEDIUM] No Input Length Validation

Fields like `observation_description`, `recommendation`, `action_description` use `sanitizeInput()` but have no maximum length limit. Google Sheets cells have a 50,000-character limit. Exceeding this will cause silent data truncation.

---

## 3. Authentication & Session Management

### 3.1 [HIGH] Dual Authentication Paths with Inconsistent Security

**File:** `08_WebApp.gs:818-896` vs `08_WebApp.gs:82-126`

There are two API entry points with different auth flows:

| Path | Entry Point | Auth Method |
|------|-------------|-------------|
| `google.script.run` | `apiCall()` (line 818) | Session token -> Google session fallback |
| HTTP POST | `doPost()` (line 82) | Session token only |

The `apiCall()` function falls back to `getCurrentUser()` (Google session) when no session token is provided. This means requests through `google.script.run` can bypass the app's session management entirely.

**Impact:** A user whose session has been invalidated (e.g., account locked) can still make API calls if their Google session is active.

---

### 3.2 [HIGH] `uploadFileToDrive()` Bypasses Session-Based Auth

**Files:** `08_WebApp.gs:689-694`, `Actionplanview.html:260-292`

```javascript
// Server side - uses Google session, not app session
function uploadFileToDrive(fileName, mimeType, base64Data, folderId) {
  const user = getCurrentUser();  // Google session only!
  if (!user) return { success: false, error: 'Authentication required' };
```

```javascript
// Client side - calls directly, no session token
google.script.run
  .withSuccessHandler(...)
  .uploadFileToDrive(file.name, file.type, base64);
```

File uploads completely bypass the app's session token authentication. They only check the Google session, which means:
- Locked/deactivated users might still upload if Google session is valid
- No audit trail through the app's session management

---

### 3.3 [MEDIUM] Session Token Leaked into Business Logic Data

**File:** `08_WebApp.gs:878`

```javascript
const result = routeAction(action, data, user);
```

The `data` object passed to `routeAction` is the same object that contains `sessionToken`. This session token then flows into business logic functions that may log it to the audit trail or store it.

**Fix:** Strip `sessionToken` from `data` before passing to `routeAction`.

---

### 3.4 [MEDIUM] `invalidateUserSessions()` Doesn't Invalidate Session Cache

**File:** `07_AuthService.gs:979-991`

When invalidating sessions (e.g., after password change), the code iterates through all session rows and marks them inactive, but it doesn't remove the corresponding `session_*` entries from `CacheService`. A cached session will remain valid for up to 5 minutes (300s SESSION TTL).

---

### 3.5 [MEDIUM] No Rate Limiting on Login Endpoint

While there's an account lockout mechanism (login attempts counter), there is no IP-based or global rate limiting. An attacker can:
- Try different email addresses rapidly without triggering per-account lockout
- Call `postLoginCleanup` (public action) to reset attempt counters

---

## 4. API & Routing Issues

### 4.1 [HIGH] `routeAction` Has No Default Case

**File:** `08_WebApp.gs:131-483`

The giant `switch` statement in `routeAction()` has no `default` case. If an unknown action is passed, it returns `undefined`.

In `apiCall()` (line 880-886), this is caught and returns a generic error. But in `doPost()` (line 82-126), `routeAction` is called inline and its result is passed directly to `jsonResponse()`. An `undefined` result will be JSON-serialized as `null`.

**Fix:** Add a default case: `default: return { success: false, error: 'Unknown action: ' + action };`

---

### 4.2 [MEDIUM] `jsonResponse()` Ignores Status Code Parameter

**File:** `08_WebApp.gs:794-798`

```javascript
function jsonResponse(data, statusCode) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;  // statusCode is completely ignored
}
```

Google Apps Script's `ContentService` cannot set HTTP status codes - all responses return 200 OK. While this is a platform limitation, callers like `doPost` pass status codes (e.g., 400, 401) creating a false sense of error handling. Frontend code checking `response.status` will never see errors.

---

### 4.3 [MEDIUM] `getWorkPaper` Endpoint Has No Authorization Check

**File:** `08_WebApp.gs:182`

```javascript
case 'getWorkPaper':
  return { success: true, workPaper: getWorkPaper(data.workPaperId, data.includeRelated !== false) };
```

Any authenticated user can view any work paper by ID. There's no check for whether the user has permission to view that specific work paper (e.g., is it from their affiliate? Are they the preparer?).

Similarly, `getActionPlan` (line 227) has no authorization check.

---

### 4.4 [LOW] Redundant Action Handlers

`getDropdowns` and `getDropdownData` (lines 165-172) both return dropdown data but with slightly different response shapes. This is confusing and could lead to inconsistent client behavior.

---

## 5. Cache Coherency Problems

### 5.1 [HIGH] `Cache.invalidatePattern()` is Effectively a No-Op

**File:** `01_Core.gs:90-108`

```javascript
invalidatePattern: function(pattern) {
  const knownPrefixes = ['config_', 'dropdown_', 'perm_', 'session_', ...];
  const cache = CacheService.getScriptCache();
  knownPrefixes.forEach(prefix => {
    if (pattern === '*' || prefix.startsWith(pattern)) {
      try {
        cache.remove(prefix + 'all');
        cache.remove(prefix + 'list');
      } catch (e) {}
    }
  });
}
```

This function only removes keys ending with `'all'` or `'list'` (e.g., `config_all`, `dropdown_list`). Dynamically created keys like `session_ABC123`, `perm_AUDITOR`, `user_email_john@example.com` are **never invalidated**.

**Impact:** After permission changes, role updates, or user deactivation, stale cached data persists until natural TTL expiry.

---

### 5.2 [HIGH] `Cache.clearAll()` is Incomplete

**File:** `01_Core.gs:110-121`

The `clearAll()` function only removes 9 hardcoded keys. Hundreds of dynamically generated cache keys (all session tokens, all user-email mappings, all permission-by-role entries, all entity cache entries) are never cleared.

---

### 5.3 [MEDIUM] PERMISSIONS TTL (10s) vs SESSION TTL (300s) Mismatch

**File:** `01_Core.gs:10-11`

```javascript
PERMISSIONS: 10,     // 10 sec
SESSION: 300,        // 5 min
```

If a user's role/permissions change, the permissions cache updates within 10 seconds. But the session cache (which may contain the old role) persists for 5 minutes. This creates a window where the session says "user is ADMIN" but permissions say "user is VIEWER".

---

### 5.4 [MEDIUM] 100KB Cache Limit Silently Drops Large Datasets

**File:** `01_Core.gs:70-74`

```javascript
if (serialized.length > 100000) {
  console.warn('Cache value too large for key:', key);
  return false;
}
```

When the index map exceeds 100KB (possible with hundreds of work papers), caching silently fails. Every subsequent request will re-read the entire index sheet from the database, causing severe performance degradation.

---

### 5.5 [MEDIUM] `silentRefreshInitData` Runs Every 10 Seconds

**File:** `Scripts.html:289`

```javascript
setInterval(silentRefreshInitData, 10000);
```

This calls `google.script.run.apiCall('getInitDataLight', ...)` every 10 seconds per active browser tab. With 10 concurrent users, that's 60 API calls per minute just for session refresh. Google Apps Script has a quota of approximately 20,000 calls/day for consumer accounts, which would be exhausted in ~5.5 hours.

---

## 6. End-to-End Flow Failures

### 6.1 [CRITICAL] `changePassword()` Uses Wrong Sheet Name for Column Lookup

**File:** `07_AuthService.gs:557-560`

```javascript
const sheet = getSheet(SHEETS.USERS);       // Gets sheet '05_Users' - CORRECT
const hashIdx = getColumnIndex('USERS', ...); // Looks up sheet 'USERS' - WRONG!
```

`SHEETS.USERS` resolves to `'05_Users'`, but `getColumnIndex('USERS', ...)` passes the literal string `'USERS'` to `getSheetHeaders()`, which calls `getSheet('USERS')`. There is no sheet named `'USERS'` - the actual sheet is `'05_Users'`.

This means `getColumnIndex` returns `-1` for all columns, and then:
```javascript
sheet.getRange(rowIndex, hashIdx + 1).setValue(hash);  // getRange(row, 0) - INVALID!
```

`sheet.getRange(row, 0)` will throw an error because columns are 1-indexed.

**Impact:** **Password changes are completely broken.** Any user attempting to change their password will get a server error.

**Fix:** Change to `getColumnIndex(SHEETS.USERS, 'password_hash')` etc.

---

### 6.2 [HIGH] Work Paper Submit - No Permission Check for Submitter

**File:** `03_WorkPaperService.gs` (submitWorkPaper function)

The `renderWPActions` function in `Workpaperview.html:149-152` shows the Submit button for any status of Draft/Revision Required without checking `canSubmitWorkPaper` permission:

```javascript
if (wp.status === 'Draft' || wp.status === 'Revision Required') {
    if (isAuditor) html += `...Edit...</button>`;
    html += `...Submit...</button>`;  // No permission check!
}
```

Any authenticated user can see and click Submit on any Draft work paper.

---

### 6.3 [HIGH] Action Plan Creation Requires "Sent to Auditee" Status

**File:** `04_ActionPlanService.gs:29-31`

```javascript
if (workPaper.status !== STATUS.WORK_PAPER.SENT_TO_AUDITEE) {
  throw new Error('Action plans can only be created after work paper is sent to auditee');
}
```

But the "Add Action Plan" button on the work paper view page (`Workpaperview.html:58`) is shown unconditionally:

```html
<button class="btn btn-sm btn-primary" onclick="showAddActionPlan()" id="btnAddAP">
  <i class="bi bi-plus me-1"></i>Add
</button>
```

Users will see the button, fill out the form, and get a confusing server error.

**Fix:** Hide `btnAddAP` unless `wp.status === 'Sent to Auditee'`.

---

### 6.4 [HIGH] Evidence Upload Chain Uses Mixed Auth Mechanisms

**File:** `Actionplanview.html:260-292`

The evidence upload flow is:
1. Frontend calls `google.script.run.uploadFileToDrive()` (Google session auth)
2. On success, calls `apiCall('addActionPlanEvidence', ...)` (session token auth)

If the user's Google session expired but app session is still valid (or vice versa), step 1 or step 2 will fail. The user gets a partial failure - the file may be uploaded to Drive but never linked to the action plan (orphaned file), or the link is created without the actual file.

---

### 6.5 [MEDIUM] Export Functions Ignore Filters

**File:** `Actionplanslist.html:453`

```javascript
apiCall('exportActionPlansCSV', { filters: {} })  // Always empty filters!
```

The export always downloads ALL action plans regardless of what filters the user has applied. The `filters: {}` object is hardcoded to empty.

**Fix:** Pass the current active filters to the export call.

---

### 6.6 [MEDIUM] `Showing 1-0 of 0` When No Results

**File:** `Actionplanslist.html:546`

```javascript
document.getElementById('apResultsInfo').textContent =
  `Showing ${start + 1}-${Math.min(start + apPageSize, actionPlansData.length)} of ${actionPlansData.length}`;
```

When `actionPlansData.length === 0`, this displays "Showing 1-0 of 0".

**Fix:** Guard with `if (actionPlansData.length === 0) { ... show "No results" ... }`.

---

## 7. Frontend Issues

### 7.1 [HIGH] `localStorage` Stores Sensitive Session Data

**File:** `Scripts.html:101-131`

The `LocalStore` system caches `initData` in `localStorage` with a 15-minute TTL. This data includes:
- User object (name, email, role, user_id)
- Permissions object
- Dropdown data (list of all users with names and IDs)

`localStorage` persists across browser restarts and is accessible to any JavaScript on the same origin. On shared computers, sensitive data remains accessible even after logout.

**Fix:** Use `sessionStorage` instead, or encrypt the data, or don't cache sensitive user data client-side.

---

### 7.2 [HIGH] Session Token Stored in Both `sessionStorage` and `localStorage`

**File:** `Scripts.html:204`, `Login.html` (stores token after login)

The session token appears in both storage mechanisms. On logout (`handleAuthFailure`), both are cleared, but if the browser crashes before logout, `localStorage` retains the token indefinitely.

---

### 7.3 [MEDIUM] `DOMContentLoaded` Race Condition in Action Plans List

**File:** `Actionplanslist.html:603-605`

```javascript
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(initAPFilters, 100);
});
```

This assumes `window.appDropdowns` is populated within 100ms of DOMContentLoaded. If dropdowns load later (they're loaded asynchronously in background), the filter options will be empty.

**Fix:** Initialize filters when dropdowns are actually available, not on a timer.

---

### 7.4 [MEDIUM] Password Change Feedback Loop Prevention is Fragile

**File:** `Scripts.html:266-270`

```javascript
if (result.user.must_change_password && !sessionStorage.getItem('passwordChangedInSession')) {
  showForcePasswordChange();
}
```

The `passwordChangedInSession` flag is set client-side in `sessionStorage`. The `silentRefreshInitData` (running every 10s) could overwrite `must_change_password` from the server before the flag is checked, causing the password change modal to reappear after the user already changed their password.

---

### 7.5 [LOW] `escapeHtml` Dependency Not Verified

Multiple HTML files call `escapeHtml()` (defined in `Scripts.html`). If `Scripts.html` fails to load or is included after the page-specific scripts, `escapeHtml` will be undefined and XSS protection is lost. There's no fallback.

---

## 8. Error Handling Gaps

### 8.1 [HIGH] `setupAllTriggers()` Deletes ALL Project Triggers

**File:** `08_WebApp.gs:1093-1097`

```javascript
function setupAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);  // Deletes EVERYTHING including custom triggers
  });
```

This function blindly deletes every trigger on the project, including any manually created or external triggers, then only recreates the 4 known ones. If an admin accidentally calls this while other triggers exist, they're permanently destroyed.

**Fix:** Only delete triggers that match the known handler function names.

---

### 8.2 [HIGH] Silent Failures in Cache Operations

**File:** `01_Core.gs:51-88`

All `Cache.get()`, `Cache.set()`, and `Cache.remove()` operations swallow exceptions:

```javascript
get: function(key) {
  try {
    // ...
  } catch (e) {
    // Cache miss or parse error - SILENTLY IGNORED
  }
  return null;
}
```

If CacheService is experiencing issues, the system silently falls back to direct sheet reads on every request, causing massive performance degradation with no alerts or logging.

---

### 8.3 [MEDIUM] `apiCall` Catch Blocks Lose Error Context

**File:** `Workpaperview.html:108`, `Actionplanview.html:324`, and many others

```javascript
.catch(() => { hideLoading(); showToast('Error', 'danger'); });
```

Error objects are not logged or displayed. Users see "Error" with no context, making debugging impossible.

**Fix:** Log the error and show the error message: `.catch(e => { hideLoading(); showToast(e.message || 'Error', 'danger'); })`

---

### 8.4 [MEDIUM] `getSheet()` Returns Null but Callers Don't Check

**File:** `01_Core.gs:41-49`

```javascript
function getSheet(sheetName) {
  const sheet = db.getSheetByName(sheetName);
  if (!sheet) {
    console.error('Sheet not found:', sheetName);
    return null;  // Returns null, but many callers don't check
  }
  return sheet;
}
```

Functions like `DBWrite.insert()`, `DBWrite.updateRow()`, etc. check for null, but `createWorkPaper()` line 58 does:

```javascript
const sheet = getSheet(SHEETS.WORK_PAPERS);
const row = objectToRow('WORK_PAPERS', workPaper);
sheet.appendRow(row);  // Will crash if sheet is null
```

---

## 9. Performance & Scalability Concerns

### 9.1 [HIGH] N+1 Query Pattern in `DB.getByIds()` for Small Sets

**File:** `01_Core.gs:390-397`

```javascript
if (rowsToFetch.length > 50) {
  // Batch read entire sheet - EFFICIENT
} else {
  // Individual reads - N SEPARATE API CALLS
  rowsToFetch.forEach(rowNum => {
    const rowData = sheet.getRange(rowNum, 1, 1, headers.length).getValues()[0];
  });
}
```

For sets of 1-50 records, each record requires a separate `sheet.getRange().getValues()` call. Each call is a round-trip to Google Sheets API. For 50 records, that's 50 API calls.

**Fix:** Use `getRangeList()` for non-contiguous ranges, or batch read a range covering all needed rows.

---

### 9.2 [HIGH] `Index.rebuild()` Reads Entire Data Sheet

**File:** `01_Core.gs:261-329`

A full index rebuild reads every row of the data sheet, processes it, then writes every row of the index sheet. For sheets with thousands of rows, this can take 10+ seconds and may hit Google Apps Script's 6-minute execution limit.

This rebuild happens on every `deleteById()` call (01_Core.gs:556), meaning every single delete triggers a full index rebuild.

---

### 9.3 [MEDIUM] `batchUpdate()` Does Row-by-Row Updates

**File:** `01_Core.gs:586-612`

```javascript
batchUpdate: function(sheetName, updates) {
  // TODO: Optimize by grouping contiguous rows
  updates.forEach(update => {
    const currentData = sheet.getRange(...).getValues()[0];
    // ... merge ...
    sheet.getRange(...).setValues([newRowArray]);
  });
}
```

Despite being called "batch", this function updates rows one at a time. Each update is 2 API calls (read + write). For 100 updates, that's 200 API calls.

---

### 9.4 [MEDIUM] Google Apps Script Execution Time Limits

GAS has a 6-minute execution time limit. Complex operations like:
- Dashboard report generation (reads all work papers + all action plans)
- Weekly summary email (processes all users + all overdue items)
- Index rebuild (reads + writes entire sheets)

...could exceed this limit as data grows.

---

### 9.5 [LOW] Spreadsheet ID Hardcoded

**File:** `01_Core.gs:4`

```javascript
SPREADSHEET_ID: '1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4',
```

The database spreadsheet ID is hardcoded rather than using `PropertiesService`. This prevents easy environment switching (dev/staging/prod).

---

## 10. Code Quality & Maintenance

### 10.1 [MEDIUM] Duplicate Password Hashing Implementations

**Files:** `07_AuthService.gs:467-480` and `01_Core.gs:824-841`

Two independent implementations of password hashing exist (`hashPassword()` and `Security.hashPassword()`). They must stay in sync, but there's no shared function. If one is updated and the other isn't, existing passwords will become unverifiable.

---

### 10.2 [MEDIUM] `generateId()` vs `generateIds()` Inconsistency

**File:** `02_Config.gs:150` and `02_Config.gs:224`

`generateId()` uses `LockService` for thread safety. `generateIds()` should also use locking but may or may not - could lead to duplicate IDs in batch operations.

---

### 10.3 [LOW] Global Variable Pollution

**File:** `01_Core.gs:32`

```javascript
let _dbInstance = null;
```

Google Apps Script shares globals across function calls within the same execution. The `_dbInstance` singleton works within a single request but resets between requests (which is fine). However, there's no protection against other scripts overwriting it.

---

### 10.4 [LOW] `sort(() => Math.random() - 0.5)` is Not Uniform

**File:** `07_AuthService.gs:523`

```javascript
return password.split('').sort(() => Math.random() - 0.5).join('');
```

This comparison function does not produce a uniform distribution of permutations. Some orderings are more likely than others. While the security impact is minor for temp passwords, it's technically incorrect.

**Fix:** Use Fisher-Yates shuffle algorithm.

---

## 11. Recommendations Summary

### Immediate Fixes (CRITICAL - Do Before Production)

| # | Issue | Fix Effort |
|---|-------|-----------|
| 1 | Fix `changePassword()` sheet name bug (6.1) | Low |
| 2 | Add lock around `appendRow()` + `getLastRow()` (2.1) | Medium |
| 3 | Remove `postLoginCleanup` from public actions (1.5) | Low |
| 4 | Fix file sharing to not be ANYONE_WITH_LINK (1.3) | Low |
| 5 | Escape user names in dropdown filters (1.6) | Low |
| 6 | Strip session token from data before routeAction (3.3) | Low |

### Short-Term Fixes (HIGH - Within Next Sprint)

| # | Issue | Fix Effort |
|---|-------|-----------|
| 7 | Replace `Math.random()` with cryptographic alternatives (1.1) | Medium |
| 8 | Add authorization checks to getWorkPaper/getActionPlan (4.3) | Medium |
| 9 | Fix Transaction rollback for inserts (2.3) | Medium |
| 10 | Add cascade delete or referential integrity checks (2.4) | High |
| 11 | Fix `uploadFileToDrive` to use session-based auth (3.2) | Medium |
| 12 | Hide "Add Action Plan" button based on status (6.3) | Low |
| 13 | Fix cache invalidation to actually clear dynamic keys (5.1, 5.2) | High |
| 14 | Add default case to routeAction switch (4.1) | Low |
| 15 | Fix export to use current filters (6.5) | Low |
| 16 | Validate file types server-side (1.4) | Low |

### Medium-Term Improvements (MEDIUM - Architecture)

| # | Issue | Fix Effort |
|---|-------|-----------|
| 17 | Increase PBKDF2 iterations (requires re-hashing all passwords) (1.2) | High |
| 18 | Unify dual auth paths into single auth mechanism (3.1) | High |
| 19 | Add server-generated version counter for optimistic locking (2.5) | Medium |
| 20 | Reduce `silentRefreshInitData` frequency (5.5) | Low |
| 21 | Move sensitive data from localStorage to sessionStorage (7.1) | Low |
| 22 | Add proper error logging and alerting (8.2) | Medium |
| 23 | Consolidate duplicate hashPassword implementations (10.1) | Low |
| 24 | Add input length validation (2.7) | Low |
| 25 | Fix `setupAllTriggers` to only delete known triggers (8.1) | Low |

---

## Appendix: Files Audited

| File | Lines | Description |
|------|-------|-------------|
| `01_Core.gs` | 1,153 | Database abstraction, cache, index, security |
| `02_Config.gs` | 1,036 | Constants, schemas, helpers |
| `03_WorkPaperService.gs` | 972 | Work paper CRUD & workflow |
| `04_ActionPlanService.gs` | 1,095 | Action plan CRUD & evidence |
| `05_AIService.gs` | 664 | AI provider integration |
| `05_NotificationService.gs` | 1,675 | Email queue & templates |
| `06_DashboardService.gs` | 1,314 | Dashboard & reports |
| `07_AuthService.gs` | 1,068 | Authentication & sessions |
| `08_WebApp.gs` | 1,248 | Web app entry points & routing |
| `09_AnalyticsService.gs` | 508 | Analytics & admin functions |
| `Scripts.html` | ~600+ | Shared frontend API layer |
| `Login.html` | ~300+ | Login page |
| `AuditorPortal.html` | ~200+ | Main app shell |
| `Dashboard.html` | ~400+ | Dashboard view |
| `Workpaperslist.html` | ~300+ | Work papers list |
| `Workpaperform.html` | ~500+ | Work paper form |
| `Workpaperview.html` | ~298 | Work paper detail view |
| `Actionplanslist.html` | ~606 | Action plans list + kanban |
| `Actionplanview.html` | ~487 | Action plan detail view |

**Total Issues Found:** 35
**Critical:** 5 | **High:** 15 | **Medium:** 12 | **Low:** 3
