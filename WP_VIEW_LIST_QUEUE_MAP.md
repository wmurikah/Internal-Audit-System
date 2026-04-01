# Workpaperview.html / Workpaperslist.html / Sendqueue.html → Firestore Field Mapping

---

## 1. Workpaperview.html — Displayed Values

| UI Label | HTML ID | Firestore Field | Collection | Notes |
|---|---|---|---|---|
| *(header)* WP ID | `wpViewId` | `work_paper_id` | work_papers | |
| Status badge | `wpViewStatus` | `status` | work_papers | Styled via `getStatusClass()` |
| Risk badge | `wpViewRisk` | `risk_rating` | work_papers | Falls back to "Not Rated" |
| Title | `wpViewTitle` | `observation_title` | work_papers | Falls back to "Untitled" |
| Description | `wpViewDesc` | `observation_description` | work_papers | |
| Affiliate | `wpViewAffiliate` | `affiliate_code` | work_papers | **Shows raw code, not name** — see GAP-201 |
| Audit Area | `wpViewArea` | `audit_area_id` | work_papers | **Shows raw ID, not name** — see GAP-202 |
| Period | `wpViewPeriod` | `audit_period_from` + `audit_period_to` | work_papers | Formatted via `formatDate()` |
| Prepared By | `wpViewPreparer` | `prepared_by_name` | work_papers | |
| Recommendation | `wpViewRecommendation` | `recommendation` | work_papers | |
| Review Comments | `wpViewReviewComments` | `review_comments` | work_papers | Card hidden unless field is truthy |
| AI Insights | `aiInsightsContent` | *(not stored)* | — | Generated on-demand via `getWorkPaperInsights` API |

### Timeline (Workflow Card)

| Event Label | Date Field | User Field | Collection |
|---|---|---|---|
| Created | `created_at` | `prepared_by_name` | work_papers |
| Submitted | `submitted_date` | *(none)* | work_papers |
| Reviewed | `review_date` | `reviewed_by_name` | work_papers |
| Approved | `approved_date` | `approved_by_name` | work_papers |
| Sent to Auditee | `sent_to_auditee_date` | *(none)* | work_papers |

### Action Plans Table

| Column | Firestore Field | Collection |
|---|---|---|
| # | `action_number` | action_plans |
| Description | `action_description` | action_plans | truncated to 50 chars |
| Owner | `owner_names` | action_plans |
| Due | `due_date` | action_plans |
| Status | `status` | action_plans |

### Files List

| Display | Firestore Field | Collection |
|---|---|---|
| File name (link) | `file_name`, `drive_url` | wp_files |
| Delete button | `file_id` | wp_files |

### Action Buttons

| Button | Visible When | API Action | Backend Function | Fields Updated | Status Change |
|---|---|---|---|---|---|
| Edit | status ∈ {Draft, Revision Required} && isAuditor | *(navigates to form)* | — | — | — |
| Submit | status ∈ {Draft, Revision Required} && isAuditor | `submitWorkPaper` | `submitWorkPaper()` | `status`, `submitted_date`, `updated_at` | → Submitted |
| Approve | status ∈ {Submitted, Under Review} && isReviewer | `reviewWorkPaper` {action:'approve'} | `reviewWorkPaper()` | `status`, `reviewed_by_id`, `reviewed_by_name`, `review_date`, `review_comments`, `approved_by_id`, `approved_by_name`, `approved_date`, `updated_at` | → Approved (then auto-sends if `responsible_ids` set) |
| Return | status ∈ {Submitted, Under Review} && isReviewer | `reviewWorkPaper` {action:'return'} | `reviewWorkPaper()` | `status`, `reviewed_by_id`, `reviewed_by_name`, `review_date`, `review_comments`, `revision_count`, `updated_at` | → Revision Required |
| Send to Auditee | status = Approved && isReviewer | `sendToAuditee` | `sendToAuditee()` | `status`, `final_status`, `sent_to_auditee_date`, `response_status`, `response_deadline`, `response_round`, `updated_at` | → Sent to Auditee |
| Generate Insights | always (card visible) | `getWorkPaperInsights` | `getWorkPaperInsights()` | *(none — read-only)* | — |
| Add (Action Plan) | status = Sent to Auditee | *(opens modal)* | `createActionPlan` (via modal) | action_plans collection | — |
| Upload (File) | always (sidebar) | `addWorkPaperFile` (via modal) | `addWorkPaperFile()` | wp_files collection | — |
| Delete File | always (per file) | `deleteWorkPaperFile` | `deleteWorkPaperFile()` | wp_files collection | — |

### Submit Validation (frontend)

`validateWorkPaperFields(data, 'Submitted')` checks: `observation_title`, `observation_description`, `risk_rating`, `affiliate_code`, `audit_area_id`

### Send-to-Auditee Validation (frontend + backend)

Frontend: `validateWorkPaperFields(data, 'Sent to Auditee')` adds: `responsible_ids`, `cc_recipients`
Backend (`sendToAuditee()`): re-validates `responsible_ids`, `cc_recipients`, `observation_title`, `observation_description`, `risk_rating`

---

## 2. Workpaperslist.html — Table Columns

| Column Header | Firestore Field | Sortable? | Notes |
|---|---|---|---|
| *(checkbox)* | `work_paper_id` | no | Bulk select |
| ID | `work_paper_id` | YES (`sortWorkPapers('work_paper_id')`) | Displayed as `<code>` |
| Title | `observation_title` | YES (`sortWorkPapers('observation_title')`) | Sub-line shows `audit_area_id` raw — see GAP-203 |
| Affiliate | `affiliate_code` | no | **Shows raw code, not name** — see GAP-204 |
| Risk | `risk_rating` | no | Badge styled via `getRiskClass()` |
| Status | `status` | no | Badge styled via `getStatusClass()` |
| Prepared By | `prepared_by_name` | no | |
| Date | `created_at` | YES (`sortWorkPapers('created_at')`) | Default sort field, desc |
| Actions | — | no | Dropdown: View, Edit, Delete (Draft only) |

### Card View (alternative layout, same fields)

| Display | Firestore Field |
|---|---|
| ID | `work_paper_id` |
| Status badge | `status` |
| Title | `observation_title` |
| Description preview | `observation_description` | truncated |
| Affiliate badge | `affiliate_code` |
| Risk badge | `risk_rating` |
| Footer: Prepared By + Date | `prepared_by_name`, `created_at` |

### Filters

| Filter Label | HTML ID | Type | Firestore Field Filtered | Notes |
|---|---|---|---|---|
| Search | `wpSearchInput` | text (debounced) | `observation_title`, `observation_description` | Client-side text match in `getWorkPapersRaw()` |
| Year | `wpFilterYear` | select | `year` | Server-side exact match |
| Affiliate | `wpFilterAffiliate` | select | `affiliate_code` | Server-side exact match |
| Audit Area | `wpFilterAuditArea` | select | `audit_area_id` | Server-side exact match |
| Status | `wpFilterStatus` | select | `status` | Server-side exact match. Options: Draft, Submitted, Under Review, Revision Required, Approved, Sent to Auditee |
| Risk Level | `wpFilterRisk` | select | `risk_rating` | Server-side exact match. Options: Extreme, High, Medium, Low |
| Date From | `wpFilterDateFrom` | date | *(client-side only)* | **GAP-205**: Sent to backend as `date_from` but `getWorkPapersRaw()` does NOT filter on it |
| Date To | `wpFilterDateTo` | date | *(client-side only)* | **GAP-205**: Same — backend ignores `date_to` |
| Prepared By | `wpFilterPreparedBy` | select | `prepared_by_id` | Server-side: `filters.prepared_by_id` |
| Has Action Plans | `wpFilterHasAP` | select | *(client-side only)* | **GAP-206**: Sent as `has_action_plans` but backend does NOT filter on it |

### Quick Filter Presets

| Preset | What It Sets |
|---|---|
| All | Clears all filters |
| High Risk | `wpFilterRisk` = "High" |
| Pending Review | `wpFilterStatus` = "Submitted" |
| My Papers | `wpFilterPreparedBy` = current user ID |
| Recent (7 days) | `wpFilterDateFrom` = 7 days ago | **Broken** — backend ignores date_from (GAP-205) |

### List Page Action Buttons

| Button | API Action | Backend Function | Notes |
|---|---|---|---|
| New Work Paper | *(navigates to form)* | — | |
| Export as CSV | `exportWorkPapersCSV` | `exportWorkPapersCSV()` | Passes current filter state |
| Export as Excel | `exportWorkPapersCSV` | same | Same endpoint, format param unused |
| Export Selected | *(client-side)* | — | Builds CSV from `workPapersData` in memory |
| View (row click) | *(navigates to view)* | — | |
| Edit (dropdown) | *(navigates to form)* | — | |
| Delete (dropdown) | `deleteWorkPaper` | `deleteWorkPaper()` | Only shown for Draft status. Confirms first. |

---

## 3. Sendqueue.html — Send Queue

### What Appears in the Queue

`getApprovedSendQueue()` in 03_WorkPaperService.gs:1062:
- Fetches all work papers where `status = 'Approved'`
- Filters to those with `responsible_ids` non-empty
- Groups by auditee (each `responsible_ids` entry)
- Enriches with `affiliate_name` (resolved from `affiliate_code` via dropdown) and `audit_area_name` (resolved from `audit_area_id` via dropdown)

### Summary Cards

| Card | HTML ID | Source |
|---|---|---|
| Work Papers count | `sqTotalWPs` | Sum of all WPs across groups |
| Auditees count | `sqTotalAuditees` | Number of groups |
| Selected count | `sqSelectedCount` | Count of checked checkboxes |
| Select All / Deselect All | `sqSelectAllLabel` | Toggle |

### Group Header (per auditee)

| Display | Source Field | Collection |
|---|---|---|
| Auditee name | `auditee.full_name` (fallback `user_id`) | users (resolved) |
| Auditee email | `auditee.email` | users (resolved) |
| Finding count badge | `workPapers.length` | computed |
| Group checkbox | *(all WPs in group)* | — |

### Table Columns (per WP in group)

| Column Header | Firestore Field | Collection | Notes |
|---|---|---|---|
| *(checkbox)* | `work_paper_id` | work_papers | Per-WP select |
| Observation | `observation_title` (fallback `work_paper_id`) | work_papers | Sub-line: `observation_description` truncated to 80 chars |
| Affiliate | `affiliate_name` (fallback `affiliate_code`) | work_papers + affiliates | **Runtime-resolved** in `getApprovedSendQueue()`, not stored on WP |
| Audit Area | `audit_area_name` (fallback `audit_area_id`) | work_papers + audit_areas | **Runtime-resolved** in `getApprovedSendQueue()`, not stored on WP |
| Risk | `risk_rating` | work_papers | Badge styled |
| Approved | `approved_date` | work_papers | Formatted date |

### Action Buttons

| Button | API Action | Backend Function | Fields Updated | Status Change |
|---|---|---|---|---|
| Refresh | `getSendQueue` | `getApprovedSendQueue()` | *(none — read)* | — |
| Send All to Auditees | `batchSendToAuditees` | `batchSendToAuditees()` | Per WP: `status`, `final_status`, `sent_to_auditee_date`, `response_status`, `response_deadline`, `response_round`, `updated_at` | Approved → Sent to Auditee |

### batchSendToAuditees() Details (03_WorkPaperService.gs:1133)

1. Gets all Approved WPs, filters to selected IDs
2. For each WP: calls `sendToAuditee()` individually (same as single-send)
3. Each `sendToAuditee()`:
   - Validates `responsible_ids`, `cc_recipients`, `observation_title`, `observation_description`, `risk_rating`
   - Sets `status='Sent to Auditee'`, `final_status='Sent to Auditee'`, `sent_to_auditee_date=now`, `response_status='Pending Response'`, `response_deadline=now+14d`, `response_round=0`
   - Auto-creates skeleton action plan if none exist
   - Queues email notifications to responsible parties
4. Groups notifications by auditee — ONE combined email per person

---

## GAPS

| # | Severity | Screen | Gap | Impact | Fix |
|---|---|---|---|---|---|
| GAP-201 | **MEDIUM** | View | `wpViewAffiliate` displays raw `affiliate_code` (e.g. "HP-KEN") instead of affiliate name | Users see codes not names | Resolve `affiliate_name` from `appDropdowns.affiliates` by code |
| GAP-202 | **MEDIUM** | View | `wpViewArea` displays raw `audit_area_id` (e.g. "AREA-001") instead of area name | Users see IDs not names | Resolve `area_name` from `appDropdowns.auditAreas` by id |
| GAP-203 | **LOW** | List | Title column sub-line shows raw `audit_area_id` instead of area name | Inconsistent with Send Queue which resolves names | Resolve area name client-side from dropdowns |
| GAP-204 | **LOW** | List | Affiliate column shows raw `affiliate_code` | Inconsistent with Send Queue which shows `affiliate_name` | Resolve name client-side from dropdowns |
| GAP-205 | **HIGH** | List | `date_from` and `date_to` filters sent to backend but `getWorkPapersRaw()` never reads them | Date range filters and "Recent (7 days)" quick filter are non-functional | Add date filtering logic in `getWorkPapersRaw()` |
| GAP-206 | **MEDIUM** | List | `has_action_plans` filter sent to backend but never processed | "Has Action Plans" advanced filter is non-functional | Add AP join/check in `getWorkPapersRaw()` or filter client-side |
| GAP-207 | **LOW** | List | `prepared_by` filter sent as `prepared_by` but backend checks `filters.prepared_by_id` | "Prepared By" filter silently fails — key name mismatch | Rename to `prepared_by_id` in `loadWorkPapers()` requestFilters, or accept both keys in backend |
| GAP-208 | **INFO** | List | Affiliate and Audit Area columns are not sortable | May be desired, but limits usability | Add `sortWorkPapers('affiliate_code')` / `sortWorkPapers('audit_area_id')` onclick |
| GAP-209 | **INFO** | View | "Submitted" timeline event has no user attribution | All other events show "by [name]" | Could show `prepared_by_name` since submitter = preparer |
| GAP-210 | **INFO** | View | No display for `sub_area_id`, `work_paper_date`, `control_objectives`, `risk_description`, `test_objective`, `testing_steps`, `risk_summary`, `management_response` | View page is a summary — detailed fields only visible when editing | Consider adding expandable "Testing Details" section |
| GAP-211 | **INFO** | Queue | Send Queue shows `approved_date` but not `prepared_by_name` or `submitted_date` | Reviewers may want to see who prepared each WP | Add column |
