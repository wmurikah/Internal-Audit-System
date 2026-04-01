# Work Paper UI-to-Firestore Field Mapping

Collection: **work_papers** (via `SHEETS.WORK_PAPERS`)

---

## 1. Workpaperview.html — Displayed Fields

| UI Label | Firestore Field | Collection | Notes |
|---|---|---|---|
| Status badge | `status` | work_papers | Styled via `getStatusClass()` |
| Work Paper ID | `work_paper_id` | work_papers | Card header |
| Risk Rating badge | `risk_rating` | work_papers | Styled via `getRiskClass()` |
| Title | `observation_title` | work_papers | |
| Description | `observation_description` | work_papers | |
| Affiliate | `affiliate_code` | work_papers | |
| Audit Area | `audit_area_id` | work_papers | |
| Period | `audit_period_from`, `audit_period_to` | work_papers | Formatted as "from to to" |
| Prepared By | `prepared_by_name` | work_papers | |
| Recommendation | `recommendation` | work_papers | |
| Review Comments | `review_comments` | work_papers | Hidden unless present |
| Timeline: Created | `created_at`, `prepared_by_name` | work_papers | |
| Timeline: Submitted | `submitted_date` | work_papers | |
| Timeline: Reviewed | `review_date`, `reviewed_by_name` | work_papers | |
| Timeline: Approved | `approved_date`, `approved_by_name` | work_papers | |
| Timeline: Sent | `sent_to_auditee_date` | work_papers | |
| Action Plans table | `action_plan_id`, `action_number`, `action_description`, `owner_names`, `due_date`, `status` | action_plans | Sub-collection via `getActionPlansByWorkPaper()` |
| Files list | `file_id`, `file_name`, `drive_url` | wp_files | Sub-collection via `getWorkPaperFiles()` |

### Workpaperview.html — Action Buttons

| Button | API Action | Backend Function | Fields Updated | Status Change |
|---|---|---|---|---|
| Back | Navigate | — | — | — |
| Edit | Navigate to form | — | — | — (opens editor) |
| Submit | `submitWorkPaper` | `submitWorkPaper()` | `status`, `submitted_date`, `updated_at` | Draft/Revision Required → Submitted |
| Approve | `reviewWorkPaper` (action=approve) | `reviewWorkPaper()` | `status`, `reviewed_by_id/name`, `review_date`, `review_comments`, `approved_by_id/name`, `approved_date`, `updated_at` | Submitted/Under Review → Approved |
| Return | `reviewWorkPaper` (action=return) | `reviewWorkPaper()` | `status`, `reviewed_by_id/name`, `review_date`, `review_comments`, `revision_count`, `updated_at` | Submitted/Under Review → Revision Required |
| Send to Auditee | `sendToAuditee` | `sendToAuditee()` | `status`, `final_status`, `sent_to_auditee_date`, `response_status`, `response_deadline`, `response_round`, `updated_at` | Approved → Sent to Auditee |
| Generate Insights | `getWorkPaperInsights` | `getWorkPaperInsights()` | — (read-only) | — |
| Add Action Plan | Opens modal | `createActionPlan()` | Creates new doc in action_plans | — |
| Upload File | Opens modal | — | Creates new doc in wp_files | — |
| Delete File | `deleteFile` | — | Removes doc from wp_files | — |

---

## 2. Workpaperslist.html — Table Columns

| Column Header | Firestore Field | Sortable | Filterable |
|---|---|---|---|
| (checkbox) | `work_paper_id` | No | No |
| ID | `work_paper_id` | Yes | No |
| Title | `observation_title` | Yes | Via search |
| (sub-text) | `audit_area_id` | No | Yes (dropdown) |
| Affiliate | `affiliate_code` | No | Yes (dropdown) |
| Risk | `risk_rating` | No | Yes (dropdown: Extreme/High/Medium/Low) |
| Status | `status` | No | Yes (dropdown: Draft/Submitted/Under Review/Revision Required/Approved/Sent to Auditee) |
| Prepared By | `prepared_by_name` | No | Yes (advanced, by `prepared_by_id`) |
| Date | `created_at` | Yes | Yes (advanced: date range via `date_from`/`date_to`) |
| Actions | — | No | No |

### Workpaperslist.html — Filters

| Filter | UI Element | Firestore Field / Backend Filter Key |
|---|---|---|
| Search | Text input | `search` → matches `observation_title`, `observation_description` |
| Year | Dropdown | `year` |
| Affiliate | Dropdown | `affiliate_code` |
| Audit Area | Dropdown | `audit_area_id` |
| Status | Dropdown | `status` |
| Risk Level | Dropdown | `risk_rating` |
| Date From | Date picker (advanced) | `date_from` (client-side) |
| Date To | Date picker (advanced) | `date_to` (client-side) |
| Prepared By | Dropdown (advanced) | `prepared_by_id` |
| Has Action Plans | Dropdown (advanced) | `has_action_plans` (client-side) |

### Quick Filter Presets

| Preset | Effect |
|---|---|
| All | Clears all filters |
| High Risk | Sets `risk_rating = "High"` |
| Pending Review | Sets `status = "Submitted"` |
| My Papers | Sets `prepared_by_id` = current user |
| Recent (7 days) | Sets `date_from` = 7 days ago |

### Row Actions (dropdown per row)

| Action | Condition |
|---|---|
| View | Always |
| Edit | Always (backend enforces status check) |
| Delete | Only when `status = "Draft"` |

---

## 3. Sendqueue.html — Send Queue

### What determines which WPs appear

WPs appear when **all** of the following are true:
1. `status = "Approved"` (queried via `getWorkPapersRaw({ status: STATUS.WORK_PAPER.APPROVED })`)
2. `responsible_ids` is non-empty (filtered in `getApprovedSendQueue()`)

Results are grouped by auditee (`responsible_ids` → resolved to user objects).

### Summary Cards

| Card | Source |
|---|---|
| Work Papers count | Total WPs across all groups |
| Auditees count | Number of distinct auditee groups |
| Selected count | Client-side selection tracking |

### Table Columns (per auditee group)

| Column Header | Firestore Field | Notes |
|---|---|---|
| (checkbox) | `work_paper_id` | Selection toggle |
| Observation | `observation_title`, `observation_description` | Title + truncated description |
| Affiliate | `affiliate_name` or `affiliate_code` | |
| Audit Area | `audit_area_name` or `audit_area_id` | |
| Risk | `risk_rating` | Badge styled via `getRiskClass()` |
| Approved | `approved_date` | Formatted date |

### Auditee Group Header

| Element | Firestore Field | Collection |
|---|---|---|
| Name | `full_name` / `user_id` | users (resolved from `responsible_ids`) |
| Email | `email` | users |
| Finding count | — | Count of WPs in group |

### Send Button

| Button | API Action | Backend Function | Fields Updated | Status Change |
|---|---|---|---|---|
| Send All to Auditees | `batchSendToAuditees` | `batchSendToAuditees()` | Per WP: `status`, `final_status`, `sent_to_auditee_date`, `response_status`, `response_deadline`, `response_round`, `updated_at` | Approved → Sent to Auditee |

Each auditee receives **one combined email** with all their findings. Auto-creates action plans for WPs that don't have one.

---

## 4. GAPS & Notes

| Gap | Details |
|---|---|
| `getSendQueue` not in service file | Routed via `08_WebApp.gs` → `getApprovedSendQueue()` (which is in `03_WorkPaperService.gs`) |
| `affiliate_name` / `audit_area_name` | Used in Sendqueue.html but not stored on work_papers — likely resolved client-side or via joined lookup |
| `observation_description` search | Backend `getWorkPapersRaw()` searches both `observation_title` and `observation_description` on the `search` filter |
| Advanced filters `date_from`/`date_to`, `has_action_plans` | Sent to backend in request but **not filtered** in `getWorkPapersRaw()` — likely client-side only |
| Auto-approve→send | `reviewWorkPaper(approve)` auto-calls `sendToAuditee()` if `responsible_ids` is set, bypassing the Send Queue |
| Submit validation | Backend requires: `observation_title`, `observation_description`, `risk_rating`, `recommendation` |
| Send-to-auditee validation | Backend requires: `responsible_ids`, `cc_recipients`, `observation_title`, `observation_description`, `risk_rating` |
