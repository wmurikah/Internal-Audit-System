# Hass Petroleum Internal Audit System — Comprehensive Codebase Analysis

**Date:** 2026-02-06
**Analyst:** Claude Code (Automated Analysis)

---

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Who Sends What — Complete Data Flow](#2-who-sends-what)
3. [Approval Workflows](#3-approval-workflows)
4. [What Is Working](#4-what-is-working)
5. [What Is Not Working / Placeholder / Incomplete](#5-what-is-not-working)
6. [Redundancies](#6-redundancies)
7. [Security Concerns](#7-security-concerns)
8. [Architecture Diagram](#8-architecture-diagram)
9. [Summary Scorecard](#9-summary-scorecard)

---

## 1. System Overview

- **Platform:** Google Apps Script (GAS) deployed as a web app
- **Database:** Google Sheets (23 sheets acting as relational tables)
- **Frontend:** Vanilla HTML/CSS/JS SPA with Bootstrap 5.3, Chart.js
- **Total Size:** ~19,900+ lines across 10 `.gs` backend files and 14 `.html` frontend files
- **Architecture:** Single POST endpoint (`doPost`) with action-based routing to service functions
- **Roles:** 11 roles (SUPER_ADMIN, SENIOR_AUDITOR, JUNIOR_STAFF, AUDITOR, AUDITEE, MANAGEMENT, SENIOR_MGMT, UNIT_MANAGER, BOARD, EXTERNAL_AUDITOR, OBSERVER)

### Backend Files (10 .gs files)
| File | Purpose |
|------|---------|
| `00_CacheWarmer` | Cache preloading, warming, permission checks |
| `01_Core.gs` | Database abstraction (Cache, Index, DB, DBWrite, Transaction), Security |
| `02_Config.gs` | Constants, schemas, status workflows, role definitions, dropdowns |
| `03_WorkPaperService.gs` | Work Paper CRUD, requirements, files, revisions, notifications |
| `04_ActionPlanService.gs` | Action Plan CRUD, workflow, evidence, history, overdue tracking |
| `05_AIService.gs` | AI API integration (OpenAI, Anthropic, Google AI) |
| `05_NotificationService.gs` | Email queue, templates, reminders, alerts |
| `06_DashboardService.gs` | Dashboard statistics, charts, role-based views |
| `07_AuthService.gs` | Authentication, session management, password management, user CRUD |
| `08_WebApp.gs` | Web app entry points (doGet/doPost), API router, file upload |
| `09_AnalyticsService.gs` | Analytics aggregation, trend analysis, metrics |

### Frontend Files (14 .html files)
| File | Purpose |
|------|---------|
| `Login.html` | Login page with authentication UI |
| `AuditorPortal.html` | Main SPA shell with sidebar navigation |
| `Dashboard.html` | Dashboard with stats, charts, alerts |
| `Workpaperslist.html` | Work papers list with filters, table/card views |
| `Workpaperform.html` | Multi-tab work paper form (6 tabs) |
| `Workpaperview.html` | Work paper detail view with AI insights |
| `Actionplanslist.html` | Action plans list with table/kanban views |
| `Actionplanview.html` | Action plan detail view with verification panel |
| `Analytics.html` | Analytics & insights dashboard with charts |
| `Settings.html` | System settings (users, access control, AI config, audit log) |
| `Reports.html` | Reports page (summary, aging, risk) |
| `Modals.html` | Reusable modal dialogs |
| `Scripts.html` | Shared JavaScript (API calls, state management, UI logic) |
| `Styles.html` | Shared CSS styles |

### Database (23 Google Sheets)
```
00_Config, 01_Roles, 02_Permissions, 03_FieldDefinitions, 04_StatusWorkflow,
05_Users, 06_Affiliates, 07_AuditAreas, 08_ProcessSubAreas,
09_WorkPapers, 10_WorkPaperRequirements, 11_WorkPaperFiles, 12_WorkPaperRevisions,
13_ActionPlans, 14_ActionPlanEvidence, 15_ActionPlanHistory,
16_AuditLog, 17_Index_WorkPapers, 18_Index_ActionPlans, 19_Index_Users,
20_Sessions, 21_NotificationQueue, 22_EmailTemplates, 23_StagingArea
```

---

## 2. Who Sends What

### Login Flow
```
Login.html → apiCall('login', {email, password})
  → 08_WebApp.gs:doPost() → routeAction('login')
    → 07_AuthService.gs:login()
      → Looks up user in 05_Users sheet (cached)
      → Verifies PBKDF2-SHA256 hash
      → Creates session in 20_Sessions sheet
      → Returns: {user, permissions, dropdowns, sessionToken}
  ← Client stores sessionToken in sessionStorage
  ← Client stores initData in sessionStorage for Tier-0 instant load
```

### Post-Login Initialization (3-tier progressive load)
```
AuditorPortal.html loads → Scripts.html:initApp()
  TIER 0: sessionStorage.loginInitData (from login response, one-time use)
  TIER 1: window.__INIT_DATA__ (SSR baked into HTML by doGet)
  TIER 2: localStorage (from previous visit, silently refreshed)
  TIER 3: apiCall('getInitDataLight') → falls back to API

  → Background parallel loads:
    apiCall('getDropdowns') → affiliates, areas, sub-areas, users
    apiCall('getSidebarCounts') → pending reviews, overdue APs
    apiCall('getDashboardData') → stats, charts, activity, alerts
```

### Work Paper Lifecycle
```
AUDITOR (creator):
  → createWorkPaper(data) → Status: DRAFT
  → updateWorkPaper(id, data) → Edits draft
  → addWorkPaperFile(id, fileData) → Attaches evidence via Google Drive
  → addWorkPaperRequirement(id, data) → Adds info requests
  → submitWorkPaper(id) → Status: SUBMITTED
     ↳ System queues email to SENIOR_AUDITOR/SUPER_ADMIN reviewers

SENIOR_AUDITOR / SUPER_ADMIN (reviewer):
  → reviewWorkPaper(id, 'approve', comments) → Status: APPROVED
  → reviewWorkPaper(id, 'return', comments) → Status: REVISION_REQUIRED
     ↳ System queues email back to preparer
  → sendToAuditee(id) → Status: SENT_TO_AUDITEE
     ↳ System queues email to responsible_ids (auditees)

AUDITEE (responds):
  → Sees work paper in their dashboard (filtered by responsible_ids)
  → Creates action plans via createActionPlan() / createActionPlansBatch()
```

### Action Plan Lifecycle
```
AUDITEE / AUDITOR (creator):
  → createActionPlan({work_paper_id, description, owner_ids, due_date})
     → Status: NOT_DUE (if due_date > today) or PENDING (if due_date <= today)

AUDITEE (owner):
  → updateActionPlan(id, {implementation_notes})
  → markAsImplemented(id, notes) → Status: IMPLEMENTED
     ↳ System queues email to auditors for verification

AUDITOR / SENIOR_AUDITOR (verifier):
  → verifyImplementation(id, 'approve', comments) → Status: VERIFIED
  → verifyImplementation(id, 'reject', comments) → Status: REJECTED
  → verifyImplementation(id, 'return', comments) → Status: IN_PROGRESS

SUPER_ADMIN (HOA final review):
  → hoaReview(id, 'approve'/'reject', comments) → hoa_review_status updated

SYSTEM (daily trigger at 6 AM):
  → updateOverdueStatuses() → Moves NOT_DUE→PENDING, sets OVERDUE
  → sendOverdueReminders() → Emails grouped by owner
  → sendUpcomingDueReminders() → 7/3/1-day warnings
  → cleanupOldNotifications() → Purges sent emails >30 days

SYSTEM (Monday 8 AM):
  → sendWeeklySummary() → Stats email to management
```

### Notification Queue Processing
```
Any service → queueEmail()/queueNotification() → 21_NotificationQueue (status: PENDING)
  ↓ (every 10 minutes)
processEmailQueue() → Reads up to 50 PENDING rows
  → MailApp.sendEmail() for each
  → Updates status to SENT or FAILED
  → Retries up to 3 times for failures
```

---

## 3. Approval Workflows

### Work Paper Approval
```
            ┌─────────────────────────────────────────────────────────┐
            │                                                         │
  DRAFT ──→ SUBMITTED ──→ UNDER_REVIEW ──→ APPROVED ──→ SENT_TO_AUDITEE
                              │       ↑
                              ▼       │
                        REVISION_REQUIRED
```
- **Submit**: Requires observation_title, observation_description, risk_rating, recommendation
- **Review**: Only SUPER_ADMIN or SENIOR_AUDITOR can review
- **Send to Auditee**: Only from APPROVED status, requires responsible_ids assigned

### Action Plan Approval (Two-Stage Verification)
```
  NOT_DUE ──→ PENDING ──→ IN_PROGRESS ──→ IMPLEMENTED
     (auto)     (auto)                         │
                                               ▼
                                      ┌─── VERIFICATION ───┐
                                      │                     │
                                      ▼                     ▼
                                  VERIFIED              REJECTED
                                      │
                                      ▼
                                  HOA REVIEW (optional)
                                      │
                                      ▼
                                   CLOSED
```

---

## 4. What Is Working

| Feature | Status | Files |
|---------|--------|-------|
| Login/Logout with session tokens | Working | 07_AuthService.gs, Login.html |
| Password hashing (PBKDF2-SHA256) | Working | 07_AuthService.gs |
| Account lockout (5 attempts/30min) | Working | 07_AuthService.gs |
| Force password change on first login | Working | Scripts.html |
| Role-based access control (11 roles) | Working | 02_Config.gs, 00_CacheWarmer |
| Work Paper CRUD | Working | 03_WorkPaperService.gs |
| Work Paper submission/review workflow | Working | 03_WorkPaperService.gs |
| Action Plan CRUD + batch create | Working | 04_ActionPlanService.gs |
| Action Plan implementation + verification | Working | 04_ActionPlanService.gs |
| File upload to Google Drive | Working | 03/04_*Service.gs |
| Email notification queue | Working | 05_NotificationService.gs |
| Dashboard with role-based views | Working | 06_DashboardService.gs |
| Audit logging of all actions | Working | 01_Core.gs |
| Multi-tier caching (Script cache) | Working | 01_Core.gs |
| Index-based fast lookups | Working | 01_Core.gs |
| User management (CRUD, activate/deactivate) | Working | 07_AuthService.gs |
| AI-powered insights (3 providers) | Working (needs API keys) | 05_AIService.gs |
| Settings page (users, permissions, AI) | Working | Settings.html |
| 3-tier instant load engine | Working | Scripts.html |
| Responsive UI (mobile/tablet/desktop) | Working | Styles.html |

---

## 5. What Is Not Working / Placeholder / Incomplete

### 5.1 Non-Existent / Never-Called Functions

| Function | File:Line | Problem |
|----------|-----------|---------|
| `getPermissionsFresh()` | 06_DashboardService.gs:859 | Called but NEVER defined; typeof guard always falls back |
| `prewarmUserCache()` | 07_AuthService.gs:222 | Defined but NEVER called from any code path |
| `updateLastLoginAsync()` | 07_AuthService.gs:255 | Defined but NEVER called; last_login may not update |

### 5.2 Placeholder Fields (Always Empty)

| Field | Sheet | Reason |
|-------|-------|--------|
| `ip_address` | 20_Sessions | GAS cannot reliably get client IP |
| `user_agent` | 20_Sessions | Same limitation — always empty string |
| `ip_address` | 16_AuditLog | Same — always stored as '' |
| `changes_summary` | 12_WorkPaperRevisions | Documented as placeholder, never populated |
| `retry_count` | 21_NotificationQueue | Schema defines it, processEmailQueue uses hardcoded 3 |

### 5.3 Stub/Incomplete Functions

| Function | File | Problem |
|----------|------|---------|
| `loadReports()` | Reports.html:46 | Empty stub — no implementation body |
| `markAllNotificationsRead()` | Scripts.html | UI-only, no API call, resets on refresh |
| `handleGlobalSearch()` | Scripts.html | Only searches work papers, not cross-module |
| `showProfileSettings()` | Scripts.html | Opens modal, no save handler |

### 5.4 Incomplete Features

| Feature | Problem |
|---------|---------|
| **Email Template System** | Sheet 22_EmailTemplates exists with templates, but services hardcode email bodies instead of loading templates |
| **Field-Level Restrictions** | `field_restrictions` column loaded in permissions but never enforced anywhere |
| **Export Functions** | UI has Export buttons, `can_export` permission exists, but no CSV/Excel generation backend |
| **HOA Review** | `hoaReview()` stores review data but doesn't gate the workflow — closure works without it |
| **Staging Area** | Sheet 23_StagingArea defined but never read/written by any function |
| **Field Definitions** | Sheet 03_FieldDefinitions defined but never queried for validation or rendering |
| **Status Workflow Sheet** | Sheet 04_StatusWorkflow defined but transitions are hardcoded in services |

### 5.5 Logic Bugs — Duplicate SUPER_ADMIN Checks (12 locations)

The most significant bug: checking `SUPER_ADMIN` twice where a second role was likely intended.

| File | Line | Code Pattern |
|------|------|-------------|
| 03_WorkPaperService.gs | 292 | `!== ROLES.SUPER_ADMIN && !== ROLES.SUPER_ADMIN` |
| 03_WorkPaperService.gs | 426 | Same duplicate |
| 03_WorkPaperService.gs | 512 | `[SUPER_ADMIN, SUPER_ADMIN, SENIOR_AUDITOR]` |
| 03_WorkPaperService.gs | 912 | Notification filter duplicate |
| 04_ActionPlanService.gs | 239 | `[SUPER_ADMIN, SUPER_ADMIN, SENIOR_AUDITOR, JUNIOR_STAFF]` |
| 04_ActionPlanService.gs | 735 | HOA review permission |
| 04_ActionPlanService.gs | 836 | Overdue reminder recipients |
| 04_ActionPlanService.gs | 997 | Implementation notification |
| 05_NotificationService.gs | 496 | Weekly summary recipients |
| 07_AuthService.gs | 670 | Change password admin check |
| 07_AuthService.gs | 813 | Create user permission |
| 07_AuthService.gs | 908 | Reset password permission |
| 07_AuthService.gs | 1089 | Deactivate user permission |

### 5.6 Other Bugs

| Bug | Location | Impact |
|-----|----------|--------|
| `getInitData()` called without sessionToken param | 08_WebApp.gs:147 | May fail to identify user |
| Mixed enum/string comparison | 09_AnalyticsService.gs:269 | Inconsistent but functionally same |

---

## 6. Redundancies

### 6.1 `sanitizeForClient()` — Defined 7 Times (Identical)

| File | Line |
|------|------|
| 03_WorkPaperService.gs | 1025 |
| 04_ActionPlanService.gs | 1052 |
| 05_NotificationService.gs | 711 |
| 06_DashboardService.gs | 911 |
| 07_AuthService.gs | 1162 |
| 08_WebApp.gs | 1045 |
| 09_AnalyticsService.gs | 440 |

### 6.2 Other Duplicate Functions

| Function | Files | Notes |
|----------|-------|-------|
| `sanitizeInput()` | 01_Core.gs + 03_WorkPaperService.gs | Identical copies |
| `getRoleName()` | 01_Core.gs + 02_Config.gs | Identical copies |
| `formatDate()` | 01_Core.gs + 02_Config.gs | CONFLICTING signatures |
| `isStrongPassword()` / `validatePassword()` | 01_Core.gs + 07_AuthService.gs | Same logic, different names |
| `hashPassword()` | 01_Core.gs + 07_AuthService.gs | DIFFERENT iteration counts (10000 vs 1000) |

### 6.3 Near-Duplicate Function Pairs

| Pair | File | Difference |
|------|------|-----------|
| `getWorkPapers()` / `getWorkPapersRaw()` | 03_WorkPaperService.gs | Only sanitizeForClient differs |
| `getActionPlans()` / `getActionPlansRaw()` | 04_ActionPlanService.gs | Same |

### 6.4 Repeated Code Patterns

| Pattern | Count | Description |
|---------|-------|-------------|
| Column map creation (`const colMap = {}; headers.forEach(...)`) | 52+ | Should be a utility |
| Comma-separated ID parsing (`String(val).split(',').map(s=>s.trim())`) | 16+ | Should be a utility |
| Role arrays with duplicate SUPER_ADMIN | 9 | Copy-paste artifacts |
| Auditee filtering block | 5 | Same logic in 5 functions |
| Dropdown getter functions | 6 | Same pattern with different sheet names |
| `CacheService.getScriptCache()` calls | 33 | Should use singleton |

---

## 7. Security Concerns

| Issue | Severity | Detail |
|-------|----------|--------|
| PBKDF2 iteration mismatch | **HIGH** | 01_Core.gs uses 10,000 iterations; 07_AuthService.gs uses 1,000 |
| No rate limiting | MEDIUM | No throttling beyond per-account lockout |
| No CSRF protection | MEDIUM | Single POST endpoint, no CSRF tokens |
| AI API keys in PropertiesService | LOW | Not encrypted at rest (GAS limitation) |
| Session token in sessionStorage | LOW | No IP/UA binding |
| Hardcoded email | LOW | `audit@hasspetroleum.com` in 05_NotificationService.gs:172 |

---

## 8. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (SPA)                           │
│  Login.html → AuditorPortal.html (shell)                       │
│    ├── Dashboard.html      ├── Workpaperform.html              │
│    ├── Workpaperslist.html ├── Workpaperview.html              │
│    ├── Actionplanslist.html├── Actionplanview.html             │
│    ├── Analytics.html      ├── Settings.html                   │
│    ├── Reports.html        ├── Modals.html                     │
│    └── Scripts.html + Styles.html (shared)                     │
│  apiCall(action, data) → google.script.run / fetch(doPost)     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ POST {action, data, sessionToken}
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   08_WebApp.gs (Router)                         │
│  doGet(e) → Serves HTML       doPost(e) → Routes to services   │
└──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────────┘
       ▼      ▼      ▼      ▼      ▼      ▼      ▼
    Auth   WorkPaper ActionPlan  AI   Notify Dashboard Analytics
    07_    03_       04_        05_   05_    06_       09_
┌─────────────────────────────────────────────────────────────────┐
│                   01_Core.gs (Data Layer)                       │
│  Cache │ Index │ DB (read) │ DBWrite (write) │ Transaction      │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Google Sheets (23 sheets) │ Google Drive │ Google MailApp      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Core CRUD operations | 9/10 | Fully functional for WP and AP |
| Approval workflows | 8/10 | Working, but HOA review not enforced |
| Authentication | 8/10 | Solid, but PBKDF2 iteration mismatch is a risk |
| Authorization (RBAC) | 7/10 | Works, but 12 duplicate role checks may restrict wrongly |
| Notifications | 7/10 | Queue works, but templates bypassed for hardcoded strings |
| AI Integration | 7/10 | Fully coded, depends on external API keys |
| Analytics/Reports | 6/10 | Charts work, export is incomplete |
| Code quality | 5/10 | Heavy redundancy (7x sanitizeForClient, 52x colMap) |
| Data integrity | 6/10 | 3 sheets unused (FieldDefinitions, StatusWorkflow, StagingArea) |
| Frontend UX | 8/10 | Responsive, fast with 3-tier loading, role-aware |

### Priority Fixes
1. **CRITICAL**: Fix 12 duplicate SUPER_ADMIN checks (likely missing SENIOR_AUDITOR)
2. **CRITICAL**: Resolve PBKDF2 iteration mismatch (01_Core.gs vs 07_AuthService.gs)
3. **HIGH**: Fix getInitData() missing sessionToken parameter (08_WebApp.gs:147)
4. **HIGH**: Consolidate 7 copies of sanitizeForClient() into one
5. **MEDIUM**: Wire up email template system instead of hardcoded emails
6. **MEDIUM**: Implement export backend (CSV/Excel generation)
7. **LOW**: Remove/repurpose unused sheets (FieldDefinitions, StatusWorkflow, StagingArea)
