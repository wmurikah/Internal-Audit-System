# Implementation Plan

## 1. Dashboard Visible to All Users

**Problem:** The "Reports" page (Dashboard/charts) is currently gated behind `canViewDashboard` permission, which reads from the `DASHBOARD` module in the permissions database. Roles without this permission can't see it.

**Changes:**
- **`Scripts.html` (line 409-410):** Remove the conditional hiding of `navReports` based on `canViewDashboard`. The Reports nav item should always be visible.
- **`Scripts.html` (line 454):** Update `getDefaultPage()` — all roles should be able to access 'reports' as a fallback if they can't see audit-workbench.
- **`Scripts.html` (line 419):** Adjust the "hide Insights section" logic so it doesn't hide the section header when Reports is always visible.

**Files:** `Scripts.html`

---

## 2. Doughnut Chart Labels as Callouts Without Background

**Problem:** Risk Distribution, Action Plan Status, Status Distribution, and Aging Distribution doughnut charts use the `datalabels` plugin with `anchor: 'end', align: 'end'` positioning. The labels appear as colored text but don't have explicit callout lines. The request is for labels as callouts without background.

**Changes:**
- **`Reports.html` (lines 594-623):** Update `renderRiskPieChart` — add callout connector lines, remove any background, position labels outside the doughnut with lines pointing to segments.
- **`Reports.html` (lines 625-652):** Update `renderAPStatusChart` — same callout styling.
- **`Reports.html` (lines 756-768):** Update `renderAgingChart` — same callout styling (if doughnut).
- Add `padding` in chart layout to make room for external labels with callout lines.

The datalabels plugin supports `clamp`, `anchor`, `align`, `offset`, and a custom `listeners`/`formatter` approach. For proper callout lines, I'll use the `chartjs-plugin-datalabels` built-in callout feature:
```javascript
datalabels: {
  anchor: 'end',
  align: 'end',
  offset: 16,
  backgroundColor: null,     // No background
  borderColor: null,          // No border
  borderWidth: 0,
  borderRadius: 0,
  padding: 0,
  // Callout connector line:
  clamp: true,
  clip: false,
  // For callout lines, use the "labels" approach with line drawing
}
```

**Files:** `Reports.html`

---

## 3. Charts Showing `area_name` Instead of `area_code`

**Problem:** Work papers in the database store `audit_area_id` but NOT `audit_area_name`. When `getComprehensiveReportData()` builds `byAuditArea`, it does `wp.audit_area_name || areaId` — but `audit_area_name` is never populated on work paper objects from the database (it's not in the WORK_PAPERS schema). So charts display the ID (e.g., "AREA_001") instead of the human-readable name.

**Changes:**
- **`06_DashboardService.gs` (around line 986-990):** After fetching work papers, build an `areaLookup` map by reading the `07_AuditAreas` sheet (area_id → area_name). Then enrich each work paper with `audit_area_name` from this lookup before the byAuditArea aggregation.

```javascript
// Build area lookup: area_id -> area_name
var areaLookup = {};
try {
  var areaSheet = getSheet(SHEETS.AUDIT_AREAS);
  if (areaSheet) {
    var areaData = areaSheet.getDataRange().getValues();
    var areaHeaders = areaData[0];
    var areaIdIdx = areaHeaders.indexOf('area_id');
    var areaNameIdx = areaHeaders.indexOf('area_name');
    for (var ai = 1; ai < areaData.length; ai++) {
      if (areaData[ai][areaIdIdx]) {
        areaLookup[areaData[ai][areaIdIdx]] = areaData[ai][areaNameIdx] || areaData[ai][areaIdIdx];
      }
    }
  }
} catch(e) { console.warn('Failed to load audit areas:', e); }

// Enrich work papers with area_name
workPapers.forEach(function(wp) {
  if (wp.audit_area_id && areaLookup[wp.audit_area_id]) {
    wp.audit_area_name = areaLookup[wp.audit_area_id];
  }
});
```

This ensures:
- **Risk by Audit Area chart** shows area names
- **Control Effectiveness by Audit Area chart** shows area names
- **Detailed Scorecard table** shows area names
- **Detailed Findings table** shows area names

**Files:** `06_DashboardService.gs`

---

## 4. Action Plan Status Change Workflow for Auditees

**Problem:** Currently auditees can mark action plans as "Implemented" without attaching evidence. The requirement is:
- Evidence is NOT mandatory when setting action plans and due dates
- Evidence IS mandatory when changing status to "Implemented"
- Auditees can change status from "Not Due" → "Implemented" or "Not Implemented" → "Implemented"
- Status change to "Implemented" only becomes effective after auditor/super admin approval (this is already the existing flow — `verifyImplementation()` handles approval)

**Changes:**

### Backend (04_ActionPlanService.gs):
- **`markAsImplemented` (line 564):** Add evidence validation check — query the evidence sheet for this action plan; if no evidence exists, reject with error "Evidence attachment is required to mark as implemented."
- **Status transition:** Currently the function only checks for owner/auditor permission, not specific status transitions. The auditee should be allowed to transition from: Not Due, Pending, In Progress, Overdue, Not Implemented → Implemented. Add allowed previous statuses.

### Frontend (Actionplanview.html):
- **`renderAPActions` (line 369):** Currently only shows "Mark as Implemented" button when status is NOT 'Implemented' or 'Verified'. Update to also show for 'Not Implemented' status (it already does since the check is `!['Implemented', 'Verified'].includes(ap.status)`).
- **`markImplemented` (line 445):** Add client-side check: before calling API, check if `currentActionPlan.evidence` has at least one item. If not, show an error toast "Please attach evidence before marking as implemented."

**Files:** `04_ActionPlanService.gs`, `Actionplanview.html`

---

## 5. All Sign-Out Buttons Redirect to Login Page

**Problem:** The `handleLogout()` function already calls `redirectToLogin()`, which creates an anchor element pointing to the base URL. The base URL redirects to the Login page (since `doGet` serves Login.html unless `page=app`). This should already work.

**Verification needed:** The `redirectToLogin()` function at `Scripts.html:791-798` does:
```javascript
var loginUrl = window.__BASE_URL__ || window.location.pathname.replace(/\/exec.*/, '/exec');
```
This builds the URL without `?page=app`, so the server returns the Login page. This seems correct.

**Change (if needed):** Ensure `redirectToLogin()` explicitly appends `?page=login` to be explicit rather than relying on the default behavior.

**Files:** `Scripts.html`

---

## 6. Auto-Redirect to Login After 5 Minutes of Inactivity

**Problem:** No client-side inactivity timeout exists. The session TTL is 24 hours server-side.

**Changes:**
- **`Scripts.html`:** Add an inactivity timer that tracks user interactions (mouse moves, key presses, clicks, scrolls, touch events). After 5 minutes of no activity, automatically log the user out and redirect to login.

```javascript
// Inactivity timeout - 5 minutes
var INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in ms
var inactivityTimer = null;

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(function() {
    // Auto logout due to inactivity
    LocalStore.clear();
    sessionStorage.clear();
    redirectToLogin();
  }, INACTIVITY_TIMEOUT);
}

// Listen for user activity
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(function(evt) {
  document.addEventListener(evt, resetInactivityTimer, { passive: true });
});

// Start timer on app load
resetInactivityTimer();
```

**Files:** `Scripts.html`

---

## Summary of Files to Modify

| File | Changes |
|------|---------|
| `Scripts.html` | Dashboard always visible, sign-out redirect fix, inactivity timer |
| `Reports.html` | Doughnut chart callout labels without background |
| `06_DashboardService.gs` | Area name lookup for charts |
| `04_ActionPlanService.gs` | Evidence mandatory for "Implemented" status |
| `Actionplanview.html` | Client-side evidence check before marking implemented |
