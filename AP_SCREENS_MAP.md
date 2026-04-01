# Action Plan Screens -> Firestore Field Mapping

## 1. Actionplanview.html

### Displayed Fields

| UI Element | Firestore Field | Source |
|---|---|---|
| Status badge | `status` | action_plans |
| Risk badge | `risk_rating` | workPaper (joined) |
| Overdue badge | `days_overdue` | computed via `calculateDaysOverdue(due_date)` |
| "Proposed by Auditee" badge | `auditee_proposed` | action_plans |
| Action Plan ID | `action_plan_id` | action_plans |
| Description | `action_description` | action_plans |
| Owner(s) | `owner_names` | action_plans |
| Due Date | `due_date` | action_plans |
| Created By | `created_by` | action_plans (raw user_id, not resolved to name) |
| Created Date | `created_at` | action_plans |
| Affiliate | `affiliate_code` | workPaper (joined) |
| Action # | `action_number` | action_plans |
| Delegation info | `delegated_by_id`, `delegated_by_name`, `delegated_date`, `delegation_notes`, `original_owner_ids` | action_plans |
| Related Observation | `observation_title` | workPaper (joined) |
| Implementation Notes | `implementation_notes` | action_plans |
| Implemented Date | `implemented_date` | action_plans |
| Evidence list | `evidence_id`, `file_name`, `drive_url`, `file_size`, `mime_type` | ap_evidence (joined) |
| Timeline/History | `history_id`, `previous_status`, `new_status`, `comments`, `user_name`, `changed_at` | ap_history (joined) |
| Auditor Review | `auditor_review_comments`, `auditor_review_by`, `auditor_review_date` | action_plans |
| HOA Review | `hoa_review_comments`, `hoa_review_by`, `hoa_review_date` | action_plans |

### Input Fields

| UI Element | Writes To | Via API |
|---|---|---|
| Implementation Notes textarea | `implementation_notes` | `markAsImplemented` |
| Delegate: new owner select | `owner_ids`, `owner_names` | `delegateActionPlan` |
| Delegate: notes | `delegation_notes` | `delegateActionPlan` |
| Edit: description | `action_description` | `updateActionPlan` |
| Edit: due date | `due_date` | `updateActionPlan` |
| Edit: owners | `owner_ids`, `owner_names` | `updateActionPlan` |
| Verify: comments | `auditor_review_comments` | `verifyImplementation` |
| HOA Review: comments | `hoa_review_comments` | `hoaReview` |
| Reject Delegation: reason | `delegation_reject_reason` | `respondToDelegation` |

### Action Buttons

| Button | Visible When | API Call | Fields Written |
|---|---|---|---|
| Mark as Implemented | owner + status in [Pending,Not Due,In Progress,Rejected] + has evidence | `markAsImplemented` | `status`->"Pending Verification", `implementation_notes`, `implemented_date`, `implemented_by` |
| Delegate | owner + non-terminal | `delegateActionPlan` | `owner_ids`, `owner_names`, `delegated_by_id`, `delegated_by_name`, `delegated_date`, `delegation_notes`, `original_owner_ids` |
| Upload Evidence | owner or auditor + non-terminal | `addActionPlanEvidence` | writes to ap_evidence collection |
| Accept (delegation) | owner + `delegated_by_id` set + `original_owner_ids` set | `respondToDelegation(accept)` | `delegation_accepted`\* |
| Reject (delegation) | same as Accept | `respondToDelegation(reject)` | `delegation_rejected`\*, `delegation_reject_reason`\*, `delegation_rejected_by`\*, `delegation_rejected_date`\*, reverts `owner_ids` |
| Verify (Approve) | auditor + status="Pending Verification" | `verifyImplementation(approve)` | `status`->"Verified", `auditor_review_status`, `auditor_review_by`, `auditor_review_date`, `verified_date`\*, `verified_by`\* |
| Return for Rework | auditor + status="Pending Verification" | `verifyImplementation(return)` | `status`->"In Progress", `auditor_review_status`->"Returned" |
| Reject | auditor + status="Pending Verification" | `verifyImplementation(reject)` | `status`->"Rejected", `auditor_review_status`->"Rejected" |
| HOA Approve (Close) | HOA + status="Verified" | `hoaReview(approve)` | `status`->"Closed", `hoa_review_status`, `hoa_review_by`, `hoa_review_date` |
| HOA Reject | HOA + status="Verified" | `hoaReview(reject)` | `status`->"In Progress", `hoa_review_status`->"Rejected" |
| Edit | auditor + status not in [Verified,Closed] | `updateActionPlan` | `action_description`, `owner_ids`, `owner_names`, `due_date` |
| Delete | auditor + status in [Not Due,Pending,In Progress] | `deleteActionPlan` | removes doc from Firestore |

---

## 2. Actionplanslist.html

### Table Columns

| Column | Firestore Field | Notes |
|---|---|---|
| ID | `action_plan_id` | |
| Description | `action_description` | truncated to 60 chars |
| Work Paper | `work_paper_id` | |
| Owner | `owner_names` | |
| Due Date | `due_date` | |
| Status | `status` | badge with color class |
| Overdue | `days_overdue` | computed; shown as "X days" badge if >0 |

### Kanban Card Fields

| Element | Firestore Field |
|---|---|
| Card ID | `action_plan_id` |
| Description | `action_description` |
| Owner | `owner_names` (first name only, split on comma) |
| Due / Overdue | `due_date`, `days_overdue` |
| Due-soon highlight | `days_until_due` (computed server-side) |

### Filters

| Filter | How It Works | Backend Logic (`getActionPlansRaw`) |
|---|---|---|
| Status dropdown | Sends `status` to API | `row[colMap['status']] !== filters.status` — exact string match |
| Owner dropdown | Sends `owner_id` to API | **`parseIdList(row[colMap['owner_ids']]).includes(filters.owner_id)`** — uses parseIdList, not exact match |
| Overdue Only toggle | Sends `overdue_only: true` | `isPastDue(dueDate)` computed from `due_date` + excludes Implemented/Verified statuses |
| Search | Sends `search` string | searches `action_description` and `implementation_notes` (lowercase includes) |
| "My Action Plans" | Role-based in backend (not explicit UI toggle) | Non-auditor roles: `parseIdList(owner_ids).includes(user.user_id)` |
| Board/External | Role-based filter | Only see statuses: Implemented, Verified, Closed |

### Stats Bar

| Stat | Computation (client-side) |
|---|---|
| Total | `actionPlansData.length` |
| Pending | status in [Pending, Not Due, In Progress] |
| Overdue | `days_overdue > 0` AND status NOT in [Implemented, Pending Verification, Verified, Closed, Not Implemented] |
| Implemented | status in [Implemented, Pending Verification] |
| Verified | status in [Verified, Closed] |

---

## 3. ResponsesToReview.html

### What Determines "Pending Review"

Backend (`getPendingAuditeeResponsesForAuditor` in 10_AuditeeService.gs):
- `wp.status === 'Sent to Auditee'` AND `wp.response_status === 'Response Submitted'`
- Queries **work_papers** collection, not action_plans
- Only visible to auditor roles (SUPER_ADMIN, SENIOR_AUDITOR, AUDITOR)

### Table Columns

| Column | Source Field | Collection |
|---|---|---|
| # | row index | computed |
| Observation Title | `observation_title` | work_papers |
| (subtitle) | `management_response_preview` | response_history (first 100 chars of `management_response`) |
| Auditee | `submitted_by_name` | response_history (latest entry) |
| Risk Rating | `risk_rating` | work_papers |
| Round | `response_round` | work_papers |
| Submitted Date | `submitted_date` | response_history (latest entry) |
| Action Plans | `action_plan_count` | computed: `getActionPlansByWorkPaperRaw(wp_id).length` |
| Action (Review btn) | navigates to `auditee-response` view with `work_paper_id` | — |

### Filters

| Filter | Logic |
|---|---|
| Risk Rating dropdown | Client-side: exact match on `risk_rating` field |
| "Other" risk card | Client-side: excludes Extreme and High |
| Search | Client-side: `observation_title.toLowerCase().indexOf(searchTerm)` |

### Summary Cards

| Card | Computation (client-side) |
|---|---|
| Total Pending | `data.length` |
| Extreme Risk | `risk_rating === 'Extreme'` |
| High Risk | `risk_rating === 'High'` |
| Medium / Low | total - extreme - high |

---

## Answers to Specific Questions

1. **Does Actionplanview.html display `delegation_rejected`, `delegation_reject_reason`, `delegation_rejected_by`?**
   NO. The view only shows delegation info (`delegated_by_name`, `delegated_date`, `delegation_notes`, `original_owner_ids`). Rejection fields are written by `respondToDelegation` but never rendered in the UI.

2. **Does Actionplanview.html display `implemented_by`?**
   NO. `implemented_by` is written by `markAsImplemented()` (line 611 of service) but the view only shows `implemented_date`, not who implemented it.

3. **When delegating, does the code update `owner_ids` or only set `delegated_*` fields?**
   BOTH. `delegateActionPlan()` sets `owner_ids` to the new owner AND sets `delegated_by_id`, `delegated_by_name`, `delegated_date`, `delegation_notes`, and preserves `original_owner_ids`.

4. **Does Actionplanslist "My Action Plans" use `parseIdList()` or exact string match?**
   `parseIdList(owner_ids).includes(user.user_id)` — proper split-based matching, not exact string match. Same for the owner dropdown filter.

5. **Does the Overdue filter check `status==='Overdue'` or `days_overdue>0` or computed from `due_date`?**
   - **Backend (getActionPlansRaw)**: `overdue_only` uses `isPastDue(due_date)` — computed from due_date, excludes Implemented/Verified.
   - **Client stats bar**: uses `days_overdue > 0` (pre-computed server-side via `calculateDaysOverdue`), excludes closed statuses.
   - **Daily trigger**: `updateOverdueStatuses()` sets `status` to "Overdue" and updates `days_overdue` field.

---

## GAPS: Fields Written But Not Displayed

| Field | Written By | Displayed? |
|---|---|---|
| `implemented_by`\* | `markAsImplemented` | NOT shown in UI |
| `delegation_rejected`\* | `respondToDelegation(reject)` | NOT shown |
| `delegation_reject_reason`\* | `respondToDelegation(reject)` | NOT shown |
| `delegation_rejected_by`\* | `respondToDelegation(reject)` | NOT shown |
| `delegation_rejected_date`\* | `respondToDelegation(reject)` | NOT shown |
| `delegation_accepted`\* | `respondToDelegation(accept)` | NOT shown |
| `verified_date`\* | `verifyImplementation(approve)` | NOT shown (only `auditor_review_date` shown) |
| `verified_by`\* | `verifyImplementation(approve)` | NOT shown (only `auditor_review_by` shown) |
| `final_status` | `createActionPlan` (set to '') | Never updated by any workflow function |
| `auditor_review_status` | `verifyImplementation` | NOT directly shown (review comments are shown, but the status string is not) |
| `hoa_review_status` | `hoaReview` | NOT directly shown |
| `response_id` | `createActionPlan` | NOT shown |
| `created_by_role` | `createActionPlan` | NOT shown |

\* = Not in SCHEMAS.ACTION_PLANS — would be dropped by `objectToRow()`
