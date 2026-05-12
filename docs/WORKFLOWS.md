# Internal Audit System — Workflow Reference

> **Scope**: Internal governance and system documentation. Derived directly from source code. All status strings, function names, role codes, and config keys are verbatim from the codebase.

---

## Table of Contents

1. [Work Paper Lifecycle](#section-1--work-paper-lifecycle)
2. [Action Plan Lifecycle](#section-2--action-plan-lifecycle)
3. [Auditee Response Flow](#section-3--auditee-response-flow)
4. [User Management Workflows](#section-4--user-management-workflows)
5. [Notification System](#section-5--notification-system)
6. [Scheduled Jobs and Triggers](#section-6--scheduled-jobs-and-triggers)
7. [Workflow Configuration Points](#section-7--workflow-configuration-points)

---

## Section 1 — Work Paper Lifecycle

### 1a. All Possible Status Values

Exact strings from `STATUS.WORK_PAPER` in `02_Config.gs`:

| Constant Key        | Exact String Value    |
|---------------------|-----------------------|
| `DRAFT`             | `'Draft'`             |
| `SUBMITTED`         | `'Submitted'`         |
| `UNDER_REVIEW`      | `'Under Review'`      |
| `REVISION_REQUIRED` | `'Revision Required'` |
| `APPROVED`          | `'Approved'`          |
| `SENT_TO_AUDITEE`   | `'Sent to Auditee'`   |

Additionally, `response_status` on a work paper row uses `STATUS.RESPONSE` values (see Section 3c), set when a work paper transitions to `'Sent to Auditee'`.

`final_status` is a separate column set to `'Sent to Auditee'` by `sendToAuditee()` and is not altered thereafter.

---

### 1b. Every Valid Status Transition

#### Transition 1: (none) → `Draft`

**Function**: `createWorkPaper(data, user)` in `03_WorkPaperService.gs`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR` (enforced via route-level role check in `08_WebApp.gs` for action `createWorkPaper`)
- Subject to `canUserPerform(user, 'create', 'WORK_PAPER', null)` in `01_Core.gs`

**Validation that must pass**:
- `canUserPerform` must return true (SUPER_ADMIN always passes; others require `can_create` permission on `WORK_PAPER` module)
- Input is sanitised via `sanitizeInput()` before all fields are stored

**Side effects**:
- Inserts row into `work_papers` table with `status = 'Draft'`, `created_at`, `created_by`
- Writes assigned responsible parties to `work_paper_responsibles` junction table
- Writes CC recipients to `work_paper_cc_recipients` junction table
- If `assigned_auditor_id` is set: queues `WP_ASSIGNMENT` notification to the assigned auditor
- HOA CC queued via `queueHoaCcNotifications()` for the `WP_ASSIGNMENT` event if `assigned_auditor_id` is set
- Audit log entry written via `logAudit()`

---

#### Transition 2: `Draft` → `Submitted`

**Function**: `submitWorkPaper(workPaperId, user)` in `03_WorkPaperService.gs`

**Roles that can trigger**:
- Any role that passes `canUserPerform(user, 'update', 'WORK_PAPER', workPaper)`:
  - `SUPER_ADMIN` always passes
  - Non-SUPER_ADMIN must be the preparer or assigned auditor of the work paper
- Route-level guard allows `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

**Validation that must pass**:
- Current status must be `'Draft'` OR `'Revision Required'` (SUPER_ADMIN bypasses this check)
- **SUPER_ADMIN required fields**: `observation_title`, `risk_rating`, `affiliate_code`, `audit_area_id`, `year`
- **Non-SUPER_ADMIN required fields** (all of the above plus): `sub_area_id`, `work_paper_date`, `audit_period_from`, `audit_period_to`, `observation_description`, `risk_summary`, `recommendation`, `control_objectives`, `risk_description`, `test_objective`, `testing_steps`, `control_classification`, `control_type`, `control_frequency`
- **Evidence check (non-SUPER_ADMIN)**: at least one file must be attached to the work paper unless `evidence_override = true`

**Side effects**:
- Sets `status = 'Submitted'`, `submitted_date = now`
- Writes revision record to `work_paper_revisions` table via batch write
- Writes audit log entry
- Queues `WP_SUBMITTED` notification to every user with role `SENIOR_AUDITOR` or `SUPER_ADMIN`

---

#### Transition 3: `Revision Required` → `Submitted`

**Function**: `submitWorkPaper(workPaperId, user)` in `03_WorkPaperService.gs`

Same function as Transition 2. The source state `'Revision Required'` is explicitly allowed alongside `'Draft'`. All validation and side effects are identical.

---

#### Transition 4: `Submitted` → `Under Review`

**Function**: `reviewWorkPaper(workPaperId, action, comments, user)` in `03_WorkPaperService.gs`, with `action = 'start_review'`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR`

**Validation that must pass**:
- Current status must be `'Submitted'` OR `'Under Review'` (SUPER_ADMIN bypasses)
- Role must be `SUPER_ADMIN` or `SENIOR_AUDITOR`

**Side effects**:
- Sets `status = 'Under Review'`
- Queues `WP_REVIEWED` notification to the preparer and assigned auditor (the reviewer is excluded from recipients); HOA CC via `queueHoaCcNotifications()`
- Writes audit log

---

#### Transition 5: `Submitted` → `Approved`

**Function**: `reviewWorkPaper(workPaperId, action, comments, user)` in `03_WorkPaperService.gs`, with `action = 'approve'`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR`

**Validation that must pass**:
- Current status must be `'Submitted'` OR `'Under Review'` (SUPER_ADMIN bypasses)

**Side effects**:
- Sets `status = 'Approved'`, `approved_by_id = user.user_id`, `approved_by_name = user.full_name`, `approved_date = now`
- Queues `WP_REVIEWED` notification to preparer and assigned auditor (excluding reviewer); HOA CC
- Writes audit log
- **Auto-queue to auditee**: if `responsible_ids` is set on the work paper, immediately calls `sendToAuditee(workPaperId, user)` — the return value includes `autoQueued: true`

---

#### Transition 6: `Under Review` → `Approved`

**Function**: `reviewWorkPaper(workPaperId, action, comments, user)` in `03_WorkPaperService.gs`, with `action = 'approve'`

Same function as Transition 5; allowed from either `'Submitted'` or `'Under Review'`. Identical side effects.

---

#### Transition 7: `Submitted` → `Revision Required`

**Function**: `reviewWorkPaper(workPaperId, action, comments, user)` in `03_WorkPaperService.gs`, with `action = 'reject'` or `action = 'return'`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR`

**Validation that must pass**:
- Current status must be `'Submitted'` OR `'Under Review'` (SUPER_ADMIN bypasses)

**Side effects**:
- Sets `status = 'Revision Required'`, increments `revision_count`
- `review_comments` stored
- Queues `WP_REVIEWED` notification to preparer and assigned auditor (excluding reviewer); HOA CC
- Writes audit log

---

#### Transition 8: `Under Review` → `Revision Required`

**Function**: `reviewWorkPaper(workPaperId, action, comments, user)` in `03_WorkPaperService.gs`, with `action = 'reject'` or `action = 'return'`

Same function as Transition 7; source state `'Under Review'` is covered identically.

---

#### Transition 9: `Approved` → `Sent to Auditee`

**Function**: `sendToAuditee(workPaperId, user)` in `03_WorkPaperService.gs`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR` (route-level guard for action `sendToAuditee`; also called internally by `reviewWorkPaper()` auto-queue path)

**Validation that must pass**:
- Current status must be `'Approved'` (SUPER_ADMIN bypasses)
- `responsible_ids` must be set (list of auditee users)
- `cc_recipients` must be set
- `observation_title`, `observation_description`, `risk_rating` must be present
- All owners listed in any auto-created action plan must be active users

**Side effects**:
- Sets `status = 'Sent to Auditee'`, `final_status = 'Sent to Auditee'`
- Sets `response_status = 'Pending Response'`
- Sets `sent_to_auditee_date = now`
- Sets `response_deadline` to `RESPONSE_DEFAULTS.DEADLINE_DAYS` (default 14) days from now
- **Post-write verification**: immediately re-reads DB row to confirm status was persisted; throws if mismatch
- **Auto-creates skeleton action plan** if none exist for the work paper; default `due_date` is 30 days; validates all proposed owners are active
- Queues `WP_SENT_TO_AUDITEE` notification (priority `'urgent'`) to each responsible party individually, plus the assigned auditor; HOA CC via `queueHoaCcNotifications()`
- Writes audit log

**Batch variant**: `batchSendToAuditees(workPaperIds, user)` — roles `SUPER_ADMIN`, `SENIOR_AUDITOR`; calls `sendToAuditee()` for each work paper in sequence, then calls `sendBatchedAuditeeNotifications()` to send one combined branded HTML email per auditee

---

#### Transition 10: `Draft` → (deleted)

**Function**: `deleteWorkPaper(workPaperId, user)` in `03_WorkPaperService.gs`

**Roles that can trigger**:
- Any role passing `canUserPerform(user, 'delete', 'WORK_PAPER', workPaper)`; SUPER_ADMIN always passes; others must be preparer or assigned auditor

**Validation that must pass**:
- Current status must be `'Draft'` (SUPER_ADMIN bypasses this status check)

**Side effects**:
- Soft-delete: sets `deleted_at = now` on `work_papers` row
- All subsequent reads filter `WHERE deleted_at IS NULL`
- Writes audit log

---

#### Transition 11: `Draft` or `Revision Required` → (same status, updated fields)

**Function**: `updateWorkPaper(workPaperId, data, user)` in `03_WorkPaperService.gs`

This is not a status transition but a content update within allowed states.

**Roles that can trigger**:
- `SUPER_ADMIN`: can edit any work paper regardless of status (bypasses status lock)
- `SENIOR_AUDITOR`: can edit locked work papers
- Others: only `'Draft'` or `'Revision Required'`

**Field restrictions**:
- Assigned auditor (non-approver role): can only edit auditor-scoped fields
- `evidence_override` field: `SUPER_ADMIN` only

**Side effects**:
- Optimistic locking: `_loadedAt` timestamp in submitted data is compared against `updated_at` in DB; throws conflict error if mismatch
- Updates `work_papers` row, junction tables (`work_paper_responsibles`, `work_paper_cc_recipients`)
- Queues `WP_CHANGE` notification if triggered
- Writes audit log

---

### 1c. Full Workflow Diagram (ASCII)

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    WORK PAPER LIFECYCLE                             │
  └─────────────────────────────────────────────────────────────────────┘

                              createWorkPaper()
                         [SUPER_ADMIN|SENIOR_AUDITOR|AUDITOR]
                                      │
                                      ▼
                               ┌────────────┐
                               │   DRAFT    │◄────────────────────────┐
                               └────────────┘                         │
                                      │                               │
              submitWorkPaper()       │                               │
         [owner/assigned auditor]     │                               │
         requires: fields + evidence  │                               │
                                      ▼                               │
                              ┌────────────────┐                      │
                              │   SUBMITTED    │                      │
                              └────────────────┘                      │
                                      │                               │
            ┌─────────────────────────┼─────────────────┐            │
            │                         │                 │            │
  reviewWorkPaper()         reviewWorkPaper()    reviewWorkPaper()   │
  action='start_review'     action='approve'     action='reject'     │
  [SUPER_ADMIN|             [SUPER_ADMIN|        or 'return'         │
   SENIOR_AUDITOR]           SENIOR_AUDITOR]     [SUPER_ADMIN|       │
            │                         │           SENIOR_AUDITOR]    │
            ▼                         │                 │            │
  ┌──────────────────┐                │                 │            │
  │   UNDER REVIEW   │                │                 ▼            │
  └──────────────────┘                │      ┌─────────────────────┐ │
            │                         │      │  REVISION REQUIRED  │─┘
            │  reviewWorkPaper()       │      └─────────────────────┘
            │  action='approve'        │             (submitWorkPaper()
            │  [SUPER_ADMIN|           │              re-submits from here)
            │   SENIOR_AUDITOR]        │
            │  reviewWorkPaper()       │
            │  action='reject'/'return'│
            │  → REVISION REQUIRED     │
            │                         │
            └──────────┬──────────────┘
                       │
                       ▼
                ┌──────────────┐
                │   APPROVED   │
                └──────────────┘
                       │
                       │  sendToAuditee()    [SUPER_ADMIN|SENIOR_AUDITOR]
                       │  (or auto-queued from reviewWorkPaper() approve
                       │   if responsible_ids already set)
                       │  requires: responsible_ids, cc_recipients,
                       │            observation fields
                       ▼
              ┌──────────────────────┐
              │   SENT TO AUDITEE    │  (terminal for work_paper.status)
              └──────────────────────┘
                       │
                       │  response_status column continues independently
                       │  (see Section 3)
                       ▼
               [Auditee Response Flow]


  DELETION PATH:
  ┌──────────┐   deleteWorkPaper()   ┌─────────────┐
  │  DRAFT   │──────────────────────►│  (deleted)  │
  └──────────┘  [owner/SUPER_ADMIN]  │ deleted_at  │
                status must be Draft └─────────────┘
```

---

### 1d. Per-Role Visibility Filters for Work Papers

Implemented in `getWorkPapersRaw(filters, user)` in `03_WorkPaperService.gs`:

| Role                         | Filter Applied                                                                                  |
|------------------------------|-------------------------------------------------------------------------------------------------|
| `SUPER_ADMIN`                | No filter — sees all work papers (non-deleted)                                                  |
| `SENIOR_AUDITOR`             | No status filter — sees all work papers; affiliate filter applies if `affiliate_code` is set on user |
| `AUDITOR`                    | No status filter — sees all work papers; affiliate filter applies if `affiliate_code` is set     |
| `BOARD_MEMBER`               | Only `'Approved'` or `'Sent to Auditee'` status                                                 |
| `EXTERNAL_AUDITOR`           | Only `'Approved'` or `'Sent to Auditee'` status                                                 |
| `JUNIOR_STAFF`               | **No access** — `match = false`; must use Auditee portal (`getAuditeeFindings()`)               |
| `SENIOR_MGMT`                | **No access** — `match = false`                                                                 |
| `UNIT_MANAGER`               | **No access** — `match = false`                                                                 |

**Affiliate filter**: applies to non-`SUPER_ADMIN`/non-`SENIOR_AUDITOR` users with an `affiliate_code`; SQL restricts to work papers matching their affiliate.

---

## Section 2 — Action Plan Lifecycle

### 2a. All Possible Status Values

Exact strings from `STATUS.ACTION_PLAN` in `02_Config.gs`:

| Constant Key          | Exact String Value       |
|-----------------------|--------------------------|
| `NOT_DUE`             | `'Not Due'`              |
| `PENDING`             | `'Pending'`              |
| `IN_PROGRESS`         | `'In Progress'`          |
| `IMPLEMENTED`         | `'Implemented'`          |
| `PENDING_VERIFICATION`| `'Pending Verification'` |
| `VERIFIED`            | `'Verified'`             |
| `REJECTED`            | `'Rejected'`             |
| `OVERDUE`             | `'Overdue'`              |
| `NOT_IMPLEMENTED`     | `'Not Implemented'`      |
| `CLOSED`              | `'Closed'`               |

Additionally, the `auditor_review_status` column uses `STATUS.REVIEW` values:

| Constant Key  | Exact String Value         |
|---------------|----------------------------|
| `PENDING`     | `'Pending Review'`         |
| `APPROVED`    | `'Approved'`               |
| `REJECTED`    | `'Rejected'`               |
| `RETURNED`    | `'Returned for Revision'`  |

The `hoa_review_status` column uses the same `STATUS.REVIEW` strings.

---

### 2b. Every Valid Status Transition

#### Transition 1: (none) → `Not Due` or `Pending`

**Function**: `createActionPlan(data, user)` in `04_ActionPlanService.gs`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`, `JUNIOR_STAFF` (with `can_create_action_plan` permission on `AUDITEE_RESPONSE` module)
- Route-level: no explicit role restriction beyond session validity; permission checked via `canUserPerform`

**Validation that must pass**:
- Associated work paper must have `status = 'Sent to Auditee'` (SUPER_ADMIN bypasses)
- `due_date` must not exceed 6 months from today (hardcoded maximum)
- Required fields: `work_paper_id`, `action_description`, `owner_ids`, `due_date`

**Initial status determination**:
- `due_date > today` → `status = 'Not Due'`
- `due_date <= today` → `status = 'Pending'`

**Side effects**:
- Inserts row into `action_plans` table
- Writes owner records to `action_plan_owners` junction table with `is_original = 1, is_current = 1`
- Writes audit log

---

#### Transition 2: `Not Due` → `Pending` (automatic)

**Function**: `updateOverdueStatuses()` in `04_ActionPlanService.gs`, called daily by `dailyMaintenance` trigger

**SQL executed**:
```sql
UPDATE action_plans
SET status = 'Pending', updated_at = ?
WHERE status = 'Not Due'
  AND due_date >= ?
  AND deleted_at IS NULL
```

*(Note: the query checks `due_date >= today` but promotes `Not Due` → `Pending` when `due_date < today` via the overdue query; this transition applies when a `Not Due` item's due date arrives but has not passed)*

**Side effects**: bulk SQL update; no per-row notifications generated

---

#### Transition 3: `Not Due` / `Pending` / `In Progress` → `Overdue` (automatic)

**Function**: `updateOverdueStatuses()` in `04_ActionPlanService.gs`, called daily by `dailyMaintenance` trigger

**SQL executed**:
```sql
UPDATE action_plans
SET status = 'Overdue', updated_at = ?
WHERE status IN ('Not Due', 'Pending', 'In Progress')
  AND due_date < ?
  AND deleted_at IS NULL
```

**Side effects**: bulk SQL update; `sendOverdueReminders()` (called separately by `dailyMaintenance`) queues `OVERDUE_REMINDER` notifications per owner

---

#### Transition 4: `Not Due` / `Pending` / `In Progress` / `Overdue` → `Pending Verification`

**Function**: `markAsImplemented(actionPlanId, implementationNotes, user)` in `04_ActionPlanService.gs`

**Roles that can trigger**:
- Current owner (user is in `action_plan_owners WHERE is_current = 1` for this plan) OR
- Auditor roles: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

**Validation that must pass**:
- `implementationNotes` must be provided
- At least one evidence file must be attached (SUPER_ADMIN bypasses evidence check)
- Status must allow implementation (Not Due, Pending, In Progress, Overdue are all permitted implicitly)

**Side effects**:
- Sets `status = 'Pending Verification'`, `implemented_date = now`, `implemented_by = user.user_id`
- Queues `AP_IMPLEMENTED` notification to every user with role `SENIOR_AUDITOR` or `SUPER_ADMIN`
- Writes audit log

---

#### Transition 5: `Pending Verification` → `Verified`

**Function**: `verifyImplementation(actionPlanId, action, comments, user)` in `04_ActionPlanService.gs`, with `action = 'approve'` or `action = 'verify'`

**Roles that can trigger**:
- `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

**Validation that must pass**:
- Current status must be `'Pending Verification'` OR `'Implemented'` (SUPER_ADMIN bypasses)
- Role check: must be `SUPER_ADMIN`, `SENIOR_AUDITOR`, or `AUDITOR`

**Side effects**:
- Sets `status = 'Verified'`, `auditor_review_status = 'Approved'`
- Sets `verified_date = now`, `verified_by = user.user_id`
- Queues `AP_VERIFIED` notification to all current owners + HOA CC via `queueHoaCcNotifications()`
- Writes audit log

---

#### Transition 6: `Pending Verification` → `Rejected`

**Function**: `verifyImplementation(actionPlanId, action, comments, user)` in `04_ActionPlanService.gs`, with `action = 'reject'`

**Roles that can trigger**: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

**Validation**: same as Transition 5

**Side effects**:
- Sets `status = 'Rejected'`, `auditor_review_status = 'Rejected'`
- Queues `AP_VERIFIED` notification to all current owners + HOA CC
- Writes audit log

---

#### Transition 7: `Pending Verification` → `In Progress`

**Function**: `verifyImplementation(actionPlanId, action, comments, user)` in `04_ActionPlanService.gs`, with `action = 'return'`

**Roles that can trigger**: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

**Side effects**:
- Sets `status = 'In Progress'`, `auditor_review_status = 'Returned for Revision'`
- Queues `AP_VERIFIED` notification to all current owners + HOA CC
- Writes audit log

---

#### Transition 8: `Verified` → `Closed`

**Function**: `hoaReview(actionPlanId, action, comments, user)` in `04_ActionPlanService.gs`, with `action = 'approve'`

**Roles that can trigger**: `SUPER_ADMIN`, `SENIOR_AUDITOR`

**Validation that must pass**:
- Status must be `'Verified'` for the `approve` path

**Side effects**:
- Sets `status = 'Closed'`, `hoa_review_status = 'Approved'`
- `hoa_review_comments` stored
- `hoa_reviewed_by = user.user_id`, `hoa_reviewed_date = now`
- Queues `AP_HOA_REVIEWED` notification to all current owners + the auditor who verified (`verified_by`) + HOA CC
- Writes audit log

---

#### Transition 9: `Verified` → `In Progress`

**Function**: `hoaReview(actionPlanId, action, comments, user)` in `04_ActionPlanService.gs`, with `action = 'reject'`

**Roles that can trigger**: `SUPER_ADMIN`, `SENIOR_AUDITOR`

**Side effects**:
- Sets `status = 'In Progress'`, `hoa_review_status = 'Rejected'`
- Queues `AP_HOA_REVIEWED` notification to owners + verified_by auditor + HOA CC
- Writes audit log

---

#### Transition 10: `Not Due` / `Pending` / `In Progress` → (deleted)

**Function**: `deleteActionPlan(actionPlanId, user)` in `04_ActionPlanService.gs`

**Roles that can trigger**:
- `SUPER_ADMIN`: always; bypasses status check
- Others: requires `canUserPerform(user, 'delete', 'ACTION_PLAN', actionPlan)`; `JUNIOR_STAFF` **cannot** delete even if owner

**Validation that must pass**:
- Status must be one of `'Not Due'`, `'Pending'`, `'In Progress'` (SUPER_ADMIN bypasses)

**Side effects**:
- Soft-delete: sets `deleted_at = now`
- Writes audit log

---

#### Transition 11: (content update, no status change)

**Function**: `updateActionPlan(actionPlanId, data, user)` in `04_ActionPlanService.gs`

**Roles and allowed fields**:
- `JUNIOR_STAFF` (auditee/owner): can only update `implementation_notes`
- Auditor roles (`SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`): can update `action_description`, `owner_ids`, `owner_names`, `due_date`, `implementation_notes`, `auditor_review_comments`, `hoa_review_comments`

**Side effects**:
- Optimistic locking via `_loadedAt` timestamp
- Updates `action_plans` row and `action_plan_owners` junction if `owner_ids` changed
- Writes audit log

---

### 2c. Full Workflow Diagram (ASCII)

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                      ACTION PLAN LIFECYCLE                               │
  └──────────────────────────────────────────────────────────────────────────┘

  createActionPlan()  ──► due_date > today?
  [any authenticated user                                  YES ──► ┌─────────┐
   with permission;                                                 │ NOT DUE │
   WP must be Sent to Auditee]                                     └─────────┘
                                                                        │
                                                           NO  ──► ┌─────────┐
                                                                    │ PENDING │◄──────────┐
                                                                    └─────────┘           │
                                                                        │                 │
  updateOverdueStatuses()  [daily trigger]                              │                 │
  due_date passes ──────────────────────────────────────────►  ┌──────────────┐          │
                                                                │   OVERDUE    │          │
                                                                └──────────────┘          │
                                                                        │                 │
  markAsImplemented() ─────────────────────────────────────────────────┼─────────────────┤
  [owner OR SUPER_ADMIN|SENIOR_AUDITOR|AUDITOR]                         │            ┌────┴────────┐
  requires: notes + evidence (SA bypasses evidence)                     ▼            │ IN PROGRESS │
                                                               ┌──────────────────┐  └────────────┘
                                                               │PENDING VERIFICATION│      ▲
                                                               └──────────────────┘       │
                                         ┌──────────────────────────┼───────────┐         │
                                         │                          │           │         │
                             verifyImpl() action='approve'    action='return'   │    verifyImpl()
                             [SA|SENIOR_AUDITOR|AUDITOR]      → IN PROGRESS ───┘    action='reject'
                                         │                                            → REJECTED
                                         ▼
                                  ┌──────────────┐
                                  │   VERIFIED   │
                                  └──────────────┘
                          ┌───────────────┴──────────────────┐
                          │                                  │
                    hoaReview()                        hoaReview()
                    action='approve'                   action='reject'
                    [SUPER_ADMIN|                      [SUPER_ADMIN|
                     SENIOR_AUDITOR]                    SENIOR_AUDITOR]
                          │                                  │
                          ▼                                  ▼
                   ┌──────────┐                     ┌──────────────┐
                   │  CLOSED  │                     │  IN PROGRESS │
                   └──────────┘                     └──────────────┘
                   (terminal)

  DELETION PATH:
  ┌─────────┐
  │ NOT DUE │──┐
  └─────────┘  │  deleteActionPlan()
  ┌─────────┐  ├─────────────────────► (deleted / soft-deleted)
  │ PENDING │──┤  [SUPER_ADMIN bypasses;
  └─────────┘  │   JUNIOR_STAFF cannot delete]
  ┌───────────┐│
  │IN PROGRESS│┘
  └───────────┘
```

---

### 2d. Delegation Flow

**Function**: `delegateActionPlan(actionPlanId, newOwnerIds, newOwnerNames, notes, user)` in `04_ActionPlanService.gs`

#### Who Can Delegate
- Current owners (user is in `action_plan_owners WHERE is_current = 1`) OR
- Auditor roles: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

#### Statuses That Block Delegation
- `'Verified'`, `'Closed'`, `'Not Implemented'` — cannot delegate from these states (SUPER_ADMIN bypasses)

#### Step-by-Step Delegation Actions

**Step 1 — Mark old owners as no longer current**:
```sql
UPDATE action_plan_owners
SET is_current = 0
WHERE action_plan_id = ? AND is_current = 1
```

**Step 2 — Insert new owners**:
```sql
INSERT INTO action_plan_owners (action_plan_id, user_id, is_original, is_current)
VALUES (?, newOwnerId, 0, 1)
```
New owners have `is_original = 0, is_current = 1`.

**Step 3 — Strip `owner_ids`/`owner_names` from the `action_plans` row** (ownership is now entirely junction-table-driven after delegation)

**Step 4 — Queue `AP_DELEGATED` notification** to new owners + HOA CC via `queueHoaCcNotifications()`

**Step 5 — Delegatee responds via `respondToDelegation()`** (in `10_AuditeeService.gs`):
- Caller must be a current owner (`is_current = 1`) or SUPER_ADMIN

#### Accept Path (`action = 'accept'`):
- Sets `delegation_accepted = 1` on the action plan row
- No ownership record changes
- Queues `AP_DELEGATION_RESPONSE` notification to the original delegator (determined from the pre-delegation `owner_ids`)

#### Reject Path (`action = 'reject'`):
- `reason` required (≥ 5 characters)
- **Restores original owners**: `UPDATE action_plan_owners SET is_current = 1 WHERE is_original = 1`
- **Removes delegated owners**: `UPDATE action_plan_owners SET is_current = 0 WHERE is_original = 0 AND is_current = 1`
- Queues `AP_DELEGATION_RESPONSE` notification to original delegator + HOA CC

#### Ownership Record States at Each Step

| Step                  | is_original=1, is_current | is_original=0, is_current |
|-----------------------|---------------------------|---------------------------|
| Before delegation     | 1 (active original owners)| — (none)                  |
| After delegation sent | 0 (originals made inactive)| 1 (delegates now active)  |
| After accept          | 0 (unchanged)             | 1 (unchanged)             |
| After reject          | 1 (restored to active)    | 0 (delegates deactivated) |

---

### 2e. Verification and HOA Review Chain

#### Who Marks Implemented
`markAsImplemented(actionPlanId, implementationNotes, user)`:
- Any **current owner** of the action plan (in `action_plan_owners WHERE is_current = 1`)
- OR any auditor role: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`
- Requires `implementationNotes` (non-empty)
- Requires at least one evidence file uploaded (SUPER_ADMIN bypasses)
- Sets `status = 'Pending Verification'`, records `implemented_by`, `implemented_date`

#### Who Verifies Implementation
`verifyImplementation(actionPlanId, action, comments, user)`:
- Roles: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`
- Can verify from `'Pending Verification'` or `'Implemented'` (SUPER_ADMIN bypasses status check)
- **Approve** (`action = 'approve'` or `'verify'`): → `'Verified'`, sets `auditor_review_status = 'Approved'`, `verified_by`, `verified_date`
- **Reject** (`action = 'reject'`): → `'Rejected'`, sets `auditor_review_status = 'Rejected'`
- **Return** (`action = 'return'`): → `'In Progress'`, sets `auditor_review_status = 'Returned for Revision'`
- On reject or return, the owner must address issues and call `markAsImplemented()` again

#### Who Does HOA Review
`hoaReview(actionPlanId, action, comments, user)`:
- Roles: `SUPER_ADMIN`, `SENIOR_AUDITOR`
- Can only act once status is `'Verified'` (for approve) or any status (for reject, SUPER_ADMIN bypasses)
- **Approve**: → `'Closed'`, sets `hoa_review_status = 'Approved'` — terminal state
- **Reject**: → `'In Progress'`, sets `hoa_review_status = 'Rejected'` — owner must re-implement

#### Rejection Cascade at Each Stage

| Stage                 | Rejected By              | Result Status    | Next Required Action               |
|-----------------------|--------------------------|------------------|------------------------------------|
| Auditor verification  | `SENIOR_AUDITOR`/`AUDITOR`| `Rejected`       | Owner calls `markAsImplemented()` again |
| Auditor return        | `SENIOR_AUDITOR`/`AUDITOR`| `In Progress`    | Owner updates and re-marks          |
| HOA review reject     | `SUPER_ADMIN`/`SENIOR_AUDITOR`| `In Progress`| Owner updates and re-marks          |

---

## Section 3 — Auditee Response Flow

### 3a. How a Work Paper Becomes Visible to an Auditee

1. A work paper must reach `status = 'Sent to Auditee'` via `sendToAuditee()` or `batchSendToAuditees()`
2. When `sendToAuditee()` runs:
   - `response_status` is set to `'Pending Response'`
   - `sent_to_auditee_date = now`
   - `response_deadline` = now + `RESPONSE_DEFAULTS.DEADLINE_DAYS` days (default 14, read from config key `RESPONSE_DEADLINE_DAYS`)
   - Each user in `responsible_ids` is added to the `work_paper_responsibles` junction table (if not already)
3. `getAuditeeFindings(filters, user)` in `10_AuditeeService.gs` surfaces visible work papers to auditees:
   - SQL joins `work_papers` with `work_paper_responsibles` on `user_id = currentUser.user_id` AND `status = 'Sent to Auditee'`
   - Also includes work papers where the user owns a **delegated** action plan (via `action_plan_owners` join)
   - Sort order: records with `response_status` in `['Pending Response', 'Draft Response', 'Response Rejected']` appear first; then sorted by `sent_to_auditee_date` ascending
4. `getAuditeeResponseData(workPaperId, user)` in `10_AuditeeService.gs`:
   - Access check: user must be in `work_paper_responsibles`, OR be a delegated AP owner for this WP, OR be `SUPER_ADMIN`, OR be an auditor role
   - Returns `canEditResponse` flag:
     - `true` for `SUPER_ADMIN` always
     - `true` for assigned/delegated user if `response_status` is one of: `'Pending Response'`, `'Draft Response'`, `'Response Rejected'`

---

### 3b. Response Round System

**What is a response round**: Each time an auditee submits a response via `submitAuditeeResponse()`, the `response_round` counter on the work paper is incremented. Each round creates a new `auditee_responses` record. A round can be:
- A fresh first response (round 1)
- A re-submission after auditor rejection (round 2, 3, …)

**Config key controlling max rounds**: `RESPONSE_MAX_ROUNDS` (read via `getResponseDefaults()` in `10_AuditeeService.gs`)

**Default value**: `3` (returned when config key is not set)

**What happens when max rounds is reached**:
1. `submitAuditeeResponse()` increments `response_round` first
2. If `response_round > MAX_ROUNDS`, the function throws an error — no new submission is accepted
3. In `reviewAuditeeResponse()` with `action = 'reject'`: if `current_round >= MAX_ROUNDS`, the `newResponseStatus` is automatically set to `'Escalated'` instead of `'Response Rejected'`

---

### 3c. All Response Statuses

`response_status` column on the `work_papers` row — exact strings from `STATUS.RESPONSE` in `02_Config.gs`:

| Constant Key  | Exact String Value       | When Set                                                   |
|---------------|--------------------------|-------------------------------------------------------------|
| `PENDING`     | `'Pending Response'`     | On `sendToAuditee()` — initial state                        |
| `DRAFT`       | `'Draft Response'`       | On `saveDraftResponse()` by auditee                         |
| `SUBMITTED`   | `'Response Submitted'`   | On `submitAuditeeResponse()` — awaiting auditor review      |
| `ACCEPTED`    | `'Response Accepted'`    | On `reviewAuditeeResponse()` with `action = 'accept'`       |
| `REJECTED`    | `'Response Rejected'`    | On `reviewAuditeeResponse()` with `action = 'reject'` (when not at max rounds); also set on AI auto-reject |
| `ESCALATED`   | `'Escalated'`            | On `reviewAuditeeResponse()` with `action = 'escalate'` or `action = 'reject'` at max rounds |

Additionally, `auditee_responses` records (individual round records in the `auditee_responses` table) use `STATUS.REVIEW` values:

| Value                       | Meaning                                                              |
|-----------------------------|----------------------------------------------------------------------|
| `'Pending Review'`          | Submission awaiting auditor action                                   |
| `'Approved'`                | Auditor accepted this round's response                               |
| `'Rejected'`                | Auditor (or AI) rejected this round's response                       |
| `'Returned for Revision'`   | Auditor returned for revision                                        |

---

### 3d. AI-Assisted Response Evaluation

**What triggers AI evaluation**:
- Called automatically within `submitAuditeeResponse()` in `10_AuditeeService.gs` immediately after the response is recorded
- Only runs if AI is enabled (config key `AI_ACTIVE_PROVIDER` is set and a valid provider is configured)

**Function**: `evaluateAuditeeResponse(workPaper, responseData)` in `05_AIService.gs`

**How it works**:
- Sends the work paper observation and the auditee's management response to the active AI provider (OpenAI, Anthropic, or Google AI; determined by `AI_ACTIVE_PROVIDER` config key)
- Uses a strict JSON prompt requesting a structured assessment including an `adequate` boolean and a numeric `score` (0–100)
- Result is parsed; `autoReject` flag is set to `true` if:
  - `parsed.adequate === false` **AND**
  - `score < 50`

**Score threshold**: `50` (hardcoded in `05_AIService.gs`; no config key controls this value)

**On AI auto-reject** (`autoReject === true`):
- The `auditee_responses` record for this round has `status` set to `'Rejected'`
- `reviewed_by_id` is set to `'AI_SYSTEM'`
- Work paper `response_status` is set to `'Response Rejected'`
- `RESPONSE_REVIEWED` notification is queued to all users in `work_paper_responsibles`
- The round counter is not rolled back — the submission counts as a used round

**On AI auto-approve** (`autoReject === false` or AI unavailable):
- No automatic status change from AI
- Response remains `'Response Submitted'`; a human auditor must call `reviewAuditeeResponse()`
- If AI evaluation throws an error or is disabled, the system falls through silently and the response remains in `'Response Submitted'` state for manual review

**AI invocations** are logged to the `ai_invocations` table by `05_AIService.gs`.

---

### 3e. Who Can See Responses and In What State

**`getAuditeeFindings()` — auditee-facing list**:
- Accessible to any authenticated user
- Non-`SUPER_ADMIN`: SQL filters to work papers where `user_id` is in `work_paper_responsibles` AND `status = 'Sent to Auditee'`, plus work papers where user owns a delegated action plan
- `SUPER_ADMIN`: sees all work papers in `'Sent to Auditee'` status

**`getAuditeeResponseData()` — detail view**:
- `SUPER_ADMIN`: always accessible; `canEditResponse = true`
- Auditor roles (`SENIOR_AUDITOR`, `AUDITOR`): accessible; `canEditResponse` not granted
- Assigned responsible party: accessible if in `work_paper_responsibles`; `canEditResponse = true` only if `response_status` ∈ `{'Pending Response', 'Draft Response', 'Response Rejected'}`
- Delegated AP owner: accessible if in `action_plan_owners` for any AP linked to this WP; same `canEditResponse` logic as assigned responsible
- All others: access denied

**Auditor review of responses** (`reviewAuditeeResponse()`):
- Roles that can review: `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`
- Route guard: action `getPendingAuditeeResponses` available to `SUPER_ADMIN`, `SENIOR_AUDITOR`, `AUDITOR`

**HOA review visibility**:
- `SENIOR_MGMT` and `UNIT_MANAGER` have no direct response review capability (no route exposes this)
- `BOARD_MEMBER`/`EXTERNAL_AUDITOR` see only `'Approved'`/`'Sent to Auditee'` work papers via `getWorkPapersRaw()`; they do not have response review routes

---

## Section 4 — User Management Workflows

### 4a. User Creation Flow

**Function**: `createUser(userData, adminUser)` in `07_AuthService.gs`

**Roles that can initiate**: `SUPER_ADMIN`, `SENIOR_AUDITOR`

**Full sequence**:

1. **Role check**: `adminUser.role_code` must be `SUPER_ADMIN` or `SENIOR_AUDITOR`; throws `'Insufficient permissions'` otherwise
2. **Input validation**:
   - `email` must be present and syntactically valid
   - `full_name` must be present
   - `role_code` must match an existing row in the `roles` table (foreign key validated via DB query)
   - `affiliate_code` (if provided) must match an existing affiliate in the DB
3. **Uniqueness check**: queries `users WHERE email = ? AND deleted_at IS NULL`; throws `'Email already in use'` if found
4. **Password generation**: generates a random temporary password
5. **Password hashing**: `hashPassword()` using PBKDF2-HMAC-SHA256 (1000 iterations); stores both `password_hash` and `password_salt`
6. **DB insert**: inserts row into `users` table with:
   - `user_id` generated via `generateId('USR')`
   - `must_change_password = 1`
   - `is_active = 1`
   - `login_attempts = 0`
7. **Welcome email**: sent **immediately** (not queued) via `sendEmail()` — uses `WELCOME` or `NEW_USER` template; email goes directly through Outlook Graph API / MailApp fallback
8. **Audit log**: `logAudit('CREATE_USER', 'USER', newUserId, null, sanitizedNewUser, adminUser)`
9. **Dropdown cache invalidation**: clears cached user dropdown data

---

### 4b. Password Reset Flow

#### Admin-Initiated Reset

**Function**: `resetPassword(userId, adminUser)` in `07_AuthService.gs`

**Roles that can initiate**: `SUPER_ADMIN` only

**Sequence**:
1. Verify `adminUser.role_code === 'SUPER_ADMIN'`
2. Fetch target user; throw if not found
3. Generate random temporary password
4. Hash via `hashPassword()`
5. Update `users` row:
   - `password_hash`, `password_salt`
   - `must_change_password = 1`
   - `login_attempts = 0`
   - `locked_until = null`
6. **Invalidate all sessions**: `invalidateUserSessions(userId)` — sets `is_valid = 0` on all session rows for this user
7. **Send password reset email** immediately via `sendEmail()` — `PASSWORD_RESET` or `RESET_PASSWORD` template; not queued
8. **Cache invalidation**: clears `getUserByEmailCached()` cache entry for this user
9. Write audit log

#### Self-Service Forgot Password

**Function**: `forgotPassword(email)` in `07_AuthService.gs`

**No authentication required** — this is a public endpoint

**Sequence**:
1. Normalize email (lowercase, trim)
2. Attempt to find user by email; **always returns the same success message** regardless of whether email exists (prevents user enumeration)
3. If user found and is active:
   - Generate temporary password
   - Hash via `hashPassword()`
   - Update `users` row: `password_hash`, `password_salt`, `must_change_password = 1`, `login_attempts = 0`, `locked_until = null`
   - Invalidate all sessions: `invalidateUserSessions(userId)`
   - Send email immediately via `sendEmail()` — not queued
4. Write audit log (regardless of outcome)

#### First Login / Force Change Password

**Function**: `changePassword(userId, currentPassword, newPassword)` in `07_AuthService.gs`

**Sequence**:
1. Fetch user by `userId`
2. Verify `currentPassword` against stored hash via `verifyPassword()`
3. Validate new password strength:
   - Minimum length from config key `PASSWORD_MIN_LENGTH` (default 8)
   - Must contain at least one uppercase letter
   - Must contain at least one lowercase letter
   - Must contain at least one number
4. Hash new password via `hashPassword()`
5. Update `users` row: `password_hash`, `password_salt`, `must_change_password = 0`
6. Write audit log

---

### 4c. Account Lockout and Unlock Flow

#### Lockout (automatic on failed logins)

**Controlled by** (read from config at login time, falling back to `AUTH_CONFIG` defaults):
- `MAX_LOGIN_ATTEMPTS` config key → default `5`
- `LOCKOUT_DURATION_MINUTES` config key → default `30`

**Sequence on each failed login** (`login()` in `07_AuthService.gs`):
1. `incrementFailedAttempts(userId)` — increments `login_attempts` counter on the user row
2. If `login_attempts >= MAX_LOGIN_ATTEMPTS`:
   - Sets `locked_until = now + LOCKOUT_DURATION_MINUTES`
   - Writes `ACCOUNT_LOCKED` audit log entry
   - All subsequent `login()` calls check `locked_until > now` and throw `'Account is temporarily locked'` before password check

#### Unlock — Automatic Expiry
- On next `login()` call after `locked_until` has passed: the lock check passes; login proceeds normally
- On successful login: `login_attempts` is reset to `0`, `locked_until` is cleared

#### Unlock — Admin Reset Password
- `resetPassword(userId, adminUser)` (SUPER_ADMIN only) sets `login_attempts = 0`, `locked_until = null`
- This effectively unlocks the account as a side effect of a password reset

#### Unlock — Self-Service Forgot Password
- `forgotPassword(email)` also sets `login_attempts = 0`, `locked_until = null`

**No standalone unlock endpoint exists** — unlock is achieved via password reset.

---

### 4d. Role Change Flow

**Function**: `updateUser(userId, userData, adminUser)` in `07_AuthService.gs`

**Who can change roles**: `SUPER_ADMIN`, `SENIOR_AUDITOR` (admin-only fields)

**`role_code` is an admin-only field**: users cannot change their own role

**Sequence**:
1. Admin submits `updateUser()` with new `role_code`
2. DB validation: new `role_code` must exist in `roles` table
3. `users` row updated with new `role_code`
4. **Session invalidation**: `invalidateUserSessions(userId)` is called immediately — sets `is_valid = 0` on ALL session rows for the affected user
5. Cache invalidation: `getUserByEmailCached()` cache entry cleared for affected user

**Impact on active sessions**:
- Any currently active session for the affected user will fail on the next `validateSession()` call (returns invalid)
- The user is effectively logged out of all devices/tabs immediately
- The user must log in again, at which point the new role's permissions are loaded

**Impact on in-flight work**:
- Any work paper or action plan the user was working on under the old role may no longer be accessible post-login if the new role lacks the required permissions
- No automatic reassignment occurs; items remain associated with the user under their new role

---

### 4e. Deactivation Flow

**Function**: `deactivateUser(userId, adminUser)` in `07_AuthService.gs`

**Who can deactivate**: `SUPER_ADMIN` only

**Constraints**:
- Cannot deactivate self (throws `'Cannot deactivate your own account'`)

**Sequence**:
1. Verify `adminUser.role_code === 'SUPER_ADMIN'`
2. Verify `userId !== adminUser.user_id`
3. Fetch target user; throw if not found
4. Update `users` row: `is_active = 0`
5. **Session invalidation**: `invalidateUserSessions(userId)` — sets `is_valid = 0` on all sessions
6. **Cache invalidation**: clears user-by-email cache entry; clears dropdown cache
7. Write audit log

**What happens to open work papers assigned to the deactivated user**:
- **No reassignment occurs** — the code contains no cascade logic for this
- Work papers where the user is `assigned_auditor_id` or `preparer_id` remain as-is
- Those work papers can still be read by auditors; status is unchanged
- Future submissions/reviews continue with the deactivated user referenced by ID

**What happens to open action plans owned by the deactivated user**:
- **No reassignment occurs** — the code contains no cascade logic for this
- The user's entries in `action_plan_owners` remain with `is_current = 1`
- Action plans remain in whatever status they were in
- Deactivated users are excluded from future `queueNotification()` calls (active user check in notification queue), so they will no longer receive emails

**Operational risk**: open items remain unassigned in practice once a user is deactivated. Manual reassignment via `updateWorkPaper()` or `delegateActionPlan()` is required.

---

## Section 5 — Notification System

### 5a. Every Notification Type (Exact Type Codes)

Defined in `NOTIFICATION_TYPES` constant in `05_NotificationService.gs`:

| Type Code                   | Description                                        |
|-----------------------------|----------------------------------------------------|
| `WP_ASSIGNMENT`             | Work paper assigned to an auditor                  |
| `WP_CHANGE`                 | Work paper content updated                         |
| `WP_SUBMITTED`              | Work paper submitted for review                    |
| `WP_REVIEWED`               | Work paper reviewed (approved/rejected/returned)   |
| `WP_SENT_TO_AUDITEE`        | Work paper sent to auditee                         |
| `WP_CHANGE_REQUEST`         | Change requested on a work paper                   |
| `RESPONSE_SUBMITTED`        | Auditee submitted a response                       |
| `RESPONSE_REVIEWED`         | Auditor reviewed an auditee response               |
| `AP_DELEGATED`              | Action plan delegated to new owner(s)              |
| `AP_DELEGATION_RESPONSE`    | Delegatee accepted or rejected delegation          |
| `AP_IMPLEMENTED`            | Action plan marked as implemented                  |
| `AP_VERIFIED`               | Action plan verification result (approved/rejected/returned) |
| `AP_HOA_REVIEWED`           | HOA review result on action plan                   |
| `STALE_REMINDER`            | Reminder for stale draft work paper assignment     |
| `OVERDUE_REMINDER`          | Reminder for overdue action plan                   |

---

### 5b. Per-Type Triggers, Recipients, and Channels

All notifications are delivered via email. Primary channel is **Microsoft Graph API (Outlook OAuth2)**; fallback is **Google MailApp**. All notifications go through `processEmailQueue()` unless sent immediately (welcome/password emails bypass the queue and are sent directly).

#### `WP_ASSIGNMENT`
- **Trigger**: `createWorkPaper()` when `assigned_auditor_id` is set
- **Recipients**: the assigned auditor (`assigned_auditor_id`)
- **HOA CC**: yes — all `SUPER_ADMIN` users except the trigger user (via `queueHoaCcNotifications()`)
- **Priority**: normal

#### `WP_CHANGE`
- **Trigger**: `updateWorkPaper()` when change notification is warranted
- **Recipients**: preparer, assigned auditor
- **HOA CC**: yes
- **Priority**: normal

#### `WP_SUBMITTED`
- **Trigger**: `submitWorkPaper()` on every successful submission
- **Recipients**: all users with role `SENIOR_AUDITOR` or `SUPER_ADMIN`
- **HOA CC**: not separately added (recipients already include all SUPER_ADMIN)
- **Priority**: normal

#### `WP_REVIEWED`
- **Trigger**: `reviewWorkPaper()` for any action (`start_review`, `approve`, `reject`, `return`)
- **Recipients**: the work paper preparer + assigned auditor, **excluding** the reviewer (reviewer is removed from recipient list)
- **HOA CC**: yes
- **Priority**: normal

#### `WP_SENT_TO_AUDITEE`
- **Trigger**: `sendToAuditee()` (including auto-queue path via `reviewWorkPaper()` approve)
- **Recipients**: each user in `responsible_ids` (sent individually, one notification per responsible party); also the assigned auditor
- **HOA CC**: yes
- **Priority**: `'urgent'`

#### `WP_CHANGE_REQUEST`
- **Trigger**: action `requestWorkPaperChange` (route in `08_WebApp.gs`)
- **Recipients**: preparer, assigned auditor
- **HOA CC**: yes
- **Priority**: normal

#### `RESPONSE_SUBMITTED`
- **Trigger**: `submitAuditeeResponse()` on successful submission (not on AI auto-reject path — AI auto-reject fires `RESPONSE_REVIEWED` instead)
- **Recipients**: all users with role `SENIOR_AUDITOR` or `SUPER_ADMIN`
- **HOA CC**: not separately (all SUPER_ADMIN already included)
- **Priority**: normal

#### `RESPONSE_REVIEWED`
- **Trigger**: `reviewAuditeeResponse()` on any action (`accept`, `escalate`, `return`, `reject`); also fired by AI auto-reject path
- **Recipients**: all users in `work_paper_responsibles` for the work paper
- **HOA CC**: yes
- **Priority**: `'urgent'` if action is `'escalate'`; normal otherwise

#### `AP_DELEGATED`
- **Trigger**: `delegateActionPlan()` on successful delegation
- **Recipients**: new delegated owners (one notification per new owner)
- **HOA CC**: yes
- **Priority**: normal

#### `AP_DELEGATION_RESPONSE`
- **Trigger**: `respondToDelegation()` on accept or reject
- **Recipients**: original delegator(s)
- **HOA CC**: yes (on reject path); not on accept path
- **Priority**: normal

#### `AP_IMPLEMENTED`
- **Trigger**: `markAsImplemented()` on success
- **Recipients**: all users with role `SENIOR_AUDITOR` or `SUPER_ADMIN`
- **HOA CC**: not separately (all SUPER_ADMIN already included)
- **Priority**: normal

#### `AP_VERIFIED`
- **Trigger**: `verifyImplementation()` for any action (`approve`/`verify`, `reject`, `return`)
- **Recipients**: all current owners in `action_plan_owners WHERE is_current = 1`
- **HOA CC**: yes
- **Priority**: normal

#### `AP_HOA_REVIEWED`
- **Trigger**: `hoaReview()` for any action (`approve`, `reject`)
- **Recipients**: all current owners + the auditor who performed the verification (`verified_by` user)
- **HOA CC**: yes
- **Priority**: normal

#### `STALE_REMINDER`
- **Trigger**: `sendStaleAssignmentReminders()` — run by `dailyMaintenance` trigger
- **Recipients**: assigned auditor of stale draft work papers
- **HOA CC**: yes
- **Priority**: normal

#### `OVERDUE_REMINDER`
- **Trigger**: `sendOverdueReminders()` — run by `dailyMaintenance` trigger
- **Recipients**: each current owner of each overdue action plan (one notification per owner per plan)
- **HOA CC**: summary notification sent to HOA if any reminders were queued in this run
- **Priority**: `'urgent'`

---

### 5c. Email Queue Processing

**Function**: `processEmailQueue()` in `05_NotificationService.gs`

**Trigger**: Called every **10 minutes** by the `processEmailQueue` time-driven trigger; also called within `runScheduledMaintenance()` (daily trigger)

**Concurrency control**:
- Uses `LockService.getScriptLock().waitLock(10000)` — waits up to 10 seconds to acquire the lock
- If lock cannot be acquired within 10 seconds, the run is skipped entirely (no retry)
- This prevents concurrent runs from sending duplicate emails

**Processing sequence**:
1. Acquire script lock
2. Fetch all rows from `notification_queue` WHERE `status = 'pending'` ORDER BY `created_at ASC`
3. Process up to **50** emails per run (hardcoded batch limit — no config key controls this value)
4. For each notification in the batch:
   a. Update status to `'sending'` in DB
   b. Render email body using template for the notification's `batch_type`
   c. Call `sendEmail()`:
      - Attempts Outlook Graph API first (OAuth2 token cached 50 minutes under key `'outlook_access_token'`)
      - Falls back to Google MailApp if Outlook fails
   d. On **success**: update `status = 'sent'`, `sent_at = now`
   e. On **failure**: update `status = 'failed'`, `error_message = errorMessage`
5. Release lock

**CC logic during sending**:
- `WELCOME`, `PASSWORD_RESET`, `RESET_PASSWORD`, `NEW_USER` template types: **no** audit team CC added
- All other templates: `buildAuditTeamCc()` adds the audit team CC addresses to outgoing email

**Batch size**: 50 (hardcoded constant in `processEmailQueue()`) — no config key exposed for this value

**Failure handling**:
- Failed emails remain in the queue with `status = 'failed'` until `retryFailedEmails()` resets them

**Status lifecycle in `notification_queue`**:

```
pending → sending → sent
                 ↘ failed → (retryFailedEmails() resets to) pending
                            → dead_letter (if not retrieved)
```

Exact status strings from `STATUS.NOTIFICATION` in `02_Config.gs`:
`'pending'`, `'sending'`, `'sent'`, `'failed'`, `'cancelled'`, `'dead_letter'`

---

### 5d. Stale Assignment Reminders

**Function**: `sendStaleAssignmentReminders()` in `05_NotificationService.gs`

**What it finds**: work papers with:
- `status = 'Draft'`
- `assigned_auditor_id IS NOT NULL`
- `created_at` older than **3 days** (hardcoded — no config key for this threshold)

**Deduplication logic**:
- Before queuing, queries `notification_queue` for any existing `STALE_REMINDER` notification for the same `(work_paper_id, assigned_auditor_id)` combination where `created_at > (now - 3 days)`
- If a recent reminder exists, no new reminder is queued for that work paper
- This prevents spamming the same auditor every day for the same stale draft

**Actions on match**:
- Queues `STALE_REMINDER` notification to the assigned auditor
- Queues HOA CC via `queueHoaCcNotifications()`

**Config key for days threshold**: **None** — the 3-day threshold is hardcoded in `sendStaleAssignmentReminders()`

---

### 5e. HOA CC Notifications

**Function**: `queueHoaCcNotifications(params, triggerUserId)` in `05_NotificationService.gs`

**Who gets CC'd**: all users with role `SUPER_ADMIN`, **except** the user who triggered the action (`triggerUserId` is excluded)

**How the CC list is determined**:
1. Query `users WHERE role_code = 'SUPER_ADMIN' AND is_active = 1 AND deleted_at IS NULL`
2. Filter out the user whose `user_id` equals `triggerUserId`
3. For each remaining user, call `queueNotification()` with `is_cc = true`

**Events that trigger HOA CC** (in addition to primary recipient notifications):

| Event Function              | Type Code               |
|-----------------------------|-------------------------|
| `createWorkPaper()`         | `WP_ASSIGNMENT`         |
| `updateWorkPaper()`         | `WP_CHANGE`             |
| `reviewWorkPaper()`         | `WP_REVIEWED`           |
| `sendToAuditee()`           | `WP_SENT_TO_AUDITEE`    |
| `requestWorkPaperChange()`  | `WP_CHANGE_REQUEST`     |
| `reviewAuditeeResponse()`   | `RESPONSE_REVIEWED`     |
| `delegateActionPlan()`      | `AP_DELEGATED`          |
| `respondToDelegation()` (reject path) | `AP_DELEGATION_RESPONSE` |
| `verifyImplementation()`    | `AP_VERIFIED`           |
| `hoaReview()`               | `AP_HOA_REVIEWED`       |
| `sendStaleAssignmentReminders()` | `STALE_REMINDER`   |
| `sendOverdueReminders()`    | summary notification    |

**Note**: `SUPER_ADMIN` users who are themselves the trigger are excluded to avoid self-CC.

---

## Section 6 — Scheduled Jobs and Triggers

All triggers are set up by `setupAllTriggers()` in `08_WebApp.gs`.

### Trigger 1: `processEmailQueue`

| Property        | Value                                    |
|-----------------|------------------------------------------|
| **Function**    | `processEmailQueue()`                    |
| **Interval**    | Every **10 minutes**                     |
| **Purpose**     | Drains the `notification_queue` table; sends up to 50 pending emails per run via Outlook / MailApp fallback |
| **If not running** | Emails accumulate indefinitely in `'pending'` state; no notifications are delivered to any party; all workflow events that depend on email alerts are silently lost |

---

### Trigger 2: `dailyMaintenance`

| Property        | Value                                    |
|-----------------|------------------------------------------|
| **Function**    | `runScheduledMaintenance()` → calls: `updateOverdueStatuses()`, `cleanupExpiredSessions()`, `processEmailQueue()`, `runIncrementalBackup()` (if configured), `warmAllCaches()` |
| **Interval**    | Daily at **6:00 AM**                     |
| **Purpose**     | Keeps action plan statuses current; removes expired DB sessions; flushes any remaining queued emails; warms caches for morning usage |
| **If not running** | Action plans are never promoted to `'Overdue'` — overdue items stay in `'Not Due'`/`'Pending'`/`'In Progress'` indefinitely; overdue reminder notifications never sent; expired sessions linger in DB (no security risk but accumulates stale rows); caches cold on first morning requests |

Also called by `dailyMaintenance`:

#### `sendStaleAssignmentReminders()`
- Part of `runScheduledMaintenance()` flow
- Finds draft WPs with assigned auditor older than 3 days; queues `STALE_REMINDER`

#### `sendOverdueReminders()`
- Part of `runScheduledMaintenance()` flow
- Finds overdue APs; queues `OVERDUE_REMINDER` with escalating schedule (controlled by `OVERDUE_REMINDER_SCHEDULE` config key)

---

### Trigger 3: `sendWeeklySummary`

| Property        | Value                                    |
|-----------------|------------------------------------------|
| **Function**    | `sendWeeklySummary()`                    |
| **Interval**    | **Monday at 8:00 AM**                    |
| **Purpose**     | Sends a weekly audit status summary email to configured recipients (SENIOR_AUDITOR, SUPER_ADMIN) |
| **If not running** | Weekly summary emails not sent; management does not receive the regular digest; no impact on workflow state |

---

### Trigger 4: `warmAllCaches`

| Property        | Value                                    |
|-----------------|------------------------------------------|
| **Function**    | `warmAllCaches()`                        |
| **Interval**    | Every **6 hours**                        |
| **Purpose**     | Pre-populates CacheService with config values, dropdown data, and permissions so first requests after cache expiry are not slow |
| **If not running** | First request after any cache TTL expires hits Turso DB directly; slight latency spike; no functional breakage |

---

### Trigger 5: `keepWarm` (cold-start prevention)

| Property        | Value                                    |
|-----------------|------------------------------------------|
| **Function**    | `keepWarm()` in `01_Core.gs`             |
| **Interval**    | Not listed in `setupAllTriggers()`; manually configured if desired |
| **Purpose**     | Fetches the web app URL to prevent Google Apps Script cold-start latency for users |
| **If not running** | First user requests may experience cold-start delay (~2–5s); no functional impact |

---

## Section 7 — Workflow Configuration Points

### Config Keys (Stored in Turso `config` Table, Read via `getConfig(key)`)

#### 7.1 Response Deadline Days

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Number of days from `sent_to_auditee_date` before auditee response is overdue |
| **Current default** | `14` days                                                    |
| **Config table key**| `RESPONSE_DEADLINE_DAYS`                                     |
| **Code location**   | `getResponseDefaults()` in `10_AuditeeService.gs`; applied in `sendToAuditee()` in `03_WorkPaperService.gs` via `RESPONSE_DEFAULTS.DEADLINE_DAYS` |
| **SUPER_ADMIN UI**  | Yes — should be changeable; controls the `response_deadline` field on work papers sent to auditees |

---

#### 7.2 Maximum Response Rounds

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Maximum number of times an auditee can submit a response for a single work paper before being blocked |
| **Current default** | `3` rounds                                                   |
| **Config table key**| `RESPONSE_MAX_ROUNDS`                                        |
| **Code location**   | `getResponseDefaults()` in `10_AuditeeService.gs`; enforced in `submitAuditeeResponse()` and `reviewAuditeeResponse()` |
| **SUPER_ADMIN UI**  | Yes — controls how many submissions an auditee gets before escalation is forced |

---

#### 7.3 Session Timeout Hours

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | How many hours a session remains valid (sliding window — extended on every `validateSession()` call) |
| **Current default** | `24` hours (`AUTH_CONFIG.SESSION_DURATION_HOURS`)            |
| **Config table key**| `SESSION_TIMEOUT_HOURS`                                      |
| **Code location**   | `login()`, `validateSession()` in `07_AuthService.gs`        |
| **SUPER_ADMIN UI**  | Yes — security teams should be able to tighten or relax session lifetime |

---

#### 7.4 Maximum Login Attempts Before Lockout

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Number of consecutive failed logins before the account is locked |
| **Current default** | `5` attempts (`AUTH_CONFIG.MAX_LOGIN_ATTEMPTS`)              |
| **Config table key**| `MAX_LOGIN_ATTEMPTS`                                         |
| **Code location**   | `login()`, `incrementFailedAttempts()` in `07_AuthService.gs` |
| **SUPER_ADMIN UI**  | Yes — should be configurable for stricter security policies  |

---

#### 7.5 Lockout Duration

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Minutes an account stays locked after hitting `MAX_LOGIN_ATTEMPTS` |
| **Current default** | `30` minutes (`AUTH_CONFIG.LOCKOUT_DURATION_MINUTES`)        |
| **Config table key**| `LOCKOUT_DURATION_MINUTES`                                   |
| **Code location**   | `incrementFailedAttempts()` in `07_AuthService.gs`           |
| **SUPER_ADMIN UI**  | Yes — configurable lockout duration                          |

---

#### 7.6 Minimum Password Length

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Minimum number of characters required for user passwords     |
| **Current default** | `8` characters (`AUTH_CONFIG.PASSWORD_MIN_LENGTH`)           |
| **Config table key**| `PASSWORD_MIN_LENGTH`                                        |
| **Code location**   | `changePassword()` in `07_AuthService.gs`                    |
| **SUPER_ADMIN UI**  | Yes — password policy control                                |

---

#### 7.7 Overdue Reminder Schedule

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Controls the escalating schedule for `OVERDUE_REMINDER` notifications to action plan owners |
| **Current default** | `{ first: 1, second: 5, weekly_after: 7, biweekly_after: 30 }` (JSON string) |
| **Config table key**| `OVERDUE_REMINDER_SCHEDULE`                                  |
| **Code location**   | `sendOverdueReminders()` in `05_NotificationService.gs`      |
| **SUPER_ADMIN UI**  | Yes — controls reminder cadence: first reminder day, second reminder day, when to switch to weekly, when to switch to biweekly |

Schedule semantics:
- Day `first`: first reminder sent immediately when action plan becomes overdue
- Day `second`: second reminder sent on day 5 of being overdue
- `weekly_after`: from day 7 onwards, remind weekly
- `biweekly_after`: from day 30 onwards, remind every two weeks

---

#### 7.8 AI Active Provider

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Which AI provider is used for auditee response evaluation and work paper insights |
| **Current default** | Not set (AI disabled if unset or if API key not configured)  |
| **Config table key**| `AI_ACTIVE_PROVIDER`                                         |
| **Valid values**    | `'openai'`, `'anthropic'`, `'google'`                        |
| **Code location**   | `05_AIService.gs` — `evaluateAuditeeResponse()`, `getAIConfigStatus()` |
| **SUPER_ADMIN UI**  | Yes — enables/disables AI evaluation and selects provider    |

---

### Hardcoded Values (Not Controlled by Config Keys)

#### 7.9 Action Plan Maximum Due Date

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Maximum allowed due date when creating an action plan        |
| **Current value**   | `6 months` from today                                        |
| **Config table key**| **None** — hardcoded in `createActionPlan()` in `04_ActionPlanService.gs` |
| **SUPER_ADMIN UI**  | Not currently exposed; would require code change to make configurable |

---

#### 7.10 Auto-Created Action Plan Default Due Date

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Default due date for skeleton action plans auto-created by `sendToAuditee()` |
| **Current value**   | `30 days` from `sent_to_auditee_date`                        |
| **Config table key**| **None** — hardcoded in `sendToAuditee()` in `03_WorkPaperService.gs` |
| **SUPER_ADMIN UI**  | Not currently exposed                                        |

---

#### 7.11 Email Queue Batch Size

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Maximum number of emails sent per `processEmailQueue()` run  |
| **Current value**   | `50` emails per run                                          |
| **Config table key**| **None** — hardcoded constant in `processEmailQueue()` in `05_NotificationService.gs` |
| **SUPER_ADMIN UI**  | Not currently exposed; would require code change             |

---

#### 7.12 Stale Assignment Reminder Threshold

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Number of days a draft work paper with an assigned auditor must sit before a `STALE_REMINDER` is sent |
| **Current value**   | `3 days`                                                     |
| **Config table key**| **None** — hardcoded in `sendStaleAssignmentReminders()` in `05_NotificationService.gs` |
| **SUPER_ADMIN UI**  | Not currently exposed; should be made a config key          |

---

#### 7.13 AI Evaluation Auto-Reject Score Threshold

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | AI score below which a response is automatically rejected    |
| **Current value**   | `50` (score out of 100)                                      |
| **Config table key**| **None** — hardcoded in `evaluateAuditeeResponse()` in `05_AIService.gs` |
| **SUPER_ADMIN UI**  | Not currently exposed; should be made a config key          |

---

#### 7.14 Password Hashing Iterations

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Number of PBKDF2-HMAC-SHA256 iterations for password hashing |
| **Current value**   | `1000` iterations                                            |
| **Config table key**| **None** — hardcoded in `hashPassword()` in `07_AuthService.gs` |
| **SUPER_ADMIN UI**  | Not exposed; security constant; changing would invalidate all existing password hashes |

---

#### 7.15 Outlook Access Token Cache Duration

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | How long the Outlook OAuth2 access token is cached in CacheService before being refreshed |
| **Current value**   | `50 minutes` (3000 seconds), cached under key `'outlook_access_token'` |
| **Config table key**| **None** — hardcoded in `05_NotificationService.gs`          |
| **SUPER_ADMIN UI**  | Not exposed                                                  |

---

#### 7.16 LockService Wait Duration for Email Queue

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Maximum milliseconds `processEmailQueue()` waits to acquire the script lock before skipping the run |
| **Current value**   | `10,000 ms` (10 seconds)                                     |
| **Config table key**| **None** — hardcoded in `processEmailQueue()` in `05_NotificationService.gs` |
| **SUPER_ADMIN UI**  | Not exposed                                                  |

---

#### 7.17 ID Counter Retry Backoff

| Property            | Value                                                        |
|---------------------|--------------------------------------------------------------|
| **Behaviour**       | Exponential backoff delays for `tursoIncrementCounter()` when optimistic increment conflicts |
| **Current value**   | Up to `3` retries; delays `300ms`, `600ms`                   |
| **Config table key**| **None** — hardcoded in `00_TursoService.gs`                 |
| **SUPER_ADMIN UI**  | Not exposed                                                  |

---

### CacheService TTLs (Hardcoded in `01_Core.gs` / `CONFIG.CACHE_TTL`)

| Cache Key Pattern          | TTL       | What is Cached                                               |
|----------------------------|-----------|--------------------------------------------------------------|
| `config_all`               | 3600s (1h)| All config key-value pairs from Turso                        |
| Dropdown keys              | 1800s (30m)| Risk ratings, control classifications, types, frequencies   |
| Permission keys            | 10s        | Role permission lookups                                      |
| `session_<token_hash>`     | 300s (5m)  | Validated session objects                                    |
| `user_email_<email>`       | 300s (5m)  | User records looked up by email                             |
| `'outlook_access_token'`   | 3000s (50m)| Microsoft Graph API OAuth2 access token                     |

---

*End of WORKFLOWS.md — all status values, function names, role codes, and config keys are verbatim from the source code.*
