# Turso Database Design — Internal Audit System

This document explains the Turso/libSQL schema in `db/schema.sql`, the workflow
it supports, the gaps in the current Apps Script + Firestore implementation it
closes, and the items that were not previously considered.

> Read in tandem with `db/schema.sql`. Section numbers in this document mirror
> the section banners in the SQL file.

---

## 1. Workflow recap (what the schema must support)

The system runs two interlocking lifecycles.

### 1.1 Auditor lifecycle (Work Paper)

```
DRAFT ─┬──► SUBMITTED ──► UNDER_REVIEW ─┬──► REVISION_REQUIRED ──► (loop to DRAFT)
       │                                └──► APPROVED ──► SENT_TO_AUDITEE ──► CLOSED
       └──► (delete while in DRAFT only)
```

Each transition writes a row to `work_paper_revisions` (immutable per-entity
log) and a row to `audit_log` (immutable system log).

### 1.2 Auditee lifecycle (Response → Action Plan)

```
SENT_TO_AUDITEE
  └─ response_status: Pending Response
        └─ Auditee saves draft  → Draft Response
        └─ Auditee submits      → Response Submitted (round N)
              └─ Auditor accepts → Response Accepted
              └─ Auditor rejects → Response Rejected (round N+1, max 3)
              └─ Auditor escalates → Escalated (notifies SENIOR_MGMT)
        └─ Action plans created (auditor or auditee)
              └─ NOT_DUE → PENDING → IN_PROGRESS → IMPLEMENTED
                                              ↓
                       PENDING_VERIFICATION → VERIFIED → CLOSED
                                              ↓
                          REJECTED / NOT_IMPLEMENTED (terminal)
              └─ OVERDUE (set by `update_overdue` job, not a user action)
```

Every status step writes to `action_plan_history` and `audit_log`. Status
transitions are constrained by the `status_transitions` matrix.

---

## 2. Design principles

| Principle                       | How it is realised                                                                                                                            |
|---------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Multi-tenant from day one       | `organization_id` column on every business table; FK to `organizations`.                                                                      |
| Append-only audit               | `audit_log` blocks UPDATE/DELETE via triggers; tamper-evident hash chain (`prev_hash` → `row_hash`); periodic anchors.                        |
| Optimistic concurrency          | `row_version` column + `updated_at`; `trg_*_touch` triggers bump on update. App layer compares loaded version before write.                   |
| Soft delete + retention         | `deleted_at` everywhere; `deletion_queue` schedules hard-delete after retention; `retention_policies` define windows; `legal_holds` override. |
| Enums as data                   | `enum_values` + `status_transitions` tables, not hard-coded constants. UI reads dropdowns from DB. Closes Gap-101…104.                        |
| Normalise multi-valued fields   | `work_paper_responsibles`, `work_paper_cc_recipients`, `action_plan_owners` replace CSV/newline strings.                                      |
| Polymorphic attachments         | One `files` table + `file_attachments` join — same model for WP evidence and AP evidence.                                                     |
| Defence in depth                | MFA, password history, login_attempts, rate limits, IP rules, webhook signing secrets, immutable audit, hash anchors, KMS-only secrets.       |
| Backup is a first-class concern | `backup_runs`, `restore_runs`, retention, legal holds — all tracked in DB so dashboards/alerts can run off them.                              |

---

## 3. Module map

| # | Module                        | Tables (key ones)                                                                                                                                                                |
|---|-------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0 | Migration metadata            | `schema_migrations`                                                                                                                                                              |
| 1 | Tenancy                       | `organizations`, `affiliates`, `departments`                                                                                                                                     |
| 2 | Identity & access             | `roles`, `permission_modules`, `permission_actions`, `role_permissions`, `users`, `password_history`, `sessions`, `login_attempts`, `password_reset_tokens`, `api_keys`, `rate_limit_buckets`, `ip_access_rules` |
| 3 | Reference / lookups           | `audit_areas`, `sub_areas`, `enum_values`, `status_transitions`                                                                                                                  |
| 4 | Work papers                   | `work_papers`, `work_paper_responsibles`, `work_paper_cc_recipients`, `work_paper_requirements`, `work_paper_revisions`                                                          |
| 5 | Auditee responses             | `auditee_responses`                                                                                                                                                              |
| 6 | Action plans                  | `action_plans`, `action_plan_owners`, `action_plan_history`                                                                                                                      |
| 7 | Files & evidence              | `files`, `file_attachments`                                                                                                                                                      |
| 8 | Notifications                 | `email_templates`, `notification_queue`, `notification_dead_letter`, `in_app_notifications`, `webhook_endpoints`                                                                 |
| 9 | Audit & security log          | `audit_log` (immutable), `audit_log_anchors`, `security_events`                                                                                                                  |
| 10| Configuration                 | `config`, `feature_flags`, `ai_providers`, `ai_invocations`                                                                                                                      |
| 11| Jobs & reminders              | `scheduled_jobs`, `reminders`, `job_locks`                                                                                                                                       |
| 12| Backup & retention            | `backup_runs`, `restore_runs`, `deletion_queue`, `retention_policies`, `legal_holds`                                                                                             |
| 13| Reporting & exports           | `saved_reports`, `export_jobs`, `dashboard_snapshots`                                                                                                                            |
| 14| Search                        | `work_papers_fts`, `action_plans_fts` (FTS5 virtual tables)                                                                                                                      |
| 15| Maintenance triggers          | `trg_users_touch`, `trg_wp_touch`, `trg_ap_touch`, FTS sync triggers, audit-log immutability triggers                                                                            |
| 16| Convenience views             | `v_active_users`, `v_open_action_plans`, `v_overdue_action_plans`, `v_work_papers_pending_response`, `v_user_findings`                                                           |

---

## 4. Security architecture

| Concern                | Mechanism                                                                                                                                                                                                     |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Authentication         | `users` (PBKDF2-SHA256 today; column `password_algo` allows seamless migration to argon2id). `password_history` blocks reuse. `password_expires_at` enables forced rotation.                                  |
| MFA                    | `users.mfa_enabled` + `mfa_secret` (TOTP, encrypted at app layer using KMS-managed key) + `mfa_backup_codes` (hashed). **New**, was absent in Firestore.                                                      |
| Sessions               | `sessions` stores `session_token_hash` (never the raw token). `refresh_token_hash` enables short-lived access + long-lived refresh. `invalidated_reason` records why.                                         |
| Login forensics        | `login_attempts` (per attempt, indexed by email and IP) — independent from `users.login_attempts` counter, so we keep history even after lockout reset.                                                       |
| Lockout                | `users.locked_until` + counter; `security_events` row written on `LOCKOUT`.                                                                                                                                   |
| Password reset         | `password_reset_tokens` single-use, time-bound, hashed.                                                                                                                                                       |
| API access             | `api_keys` (hash-only storage; prefix shown in UI). Scopes JSON. Per-key `last_used_at` and `revoked_at`.                                                                                                     |
| Rate limiting          | `rate_limit_buckets` keyed by IP / user / API key / email — used by app middleware. **New**.                                                                                                                  |
| IP allow/deny          | `ip_access_rules` global or per-org; CIDR + expiry. **New**.                                                                                                                                                  |
| Authorization          | `role_permissions` (role × module × action × scope) is now data, not code. Adds `scope` (ALL / OWN / DEPARTMENT / AFFILIATE) and per-row `field_restrictions` JSON.                                           |
| Audit immutability     | `audit_log` blocks UPDATE/DELETE; `row_hash = SHA-256(...||prev_hash)` chains rows; `audit_log_anchors` periodically pin cumulative hash for external attestation.                                            |
| Security event sink    | `security_events` (LOGIN_FAIL, LOCKOUT, PRIV_ESCALATION, DATA_EXPORT, MFA_RESET) — separate from `audit_log` so SOC tooling can subscribe without noise.                                                      |
| Secret handling        | Config value type `secret` is masked in UI / audit `old_data`/`new_data`. AI provider keys live in KMS — table only holds `api_key_secret_ref` (a pointer).                                                   |
| File integrity         | `files.checksum_sha256` recorded on upload; `is_encrypted` flag for client-side-encrypted uploads.                                                                                                            |
| Session-credential link| `sessions` invalidated automatically on password change (app code uses `invalidated_reason='PASSWORD_CHANGE'`).                                                                                               |
| Privacy / GDPR         | `users.privacy_consent_*`, `data_export_requested_at`, `data_deletion_requested_at`. `export_jobs` of type `DSAR` produces the user's data file. Soft-delete + retention-based hard-delete completes erasure. |

---

## 5. Audit logging strategy

Three layers, each with a different purpose and audience.

| Layer                     | Table                                          | Purpose                                                              | Audience                |
|---------------------------|------------------------------------------------|----------------------------------------------------------------------|-------------------------|
| Per-entity history        | `work_paper_revisions`, `action_plan_history`  | Document-level audit trail; what users see in UI                     | Auditors, auditees      |
| System audit log          | `audit_log`                                    | Immutable, hash-chained log of every CRUD/auth/export operation      | Compliance, forensics   |
| Security event log        | `security_events`                              | High-signal security incidents only (failed login burst, lockouts…)  | SOC / on-call           |

Every `audit_log` row carries: actor, session, entity, old/new JSON, JSON Patch
diff, severity, success flag, correlation ID (links related operations e.g.
"send work paper" fans out into N notification rows), and the previous-row
hash. Tamper detection is performed by replaying the chain.

---

## 6. Backup & restore

Turso provides PITR and replicas at the platform layer, but our application
also needs to track its own logical exports for compliance and DR drills.

| Concern                    | Mechanism                                                                                                                                                                |
|----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Snapshot scheduling        | `scheduled_jobs` row of type `backup`; cron-driven.                                                                                                                      |
| Snapshot record            | `backup_runs` row per run, with type (`FULL`/`INCREMENTAL`/`LOGICAL_EXPORT`/`PITR_SNAPSHOT`), size, checksum, encryption key reference, and per-table row counts.        |
| Off-platform copy          | `storage_location` points at S3/R2/GCS; KMS-managed encryption key referenced by ID.                                                                                     |
| Restore drills             | `restore_runs` enforces four-eyes (`requested_by` + `approved_by`) for production restores; `verification_status` records checksum recompute.                            |
| Soft-delete recovery       | `deleted_at` everywhere; `deletion_queue` schedules hard-delete after `retention_policies` window; user can restore by clearing `deleted_at` until then.                 |
| Retention enforcement      | `retention_policies` per `entity_type`; janitor job prunes rows older than `retention_days` unless a `legal_hold` covers them. Default audit-log retention = 7 years.    |
| Legal hold                 | `legal_holds` rows stop retention deletion for matching entities — required for litigation / regulatory investigations.                                                  |
| Lock against double-runs   | `job_locks` prevents two restore jobs (or backup jobs) running concurrently — closes a race in the existing `updateOverdueStatuses` design.                              |

---

## 7. Mapping Firestore → Turso

| Firestore collection            | Turso table(s)                                              | Notes                                                                                           |
|---------------------------------|-------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `00_Config`                     | `config`, `feature_flags`                                   | Split: feature flags become first-class.                                                        |
| `01_Roles`                      | `roles`                                                     | `BOARD` ↔ `BOARD_MEMBER` mismatch resolved (Gap-501).                                           |
| `02_Permissions`                | `role_permissions`, `permission_modules`, `permission_actions` | Normalised matrix; replaces hardcoded ROLE_PERMISSIONS object.                                  |
| `05_Users`                      | `users`, `password_history`                                 | `is_active` becomes a real BOOLEAN; `mfa_*` columns added (Gap-MFA).                            |
| `06_Affiliates`                 | `affiliates`                                                | Composite PK `(organization_id, affiliate_code)`.                                               |
| `07_AuditAreas`, `08_ProcessSubAreas` | `audit_areas`, `sub_areas`                            | Unchanged structurally; gain FKs.                                                               |
| `09_WorkPapers`                 | `work_papers` + 4 child tables                              | `responsible_ids` and `cc_recipients` normalised (Gaps-CSV, 109).                               |
| `10_WorkPaperRequirements`      | `work_paper_requirements`                                   | Gains `date_provided` so workflow is closeable.                                                 |
| `11_WorkPaperFiles`             | `files` + `file_attachments`                                | Polymorphic attachment table replaces two parallel collections.                                 |
| `12_WorkPaperRevisions`         | `work_paper_revisions`                                      | Adds `from_status`/`to_status` columns + JSON diff.                                             |
| `13_ActionPlans`                | `action_plans`                                              | All "schema-missing" fields (Gap-401, Gap-402, Gap-507) now first-class columns.                |
| `14_ActionPlanEvidence`         | `files` + `file_attachments`                                | Merged with WP evidence under one storage abstraction.                                          |
| `15_ActionPlanHistory`          | `action_plan_history`                                       | Generalised: `event_type` is more than just status changes.                                     |
| `16_AuditLog`                   | `audit_log`, `security_events`, `audit_log_anchors`         | Append-only + hash chain + SOC sink.                                                            |
| `20_Sessions`                   | `sessions`                                                  | Stores hashes only; refresh token added.                                                        |
| `21_NotificationQueue`          | `notification_queue`, `notification_dead_letter`, `in_app_notifications` | Adds DLQ, in-app channel, retry/backoff fields.                                       |
| `22_EmailTemplates`             | `email_templates`                                           | Adds locale + plaintext body.                                                                   |
| `24_AuditeeResponses`           | `auditee_responses`                                         | `response_type` retained (was always empty — Gap-301; now usable).                              |
| (none)                          | `organizations`, `departments`, `feature_flags`, `ai_providers`, `ai_invocations`, `webhook_endpoints`, `api_keys`, `rate_limit_buckets`, `ip_access_rules`, `password_history`, `password_reset_tokens`, `login_attempts`, `enum_values`, `status_transitions`, `scheduled_jobs`, `reminders`, `job_locks`, `backup_runs`, `restore_runs`, `deletion_queue`, `retention_policies`, `legal_holds`, `saved_reports`, `export_jobs`, `dashboard_snapshots`, `audit_log_anchors`, `security_events`, `notification_dead_letter`, `in_app_notifications` | All net-new — see Gap section below. |

---

## 8. Gap analysis — closed by this schema

| #     | Gap                                                                  | How the schema closes it                                                                                                       |
|-------|----------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| 101–104 | `control_classification`, `control_type`, `control_frequency`, `control_standards` exist on data but no UI inputs; values are hardcoded enums | Columns kept on `work_papers`; legal values seeded into `enum_values` so UI can render dropdowns dynamically. UI must add the inputs. |
| 105   | `assigned_auditor_name` orphan field never written                   | Column kept; populated by app on assignment (single source of truth still `assigned_auditor_id` joined to `users`).            |
| 106   | `affiliate_name` resolved at runtime (not persisted)                 | Intentional join via FK to `affiliates`; views supply denormalised reads.                                                      |
| 109   | `cc_recipients` delimiter mismatch (newline vs comma)                | Replaced by `work_paper_cc_recipients` join table; one row per recipient.                                                      |
| 201/202 | Backend ignores `date_from` / `has_action_plans` filters           | Indexed columns + views allow real server-side filtering.                                                                      |
| 301   | `auditee_responses.response_type` always empty                       | Field retained; documented values: INITIAL / REVISED / ESCALATED. App must populate.                                           |
| 302   | Delegatees cannot submit responses                                   | `work_paper_responsibles` is now the authority; app can join through `action_plan_owners` to compute "can this user respond".  |
| 401   | `implemented_by`, `verified_*`, `auditor_review_status`, `hoa_review_status` written but not in schema | All five are now first-class columns on `action_plans`.                                                                        |
| 402   | Five delegation fields not in schema                                 | All present on `action_plans`; full-history available in `action_plan_owners` (`is_original`, `is_current`, `removed_at`).     |
| 403   | `final_status` dead field, never updated                             | Kept on `work_papers` and `action_plans` for archival closure write; app must actually set it.                                 |
| 404   | `created_by` displayed as raw ID in UI                               | FK to `users`; views/queries can `JOIN` to resolve display name.                                                               |
| 405   | UI shows raw role code instead of role name                          | FK on `users.role_code → roles.role_code`; UI joins for display name.                                                          |
| 501   | DB has `BOARD`, code expects `BOARD_MEMBER`                          | Single canonical value: `BOARD_MEMBER`. Migration step rewrites legacy `BOARD` rows.                                           |
| 502   | `is_active` truthy bug (string "false" treated as truthy)            | Column is `INTEGER` (0/1); SQLite enforces type affinity. No more string "false".                                              |
| 503   | `is_active` filter inconsistency                                     | Same fix as 502 — boolean by storage.                                                                                          |
| 506   | `affiliate_id` vs `affiliate_code` naming                            | Renamed to `affiliate_code` everywhere.                                                                                        |
| 507   | Missing `audit_area_id` on action plans                              | Added as first-class column with FK + index.                                                                                   |
| 508   | 61 % of action plans have empty `created_at`                         | Column NOT NULL with default; migration must backfill from parent work paper.                                                  |
| 509   | `SUPER_ADMIN` not in roles collection                                | Seeded in roles table (`is_system = 1`).                                                                                       |
| 510   | Overdue counts inconsistent across role scopes                       | `v_overdue_action_plans` view + per-role scoping in app makes results consistent.                                              |
| 511   | User Role column displays raw code                                   | `roles.role_name` available via FK join.                                                                                       |
| 512   | Recent Activity falls back to "—" when timestamps missing            | All audit timestamps NOT NULL with default; backfill on migration.                                                             |

---

## 9. Gap analysis — items previously not considered

These are concerns the existing system does not address at all. The schema
introduces tables/columns to support them; corresponding application logic is
out of scope for this PR but tracked here.

1. **Multi-tenancy.** No `organization_id` anywhere — single-org assumption baked in. Now first-class on every business row.
2. **Multi-factor authentication.** Mentioned in some specs but never implemented. `users.mfa_*` columns + `security_events` for `MFA_RESET`.
3. **Password reuse prevention.** No history table existed. `password_history` retains last N hashes.
4. **Password expiry.** No mechanism. `password_expires_at` column.
5. **Refresh tokens / session rotation.** Single 24h token only. `sessions.refresh_token_hash` enables short access + long refresh.
6. **Token storage hygiene.** Raw `session_token` stored in Firestore. Now hash-only (`session_token_hash`).
7. **Login attempt forensics.** Only a counter on the user. Per-attempt history table now retained for analysis.
8. **API key access for external auditors.** Only interactive login existed. `api_keys` table with scopes, expiry, key prefix display.
9. **Rate limiting.** None. `rate_limit_buckets` populated by middleware.
10. **IP allow / deny rules.** None. `ip_access_rules` (CIDR + expiry, per-org or global).
11. **Audit log immutability.** No protection — admin could edit/delete logs. Triggers block UPDATE/DELETE; hash chain + anchors detect tampering.
12. **Tamper-evidence anchors.** `audit_log_anchors` for periodic external attestation (e.g. notarised receipt, blockchain pin).
13. **Security event sink.** Audit log conflated routine CRUD with security incidents. `security_events` separates them for SOC.
14. **Correlation IDs.** Multi-step operations untraceable. `audit_log.correlation_id` ties them.
15. **Permissions as data.** Role × module × action matrix was hardcoded in `02_Config.gs`. Now `role_permissions` table — adds `scope` (ALL/OWN/DEPARTMENT/AFFILIATE) and `field_restrictions`.
16. **Status transitions as data.** Lifecycle was implicit in code. `status_transitions` constrains legal moves and records role/comment requirements.
17. **Departmental hierarchy.** Only flat `department` string on user. `departments` table with parent_department supports org charts and DEPARTMENT-scoped permissions.
18. **Polymorphic attachments.** Two parallel collections (`11_WorkPaperFiles`, `14_ActionPlanEvidence`). Unified `files` + `file_attachments`.
19. **File integrity.** No checksum stored. `files.checksum_sha256` for verification on retrieval.
20. **In-app notifications.** Email-only. `in_app_notifications` table for read-state-aware UI alerts.
21. **Notification dead-letter.** Failed notifications had no recovery path. `notification_dead_letter` + `attempts`/`max_attempts`/`next_attempt_at` retry policy.
22. **Outbound webhooks.** No integration with external SIEM/HR. `webhook_endpoints` with HMAC signing secret.
23. **AI usage metering & cost tracking.** No record of prompts, tokens, cost, latency. `ai_invocations` (with redacted payload) + `ai_providers`.
24. **Feature flags.** Boolean configs in a key-value bag. `feature_flags` table with rollout %, targeting JSON.
25. **Reminder scheduling.** Calculated on-the-fly each run. `reminders` table makes them queryable, cancellable, escalatable.
26. **Distributed locks.** Daily overdue updater could double-run. `job_locks` table.
27. **Saved reports & scheduled exports.** None. `saved_reports` + `export_jobs`.
28. **Materialised dashboard snapshots.** Dashboard recomputed on every load. `dashboard_snapshots` daily aggregates.
29. **Full-text search.** Code did in-memory substring scans. FTS5 virtual tables `work_papers_fts`, `action_plans_fts`.
30. **Optimistic concurrency.** Implicit comparison of `updated_at`. Now explicit `row_version` + auto-touch trigger.
31. **Soft delete + retention + legal hold.** Hard-delete only. `deleted_at` + `deletion_queue` + `retention_policies` + `legal_holds`.
32. **Backup tracking.** Implicit reliance on Firestore auto-backups. `backup_runs` + `restore_runs` records snapshots, checksums, drills, four-eyes approval for production restore.
33. **Privacy / DSAR.** Consent flags existed but no export/delete pathway. `data_export_requested_at`, `data_deletion_requested_at`, `export_jobs` of type `DSAR`.
34. **Schema migration history.** None. `schema_migrations` versions every change with checksum.
35. **Configurable enums for UI.** Hardcoded constants drove dropdowns. `enum_values` table is the single source of truth.
36. **Per-tenant configuration.** Single `00_Config` collection. `config` keyed by `(organization_id, config_key)`; `GLOBAL` org reserved for defaults.
37. **Secrets vs values.** Secret config keys mixed with normal ones. `config.value_type='secret'` + `is_secret` masks them in UI and `audit_log` payloads.

---

## 10. Workflow break-points (where the existing flow fails)

These are bugs and missing pathways found during analysis. They are *not* schema
problems alone — fixing them needs application changes too — but the new schema
gives them a place to live.

1. **Delegatee cannot submit a response.** `canEditResponse` only consults `responsible_ids`; ownership through `action_plan_owners` is ignored. Schema now exposes both junctions; app must consult both.
2. **Send-to-auditee CC parsing.** Newline vs comma delimiter mismatch silently drops recipients. Replaced by `work_paper_cc_recipients` rows.
3. **Race in `updateOverdueStatuses`.** Two trigger executions can double-write. `job_locks` row keyed `JOB:update_overdue` provides a mutex.
4. **No resend on notification failure.** Failed rows sit in queue forever. Schema adds `attempts`, `next_attempt_at`, `notification_dead_letter`, plus a janitor job spec.
5. **`final_status` written empty, never updated.** Two terminal states (`CLOSED`, `VERIFIED`) both leave `final_status=''`. App must set on terminal transitions; schema enforces nothing automatic.
6. **Audit log can be manipulated.** Anyone with Firestore access can alter logs. Triggers + hash chain make this detectable.
7. **Stale assignment reminder is fire-and-forget.** No record once sent. `reminders` table with `escalation_level` + `cancel_reason`.
8. **Permission scope is single-dimension.** Role-only, no row-level scoping (`OWN` vs `DEPARTMENT`). Now in `role_permissions.scope`; app reads it.
9. **Session does not invalidate on password change.** `sessions.invalidated_reason='PASSWORD_CHANGE'` row + app trigger to mark all of user's sessions invalid.
10. **No rotation of session token after privilege change.** Same fix as 9.
11. **`work_paper_requirements.status` had no closeable terminal state with timestamp.** New `date_provided` column.
12. **AI key was usable without per-call accounting.** `ai_invocations` records every call; cost ceiling can be enforced.
13. **Bulk send queue had no reservation.** Two HOAs could both send the same WP. `work_papers.row_version` blocks the second writer.
14. **Board members could see drafts** if filter logic ever broke. Now status-based access checks combine with `role_permissions.scope='ALL'` only over allow-listed enum values; views (`v_open_action_plans`, etc.) make the right scoping easy.
15. **`is_active` string "false"** was truthy. Boolean storage forces 0/1.

---

## 11. Open items / future work

* **Encryption at rest for sensitive columns** (`mfa_secret`, `password_reset_tokens.token_hash` is already a hash, but `mfa_secret` is reversible). Recommend app-layer envelope encryption with a KMS-managed CMK.
* **PII tagging.** Add a column-level annotation system so DSAR exports know which fields to include/redact.
* **Data residency per organisation.** `organizations.data_residency` exists; route Turso replicas accordingly.
* **Immutable WORM storage for backups.** `backup_runs.storage_location` should point at S3 Object Lock or equivalent.
* **External signed log anchors.** `audit_log_anchors.external_proof` should be filled by a notarisation service (KMS sign or blockchain anchor).
* **Sub-area to controls library.** `sub_areas` is currently free text; consider linking to a controls catalogue (COSO, COBIT, ISO 27001).
* **Formalise `deletion_queue` as the only path to physical delete** — application layer should never `DELETE FROM <business_table>` directly.

---

## 12. Migration plan (high level)

1. **V0001 — initial schema** (`db/schema.sql`).
2. **V0002 — data import.** ETL from Firestore export → SQL using prefixed-ID preservation. Backfill `created_at` on action plans (Gap-508). Rewrite `BOARD` → `BOARD_MEMBER` (Gap-501). Coerce `is_active` strings to 0/1 (Gap-502/503). Split CSV `responsible_ids` / `owner_ids` / `cc_recipients` into junction tables. Compute initial `audit_log` hash chain.
3. **V0003 — drop legacy columns** once dual-write window ends (any leftover CSV columns kept temporarily for parity).
4. **V0004 — populate `enum_values`-driven UI** (replace hardcoded dropdown constants in the front-end).
5. **V0005 — switch reads to Turso, writes still dual** for one release.
6. **V0006 — switch writes to Turso primary**; Firestore becomes read-only secondary for one release; then decommission.
