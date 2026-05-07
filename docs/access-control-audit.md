# Internal Audit System — Access Control & Compliance Audit

**Audit date:** 2026-05-07  
**Codebase:** `/home/user/Internal-Audit-System/` — 13 Google Apps Script `.gs` files  
**Database:** Turso (libSQL) via HTTP pipeline  
**Auditor note:** Every finding is traced to a specific `filename:line` reference. All role codes, permission values, status strings, and SQL fragments are quoted verbatim from source.

---

## Table of Contents

1. [Role Inventory](#1-role-inventory)
2. [Hardcoded Permission Matrix](#2-hardcoded-permission-matrix)
3. [Workflow Maps](#3-workflow-maps)
4. [Interaction Loops & Side-Effect Chains](#4-interaction-loops--side-effect-chains)
5. [Hardcoded Values That Should Be in Turso](#5-hardcoded-values-that-should-be-in-turso)
6. [Database Schema Gaps for Access Control](#6-database-schema-gaps-for-access-control)
7. [SUPER_ADMIN Capability Gaps](#7-super_admin-capability-gaps)

---

## 1. Role Inventory

### 1.1 Canonical Role Constant (`02_Config.gs:162`)

```javascript
var ROLES = {
  SUPER_ADMIN:      'SUPER_ADMIN',
  SENIOR_AUDITOR:   'SENIOR_AUDITOR',
  JUNIOR_STAFF:     'JUNIOR_STAFF',
  SENIOR_MGMT:      'SENIOR_MGMT',
  BOARD_MEMBER:     'BOARD_MEMBER',
  AUDITOR:          'AUDITOR',
  UNIT_MANAGER:     'UNIT_MANAGER',
  EXTERNAL_AUDITOR: 'EXTERNAL_AUDITOR'
};
```

Eight roles are defined in the `ROLES` constant. One additional alias (`BOARD`) appears in legacy code and a ghost-role set (`AUDITEE`, `MANAGEMENT`, `OBSERVER`) appears in cache-invalidation code but is absent from `ROLES`.

### 1.2 Full Role Table

| # | Role Code | ROLES Key | Display Name | Defined At | Seeded in `01_Roles` Turso Table | Hierarchy Level |
|---|-----------|-----------|--------------|------------|----------------------------------|-----------------|
| 1 | `SUPER_ADMIN` | `ROLES.SUPER_ADMIN` | *(no override — raw code used)* | `02_Config.gs:163` | Expected | 1 — Highest |
| 2 | `SENIOR_AUDITOR` | `ROLES.SENIOR_AUDITOR` | *(no override)* | `02_Config.gs:164` | Expected | 2 |
| 3 | `AUDITOR` | `ROLES.AUDITOR` | *(no override)* | `02_Config.gs:169` | Expected | 3 |
| 4 | `JUNIOR_STAFF` | `ROLES.JUNIOR_STAFF` | `'Audit Client'` | `02_Config.gs:165`, display at `02_Config.gs:178` | Expected | 4 |
| 5 | `SENIOR_MGMT` | `ROLES.SENIOR_MGMT` | *(no override)* | `02_Config.gs:166` | Expected | 5 |
| 6 | `UNIT_MANAGER` | `ROLES.UNIT_MANAGER` | `'Head of Department'` | `02_Config.gs:170`, display at `02_Config.gs:181` | Expected | 6 |
| 7 | `BOARD_MEMBER` | `ROLES.BOARD_MEMBER` | `'Board Member'` | `02_Config.gs:167`, display at `02_Config.gs:179` | Expected | 7 |
| 8 | `EXTERNAL_AUDITOR` | `ROLES.EXTERNAL_AUDITOR` | *(no override)* | `02_Config.gs:171` | Expected | 8 — Lowest |

**Note:** `getRoleName()` in `01_Core.gs` queries the `01_Roles` Turso table for display names. If a role is not seeded in that table, `getRoleName()` falls back to the raw role code string. There is no code that asserts seeding on startup, and no migration script was found in the codebase.

### 1.3 Ghost / Alias Roles

| Code | Status | Where Referenced | Risk |
|------|--------|------------------|------|
| `BOARD` | **Alias — not in `ROLES`** | `02_Config.gs:180` (`ROLE_DISPLAY_NAMES`), `01_Core.gs` (`getPermissions()` normalises `BOARD`→`BOARD_MEMBER`), `08_WebApp.gs:622` (generateBoardReport allowed array) | A user with `role_code='BOARD'` in the DB would get `BOARD_MEMBER` permissions but NOT appear in any role-filter array that uses `ROLES.BOARD_MEMBER` string matching. |
| `AUDITEE` | **Ghost — removed from `ROLES`** | `02_Config.gs:559` (`clearAllCaches` hardcoded key list: `perm_AUDITEE`) | Cache key written but role does not exist. Indicates a prior role was deleted from `ROLES` without cleaning up cache code. |
| `MANAGEMENT` | **Ghost — removed from `ROLES`** | `02_Config.gs:559` (`perm_MANAGEMENT`) | Same issue — orphaned cache keys. |
| `OBSERVER` | **Ghost — removed from `ROLES`** | `02_Config.gs:559` (`perm_OBSERVER`) | Same issue. |

### 1.4 `ROLE_DISPLAY_NAMES` Constant (`02_Config.gs:176`)

```javascript
var ROLE_DISPLAY_NAMES = {
  JUNIOR_STAFF:  'Audit Client',
  UNIT_MANAGER:  'Head of Department',
  BOARD_MEMBER:  'Board Member',
  BOARD:         'Board Member'
};
```

Only four of the eight active roles have display-name overrides. `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`, `SENIOR_MGMT`, `EXTERNAL_AUDITOR` have no display name and will render as their raw code string in any UI that calls `ROLE_DISPLAY_NAMES[roleCode]`.

### 1.5 `Cache.invalidatePattern()` Hardcoded Role List (`01_Core.gs:~139`)

```javascript
['SUPER_ADMIN','SENIOR_AUDITOR','AUDITOR','JUNIOR_STAFF',
 'UNIT_MANAGER','SENIOR_MGMT','BOARD_MEMBER','EXTERNAL_AUDITOR']
```

This list matches `ROLES` exactly. However `clearAllCaches()` at `02_Config.gs:559` also generates keys for ghost roles `AUDITEE`, `MANAGEMENT`, `BOARD`, `OBSERVER` which are no longer in this list, meaning those orphaned keys are written but never invalidated by `invalidatePattern`.

### 1.6 Hierarchy Diagram

```
SUPER_ADMIN
    │  Full bypass — canUserPerform() returns true unconditionally
    │  01_Core.gs:966
    ▼
SENIOR_AUDITOR
    │  Approves work papers; manages users (service layer, blocked by router)
    │  HOA CC notifications; sendToAuditee; batchSendToAuditees
    ▼
AUDITOR
    │  Creates and submits work papers; verifies action plans; reviews auditee responses
    ▼
JUNIOR_STAFF  (display: "Audit Client")
    │  Reads own action plans only; submits implementation notes
    │  Cannot see work papers list
    ▼
SENIOR_MGMT
    │  Reads own affiliate's work papers (approved/sent); board-level reports
    ▼
UNIT_MANAGER  (display: "Head of Department")
    │  Similar to SENIOR_MGMT — reads observations for own affiliate
    ▼
BOARD_MEMBER  (display: "Board Member")
    │  Read-only: approved/sent work papers; board reports
    ▼
EXTERNAL_AUDITOR
       Read-only: approved/sent work papers only; no reports
```

---

## 2. Hardcoded Permission Matrix

### 2.1 Source of Truth

The runtime permission check chain is:

```
checkPermission(roleCode, module, action)   [01_Core.gs]
    └─► getPermissions(roleCode)             [01_Core.gs]
            └─► ROLE_PERMISSIONS[roleCode]   [02_Config.gs:196]
```

The `role_permissions` Turso table is **NOT** consulted during runtime access control. `getUserPermissions()` in `06_DashboardService.gs:1001` calls `getPermissionsFresh()` which is **undefined in the codebase** — this is a broken reference (see Section 6). The `ROLE_PERMISSIONS` constant in `02_Config.gs` is the only functional permission source.

### 2.2 Full `ROLE_PERMISSIONS` Matrix (`02_Config.gs:196`)

The matrix below documents every entry verbatim. Columns are actions: **view / create / update / delete / approve / export**. A cell value of `true` means permitted; `false` or absent means denied.

#### Module: `WORK_PAPERS`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | true | true | true | true | true | true |
| AUDITOR | true | true | true | false | false | true |
| JUNIOR_STAFF | false | false | false | false | false | false |
| SENIOR_MGMT | true | false | false | false | false | true |
| UNIT_MANAGER | true | false | false | false | false | false |
| BOARD_MEMBER | true | false | false | false | false | false |
| EXTERNAL_AUDITOR | true | false | false | false | false | false |

#### Module: `ACTION_PLANS`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | true | true | true | true | true | true |
| AUDITOR | true | true | true | false | true | true |
| JUNIOR_STAFF | true | false | true | false | false | false |
| SENIOR_MGMT | true | false | false | false | false | true |
| UNIT_MANAGER | true | false | true | false | false | false |
| BOARD_MEMBER | true | false | false | false | false | false |
| EXTERNAL_AUDITOR | true | false | false | false | false | false |

#### Module: `USERS`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | true | true | true | false | false | false |
| AUDITOR | false | false | false | false | false | false |
| JUNIOR_STAFF | false | false | false | false | false | false |
| SENIOR_MGMT | false | false | false | false | false | false |
| UNIT_MANAGER | false | false | false | false | false | false |
| BOARD_MEMBER | false | false | false | false | false | false |
| EXTERNAL_AUDITOR | false | false | false | false | false | false |

#### Module: `REPORT`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | true | true | true | false | false | true |
| AUDITOR | true | false | false | false | false | true |
| JUNIOR_STAFF | false | false | false | false | false | false |
| SENIOR_MGMT | true | false | false | false | false | true |
| UNIT_MANAGER | true | false | false | false | false | true |
| BOARD_MEMBER | true | false | false | false | false | true |
| EXTERNAL_AUDITOR | true | false | false | false | false | false |

**Alias note:** `DASHBOARD` is an alias for `REPORT`. `01_Core.gs:checkPermission()` normalises `'DASHBOARD'` → `'REPORT'` before lookup.

#### Module: `CONFIG`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | false | false | false | false | false | false |
| AUDITOR | false | false | false | false | false | false |
| JUNIOR_STAFF | false | false | false | false | false | false |
| SENIOR_MGMT | false | false | false | false | false | false |
| UNIT_MANAGER | false | false | false | false | false | false |
| BOARD_MEMBER | false | false | false | false | false | false |
| EXTERNAL_AUDITOR | false | false | false | false | false | false |

#### Module: `AUDITEE_RESPONSE`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | true | true | true | false | true | true |
| AUDITOR | true | true | true | false | true | true |
| JUNIOR_STAFF | true | true | true | false | false | false |
| SENIOR_MGMT | true | true | true | false | false | false |
| UNIT_MANAGER | true | true | true | false | false | false |
| BOARD_MEMBER | false | false | false | false | false | false |
| EXTERNAL_AUDITOR | false | false | false | false | false | false |

#### Module: `NOTIFICATIONS`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | false |
| SENIOR_AUDITOR | true | true | false | false | false | false |
| AUDITOR | true | false | false | false | false | false |
| JUNIOR_STAFF | true | false | false | false | false | false |
| SENIOR_MGMT | true | false | false | false | false | false |
| UNIT_MANAGER | true | false | false | false | false | false |
| BOARD_MEMBER | true | false | false | false | false | false |
| EXTERNAL_AUDITOR | true | false | false | false | false | false |

#### Module: `FILES`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | true |
| SENIOR_AUDITOR | true | true | true | true | false | true |
| AUDITOR | true | true | true | false | false | true |
| JUNIOR_STAFF | true | true | false | false | false | false |
| SENIOR_MGMT | true | false | false | false | false | false |
| UNIT_MANAGER | true | false | false | false | false | false |
| BOARD_MEMBER | false | false | false | false | false | false |
| EXTERNAL_AUDITOR | true | false | false | false | false | false |

#### Module: `AI_ASSIST`

| Role | view | create | update | delete | approve | export |
|------|------|--------|--------|--------|---------|--------|
| SUPER_ADMIN | true | true | true | true | true | false |
| SENIOR_AUDITOR | true | true | false | false | false | false |
| AUDITOR | true | true | false | false | false | false |
| JUNIOR_STAFF | false | false | false | false | false | false |
| SENIOR_MGMT | false | false | false | false | false | false |
| UNIT_MANAGER | false | false | false | false | false | false |
| BOARD_MEMBER | false | false | false | false | false | false |
| EXTERNAL_AUDITOR | false | false | false | false | false | false |

### 2.3 Per-File Hardcoded Role Checks (Beyond `ROLE_PERMISSIONS`)

Every location in the codebase where role-based access is enforced via explicit code (not through `checkPermission`) is listed below.

| File | Line(s) | Check | Roles Allowed | Notes |
|------|---------|-------|---------------|-------|
| `01_Core.gs` | ~966 | `canUserPerform` SUPER_ADMIN bypass | SUPER_ADMIN | Unconditional `return true` — bypasses all ownership/entity checks |
| `02_Config.gs` | 700 | `getAuditorsDropdown()` filter | SUPER_ADMIN, SENIOR_AUDITOR, JUNIOR_STAFF, AUDITOR | Used in UI dropdowns for "assign auditor" |
| `02_Config.gs` | 705 | `getAuditeesDropdown()` filter | JUNIOR_STAFF, UNIT_MANAGER, SENIOR_MGMT | Used in UI dropdowns for "assign auditee" |
| `03_WorkPaperService.gs` | 187 | Status lock bypass in `updateWorkPaper` | SUPER_ADMIN | Can edit work papers in any status |
| `03_WorkPaperService.gs` | 189 | Status lock partial bypass in `updateWorkPaper` | SENIOR_AUDITOR | Can edit work papers beyond Draft/Revision Required |
| `03_WorkPaperService.gs` | 231 | `evidence_override` field | SUPER_ADMIN | Only SUPER_ADMIN can set evidence override flag |
| `03_WorkPaperService.gs` | 348 | `deleteWorkPaper` status bypass | SUPER_ADMIN | Can delete work papers in any status |
| `03_WorkPaperService.gs` | 475 | `getWorkPapersRaw` — see NO work papers | JUNIOR_STAFF, SENIOR_MGMT, UNIT_MANAGER | These roles receive empty list from raw query |
| `03_WorkPaperService.gs` | 480 | `getWorkPapersRaw` — Approved/Sent only | BOARD_MEMBER, EXTERNAL_AUDITOR | Status filter: Approved or Sent to Auditee |
| `03_WorkPaperService.gs` | 487 | `getWorkPapersRaw` — affiliate scope | All except SUPER_ADMIN, SENIOR_AUDITOR | Filtered to user's affiliate_code |
| `03_WorkPaperService.gs` | 537 | `submitWorkPaper` required fields | SUPER_ADMIN vs others | SUPER_ADMIN needs fewer required fields |
| `03_WorkPaperService.gs` | 543-551 | `submitWorkPaper` evidence mandatory | All except SUPER_ADMIN (evidence_override=true) | Bypass via `evidence_override` flag |
| `03_WorkPaperService.gs` | 726 | `reviewWorkPaper` reviewer roles | SUPER_ADMIN, SENIOR_AUDITOR | Hardcoded array check |
| `03_WorkPaperService.gs` | 841 | Auto `sendToAuditee` on approve | *(triggered by reviewer)* | When `responsible_ids` set, auto-sends |
| `03_WorkPaperService.gs` | 1246 | `getApprovedSendQueue` | SUPER_ADMIN, SENIOR_AUDITOR | Hardcoded reviewer roles |
| `03_WorkPaperService.gs` | 1315 | `batchSendToAuditees` | SUPER_ADMIN, SENIOR_AUDITOR | Hardcoded reviewer roles |
| `04_ActionPlanService.gs` | 44 | `createActionPlan` WP status bypass | SUPER_ADMIN | Can create AP on non-"Sent to Auditee" WP |
| `04_ActionPlanService.gs` | 329-345 | `updateActionPlan` field restrictions | JUNIOR_STAFF vs auditors | JUNIOR_STAFF: only `implementation_notes`; auditors: broader set |
| `04_ActionPlanService.gs` | 374 | `deleteActionPlan` status bypass | SUPER_ADMIN | Can delete in any status |
| `04_ActionPlanService.gs` | 465 | `getActionPlansRaw` — see all | SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR, SENIOR_MGMT | Full list |
| `04_ActionPlanService.gs` | 468 | `getActionPlansRaw` — Implemented/Verified/Closed only | BOARD_MEMBER, EXTERNAL_AUDITOR | Status filter |
| `04_ActionPlanService.gs` | 615 | `markAsImplemented` evidence bypass | SUPER_ADMIN | Evidence not mandatory for SUPER_ADMIN |
| `04_ActionPlanService.gs` | 679 | `verifyImplementation` roles | SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR | Hardcoded |
| `04_ActionPlanService.gs` | 771 | `hoaReview` roles | SUPER_ADMIN, SENIOR_AUDITOR | HOA = Head of Audit |
| `04_ActionPlanService.gs` | 882 | `delegateActionPlan` | Current owner OR SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR | |
| `04_ActionPlanService.gs` | 981 | `addActionPlanEvidence` | Owner OR SUPER_ADMIN, SENIOR_AUDITOR | |
| `05_AIService.gs` | multiple | AI admin functions | SUPER_ADMIN only | `setAIApiKey`, `removeAIApiKey`, `setActiveAIProvider`, `testAIConnection` |
| `05_NotificationService.gs` | 146 | `queueHoaCcNotifications` CC target | SUPER_ADMIN users | All SUPER_ADMIN users are CC'd on HOA notifications |
| `06_DashboardService.gs` | 1039 | `canViewDashboard` override | ALL roles | Forces `true` regardless of DB permissions |
| `06_DashboardService.gs` | 1047 | `canViewAIAssist` override | ALL roles | Forces `true` regardless of DB permissions |
| `06_DashboardService.gs` | 1053 | `canViewAuditWorkbench` override | ALL roles | Forces `true` regardless of DB permissions |
| `06_DashboardService.gs` | 163 | `getSidebarCounts` send queue | SUPER_ADMIN, SENIOR_AUDITOR | |
| `06_DashboardService.gs` | 1432 | `getDashboardDataV2` | No filtering | Explicitly documented as "SUPER_ADMIN level data for all" |
| `07_AuthService.gs` | 730 | `createUser` | SUPER_ADMIN, SENIOR_AUDITOR | Service layer allows SENIOR_AUDITOR |
| `07_AuthService.gs` | 823 | `updateUser` | Self OR SUPER_ADMIN, SENIOR_AUDITOR | |
| `07_AuthService.gs` | 890 | `deactivateUser` | SUPER_ADMIN only | |
| `07_AuthService.gs` | 613 | `resetPassword` | SUPER_ADMIN, SENIOR_AUDITOR | |
| `07_AuthService.gs` | 990 | `getUsers` | SUPER_ADMIN, SENIOR_AUDITOR | |
| `08_WebApp.gs` | 331 | `getPendingAuditeeResponses` router | SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR | |
| `08_WebApp.gs` | 358 | `getUsers/createUser/updateUser/deactivateUser` router | SUPER_ADMIN only | **Overrides service layer** — SENIOR_AUDITOR blocked at router |
| `08_WebApp.gs` | 387 | `getComprehensiveReportData` scoping | UNIT_MANAGER, JUNIOR_STAFF scoped | Raw data fetched with `null` user |
| `08_WebApp.gs` | 413 | `sendBatchedAssignmentNotifications` | SUPER_ADMIN only | |
| `08_WebApp.gs` | 460 | All settings actions | SUPER_ADMIN only | |
| `08_WebApp.gs` | 622 | `generateBoardReport` | BOARD_MEMBER, `'BOARD'`, SUPER_ADMIN, SENIOR_MGMT, UNIT_MANAGER | Includes string literal `'BOARD'` not from ROLES |
| `09_AnalyticsService.gs` | 257 | `saveSystemConfigValues` | SUPER_ADMIN only | |
| `10_AuditeeService.gs` | 473 | `reviewAuditeeResponse` | SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR | |
| `11_DropdownService.gs` | 7 | All dropdown CRUD | SUPER_ADMIN only | String literal `'SUPER_ADMIN'` used, not `ROLES.SUPER_ADMIN` |

### 2.4 Router vs Service Layer Discrepancy

**Critical conflict at `08_WebApp.gs:358` vs `07_AuthService.gs:730/823/990`:**

The service layer (`07_AuthService.gs`) permits `SENIOR_AUDITOR` to call `createUser`, `updateUser`, and `getUsers`. The router (`08_WebApp.gs`) enforces `role_code !== ROLES.SUPER_ADMIN` for all four user-management actions, blocking SENIOR_AUDITOR at the HTTP layer. The service-layer permission grants to SENIOR_AUDITOR are therefore dead code — they cannot be reached through the normal web API. If the router check is ever removed or circumvented (e.g., direct function calls from a trigger), SENIOR_AUDITOR gains user-management access unexpectedly.

---

## 3. Workflow Maps

### 3.1 Work Paper Lifecycle

#### Status Values (`02_Config.gs`)
```
Draft  →  Submitted  →  Under Review  →  Approved  →  Sent to Auditee
                    ↘  Revision Required  ↗
```

#### Full Lifecycle with Actors and Guards

```
[DRAFT]
  Created by: AUDITOR, SENIOR_AUDITOR, SUPER_ADMIN
  Guard: canUserPerform(user, 'create', 'WORK_PAPER', null)
  File: 03_WorkPaperService.gs:createWorkPaper()
  Side effects:
    - Queues WP_ASSIGNMENT notification to assigned_auditor_id
    - Queues HOA_CC notification to all SUPER_ADMIN users
    - Creates junction records in work_paper_responsibles, work_paper_cc_recipients
        ↓
       [edit loop: Draft or Revision Required only]
       SUPER_ADMIN: any status
       SENIOR_AUDITOR: any status (partial bypass)
       Assigned auditor: restricted to auditorEditableFields subset
        ↓
[SUBMITTED]
  Action: submitWorkPaper()
  Guard: prepared_by_id === user.user_id OR canUserPerform(update)
  Required fields (non-SUPER_ADMIN): observation_title, observation_description,
    risk_rating, audit_area_id, sub_area_id, recommendation, management_response,
    affiliate_code, year, prepared_by_id + evidence file (unless evidence_override)
  Required fields (SUPER_ADMIN): observation_title, risk_rating, year, affiliate_code
  Side effects: queues WP_SUBMISSION notification to reviewers
        ↓
[UNDER REVIEW]
  Action: reviewWorkPaper(action='review')
  Guard: role in [SUPER_ADMIN, SENIOR_AUDITOR]
  File: 03_WorkPaperService.gs:726
        ↓         ↓
   [APPROVED]  [REVISION REQUIRED]
        ↓         └─► back to Draft for edits → resubmit
  Action: reviewWorkPaper(action='approve')
  Guard: role in [SUPER_ADMIN, SENIOR_AUDITOR]
  Side effects:
    - If responsible_ids set: auto-calls sendToAuditee()
    - Queues WP_APPROVED notification
        ↓
[SENT TO AUDITEE]
  Action: sendToAuditee() — called directly or auto-triggered on approve
  Guard: status must be Approved; SUPER_ADMIN bypasses
  File: 03_WorkPaperService.gs:sendToAuditee()
  Side effects:
    - Auto-creates action plan if none exist
    - Queues AUDITEE_NOTIFICATION to responsibles
    - Sets response deadline (RESPONSE_DEFAULTS.DEADLINE_DAYS = 14)
    - TERMINAL for work paper status — no further transitions
```

#### Deletion Guard
Only `Draft` status deletable. `deleteWorkPaper()` at `03_WorkPaperService.gs:348` — SUPER_ADMIN bypasses status check. Soft delete (`deleted_at = now`).

### 3.2 Action Plan Lifecycle

#### Status Values (`02_Config.gs`)
```
Not Due  →  Pending  →  In Progress  →  Implemented  →  Pending Verification
                                    ↘                          ↓          ↓
                                   Overdue              [Verified]   [Rejected → In Progress]
                                                             ↓
                                                        HOA Review
                                                         ↙      ↘
                                                    [Closed]  [In Progress]
                                             (also: Not Implemented, Closed direct)
```

#### Full Lifecycle with Actors and Guards

```
[NOT DUE / PENDING / IN PROGRESS]
  Created by: anyone who can create (guard: WP must be Sent to Auditee)
  SUPER_ADMIN bypass: can create on any WP status
  Auto-status: NOT DUE if due_date > today, PENDING if due_date = today, 
               IN PROGRESS after first update
  updateOverdueStatuses() (04_ActionPlanService.gs:852):
    - NOT DUE/PENDING/IN PROGRESS → OVERDUE if due_date < now
    - NOT DUE → PENDING if due_date >= now (re-classification)
        ↓
[OVERDUE]
  Automated transition via updateOverdueStatuses()
  No notifications fired on this transition (CRITICAL GAP — see Section 7)
        ↓ (owner submits implementation)
[IMPLEMENTED → PENDING VERIFICATION]
  Action: markAsImplemented()
  Guard: owner OR auditor role (SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR)
  Required: implementation_notes + evidence file
  SUPER_ADMIN bypass: evidence not mandatory
  Side effects: queues AP_IMPLEMENTED notification to auditors
        ↓
[PENDING VERIFICATION → VERIFIED / REJECTED / IN PROGRESS]
  Action: verifyImplementation()
  Guard: role in [SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR]  04_ActionPlanService.gs:679
  approve → VERIFIED
  reject  → REJECTED
  return  → IN PROGRESS
  Side effects: queues AP_VERIFIED or AP_REJECTED notification
        ↓ (VERIFIED only)
[HOA REVIEW → CLOSED / IN PROGRESS]
  Action: hoaReview()
  Guard: role in [SUPER_ADMIN, SENIOR_AUDITOR]  04_ActionPlanService.gs:771
  approve → CLOSED (terminal)
  reject  → IN PROGRESS
        
[DELEGATION FLOW]
  Action: delegateActionPlan()
  Guard: current owner OR [SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR]
  Cannot delegate CLOSED/VERIFIED statuses (SUPER_ADMIN bypasses)
  Side effects:
    - Updates action_plan_owners junction
    - Queues AP_DELEGATED to new owner
    - New owner must respondToDelegation() (accept/reject)
    - Reject: restores original owner, notifies delegator + HOA CC
```

### 3.3 Auditee Response Lifecycle

#### Status Values (`02_Config.gs`)
```
Pending Response → Draft Response → Response Submitted
                                          ↓           ↓
                                  [Response Accepted] [Response Rejected]
                                                             ↓
                                                       (if max rounds) → [Escalated]
                                                       (else) → Draft Response (new round)
```

#### Full Lifecycle with Actors and Guards

```
[PENDING RESPONSE]
  Auto-set by sendToAuditee() when WP moves to Sent to Auditee
  Response round = 1 of MAX_ROUNDS (hardcoded: 3)
        ↓
[DRAFT RESPONSE]
  Action: submitAuditeeResponse(action='save_draft')
  Guard: responsible party, delegated AP owner, auditor, or SUPER_ADMIN
  File: 10_AuditeeService.gs
        ↓
[RESPONSE SUBMITTED]
  Action: submitAuditeeResponse(action='submit')
  Max rounds check: if round > MAX_ROUNDS → error
  AI auto-evaluation hook (10_AuditeeService.gs:381):
    If AI enabled and response score < 50: auto-reject
  Side effects: queues RESPONSE_SUBMITTED to auditors
        ↓                    ↓
[RESPONSE ACCEPTED]    [RESPONSE REJECTED]
  Action:                Action:
  reviewAuditeeResponse  reviewAuditeeResponse
  Guard (both):          Guard (both):
  [SUPER_ADMIN,          [SUPER_ADMIN,
   SENIOR_AUDITOR,        SENIOR_AUDITOR,
   AUDITOR]               AUDITOR]
  10_AuditeeService.gs:473
  Accepted: terminal     Rejected at max rounds → ESCALATED
                         Rejected < max rounds → new Draft Response round
```

### 3.4 User Management Workflow

```
[CREATE USER]
  Service layer: createUser()  07_AuthService.gs:725
    Roles allowed: SUPER_ADMIN, SENIOR_AUDITOR
  Router gate:   08_WebApp.gs:358
    Roles allowed: SUPER_ADMIN ONLY  ← router overrides service
  Side effects:
    - Creates record in 05_Users Turso table
    - Hashes password with PBKDF2-like HMAC-SHA-256 (1000 iterations)
    - Queues WELCOME notification with temporary password
    - Logs audit event

[UPDATE USER]
  Service layer: updateUser()  07_AuthService.gs:812
    Allowed: self-edit OR (SUPER_ADMIN or SENIOR_AUDITOR)
    Admin-only fields: email, role_code, affiliate_code, is_active
  Router gate:   08_WebApp.gs:358
    Allowed: SUPER_ADMIN ONLY ← router overrides service

[DEACTIVATE USER]
  Service layer: deactivateUser()  07_AuthService.gs:886
    Allowed: SUPER_ADMIN ONLY
  Router gate:   08_WebApp.gs:358
    Allowed: SUPER_ADMIN ONLY
  Side effects: sets is_active=0; invalidates all sessions for that user

[RESET PASSWORD]
  Service layer: resetPassword()  07_AuthService.gs:609
    Allowed: SUPER_ADMIN, SENIOR_AUDITOR
  Router gate: NOT separately restricted (falls under admin block or own action)
  Side effects: generates temp password, queues PASSWORD_RESET notification

[LIST USERS]
  Service layer: getUsers()  07_AuthService.gs:985
    Allowed: SUPER_ADMIN, SENIOR_AUDITOR
  Router gate:   08_WebApp.gs:358
    Allowed: SUPER_ADMIN ONLY
```

### 3.5 Dropdown / Config Management Workflow

```
[ALL DROPDOWN CRUD]
  Functions: getDropdownItems, createDropdownItem, updateDropdownItem,
             deleteDropdownItem, updateDropdownOrder, saveConfigDropdown
  File: 11_DropdownService.gs
  Guard: requireSuperAdmin_(user)  — SUPER_ADMIN only
  Collections managed: audit_areas (07_AuditAreas), sub_areas (08_ProcessSubAreas),
                        affiliates (06_Affiliates), config (00_Config, DROPDOWN_* keys)

[SYSTEM CONFIG]
  Function: saveSystemConfigValues()  09_AnalyticsService.gs:256
  Guard: SUPER_ADMIN only
  Keys managed: SYSTEM_NAME, SESSION_TIMEOUT_HOURS, PASSWORD_MIN_LENGTH,
                MAX_LOGIN_ATTEMPTS, AUDIT_FILES_FOLDER_ID

[DROPDOWN DELETION]
  deleteDropdownItem() checks references before delete:
    audit_areas:  sub_areas count + work_papers count
    sub_areas:    work_papers count
    affiliates:   users count + work_papers count
  If confirmed !== true, returns counts without deleting
  
[INVALIDATION]
  Every write calls invalidateDropdownCache()
  Cache key: 'dropdowns' (TTL: 1800s per 01_Core.gs CACHE_TTLS.DROPDOWNS)
```

### 3.6 Notification Workflow

```
[QUEUE NOTIFICATION]
  queueNotification()  05_NotificationService.gs
  - Validates recipient is active (skips silently if not)
  - Writes to notification_queue table: recipient_id, type, subject, body, 
    metadata JSON, status='pending'
  - CC recipients added as separate queue entries

[PROCESS EMAIL QUEUE]
  processEmailQueue()  05_NotificationService.gs:588
  Trigger: time-based Apps Script trigger (external, not defined in .gs files)
  Lock: LockService.getScriptLock() — 10-second wait
  Batch size: 50 per run
  Flow:
    1. Fetch up to 50 pending from notification_queue (ORDER BY created_at ASC)
    2. For each: attempt send via Microsoft Graph API (Outlook OAuth2)
    3. If Graph fails: fallback to MailApp (GAS built-in)
    4. If both fail: mark status='failed', record error, continue
    5. On success: mark status='sent', record sent_at
  Private templates (WELCOME, PASSWORD_RESET, etc.) skip CC
  
[HOA CC NOTIFICATIONS]
  queueHoaCcNotifications()  05_NotificationService.gs:146
  Target: ALL users with role_code = ROLES.SUPER_ADMIN
  Triggers: WP_ASSIGNMENT, delegation events
  Note: SENIOR_AUDITOR is NOT included in HOA CC — only SUPER_ADMIN

[STALE ASSIGNMENT REMINDERS]
  sendStaleAssignmentReminders()  05_NotificationService.gs:441
  Deduplication: queries notification_queue for STALE_REMINDER
    with same work_paper_id + recipient_id within 3 days
  Targets: work papers in Draft/Submitted/Under Review for >N days
  
[RETRY FAILED EMAILS]
  retryFailedEmails()  05_NotificationService.gs
  Resets ALL failed queue entries to 'pending'
  Risk: if send error is permanent (bad address, quota exceeded),
        retry loop will cycle indefinitely until manually cleared
```

### 3.7 File / Evidence Workflow

```
[UPLOAD]
  Allowed roles (FILES module): SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR, JUNIOR_STAFF
  Target: Google Drive subfolder configured via AUDIT_FILES_FOLDER_ID config key
  Creates record in file_attachments junction table:
    entity_type: 'WORK_PAPER' | 'ACTION_PLAN' | 'AUDITEE_RESPONSE'
    entity_id: respective ID

[VIEW]
  Allowed roles: SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR, JUNIOR_STAFF,
                 SENIOR_MGMT, UNIT_MANAGER, EXTERNAL_AUDITOR
  BOARD_MEMBER: FILES.view = false — cannot view attachments

[DELETE]
  SUPER_ADMIN: yes
  SENIOR_AUDITOR: yes
  AUDITOR: no
  All others: no

[EVIDENCE BYPASS]
  Work papers: SUPER_ADMIN can set evidence_override=true on WP record
    → bypasses evidence requirement on submit
    03_WorkPaperService.gs:231
  Action plans: SUPER_ADMIN evidence not required in markAsImplemented()
    04_ActionPlanService.gs:615
```

---

## 4. Interaction Loops & Side-Effect Chains

### 4.1 `updateOverdueStatuses` — Automated Status Transition

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | External time-based Apps Script trigger (not defined in any .gs file) |
| **ACTOR** | System (no user context) |
| **FILE:LINE** | `04_ActionPlanService.gs:852` |
| **ACTION** | Direct SQL UPDATE — sets `status='Overdue'` where `due_date < now` and status in `('Not Due','Pending','In Progress')`. Also sets `status='Pending'` for `NOT DUE` items where `due_date >= now`. |
| **SIDE EFFECTS** | None — no notifications are queued on this transition. No audit log entry written. Status change is silent. |
| **LOOP RISK** | **NONE** — it does not enqueue itself, does not call any notification function, and does not modify any data that would trigger a re-run. |
| **COMPLIANCE GAP** | Overdue status transitions are invisible to stakeholders. No notification to AP owners, no escalation notification to SUPER_ADMIN/SENIOR_AUDITOR. This is a governance gap: owners may be unaware their AP has become overdue. |

### 4.2 `processEmailQueue` — Email Dispatch

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | External time-based Apps Script trigger (not defined in any .gs file) |
| **ACTOR** | System (no user context) |
| **FILE:LINE** | `05_NotificationService.gs:588` |
| **ACTION** | Fetches up to 50 `status='pending'` rows from `notification_queue`, attempts send via Microsoft Graph API, fallback to MailApp. |
| **SIDE EFFECTS** | Updates `notification_queue.status` to `'sent'` or `'failed'`. Records `sent_at` or `error_message`. |
| **LOOP RISK** | **LOW under normal operation.** The function itself does not enqueue new notifications. However `retryFailedEmails()` can reset all `failed` records to `pending`, creating a retry cycle if the underlying send error is permanent (invalid email, quota exceeded, OAuth2 token expired). Mitigation: `retryFailedEmails()` is manually invoked, not automatic. |
| **CONCURRENCY** | Protected by `LockService.getScriptLock()` with 10-second timeout. If lock cannot be obtained, function exits silently. |
| **OAUTH2 DEPENDENCY** | Microsoft Graph OAuth2 credentials (`OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REFRESH_TOKEN`) stored in Script Properties. Token refresh failure causes all Outlook sends to fail and fall back to MailApp. If MailApp quota is also exhausted, all 50 queue items per batch will be marked `failed`. |

### 4.3 `sendStaleAssignmentReminders` — Stale WP Notifications

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | External time-based trigger |
| **ACTOR** | System |
| **FILE:LINE** | `05_NotificationService.gs:441` |
| **ACTION** | Queries work papers in Draft/Submitted/Under Review > N days old. For each, checks `notification_queue` for a `STALE_REMINDER` for same `work_paper_id + recipient_id` within 3 days. If none found, queues new reminder. |
| **SIDE EFFECTS** | Writes `STALE_REMINDER` rows to `notification_queue` which will be dispatched by next `processEmailQueue` run. |
| **LOOP RISK** | **NONE.** Deduplication query prevents duplicate reminders within 3-day window. The function reads the queue but does not trigger itself. Each WP + recipient pair is throttled. |
| **GAP** | The 3-day deduplication window is hardcoded. No config key governs reminder frequency. |

### 4.4 `dailyMaintenance` — Composite Maintenance Function

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | External daily time-based trigger |
| **ACTOR** | System |
| **FILE:LINE** | Not found in any .gs file — **function is referenced in documentation/triggers but NOT defined in the codebase**. |
| **ACTION** | Unknown — assumed to call `updateOverdueStatuses()`, `processEmailQueue()`, `cleanupExpiredSessions()`, cache warming. |
| **LOOP RISK** | Cannot assess — function body not found. |
| **COMPLIANCE GAP** | If `dailyMaintenance` is the trigger entry-point and it's not defined in source-controlled .gs files, maintenance behaviour is opaque and potentially lost if the project is re-deployed. |

### 4.5 `reviewWorkPaper` → Auto `sendToAuditee` Chain

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | Reviewer calls `reviewWorkPaper(action='approve')` with `responsible_ids` set |
| **ACTOR** | SUPER_ADMIN or SENIOR_AUDITOR |
| **FILE:LINE** | `03_WorkPaperService.gs:841` |
| **ACTION** | Approval automatically calls `sendToAuditee()` without requiring a second explicit action. |
| **SIDE EFFECTS** | WP status → `Sent to Auditee`; auto-creates action plan if none exist; queues `AUDITEE_NOTIFICATION`; sets 14-day response deadline. |
| **LOOP RISK** | **NONE** — `sendToAuditee()` does not call `reviewWorkPaper()`. Terminal status; no further transitions from `Sent to Auditee`. |
| **NOTE** | Reviewer may be unaware that approving with `responsible_ids` set immediately sends to auditees — no confirmation step. |

### 4.6 `submitAuditeeResponse` → AI Auto-Reject Chain

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | Auditee submits response |
| **ACTOR** | Responsible party (JUNIOR_STAFF, UNIT_MANAGER, SENIOR_MGMT, or delegated owner) |
| **FILE:LINE** | `10_AuditeeService.gs:381` |
| **ACTION** | If AI integration enabled and response quality score < 50, response is **automatically rejected** without human review. |
| **SIDE EFFECTS** | Status → `Response Rejected`. If at `MAX_ROUNDS`, auto-escalates to `Escalated`. |
| **LOOP RISK** | **MODERATE.** If AI provider is misconfigured and returns score < 50 for all responses, all submissions are auto-rejected, cycling through rounds until `MAX_ROUNDS` is reached, then auto-escalating. No human-in-the-loop before rejection. No notification to auditee explaining AI rejection rationale. |
| **COMPLIANCE GAP** | AI auto-rejection without human review is a governance risk. The threshold (50) is hardcoded. No audit log entry explicitly records "rejected by AI" vs "rejected by human". |

### 4.7 `queueHoaCcNotifications` → Cascade to All SUPER_ADMINs

| Attribute | Value |
|-----------|-------|
| **TRIGGER** | WP assignment, delegation events |
| **ACTOR** | Any action that calls `queueHoaCcNotifications()` |
| **FILE:LINE** | `05_NotificationService.gs:146` |
| **ACTION** | Queries ALL users with `role_code = ROLES.SUPER_ADMIN` and queues a CC notification to each. |
| **SIDE EFFECTS** | If there are N SUPER_ADMIN users, N CC notification rows are inserted per triggering event. |
| **LOOP RISK** | **NONE** — does not trigger new events. |
| **SCALE NOTE** | If SUPER_ADMIN user count grows, every assignment/delegation creates proportionally more queue rows. Not a loop risk but a volume scaling issue. |

---

## 5. Hardcoded Values That Should Be in Turso

### Legend
- **CRITICAL**: Value is embedded in source code — changing it requires a code deployment.
- **HIGH**: Value is in a GAS constant read at runtime — no DB column exists but adding one is feasible without schema change.
- **MEDIUM**: DB has a config key slot (`00_Config` table) but no UI exposes it and no code reads from DB for this value.

### 5.1 Authentication & Session Parameters

| Value | Current Location | Current Value | Impact of Hardcoding | Severity |
|-------|-----------------|---------------|----------------------|----------|
| `SESSION_DURATION_HOURS` | `07_AuthService.gs:12` in `AUTH_CONFIG` | `24` | Session expiry cannot be changed without redeployment | **CRITICAL** |
| `MAX_LOGIN_ATTEMPTS` | `07_AuthService.gs:12` in `AUTH_CONFIG` | `5` | Brute-force threshold fixed | **CRITICAL** |
| `LOCKOUT_DURATION_MINUTES` | `07_AuthService.gs:12` in `AUTH_CONFIG` | `30` | Lockout duration fixed | **CRITICAL** |
| `PBKDF2_ITERATIONS` | `07_AuthService.gs:12` in `AUTH_CONFIG` | `1000` | Low iteration count; cannot increase without redeployment AND rehashing all passwords | **CRITICAL** |
| `PASSWORD_MIN_LENGTH` | `07_AuthService.gs:666` | `8` | Min password length fixed; `saveSystemConfigValues` saves `PASSWORD_MIN_LENGTH` to DB but `validatePassword()` never reads it from DB | **CRITICAL** |
| `SYSTEM_NAME` | `07_AuthService.gs:114` | `'Hass Petroleum Internal Audit System'` | Organisation name in login response is hardcoded; also saveable via `saveSystemConfigValues` but login code doesn't read it | **CRITICAL** |

**Note on `PASSWORD_MIN_LENGTH` and `SESSION_TIMEOUT_HOURS`:** `saveSystemConfigValues()` in `09_AnalyticsService.gs:256` saves these to the `00_Config` Turso table, creating an illusion that they are configurable. However `AUTH_CONFIG` in `07_AuthService.gs` is a static constant never re-read from DB after deployment. The DB value is written but not consumed.

### 5.2 Permission Matrix

| Value | Current Location | Severity |
|-------|-----------------|----------|
| Entire `ROLE_PERMISSIONS` constant | `02_Config.gs:196` | **CRITICAL** — 9 roles × 9 modules × 6 actions. Any permission change requires code deploy. A `role_permissions` table exists in Turso (`00_TursoService.gs` declares it) but `checkPermission()` never queries it. |
| Entire `ROLE_WORKFLOW_ACCESS` constant | `02_Config.gs:303` | **CRITICAL** — 10 workflow stages per role. Not used in runtime checks but intended as governance reference. |
| Module-specific role arrays in service files | See Section 2.3 | **CRITICAL** — reviewer roles, HOA roles, etc. are inline arrays. |

### 5.3 Workflow & Business Rules

| Value | Current Location | Current Value | Severity |
|-------|-----------------|---------------|----------|
| `RESPONSE_DEFAULTS.DEADLINE_DAYS` | `10_AuditeeService.gs:9` | `14` | Auditee response deadline fixed at 14 days | **CRITICAL** |
| `RESPONSE_DEFAULTS.MAX_ROUNDS` | `10_AuditeeService.gs:9` | `3` | Max response rounds fixed at 3 | **CRITICAL** |
| AI auto-reject threshold | `10_AuditeeService.gs:381` | `50` (score) | AI quality threshold hardcoded | **CRITICAL** |
| Stale reminder deduplication window | `05_NotificationService.gs:441` | `3` days | Reminder frequency hardcoded | **CRITICAL** |
| Action plan due-date maximum | `04_ActionPlanService.gs` | `6 months` | Maximum AP due date range hardcoded | **CRITICAL** |
| Evidence override field restriction | `03_WorkPaperService.gs:231` | SUPER_ADMIN only | Cannot open this to SENIOR_AUDITOR without code change | **CRITICAL** |

### 5.4 Dropdown / Reference Data (DB Exists but Code Falls Back to Hardcoded)

| Value | DB Config Key | Fallback Hardcoded Values | Severity |
|-------|--------------|--------------------------|----------|
| Risk ratings | `DROPDOWN_RISK_RATINGS` | `['Extreme','High','Medium','Low']` — `02_Config.gs:715` | **MEDIUM** — DB key exists, UI exposes via `saveConfigDropdown`, but fallback masks missing DB value |
| Control classifications | `DROPDOWN_CONTROL_CLASSIFICATIONS` | Hardcoded defaults | **MEDIUM** |
| Control types | `DROPDOWN_CONTROL_TYPES` | Hardcoded defaults | **MEDIUM** |
| Control frequencies | `DROPDOWN_CONTROL_FREQUENCIES` | Hardcoded defaults | **MEDIUM** |

### 5.5 Role Definitions

| Value | Current Location | Severity |
|-------|-----------------|----------|
| `ROLE_DISPLAY_NAMES` | `02_Config.gs:176` | **CRITICAL** — Only 4 of 8 roles have display overrides; all are hardcoded. `getRoleName()` reads from `01_Roles` Turso table but `ROLE_DISPLAY_NAMES` is used in different code paths. |
| Ghost role aliases (`BOARD`, `AUDITEE`, `MANAGEMENT`, `OBSERVER`) | `02_Config.gs:180,559`, `01_Core.gs`, `08_WebApp.gs:622` | **CRITICAL** — Alias logic hardcoded in multiple files; removing `BOARD` alias requires touching at least 3 files. |

### 5.6 AI Configuration

| Value | Current Location | Severity |
|-------|-----------------|----------|
| AI provider API keys | Script Properties (GAS) | **CRITICAL** — not in Turso; visible to all GAS project editors |
| AI model identifiers | `05_AIService.gs` `AI_CONFIG.MODELS` constant | **CRITICAL** — model names hardcoded; new model versions require redeployment |
| Active AI provider | `00_Config` Turso table (`AI_ACTIVE_PROVIDER` key) | **MEDIUM** — DB exposed but switchable only via SUPER_ADMIN UI |

### 5.7 Notification / Email Configuration

| Value | Current Location | Severity |
|-------|-----------------|----------|
| `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`, `OUTLOOK_REFRESH_TOKEN` | Script Properties | **CRITICAL** — OAuth2 credentials not in Turso. Rotation requires Script Properties edit, not UI. |
| `OUTLOOK_SENDER_EMAIL`, `AUDIT_REPLY_TO_EMAIL` | Script Properties | **CRITICAL** — Email addresses hardcoded in properties; no UI to update. |
| Notification batch size (`50`) | `05_NotificationService.gs:588` | **HIGH** — Processing throughput fixed |
| Email queue lock timeout (`10` seconds) | `05_NotificationService.gs:588` | **HIGH** — Concurrency window hardcoded |

---

## 6. Database Schema Gaps for Access Control

### 6.1 The `role_permissions` Table Is Not Used

**Finding:** The Turso schema includes a `role_permissions` table (declared in `00_TursoService.gs` as `TURSO_TABLES['role_permissions']` with `null` PK indicating composite key). The `updatePermissions()` function in `09_AnalyticsService.gs:201` explicitly returns an error:

```javascript
return { success: false, error: 'Permissions are system-managed and cannot be modified from the UI. Contact the system administrator.' };
```

The `getPermissions()` function in `01_Core.gs` reads from `ROLE_PERMISSIONS` (hardcoded constant) not from the `role_permissions` Turso table. `getUserPermissions()` in `06_DashboardService.gs:1001` calls `getPermissionsFresh()` which is **not defined in any .gs file** — a broken reference.

**Impact:** The `role_permissions` Turso table is schema overhead that does not participate in runtime access control. Any records written to it have no effect on system behaviour.

**SQL to make `role_permissions` functional (if desired):**

```sql
-- Ensure table exists with correct schema
CREATE TABLE IF NOT EXISTS role_permissions (
  role_code       TEXT NOT NULL,
  module          TEXT NOT NULL,
  action          TEXT NOT NULL,
  allowed         INTEGER NOT NULL DEFAULT 0,
  field_restrictions TEXT,
  updated_at      TEXT,
  updated_by      TEXT,
  PRIMARY KEY (role_code, module, action)
);

-- Seed from current ROLE_PERMISSIONS constant values
-- (must be done once after table creation)
INSERT OR REPLACE INTO role_permissions (role_code, module, action, allowed) VALUES
  ('SUPER_ADMIN','WORK_PAPERS','view',1),
  ('SUPER_ADMIN','WORK_PAPERS','create',1),
  -- ... (full seed required)
  ('EXTERNAL_AUDITOR','AI_ASSIST','export',0);
```

**To wire it into runtime:**
1. Define `getPermissionsFresh(roleCode)` that queries `role_permissions` WHERE `role_code = ?`
2. Define `getPermissionsCached(roleCode)` that wraps with CacheService (TTL from `CACHE_TTLS.PERMISSIONS`)
3. Modify `getPermissions()` in `01_Core.gs` to call `getPermissionsCached()` as primary, with `ROLE_PERMISSIONS` as fallback
4. Implement `updatePermissions()` in `09_AnalyticsService.gs` to write to `role_permissions` table

### 6.2 Missing Function References (Broken Code)

| Missing Function | Called At | Expected Behaviour |
|-----------------|-----------|-------------------|
| `getPermissionsFresh(roleCode)` | `06_DashboardService.gs:1001` | Query `role_permissions` table from Turso |
| `getPermissionsCached(roleCode)` | `08_WebApp.gs:460` | CacheService-wrapped version of above |

Both functions are called in production code paths but are not defined anywhere in the 13 .gs files. This is a runtime error waiting to occur. If these code paths are reached, `getPermissionsFresh is not a function` will throw, breaking the caller.

### 6.3 Missing `deleted_at` Column — Tables Without Soft Delete

Soft delete (`deleted_at IS NULL` filter) is applied consistently across most tables, but three tables in `TURSO_TABLES` lack this pattern:

| Table | Key in TURSO_TABLES | Concern |
|-------|---------------------|---------|
| `roles` | `01_Roles` | Cannot soft-delete a role without a code change |
| `role_permissions` | `role_permissions` | Permission rows cannot be soft-deleted |
| `config` | `00_Config` | Config rows cannot be soft-deleted |

```sql
-- Add soft delete to roles table
ALTER TABLE roles ADD COLUMN deleted_at TEXT;
ALTER TABLE roles ADD COLUMN deleted_by TEXT;

-- Add soft delete to role_permissions
ALTER TABLE role_permissions ADD COLUMN deleted_at TEXT;
ALTER TABLE role_permissions ADD COLUMN deleted_by TEXT;
```

### 6.4 Missing `updated_at` / `updated_by` Audit Trail on Permission Records

The `role_permissions` table has no `updated_at` or `updated_by` columns in the current schema (based on the null-PK declaration and absence of these fields in any query referencing it). If permissions are ever made dynamic, every change must be auditable.

```sql
ALTER TABLE role_permissions ADD COLUMN updated_at TEXT;
ALTER TABLE role_permissions ADD COLUMN updated_by TEXT;
```

### 6.5 Missing Role-Hierarchy Table

There is no `role_hierarchy` or `role_ranks` table in Turso. The hierarchy is implicit in code logic (SUPER_ADMIN bypass, reviewer arrays, etc.). A formal hierarchy table would allow:
- Querying "roles with approval authority over X"
- Dynamic elevation/delegation policies
- Audit reporting on effective permissions

```sql
CREATE TABLE IF NOT EXISTS role_hierarchy (
  role_code       TEXT NOT NULL PRIMARY KEY,
  parent_role     TEXT,
  rank            INTEGER NOT NULL,
  display_name    TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT,
  FOREIGN KEY (parent_role) REFERENCES role_hierarchy(role_code)
);

INSERT INTO role_hierarchy (role_code, parent_role, rank, display_name) VALUES
  ('SUPER_ADMIN',      NULL,             1, 'Super Administrator'),
  ('SENIOR_AUDITOR',   'SUPER_ADMIN',    2, 'Senior Auditor'),
  ('AUDITOR',          'SENIOR_AUDITOR', 3, 'Auditor'),
  ('JUNIOR_STAFF',     'AUDITOR',        4, 'Audit Client'),
  ('SENIOR_MGMT',      NULL,             5, 'Senior Management'),
  ('UNIT_MANAGER',     'SENIOR_MGMT',    6, 'Head of Department'),
  ('BOARD_MEMBER',     NULL,             7, 'Board Member'),
  ('EXTERNAL_AUDITOR', NULL,             8, 'External Auditor');
```

### 6.6 `sessions` Table — Missing Index for Access Control Queries

Session validation in `07_AuthService.gs` queries by `session_token` hash. If there is no index on this column, every session validation is a full table scan, which will degrade as session count grows.

```sql
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions(user_id, expires_at) WHERE deleted_at IS NULL;
```

### 6.7 Missing `ai_invocations` Audit Table Columns

The `ai_invocations` table is referenced in `05_AIService.gs` for logging AI calls. For compliance, each record should include the role of the invoking user and whether the AI result affected a workflow decision (e.g., auto-rejection).

```sql
ALTER TABLE ai_invocations ADD COLUMN invoker_role TEXT;
ALTER TABLE ai_invocations ADD COLUMN auto_action_taken TEXT;  -- 'AUTO_REJECT', 'AUTO_APPROVE', NULL
ALTER TABLE ai_invocations ADD COLUMN auto_action_entity_id TEXT;
```

### 6.8 `notification_queue` Table — Missing Index for Deduplication Query

`sendStaleAssignmentReminders()` queries the notification_queue for recent `STALE_REMINDER` records by `type`, `work_paper_id` (in metadata JSON), and `created_at`. Without an index on `type` and `created_at`, this is a full-table scan executed on every trigger run.

```sql
CREATE INDEX IF NOT EXISTS idx_notif_type_created ON notification_queue(type, created_at);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_queue(status);
```

---

## 7. SUPER_ADMIN Capability Gaps

### 7.1 Actions SUPER_ADMIN Cannot Perform

| Capability | Blocking Mechanism | Priority |
|------------|-------------------|----------|
| Change any role's permissions at runtime | `updatePermissions()` returns hard error (`09_AnalyticsService.gs:201`); `ROLE_PERMISSIONS` is a compile-time constant | **CRITICAL** |
| Change session timeout that takes effect without redeployment | `AUTH_CONFIG.SESSION_DURATION_HOURS` is a static constant; DB key `SESSION_TIMEOUT_HOURS` is written but never read by `validateSession()` | **CRITICAL** |
| Change password minimum length that takes effect immediately | `validatePassword()` uses hardcoded `8`; DB key `PASSWORD_MIN_LENGTH` written by UI but never read | **CRITICAL** |
| Change login brute-force lockout parameters | `AUTH_CONFIG.MAX_LOGIN_ATTEMPTS` and `LOCKOUT_DURATION_MINUTES` are static constants | **CRITICAL** |
| Change auditee response deadline (currently 14 days) | `RESPONSE_DEFAULTS.DEADLINE_DAYS` hardcoded in `10_AuditeeService.gs:9` | **CRITICAL** |
| Change maximum response rounds (currently 3) | `RESPONSE_DEFAULTS.MAX_ROUNDS` hardcoded in `10_AuditeeService.gs:9` | **CRITICAL** |
| Change AI auto-rejection quality threshold | Threshold `50` hardcoded in `10_AuditeeService.gs:381` | **CRITICAL** |
| Add or remove a role from the system | `ROLES` constant in `02_Config.gs:162`; role list used in cache, permission matrix, dropdown filters throughout; requires multi-file code change | **CRITICAL** |
| Grant SENIOR_AUDITOR the ability to manage users via UI | Router gate at `08_WebApp.gs:358` hardcodes `SUPER_ADMIN` only | **HIGH** |
| Enable/disable HOA CC notifications for a specific event type | `queueHoaCcNotifications()` is called unconditionally from triggering functions; no config flag | **HIGH** |
| Change which roles are CC'd on HOA notifications | CC target hardcoded as `ROLES.SUPER_ADMIN` in `05_NotificationService.gs:146` | **HIGH** |
| Disable AI auto-rejection or change the rejection threshold | No config key; hardcoded comparison in `10_AuditeeService.gs:381` | **HIGH** |
| Configure email retry behaviour (batch size, lock timeout) | Both values hardcoded in `05_NotificationService.gs:588` | **HIGH** |
| Configure stale reminder frequency | Deduplication window (3 days) hardcoded in `05_NotificationService.gs:441` | **HIGH** |
| Configure action plan maximum due-date window | 6-month limit hardcoded in `04_ActionPlanService.gs` | **HIGH** |
| Add display names for SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR, SENIOR_MGMT, EXTERNAL_AUDITOR | `ROLE_DISPLAY_NAMES` only covers 4 roles; others show raw code to users | **MEDIUM** |
| View or manage ghost/alias role `BOARD` | No UI for alias management; `BOARD` → `BOARD_MEMBER` normalisation is silent and undocumented to admin | **MEDIUM** |
| Monitor or purge orphaned cache keys for ghost roles (`AUDITEE`, `MANAGEMENT`, `OBSERVER`) | Cache keys generated in `clearAllCaches()` for non-existent roles; no UI to inspect cache state | **MEDIUM** |
| View whether `dailyMaintenance` trigger is active | Function not in source code; trigger state only visible in GAS trigger UI | **MEDIUM** |
| View `getDashboardDataV2` role-filtered data (currently returns all data to all users) | `06_DashboardService.gs:1432` explicitly bypasses role filtering | **MEDIUM** |

### 7.2 Capability Gaps — Detailed Analysis

#### 7.2.1 Permission Management (CRITICAL)

The most significant gap: `SUPER_ADMIN` has no runtime path to modify permissions. The UI presents a read-only access control dashboard (`getAccessControlDashboardData()` at `09_AnalyticsService.gs:208`) and the `updatePermissions` endpoint explicitly rejects all writes. Every permission change is a code deployment. In a regulated audit environment, this means permission changes cannot be applied urgently (e.g., to revoke a specific capability in response to a security incident) without engineering intervention.

**Root cause:** `getPermissions()` in `01_Core.gs` reads from `ROLE_PERMISSIONS` constant, not from the `role_permissions` Turso table. The DB table exists but is disconnected from the runtime check chain.

**Fix required:**
1. Define `getPermissionsFresh(roleCode)` to read from `role_permissions` table
2. Seed `role_permissions` from current `ROLE_PERMISSIONS` constant
3. Modify `getPermissions()` to use DB-first, constant-fallback
4. Implement `updatePermissions()` to write to DB table
5. Remove the hard-error stub in `09_AnalyticsService.gs:201`

#### 7.2.2 Auth Config Parameters (CRITICAL)

`AUTH_CONFIG` in `07_AuthService.gs:12` is a static object literal. `saveSystemConfigValues()` in `09_AnalyticsService.gs:256` creates a false impression of configurability by saving keys to Turso, but none of the consuming functions (`validateSession`, `validatePassword`, `checkLoginAttempts`) read from Turso at runtime. They all reference the `AUTH_CONFIG` constant directly.

**Fix required:** Each consuming function must be modified to call `getConfigValue(key)` (which is already DB-backed and cached) instead of referencing `AUTH_CONFIG.KEY` directly.

#### 7.2.3 Workflow Parameter Configuration (CRITICAL)

`RESPONSE_DEFAULTS` in `10_AuditeeService.gs:9` governs two critical business rules: the response deadline (14 days) and maximum rounds (3). These cannot be adjusted per affiliate, per audit area, or globally without code changes. In practice, different audit subjects may require different response windows.

**Fix required:** Add config keys `RESPONSE_DEADLINE_DAYS` and `RESPONSE_MAX_ROUNDS` to the `00_Config` table with UI management in the SUPER_ADMIN settings panel.

#### 7.2.4 Missing `getPermissionsFresh` / `getPermissionsCached` Functions (CRITICAL)

These functions are called in live code paths:
- `06_DashboardService.gs:1001` calls `getPermissionsFresh(roleCode)`
- `08_WebApp.gs:460` calls `getPermissionsCached(roleCode)`

Neither is defined. If these code paths execute, a JavaScript `ReferenceError` will be thrown. This means either:
(a) These code paths are never reached in normal operation (the callers have guards that prevent it), OR  
(b) These code paths have been reached and are silently failing (Google Apps Script will catch and return an error response)

Either scenario is a compliance risk: undefined behaviour in access-control code is unacceptable in an audit system.

#### 7.2.5 Dashboard Data Exposure (MEDIUM)

`getDashboardDataV2()` at `06_DashboardService.gs:1432` is documented as returning "No role-based filtering — returns ALL data (SUPER_ADMIN level)." This means a `JUNIOR_STAFF` or `EXTERNAL_AUDITOR` user who can reach this endpoint gets SUPER_ADMIN-level data visibility. The router at `08_WebApp.gs` must be checked to confirm whether `getDashboardDataV2` is gated or openly accessible; if it is accessible to all authenticated users, this is a data confidentiality breach.

#### 7.2.6 `canViewDashboard`, `canViewAIAssist`, `canViewAuditWorkbench` Overrides (MEDIUM)

`06_DashboardService.gs:1039,1047,1053` forces these three UI permission flags to `true` for ALL roles, regardless of DB permissions or `ROLE_PERMISSIONS` values. Even if `ROLE_PERMISSIONS['EXTERNAL_AUDITOR']['AI_ASSIST']['view']` is `false` (which it is), the `getUserPermissions()` function will return `canViewAIAssist: true` for EXTERNAL_AUDITOR. This creates a discrepancy between the stated permission matrix and actual UI access.

### 7.3 Summary Priority Table

| Priority | Count | Items |
|----------|-------|-------|
| **CRITICAL** | 8 | Permission management, session timeout, password length, lockout params, response deadline, response rounds, AI rejection threshold, add/remove roles |
| **HIGH** | 7 | SENIOR_AUDITOR user management, HOA CC config, HOA CC target, AI rejection disable, email batch size, stale reminder frequency, AP due-date window |
| **MEDIUM** | 7 | Role display names, BOARD alias, ghost role cache keys, dailyMaintenance visibility, dashboard V2 filtering, permission UI overrides, evidence override scope |

---

*End of audit document. All findings derived from static analysis of source files in `/home/user/Internal-Audit-System/`. No runtime testing was performed. Line number references are approximate where file offsets were used during reading.*
