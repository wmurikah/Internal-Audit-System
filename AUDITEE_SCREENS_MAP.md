# Auditee Screens Field Mapping

## 1. AuditeeFindings.html (My Audit Observations)

### Query Logic (`getAuditeeFindings` in 10_AuditeeService.gs)

- Fetches **all** work_papers where `status == "Sent to Auditee"`
- Filters by: `parseIdList(wp.responsible_ids).includes(user.user_id)` **OR** user owns a delegated action plan (`parseIdList(ap.owner_ids).includes(user.user_id)`)
- **Delegatees DO see items** -- the service builds a `delegatedWPIds` set from all action_plans

### Summary Cards (counts from `work_papers`)

| Card | Filters on `response_status` |
|------|------------------------------|
| Total Observations | _(all)_ |
| Pending Response | `Pending Response` |
| Draft | `Draft Response` |
| Submitted | `Response Submitted` |
| Accepted | `Response Accepted` |
| Rejected | `Response Rejected` |

### Table Columns

| # | Column | Source Collection | Field |
|---|--------|-------------------|-------|
| 1 | # | -- | row index |
| 2 | Observation (title + ref) | work_papers | `observation_title`, `work_paper_ref` / `work_paper_id` |
| 3 | Risk | work_papers | `risk_rating` |
| 4 | Response Status | work_papers | `response_status` |
| 5 | Deadline | work_papers | `response_deadline` (+ computed `deadline_passed`) |
| 6 | Round | work_papers | `response_round` (displayed as `N / 3`) |
| 7 | Actions | action_plans | `action_plan_count` (count of action_plans for this WP) |
| 8 | Action (button) | -- | Respond / View based on `response_status` |

### Client-Side Filters

| Filter | Field Checked |
|--------|---------------|
| Search box | `observation_title`, `observation_description` (lowercase includes) |
| Status dropdown | `response_status` |
| Risk dropdown | `risk_rating` |

### Action Buttons

| Button | Visibility | API Call |
|--------|-----------|----------|
| Respond | `Pending Response`, `Draft Response`, `Response Rejected` | navigates to `auditee-response` |
| View | `Escalated`, `Response Submitted`, `Response Accepted` | navigates to `auditee-response` |
| Submit All Responses | shown when `Draft Response` count > 0 | `batchSubmitAuditeeResponses({ workPaperIds })` |

---

## 2. AuditeeResponse.html (View Observation & Submit Response)

### Query Logic (`getAuditeeResponseData` in 10_AuditeeService.gs)

- Loads single work paper by `workPaperId`
- Access granted if: `responsible_ids` includes user **OR** user owns a delegated action plan **OR** `SUPER_ADMIN` **OR** auditor role
- Returns: `finding` (from work_papers), `responses` (auditee_responses history), `actionPlans`, `files`, `canEditResponse`, `maxRounds`, `isAuditor`, `isSuperAdmin`

### Displayed Values (Read-Only, from `work_papers`)

| UI Element | DOM ID | Firestore Field | Collection |
|------------|--------|-----------------|------------|
| Observation Title | `arFindingTitle` | `observation_title` | work_papers |
| Reference # | `arWorkPaperRef` | `work_paper_ref` / `work_paper_id` | work_papers |
| Issued Date | `arIssuedDate` | `sent_to_auditee_date` | work_papers |
| Risk Badge | `arRiskBadge` | `risk_rating` | work_papers |
| Response Status Badge | `arResponseStatusBadge` | `response_status` | work_papers |
| Deadline Banner | `arDeadlineText` | `response_deadline` | work_papers |
| Round Badge | `arRoundBadge` | `response_round` (+ `maxRounds` = 3) | work_papers |
| Observation Description | `arObservation` | `observation_description` | work_papers |
| Risk Summary | `arRiskSummary` | `risk_summary` | work_papers |
| Recommendation | `arRecommendation` | `recommendation` | work_papers |
| Evidence Files | `arFilesList` | `file_name`, `drive_url`, `mime_type`, `file_category` | work_paper files |

### Input Fields

| UI Element | DOM ID | Firestore Field | Collection | Notes |
|------------|--------|-----------------|------------|-------|
| Management Response | `arManagementResponse` | `management_response` | work_papers (draft) / auditee_responses (on submit) | textarea, 10-2000 chars |
| Reject Comments | `rejectResponseComments` | `review_comments` | auditee_responses | auditor-only |

### Action Plan Modal Fields (creates `action_plans` doc)

| UI Element | DOM ID | Firestore Field | Collection |
|------------|--------|-----------------|------------|
| Action Description | `newAPDescription` | `action_description` | action_plans |
| Responsible Person | `newAPOwner` | `owner_ids` / `owner_names` | action_plans |
| Due Date | `newAPDueDate` | `due_date` | action_plans |

Auto-set on creation: `action_plan_id`, `work_paper_id`, `action_number`, `status`, `auditee_proposed=true`, `created_by`, `created_at`, `updated_at`, `created_by_role`.

### Action Plans List (displayed per plan, from `action_plans`)

| Display | Field |
|---------|-------|
| Description | `action_description` |
| Owner | `owner_names` |
| Due Date | `due_date` |
| Status Badge | `status` |
| Proposed Badge | `auditee_proposed` |

### Response History (from `auditee_responses`)

| Display | Field |
|---------|-------|
| Round | `round_number` |
| Status Badge | `status` |
| Submitted By | `submitted_by_name` |
| Submitted Date | `submitted_date` |
| Response Text | `management_response` |
| Reviewer Comments | `review_comments` |

### Auditor Feedback (shown when rejected, from `work_papers`)

| Display | Field |
|---------|-------|
| Reviewer Comments | `response_review_comments` |

### Action Buttons

| Button | Visibility | API Call | Key Params |
|--------|-----------|----------|------------|
| Save Draft | `canEdit` + status in [Pending, Draft, Rejected] | `saveDraftResponse` | `workPaperId`, `management_response` |
| Submit Response | same as above | `submitAuditeeResponse` | `workPaperId`, `management_response`, `action_plan_ids[]` |
| Accept Response | auditor/admin + status = `Response Submitted` | `reviewAuditeeResponse` | `workPaperId`, `action: 'accept'` |
| Reject Response | auditor/admin + status = `Response Submitted` | `reviewAuditeeResponse` | `workPaperId`, `action: 'reject'`, `comments` |
| Add Action Plan | `canEdit` or `SUPER_ADMIN` | `createAuditeeActionPlan` | `work_paper_id`, `action_description`, `owner_ids`, `due_date` |

---

## 3. GAPS & Notes

| Gap | Detail |
|-----|--------|
| `response_type` never set | `auditee_responses.response_type` is always `''` on creation -- unused field |
| `risk_summary` vs `risk_rating` | Both exist in work_papers; `risk_summary` is free-text shown on response page, `risk_rating` is the enum (Extreme/High/Medium/Low) |
| `owner_ids` is a STRING | Must use `parseIdList()` for membership checks -- comma-separated like `'USR-000001,USR-000002'` |
| `management_response` dual write | Saved to `work_papers.management_response` (draft/latest) AND to `auditee_responses.management_response` (on formal submit) |
| Delegatee edit limitation | Delegatees can **view** the observation but `canEditResponse` only checks `responsible_ids` -- delegatees cannot submit responses |
| `response_review_comments` on work_papers | Stored on WP directly (for rejected display) AND on the auditee_responses record |
| `cc_recipients` returned but unused | Returned in finding data but not rendered in either HTML |
| `affiliate_code`, `audit_area_id`, `year` | Returned by service but not displayed on either screen |
