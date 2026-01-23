# Hass Petroleum Internal Audit System
## Comprehensive System Architecture & UX Design Document

**Version:** 4.0
**Date:** January 2026
**Status:** Architecture Specification

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [High-Level System Architecture](#2-high-level-system-architecture)
3. [Database Schema & Relationships](#3-database-schema--relationships)
4. [Authentication & Access Control](#4-authentication--access-control)
5. [Module Organization & Data Flow](#5-module-organization--data-flow)
6. [Work Paper Reference & Document Management](#6-work-paper-reference--document-management)
7. [UX Restructuring & Rationale](#7-ux-restructuring--rationale)
8. [Functional Preservation Matrix](#8-functional-preservation-matrix)
9. [Implementation Guidelines](#9-implementation-guidelines)

---

## 1. Executive Summary

### 1.1 Design Principles

This architecture design adheres to the following core constraints:

| Constraint | Implementation Approach |
|------------|------------------------|
| **Database as Single Source of Truth** | All system behavior derives from the 23-sheet relational database schema |
| **No Feature Removal** | Every existing module, workflow, and field is preserved |
| **Non-Google Authentication** | Session-token based auth with secure link access |
| **Multi-Document Upload** | First-class document management for work paper references |
| **Reorganization Only** | Improvements through layout, flow, and structure—not elimination |

### 1.2 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    HASS PETROLEUM INTERNAL AUDIT SYSTEM                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  Platform: Google Apps Script Web Application                                │
│  Database: Google Sheets (23 relational tables)                             │
│  Storage:  Google Drive (document attachments)                              │
│  Auth:     Session-token based (no Google account required for users)       │
│  Affiliates: 10 (Kenya, Uganda, Tanzania, South Sudan, Rwanda,              │
│              Zambia, Malawi, DRC, Somalia, Group)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. High-Level System Architecture

### 2.1 Logical Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRESENTATION LAYER                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐│
│  │ Login.html  │ │AuditorPortal│ │ Dashboard   │ │ Module Views            ││
│  │             │ │   .html     │ │   .html     │ │ (Lists, Forms, Details) ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Shared: Styles.html | Scripts.html | Modals.html                        ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ HTTP POST/GET (JSON API)
┌────────────────────────────────▼────────────────────────────────────────────┐
│                            API LAYER (08_WebApp.gs)                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ doGet()  → Serves HTML pages (Login/Portal routing)                      ││
│  │ doPost() → JSON API endpoint (50+ actions)                               ││
│  │ apiCall()→ Internal routing with session validation                      ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ Function Calls
┌────────────────────────────────▼────────────────────────────────────────────┐
│                           SERVICE LAYER                                      │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │ 07_AuthService  │ │03_WorkPaperSvc  │ │04_ActionPlanSvc │                │
│  │ Authentication  │ │ Work Paper CRUD │ │ Action Plan CRUD│                │
│  │ Session Mgmt    │ │ Workflow Engine │ │ Review Workflow │                │
│  │ User Management │ │ File Management │ │ Evidence Mgmt   │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐                │
│  │06_DashboardSvc  │ │05_NotificationSvc│ │09_AnalyticsSvc │                │
│  │ Stats & Charts  │ │ Email Queue     │ │ Reports & Data  │                │
│  │ Role-Based Views│ │ Templates       │ │ Trend Analysis  │                │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘                │
│  ┌─────────────────┐                                                         │
│  │ 05_AIService    │ AI Integration (OpenAI, Anthropic, Google AI)          │
│  └─────────────────┘                                                         │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ Database Operations
┌────────────────────────────────▼────────────────────────────────────────────┐
│                       DATA ACCESS LAYER (01_Core.gs)                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │    Cache     │ │    Index     │ │     DB       │ │  DBWrite     │        │
│  │ In-memory    │ │ Fast Lookup  │ │ Read Ops     │ │ Write Ops    │        │
│  │ TTL-based    │ │ Row Mapping  │ │ Filtering    │ │ ACID Support │        │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘        │
│  ┌──────────────┐ ┌──────────────┐                                          │
│  │ Transaction  │ │   Security   │ Password Hashing, Audit Logging          │
│  └──────────────┘ └──────────────┘                                          │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ Sheets API
┌────────────────────────────────▼────────────────────────────────────────────┐
│                    PERSISTENCE LAYER (Google Sheets)                         │
│  23 Sheets: Config, Roles, Permissions, Users, Affiliates, AuditAreas,      │
│             SubAreas, WorkPapers, Requirements, Files, Revisions,           │
│             ActionPlans, Evidence, History, AuditLog, Indexes, Sessions,    │
│             NotificationQueue, EmailTemplates, StagingArea                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Functional Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FUNCTIONAL DOMAIN MODEL                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                     AUDIT MANAGEMENT DOMAIN                              ││
│  │  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           ││
│  │  │  Work Papers  │───▶│ Action Plans  │───▶│   Closure     │           ││
│  │  │  (Findings)   │    │ (Responses)   │    │ (Verification)│           ││
│  │  └───────────────┘    └───────────────┘    └───────────────┘           ││
│  │         │                    │                    │                     ││
│  │         ▼                    ▼                    ▼                     ││
│  │  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           ││
│  │  │ Requirements  │    │   Evidence    │    │    History    │           ││
│  │  │ Files/Docs    │    │   Documents   │    │   Audit Log   │           ││
│  │  │ Revisions     │    │               │    │               │           ││
│  │  └───────────────┘    └───────────────┘    └───────────────┘           ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                    IDENTITY & ACCESS DOMAIN                              ││
│  │  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           ││
│  │  │    Users      │───▶│    Roles      │───▶│  Permissions  │           ││
│  │  │  (Accounts)   │    │ (7 Types)     │    │ (CRUD+Approve)│           ││
│  │  └───────────────┘    └───────────────┘    └───────────────┘           ││
│  │         │                                                               ││
│  │         ▼                                                               ││
│  │  ┌───────────────┐    ┌───────────────┐                                ││
│  │  │   Sessions    │    │  Affiliates   │                                ││
│  │  │ (Token-based) │    │ (10 Entities) │                                ││
│  │  └───────────────┘    └───────────────┘                                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                   REFERENCE DATA DOMAIN                                  ││
│  │  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐           ││
│  │  │  Audit Areas  │───▶│   Sub-Areas   │    │    Config     │           ││
│  │  │               │    │ (Ctrl Obj)    │    │  (Settings)   │           ││
│  │  └───────────────┘    └───────────────┘    └───────────────┘           ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                   COMMUNICATION DOMAIN                                   ││
│  │  ┌───────────────┐    ┌───────────────┐                                ││
│  │  │ Notification  │───▶│    Email      │                                ││
│  │  │    Queue      │    │  Templates    │                                ││
│  │  └───────────────┘    └───────────────┘                                ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Schema & Relationships

### 3.1 Entity-Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DATABASE ENTITY RELATIONSHIPS                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  01_Roles    │◄──────│  05_Users    │──────▶│06_Affiliates │
│  role_code PK│       │  user_id PK  │       │affiliate_code│
│  role_name   │       │  email       │       │    PK        │
│  role_level  │       │  role_code FK│       │affiliate_name│
└──────────────┘       │affiliate_code│       └──────────────┘
       │               │    FK        │
       ▼               └──────┬───────┘
┌──────────────┐              │
│02_Permissions│              │
│  role_code FK│              │
│  module      │              ▼
│  can_create  │       ┌──────────────┐       ┌──────────────┐
│  can_read    │       │ 20_Sessions  │       │07_AuditAreas │
│  can_update  │       │ session_id PK│       │  area_id PK  │
│  can_delete  │       │ user_id FK   │       │  area_code   │
│  can_approve │       │session_token │       │  area_name   │
└──────────────┘       │ expires_at   │       └──────┬───────┘
                       └──────────────┘              │
                                                     ▼
                                              ┌──────────────┐
                                              │08_SubAreas   │
                                              │ sub_area_id  │
                                              │    PK        │
                                              │ area_id FK   │
                                              │control_obj   │
                                              │risk_desc     │
                                              └──────┬───────┘
                                                     │
       ┌─────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                        09_WorkPapers                          │
│  work_paper_id PK                                             │
│  ├── year, affiliate_code FK, audit_area_id FK, sub_area_id FK│
│  ├── control_objectives, control_classification, control_type │
│  ├── risk_description, risk_rating, risk_summary              │
│  ├── observation_title, observation_description, recommendation│
│  ├── management_response, responsible_ids, cc_recipients      │
│  ├── status, final_status, revision_count                     │
│  ├── prepared_by_id FK, reviewed_by_id FK, approved_by_id FK  │
│  └── work_paper_ref (DOCUMENT REFERENCE FIELD)                │
└──────────────────────────────┬───────────────────────────────┘
                               │
       ┌───────────────────────┼───────────────────────┐
       │                       │                       │
       ▼                       ▼                       ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│10_WP_Require │       │ 11_WP_Files  │       │12_WP_Revisions│
│ments         │       │  file_id PK  │       │ revision_id  │
│requirement_id│       │work_paper_id │       │    PK        │
│    PK        │       │    FK        │       │work_paper_id │
│work_paper_id │       │ file_category│       │    FK        │
│    FK        │       │drive_file_id │       │revision_num  │
│req_number    │       │ drive_url    │       │ action       │
│ status       │       │ file_size    │       │ comments     │
└──────────────┘       │ mime_type    │       └──────────────┘
                       │ uploaded_by  │
                       │    FK        │
                       └──────────────┘
                               │
                               │ (1:N relationship - MULTIPLE DOCUMENTS PER WP)
                               │
┌──────────────────────────────┴───────────────────────────────┐
│                       13_ActionPlans                          │
│  action_plan_id PK                                            │
│  ├── work_paper_id FK (links to parent work paper)            │
│  ├── action_number, action_description                        │
│  ├── owner_ids (comma-separated user_ids), owner_names        │
│  ├── due_date, status, final_status                           │
│  ├── implementation_notes, implemented_date                   │
│  ├── auditor_review_status, auditor_review_by FK              │
│  ├── hoa_review_status, hoa_review_by FK                      │
│  └── days_overdue (calculated)                                │
└──────────────────────────────┬───────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               │                               │
               ▼                               ▼
       ┌──────────────┐               ┌──────────────┐
       │14_AP_Evidence│               │15_AP_History │
       │ evidence_id  │               │ history_id   │
       │    PK        │               │    PK        │
       │action_plan_id│               │action_plan_id│
       │    FK        │               │    FK        │
       │ file_name    │               │prev_status   │
       │drive_file_id │               │ new_status   │
       │ drive_url    │               │ comments     │
       │ uploaded_by  │               │ user_id FK   │
       │    FK        │               │ changed_at   │
       └──────────────┘               └──────────────┘
```

### 3.2 Complete Table Definitions

| Sheet | Purpose | Primary Key | Foreign Keys | Record Count Estimate |
|-------|---------|-------------|--------------|----------------------|
| **00_Config** | System configuration | config_key | - | ~30 |
| **01_Roles** | User role definitions | role_code | - | 7 |
| **02_Permissions** | Role-based permissions | role_code+module | role_code → 01_Roles | ~35 |
| **03_FieldDefinitions** | Dynamic field metadata | field_id | - | Variable |
| **04_StatusWorkflow** | Status transition rules | workflow_id | - | ~13 |
| **05_Users** | User accounts | user_id | role_code, affiliate_code | Variable |
| **06_Affiliates** | Business units | affiliate_code | - | 10 |
| **07_AuditAreas** | Audit classification | area_id | - | Variable |
| **08_ProcessSubAreas** | Sub-process areas | sub_area_id | area_id → 07 | Variable |
| **09_WorkPapers** | Main audit findings | work_paper_id | affiliate_code, area_id, sub_area_id, prepared_by_id, reviewed_by_id, approved_by_id | Variable |
| **10_WorkPaperRequirements** | Information requests | requirement_id | work_paper_id → 09 | Variable |
| **11_WorkPaperFiles** | Attached documents | file_id | work_paper_id → 09, uploaded_by → 05 | Variable |
| **12_WorkPaperRevisions** | Revision history | revision_id | work_paper_id → 09, user_id → 05 | Variable |
| **13_ActionPlans** | Management responses | action_plan_id | work_paper_id → 09, owner_ids → 05 | Variable |
| **14_ActionPlanEvidence** | Supporting evidence | evidence_id | action_plan_id → 13, uploaded_by → 05 | Variable |
| **15_ActionPlanHistory** | Status change log | history_id | action_plan_id → 13, user_id → 05 | Variable |
| **16_AuditLog** | System audit trail | log_id | user_id → 05 | Unlimited |
| **17_Index_WorkPapers** | WP fast lookup index | work_paper_id | - | Mirrors 09 |
| **18_Index_ActionPlans** | AP fast lookup index | action_plan_id | - | Mirrors 13 |
| **19_Index_Users** | User fast lookup index | user_id | - | Mirrors 05 |
| **20_Sessions** | Active sessions | session_id | user_id → 05 | Variable |
| **21_NotificationQueue** | Email queue | notification_id | recipient_user_id → 05 | Variable |
| **22_EmailTemplates** | Email templates | template_code | - | ~7 |
| **23_StagingArea** | Transaction staging | staging_id | - | Transient |

### 3.3 How Database Relationships Drive System Behavior

#### Work Paper → Action Plan Relationship (1:N)
```
Work Paper (WP-00001)
    │
    ├── Action Plan 1 (AP-00001) → Owner: Unit Manager A
    ├── Action Plan 2 (AP-00002) → Owner: Unit Manager B
    └── Action Plan 3 (AP-00003) → Owner: Unit Manager A, Junior Staff C
```

**System Behavior:**
- When a work paper is "Sent to Auditee", the system notifies all responsible parties
- Action plans inherit the work paper's affiliate and audit area context
- Work paper cannot be deleted if it has linked action plans
- Dashboard aggregates action plan statuses per work paper

#### User → Role → Permission Relationship
```
User (USR-00001)
    │
    └── Role: AUDITOR
            │
            ├── Permission: WORK_PAPER (create, read, update, export)
            ├── Permission: ACTION_PLAN (create, read, update, approve)
            └── Permission: REPORT (read, export)
```

**System Behavior:**
- API endpoints check permissions before executing actions
- UI dynamically shows/hides features based on permissions
- Field-level restrictions (e.g., auditee cannot edit risk_rating)

#### Document Attachment Relationships (1:N - MULTIPLE DOCUMENTS)
```
Work Paper (WP-00001)
    │
    ├── File: audit_evidence_1.pdf (FILE-00001)
    ├── File: bank_statement.xlsx (FILE-00002)
    ├── File: policy_document.docx (FILE-00003)
    └── File: screenshot.png (FILE-00004)

Action Plan (AP-00001)
    │
    ├── Evidence: implementation_proof.pdf (EVI-00001)
    └── Evidence: system_screenshot.png (EVI-00002)
```

**System Behavior:**
- No limit on number of documents per work paper/action plan
- Documents stored in Google Drive with secure sharing links
- Organized folder structure: Year → Affiliate → Work Paper ID

---

## 4. Authentication & Access Control

### 4.1 Authentication Architecture (Non-Google Account Access)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW DIAGRAM                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    1. Receive Secure Link    ┌─────────────────────────────────┐
│   Admin     │ ────────────────────────────▶│ New User (No Google Account)    │
│ (Creates    │    https://script.google.com │ - Has email (any domain)        │
│  User)      │    /.../?page=login          │ - Receives temp password        │
└─────────────┘                              └────────────────┬────────────────┘
                                                              │
                                                              │ 2. Access Login Page
                                                              ▼
                                              ┌─────────────────────────────────┐
                                              │        Login.html               │
                                              │  ┌───────────────────────────┐  │
                                              │  │ Email: [user@company.com] │  │
                                              │  │ Password: [**********]    │  │
                                              │  │ [Login Button]            │  │
                                              │  └───────────────────────────┘  │
                                              └────────────────┬────────────────┘
                                                              │
                                    3. POST {email, password} │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        07_AuthService.gs - login()                           │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ 1. Lookup user by email in 05_Users sheet                                ││
│  │ 2. Verify account is active (is_active = true)                           ││
│  │ 3. Check not locked (login_attempts < 5 or lockout expired)              ││
│  │ 4. Verify password: PBKDF2-SHA256(password, salt) == stored_hash         ││
│  │ 5. Generate 64-byte session token                                        ││
│  │ 6. Store session in 20_Sessions (24-hour expiry)                         ││
│  │ 7. Return {sessionToken, user} to client                                 ││
│  └──────────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │ 4. Session token stored in localStorage
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client (Browser)                                       │
│  localStorage.setItem('sessionToken', 'ABC123...xyz789')                    │
│  localStorage.setItem('user', JSON.stringify({...}))                        │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │ 5. All subsequent API calls include token
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    API Request with Session Token                            │
│  POST { action: 'getDashboardData', data: {}, sessionToken: 'ABC123...' }   │
│                                                                              │
│  Server validates: validateSession(token) → {valid: true, user: {...}}      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 User Creation & Pre-Existing Account Requirement

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              USER CREATION FLOW (Pre-Existing Account Required)              │
└─────────────────────────────────────────────────────────────────────────────┘

REQUIREMENT: Only users with a valid, pre-existing account record can be created.
This means an administrator must create the user account in the system first.

Step 1: Administrator Creates User Account
┌─────────────────────────────────────────────────────────────────────────────┐
│ Admin (SUPER_ADMIN or HEAD_OF_AUDIT) uses Settings → User Management:       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Create New User Form:                                                   ││
│  │   Full Name: [John Smith                    ]                           ││
│  │   Email:     [john.smith@externalcompany.com]  ← Any email domain       ││
│  │   Role:      [UNIT_MANAGER          ▼]                                  ││
│  │   Affiliate: [HPK - Hass Petroleum Kenya ▼]                             ││
│  │   Department:[Finance                       ]                           ││
│  │                                                                         ││
│  │   [Create User]                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Step 2: System Creates Account Record
┌─────────────────────────────────────────────────────────────────────────────┐
│ 05_Users Sheet New Row:                                                      │
│ ┌───────────────────────────────────────────────────────────────────────────┐│
│ │ user_id: USR-00042                                                        ││
│ │ email: john.smith@externalcompany.com                                     ││
│ │ password_hash: [PBKDF2 hash of temp password]                             ││
│ │ password_salt: [random 32-byte salt]                                      ││
│ │ full_name: John Smith                                                     ││
│ │ role_code: UNIT_MANAGER                                                   ││
│ │ affiliate_code: HPK                                                       ││
│ │ is_active: TRUE                                                           ││
│ │ must_change_password: TRUE ← Forces password change on first login        ││
│ │ created_at: 2026-01-23T10:30:00Z                                          ││
│ │ created_by: USR-00001 (admin)                                             ││
│ └───────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Step 3: System Sends Welcome Email with Secure Link
┌─────────────────────────────────────────────────────────────────────────────┐
│ Email to: john.smith@externalcompany.com                                     │
│ Subject: Welcome to Hass Petroleum Internal Audit System                     │
│                                                                              │
│ Hello John Smith,                                                            │
│                                                                              │
│ Your account has been created for the Hass Petroleum Internal Audit System.  │
│                                                                              │
│ ACCESS LINK: https://script.google.com/macros/s/[deployment-id]/exec        │
│                                                                              │
│ Login Credentials:                                                           │
│ Email: john.smith@externalcompany.com                                        │
│ Temporary Password: Hk7$mNp2qRsT                                            │
│                                                                              │
│ Please log in and change your password immediately.                          │
│                                                                              │
│ Best regards,                                                                │
│ Audit Team                                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
Step 4: User Accesses System via Secure Link
┌─────────────────────────────────────────────────────────────────────────────┐
│ User clicks link → Opens Login.html → Enters email & temp password          │
│ → System validates against 05_Users sheet → Creates session → Redirects     │
│ → Prompts to change password (must_change_password = true)                   │
└─────────────────────────────────────────────────────────────────────────────┘

KEY SECURITY FEATURES:
✓ No Google account required - any email domain works
✓ Application-level access control (not Google's)
✓ Pre-existing account record required (prevents unauthorized signups)
✓ Temporary password expires on first use
✓ Session tokens (not cookies) for authentication
✓ Account lockout after 5 failed attempts (30-minute cooldown)
```

### 4.3 Role-Based Access Control Matrix

| Role | Code | Level | Work Papers | Action Plans | Users | Config | Reports |
|------|------|-------|-------------|--------------|-------|--------|---------|
| **Head of Internal Audit** | SUPER_ADMIN | 100 | Full | Full | Full | Full | Full |
| **Internal Auditor** | AUDITOR | 80 | CRUD | CRUD+Approve | Read | - | Read+Export |
| **Unit Manager** | UNIT_MANAGER | 60 | Read+Respond | CRUD (own) | - | - | Read |
| **Junior Staff** | JUNIOR_STAFF | 40 | Read | Update (assigned) | - | - | - |
| **Senior Management** | SENIOR_MGMT | 70 | Read | Read | - | - | Read+Export |
| **Board Member** | BOARD | 90 | Read | Read | - | - | Read+Export |
| **External Auditor** | EXTERNAL_AUDITOR | 50 | Read (approved) | Read | - | - | - |

---

## 5. Module Organization & Data Flow

### 5.1 Module Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MODULE ORGANIZATION                                  │
└─────────────────────────────────────────────────────────────────────────────┘

AUDITOR PORTAL (AuditorPortal.html) - Main Application Shell
│
├── DASHBOARD MODULE (Dashboard.html)
│   ├── Summary Statistics Cards
│   │   ├── Work Paper Counts by Status
│   │   └── Action Plan Counts by Status
│   ├── Chart Visualizations
│   │   ├── Status Distribution (Pie)
│   │   ├── Risk Rating Distribution (Bar)
│   │   ├── Monthly Trends (Line)
│   │   └── Affiliate Comparison (Bar)
│   ├── Alerts Panel
│   │   ├── Overdue Action Plans
│   │   ├── Pending Reviews
│   │   └── Escalations
│   └── Recent Activity Feed
│
├── WORK PAPERS MODULE
│   ├── Workpaperslist.html - List View
│   │   ├── Filterable Table
│   │   ├── Status-based Filtering
│   │   ├── Search Functionality
│   │   └── Bulk Actions
│   ├── Workpaperform.html - Create/Edit Form
│   │   ├── Identification Section
│   │   ├── Control Details Section
│   │   ├── Risk Assessment Section
│   │   ├── Observation Section
│   │   ├── Recommendation Section
│   │   ├── Document Attachments Section ← ENHANCED
│   │   └── Workflow Actions
│   └── Workpaperview.html - Detail View
│       ├── All Sections (Read-only)
│       ├── Linked Action Plans
│       ├── Attached Documents ← MULTIPLE FILES
│       ├── Requirements Tracking
│       ├── Revision History
│       └── Workflow Action Buttons
│
├── ACTION PLANS MODULE
│   ├── Actionplanslist.html - List View
│   │   ├── Owner-based Filtering
│   │   ├── Status Grouping
│   │   ├── Due Date Tracking
│   │   └── Overdue Highlighting
│   └── Actionplanview.html - Detail View
│       ├── Action Description
│       ├── Owner Information
│       ├── Implementation Status
│       ├── Evidence Attachments ← MULTIPLE FILES
│       ├── Review Status (Auditor, HOA)
│       └── Status History Timeline
│
├── REPORTS MODULE (Reports.html)
│   ├── Audit Summary Report
│   ├── Action Plan Aging Report
│   ├── Risk Summary Report
│   └── Export Options (PDF, CSV)
│
├── ANALYTICS MODULE (Analytics.html)
│   ├── Year Selection
│   ├── Work Paper Analytics
│   ├── Action Plan Tracking
│   ├── Risk Trend Analysis
│   └── Auditor Performance Metrics
│
└── SETTINGS MODULE (Settings.html) - Admin Only
    ├── User Management
    │   ├── Create User
    │   ├── Edit User
    │   ├── Reset Password
    │   └── Deactivate User
    ├── Role Permissions
    ├── Audit Areas Configuration
    ├── Affiliates Management
    ├── Email Templates
    ├── AI Configuration
    └── System Maintenance
        ├── Rebuild Indexes
        ├── Process Email Queue
        └── View Audit Log
```

### 5.2 Data Flow Diagrams

#### Work Paper Lifecycle Flow
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WORK PAPER LIFECYCLE DATA FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

[Auditor]                    [System]                        [Database]
    │                            │                               │
    │ 1. Create Work Paper       │                               │
    │──────────────────────────▶│                               │
    │                            │ 2. Validate & Generate ID     │
    │                            │──────────────────────────────▶│
    │                            │       INSERT 09_WorkPapers    │
    │                            │◀──────────────────────────────│
    │                            │ 3. Update Index               │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 17_Index_WorkPapers │
    │ 4. Status: Draft           │                               │
    │◀──────────────────────────│                               │
    │                            │                               │
    │ 5. Upload Documents        │                               │
    │──────────────────────────▶│                               │
    │                            │ 6. Store in Drive             │
    │                            │──────────────────────────────▶│ Google Drive
    │                            │ 7. Record File Reference      │
    │                            │──────────────────────────────▶│
    │                            │       INSERT 11_WorkPaperFiles│
    │ 8. File Attached           │                               │
    │◀──────────────────────────│                               │
    │                            │                               │
    │ 9. Submit for Review       │                               │
    │──────────────────────────▶│                               │
    │                            │ 10. Update Status             │
    │                            │──────────────────────────────▶│
    │                            │    UPDATE 09 (status='Submitted')
    │                            │ 11. Log Revision              │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 12_WorkPaperRevisions
    │                            │ 12. Queue Notification        │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 21_NotificationQueue│
    │ 13. Status: Submitted      │                               │
    │◀──────────────────────────│                               │

[HOA/Reviewer]               [System]                        [Database]
    │                            │                               │
    │ 14. Review & Approve       │                               │
    │──────────────────────────▶│                               │
    │                            │ 15. Update Status & Reviewer  │
    │                            │──────────────────────────────▶│
    │                            │    UPDATE 09 (status='Approved')
    │                            │ 16. Log Revision              │
    │                            │──────────────────────────────▶│
    │ 17. Status: Approved       │                               │
    │◀──────────────────────────│                               │
    │                            │                               │
    │ 18. Send to Auditee        │                               │
    │──────────────────────────▶│                               │
    │                            │ 19. Update Status             │
    │                            │──────────────────────────────▶│
    │                            │    UPDATE 09 (status='Sent to Auditee')
    │                            │ 20. Notify Auditee            │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 21_NotificationQueue│
    │ 21. Status: Sent           │                               │
    │◀──────────────────────────│                               │
```

#### Action Plan Implementation Flow
```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ACTION PLAN IMPLEMENTATION DATA FLOW                         │
└─────────────────────────────────────────────────────────────────────────────┘

[Auditee/Owner]              [System]                        [Database]
    │                            │                               │
    │ 1. View Assigned Plans     │                               │
    │──────────────────────────▶│                               │
    │                            │ 2. Query by owner_ids         │
    │                            │──────────────────────────────▶│
    │                            │    SELECT 13_ActionPlans      │
    │                            │    WHERE owner_ids CONTAINS   │
    │ 3. Action Plans List       │                               │
    │◀──────────────────────────│                               │
    │                            │                               │
    │ 4. Upload Evidence         │                               │
    │──────────────────────────▶│                               │
    │                            │ 5. Store in Drive             │
    │                            │──────────────────────────────▶│ Google Drive
    │                            │ 6. Record Evidence            │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 14_ActionPlanEvidence
    │ 7. Evidence Attached       │                               │
    │◀──────────────────────────│                               │
    │                            │                               │
    │ 8. Mark as Implemented     │                               │
    │──────────────────────────▶│                               │
    │                            │ 9. Update Status & Notes      │
    │                            │──────────────────────────────▶│
    │                            │    UPDATE 13 (status='Implemented')
    │                            │ 10. Log History               │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 15_ActionPlanHistory│
    │                            │ 11. Notify Auditor            │
    │                            │──────────────────────────────▶│
    │                            │    INSERT 21_NotificationQueue│
    │ 12. Status: Implemented    │                               │
    │◀──────────────────────────│                               │

[Auditor]                    [System]                        [Database]
    │                            │                               │
    │ 13. Verify Implementation  │                               │
    │──────────────────────────▶│                               │
    │                            │ 14. Review Evidence           │
    │                            │──────────────────────────────▶│
    │                            │    SELECT 14_ActionPlanEvidence
    │                            │ 15. Update Review Status      │
    │                            │──────────────────────────────▶│
    │                            │    UPDATE 13 (auditor_review) │
    │ 16. Pending HOA Review     │                               │
    │◀──────────────────────────│                               │

[HOA]                        [System]                        [Database]
    │                            │                               │
    │ 17. Final HOA Review       │                               │
    │──────────────────────────▶│                               │
    │                            │ 18. Update Final Status       │
    │                            │──────────────────────────────▶│
    │                            │    UPDATE 13 (status='Closed')│
    │                            │ 19. Log History               │
    │                            │──────────────────────────────▶│
    │ 20. Status: Closed         │                               │
    │◀──────────────────────────│                               │
```

---

## 6. Work Paper Reference & Document Management

### 6.1 Enhanced Document Upload Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              DOCUMENT MANAGEMENT SYSTEM ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

REQUIREMENT: Support uploading MULTIPLE documents per work paper reference.
Documents are a FIRST-CLASS FEATURE, not just text entry.

┌─────────────────────────────────────────────────────────────────────────────┐
│                         STORAGE STRUCTURE                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Google Drive                                                                │
│  └── Hass Audit Files (Root Folder - ID in Config)                          │
│      ├── 2025/                                                               │
│      │   ├── HPK/                                                            │
│      │   │   ├── WP-00001/                                                   │
│      │   │   │   ├── audit_evidence_1.pdf                                    │
│      │   │   │   ├── bank_reconciliation.xlsx                                │
│      │   │   │   └── policy_screenshots.zip                                  │
│      │   │   └── WP-00002/                                                   │
│      │   │       └── ...                                                     │
│      │   └── HPU/                                                            │
│      │       └── ...                                                         │
│      └── 2026/                                                               │
│          └── ...                                                             │
│                                                                              │
│  Database Records (11_WorkPaperFiles)                                        │
│  ┌──────────────────────────────────────────────────────────────────────────┐│
│  │ file_id     │ work_paper_id │ file_category │ file_name           │ ... ││
│  │─────────────│───────────────│───────────────│─────────────────────│─────││
│  │ FILE-00001  │ WP-00001      │ Evidence      │ audit_evidence_1.pdf│ ... ││
│  │ FILE-00002  │ WP-00001      │ Supporting    │ bank_recon.xlsx     │ ... ││
│  │ FILE-00003  │ WP-00001      │ Evidence      │ policy_screens.zip  │ ... ││
│  │ FILE-00004  │ WP-00002      │ Evidence      │ contract.pdf        │ ... ││
│  └──────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Document Upload UI Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    WORK PAPER FORM - DOCUMENTS SECTION                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ WORK PAPER REFERENCE DOCUMENTS                                          ││
│  │                                                                         ││
│  │ Upload supporting documents for this work paper finding.                ││
│  │ Supported formats: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, ZIP            ││
│  │ Maximum file size: 10 MB per file                                       ││
│  │                                                                         ││
│  │ ┌─────────────────────────────────────────────────────────────────────┐ ││
│  │ │  📁 Drag and drop files here or click to browse                    │ ││
│  │ │                                                                     │ ││
│  │ │                    [+ Add Files]                                    │ ││
│  │ └─────────────────────────────────────────────────────────────────────┘ ││
│  │                                                                         ││
│  │ ATTACHED DOCUMENTS (3)                                                  ││
│  │ ┌───────────────────────────────────────────────────────────────────┐   ││
│  │ │ 📄 audit_evidence_report.pdf                                      │   ││
│  │ │    Category: [Evidence ▼]  Size: 2.4 MB  Uploaded: 2026-01-15     │   ││
│  │ │    Description: [Quarterly audit evidence summary          ]      │   ││
│  │ │    [View] [Download] [Delete]                                     │   ││
│  │ ├───────────────────────────────────────────────────────────────────┤   ││
│  │ │ 📊 bank_reconciliation_Q4.xlsx                                    │   ││
│  │ │    Category: [Supporting ▼]  Size: 156 KB  Uploaded: 2026-01-15   │   ││
│  │ │    Description: [Bank reconciliation for Q4 2025            ]     │   ││
│  │ │    [View] [Download] [Delete]                                     │   ││
│  │ ├───────────────────────────────────────────────────────────────────┤   ││
│  │ │ 🖼️ policy_violation_screenshot.png                                │   ││
│  │ │    Category: [Evidence ▼]  Size: 890 KB  Uploaded: 2026-01-16     │   ││
│  │ │    Description: [Screenshot showing policy violation        ]     │   ││
│  │ │    [View] [Download] [Delete]                                     │   ││
│  │ └───────────────────────────────────────────────────────────────────┘   ││
│  │                                                                         ││
│  │ Document Categories:                                                    ││
│  │ • Evidence - Audit evidence supporting findings                        ││
│  │ • Supporting - Supporting documentation                                ││
│  │ • Policy - Relevant policies and procedures                           ││
│  │ • Correspondence - Emails and communications                          ││
│  │ • Other - Other relevant documents                                    ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Document Management API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `addWorkPaperFile` | POST | Upload document to work paper |
| `deleteWorkPaperFile` | POST | Remove document from work paper |
| `addActionPlanEvidence` | POST | Upload evidence for action plan |
| `deleteActionPlanEvidence` | POST | Remove evidence from action plan |

### 6.4 Document Categories

| Category | Description | Use Case |
|----------|-------------|----------|
| **Evidence** | Audit evidence supporting findings | Bank statements, transaction logs |
| **Supporting** | Supporting documentation | Policies, procedures, contracts |
| **Correspondence** | Communications | Emails, meeting notes |
| **Policy** | Relevant policies | Company policies, standards |
| **Other** | Miscellaneous | Screenshots, other files |

---

## 7. UX Restructuring & Rationale

### 7.1 UX Improvement Areas (No Feature Removal)

| Area | Current State | Proposed Improvement | Rationale |
|------|--------------|---------------------|-----------|
| **Navigation** | Sidebar with 6 main items | Add quick-access shortcuts and breadcrumbs | Improved wayfinding for deep navigation |
| **Dashboard** | Single dashboard view | Role-specific dashboard variants | Different roles have different priorities |
| **Work Paper Form** | Long scrolling form | Tabbed/accordion sections | Better organization, reduced cognitive load |
| **Document Upload** | Basic file picker | Drag-drop with preview | Enhanced usability for document-heavy workflows |
| **Action Plan List** | Basic table | Kanban view option + table | Visual status tracking option |
| **Mobile Experience** | Responsive but basic | Enhanced mobile navigation | Field auditors access from mobile |

### 7.2 Navigation Restructuring

```
CURRENT NAVIGATION:                    IMPROVED NAVIGATION:
┌─────────────────────┐               ┌─────────────────────────────────────┐
│ ☰ HASS AUDIT        │               │ ☰ HASS AUDIT                        │
├─────────────────────┤               ├─────────────────────────────────────┤
│ 📊 Dashboard        │               │ 📊 Dashboard                        │
│ 📋 Work Papers      │               │    └── [My Dashboard] [Team View]   │
│ 📝 Action Plans     │               ├─────────────────────────────────────┤
│ 📈 Reports          │               │ 📋 AUDIT MANAGEMENT                 │
│ 📉 Analytics        │               │    ├── Work Papers                  │
│ ⚙️ Settings         │               │    │   ├── All Work Papers          │
└─────────────────────┘               │    │   ├── My Work Papers           │
                                      │    │   └── Pending Review           │
                                      │    └── Action Plans                 │
                                      │        ├── All Action Plans         │
                                      │        ├── My Action Plans          │
                                      │        └── Overdue                  │
                                      ├─────────────────────────────────────┤
                                      │ 📈 INSIGHTS                         │
                                      │    ├── Reports                      │
                                      │    └── Analytics                    │
                                      ├─────────────────────────────────────┤
                                      │ ⚙️ ADMINISTRATION (Admin only)      │
                                      │    ├── Users                        │
                                      │    ├── Configuration                │
                                      │    └── System Maintenance           │
                                      └─────────────────────────────────────┘

RATIONALE:
- Grouped related functions (Audit Management, Insights, Administration)
- Added quick filters (My Work Papers, Pending Review, Overdue)
- Reduced clicks to access common tasks
- Role-based visibility (Admin section only for admins)
- NO FEATURES REMOVED - only reorganized for clarity
```

### 7.3 Work Paper Form Restructuring

```
CURRENT: Single long scrolling form

IMPROVED: Tabbed interface with clear sections

┌─────────────────────────────────────────────────────────────────────────────┐
│ WORK PAPER: WP-00001                                    [Save Draft] [Submit]│
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ ┌──────────┬────────────┬──────────┬────────────┬──────────┬──────────────┐ │
│ │ 1.BASIC  │ 2.CONTROL  │ 3.FINDING│ 4.RESPONSE │5.DOCUMENTS│ 6.WORKFLOW  │ │
│ │  INFO    │  DETAILS   │          │            │           │             │ │
│ └──────────┴────────────┴──────────┴────────────┴──────────┴──────────────┘ │
│                                                                              │
│ TAB 1: BASIC INFORMATION                                                     │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Year:        [2026 ▼]                                                   │ │
│ │ Affiliate:   [HPK - Hass Petroleum Kenya ▼]                             │ │
│ │ Audit Area:  [FIN - Finance ▼]                                          │ │
│ │ Sub-Area:    [FIN-01 - Accounts Payable ▼]                              │ │
│ │ Audit Period: [2025-10-01] to [2025-12-31]                              │ │
│ │ Work Paper Date: [2026-01-15]                                           │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ TAB 2: CONTROL DETAILS (Auto-populated from Sub-Area, editable)             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Control Objectives: [textarea - pre-filled from sub-area]               │ │
│ │ Control Classification: [Preventive ▼]                                  │ │
│ │ Control Type: [Manual ▼]                                                │ │
│ │ Control Frequency: [Monthly ▼]                                          │ │
│ │ Control Standards: [textarea]                                           │ │
│ │ Risk Description: [textarea - pre-filled from sub-area]                 │ │
│ │ Test Objective: [textarea - pre-filled from sub-area]                   │ │
│ │ Testing Steps: [textarea - pre-filled from sub-area]                    │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ TAB 3: FINDING (Observation & Recommendation)                                │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Observation Title: [text input]                                         │ │
│ │ Observation Description: [rich textarea]                                │ │
│ │ Risk Rating: ○ Extreme  ○ High  ○ Medium  ○ Low                         │ │
│ │ Risk Summary: [textarea]                                                │ │
│ │ Recommendation: [rich textarea]                                         │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ TAB 4: MANAGEMENT RESPONSE                                                   │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Management Response: [rich textarea]                                    │ │
│ │ Responsible Persons: [multi-select user dropdown]                       │ │
│ │ CC Recipients: [multi-select user dropdown]                             │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ TAB 5: DOCUMENTS (ENHANCED - Multiple Upload)                                │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ [Document upload interface as described in Section 6.2]                 │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ TAB 6: WORKFLOW & REQUIREMENTS                                               │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ STATUS: Draft                                                           │ │
│ │ ┌─────────────────────────────────────────────────────────────────────┐ │ │
│ │ │ INFORMATION REQUIREMENTS                                [+ Add]     │ │ │
│ │ │ ┌─────────────────────────────────────────────────────────────────┐ │ │ │
│ │ │ │ #1: Bank statements for Oct-Dec 2025  Status: Pending  [Edit]   │ │ │ │
│ │ │ │ #2: Vendor contracts                   Status: Received [Edit]   │ │ │ │
│ │ │ └─────────────────────────────────────────────────────────────────┘ │ │ │
│ │ └─────────────────────────────────────────────────────────────────────┘ │ │
│ │                                                                         │ │
│ │ REVISION HISTORY                                                        │ │
│ │ ┌─────────────────────────────────────────────────────────────────────┐ │ │
│ │ │ Rev 1: Created by John Smith on 2026-01-15                          │ │ │
│ │ │ Rev 2: Submitted for review on 2026-01-16                           │ │ │
│ │ └─────────────────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ WORKFLOW ACTIONS: [Save Draft] [Submit for Review] [Cancel]                  │
└─────────────────────────────────────────────────────────────────────────────┘

RATIONALE:
- Tabbed interface reduces scrolling and cognitive overload
- Logical grouping of related fields
- Clear progression from basic info → control → finding → response → docs → workflow
- All fields preserved - just reorganized
- Tab 5 (Documents) now prominent and enhanced
- Workflow actions visible at all times
```

### 7.4 Role-Specific Dashboard Views

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ROLE-BASED DASHBOARD CUSTOMIZATION                        │
└─────────────────────────────────────────────────────────────────────────────┘

AUDITOR DASHBOARD:
┌─────────────────────────────────────────────────────────────────────────────┐
│ MY WORK PAPERS        │ PENDING REVIEWS       │ QUICK ACTIONS               │
│ ┌───────────────────┐ │ ┌───────────────────┐ │ ┌───────────────────────┐   │
│ │ Draft: 3          │ │ │ WP Reviews: 5     │ │ │ [+ New Work Paper]    │   │
│ │ Submitted: 2      │ │ │ AP Verifications:2│ │ │ [View My Tasks]       │   │
│ │ Under Review: 1   │ │ │ HOA Reviews: 3    │ │ │ [Generate Report]     │   │
│ └───────────────────┘ │ └───────────────────┘ │ └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│ TEAM ACTION PLANS     │ RISK DISTRIBUTION     │ RECENT ACTIVITY             │
│ [Chart]               │ [Chart]               │ [Activity Feed]             │
└─────────────────────────────────────────────────────────────────────────────┘

AUDITEE (UNIT MANAGER) DASHBOARD:
┌─────────────────────────────────────────────────────────────────────────────┐
│ MY ACTION PLANS       │ URGENT ITEMS          │ QUICK ACTIONS               │
│ ┌───────────────────┐ │ ┌───────────────────┐ │ ┌───────────────────────┐   │
│ │ Open: 5           │ │ │ ⚠️ OVERDUE: 2     │ │ │ [View All Plans]      │   │
│ │ In Progress: 3    │ │ │ Due This Week: 3  │ │ │ [Upload Evidence]     │   │
│ │ Implemented: 2    │ │ │ Due This Month: 4 │ │ │ [Request Extension]   │   │
│ └───────────────────┘ │ └───────────────────┘ │ └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│ MY FINDINGS           │ IMPLEMENTATION STATUS │ NOTIFICATIONS               │
│ [List of WPs]         │ [Progress Chart]      │ [Notification Feed]         │
└─────────────────────────────────────────────────────────────────────────────┘

MANAGEMENT DASHBOARD:
┌─────────────────────────────────────────────────────────────────────────────┐
│ EXECUTIVE SUMMARY     │ RISK OVERVIEW         │ COMPLIANCE STATUS           │
│ ┌───────────────────┐ │ ┌───────────────────┐ │ ┌───────────────────────┐   │
│ │ Total Findings: 45│ │ │ Extreme: 5        │ │ │ Implementation: 78%   │   │
│ │ Open: 20          │ │ │ High: 12          │ │ │ On Track: 65%         │   │
│ │ Closed: 25        │ │ │ Medium: 18        │ │ │ At Risk: 22%          │   │
│ └───────────────────┘ │ │ Low: 10           │ │ │ Overdue: 13%          │   │
│                       │ └───────────────────┘ │ └───────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│ AFFILIATE COMPARISON  │ TREND ANALYSIS        │ KEY METRICS                 │
│ [Bar Chart]           │ [Line Chart]          │ [KPI Cards]                 │
└─────────────────────────────────────────────────────────────────────────────┘

RATIONALE:
- Different roles have different priorities and workflows
- Auditors focus on creating/reviewing work papers
- Auditees focus on implementing action plans
- Management focuses on high-level metrics and trends
- All data is still accessible; just prioritized differently
- NO DATA REMOVED - same underlying queries, different presentations
```

---

## 8. Functional Preservation Matrix

### 8.1 Complete Feature Inventory

This matrix confirms that ALL existing features are preserved:

| Module | Feature | Status | Location |
|--------|---------|--------|----------|
| **Authentication** | Email/password login | ✅ Preserved | Login.html, 07_AuthService.gs |
| | Session token management | ✅ Preserved | 07_AuthService.gs |
| | Password reset | ✅ Preserved | 07_AuthService.gs:resetPassword |
| | Password change | ✅ Preserved | 07_AuthService.gs:changePassword |
| | Account lockout | ✅ Preserved | 07_AuthService.gs:incrementFailedAttempts |
| | Session cleanup | ✅ Preserved | 07_AuthService.gs:cleanupExpiredSessions |
| **Work Papers** | Create work paper | ✅ Preserved | 03_WorkPaperService.gs:createWorkPaper |
| | Update work paper | ✅ Preserved | 03_WorkPaperService.gs:updateWorkPaper |
| | Delete work paper (draft only) | ✅ Preserved | 03_WorkPaperService.gs:deleteWorkPaper |
| | Submit for review | ✅ Preserved | 03_WorkPaperService.gs:submitWorkPaper |
| | Review (approve/reject) | ✅ Preserved | 03_WorkPaperService.gs:reviewWorkPaper |
| | Send to auditee | ✅ Preserved | 03_WorkPaperService.gs:sendToAuditee |
| | Add requirements | ✅ Preserved | 03_WorkPaperService.gs:addWorkPaperRequirement |
| | Upload files (multiple) | ✅ Enhanced | 03_WorkPaperService.gs:addWorkPaperFile |
| | Track revisions | ✅ Preserved | 12_WorkPaperRevisions sheet |
| **Action Plans** | Create action plan | ✅ Preserved | 04_ActionPlanService.gs:createActionPlan |
| | Batch create | ✅ Preserved | 04_ActionPlanService.gs:createActionPlansBatch |
| | Update action plan | ✅ Preserved | 04_ActionPlanService.gs:updateActionPlan |
| | Delete action plan | ✅ Preserved | 04_ActionPlanService.gs:deleteActionPlan |
| | Mark as implemented | ✅ Preserved | 04_ActionPlanService.gs:markAsImplemented |
| | Auditor verification | ✅ Preserved | 04_ActionPlanService.gs:verifyImplementation |
| | HOA review | ✅ Preserved | 04_ActionPlanService.gs:hoaReview |
| | Upload evidence (multiple) | ✅ Enhanced | 04_ActionPlanService.gs:addActionPlanEvidence |
| | Track history | ✅ Preserved | 15_ActionPlanHistory sheet |
| **Users** | Create user | ✅ Preserved | 07_AuthService.gs:createUser |
| | Update user | ✅ Preserved | 07_AuthService.gs:updateUser |
| | Deactivate user | ✅ Preserved | 07_AuthService.gs:deactivateUser |
| | List users | ✅ Preserved | 07_AuthService.gs:getUsers |
| **Dashboard** | Summary statistics | ✅ Preserved | 06_DashboardService.gs:getSummaryStats |
| | Chart data | ✅ Preserved | 06_DashboardService.gs:getChartData |
| | Alerts | ✅ Preserved | 06_DashboardService.gs:getAlerts |
| | Recent activity | ✅ Preserved | 06_DashboardService.gs:getRecentActivity |
| | Pending reviews | ✅ Preserved | 06_DashboardService.gs:getPendingReviews |
| **Reports** | Audit summary report | ✅ Preserved | 09_AnalyticsService.gs:getAuditSummaryReport |
| | Action plan aging report | ✅ Preserved | 09_AnalyticsService.gs:getActionPlanAgingReport |
| | Risk summary report | ✅ Preserved | 09_AnalyticsService.gs:getRiskSummaryReport |
| **Analytics** | Yearly analytics | ✅ Preserved | 09_AnalyticsService.gs:getAnalyticsData |
| **Notifications** | Email queue | ✅ Preserved | 05_NotificationService.gs:queueEmail |
| | Email templates | ✅ Preserved | 22_EmailTemplates sheet |
| | Process queue | ✅ Preserved | 05_NotificationService.gs:processEmailQueue |
| **AI Integration** | OpenAI | ✅ Preserved | 05_AIService.gs |
| | Anthropic | ✅ Preserved | 05_AIService.gs |
| | Google AI | ✅ Preserved | 05_AIService.gs |
| **Admin** | Rebuild indexes | ✅ Preserved | 08_WebApp.gs:rebuildAllIndexes |
| | View audit log | ✅ Preserved | 16_AuditLog sheet |
| | System config | ✅ Preserved | 00_Config sheet |

### 8.2 Field Preservation (Work Paper)

All 42 work paper fields preserved:

```
work_paper_id, year, affiliate_code, audit_area_id, sub_area_id,
work_paper_date, audit_period_from, audit_period_to,
control_objectives, control_classification, control_type, control_frequency, control_standards,
risk_description, test_objective, testing_steps,
observation_title, observation_description, risk_rating, risk_summary, recommendation,
management_response, responsible_ids, cc_recipients,
status, final_status, revision_count,
prepared_by_id, prepared_by_name, prepared_date,
submitted_date, reviewed_by_id, reviewed_by_name, review_date, review_comments,
approved_by_id, approved_by_name, approved_date, sent_to_auditee_date,
created_at, updated_at, work_paper_ref
```

### 8.3 Field Preservation (Action Plan)

All 25 action plan fields preserved:

```
action_plan_id, work_paper_id, action_number, action_description,
owner_ids, owner_names, due_date, status, final_status,
implementation_notes, implemented_date,
auditor_review_status, auditor_review_by, auditor_review_date, auditor_review_comments,
hoa_review_status, hoa_review_by, hoa_review_date, hoa_review_comments,
days_overdue, created_at, created_by, updated_at, updated_by
```

---

## 9. Implementation Guidelines

### 9.1 File Mapping (Existing Files Preserved)

| File | Purpose | Changes |
|------|---------|---------|
| `00_Migration.gs` | Database schema | No changes |
| `01_Core.gs` | Core database operations | No changes |
| `02_Config.gs` | Configuration & constants | No changes |
| `03_WorkPaperService.gs` | Work paper CRUD | No changes |
| `04_ActionPlanService.gs` | Action plan CRUD | No changes |
| `05_AIService.gs` | AI integration | No changes |
| `05_NotificationService.gs` | Email notifications | No changes |
| `06_DashboardService.gs` | Dashboard data | No changes |
| `07_AuthService.gs` | Authentication | No changes |
| `08_WebApp.gs` | API router | No changes |
| `09_AnalyticsService.gs` | Analytics | No changes |
| `Login.html` | Login page | UI enhancement only |
| `AuditorPortal.html` | Main app shell | Navigation restructure |
| `Dashboard.html` | Dashboard view | Role-specific sections |
| `Workpaperform.html` | WP form | Tabbed interface |
| `Workpaperslist.html` | WP list | Enhanced filters |
| `Workpaperview.html` | WP detail | Document section |
| `Actionplanslist.html` | AP list | Kanban option |
| `Actionplanview.html` | AP detail | Evidence section |
| `Reports.html` | Reports | No changes |
| `Analytics.html` | Analytics | No changes |
| `Settings.html` | Admin settings | User management UI |
| `Styles.html` | CSS | Enhanced styles |
| `Scripts.html` | JavaScript | Enhanced functions |
| `Modals.html` | Modal dialogs | No changes |

### 9.2 Key Implementation Notes

1. **Authentication Enhancement**
   - Current session-based auth already supports non-Google accounts
   - Secure link is simply the web app URL
   - No code changes needed; just documentation update

2. **Document Upload Enhancement**
   - `11_WorkPaperFiles` already supports multiple files per work paper
   - UI enhancement to make drag-drop and multi-upload more prominent
   - Add file category dropdown to UI

3. **Navigation Restructure**
   - Modify `AuditorPortal.html` sidebar
   - Add sub-navigation items
   - Keep all existing routes

4. **Dashboard Role Views**
   - Modify `Dashboard.html` to check user role
   - Show/hide sections based on role
   - All data queries remain the same

### 9.3 Testing Checklist

- [ ] Login with email/password (non-Google domain)
- [ ] Session token validation
- [ ] Work paper CRUD operations
- [ ] Multiple file upload to work paper
- [ ] Action plan CRUD operations
- [ ] Multiple evidence upload to action plan
- [ ] All workflow transitions
- [ ] All reports generate correctly
- [ ] All analytics display correctly
- [ ] Email notifications queue and send
- [ ] User management operations
- [ ] Permission enforcement

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 4.0 | 2026-01-23 | System Architect | Complete architecture redesign with UX focus |

---

**END OF DOCUMENT**
