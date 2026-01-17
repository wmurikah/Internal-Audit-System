# HASS PETROLEUM INTERNAL AUDIT SYSTEM - Database Mapping Document

## Overview

This document provides a complete mapping of the Google Sheets database structure used by the Hass Petroleum Internal Audit Management System. The system uses Google Sheets as its backend database, with each tab (sheet) representing a different entity or configuration table.

**Spreadsheet ID:** `1pInjjLXgJu4d0zIb3-RzkI3SwcX7q23_4g1K44M-pO4`

---

## Table of Contents

1. [Configuration Tables](#1-configuration-tables)
2. [User Management Tables](#2-user-management-tables)
3. [Reference Data Tables](#3-reference-data-tables)
4. [Work Paper Tables](#4-work-paper-tables)
5. [Action Plan Tables](#5-action-plan-tables)
6. [System Tables](#6-system-tables)
7. [Index Tables](#7-index-tables)
8. [Entity Relationships](#8-entity-relationships)
9. [Frontend Module Mapping](#9-frontend-module-mapping)

---

## 1. Configuration Tables

### 00_Config
System configuration key-value pairs.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| config_key | String | Unique configuration key | PRIMARY KEY |
| config_value | String/Number | Configuration value | - |
| description | String | Description of the setting | - |
| updated_at | DateTime | Last modification timestamp | - |

**Key Configurations:**
- `SYSTEM_NAME` - Application display name
- `NEXT_WP_ID` - Next work paper ID counter
- `NEXT_AP_ID` - Next action plan ID counter
- `NEXT_USER_ID` - Next user ID counter
- `AUDIT_FILES_FOLDER_ID` - Google Drive folder for file uploads
- `PBKDF2_ITERATIONS` - Password hashing iterations
- `PASSWORD_MIN_LENGTH` - Minimum password length

**Used By:** All modules (read), Settings module (write)

---

### 01_Roles
User role definitions.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| role_code | String | Unique role identifier | PRIMARY KEY |
| role_name | String | Display name | NOT NULL |
| role_level | Number | Hierarchy level (higher = more access) | - |
| description | String | Role description | - |
| is_active | Boolean | Whether role is active | - |

**Role Codes:**
- `SUPER_ADMIN` - Full system access
- `HEAD_OF_AUDIT` - Department head privileges
- `SENIOR_AUDITOR` - Review and approval privileges
- `JUNIOR_STAFF` - Create and edit own work papers
- `AUDITEE` - Respond to findings and action plans
- `MANAGEMENT` - View reports only
- `OBSERVER` - Read-only access

**Used By:** User management, Permission checks, Dropdowns

---

### 02_Permissions
Role-based permissions matrix.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| role_code | String | Role identifier | FK → 01_Roles |
| module | String | Module name | - |
| can_create | Boolean | Create permission | - |
| can_read | Boolean | Read permission | - |
| can_update | Boolean | Update permission | - |
| can_delete | Boolean | Delete permission | - |
| can_approve | Boolean | Approval permission | - |
| can_export | Boolean | Export permission | - |
| field_restrictions | String | Comma-separated restricted fields | - |

**Modules:** `WORK_PAPER`, `ACTION_PLAN`, `USER`, `REPORT`, `CONFIG`

**Used By:** Permission checks in all CRUD operations

---

### 03_FieldDefinitions
Dynamic field configuration (for customizable forms).

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| field_id | String | Field identifier | PRIMARY KEY |
| module | String | Module name | - |
| field_name | String | Technical field name | - |
| display_name | String | UI display label | - |
| field_type | String | Input type | - |
| is_required | Boolean | Required validation | - |
| validation_rules | String | Custom validation JSON | - |
| display_order | Number | Form display order | - |

**Used By:** Dynamic form rendering (future feature)

---

### 04_StatusWorkflow
Status transition rules.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| workflow_id | String | Workflow identifier | PRIMARY KEY |
| module | String | Module name | - |
| from_status | String | Current status | - |
| to_status | String | Target status | - |
| required_role | String | Minimum role required | - |
| notification_template | String | Email template code | - |

**Used By:** Status transition validation, Workflow engine

---

## 2. User Management Tables

### 05_Users
User account information.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| user_id | String | Unique identifier (USR-XXXXXX) | PRIMARY KEY |
| email | String | Login email | UNIQUE, NOT NULL |
| password_hash | String | PBKDF2 password hash | NOT NULL |
| password_salt | String | Random salt for hashing | NOT NULL |
| full_name | String | Display name | NOT NULL |
| first_name | String | First name | - |
| last_name | String | Last name | - |
| role_code | String | User role | FK → 01_Roles |
| affiliate_code | String | Assigned affiliate(s) | FK → 06_Affiliates |
| department | String | Department name | - |
| phone | String | Contact phone | - |
| is_active | Boolean | Account active status | - |
| must_change_password | Boolean | Force password change | - |
| login_attempts | Number | Failed login counter | - |
| locked_until | DateTime | Account lockout expiry | - |
| last_login | DateTime | Last successful login | - |
| created_at | DateTime | Account creation date | - |
| created_by | String | Creator user ID | FK → 05_Users |
| updated_at | DateTime | Last update timestamp | - |
| updated_by | String | Last modifier user ID | FK → 05_Users |

**Security Features:**
- Password hashing with PBKDF2 (10,000 iterations)
- Account lockout after 5 failed attempts (30 min)
- Forced password change on first login

**Used By:** Authentication, User management, Dropdowns

---

### 20_Sessions
Active user sessions.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| session_id | String | Unique session ID | PRIMARY KEY |
| user_id | String | Session owner | FK → 05_Users |
| session_token | String | Authentication token | UNIQUE |
| created_at | DateTime | Session start | - |
| expires_at | DateTime | Session expiry | - |
| ip_address | String | Client IP (not captured) | - |
| user_agent | String | Browser info (not captured) | - |
| is_valid | Boolean | Session validity | - |

**Session Duration:** 24 hours
**Used By:** Authentication service

---

## 3. Reference Data Tables

### 06_Affiliates
Company affiliates/subsidiaries.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| affiliate_code | String | Short code (e.g., KE, UG) | PRIMARY KEY |
| affiliate_name | String | Full company name | NOT NULL |
| country | String | Country name | - |
| region | String | Geographic region | - |
| is_active | Boolean | Active status | - |
| display_order | Number | Dropdown sort order | - |

**Used By:** Work paper creation, Filtering, Reports

---

### 07_AuditAreas
High-level audit area categories.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| area_id | String | Unique area ID | PRIMARY KEY |
| area_code | String | Short code | - |
| area_name | String | Display name | NOT NULL |
| description | String | Area description | - |
| is_active | Boolean | Active status | - |
| display_order | Number | Dropdown sort order | - |

**Example Areas:** Finance, Operations, IT, HR, Procurement

**Used By:** Work paper creation, Filtering, Reports

---

### 08_ProcessSubAreas
Detailed sub-areas within audit areas.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| sub_area_id | String | Unique sub-area ID | PRIMARY KEY |
| area_id | String | Parent area | FK → 07_AuditAreas |
| sub_area_code | String | Short code | - |
| sub_area_name | String | Display name | NOT NULL |
| control_objectives | String | Standard control objectives | - |
| risk_description | String | Standard risk description | - |
| test_objective | String | Standard test objective | - |
| testing_steps | String | Standard testing procedures | - |
| is_active | Boolean | Active status | - |
| display_order | Number | Sort order | - |

**Feature:** Auto-populates work paper fields when selected

**Used By:** Work paper creation, Template data

---

## 4. Work Paper Tables

### 09_WorkPapers
Main audit finding records.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| work_paper_id | String | Unique ID (WP-XXXXXX) | PRIMARY KEY |
| year | Number | Audit year | - |
| affiliate_code | String | Audited affiliate | FK → 06_Affiliates |
| audit_area_id | String | Audit area | FK → 07_AuditAreas |
| sub_area_id | String | Sub-area | FK → 08_ProcessSubAreas |
| work_paper_date | Date | Work paper date | - |
| audit_period_from | Date | Period start | - |
| audit_period_to | Date | Period end | - |
| control_objectives | String | Control objectives tested | - |
| control_classification | String | Preventive/Detective/Corrective | - |
| control_type | String | Manual/Automated/Hybrid | - |
| control_frequency | String | Daily/Weekly/Monthly/etc. | - |
| control_standards | String | Referenced standards | - |
| risk_description | String | Risk description | - |
| test_objective | String | Testing objective | - |
| testing_steps | String | Test procedures performed | - |
| observation_title | String | Finding title | NOT NULL |
| observation_description | String | Finding details | NOT NULL |
| risk_rating | String | Extreme/High/Medium/Low | - |
| risk_summary | String | Risk impact summary | - |
| recommendation | String | Auditor recommendation | NOT NULL |
| management_response | String | Management's response | - |
| responsible_ids | String | Comma-separated auditee IDs | FK → 05_Users |
| cc_recipients | String | Additional notification emails | - |
| status | String | Current workflow status | - |
| final_status | String | Completed status | - |
| revision_count | Number | Number of revisions | - |
| prepared_by_id | String | Preparer user ID | FK → 05_Users |
| prepared_by_name | String | Preparer display name | - |
| prepared_date | DateTime | Creation date | - |
| submitted_date | DateTime | Submission date | - |
| reviewed_by_id | String | Reviewer user ID | FK → 05_Users |
| reviewed_by_name | String | Reviewer display name | - |
| review_date | DateTime | Review date | - |
| review_comments | String | Reviewer comments | - |
| approved_by_id | String | Approver user ID | FK → 05_Users |
| approved_by_name | String | Approver display name | - |
| approved_date | DateTime | Approval date | - |
| sent_to_auditee_date | DateTime | Date sent to auditee | - |
| created_at | DateTime | Record creation | - |
| updated_at | DateTime | Last modification | - |
| work_paper_ref | String | External reference number | - |

**Status Workflow:**
```
Draft → Submitted → Under Review → Approved → Sent to Auditee
                  ↓
            Revision Required ↩
```

**Used By:** Work paper list, Work paper form, Work paper view, Dashboard

---

### 10_WorkPaperRequirements
Information requests from auditors.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| requirement_id | String | Unique ID (REQ-XXXXXX) | PRIMARY KEY |
| work_paper_id | String | Parent work paper | FK → 09_WorkPapers |
| requirement_number | Number | Sequential number | - |
| requirement_description | String | Requested information | NOT NULL |
| date_requested | Date | Request date | - |
| status | String | Pending/Received/Waived | - |
| notes | String | Additional notes | - |
| created_at | DateTime | Creation timestamp | - |
| created_by | String | Requester user ID | FK → 05_Users |

**Used By:** Work paper form, Work paper view

---

### 11_WorkPaperFiles
File attachments for work papers.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| file_id | String | Unique ID (FILE-XXXXXX) | PRIMARY KEY |
| work_paper_id | String | Parent work paper | FK → 09_WorkPapers |
| file_category | String | File type category | - |
| file_name | String | Original filename | NOT NULL |
| file_description | String | File description | - |
| drive_file_id | String | Google Drive file ID | - |
| drive_url | String | Direct access URL | - |
| file_size | Number | File size in bytes | - |
| mime_type | String | MIME type | - |
| uploaded_by | String | Uploader user ID | FK → 05_Users |
| uploaded_at | DateTime | Upload timestamp | - |

**File Categories:** Supporting Document, Evidence, Screenshot, Report

**Used By:** Work paper form, Work paper view, File uploads

---

### 12_WorkPaperRevisions
Revision history tracking.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| revision_id | String | Unique ID (REV-XXXXXX) | PRIMARY KEY |
| work_paper_id | String | Parent work paper | FK → 09_WorkPapers |
| revision_number | Number | Sequential revision | - |
| action | String | Action taken | - |
| comments | String | Revision comments | - |
| changes_summary | String | Summary of changes | - |
| user_id | String | User who made change | FK → 05_Users |
| user_name | String | User display name | - |
| action_date | DateTime | Action timestamp | - |

**Used By:** Work paper view (timeline)

---

## 5. Action Plan Tables

### 13_ActionPlans
Remediation action plans.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| action_plan_id | String | Unique ID (AP-XXXXXX) | PRIMARY KEY |
| work_paper_id | String | Parent work paper | FK → 09_WorkPapers |
| action_number | Number | Sequential number | - |
| action_description | String | Action to be taken | NOT NULL |
| owner_ids | String | Comma-separated owner IDs | FK → 05_Users |
| owner_names | String | Owner display names | - |
| due_date | Date | Target completion date | - |
| status | String | Current status | - |
| final_status | String | Completed status | - |
| implementation_notes | String | Implementation details | - |
| implemented_date | DateTime | Completion date | - |
| auditor_review_status | String | Auditor verification status | - |
| auditor_review_by | String | Verifying auditor ID | FK → 05_Users |
| auditor_review_date | DateTime | Verification date | - |
| auditor_review_comments | String | Auditor comments | - |
| hoa_review_status | String | HOA final review status | - |
| hoa_review_by | String | HOA reviewer ID | FK → 05_Users |
| hoa_review_date | DateTime | HOA review date | - |
| hoa_review_comments | String | HOA comments | - |
| days_overdue | Number | Days past due date | - |
| created_at | DateTime | Creation timestamp | - |
| created_by | String | Creator user ID | FK → 05_Users |
| updated_at | DateTime | Last modification | - |
| updated_by | String | Modifier user ID | FK → 05_Users |

**Status Workflow:**
```
Not Due → Pending → In Progress → Implemented → Verified
                  ↓                     ↓
               Overdue              Returned/Not Implemented
```

**Status Definitions:**
- `Not Due` - Due date > 30 days away
- `Pending` - Due date approaching (< 30 days)
- `In Progress` - Work has started
- `Implemented` - Owner marked complete, awaiting verification
- `Verified` - Auditor confirmed implementation
- `Overdue` - Past due date, not implemented
- `Not Implemented` - Rejected or closed without implementation

**Used By:** Action plan list, Action plan view, Work paper view, Dashboard

---

### 14_ActionPlanEvidence
Evidence files for action plans.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| evidence_id | String | Unique ID (EVI-XXXXXX) | PRIMARY KEY |
| action_plan_id | String | Parent action plan | FK → 13_ActionPlans |
| file_name | String | Original filename | NOT NULL |
| file_description | String | Evidence description | - |
| drive_file_id | String | Google Drive file ID | - |
| drive_url | String | Direct access URL | - |
| file_size | Number | File size in bytes | - |
| mime_type | String | MIME type | - |
| uploaded_by | String | Uploader user ID | FK → 05_Users |
| uploaded_at | DateTime | Upload timestamp | - |

**Used By:** Action plan view, Evidence uploads

---

### 15_ActionPlanHistory
Status change history.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| history_id | String | Unique ID (HIST-XXXXXX) | PRIMARY KEY |
| action_plan_id | String | Parent action plan | FK → 13_ActionPlans |
| previous_status | String | Status before change | - |
| new_status | String | Status after change | - |
| comments | String | Change comments | - |
| user_id | String | User who made change | FK → 05_Users |
| user_name | String | User display name | - |
| changed_at | DateTime | Change timestamp | - |

**Used By:** Action plan view (history timeline)

---

## 6. System Tables

### 16_AuditLog
System activity audit trail.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| log_id | String | Unique ID (LOG-XXXXXX) | PRIMARY KEY |
| action | String | Action performed | - |
| entity_type | String | Entity type affected | - |
| entity_id | String | Entity ID affected | - |
| old_data | String | Previous data (JSON) | - |
| new_data | String | New data (JSON) | - |
| user_id | String | Acting user ID | FK → 05_Users |
| user_email | String | Acting user email | - |
| timestamp | DateTime | Action timestamp | - |
| ip_address | String | Client IP (not captured) | - |

**Actions Logged:**
- CREATE, UPDATE, DELETE (all entities)
- LOGIN, LOGOUT, ACCOUNT_LOCKED
- SUBMIT, REVIEW, APPROVE
- IMPLEMENT, VERIFY

**Used By:** Audit trail reports, Security monitoring

---

### 21_NotificationQueue
Email notification queue.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| notification_id | String | Unique ID (NOTIF-XXXXXX) | PRIMARY KEY |
| template_code | String | Email template | FK → 22_EmailTemplates |
| recipient_user_id | String | Recipient user ID | FK → 05_Users |
| recipient_email | String | Recipient email | NOT NULL |
| subject | String | Email subject | - |
| body | String | Email body | - |
| module | String | Related module | - |
| record_id | String | Related record ID | - |
| status | String | Pending/Sent/Failed | - |
| scheduled_for | DateTime | Scheduled send time | - |
| sent_at | DateTime | Actual send time | - |
| error_message | String | Error if failed | - |
| created_at | DateTime | Queue timestamp | - |

**Processing:** Every 10 minutes via time-based trigger

**Used By:** Notification system, Email service

---

### 22_EmailTemplates
Email template definitions.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| template_code | String | Template identifier | PRIMARY KEY |
| template_name | String | Display name | - |
| subject_template | String | Subject with placeholders | - |
| body_template | String | Body with placeholders | - |
| is_active | Boolean | Template active status | - |

**Templates:**
- `WP_SUBMITTED` - Work paper submitted for review
- `WP_STATUS_CHANGE` - Work paper status changed
- `WP_SENT_TO_AUDITEE` - Finding sent to auditee
- `AP_IMPLEMENTED` - Action plan marked implemented
- `AP_VERIFIED` - Action plan verified
- `PASSWORD_RESET` - Password reset notification
- `WELCOME_USER` - New user welcome

**Used By:** Notification service

---

### 23_StagingArea
Temporary data staging for bulk imports.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| staging_id | String | Staging record ID | PRIMARY KEY |
| entity_type | String | Entity being imported | - |
| data | String | JSON data payload | - |
| status | String | Processing status | - |
| error_message | String | Error if failed | - |
| created_at | DateTime | Import timestamp | - |
| processed_at | DateTime | Processing timestamp | - |

**Used By:** Bulk import feature (future)

---

## 7. Index Tables

### 17_Index_WorkPapers
Fast lookup index for work papers.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| work_paper_id | String | Work paper ID | PRIMARY KEY |
| row_number | Number | Row in 09_WorkPapers | - |
| status | String | Current status | - |
| year | Number | Audit year | - |
| affiliate_code | String | Affiliate code | - |
| audit_area_id | String | Audit area | - |
| risk_rating | String | Risk rating | - |
| prepared_by_id | String | Preparer ID | - |
| updated_at | DateTime | Index update time | - |

**Purpose:** O(1) lookup instead of O(n) sheet scan

---

### 18_Index_ActionPlans
Fast lookup index for action plans.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| action_plan_id | String | Action plan ID | PRIMARY KEY |
| row_number | Number | Row in 13_ActionPlans | - |
| work_paper_id | String | Parent work paper | - |
| status | String | Current status | - |
| due_date | Date | Due date | - |
| owner_ids | String | Owner IDs | - |
| days_overdue | Number | Days overdue | - |
| updated_at | DateTime | Index update time | - |

---

### 19_Index_Users
Fast lookup index for users.

| Column | Data Type | Description | Constraints |
|--------|-----------|-------------|-------------|
| user_id | String | User ID | PRIMARY KEY |
| row_number | Number | Row in 05_Users | - |
| email | String | User email | - |
| role_code | String | User role | - |
| is_active | Boolean | Active status | - |
| updated_at | DateTime | Index update time | - |

---

## 8. Entity Relationships

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ENTITY RELATIONSHIP DIAGRAM                      │
└─────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────┐
                              │  01_Roles   │
                              │─────────────│
                              │ role_code   │◄──────────────────┐
                              │ role_name   │                   │
                              │ role_level  │                   │
                              └─────────────┘                   │
                                    │                           │
                                    ▼                           │
                              ┌─────────────┐                   │
                              │02_Permissions                   │
                              │─────────────│                   │
                              │ role_code   │                   │
                              │ module      │                   │
                              │ can_create  │                   │
                              └─────────────┘                   │
                                                                │
┌─────────────┐         ┌─────────────┐         ┌─────────────┐│
│06_Affiliates│         │  05_Users   │◄────────│ role_code   ││
│─────────────│         │─────────────│         └─────────────┘│
│affiliate_code│◄───────│ user_id     │                        │
│affiliate_name│        │ email       │                        │
└─────────────┘         │ role_code   │────────────────────────┘
      │                 │ affiliate   │
      │                 └──────┬──────┘
      │                        │
      │                        │ prepared_by_id
      ▼                        │ responsible_ids
┌─────────────┐         ┌──────┴──────┐         ┌─────────────┐
│07_AuditAreas│         │09_WorkPapers│         │10_WP_Require│
│─────────────│◄────────│─────────────│────────►│─────────────│
│ area_id     │         │work_paper_id│         │requirement_id│
│ area_name   │         │ year        │         │work_paper_id │
└──────┬──────┘         │ status      │         └─────────────┘
       │                │ risk_rating │
       ▼                └──────┬──────┘         ┌─────────────┐
┌─────────────┐                │               │11_WP_Files  │
│08_SubAreas  │                │               │─────────────│
│─────────────│◄───────────────┤               │ file_id     │
│ sub_area_id │                │               │work_paper_id │◄─┐
│ area_id     │                │               └─────────────┘  │
└─────────────┘                │                                │
                               │               ┌─────────────┐  │
                               │               │12_WP_Revisions │
                               │               │─────────────│  │
                               │               │ revision_id │  │
                               │               │work_paper_id │◄─┤
                               │               └─────────────┘  │
                               │                                │
                               ▼                                │
                        ┌─────────────┐                         │
                        │13_ActionPlans                         │
                        │─────────────│                         │
                        │action_plan_id                         │
                        │work_paper_id │◄───────────────────────┘
                        │ owner_ids    │
                        │ due_date     │
                        │ status       │
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
       ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
       │14_AP_Evidence│ │15_AP_History│ │ 18_Index_AP │
       │─────────────│  │─────────────│  │─────────────│
       │ evidence_id │  │ history_id  │  │action_plan_id│
       │action_plan_id│ │action_plan_id│ │ row_number  │
       └─────────────┘  └─────────────┘  └─────────────┘
```

---

## 9. Frontend Module Mapping

### Dashboard (Dashboard.html)
**Reads From:**
- 09_WorkPapers (counts, status distribution)
- 13_ActionPlans (counts, overdue, due soon)

**API Calls:**
- `getDashboardData` - Main dashboard data
- `getInitData` - User info, dropdowns, permissions

---

### Work Papers List (Workpaperslist.html)
**Reads From:**
- 09_WorkPapers (filtered list)
- 17_Index_WorkPapers (fast filtering)

**Writes To:** None (read-only list)

**API Calls:**
- `getWorkPapers` - Filtered work paper list
- `deleteWorkPaper` - Delete draft work papers

---

### Work Paper Form (Workpaperform.html)
**Reads From:**
- 09_WorkPapers (edit mode)
- 06_Affiliates (dropdown)
- 07_AuditAreas (dropdown)
- 08_ProcessSubAreas (dropdown, auto-fill)
- 05_Users (responsible parties selection)

**Writes To:**
- 09_WorkPapers (create/update)
- 10_WorkPaperRequirements (add requirements)
- 11_WorkPaperFiles (file uploads)
- 13_ActionPlans (action plan entries)
- 17_Index_WorkPapers (index update)

**API Calls:**
- `getWorkPaper` - Load existing work paper
- `createWorkPaper` - Create new
- `updateWorkPaper` - Update existing
- `createActionPlansBatch` - Save action plans

---

### Work Paper View (Workpaperview.html)
**Reads From:**
- 09_WorkPapers (work paper details)
- 10_WorkPaperRequirements (requirements list)
- 11_WorkPaperFiles (attached files)
- 12_WorkPaperRevisions (history timeline)
- 13_ActionPlans (linked action plans)

**Writes To:**
- 09_WorkPapers (status changes)
- 12_WorkPaperRevisions (history entries)
- 21_NotificationQueue (notifications)

**API Calls:**
- `getWorkPaper` - Load with related data
- `submitWorkPaper` - Submit for review
- `reviewWorkPaper` - Approve/return
- `sendToAuditee` - Send to auditee

---

### Action Plans List (Actionplanslist.html)
**Reads From:**
- 13_ActionPlans (filtered list)
- 18_Index_ActionPlans (fast filtering)

**API Calls:**
- `getActionPlans` - Filtered action plan list

---

### Action Plan View (Actionplanview.html)
**Reads From:**
- 13_ActionPlans (plan details)
- 14_ActionPlanEvidence (evidence files)
- 15_ActionPlanHistory (status history)
- 09_WorkPapers (parent work paper info)

**Writes To:**
- 13_ActionPlans (status, notes)
- 14_ActionPlanEvidence (evidence uploads)
- 15_ActionPlanHistory (history entries)
- 18_Index_ActionPlans (index update)
- 21_NotificationQueue (notifications)

**API Calls:**
- `getActionPlan` - Load with related data
- `updateActionPlan` - Save notes
- `markAsImplemented` - Mark complete
- `verifyImplementation` - Auditor verification
- `addActionPlanEvidence` - Upload evidence

---

## Cache Strategy

### Server-Side Cache (CacheService)
| Cache Key Pattern | TTL | Purpose |
|-------------------|-----|---------|
| `config_all` | 1 hour | System configuration |
| `dropdown_data_all` | 30 min | All dropdowns combined |
| `affiliates_dropdown` | 30 min | Affiliates list |
| `audit_areas_dropdown` | 30 min | Audit areas list |
| `sub_areas_dropdown` | 30 min | Sub-areas list |
| `users_dropdown` | 30 min | Users list |
| `roles_dropdown` | 30 min | Roles list |
| `user_email_{email}` | 5 min | User by email lookup |
| `perm_{role}` | 10 min | Role permissions |
| `session_{token}` | 5 min | Session validation |
| `index_wp_map` | 10 min | Work paper index |
| `index_ap_map` | 10 min | Action plan index |
| `headers_{sheet}` | 1 hour | Sheet column headers |

### Cache Invalidation Triggers
- User creation/update → `users_dropdown`, `dropdown_data_all`
- Role/permission change → `perm_*`, `roles_dropdown`
- Entity CRUD → Corresponding index cache
- Configuration change → `config_all`

---

## Performance Optimization Notes

1. **Index Tables (17, 18, 19)** - Provide O(1) lookup by ID instead of O(n) sheet scan
2. **Batch Operations** - `createActionPlansBatch`, `batchInsert`, `batchUpdate`
3. **Cached Dropdowns** - Loaded once per session, cached 30 minutes
4. **Lazy Loading** - Related data loaded only when `includeRelated=true`
5. **Parallel Reads** - Dashboard loads summary counts in parallel

---

*Document Version: 3.0*
*Last Updated: January 2026*
*Generated by: Internal Audit System Optimization*
