# Workpaperform.html → Firestore Field Mapping

## Form Input Fields

| UI Label | HTML ID | JS Save Key | Firestore Field | In Schema? | Type | Required? | Dropdown Source | Notes |
|---|---|---|---|---|---|---|---|---|
| *(hidden)* | `wpFormId` | `work_paper_id` | `work_paper_id` | YES | string | auto | — | Set on create via `generateId('WORK_PAPER')` |
| Year * | `wpYear` | `year` | `year` | YES | string | HTML+submit | Year range (currentYear-3 to +1) | Defaults to current year |
| Affiliate * | `wpAffiliate` | `affiliate_code` | `affiliate_code` | YES | string | HTML+submit | `appDropdowns.affiliates` (code/display) | Stores code only, NOT name |
| Audit Area * | `wpAuditArea` | `audit_area_id` | `audit_area_id` | YES | string | HTML+submit | `appDropdowns.auditAreas` (id/display) | Triggers `loadSubAreas()` on change |
| Sub Area | `wpSubArea` | `sub_area_id` | `sub_area_id` | YES | string | no | `appDropdowns.subAreas` filtered by area_id | Triggers `autoFillFromSubArea()` |
| Work Paper Date | `wpDate` | `work_paper_date` | `work_paper_date` | YES | date | no | — | Defaults to today |
| Audit Period From | `wpPeriodFrom` | `audit_period_from` | `audit_period_from` | YES | date | no | — | |
| Audit Period To | `wpPeriodTo` | `audit_period_to` | `audit_period_to` | YES | date | no | — | |
| Control Objectives | `wpControlObjectives` | `control_objectives` | `control_objectives` | YES | text | no | — | Auto-filled from sub_area |
| Risk Description | `wpRiskDesc` | `risk_description` | `risk_description` | YES | text | no | — | Auto-filled from sub_area |
| Test Objective | `wpTestObj` | `test_objective` | `test_objective` | YES | text | no | — | Auto-filled from sub_area |
| Testing Steps | `wpTestSteps` | `testing_steps` | `testing_steps` | YES | text | no | — | Auto-filled from sub_area |
| Observation Title * | `wpObsTitle` | `observation_title` | `observation_title` | YES | string | HTML+submit | — | maxlength not set in HTML |
| Observation Description * | `wpObsDesc` | `observation_description` | `observation_description` | YES | text | HTML+submit | — | maxlength=2000, char counter |
| Risk Rating * | `wpRiskRating` | `risk_rating` | `risk_rating` | YES | string | HTML+submit | Hardcoded: Extreme, High, Medium, Low | DB also has legacy `[High,Medium,Low]` values |
| Risk Summary | `wpRiskSummary` | `risk_summary` | `risk_summary` | YES | string | no | — | |
| Recommendation * | `wpRecommendation` | `recommendation` | `recommendation` | YES | text | HTML+submit | — | maxlength=2000, char counter |
| Work Paper Reference | `wpWorkPaperRef` | *(not in getFormData)* | `work_paper_ref` | YES | string | no | — | **READ-ONLY**. Set server-side = work_paper_id |
| Management Response | `wpManagementResponse` | `management_response` | `management_response` | YES | text | no | — | maxlength=2000. Role-gated visibility |
| Responsible (Auditees) | `wpResponsibleIds` | `responsible_ids` | `responsible_ids` | YES | csv-ids | send-to-auditee | `appDropdowns.users` autocomplete | Comma-separated user_ids |
| CC Recipients (Emails) | `wpCCRecipients` | `cc_recipients` | `cc_recipients` | YES | newline-emails | send-to-auditee | `appDropdowns.users` autocomplete | Newline-separated emails |
| File Category | `wpFileCategory` | *(separate API)* | `wp_files.file_category` | YES (WP_FILES) | string | no | Hardcoded: Evidence, Supporting, Correspondence, Other | Saved via `addWorkPaperFile` |
| Upload Evidence | `wpEvidenceFile` | *(separate API)* | `wp_files.*` | YES (WP_FILES) | file | no | — | Via `uploadFileToDrive` → `addWorkPaperFile` |

### Action Plan Entries (within form, saved separately)

| UI Label | HTML Class | JS Save Key | Firestore Field | Collection | Required? |
|---|---|---|---|---|---|
| Action Plan Description * | `.ap-description` | `action_description` | `action_plans.action_description` | ACTION_PLANS | yes (if entry exists) |
| Owner * | `.ap-owner-ids` / `.ap-owner-names` | `owner_ids` / `owner_names` | `action_plans.owner_ids` / `owner_names` | ACTION_PLANS | yes (if entry exists) |
| Due Date * | `.ap-due-date` | `due_date` | `action_plans.due_date` | ACTION_PLANS | yes (if entry exists) |
| Evidence Document | `.ap-evidence-file` | *(separate API)* | `ap_evidence.*` | AP_EVIDENCE | no |

## Save Mechanism

- **Backend functions**: `createWorkPaper(data, user)` / `updateWorkPaper(workPaperId, data, user)`
- **Write method**: `syncToFirestore()` — **direct Firestore document write**, NOT `objectToRow()`
- **Implication**: All fields in the object are persisted. No schema-based column dropping.
- **Editable fields whitelist** (updateWorkPaper): `year`, `affiliate_code`, `audit_area_id`, `sub_area_id`, `work_paper_date`, `audit_period_from`, `audit_period_to`, `control_objectives`, `control_classification`, `control_type`, `control_frequency`, `control_standards`, `risk_description`, `test_objective`, `testing_steps`, `observation_title`, `observation_description`, `risk_rating`, `risk_summary`, `recommendation`, `management_response`, `responsible_ids`, `cc_recipients`

## Validation Rules

| Stage | Fields Validated | Where |
|---|---|---|
| HTML form submit | year, affiliate_code, audit_area_id, observation_title, observation_description, risk_rating, recommendation | HTML `required` attribute |
| Submit for review | observation_title, observation_description, risk_rating, affiliate_code, audit_area_id | `validateWorkPaperFields()` in Scripts.html:139 |
| Send to auditee | Above + responsible_ids, cc_recipients | `validateWorkPaperFields()` + `sendToAuditee()` in 03_WorkPaperService.gs:564 |

## GAPS

| # | Severity | Gap | Impact | Fix |
|---|---|---|---|---|
| GAP-101 | **HIGH** | `control_classification` is in SCHEMAS.WORK_PAPERS and accepted by `updateWorkPaper()` editableFields, but **no form input exists** | Field always empty string on create. 80% fill rate in DB suggests it was populated by an older form or import. | Add `<select>` with options: Preventive, Detective, Corrective, Directive |
| GAP-102 | **HIGH** | `control_type` — same as above, no form input | Always empty on new WPs. 73% fill in DB. | Add `<select>` with options: Manual, Automated, IT-Dependent Manual, Hybrid |
| GAP-103 | **HIGH** | `control_frequency` — same as above, no form input | Always empty on new WPs. 73% fill in DB. | Add `<select>` with options: Ad-hoc, Daily, Weekly, Monthly, Quarterly, Semi-Annual, Annual |
| GAP-104 | **MEDIUM** | `control_standards` — in schema and editableFields, no form input | Always empty. 67% fill in DB. | Add textarea input |
| GAP-105 | **LOW** | `assigned_auditor_name` exists in Firestore (NOT in SCHEMAS.WORK_PAPERS) but is never set by `createWorkPaper()` or `updateWorkPaper()` | Orphan field — no code writes it. Likely legacy. | Investigate origin; if unused, ignore |
| GAP-106 | **LOW** | `affiliate_name` exists in Firestore (NOT in SCHEMAS.WORK_PAPERS) but is never written on save | Only computed at runtime in `getApprovedSendQueue()` and notification helpers. Not persisted by form save. | Expected behavior — runtime-resolved, not a true gap |
| GAP-107 | **INFO** | `wpWorkPaperRef` is rendered as readonly in form but **not included in `getFormData()`** | No impact — set server-side as `work_paper_ref: workPaperId` in `createWorkPaper()`. Cannot be overwritten by client. | Correct by design |
| GAP-108 | **INFO** | Risk Rating dropdown offers `Extreme` but DB field metadata shows values `[High,Medium,Low]` | Extreme is a valid new option. Some existing WPs may lack it. No breakage. | Ensure reports/filters handle all 4 values |
| GAP-109 | **MEDIUM** | `cc_recipients` stored as newline-separated in hidden input (`selectedItems.map(s => s.email).join('\n')`) but `batchSendToAuditees` splits on comma (`.split(',')`) | Batch send may fail to parse multi-recipient CC fields correctly | Normalize to consistent delimiter (comma) in both save and read |
