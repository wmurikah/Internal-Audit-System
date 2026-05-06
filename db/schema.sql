-- =============================================================================
-- HASS Internal Audit System — Turso (libSQL / SQLite) Schema
-- =============================================================================
-- Target engine : Turso / libSQL (SQLite 3.45+ dialect)
-- Encoding      : UTF-8
-- Time format   : ISO-8601 UTC strings (TEXT) for cross-language compatibility
-- ID strategy   : Application-generated prefixed IDs (USR-, WP-, AP-, ...)
--                 to preserve Firestore document IDs during migration.
-- Conventions   :
--   * Every mutable row carries created_at, updated_at, created_by, updated_by.
--   * Soft delete uses deleted_at (NULL = active). is_active retained for
--     reference / dropdown rows where soft-delete semantics already exist.
--   * Optimistic concurrency via row_version (monotonic) + updated_at.
--   * Multi-valued fields (owner_ids, responsible_ids) are normalised into
--     junction tables; the legacy CSV columns are kept for migration parity
--     and dropped after cut-over (see V0002).
--   * All enums enforced via CHECK constraints AND a parallel enum_values
--     table so the UI can read allowed values dynamically.
--   * Foreign keys ON; PRAGMA foreign_keys = ON must be set per connection.
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA recursive_triggers = ON;

-- -----------------------------------------------------------------------------
-- 0. SCHEMA / MIGRATION METADATA
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_migrations (
    version         TEXT PRIMARY KEY,           -- e.g. 'V0001__initial'
    applied_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    applied_by      TEXT,
    checksum        TEXT NOT NULL,              -- SHA-256 of migration file
    execution_ms    INTEGER,
    success         INTEGER NOT NULL DEFAULT 1,
    error_message   TEXT
);

-- =============================================================================
-- 1. TENANCY & ORGANISATION
-- =============================================================================
-- Multi-tenant from day one. Single deployment can host multiple legal
-- entities. organization_id is propagated to every business row to enable
-- per-tenant export, backup, deletion (GDPR).

CREATE TABLE organizations (
    organization_id     TEXT PRIMARY KEY,
    org_code            TEXT NOT NULL UNIQUE,
    org_name            TEXT NOT NULL,
    legal_name          TEXT,
    country             TEXT,
    timezone            TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    locale              TEXT NOT NULL DEFAULT 'en-KE',
    fiscal_year_start   TEXT NOT NULL DEFAULT '01-01',  -- MM-DD
    data_residency      TEXT,                            -- region tag for backups
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT
);

CREATE TABLE affiliates (
    affiliate_code      TEXT NOT NULL,
    organization_id     TEXT NOT NULL,
    affiliate_name      TEXT NOT NULL,
    country             TEXT,
    region              TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT,
    PRIMARY KEY (organization_id, affiliate_code),
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);
CREATE INDEX idx_affiliates_active ON affiliates(organization_id, is_active);

CREATE TABLE departments (
    department_id       TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    affiliate_code      TEXT,
    department_code     TEXT NOT NULL,
    department_name     TEXT NOT NULL,
    parent_department   TEXT,                   -- self-reference for hierarchy
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_department) REFERENCES departments(department_id),
    UNIQUE (organization_id, department_code)
);

-- =============================================================================
-- 2. IDENTITY, AUTH & ACCESS CONTROL
-- =============================================================================

-- Roles are first-class so new roles can be added without code changes.
CREATE TABLE roles (
    role_code           TEXT PRIMARY KEY,           -- SUPER_ADMIN, AUDITOR, ...
    role_name           TEXT NOT NULL,
    role_level          INTEGER NOT NULL,           -- numeric precedence
    description         TEXT,
    is_system           INTEGER NOT NULL DEFAULT 0, -- system roles cannot be deleted
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Modules + actions act as the permission alphabet.
CREATE TABLE permission_modules (
    module_code         TEXT PRIMARY KEY,           -- WORK_PAPER, ACTION_PLAN ...
    module_name         TEXT NOT NULL,
    description         TEXT
);

CREATE TABLE permission_actions (
    action_code         TEXT PRIMARY KEY,           -- create, read, update, ...
    action_name         TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_code           TEXT NOT NULL,
    module_code         TEXT NOT NULL,
    action_code         TEXT NOT NULL,
    is_allowed          INTEGER NOT NULL DEFAULT 1,
    field_restrictions  TEXT,                       -- JSON: ["field_a","field_b"] masked
    scope               TEXT NOT NULL DEFAULT 'ALL' -- ALL | OWN | DEPARTMENT | AFFILIATE
                        CHECK (scope IN ('ALL','OWN','DEPARTMENT','AFFILIATE')),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (role_code, module_code, action_code),
    FOREIGN KEY (role_code)   REFERENCES roles(role_code)              ON DELETE CASCADE,
    FOREIGN KEY (module_code) REFERENCES permission_modules(module_code) ON DELETE CASCADE,
    FOREIGN KEY (action_code) REFERENCES permission_actions(action_code) ON DELETE CASCADE
);

CREATE TABLE users (
    user_id             TEXT PRIMARY KEY,           -- USR-XXXXXX
    organization_id     TEXT NOT NULL,
    email               TEXT NOT NULL,              -- normalised (lowercased) at write
    email_verified      INTEGER NOT NULL DEFAULT 0,
    full_name           TEXT NOT NULL,
    first_name          TEXT,
    last_name           TEXT,
    phone               TEXT,
    role_code           TEXT NOT NULL,
    affiliate_code      TEXT,
    department_id       TEXT,

    -- credentials (PBKDF2-SHA256 today; argon2id recommended)
    password_hash       TEXT NOT NULL,
    password_salt       TEXT NOT NULL,
    password_algo       TEXT NOT NULL DEFAULT 'pbkdf2-sha256-1000',
    password_changed_at TEXT,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    password_expires_at TEXT,

    -- MFA / 2FA (Gap-MFA: previously absent)
    mfa_enabled         INTEGER NOT NULL DEFAULT 0,
    mfa_secret          TEXT,                       -- TOTP shared secret (encrypted at app layer)
    mfa_backup_codes    TEXT,                       -- JSON, hashed
    mfa_enrolled_at     TEXT,

    -- account state
    is_active           INTEGER NOT NULL DEFAULT 1,
    locked_until        TEXT,
    login_attempts      INTEGER NOT NULL DEFAULT 0,
    last_login          TEXT,
    last_login_ip       TEXT,
    last_password_reset TEXT,

    -- privacy / compliance
    privacy_consent_accepted INTEGER NOT NULL DEFAULT 0,
    privacy_consent_date     TEXT,
    privacy_consent_version  TEXT,
    data_export_requested_at TEXT,
    data_deletion_requested_at TEXT,

    -- preferences
    timezone            TEXT,
    locale              TEXT,
    notification_preferences TEXT,                  -- JSON

    -- audit metadata
    row_version         INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by          TEXT,
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by          TEXT,
    deleted_at          TEXT,                       -- soft delete (overrides is_active)

    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (role_code)       REFERENCES roles(role_code),
    FOREIGN KEY (department_id)   REFERENCES departments(department_id)
);
CREATE UNIQUE INDEX uq_users_email_org ON users(organization_id, email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role        ON users(organization_id, role_code) WHERE is_active = 1;
CREATE INDEX idx_users_affiliate   ON users(organization_id, affiliate_code) WHERE is_active = 1;
CREATE INDEX idx_users_department  ON users(organization_id, department_id) WHERE is_active = 1;

-- Password history (prevents reuse — Gap-PWREUSE)
CREATE TABLE password_history (
    user_id             TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    password_salt       TEXT NOT NULL,
    password_algo       TEXT NOT NULL,
    changed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    changed_by          TEXT,
    PRIMARY KEY (user_id, changed_at),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Sessions (replaces 20_Sessions)
CREATE TABLE sessions (
    session_id          TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    organization_id     TEXT NOT NULL,
    session_token_hash  TEXT NOT NULL UNIQUE,       -- store HASH, not raw token
    refresh_token_hash  TEXT UNIQUE,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at          TEXT NOT NULL,
    last_activity_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ip_address          TEXT,
    user_agent          TEXT,
    device_fingerprint  TEXT,
    is_valid            INTEGER NOT NULL DEFAULT 1,
    invalidated_at      TEXT,
    invalidated_reason  TEXT,                       -- LOGOUT | EXPIRED | FORCED | PASSWORD_CHANGE
    FOREIGN KEY (user_id)         REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);
CREATE INDEX idx_sessions_user_active ON sessions(user_id) WHERE is_valid = 1;
CREATE INDEX idx_sessions_expiry      ON sessions(expires_at) WHERE is_valid = 1;

-- Login attempts (forensics + lockout, separate from user.login_attempts counter)
CREATE TABLE login_attempts (
    attempt_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email               TEXT NOT NULL,
    user_id             TEXT,                       -- NULL if email not found
    organization_id     TEXT,
    success             INTEGER NOT NULL,
    failure_reason      TEXT,                       -- BAD_PASSWORD | LOCKED | INACTIVE | MFA_FAILED | NO_USER
    ip_address          TEXT,
    user_agent          TEXT,
    attempted_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, attempted_at DESC);
CREATE INDEX idx_login_attempts_ip    ON login_attempts(ip_address, attempted_at DESC);

-- Password reset tokens (single-use, time-bound)
CREATE TABLE password_reset_tokens (
    token_id            TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    token_hash          TEXT NOT NULL UNIQUE,
    expires_at          TEXT NOT NULL,
    used_at             TEXT,
    requested_ip        TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- API keys (for external auditor / integration access)
CREATE TABLE api_keys (
    api_key_id          TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    user_id             TEXT,                       -- NULL = service account
    name                TEXT NOT NULL,
    key_hash            TEXT NOT NULL UNIQUE,
    key_prefix          TEXT NOT NULL,              -- first 8 chars, displayable
    scopes              TEXT,                       -- JSON array
    expires_at          TEXT,
    last_used_at        TEXT,
    last_used_ip        TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    revoked_at          TEXT,
    revoked_by          TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by          TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (user_id)         REFERENCES users(user_id)
);

-- Rate limiting (Gap-RATELIMIT)
CREATE TABLE rate_limit_buckets (
    bucket_key          TEXT PRIMARY KEY,           -- e.g. ip:1.2.3.4 / user:USR-001
    bucket_type         TEXT NOT NULL,              -- IP | USER | API_KEY | EMAIL
    counter             INTEGER NOT NULL DEFAULT 0,
    window_start        TEXT NOT NULL,
    window_size_seconds INTEGER NOT NULL,
    blocked_until       TEXT
);

-- IP allow / deny list (Gap-IPLIST)
CREATE TABLE ip_access_rules (
    rule_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id     TEXT,                       -- NULL = global
    cidr                TEXT NOT NULL,
    rule_type           TEXT NOT NULL CHECK (rule_type IN ('ALLOW','DENY')),
    description         TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    expires_at          TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by          TEXT
);

-- =============================================================================
-- 3. REFERENCE / LOOKUP DATA
-- =============================================================================

CREATE TABLE audit_areas (
    area_id             TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    area_code           TEXT NOT NULL,
    area_name           TEXT NOT NULL,
    description         TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
    UNIQUE (organization_id, area_code)
);

CREATE TABLE sub_areas (
    sub_area_id         TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    area_id             TEXT NOT NULL,
    sub_area_code       TEXT,
    sub_area_name       TEXT NOT NULL,
    control_objectives  TEXT,
    risk_description    TEXT,
    test_objective      TEXT,
    testing_steps       TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1,
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
    FOREIGN KEY (area_id)         REFERENCES audit_areas(area_id)
);
CREATE INDEX idx_sub_areas_area ON sub_areas(area_id) WHERE is_active = 1;

-- Generic enum store. Lets the UI render dropdowns dynamically AND the
-- database enforce values via CHECK + trigger. Replaces hardcoded ROLES,
-- STATUS.WORK_PAPER, STATUS.ACTION_PLAN, RISK_RATING, control_classification,
-- control_type, control_frequency, etc. (closes Gap-101..104)
CREATE TABLE enum_values (
    enum_type           TEXT NOT NULL,              -- WP_STATUS | AP_STATUS | RISK_RATING | CONTROL_TYPE ...
    enum_value          TEXT NOT NULL,
    display_label       TEXT NOT NULL,
    display_order       INTEGER NOT NULL DEFAULT 0,
    color_hex           TEXT,
    is_terminal         INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    metadata            TEXT,                       -- JSON (e.g. {"icon":"check"})
    PRIMARY KEY (enum_type, enum_value)
);

-- Status transition matrix — encodes the legal lifecycle in data.
CREATE TABLE status_transitions (
    enum_type           TEXT NOT NULL,
    from_status         TEXT NOT NULL,
    to_status           TEXT NOT NULL,
    required_role       TEXT,                       -- minimum role allowed
    requires_comment    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (enum_type, from_status, to_status),
    FOREIGN KEY (enum_type, from_status) REFERENCES enum_values(enum_type, enum_value),
    FOREIGN KEY (enum_type, to_status)   REFERENCES enum_values(enum_type, enum_value)
);

-- =============================================================================
-- 4. WORK PAPERS
-- =============================================================================

CREATE TABLE work_papers (
    work_paper_id           TEXT PRIMARY KEY,        -- WP-XXXXX
    organization_id         TEXT NOT NULL,
    work_paper_ref          TEXT NOT NULL,
    year                    INTEGER NOT NULL,
    affiliate_code          TEXT NOT NULL,
    audit_area_id           TEXT NOT NULL,
    sub_area_id             TEXT,
    work_paper_date         TEXT,
    audit_period_from       TEXT,
    audit_period_to         TEXT,

    -- Control framework (Gap-101..104 — now in schema; UI must add inputs)
    control_objectives      TEXT,
    control_classification  TEXT,                    -- enum CONTROL_CLASSIFICATION
    control_type            TEXT,                    -- enum CONTROL_TYPE
    control_frequency       TEXT,                    -- enum CONTROL_FREQUENCY
    control_standards       TEXT,

    -- Risk assessment
    risk_description        TEXT,
    test_objective          TEXT,
    testing_steps           TEXT,

    -- Observation / finding
    observation_title       TEXT NOT NULL,
    observation_description TEXT NOT NULL,
    risk_rating             TEXT NOT NULL,           -- enum RISK_RATING
    risk_summary            TEXT,
    recommendation          TEXT NOT NULL,

    -- Auditee response (latest snapshot — full history in auditee_responses)
    management_response     TEXT,
    response_status         TEXT,                    -- enum RESPONSE_STATUS
    response_deadline       TEXT,
    response_round          INTEGER NOT NULL DEFAULT 0,
    response_submitted_by   TEXT,
    response_submitted_date TEXT,
    response_reviewed_by    TEXT,
    response_review_date    TEXT,
    response_review_comments TEXT,

    -- Workflow status
    status                  TEXT NOT NULL,           -- enum WP_STATUS
    final_status            TEXT,
    revision_count          INTEGER NOT NULL DEFAULT 0,

    -- People (denormalised names kept for fast list rendering — Gap-105 fixed)
    assigned_auditor_id     TEXT,
    assigned_auditor_name   TEXT,
    prepared_by_id          TEXT NOT NULL,
    prepared_by_name        TEXT,
    prepared_date           TEXT,
    submitted_date          TEXT,
    reviewed_by_id          TEXT,
    reviewed_by_name        TEXT,
    review_date             TEXT,
    review_comments         TEXT,
    approved_by_id          TEXT,
    approved_by_name        TEXT,
    approved_date           TEXT,
    sent_to_auditee_date    TEXT,

    -- Misc
    evidence_override       TEXT,

    -- audit metadata
    row_version             INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by              TEXT NOT NULL,
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by              TEXT,
    deleted_at              TEXT,
    deleted_by              TEXT,

    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (organization_id, affiliate_code) REFERENCES affiliates(organization_id, affiliate_code),
    FOREIGN KEY (audit_area_id)   REFERENCES audit_areas(area_id),
    FOREIGN KEY (sub_area_id)     REFERENCES sub_areas(sub_area_id),
    FOREIGN KEY (prepared_by_id)  REFERENCES users(user_id),
    FOREIGN KEY (assigned_auditor_id) REFERENCES users(user_id)
);
CREATE INDEX idx_wp_status         ON work_papers(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_wp_affiliate      ON work_papers(organization_id, affiliate_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_wp_area           ON work_papers(audit_area_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_wp_year           ON work_papers(organization_id, year);
CREATE INDEX idx_wp_prepared_by    ON work_papers(prepared_by_id);
CREATE INDEX idx_wp_assigned       ON work_papers(assigned_auditor_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_wp_response_state ON work_papers(response_status, response_deadline);

-- Junction: who is responsible (replaces CSV responsible_ids — Gap-CSV)
CREATE TABLE work_paper_responsibles (
    work_paper_id       TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    role_in_finding     TEXT,                       -- e.g. PRIMARY | SUPPORT
    added_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    added_by            TEXT,
    PRIMARY KEY (work_paper_id, user_id),
    FOREIGN KEY (work_paper_id) REFERENCES work_papers(work_paper_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)       REFERENCES users(user_id)
);
CREATE INDEX idx_wp_resp_user ON work_paper_responsibles(user_id);

-- Junction: CC recipients (replaces newline/comma CSV — Gap-109)
CREATE TABLE work_paper_cc_recipients (
    work_paper_id       TEXT NOT NULL,
    email               TEXT NOT NULL,
    user_id             TEXT,                       -- nullable: external addresses allowed
    added_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (work_paper_id, email),
    FOREIGN KEY (work_paper_id) REFERENCES work_papers(work_paper_id) ON DELETE CASCADE
);

CREATE TABLE work_paper_requirements (
    requirement_id      TEXT PRIMARY KEY,
    work_paper_id       TEXT NOT NULL,
    requirement_number  INTEGER,
    requirement_description TEXT NOT NULL,
    date_requested      TEXT,
    date_provided       TEXT,
    status              TEXT NOT NULL DEFAULT 'Pending', -- enum REQUIREMENT_STATUS
    notes               TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by          TEXT,
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by          TEXT,
    FOREIGN KEY (work_paper_id) REFERENCES work_papers(work_paper_id) ON DELETE CASCADE
);
CREATE INDEX idx_req_wp ON work_paper_requirements(work_paper_id);

-- Revisions / change log specific to a work paper
CREATE TABLE work_paper_revisions (
    revision_id         TEXT PRIMARY KEY,
    work_paper_id       TEXT NOT NULL,
    revision_number     INTEGER NOT NULL,
    action              TEXT NOT NULL,              -- CREATE | EDIT | SUBMIT | RETURN | APPROVE | SEND
    from_status         TEXT,
    to_status           TEXT,
    comments            TEXT,
    changes_summary     TEXT,                       -- JSON diff
    user_id             TEXT NOT NULL,
    user_name           TEXT,
    action_date         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (work_paper_id) REFERENCES work_papers(work_paper_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)       REFERENCES users(user_id),
    UNIQUE (work_paper_id, revision_number)
);
CREATE INDEX idx_wp_rev_wp ON work_paper_revisions(work_paper_id, action_date DESC);

-- =============================================================================
-- 5. AUDITEE RESPONSE ROUNDS
-- =============================================================================

CREATE TABLE auditee_responses (
    response_id         TEXT PRIMARY KEY,
    work_paper_id       TEXT NOT NULL,
    round_number        INTEGER NOT NULL,           -- 1..MAX_ROUNDS
    response_type       TEXT,                       -- INITIAL | REVISED | ESCALATED
    management_response TEXT,
    status              TEXT NOT NULL,              -- enum RESPONSE_STATUS

    submitted_by_id     TEXT,
    submitted_by_name   TEXT,
    submitted_date      TEXT,

    reviewed_by_id      TEXT,
    reviewed_by_name    TEXT,
    review_date         TEXT,
    review_comments     TEXT,
    review_action       TEXT,                       -- ACCEPTED | REJECTED | ESCALATED

    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

    FOREIGN KEY (work_paper_id)    REFERENCES work_papers(work_paper_id) ON DELETE CASCADE,
    FOREIGN KEY (submitted_by_id)  REFERENCES users(user_id),
    FOREIGN KEY (reviewed_by_id)   REFERENCES users(user_id),
    UNIQUE (work_paper_id, round_number)
);
CREATE INDEX idx_response_wp ON auditee_responses(work_paper_id);

-- =============================================================================
-- 6. ACTION PLANS
-- =============================================================================

CREATE TABLE action_plans (
    action_plan_id      TEXT PRIMARY KEY,            -- AP-XXXXX
    organization_id     TEXT NOT NULL,
    work_paper_id       TEXT NOT NULL,
    response_id         TEXT,                        -- AP born from a specific response round
    action_number       INTEGER,
    action_description  TEXT NOT NULL,

    -- Denormalised scope (Gap-507 — added audit_area_id; Gap-506 — affiliate_code, not affiliate_id)
    affiliate_code      TEXT,
    audit_area_id       TEXT,
    year                INTEGER,

    due_date            TEXT NOT NULL,
    days_overdue        INTEGER NOT NULL DEFAULT 0,

    status              TEXT NOT NULL,               -- enum AP_STATUS
    final_status        TEXT,

    -- Implementation
    implementation_notes TEXT,
    implemented_date    TEXT,
    implemented_by      TEXT,                        -- now in schema (Gap-401)

    -- Auditor verification
    auditor_review_status   TEXT,                    -- now in schema (Gap-401)
    auditor_review_by       TEXT,
    auditor_review_date     TEXT,
    auditor_review_comments TEXT,
    verified_date           TEXT,                    -- now in schema (Gap-401)
    verified_by             TEXT,

    -- HOA final review
    hoa_review_status       TEXT,                    -- now in schema (Gap-401)
    hoa_review_by           TEXT,
    hoa_review_date         TEXT,
    hoa_review_comments     TEXT,

    -- Delegation (full set in schema — Gap-402)
    delegated_by_id         TEXT,
    delegated_by_name       TEXT,
    delegated_date          TEXT,
    delegation_notes        TEXT,
    delegation_accepted     INTEGER,
    delegation_accepted_date TEXT,
    delegation_rejected     INTEGER,
    delegation_reject_reason TEXT,
    delegation_rejected_by  TEXT,
    delegation_rejected_date TEXT,

    -- Provenance
    auditee_proposed        INTEGER NOT NULL DEFAULT 0,
    created_by_role         TEXT,

    -- audit metadata
    row_version             INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by              TEXT NOT NULL,
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by              TEXT,
    deleted_at              TEXT,
    deleted_by              TEXT,

    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (work_paper_id)   REFERENCES work_papers(work_paper_id) ON DELETE CASCADE,
    FOREIGN KEY (response_id)     REFERENCES auditee_responses(response_id),
    FOREIGN KEY (audit_area_id)   REFERENCES audit_areas(area_id),
    FOREIGN KEY (organization_id, affiliate_code) REFERENCES affiliates(organization_id, affiliate_code),
    FOREIGN KEY (created_by)      REFERENCES users(user_id)
);
CREATE INDEX idx_ap_status      ON action_plans(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_ap_due         ON action_plans(due_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_ap_wp          ON action_plans(work_paper_id);
CREATE INDEX idx_ap_affiliate   ON action_plans(organization_id, affiliate_code);
CREATE INDEX idx_ap_area        ON action_plans(audit_area_id);
CREATE INDEX idx_ap_created_by  ON action_plans(created_by);

-- Owners (replaces CSV owner_ids — Gap-CSV; preserves original list for delegation undo)
CREATE TABLE action_plan_owners (
    action_plan_id      TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    is_original         INTEGER NOT NULL DEFAULT 1,  -- 1 = before any delegation
    is_current          INTEGER NOT NULL DEFAULT 1,  -- 1 = currently responsible
    added_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    added_by            TEXT,
    removed_at          TEXT,
    removed_by          TEXT,
    PRIMARY KEY (action_plan_id, user_id, added_at),
    FOREIGN KEY (action_plan_id) REFERENCES action_plans(action_plan_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)        REFERENCES users(user_id)
);
CREATE INDEX idx_ap_own_user    ON action_plan_owners(user_id) WHERE is_current = 1;
CREATE INDEX idx_ap_own_current ON action_plan_owners(action_plan_id) WHERE is_current = 1;

-- Action plan status / event history (mirror of work_paper_revisions, AP-side)
CREATE TABLE action_plan_history (
    history_id          TEXT PRIMARY KEY,
    action_plan_id      TEXT NOT NULL,
    event_type          TEXT NOT NULL,              -- STATUS_CHANGE | DELEGATION | EVIDENCE_ADDED | COMMENT ...
    previous_status     TEXT,
    new_status          TEXT,
    comments            TEXT,
    metadata            TEXT,                       -- JSON
    user_id             TEXT NOT NULL,
    user_name           TEXT,
    changed_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (action_plan_id) REFERENCES action_plans(action_plan_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)        REFERENCES users(user_id)
);
CREATE INDEX idx_ap_hist ON action_plan_history(action_plan_id, changed_at DESC);

-- =============================================================================
-- 7. FILES & EVIDENCE (unified — replaces 11_WorkPaperFiles + 14_ActionPlanEvidence)
-- =============================================================================

CREATE TABLE files (
    file_id             TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    storage_provider    TEXT NOT NULL DEFAULT 'gdrive', -- gdrive | s3 | r2 | turso_blob
    storage_id          TEXT NOT NULL,              -- drive_file_id / S3 key / etc
    storage_url         TEXT,
    file_name           TEXT NOT NULL,
    file_description    TEXT,
    file_size           INTEGER,
    mime_type           TEXT,
    checksum_sha256     TEXT,                       -- integrity verification
    is_encrypted        INTEGER NOT NULL DEFAULT 0,
    uploaded_by         TEXT NOT NULL,
    uploaded_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at          TEXT,
    deleted_by          TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (uploaded_by)     REFERENCES users(user_id)
);
CREATE INDEX idx_files_storage ON files(storage_id);

-- Polymorphic attachment table; one file may attach to many entities.
CREATE TABLE file_attachments (
    attachment_id       TEXT PRIMARY KEY,
    file_id             TEXT NOT NULL,
    entity_type         TEXT NOT NULL,              -- WORK_PAPER | ACTION_PLAN | RESPONSE | REQUIREMENT
    entity_id           TEXT NOT NULL,
    file_category       TEXT,                       -- Evidence | Supporting | Correspondence | Other
    attached_by         TEXT NOT NULL,
    attached_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
);
CREATE INDEX idx_attach_entity ON file_attachments(entity_type, entity_id);
CREATE INDEX idx_attach_file   ON file_attachments(file_id);

-- =============================================================================
-- 8. NOTIFICATIONS
-- =============================================================================

CREATE TABLE email_templates (
    template_code       TEXT PRIMARY KEY,           -- WP_ASSIGNMENT, ...
    organization_id     TEXT,                       -- NULL = global default
    template_name       TEXT NOT NULL,
    subject_template    TEXT NOT NULL,
    body_template       TEXT NOT NULL,              -- HTML, supports {{token}}
    body_template_text  TEXT,                       -- plaintext fallback
    locale              TEXT NOT NULL DEFAULT 'en',
    is_active           INTEGER NOT NULL DEFAULT 1,
    version             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by          TEXT
);

CREATE TABLE notification_queue (
    notification_id     TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    batch_type          TEXT NOT NULL,              -- WP_ASSIGNMENT, AP_DELEGATED ...
    template_code       TEXT,
    priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent','normal','low')),
    channel             TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','in_app','webhook')),

    recipient_user_id   TEXT,
    recipient_email     TEXT NOT NULL,
    recipient_name      TEXT,
    cc_of_user_id       TEXT,                       -- if this is a CC copy
    is_cc               INTEGER NOT NULL DEFAULT 0,

    related_entity_type TEXT,
    related_entity_id   TEXT,

    payload             TEXT NOT NULL,              -- JSON template variables
    rendered_subject    TEXT,
    rendered_body       TEXT,

    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sending','sent','failed','cancelled','dead_letter')),
    attempts            INTEGER NOT NULL DEFAULT 0,
    max_attempts        INTEGER NOT NULL DEFAULT 5,
    next_attempt_at     TEXT,
    last_error          TEXT,

    scheduled_for       TEXT,                       -- delayed send / digest
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    sent_at             TEXT,
    failed_at           TEXT,

    FOREIGN KEY (organization_id)   REFERENCES organizations(organization_id),
    FOREIGN KEY (recipient_user_id) REFERENCES users(user_id),
    FOREIGN KEY (template_code)     REFERENCES email_templates(template_code)
);
CREATE INDEX idx_nq_status_prio ON notification_queue(status, priority, scheduled_for);
CREATE INDEX idx_nq_recipient   ON notification_queue(recipient_user_id, created_at DESC);
CREATE INDEX idx_nq_entity      ON notification_queue(related_entity_type, related_entity_id);

-- Dead-letter queue for permanently-failed notifications
CREATE TABLE notification_dead_letter (
    notification_id     TEXT PRIMARY KEY,
    original_queue_data TEXT NOT NULL,              -- JSON snapshot
    last_error          TEXT,
    failed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    requeued_at         TEXT,
    requeued_by         TEXT
);

-- In-app notifications (read state)
CREATE TABLE in_app_notifications (
    in_app_id           TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL,
    title               TEXT NOT NULL,
    body                TEXT,
    severity            TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','success','warning','error')),
    related_entity_type TEXT,
    related_entity_id   TEXT,
    deep_link           TEXT,
    read_at             TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at          TEXT,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX idx_inapp_user_unread ON in_app_notifications(user_id, created_at DESC) WHERE read_at IS NULL;

-- Webhook subscriptions (Gap-WEBHOOK)
CREATE TABLE webhook_endpoints (
    endpoint_id         TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    name                TEXT NOT NULL,
    target_url          TEXT NOT NULL,
    secret              TEXT NOT NULL,              -- HMAC secret
    event_filter        TEXT NOT NULL,              -- JSON array of event types
    is_active           INTEGER NOT NULL DEFAULT 1,
    last_success_at     TEXT,
    last_failure_at     TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    created_by          TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);

-- =============================================================================
-- 9. AUDIT LOG (immutable, security-critical)
-- =============================================================================

-- Append-only. No UPDATE / DELETE — enforced by triggers.
CREATE TABLE audit_log (
    log_id              TEXT PRIMARY KEY,
    organization_id     TEXT,
    occurred_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),

    actor_user_id       TEXT,
    actor_email         TEXT,
    actor_role          TEXT,
    actor_ip            TEXT,
    actor_user_agent    TEXT,
    session_id          TEXT,
    api_key_id          TEXT,

    action              TEXT NOT NULL,              -- CREATE | UPDATE | DELETE | LOGIN | LOGOUT | EXPORT | ...
    entity_type         TEXT NOT NULL,              -- WORK_PAPER | ACTION_PLAN | USER | CONFIG | SESSION ...
    entity_id           TEXT,

    old_data            TEXT,                       -- JSON
    new_data            TEXT,                       -- JSON
    diff                TEXT,                       -- JSON Patch
    severity            TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
    success             INTEGER NOT NULL DEFAULT 1,
    error_message       TEXT,
    correlation_id      TEXT,                       -- ties together multi-step ops

    -- Tamper-evidence: each log row chains its hash to the previous.
    prev_hash           TEXT,
    row_hash            TEXT NOT NULL,              -- SHA-256(log_id||occurred_at||actor||action||entity||prev_hash)

    FOREIGN KEY (actor_user_id) REFERENCES users(user_id)
);
CREATE INDEX idx_audit_entity   ON audit_log(entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_actor    ON audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_time     ON audit_log(occurred_at DESC);
CREATE INDEX idx_audit_org_time ON audit_log(organization_id, occurred_at DESC);
CREATE INDEX idx_audit_severity ON audit_log(severity, occurred_at DESC);

-- Block UPDATE / DELETE on audit_log (immutability).
CREATE TRIGGER trg_audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER trg_audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

-- Periodic hash anchors — to detect bulk tampering. App writes anchor
-- regularly; external attestation (e.g. blockchain or signed manifest) optional.
CREATE TABLE audit_log_anchors (
    anchor_id           INTEGER PRIMARY KEY AUTOINCREMENT,
    last_log_id         TEXT NOT NULL,
    log_count           INTEGER NOT NULL,
    cumulative_hash     TEXT NOT NULL,
    anchored_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    external_proof      TEXT                        -- e.g. signed receipt, txid
);

-- Security events with elevated visibility (separate sink for SIEM)
CREATE TABLE security_events (
    event_id            TEXT PRIMARY KEY,
    occurred_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    event_type          TEXT NOT NULL,              -- LOGIN_FAIL | LOCKOUT | PRIV_ESCALATION | DATA_EXPORT | MFA_RESET
    severity            TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
    user_id             TEXT,
    actor_email         TEXT,
    ip_address          TEXT,
    details             TEXT,                       -- JSON
    resolved_at         TEXT,
    resolved_by         TEXT
);
CREATE INDEX idx_sec_evt_type ON security_events(event_type, occurred_at DESC);
CREATE INDEX idx_sec_evt_user ON security_events(user_id, occurred_at DESC);

-- =============================================================================
-- 10. CONFIGURATION & FEATURE FLAGS
-- =============================================================================

CREATE TABLE config (
    config_key          TEXT NOT NULL,
    organization_id     TEXT NOT NULL DEFAULT 'GLOBAL',
    config_value        TEXT,
    value_type          TEXT NOT NULL DEFAULT 'string'
                        CHECK (value_type IN ('string','integer','boolean','json','secret')),
    is_secret           INTEGER NOT NULL DEFAULT 0,  -- masked in UI / audit log
    description         TEXT,
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by          TEXT,
    PRIMARY KEY (organization_id, config_key)
);

CREATE TABLE feature_flags (
    flag_key            TEXT PRIMARY KEY,
    description         TEXT,
    is_enabled          INTEGER NOT NULL DEFAULT 0,
    rollout_percentage  INTEGER NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100),
    targeting_rules     TEXT,                       -- JSON
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_by          TEXT
);

-- AI provider config / usage metering
CREATE TABLE ai_providers (
    provider_code       TEXT PRIMARY KEY,           -- openai | anthropic | google_ai
    display_name        TEXT NOT NULL,
    api_key_secret_ref  TEXT,                       -- pointer to secret store (NOT the key)
    default_model       TEXT,
    is_enabled          INTEGER NOT NULL DEFAULT 0,
    cost_per_1k_input   REAL,
    cost_per_1k_output  REAL,
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE ai_invocations (
    invocation_id       TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    user_id             TEXT,
    provider_code       TEXT NOT NULL,
    model               TEXT,
    purpose             TEXT,                       -- e.g. WP_INSIGHT | RECOMMENDATION
    related_entity_type TEXT,
    related_entity_id   TEXT,
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    total_tokens        INTEGER,
    cost_usd            REAL,
    latency_ms          INTEGER,
    success             INTEGER NOT NULL DEFAULT 1,
    error_message       TEXT,
    request_payload     TEXT,                       -- JSON; redact PII
    response_payload    TEXT,                       -- JSON; redact PII
    occurred_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (provider_code) REFERENCES ai_providers(provider_code),
    FOREIGN KEY (user_id)       REFERENCES users(user_id)
);
CREATE INDEX idx_ai_inv_user ON ai_invocations(user_id, occurred_at DESC);
CREATE INDEX idx_ai_inv_org  ON ai_invocations(organization_id, occurred_at DESC);

-- =============================================================================
-- 11. SCHEDULED JOBS, REMINDERS, BACKGROUND TRIGGERS
-- =============================================================================

CREATE TABLE scheduled_jobs (
    job_id              TEXT PRIMARY KEY,
    job_name            TEXT NOT NULL,              -- update_overdue | send_digest | rotate_backup
    cron_expression     TEXT,                       -- standard cron
    is_enabled          INTEGER NOT NULL DEFAULT 1,
    last_run_at         TEXT,
    last_run_status     TEXT,                       -- success | failed | running
    last_run_duration_ms INTEGER,
    last_error          TEXT,
    next_run_at         TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Reminders: stale assignments, overdue APs, response deadlines.
CREATE TABLE reminders (
    reminder_id         TEXT PRIMARY KEY,
    reminder_type       TEXT NOT NULL,              -- STALE_WP | OVERDUE_AP | RESPONSE_DEADLINE
    related_entity_type TEXT NOT NULL,
    related_entity_id   TEXT NOT NULL,
    target_user_id      TEXT NOT NULL,
    scheduled_for       TEXT NOT NULL,
    sent_at             TEXT,
    cancelled_at        TEXT,
    cancel_reason       TEXT,
    escalation_level    INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (target_user_id) REFERENCES users(user_id)
);
CREATE INDEX idx_rem_due ON reminders(scheduled_for) WHERE sent_at IS NULL AND cancelled_at IS NULL;

-- Distributed lock (Gap-RACE on updateOverdueStatuses & batch jobs)
CREATE TABLE job_locks (
    lock_key            TEXT PRIMARY KEY,
    holder              TEXT NOT NULL,
    acquired_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at          TEXT NOT NULL,
    metadata            TEXT
);

-- =============================================================================
-- 12. BACKUP & RESTORE
-- =============================================================================
-- Turso supports point-in-time restore + replicas. These tables track
-- application-managed exports and validation runs.

CREATE TABLE backup_runs (
    backup_id           TEXT PRIMARY KEY,
    backup_type         TEXT NOT NULL CHECK (backup_type IN ('FULL','INCREMENTAL','LOGICAL_EXPORT','PITR_SNAPSHOT')),
    organization_id     TEXT,                       -- NULL = system-wide
    started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at        TEXT,
    status              TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','success','failed','partial')),
    storage_location    TEXT,                       -- s3://… | r2://…
    size_bytes          INTEGER,
    checksum_sha256     TEXT,
    encryption_key_ref  TEXT,                       -- KMS key reference, never the key itself
    row_counts          TEXT,                       -- JSON {"work_papers":1234,...}
    error_message       TEXT,
    triggered_by        TEXT,                       -- user_id or 'cron'
    retention_until     TEXT,                       -- when this backup should be purged
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)
);
CREATE INDEX idx_backup_status ON backup_runs(status, started_at DESC);

CREATE TABLE restore_runs (
    restore_id          TEXT PRIMARY KEY,
    backup_id           TEXT NOT NULL,
    target              TEXT NOT NULL,              -- staging | production | sandbox
    started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at        TEXT,
    status              TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','success','failed','rolled_back')),
    requested_by        TEXT NOT NULL,
    approved_by         TEXT,                       -- four-eyes for prod restore
    rows_restored       INTEGER,
    verification_status TEXT,                       -- checksum_ok | checksum_mismatch | not_run
    error_message       TEXT,
    notes               TEXT,
    FOREIGN KEY (backup_id) REFERENCES backup_runs(backup_id)
);

-- Soft-delete recovery window. Rows logically deleted (deleted_at != NULL)
-- can be re-emerged within retention; this table queues hard-delete jobs.
CREATE TABLE deletion_queue (
    queue_id            TEXT PRIMARY KEY,
    entity_type         TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    soft_deleted_at     TEXT NOT NULL,
    hard_delete_after   TEXT NOT NULL,              -- soft_deleted_at + retention
    reason              TEXT,                       -- USER_REQUEST | RETENTION | GDPR
    requested_by        TEXT,
    processed_at        TEXT,
    UNIQUE (entity_type, entity_id)
);
CREATE INDEX idx_del_q_due ON deletion_queue(hard_delete_after) WHERE processed_at IS NULL;

-- Data retention policies per entity (referenced by janitor jobs)
CREATE TABLE retention_policies (
    policy_id           TEXT PRIMARY KEY,
    entity_type         TEXT NOT NULL,              -- AUDIT_LOG | NOTIFICATION_QUEUE | SESSION ...
    retention_days      INTEGER NOT NULL,
    archive_target      TEXT,                       -- cold-storage location
    last_run_at         TEXT,
    rows_pruned         INTEGER NOT NULL DEFAULT 0,
    is_active           INTEGER NOT NULL DEFAULT 1,
    legal_hold          INTEGER NOT NULL DEFAULT 0,
    description         TEXT
);

-- Legal hold overrides — pauses retention deletion when there is litigation
CREATE TABLE legal_holds (
    hold_id             TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT,
    entity_filter       TEXT,                       -- JSON criteria
    placed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    placed_by           TEXT NOT NULL,
    released_at         TEXT,
    released_by         TEXT
);

-- =============================================================================
-- 13. DASHBOARDS, REPORTS, ANALYTICS, EXPORTS
-- =============================================================================

CREATE TABLE saved_reports (
    report_id           TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    owner_user_id       TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT,
    report_type         TEXT NOT NULL,              -- BOARD | ANALYTICS | CUSTOM
    query_definition    TEXT NOT NULL,              -- JSON
    schedule_cron       TEXT,
    last_generated_at   TEXT,
    is_shared           INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (organization_id) REFERENCES organizations(organization_id),
    FOREIGN KEY (owner_user_id)   REFERENCES users(user_id)
);

CREATE TABLE export_jobs (
    export_id           TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    requested_by        TEXT NOT NULL,
    export_type         TEXT NOT NULL,              -- WP | AP | BOARD_REPORT | DSAR
    format              TEXT NOT NULL,              -- xlsx | csv | pdf | docx | json
    filters             TEXT,                       -- JSON
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','success','failed','expired')),
    file_id             TEXT,                       -- the produced file
    row_count           INTEGER,
    requested_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    completed_at        TEXT,
    expires_at          TEXT,
    error_message       TEXT,
    FOREIGN KEY (file_id) REFERENCES files(file_id)
);

-- Materialized aggregates refreshed by scheduled job (replaces in-memory dashboard math)
CREATE TABLE dashboard_snapshots (
    snapshot_id         TEXT PRIMARY KEY,
    organization_id     TEXT NOT NULL,
    snapshot_type       TEXT NOT NULL,              -- DAILY_SUMMARY | WEEKLY_TREND
    snapshot_date       TEXT NOT NULL,
    metrics             TEXT NOT NULL,              -- JSON
    generated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (organization_id, snapshot_type, snapshot_date)
);

-- =============================================================================
-- 14. FULL-TEXT SEARCH (FTS5)
-- =============================================================================

CREATE VIRTUAL TABLE work_papers_fts USING fts5(
    work_paper_id UNINDEXED,
    observation_title,
    observation_description,
    risk_summary,
    recommendation,
    management_response,
    content=''
);

CREATE VIRTUAL TABLE action_plans_fts USING fts5(
    action_plan_id UNINDEXED,
    action_description,
    implementation_notes,
    content=''
);

-- Triggers to keep FTS in sync
CREATE TRIGGER trg_wp_fts_ai AFTER INSERT ON work_papers BEGIN
    INSERT INTO work_papers_fts(work_paper_id, observation_title, observation_description,
        risk_summary, recommendation, management_response)
    VALUES (NEW.work_paper_id, NEW.observation_title, NEW.observation_description,
        NEW.risk_summary, NEW.recommendation, NEW.management_response);
END;
CREATE TRIGGER trg_wp_fts_au AFTER UPDATE ON work_papers BEGIN
    DELETE FROM work_papers_fts WHERE work_paper_id = OLD.work_paper_id;
    INSERT INTO work_papers_fts(work_paper_id, observation_title, observation_description,
        risk_summary, recommendation, management_response)
    VALUES (NEW.work_paper_id, NEW.observation_title, NEW.observation_description,
        NEW.risk_summary, NEW.recommendation, NEW.management_response);
END;
CREATE TRIGGER trg_wp_fts_ad AFTER DELETE ON work_papers BEGIN
    DELETE FROM work_papers_fts WHERE work_paper_id = OLD.work_paper_id;
END;

CREATE TRIGGER trg_ap_fts_ai AFTER INSERT ON action_plans BEGIN
    INSERT INTO action_plans_fts(action_plan_id, action_description, implementation_notes)
    VALUES (NEW.action_plan_id, NEW.action_description, NEW.implementation_notes);
END;
CREATE TRIGGER trg_ap_fts_au AFTER UPDATE ON action_plans BEGIN
    DELETE FROM action_plans_fts WHERE action_plan_id = OLD.action_plan_id;
    INSERT INTO action_plans_fts(action_plan_id, action_description, implementation_notes)
    VALUES (NEW.action_plan_id, NEW.action_description, NEW.implementation_notes);
END;
CREATE TRIGGER trg_ap_fts_ad AFTER DELETE ON action_plans BEGIN
    DELETE FROM action_plans_fts WHERE action_plan_id = OLD.action_plan_id;
END;

-- =============================================================================
-- 15. AUTO-MAINTENANCE TRIGGERS (updated_at, row_version)
-- =============================================================================

CREATE TRIGGER trg_users_touch
AFTER UPDATE ON users
FOR EACH ROW WHEN OLD.row_version = NEW.row_version
BEGIN
    UPDATE users
       SET updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           row_version = OLD.row_version + 1
     WHERE user_id = NEW.user_id;
END;

CREATE TRIGGER trg_wp_touch
AFTER UPDATE ON work_papers
FOR EACH ROW WHEN OLD.row_version = NEW.row_version
BEGIN
    UPDATE work_papers
       SET updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           row_version = OLD.row_version + 1
     WHERE work_paper_id = NEW.work_paper_id;
END;

CREATE TRIGGER trg_ap_touch
AFTER UPDATE ON action_plans
FOR EACH ROW WHEN OLD.row_version = NEW.row_version
BEGIN
    UPDATE action_plans
       SET updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           row_version = OLD.row_version + 1
     WHERE action_plan_id = NEW.action_plan_id;
END;

-- =============================================================================
-- 16. CONVENIENCE VIEWS
-- =============================================================================

CREATE VIEW v_active_users AS
SELECT * FROM users WHERE deleted_at IS NULL AND is_active = 1;

CREATE VIEW v_open_action_plans AS
SELECT ap.*, wp.observation_title, wp.affiliate_code AS wp_affiliate_code
  FROM action_plans ap
  JOIN work_papers  wp ON wp.work_paper_id = ap.work_paper_id
 WHERE ap.deleted_at IS NULL
   AND ap.status NOT IN ('VERIFIED','CLOSED','NOT_IMPLEMENTED','REJECTED');

CREATE VIEW v_overdue_action_plans AS
SELECT *
  FROM v_open_action_plans
 WHERE due_date < strftime('%Y-%m-%dT%H:%M:%fZ','now');

CREATE VIEW v_work_papers_pending_response AS
SELECT *
  FROM work_papers
 WHERE deleted_at IS NULL
   AND status = 'SENT_TO_AUDITEE'
   AND response_status IN ('Pending Response','Draft Response');

-- Per-user "My Findings" — drives the auditee portal
CREATE VIEW v_user_findings AS
SELECT wpr.user_id, wp.*
  FROM work_paper_responsibles wpr
  JOIN work_papers wp ON wp.work_paper_id = wpr.work_paper_id
 WHERE wp.deleted_at IS NULL
   AND wp.status IN ('SENT_TO_AUDITEE','APPROVED');

-- =============================================================================
-- 17. SEED — system roles, modules, actions, default enums
-- =============================================================================

INSERT INTO roles (role_code, role_name, role_level, is_system) VALUES
    ('SUPER_ADMIN',    'System Owner',           100, 1),
    ('SENIOR_AUDITOR', 'Senior Auditor (HOA)',    80, 1),
    ('AUDITOR',        'Auditor',                 60, 1),
    ('JUNIOR_STAFF',   'Auditee (Junior Staff)',  20, 1),
    ('UNIT_MANAGER',   'Unit Manager',            40, 1),
    ('SENIOR_MGMT',    'Senior Management',       70, 1),
    ('BOARD_MEMBER',   'Board Member',            90, 1),
    ('EXTERNAL_AUDITOR','External Auditor',       50, 1);

INSERT INTO permission_modules (module_code, module_name) VALUES
    ('WORK_PAPER',       'Work Papers'),
    ('ACTION_PLAN',      'Action Plans'),
    ('AUDITEE_RESPONSE', 'Auditee Responses'),
    ('USER',             'Users'),
    ('CONFIG',           'Configuration'),
    ('AI_ASSIST',        'AI Assistance'),
    ('AUDIT_WORKBENCH',  'Audit Workbench'),
    ('REPORT',           'Reports'),
    ('BACKUP',           'Backup & Restore'),
    ('AUDIT_LOG',        'Audit Log');

INSERT INTO permission_actions (action_code, action_name) VALUES
    ('create','Create'),('read','Read'),('update','Update'),
    ('delete','Delete'),('approve','Approve'),('export','Export'),
    ('restore','Restore');

INSERT INTO enum_values (enum_type, enum_value, display_label, display_order, is_terminal) VALUES
    ('WP_STATUS','DRAFT','Draft',10,0),
    ('WP_STATUS','SUBMITTED','Submitted',20,0),
    ('WP_STATUS','UNDER_REVIEW','Under Review',30,0),
    ('WP_STATUS','REVISION_REQUIRED','Revision Required',40,0),
    ('WP_STATUS','APPROVED','Approved',50,0),
    ('WP_STATUS','SENT_TO_AUDITEE','Sent to Auditee',60,0),
    ('WP_STATUS','CLOSED','Closed',70,1),

    ('AP_STATUS','NOT_DUE','Not Due',10,0),
    ('AP_STATUS','PENDING','Pending',20,0),
    ('AP_STATUS','IN_PROGRESS','In Progress',30,0),
    ('AP_STATUS','OVERDUE','Overdue',40,0),
    ('AP_STATUS','IMPLEMENTED','Implemented',50,0),
    ('AP_STATUS','PENDING_VERIFICATION','Pending Verification',60,0),
    ('AP_STATUS','VERIFIED','Verified',70,0),
    ('AP_STATUS','CLOSED','Closed',80,1),
    ('AP_STATUS','REJECTED','Rejected',90,1),
    ('AP_STATUS','NOT_IMPLEMENTED','Not Implemented',100,1),

    ('RESPONSE_STATUS','Pending Response','Pending Response',10,0),
    ('RESPONSE_STATUS','Draft Response','Draft Response',20,0),
    ('RESPONSE_STATUS','Response Submitted','Response Submitted',30,0),
    ('RESPONSE_STATUS','Response Accepted','Response Accepted',40,1),
    ('RESPONSE_STATUS','Response Rejected','Response Rejected',50,0),
    ('RESPONSE_STATUS','Escalated','Escalated',60,0),

    ('RISK_RATING','Extreme','Extreme',10,0),
    ('RISK_RATING','High','High',20,0),
    ('RISK_RATING','Medium','Medium',30,0),
    ('RISK_RATING','Low','Low',40,0),

    ('CONTROL_CLASSIFICATION','Preventive','Preventive',10,0),
    ('CONTROL_CLASSIFICATION','Detective','Detective',20,0),
    ('CONTROL_CLASSIFICATION','Corrective','Corrective',30,0),
    ('CONTROL_CLASSIFICATION','Directive','Directive',40,0),

    ('CONTROL_TYPE','Manual','Manual',10,0),
    ('CONTROL_TYPE','Automated','Automated',20,0),
    ('CONTROL_TYPE','IT-Dependent Manual','IT-Dependent Manual',30,0),
    ('CONTROL_TYPE','Hybrid','Hybrid',40,0),

    ('CONTROL_FREQUENCY','Ad-hoc','Ad-hoc',10,0),
    ('CONTROL_FREQUENCY','Daily','Daily',20,0),
    ('CONTROL_FREQUENCY','Weekly','Weekly',30,0),
    ('CONTROL_FREQUENCY','Monthly','Monthly',40,0),
    ('CONTROL_FREQUENCY','Quarterly','Quarterly',50,0),
    ('CONTROL_FREQUENCY','Semi-Annual','Semi-Annual',60,0),
    ('CONTROL_FREQUENCY','Annual','Annual',70,0),

    ('REQUIREMENT_STATUS','Pending','Pending',10,0),
    ('REQUIREMENT_STATUS','Provided','Provided',20,1),
    ('REQUIREMENT_STATUS','N/A','N/A',30,1);

INSERT INTO retention_policies (policy_id, entity_type, retention_days, description, is_active) VALUES
    ('RP-AUDIT-LOG',       'AUDIT_LOG',          2555, '7 years (regulatory)', 1),
    ('RP-LOGIN-ATTEMPTS',  'LOGIN_ATTEMPT',       365, '1 year', 1),
    ('RP-NOTIF-SENT',      'NOTIFICATION_SENT',    90, '90 days', 1),
    ('RP-SESSION-EXPIRED', 'SESSION_EXPIRED',      30, '30 days', 1),
    ('RP-AI-INVOCATION',   'AI_INVOCATION',       180, '180 days', 1),
    ('RP-DASHBOARD-SNAP',  'DASHBOARD_SNAPSHOT',   90, '90 days', 1);

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
