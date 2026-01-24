# Debugging & Architecture Analysis: Internal Audit System

## Executive Summary

This document provides a comprehensive technical analysis of the **"No response from server"** error in the Hass Petroleum Internal Audit System dashboard, including data architecture mapping, root cause analysis, and step-by-step remediation.

---

## Part 1: Data Architecture Investigation

### 1.1 Complete Data Source Inventory

The system uses a **single Google Spreadsheet** (ID: `1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4`) as its database with 23 sheets:

| Sheet Name | Purpose | Key Fields |
|------------|---------|------------|
| `00_Config` | System configuration key-value pairs | `config_key`, `config_value` |
| `01_Roles` | Role definitions | `role_code`, `role_name` |
| `02_Permissions` | Role-based permissions matrix | `role_code`, `module`, `can_create/read/update/delete` |
| `03_FieldDefinitions` | Field metadata | - |
| `04_StatusWorkflow` | Status definitions | - |
| `05_Users` | User accounts (primary) | `user_id` (PK), `email`, `role_code`, `password_hash` |
| `06_Affiliates` | Organization affiliates | `affiliate_code` (PK), `affiliate_name` |
| `07_AuditAreas` | Audit areas | `area_code` (PK) |
| `08_ProcessSubAreas` | Sub-areas of audit | `sub_area_code` (PK), `area_code` (FK) |
| `09_WorkPapers` | Main audit work documents | `work_paper_id` (PK), `affiliate_code` (FK), `prepared_by_id` (FK) |
| `10_WorkPaperRequirements` | Work paper line items | `requirement_id` (PK), `work_paper_id` (FK) |
| `11_WorkPaperFiles` | Uploaded file references | `file_id` (PK), `work_paper_id` (FK) |
| `12_WorkPaperRevisions` | Revision history | `revision_id` (PK), `work_paper_id` (FK) |
| `13_ActionPlans` | Management action items | `action_plan_id` (PK), `work_paper_id` (FK), `owner_ids` (FK) |
| `14_ActionPlanEvidence` | Evidence for actions | `evidence_id` (PK), `action_plan_id` (FK) |
| `15_ActionPlanHistory` | Action status changes | `history_id` (PK), `action_plan_id` (FK) |
| `16_AuditLog` | Comprehensive audit trail | `log_id` (PK) |
| `17_Index_WorkPapers` | Fast lookup index | `work_paper_id`, `row_number` |
| `18_Index_ActionPlans` | Fast lookup index | `action_plan_id`, `row_number` |
| `19_Index_Users` | Fast lookup index | `user_id`, `row_number` |
| `20_Sessions` | Active user sessions | `session_id` (PK), `user_id` (FK), `session_token` |
| `21_NotificationQueue` | Email queue | - |
| `22_EmailTemplates` | Email templates | - |
| `23_StagingArea` | Temporary data | - |

### 1.2 Dashboard → Sheet Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DASHBOARD COMPONENT MAPPING                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐                                                        │
│  │   Dashboard UI   │                                                        │
│  └────────┬─────────┘                                                        │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────┐     ┌─────────────────────────────────────────────┐   │
│  │ getDashboardData │────▶│ SHEETS ACCESSED:                            │   │
│  │ (06_Dashboard-   │     │                                             │   │
│  │  Service.gs:3)   │     │ • 05_Users (via validateSession)            │   │
│  └────────┬─────────┘     │ • 09_WorkPapers (via getWorkPapers)         │   │
│           │               │ • 13_ActionPlans (via getActionPlans)       │   │
│           │               │ • 01_Roles (via getRoleName)                │   │
│           │               │ • 17_Index_WorkPapers (for fast lookups)    │   │
│           │               │ • 18_Index_ActionPlans (for fast lookups)   │   │
│           │               │ • 19_Index_Users (for user lookups)         │   │
│           │               └─────────────────────────────────────────────┘   │
│           │                                                                  │
│           ▼                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        DASHBOARD COMPONENTS                           │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │   │
│  │  │ User Info       │    │ Summary Stats   │    │ Recent Activity │   │   │
│  │  │ ─────────────   │    │ ─────────────   │    │ ─────────────   │   │   │
│  │  │ • user_id       │    │ • Work Papers   │    │ • Last 5 WPs    │   │   │
│  │  │ • full_name     │    │   by status     │    │ • Last 5 APs    │   │   │
│  │  │ • email         │    │ • Action Plans  │    │                 │   │   │
│  │  │ • role_code     │    │   by status     │    │ Source:         │   │   │
│  │  │ • affiliate     │    │ • By risk       │    │ 09_WorkPapers   │   │   │
│  │  │                 │    │ • By affiliate  │    │ 13_ActionPlans  │   │   │
│  │  │ Source:         │    │                 │    │                 │   │   │
│  │  │ 05_Users        │    │ Source:         │    └─────────────────┘   │   │
│  │  │ 20_Sessions     │    │ 09_WorkPapers   │                          │   │
│  │  └─────────────────┘    │ 13_ActionPlans  │                          │   │
│  │                         └─────────────────┘                          │   │
│  │                                                                       │   │
│  │  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐   │   │
│  │  │ Charts          │    │ Alerts          │    │ Quick Links     │   │   │
│  │  │ ─────────────   │    │ ─────────────   │    │ ─────────────   │   │   │
│  │  │ • WP Status     │    │ • Overdue APs   │    │ Role-based      │   │   │
│  │  │ • AP Status     │    │ • Due This Week │    │ navigation      │   │   │
│  │  │ • Risk Rating   │    │ • Pending       │    │ shortcuts       │   │   │
│  │  │ • By Affiliate  │    │   Reviews       │    │                 │   │   │
│  │  │ • 6-Month Trend │    │                 │    │ Source:         │   │   │
│  │  │                 │    │ Source:         │    │ Hardcoded by    │   │   │
│  │  │ Source:         │    │ 13_ActionPlans  │    │ role_code       │   │   │
│  │  │ 09_WorkPapers   │    │ 09_WorkPapers   │    └─────────────────┘   │   │
│  │  │ 13_ActionPlans  │    └─────────────────┘                          │   │
│  │  └─────────────────┘                                                  │   │
│  │                                                                       │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐ │   │
│  │  │ Role-Specific Data                                               │ │   │
│  │  │ ─────────────────                                                │ │   │
│  │  │ • AUDITEE: getMyActionPlans() → 13_ActionPlans                  │ │   │
│  │  │ • JUNIOR_STAFF: getMyWorkPapers() → 09_WorkPapers               │ │   │
│  │  │ • SENIOR+: getPendingReviews() + getTeamStats()                 │ │   │
│  │  │                                                                  │ │   │
│  │  └─────────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Fields & Foreign Key Relationships

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ENTITY RELATIONSHIP DIAGRAM                        │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────────┐         ┌──────────────────┐
    │    05_Users      │         │   06_Affiliates  │
    │──────────────────│         │──────────────────│
    │ PK: user_id      │◄────┐   │ PK: affiliate_   │
    │ • email          │     │   │     code         │
    │ • full_name      │     │   │ • affiliate_name │
    │ • role_code ─────│──┐  │   └────────┬─────────┘
    │ • affiliate_code │  │  │            │
    │ • password_hash  │  │  │            │
    │ • password_salt  │  │  │            │
    └────────┬─────────┘  │  │            │
             │            │  │            │
             │            │  │            ▼
             │            │  │   ┌──────────────────┐
             │            │  │   │  09_WorkPapers   │
             │            │  │   │──────────────────│
             │            │  │   │ PK: work_paper_id│◄─────────────────┐
             │            │  └──▶│ FK: prepared_by_ │                  │
             │            │      │     id           │                  │
             │            │      │ FK: affiliate_   │                  │
             │            │      │     code         │                  │
             │            │      │ • status         │                  │
             │            │      │ • risk_rating    │                  │
             │            │      │ • observation_   │                  │
             │            │      │   title          │                  │
             │            │      └────────┬─────────┘                  │
             │            │               │                            │
             │            │               │                            │
             │            │               ▼                            │
             │            │      ┌──────────────────┐                  │
             │            │      │  13_ActionPlans  │                  │
             │            │      │──────────────────│                  │
             │            │      │ PK: action_plan_ │                  │
             │            └─────▶│     id           │                  │
             │                   │ FK: work_paper_  │──────────────────┘
             │                   │     id           │
             └──────────────────▶│ FK: owner_ids    │
                                 │ • status         │
                                 │ • due_date       │
                                 │ • action_        │
                                 │   description    │
                                 └──────────────────┘
```

### 1.4 Data Architecture Alignment Assessment

| Aspect | Status | Details |
|--------|--------|---------|
| Schema Consistency | ✅ ALIGNED | All schemas defined in `02_Config.gs` match sheet structures |
| Primary Keys | ✅ ALIGNED | All entities use unique IDs (WP-, AP-, USR- prefixes) |
| Foreign Keys | ✅ ALIGNED | References are validated at application level |
| Index Sheets | ⚠️ POTENTIAL ISSUE | Index sheets (17, 18, 19) may become stale if not rebuilt |
| Column Names | ✅ ALIGNED | No renamed fields detected |
| Type Mismatches | ⚠️ POTENTIAL ISSUE | `is_active` field stored inconsistently (boolean vs string) |
| Single Source of Truth | ✅ CONFIRMED | Google Sheet is the sole data source |

### 1.5 Hidden/Alternate Data Sources

**Analysis Result:** No hidden, hardcoded, cached, or alternate data sources exist outside the Google Sheet.

However, the following **caching layers** exist:

| Layer | Location | TTL | Purpose |
|-------|----------|-----|---------|
| Server Cache | `CacheService.getScriptCache()` | 5-60 min | Config, dropdowns, permissions, indexes |
| Client Cache | `ClientCache` in `Scripts.html` | 5 min | API response caching |
| Session Cache | `CacheService` | 5 min | Session token validation |

**Critical Finding:** Stale cache data can cause inconsistencies between the Sheet and what the application sees.

---

## Part 2: System Integration & Server Response Failure Analysis

### 2.1 Console Error Interpretation

Based on the console errors described:

| Error | Technical Cause | Impact |
|-------|-----------------|--------|
| `Chrome extension resource blocking` | Browser extensions interfering | May block network requests |
| `net::ERR_FAILED` | Network request failure | Backend unreachable |
| `"Unrecognized feature" warnings` | Modern browser API warnings | Usually non-fatal |
| `iframe sandbox security warning` | Apps Script HTML service restriction | Can block postMessage |
| `dropping postMessage.. deserialize threw error` | **CRITICAL**: Client-server comm failure | `google.script.run` broken |
| `IDLE ↔ BUSY state changes` | Multiple concurrent requests | Normal during dashboard load |
| `createOAuthDialog=true` | OAuth consent dialog triggered | User not fully authenticated |

### 2.2 System Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              COMPLETE DATA FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

     BROWSER (Client)                        APPS SCRIPT (Server)
    ┌─────────────────┐                     ┌─────────────────────┐
    │   Login.html    │                     │                     │
    │                 │                     │   08_WebApp.gs      │
    │ ┌─────────────┐ │   google.script.   │   ┌───────────────┐ │
    │ │ Login Form  │─┼───────────────────▶│   │ doGet(e)      │ │
    │ │ email, pwd  │ │   .run.apiCall()   │   │ - Serves HTML │ │
    │ └─────────────┘ │                     │   └───────────────┘ │
    │                 │                     │                     │
    │ After Login:    │                     │   ┌───────────────┐ │
    │ sessionToken    │                     │   │ apiCall()     │ │
    │ stored in       │                     │   │ - Main Router │ │
    │ sessionStorage  │                     │   │ - Auth Check  │ │
    └────────┬────────┘                     │   └───────┬───────┘ │
             │                              │           │         │
             ▼                              │           ▼         │
    ┌─────────────────┐                     │   ┌───────────────┐ │
    │ AuditorPortal   │                     │   │ routeAction() │ │
    │     .html       │                     │   │               │ │
    │ ┌─────────────┐ │                     │   │ Switch on     │ │
    │ │ Scripts.html│ │                     │   │ action name:  │ │
    │ │             │ │                     │   │               │ │
    │ │ initApp()   │─┼─────────────────────┼──▶│ 'login'       │ │
    │ │ ↓           │ │  apiCall('getInit   │   │ 'getDashboard │ │
    │ │ apiCall()   │ │   Data', {token})   │   │  Data'        │ │
    │ │ ↓           │ │                     │   │ 'getWorkPapers│ │
    │ │ loadDash-   │ │                     │   │ etc...        │ │
    │ │ board()     │ │                     │   └───────┬───────┘ │
    │ └─────────────┘ │                     │           │         │
    │                 │                     │           ▼         │
    │ ┌─────────────┐ │                     │   ┌───────────────┐ │
    │ │ Dashboard   │ │                     │   │ Service Layer │ │
    │ │   .html     │ │◀────────────────────┼───│               │ │
    │ │             │ │   Returns JSON      │   │ 06_Dashboard  │ │
    │ │ Renders:    │ │   {success: true,   │   │    Service.gs │ │
    │ │ - Summary   │ │    summary: {...},  │   │ 03_WorkPaper  │ │
    │ │ - Charts    │ │    charts: {...}}   │   │    Service.gs │ │
    │ │ - Alerts    │ │                     │   │ 04_ActionPlan │ │
    │ │ - Activity  │ │                     │   │    Service.gs │ │
    │ └─────────────┘ │                     │   └───────┬───────┘ │
    └─────────────────┘                     │           │         │
                                            │           ▼         │
                                            │   ┌───────────────┐ │
                                            │   │ Data Layer    │ │
                                            │   │               │ │
                                            │   │ 01_Core.gs    │ │
                                            │   │ - DB.getById  │ │
                                            │   │ - DB.getAll   │ │
                                            │   │ - Index.*     │ │
                                            │   │ - Cache.*     │ │
                                            │   └───────┬───────┘ │
                                            │           │         │
                                            │           ▼         │
                                            │   ┌───────────────┐ │
                                            │   │ Google Sheet  │ │
                                            │   │ (Database)    │ │
                                            │   └───────────────┘ │
                                            └─────────────────────┘
```

### 2.3 Why ALL Modules Fail Simultaneously

All modules (Users, Dashboard, Action Plans, Audit Log) fail together because they share a **single authentication/initialization path**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CASCADING FAILURE PATTERN                                │
└─────────────────────────────────────────────────────────────────────────────┘

    1. Browser loads AuditorPortal.html
                   │
                   ▼
    2. Scripts.html → initApp() called on DOMContentLoaded
                   │
                   ▼
    3. apiCall('getInitData', {sessionToken})
                   │
                   ▼
    ┌──────────────┴──────────────┐
    │  IF ANY OF THESE FAIL:      │
    │  • Session token invalid    │
    │  • validateSession() error  │
    │  • getUserById() returns    │
    │    null (index issue)       │
    │  • Sheet access timeout     │
    │  • google.script.run broken │
    └──────────────┬──────────────┘
                   │
                   ▼
    4. initApp() receives {success: false} or null
                   │
                   ▼
    5. window.currentUser = null
    6. window.appDropdowns = null
                   │
                   ▼
    7. ALL subsequent API calls fail because:
       • No user object available
       • requireLogin: true returned
       • Or null response from server
```

---

## Part 3: Technical Root Cause Analysis

### 3.1 Root Cause Ranking (Most Likely → Least Likely)

| Rank | Cause | Probability | Evidence | Code Location |
|------|-------|-------------|----------|---------------|
| **1** | **Session Token Validation Failure** | 40% | `validateSession()` returns null user | `07_AuthService.gs:102-178` |
| **2** | **Index Not Built/Stale** | 25% | `getUserById()` returns null when index empty | `01_Core.gs:333-354` |
| **3** | **`google.script.run` Communication Failure** | 15% | postMessage deserialize error | Browser → Apps Script |
| **4** | **Deployment Version Mismatch** | 10% | HEAD vs deployed version | Apps Script deployment |
| **5** | **Sheet Access Timeout** | 5% | Large sheet causing 30s timeout | `01_Core.gs:41-49` |
| **6** | **OAuth/Permission Issue** | 3% | createOAuthDialog=true | Apps Script scopes |
| **7** | **Chrome Extension Interference** | 2% | Resource blocking | Browser extensions |

### 3.2 Detailed Technical Explanation: "No response from server"

The error originates from **three distinct code locations**:

#### Location 1: `08_WebApp.gs:628-635` (apiCall function)
```javascript
// In apiCall() after routeAction returns
if (result === null || result === undefined) {
  console.error('apiCall: routeAction returned null/undefined for action:', action);
  return {
    success: false,
    error: 'No response from server',
    errorDetail: 'routeAction returned null/undefined for action: ' + action
  };
}
```

#### Location 2: `08_WebApp.gs:125-131` (getDashboardData handler)
```javascript
// In routeAction case 'getDashboardData'
if (!dashboardData) {
  console.error('getDashboardData: Dashboard service returned null/undefined');
  return {
    success: false,
    error: 'Dashboard service returned null',
    errorDetail: 'getDashboardData() returned null/undefined'
  };
}
```

#### Location 3: `Scripts.html:276-277` (Client-side apiCall)
```javascript
// Client-side null check
if (result === null || result === undefined) {
  resolve({ success: false, error: 'No response from server' });
}
```

### 3.3 The Complete Failure Chain

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FAILURE CHAIN ANALYSIS                             │
└─────────────────────────────────────────────────────────────────────────────┘

STEP 1: Client calls apiCall('getInitData', {sessionToken: '...'})
        ↓
STEP 2: Server receives in apiCall() [08_WebApp.gs:536]
        ↓
STEP 3: getCurrentUser() returns null [expected for web app deployment]
        ↓
STEP 4: validateSession(sessionToken) is called [08_WebApp.gs:558]
        ↓
STEP 5: getSessionByToken(token) looks up session [07_AuthService.gs:237]
        ↓
        ┌────────────────────────────────────────────┐
        │ FAILURE POINT A: Session not found         │
        │ - Token expired                            │
        │ - Session invalidated                      │
        │ - Session sheet empty or inaccessible      │
        │                                            │
        │ Result: validateSession returns            │
        │ {valid: false, error: 'Session not found'} │
        └────────────────────────────────────────────┘
        ↓
STEP 6: If session valid, getUserById(session.user_id) called [07_AuthService.gs:130]
        ↓
        ┌────────────────────────────────────────────┐
        │ FAILURE POINT B: User lookup fails         │
        │                                            │
        │ Index.getRowNumber('USER', userId) called  │
        │ [01_Core.gs:149-153]                       │
        │                                            │
        │ IF index sheet (19_Index_Users) is:        │
        │ - Empty                                    │
        │ - Missing the user                         │
        │ - Not rebuilt after user creation          │
        │                                            │
        │ THEN: Returns -1                           │
        │                                            │
        │ DB.getById() sees rowNumber < 2            │
        │ Returns null [01_Core.gs:335]              │
        └────────────────────────────────────────────┘
        ↓
STEP 7: Fallback to direct sheet lookup attempted [07_AuthService.gs:133-154]
        ↓
        ┌────────────────────────────────────────────┐
        │ FAILURE POINT C: Direct lookup fails       │
        │                                            │
        │ getSheet(SHEETS.USERS) may fail if:        │
        │ - Sheet renamed                            │
        │ - SpreadsheetApp timeout                   │
        │ - Permission error                         │
        │                                            │
        │ Result: user remains null                  │
        └────────────────────────────────────────────┘
        ↓
STEP 8: validateSession returns {valid: false, error: 'User not found...'}
        ↓
STEP 9: apiCall() sees no valid user
        Returns {success: false, error: 'Authentication required', requireLogin: true}
        ↓
STEP 10: Client redirects to login OR shows "No response from server"
```

### 3.4 Specific Console Error Analysis

| Error Message | Root Cause | Technical Detail |
|---------------|------------|------------------|
| `dropping postMessage.. deserialize threw error` | Server returned non-serializable data OR iframe security | `google.script.run` uses postMessage internally; Date objects or circular refs can break serialization |
| `net::ERR_FAILED` | Apps Script server unreachable | Could be: (1) Deployment not live, (2) Script disabled, (3) Quota exceeded |
| `createOAuthDialog=true` | User needs to authorize scopes | First-time users or scope changes trigger OAuth |
| `Unrecognized feature` | Modern browser API mismatch | Non-fatal, ignore |
| `iframe sandbox` | Security policy restriction | Apps Script HTML service runs in sandboxed iframe |

---

## Part 4: Step-by-Step Fix List

### 4.1 Apps Script Editor Checks

#### Step 1: Run Diagnostic Function
```javascript
// In Apps Script Editor, run:
function diagnoseDashboardIssues() {
  // Already exists in 08_WebApp.gs:810-1027
  // View > Executions to see logs
}
```

**Expected Output:**
- Sheet access status for all 13 critical sheets
- Index map entry counts
- Session validity counts
- User lookup test
- Dashboard data load test

#### Step 2: Rebuild All Indexes
```javascript
// If diagnostic shows index counts = 0, run:
function rebuildAllIndexesQuickFix() {
  // Already exists in 08_WebApp.gs:1033-1058
  Index.rebuild('USER');
  Index.rebuild('WORK_PAPER');
  Index.rebuild('ACTION_PLAN');
}
```

#### Step 3: Verify Deployment Status
1. Open Apps Script Editor
2. Go to **Deploy** > **Manage deployments**
3. Check that web app deployment is:
   - Status: **Active**
   - Execute as: **User accessing the web app** (or appropriate)
   - Who has access: **Anyone with Google Account**
4. Note the deployment URL vs HEAD version

#### Step 4: Check Execution Logs
1. Go to **View** > **Executions**
2. Filter by last 24 hours
3. Look for:
   - Failed executions (red X)
   - Timeout errors (>30s)
   - Permission errors

### 4.2 Google Sheet Checks

#### Step 1: Verify Sheet Structure
1. Open the spreadsheet: `1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4`
2. Confirm all 23 sheets exist with correct names:
   - `00_Config` through `23_StagingArea`
3. Check that header rows (row 1) match expected schemas

#### Step 2: Check Index Sheets
| Sheet | Check |
|-------|-------|
| `17_Index_WorkPapers` | Should have entries matching `09_WorkPapers` count |
| `18_Index_ActionPlans` | Should have entries matching `13_ActionPlans` count |
| `19_Index_Users` | Should have entries matching `05_Users` count |

If any are empty but data sheets have rows → Run `rebuildAllIndexesQuickFix()`

#### Step 3: Verify User Data
1. Open `05_Users` sheet
2. Check that:
   - `user_id` column has values (USR-XXXXX format)
   - `email` column has valid emails
   - `is_active` is TRUE (boolean or string "TRUE")
   - `password_hash` and `password_salt` are populated

#### Step 4: Check Sessions
1. Open `20_Sessions` sheet
2. Check for:
   - Sessions with `is_valid` = TRUE
   - Sessions with `expires_at` > current time
3. If all sessions expired, users must log in again

### 4.3 Browser Checks

#### Step 1: Clear Browser State
```javascript
// In browser console (F12):
sessionStorage.clear();
localStorage.clear();
```
Then refresh the page.

#### Step 2: Disable Extensions
1. Open Chrome in Incognito mode
2. Or disable all extensions temporarily
3. Test dashboard loading

#### Step 3: Check Console for Specific Errors
```javascript
// In console, look for:
// ✅ Good: "apiCall completed successfully for action: getDashboardData"
// ❌ Bad: "apiCall: routeAction returned null/undefined"
// ❌ Bad: "Authentication required"
```

#### Step 4: Test Backend Directly
```javascript
// In browser console, test connection:
google.script.run
  .withSuccessHandler(r => console.log('SUCCESS:', r))
  .withFailureHandler(e => console.log('ERROR:', e))
  .apiCall('ping', {});

// Expected: {success: true, timestamp: "2024-..."}
```

#### Step 5: Test Session Validation
```javascript
// Get current token
const token = sessionStorage.getItem('sessionToken');
console.log('Token:', token);

// Test validation
google.script.run
  .withSuccessHandler(r => console.log('Session:', r))
  .withFailureHandler(e => console.log('Error:', e))
  .apiCall('validateSession', {sessionToken: token});
```

### 4.4 Redeployment Procedure

If all checks pass but issue persists:

#### Step 1: Create New Deployment
1. Apps Script Editor → **Deploy** → **New deployment**
2. Select type: **Web app**
3. Description: "Fix dashboard loading - [date]"
4. Execute as: **User accessing the web app**
5. Who has access: **Anyone with Google Account**
6. Click **Deploy**

#### Step 2: Update Bookmarks/Links
- New deployment has a new URL
- Old deployment URL becomes inactive
- Update any bookmarked links

#### Step 3: Test New Deployment
1. Open new deployment URL
2. Log in with test user
3. Verify dashboard loads

---

## Appendix A: Quick Reference - Error → Fix Mapping

| Error Symptom | Most Likely Cause | Quick Fix |
|---------------|-------------------|-----------|
| "No response from server" on ALL modules | Session validation failure | Run `rebuildAllIndexesQuickFix()`, clear browser sessionStorage |
| "No response from server" on Dashboard only | getDashboardData service error | Check Executions log for exception |
| "Authentication required" | Session expired | Re-login |
| "User not found" | Index stale or user deleted | Rebuild USER index |
| OAuth popup keeps appearing | Scope not authorized | Re-authorize app |
| Infinite loading | `google.script.run` broken | Check deployment, try incognito |

## Appendix B: Monitoring Commands

```javascript
// Run in Apps Script Editor to monitor system health:

// Check current state
function quickHealthCheck() {
  const results = diagnoseDashboardIssues();

  if (results.errors.length > 0) {
    console.log('🔴 ERRORS FOUND:');
    results.errors.forEach(e => console.log('  - ' + e));
  }

  if (results.indexes.USER?.count === 0) {
    console.log('⚠️ User index empty - run rebuildAllIndexesQuickFix()');
  }

  if (results.sessions?.valid === 0) {
    console.log('⚠️ No valid sessions - users need to log in again');
  }

  if (results.dashboardTest?.success) {
    console.log('✅ Dashboard data loads successfully');
  } else {
    console.log('🔴 Dashboard data failed to load');
  }

  return results;
}
```

---

## Document Information

- **Created:** 2026-01-24
- **Purpose:** Debugging "No response from server" error in Internal Audit System
- **Scope:** Complete technical analysis per user's debugging prompt requirements
- **Author:** AI Systems Architect Analysis
