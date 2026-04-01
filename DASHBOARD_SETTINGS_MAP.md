# Dashboard, Settings, Login & Sidebar -> Firestore Mapping

---

## 1. Dashboard (Dashboard.html) — Stat Cards

| Stat Card | DOM ID | Firestore Source | Backend Function | Notes |
|---|---|---|---|---|
| Work Papers | `statTotalWP` | `work_papers` count | `getSummaryStats()` -> `getWorkPaperCounts()` | `wp.total` |
| Pending Review | `statPendingReview` | `work_papers` where `status = 'Submitted'` | `getSummaryStats()` -> `wpCounts.byStatus['Submitted']` | Also live-refreshed via `getSidebarCounts()` every 15s |
| Action Plans | `statTotalAP` | `action_plans` count | `getSummaryStats()` -> `getActionPlanCounts()` | `ap.total` |
| Overdue | `statOverdue` | `action_plans` where `due_date < today` AND status not in closed set | `getSummaryStats()` -> `apCounts.overdue` | Closed = Implemented, Verified, Not Implemented, Closed, Rejected |

### Pending Reviews Panel

| Panel | DOM ID | Firestore Source | Fields Used |
|---|---|---|---|
| WP to Review | `pendingWPReviewList` | `work_papers` (status=Submitted) | `work_paper_id`, `observation_title`, `risk_rating` |
| AP to Verify | `pendingAPVerifyList` | `action_plans` (status=Implemented) | `action_plan_id`, `action_description` |
| Auditee Responses | `pendingResponseList` | `work_papers` (response_status=Response Submitted) | `work_paper_id`, `observation_title`, `submitted_by_name`, `response_round`, `risk_rating` |

### Due This Week

| DOM ID | Firestore Source | Fields Used |
|---|---|---|
| `dueThisWeekList` | `action_plans` (due_date within 7 days, non-closed) | `action_plan_id`, `action_description`, `due_date` |

### Needs Your Attention

| Attention Item | Trigger Condition | Firestore Fields |
|---|---|---|
| Overdue APs | `ap.overdue > 0` | `action_plans.due_date`, `action_plans.status` |
| Pending Reviews | `wp.submitted > 0` | `work_papers.status` |
| Due This Week | `ap.dueThisWeek > 0` | `action_plans.due_date` |

### Recent Activity Table

| Column | Firestore Field | Collection |
|---|---|---|
| Type | `type` (WORK_PAPER / ACTION_PLAN) | mixed |
| Title | `observation_title` / `action_description` | work_papers / action_plans |
| Status | `status` | both |
| Updated | `updated_at` / `created_at` | both |

### Team Performance Charts (HOA / Senior Auditor only)

| Chart | DOM ID | Data Source | Fields |
|---|---|---|---|
| Auditor Productivity | `auditorProductivityChart` | `teamStats.auditorStats` | `name`, `workPapers` (count per auditor) |
| Affiliate Comparison | `affiliateComparisonChart` | `teamStats.affiliateStats` | `name`, `open`, `closed` (per affiliate) |

---

## 2. Login (Login.html) — Field Mapping

### Form Fields Submitted

| Field | HTML ID | Submitted Key | Validation |
|---|---|---|---|
| Email | `email` | `email` | `type="email"`, regex `^[^\s@]+@[^\s@]+\.[^\s@]+$`, `required` |
| Password | `password` | `password` | `required`, `minlength="6"` |
| Remember Me | `rememberMe` | _(client-only)_ | Saves email to `localStorage`, NOT sent to server |

### Auth Flow

| Step | Function | File |
|---|---|---|
| Form submit | `handleLogin(event)` | Login.html:472 |
| Server call | `google.script.run.apiCall('login', {email, password})` | Login.html:488 |
| HTTP fallback | `httpApiCall('login', {email, password})` | Login.html:495 |
| Backend handler | `login(email, password)` | 07_AuthService.gs:13 |

### `login()` Backend Logic (07_AuthService.gs)

| Check | Firestore Field | Collection | How Compared |
|---|---|---|---|
| User lookup | `email` | users | `getUserByEmailCached(email.toLowerCase().trim())` |
| Active check | `is_active` | users | `isActive(user.is_active)` — handles bool AND string `'true'`/`'false'` |
| Lockout check | `locked_until` | users | `new Date(locked_until) > new Date()` |
| Password verify | `password_salt`, `password_hash` | users | HMAC-SHA256, 1000 iterations |
| Must change pwd | `must_change_password` | users | `=== true \|\| === 'true' \|\| === 'TRUE'` |

### `isActive()` (02_Config.gs:629) — Handles String Booleans

```javascript
function isActive(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'active';
  }
}
```

### Login Response (stored in `sessionStorage.loginInitData`)

| Key | Source |
|---|---|
| `user.user_id` | `users.user_id` |
| `user.email` | `users.email` |
| `user.full_name` | `users.full_name` |
| `user.role_code` | `users.role_code` |
| `user.role_name` | Resolved via `getRoleName(role_code)` |
| `user.affiliate_code` | `users.affiliate_code` |
| `user.department` | `users.department` |
| `user.must_change_password` | `users.must_change_password` (string-safe comparison) |
| `sessionToken` | `sessions.session_token` (new session created in Firestore) |
| `permissions` | From `getUserPermissions(role_code)` |
| `dropdowns` | Cached dropdown data |

---

## 3. Settings — User Management Tab

### User Table Columns

| Column | Firestore Field | Collection | Notes |
|---|---|---|---|
| Name | `full_name` | users | |
| Email | `email` | users | |
| Role | `role_code` | users | Displayed raw as badge, NOT resolved to display name |
| Affiliate | `affiliate_code` | users | |
| Status | `is_active` | users | **Truthy check** (`u.is_active ?`) — works for bool `true` but breaks for string `'true'` |
| Last Login | `last_login` | users | `formatDate()` or "Never" |

### User Table Filters

| Filter | DOM ID | Firestore Field | Comparison |
|---|---|---|---|
| Search | `userSearchInput` | `full_name`, `email` | `.toLowerCase().includes()` |
| Role | `userFilterRole` | `role_code` | `=== role` |
| Status | `userFilterStatus` | `is_active` | `String(u.is_active) !== status` — compares `String(bool)` with `'true'`/`'false'` |

### Role Dropdown Source

The role filter dropdown is populated from `window.appDropdowns.roles` (from `getDropdownData()`). This reads from the **roles** Firestore collection.

**DB has:** AUDITOR, BOARD, EXTERNAL_AUDITOR, JUNIOR_STAFF, SENIOR_AUDITOR, SENIOR_MGMT, UNIT_MANAGER
**Code expects:** AUDITOR, BOARD_MEMBER, EXTERNAL_AUDITOR, JUNIOR_STAFF, SENIOR_AUDITOR, SENIOR_MGMT, SUPER_ADMIN, UNIT_MANAGER

### User Edit Form Fields

| Field | DOM ID | Firestore Field | Notes |
|---|---|---|---|
| *(hidden)* | `userFormId` | `user_id` | Set on edit, empty on create |
| Full Name | `userFormName` | `full_name` | |
| Email | `userFormEmail` | `email` | |
| Role | `userFormRole` | `role_code` | Dropdown from `appDropdowns.roles` (code/name) |
| Affiliate | `userFormAffiliate` | `affiliate_code` | Dropdown from `appDropdowns.affiliates` (code/display) |

### User Actions

| Action | API Call | Fields Written |
|---|---|---|
| Create User | `createUser` | `full_name`, `email`, `role_code`, `affiliate_code` + auto: `user_id`, `password_hash`, `password_salt`, `is_active`, `must_change_password`, `created_at` |
| Update User | `updateUser` | `full_name`, `email`, `role_code`, `affiliate_code` |
| Reset Password | `resetPassword` | `password_hash`, `password_salt`, `must_change_password` |
| Deactivate | `deactivateUser` | `is_active` -> false |

---

## 4. Sidebar Navigation Logic (Scripts.html)

### `setupNavigation(permissions)` — Scripts.html:679

| Rule | Condition | Nav Items Shown/Hidden |
|---|---|---|
| SUPER_ADMIN | `role === 'SUPER_ADMIN'` | **All items shown**, early return |
| Audit Workbench | `p.canViewAuditWorkbench` | `navAuditWorkbench`, `navQuickStats` |
| New WP | `p.canCreateWorkPaper` | `navNewWorkPaper` |
| My WPs | `p.canCreateWorkPaper` | `navMyWorkPapers` |
| Pending Review | `p.canReviewWorkPaper` | `navPendingReview` |
| Send Queue | `p.canApproveWorkPaper` | `navSendQueue`, `navResponsesReview` |
| Reports (Dashboard) | Always | `navReports` (visible to ALL roles) |
| AI Assist | `p.canViewAIAssist` | `navAnalytics` |
| Admin (Users/Settings) | `role === 'SUPER_ADMIN'` | `navUsers`, `navSettings`, `navAdminSection` |
| WP Section | Hardcoded role array: `SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR` + view-only `BOARD_MEMBER` | `navAuditMgmtSection` and children |
| Auditee Section | Hardcoded role array: `JUNIOR_STAFF, UNIT_MANAGER, SENIOR_MGMT` | `navAuditeeSection`, `navAuditeeMenu` |
| Board Reports | Hardcoded: `BOARD_MEMBER, SUPER_ADMIN` | `navBoardReports` |

### Badge Counts (from `getSidebarCounts`)

| Badge | DOM ID | Backend Field | Firestore Source |
|---|---|---|---|
| Pending Review | `pendingReviewCount` (via `updateQuickStats`) | `pendingReview` | `work_papers` where `status = 'Submitted'` |
| Overdue APs | `overdueCount` | `myOverdue` | `action_plans` where past due + non-closed |
| My Work Papers | `wpListCount` | `myWorkPapers` | `work_papers` count by `prepared_by_id` |
| My Action Plans | `actionPlansCount` | `myActionPlans` | `action_plans` count by `owner_ids` |
| My Observations | `myObservationsCount` | `myObservations` | `work_papers` where `status='Sent to Auditee'` and `responsible_ids` includes user |
| Responses to Review | `responsesReviewCount` | `pendingResponses` | `work_papers` where `response_status = 'Response Submitted'` |
| Approved Queue | via `updateQuickStats` | `approvedQueue` | `work_papers` where `status='Approved'` AND `responsible_ids` non-empty |

### Page Access Guard (Scripts.html:873)

| Page Set | Allowed Roles |
|---|---|
| WP pages (work-papers, work-paper-form, work-paper-view, pending-review, send-queue, responses-to-review) | `SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR, BOARD_MEMBER` |
| work-paper-form | Blocked for `BOARD_MEMBER` (view-only) |
| board-reports | `BOARD_MEMBER, SUPER_ADMIN` only |

### Default Landing Page

| Role | Default Page |
|---|---|
| JUNIOR_STAFF, UNIT_MANAGER, SENIOR_MGMT | `action-plans-overdue` (if overdue > 0) else `auditee-findings` |
| All others | `reports` (Dashboard) |

---

## 5. CONSOLIDATED GAP LIST

All gaps across all mapping documents. Numbering: GAP-1xx = WP Form, GAP-2xx = WP View/List/Queue, GAP-3xx = Auditee, GAP-4xx = AP, GAP-5xx = Dashboard/Settings/Login/Sidebar.

| GAP-ID | Severity | Screen(s) | Frontend Expects | DB Has | Impact | Fix | File(s) |
|---|---|---|---|---|---|---|---|
| GAP-101 | HIGH | WP Form | `control_classification` input | Field in schema, 80% filled | New WPs always empty | Add `<select>`: Preventive, Detective, Corrective, Directive | Workpaperform.html |
| GAP-102 | HIGH | WP Form | `control_type` input | Field in schema, 73% filled | New WPs always empty | Add `<select>`: Manual, Automated, IT-Dependent Manual, Hybrid | Workpaperform.html |
| GAP-103 | HIGH | WP Form | `control_frequency` input | Field in schema, 73% filled | New WPs always empty | Add `<select>`: Ad-hoc, Daily, Weekly, etc. | Workpaperform.html |
| GAP-104 | MEDIUM | WP Form | `control_standards` input | Field in schema, 67% filled | New WPs always empty | Add textarea | Workpaperform.html |
| GAP-105 | LOW | WP Form | — | `assigned_auditor_name` in Firestore (not in schema) | Orphan field, never written | Ignore (legacy) | — |
| GAP-106 | LOW | WP Form | — | `affiliate_name` in Firestore | Runtime-resolved, not persisted | Expected behavior | — |
| GAP-107 | INFO | WP Form | `wpWorkPaperRef` readonly | Set server-side | Not in `getFormData()` | Correct by design | Workpaperform.html |
| GAP-108 | INFO | WP Form, Reports | Risk = Extreme/High/Medium/Low | Some old WPs lack Extreme | No breakage | Ensure filters handle all 4 | Workpaperform.html, Reports.html |
| GAP-109 | MEDIUM | WP Form, Send Queue | `cc_recipients` newline-separated | `batchSendToAuditees` splits on comma | Batch send may fail for multi-CC | Normalize to comma delimiter | Workpaperform.html, 03_WorkPaperService.gs |
| GAP-201 | LOW | Send Queue | `affiliate_name`, `audit_area_name` | Not stored on work_papers | Resolved at runtime via lookup | Expected behavior | Sendqueue.html |
| GAP-202 | LOW | WP List | `date_from`/`date_to`, `has_action_plans` filters | Sent to backend but NOT filtered in `getWorkPapersRaw()` | Client-side only; backend ignores | Implement backend filtering or document as client-only | Workpaperslist.html, 03_WorkPaperService.gs |
| GAP-301 | LOW | Auditee Response | — | `auditee_responses.response_type` always `''` | Unused field | Remove from schema or populate | 10_AuditeeService.gs |
| GAP-302 | MEDIUM | Auditee Response | Delegatees can view | `canEditResponse` only checks `responsible_ids` | Delegatees cannot submit responses | Add delegatee check to `canEditResponse` | 10_AuditeeService.gs |
| GAP-303 | LOW | Auditee screens | `cc_recipients`, `affiliate_code`, `audit_area_id`, `year` returned | Not rendered | Wasted payload | Remove from response or render | 10_AuditeeService.gs |
| GAP-401 | MEDIUM | AP View | — | `implemented_by`, `verified_date`, `verified_by` NOT in SCHEMAS.ACTION_PLANS | Written but dropped by `objectToRow()` | Add to schema or switch to `syncToFirestore()` | 04_ActionPlanService.gs |
| GAP-402 | LOW | AP View | — | `delegation_rejected`, `delegation_reject_reason`, `delegation_rejected_by/date`, `delegation_accepted` NOT in schema | Written but not displayed; dropped by `objectToRow()` | Add to schema | 04_ActionPlanService.gs |
| GAP-403 | LOW | AP View | — | `final_status` set to `''` on create, never updated | Dead field | Remove or implement | 04_ActionPlanService.gs |
| GAP-404 | LOW | AP View | `created_by` shown as raw user_id | `created_by` stores user_id not name | Displays `USR-000012` instead of name | Resolve to `created_by_name` | Actionplanview.html |
| GAP-501 | **HIGH** | Settings User Mgmt | Role dropdown from `appDropdowns.roles` | DB roles collection has **BOARD** | Code uses **BOARD_MEMBER** everywhere | Users with role `BOARD` in DB won't match `BOARD_MEMBER` in frontend role checks | Settings.html, 02_Config.gs, roles collection |
| GAP-502 | **HIGH** | Settings User Mgmt | `is_active` truthy check (`u.is_active ?`) | Firestore stores `is_active` as STRING `'true'`/`'false'` | String `'false'` is truthy in JS -> inactive users show as Active | Cast to bool: `isActive(u.is_active)` or `String(u.is_active) === 'true'` | Settings.html:658 |
| GAP-503 | MEDIUM | Settings User Mgmt | Status filter compares `String(u.is_active) !== status` | `is_active` may be bool or string | Filter works for string `'true'` but fails if server returns bool `true` (`String(true) === 'true'` OK, but inconsistent) | Normalize with `isActive()` | Settings.html:643 |
| GAP-504 | **HIGH** | Login | `must_change_password` triple-check: `=== true \|\| === 'true' \|\| === 'TRUE'` | Stored as string in Firestore | Works correctly because of exhaustive check | No fix needed — correctly handled | 07_AuthService.gs:96 |
| GAP-505 | MEDIUM | Sidebar | `BOARD_MEMBER` in `wpViewOnlyRoles` and `boardReportRoles` arrays | DB role is `BOARD`, not `BOARD_MEMBER` | Board users never match these arrays -> nav items hidden | Align DB role code to `BOARD_MEMBER` or update arrays to `BOARD` | Scripts.html:769,797 |
| GAP-506 | MEDIUM | Dashboard | APs use `affiliate_id` storing codes like "HPC" | WPs use `affiliate_code` | Joining AP to affiliate requires knowing AP stores code in `affiliate_id` field (misnamed) | Rename AP field to `affiliate_code` for consistency, or document the alias | 06_DashboardService.gs, 04_ActionPlanService.gs |
| GAP-507 | **HIGH** | Dashboard, Reports | AP sorting/filtering by audit area | `action_plans` has **no `audit_area_id`** field | Cannot group/filter APs by audit area without joining through `work_paper_id` -> `work_papers.audit_area_id` | Always join through WP, or denormalize `audit_area_id` onto AP | 06_DashboardService.gs |
| GAP-508 | **HIGH** | Dashboard, Reports | AP timeline/trend charts use `created_at` | **61% of APs have empty `created_at`** | Charts undercount; recent activity sort breaks for APs without dates | Backfill empty `created_at` from WP `created_at` or AP `updated_at` | 06_DashboardService.gs:419 |
| GAP-509 | LOW | Sidebar | `SUPER_ADMIN` not in DB roles collection | Hardcoded in `02_Config.gs` ROLES constant | No runtime impact — SUPER_ADMIN users have `role_code='SUPER_ADMIN'` on their user doc; roles collection just feeds dropdowns | Add SUPER_ADMIN to roles collection for completeness | roles collection |
| GAP-510 | MEDIUM | Dashboard | Overdue count differs per role | `getSidebarCounts` returns global overdue for SUPER_ADMIN but per-owner for auditee roles | Auditee sidebar shows "their" overdue; workbench `statOverdue` shows global from `getSummaryStats` | Ensure consistency: workbench stat card should also respect role scoping | 06_DashboardService.gs, Scripts.html |
| GAP-511 | LOW | Settings User Mgmt | Role column shows raw `role_code` (e.g. `SENIOR_AUDITOR`) | `role_code` stored, display name in roles collection | Not user-friendly | Resolve to display name from `appDropdowns.roles` | Settings.html:656 |
| GAP-512 | LOW | Dashboard | `renderRecentActivity` uses `item.date \|\| item.updated_at` | APs may have empty both | Row shows "-" for date | Acceptable fallback | Dashboard.html:504 |
