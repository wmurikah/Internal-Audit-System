// 02_Config.gs - Configuration, Constants, and Database Helpers

const SHEETS = {
  CONFIG: '00_Config',
  ROLES: '01_Roles',
  PERMISSIONS: '02_Permissions',
  USERS: '05_Users',
  AFFILIATES: '06_Affiliates',
  AUDIT_AREAS: '07_AuditAreas',
  SUB_AREAS: '08_ProcessSubAreas',
  WORK_PAPERS: '09_WorkPapers',
  WP_REQUIREMENTS: '10_WorkPaperRequirements',
  WP_FILES: '11_WorkPaperFiles',
  WP_REVISIONS: '12_WorkPaperRevisions',
  ACTION_PLANS: '13_ActionPlans',
  AP_EVIDENCE: '14_ActionPlanEvidence',
  AP_HISTORY: '15_ActionPlanHistory',
  AUDIT_LOG: '16_AuditLog',
  SESSIONS: '20_Sessions',
  NOTIFICATION_QUEUE: '21_NotificationQueue',
  EMAIL_TEMPLATES: '22_EmailTemplates',
  AUDITEE_RESPONSES: '24_AuditeeResponses'
};

const SCHEMAS = {
  CONFIG: ['config_key', 'config_value', 'description', 'updated_at'],
  ROLES: ['role_code', 'role_name', 'role_level', 'description', 'is_active'],
  USERS: [
    'user_id', 'email', 'password_hash', 'password_salt', 'full_name', 
    'first_name', 'last_name', 'role_code', 'affiliate_code', 'department', 
    'phone', 'is_active', 'must_change_password', 'login_attempts',
    'locked_until', 'last_login', 'created_at', 'created_by', 'updated_at', 'updated_by',
    'privacy_consent_accepted', 'privacy_consent_date', 'privacy_consent_version'
  ],
  AFFILIATES: ['affiliate_code', 'affiliate_name', 'country', 'region', 'is_active', 'display_order'],
  AUDIT_AREAS: ['area_id', 'area_code', 'area_name', 'description', 'is_active', 'display_order'],
  SUB_AREAS: [
    'sub_area_id', 'area_id', 'sub_area_code', 'sub_area_name', 'control_objectives',
    'risk_description', 'test_objective', 'testing_steps', 'is_active', 'display_order'
  ],
  WORK_PAPERS: [
    'work_paper_id', 'year', 'affiliate_code', 'audit_area_id', 'sub_area_id',
    'work_paper_date', 'audit_period_from', 'audit_period_to',
    'control_objectives', 'control_classification', 'control_type', 'control_frequency', 'control_standards',
    'risk_description', 'test_objective', 'testing_steps',
    'observation_title', 'observation_description', 'risk_rating', 'risk_summary', 'recommendation',
    'management_response', 'responsible_ids', 'cc_recipients',
    'status', 'final_status', 'revision_count',
    'prepared_by_id', 'prepared_by_name', 'prepared_date',
    'submitted_date', 'reviewed_by_id', 'reviewed_by_name', 'review_date', 'review_comments',
    'approved_by_id', 'approved_by_name', 'approved_date', 'sent_to_auditee_date',
    'assigned_auditor_id', 'assigned_auditor_name', 'affiliate_name',
    'created_at', 'updated_at', 'work_paper_ref',
    'response_status', 'response_deadline', 'response_round',
    'response_submitted_by', 'response_submitted_date',
    'response_reviewed_by', 'response_review_date', 'response_review_comments',
    'evidence_override'
  ],
  WP_REQUIREMENTS: [
    'requirement_id', 'work_paper_id', 'requirement_number', 'requirement_description',
    'date_requested', 'status', 'notes', 'created_at', 'created_by'
  ],
  WP_FILES: [
    'file_id', 'work_paper_id', 'file_category', 'file_name', 'file_description',
    'drive_file_id', 'drive_url', 'file_size', 'mime_type', 'uploaded_by', 'uploaded_at'
  ],
  WP_REVISIONS: [
    'revision_id', 'work_paper_id', 'revision_number', 'action', 'comments',
    'changes_summary', 'user_id', 'user_name', 'action_date'
  ],
  ACTION_PLANS: [
    'action_plan_id', 'work_paper_id', 'action_number', 'action_description',
    'owner_ids', 'owner_names', 'due_date', 'status', 'final_status',
    'implementation_notes', 'implemented_date', 'implemented_by',
    'auditor_review_status', 'auditor_review_by', 'auditor_review_date', 'auditor_review_comments',
    'hoa_review_status', 'hoa_review_by', 'hoa_review_date', 'hoa_review_comments',
    'days_overdue',
    'delegated_by_id', 'delegated_by_name', 'delegated_date', 'delegation_notes', 'original_owner_ids',
    'delegation_rejected', 'delegation_accepted', 'delegation_rejected_by', 'delegation_reject_reason', 'delegation_rejected_date',
    'created_at', 'created_by', 'updated_at', 'updated_by',
    'affiliate_id', 'affiliate_name', 'year', 'audit_area_id',
    'created_by_role', 'auditee_proposed', 'response_id'
  ],
  AP_EVIDENCE: [
    'evidence_id', 'action_plan_id', 'file_name', 'file_description',
    'drive_file_id', 'drive_url', 'file_size', 'mime_type', 'uploaded_by', 'uploaded_at'
  ],
  AP_HISTORY: [
    'history_id', 'action_plan_id', 'previous_status', 'new_status', 'comments',
    'user_id', 'user_name', 'changed_at'
  ],
  AUDIT_LOG: [
    'log_id', 'action', 'entity_type', 'entity_id', 'old_data', 'new_data',
    'user_id', 'user_email', 'timestamp', 'ip_address'
  ],
  SESSIONS: [
    'session_id', 'user_id', 'session_token', 'created_at', 'expires_at',
    'ip_address', 'user_agent', 'is_valid'
  ],
  NOTIFICATION_QUEUE: [
    'notification_id', 'template_code', 'recipient_user_id', 'recipient_email',
    'subject', 'body', 'module', 'record_id', 'status', 'scheduled_for',
    'sent_at', 'error_message', 'created_at', 'batch_type', 'batch_data'
  ],
  EMAIL_TEMPLATES: ['template_code', 'template_name', 'subject_template', 'body_template', 'is_active'],
  AUDITEE_RESPONSES: [
    'response_id', 'work_paper_id', 'round_number', 'response_type',
    'management_response', 'submitted_by_id', 'submitted_by_name', 'submitted_date',
    'action_plan_ids', 'status',
    'reviewed_by_id', 'reviewed_by_name', 'review_date', 'review_comments',
    'created_at', 'updated_at'
  ]
};

const STATUS = {
  WORK_PAPER: {
    DRAFT: 'Draft',
    SUBMITTED: 'Submitted',
    UNDER_REVIEW: 'Under Review',
    REVISION_REQUIRED: 'Revision Required',
    APPROVED: 'Approved',
    SENT_TO_AUDITEE: 'Sent to Auditee'
  },
  ACTION_PLAN: {
    NOT_DUE: 'Not Due',
    PENDING: 'Pending',
    IN_PROGRESS: 'In Progress',
    IMPLEMENTED: 'Implemented',
    PENDING_VERIFICATION: 'Pending Verification',
    VERIFIED: 'Verified',
    REJECTED: 'Rejected',
    OVERDUE: 'Overdue',
    NOT_IMPLEMENTED: 'Not Implemented',
    CLOSED: 'Closed'
  },
  RESPONSE: {
    PENDING: 'Pending Response',
    DRAFT: 'Draft Response',
    SUBMITTED: 'Response Submitted',
    ACCEPTED: 'Response Accepted',
    REJECTED: 'Response Rejected',
    ESCALATED: 'Escalated'
  },
  REVIEW: {
    PENDING: 'Pending Review',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    RETURNED: 'Returned for Revision'
  },
  NOTIFICATION: {
    PENDING: 'Pending',
    SENT: 'Sent',
    FAILED: 'Failed',
    BATCHED: 'Batched'
  }
};

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  SENIOR_AUDITOR: 'SENIOR_AUDITOR',
  JUNIOR_STAFF: 'JUNIOR_STAFF',
  SENIOR_MGMT: 'SENIOR_MGMT',
  BOARD_MEMBER: 'BOARD_MEMBER',
  AUDITOR: 'AUDITOR',
  UNIT_MANAGER: 'UNIT_MANAGER',
  EXTERNAL_AUDITOR: 'EXTERNAL_AUDITOR'
};

// Display name overrides — used by getRolesDropdown() and getRoleDisplayName()
// Maps role_code to the user-facing display name.
// OBSERVER must display as "Board Member" everywhere in the UI.
const ROLE_DISPLAY_NAMES = {
  JUNIOR_STAFF: 'Audit Client',
  UNIT_MANAGER: 'Head of Department',
  BOARD_MEMBER: 'Board Member',
  BOARD: 'Board Member'
};

/**
 * Get the display name for a role code, applying overrides.
 * Falls back to the Firestore role_name if no override exists.
 */
function getRoleDisplayName(roleCode) {
  if (ROLE_DISPLAY_NAMES[roleCode]) return ROLE_DISPLAY_NAMES[roleCode];
  return getRoleName(roleCode);
}

/**
 * Hardcoded role-permission matrix — the ONLY source of truth for what each role can do.
 * SUPER_ADMIN also has a code-level bypass in canUserPerform().
 */
const ROLE_PERMISSIONS = {
  SUPER_ADMIN: {
    WORK_PAPER:        {can_create: true, can_read: true, can_update: true, can_delete: true, can_approve: true, can_export: true},
    AUDITEE_RESPONSE:  {can_read_observation: true, can_write_mgmt_response: false, can_create_action_plan: false, can_update_action_plan: false, can_delegate: false, can_view_rounds: true, can_export: true},
    ACTION_PLAN:       {can_create: true, can_read: true, can_update: true, can_delete: true, can_approve: true, can_export: true},
    USER:              {can_create: true, can_read: true, can_update: true, can_delete: true, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: true, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: true, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: false}
  },
  SENIOR_AUDITOR: {
    WORK_PAPER:        {can_create: true, can_read: true, can_update: true, can_delete: false, can_approve: true, can_export: true},
    AUDITEE_RESPONSE:  {can_read_observation: true, can_write_mgmt_response: false, can_create_action_plan: false, can_update_action_plan: false, can_delegate: false, can_view_rounds: true, can_export: true},
    ACTION_PLAN:       {can_create: true, can_read: true, can_update: true, can_delete: true, can_approve: true, can_export: true},
    USER:              {can_create: true, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: true, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: true, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: false}
  },
  AUDITOR: {
    WORK_PAPER:        {can_create: true, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: true},
    AUDITEE_RESPONSE:  {can_read_observation: false, can_write_mgmt_response: false, can_create_action_plan: false, can_update_action_plan: false, can_delegate: false, can_view_rounds: false, can_export: false},
    ACTION_PLAN:       {can_create: true, can_read: true, can_update: true, can_delete: true, can_approve: true, can_export: true},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: true, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: true, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  },
  JUNIOR_STAFF: {
    WORK_PAPER:        {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDITEE_RESPONSE:  {can_read_observation: true, can_write_mgmt_response: true, can_create_action_plan: true, can_update_action_plan: true, can_delegate: true, can_view_rounds: true, can_export: false},
    ACTION_PLAN:       {can_create: true, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: false},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AI_ASSIST:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  },
  SENIOR_MGMT: {
    WORK_PAPER:        {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDITEE_RESPONSE:  {can_read_observation: true, can_write_mgmt_response: true, can_create_action_plan: true, can_update_action_plan: true, can_delegate: true, can_view_rounds: true, can_export: true},
    ACTION_PLAN:       {can_create: true, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: true},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  },
  UNIT_MANAGER: {
    WORK_PAPER:        {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDITEE_RESPONSE:  {can_read_observation: true, can_write_mgmt_response: true, can_create_action_plan: true, can_update_action_plan: true, can_delegate: true, can_view_rounds: true, can_export: false},
    ACTION_PLAN:       {can_create: true, can_read: true, can_update: true, can_delete: false, can_approve: false, can_export: false},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AI_ASSIST:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  },
  BOARD_MEMBER: {
    WORK_PAPER:        {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDITEE_RESPONSE:  {can_read_observation: false, can_write_mgmt_response: false, can_create_action_plan: false, can_update_action_plan: false, can_delegate: false, can_view_rounds: false, can_export: false},
    ACTION_PLAN:       {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  },
  EXTERNAL_AUDITOR: {
    WORK_PAPER:        {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDITEE_RESPONSE:  {can_read_observation: false, can_write_mgmt_response: false, can_create_action_plan: false, can_update_action_plan: false, can_delegate: false, can_view_rounds: false, can_export: false},
    ACTION_PLAN:       {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  },
  // Alias: Firestore stores role_code='BOARD' but code uses 'BOARD_MEMBER'. Support both.
  BOARD: {
    WORK_PAPER:        {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDITEE_RESPONSE:  {can_read_observation: false, can_write_mgmt_response: false, can_create_action_plan: false, can_update_action_plan: false, can_delegate: false, can_view_rounds: false, can_export: false},
    ACTION_PLAN:       {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    USER:              {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    REPORT:            {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    DASHBOARD:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: true},
    AI_ASSIST:         {can_create: false, can_read: true, can_update: false, can_delete: false, can_approve: false, can_export: false},
    AUDIT_WORKBENCH:   {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false},
    CONFIG:            {can_create: false, can_read: false, can_update: false, can_delete: false, can_approve: false, can_export: false}
  }
};

/**
 * Role Workflow Access — maps each role to capabilities at each audit lifecycle stage.
 * This is a governance reference constant. Do not modify without a code review.
 */
var ROLE_WORKFLOW_ACCESS = {
  SUPER_ADMIN: {
    role_description: "System owner with unrestricted access. Oversees the entire audit lifecycle, manages users, configures system settings, and has final approval authority on all work papers.",
    access_path: "Path 1 (Work Papers) + Path 2 (Response Review)",
    nav_sections: ["Work Papers", "Send Queue", "Responses to Review", "Action Plans", "My Observations", "Board Reports", "AI Assist", "Audit Workbench", "User Management", "System Settings", "Analytics"],
    stages: {
      "1_planning":        {access: "FULL", actions: ["Create work papers", "Assign risk ratings", "Set scope and objectives", "Assign audit team members"]},
      "2_fieldwork":       {access: "FULL", actions: ["Edit work papers", "Document observations", "Attach evidence", "Use AI Assist for drafting"]},
      "3_review":          {access: "FULL", actions: ["Review submitted work papers", "Approve or return with feedback", "Add review comments"]},
      "4_approval":        {access: "FULL", actions: ["Final approval of work papers", "Override review decisions"]},
      "5_communication":   {access: "FULL", actions: ["Send observations to auditees", "Assign responsible parties", "Batch-send multiple work papers", "Manage send queue"]},
      "6_auditee_response":{access: "REVIEW", actions: ["View auditee responses via Responses to Review", "Accept or reject responses", "Trigger next round or escalation"]},
      "7_follow_up":       {access: "FULL", actions: ["View all action plans", "Monitor overdue items", "View evidence uploads", "Track due dates"]},
      "8_verification":    {access: "FULL", actions: ["Verify action plan implementation", "Accept or return action plans", "Close verified items"]},
      "9_reporting":       {access: "FULL", actions: ["Generate board reports (Word)", "View analytics dashboard", "Export data", "View periodic summaries"]},
      "10_closure":        {access: "FULL", actions: ["Archive completed audits", "Delete draft work papers"]}
    }
  },
  SENIOR_AUDITOR: {
    role_description: "Senior audit team member who reviews work papers, manages the send queue, and reviews auditee responses. Can create users but cannot delete work papers.",
    access_path: "Path 1 (Work Papers) + Path 2 (Response Review)",
    nav_sections: ["Work Papers", "Send Queue", "Responses to Review", "Action Plans", "AI Assist", "Audit Workbench", "Analytics"],
    stages: {
      "1_planning":        {access: "FULL", actions: ["Create work papers", "Assign risk ratings", "Set scope"]},
      "2_fieldwork":       {access: "FULL", actions: ["Edit work papers", "Document observations", "Attach evidence", "Use AI Assist"]},
      "3_review":          {access: "FULL", actions: ["Review submitted work papers", "Approve or return with feedback"]},
      "4_approval":        {access: "FULL", actions: ["Approve work papers"]},
      "5_communication":   {access: "FULL", actions: ["Send to auditees", "Assign responsible parties", "Batch-send", "Manage send queue"]},
      "6_auditee_response":{access: "REVIEW", actions: ["View responses via Responses to Review", "Accept or reject responses", "Trigger next round or escalation"]},
      "7_follow_up":       {access: "FULL", actions: ["View all action plans", "Monitor overdue items", "Track due dates"]},
      "8_verification":    {access: "FULL", actions: ["Verify action plan implementation", "Accept or return action plans"]},
      "9_reporting":       {access: "READ", actions: ["View analytics dashboard", "Export reports"]},
      "10_closure":        {access: "NONE", actions: ["Cannot delete work papers"]}
    }
  },
  AUDITOR: {
    role_description: "Core audit team member who creates and executes work papers. Can verify action plans but cannot approve work papers or access the send queue.",
    access_path: "Path 1 (Work Papers)",
    nav_sections: ["Work Papers", "Action Plans", "AI Assist", "Audit Workbench", "Analytics"],
    stages: {
      "1_planning":        {access: "FULL", actions: ["Create work papers", "Assign risk ratings", "Set scope"]},
      "2_fieldwork":       {access: "FULL", actions: ["Edit work papers", "Document observations", "Attach evidence", "Use AI Assist"]},
      "3_review":          {access: "SUBMIT", actions: ["Submit work papers for review (cannot approve)"]},
      "4_approval":        {access: "NONE", actions: ["Cannot approve work papers"]},
      "5_communication":   {access: "NONE", actions: ["Cannot send to auditees", "Cannot access send queue"]},
      "6_auditee_response":{access: "NONE", actions: ["Cannot review auditee responses"]},
      "7_follow_up":       {access: "FULL", actions: ["View all action plans", "Monitor items", "Track due dates"]},
      "8_verification":    {access: "FULL", actions: ["Verify action plan implementation", "Accept or return action plans"]},
      "9_reporting":       {access: "READ", actions: ["View analytics dashboard", "Export reports"]},
      "10_closure":        {access: "NONE", actions: ["Cannot delete work papers"]}
    }
  },
  JUNIOR_STAFF: {
    role_description: "Audit client (auditee) who receives observations, writes management responses, creates action plans, and delegates to responsible persons within their department.",
    access_path: "Path 2 (Auditee Response) only",
    nav_sections: ["My Observations", "Action Plans (own)", "AI Assist (read)", "Dashboard"],
    stages: {
      "1_planning":        {access: "NONE", actions: ["No access"]},
      "2_fieldwork":       {access: "NONE", actions: ["No access"]},
      "3_review":          {access: "NONE", actions: ["No access"]},
      "4_approval":        {access: "NONE", actions: ["No access"]},
      "5_communication":   {access: "RECEIVE", actions: ["Receives observations sent by auditors", "Gets email notification with assigned observations"]},
      "6_auditee_response":{access: "FULL", actions: ["Read observation detail and risk rating", "Write management response", "Create action plans", "Update own action plans", "Delegate to responsible persons", "View response rounds history", "Submit response for auditor review"]},
      "7_follow_up":       {access: "OWN", actions: ["View own action plans only", "Upload evidence for own action plans", "Track own due dates"]},
      "8_verification":    {access: "NONE", actions: ["Cannot verify (auditor function)"]},
      "9_reporting":       {access: "NONE", actions: ["No report access"]},
      "10_closure":        {access: "NONE", actions: ["No access"]}
    }
  },
  SENIOR_MGMT: {
    role_description: "Senior management (C-suite, directors) who receive observations, respond with management positions, and have visibility across all action plans in the organization for oversight.",
    access_path: "Path 2 (Auditee Response) only",
    nav_sections: ["My Observations", "All Action Plans", "Dashboard", "Reports (read)", "AI Assist (read)"],
    stages: {
      "1_planning":        {access: "NONE", actions: ["No access"]},
      "2_fieldwork":       {access: "NONE", actions: ["No access"]},
      "3_review":          {access: "NONE", actions: ["No access"]},
      "4_approval":        {access: "NONE", actions: ["No access"]},
      "5_communication":   {access: "RECEIVE", actions: ["Receives observations", "Gets escalation notifications"]},
      "6_auditee_response":{access: "FULL", actions: ["Read observation detail", "Write management response", "Create and update action plans", "Delegate to responsible persons", "View response rounds", "Export responses"]},
      "7_follow_up":       {access: "ALL", actions: ["View ALL action plans across organization (not just own)", "Monitor overdue items org-wide", "Export action plan data"]},
      "8_verification":    {access: "NONE", actions: ["Cannot verify"]},
      "9_reporting":       {access: "READ", actions: ["View reports (read only)", "View dashboard with export"]},
      "10_closure":        {access: "NONE", actions: ["No access"]}
    }
  },
  UNIT_MANAGER: {
    role_description: "Head of Department who receives observations for their unit, writes management responses, and manages action plans within their department scope.",
    access_path: "Path 2 (Auditee Response) only",
    nav_sections: ["My Observations", "Action Plans (own)", "Dashboard", "AI Assist (read)"],
    stages: {
      "1_planning":        {access: "NONE", actions: ["No access"]},
      "2_fieldwork":       {access: "NONE", actions: ["No access"]},
      "3_review":          {access: "NONE", actions: ["No access"]},
      "4_approval":        {access: "NONE", actions: ["No access"]},
      "5_communication":   {access: "RECEIVE", actions: ["Receives observations for their department"]},
      "6_auditee_response":{access: "FULL", actions: ["Read observation detail", "Write management response", "Create and update action plans", "Delegate within department", "View response rounds"]},
      "7_follow_up":       {access: "OWN", actions: ["View own action plans", "Upload evidence", "Track due dates"]},
      "8_verification":    {access: "NONE", actions: ["Cannot verify"]},
      "9_reporting":       {access: "NONE", actions: ["No report access"]},
      "10_closure":        {access: "NONE", actions: ["No access"]}
    }
  },
  BOARD_MEMBER: {
    role_description: "Board member with read-only oversight access. Can view approved work papers, completed action plans, and generate board-level summary reports. Cannot modify any data.",
    access_path: "Path 1 (Work Papers, read only)",
    nav_sections: ["Work Papers (read only)", "Action Plans (read only)", "Board Reports", "Dashboard"],
    stages: {
      "1_planning":        {access: "NONE", actions: ["No access (cannot see drafts)"]},
      "2_fieldwork":       {access: "NONE", actions: ["No access"]},
      "3_review":          {access: "NONE", actions: ["No access"]},
      "4_approval":        {access: "NONE", actions: ["No access"]},
      "5_communication":   {access: "READ", actions: ["Can see work papers after they are approved or sent to auditee (read only)"]},
      "6_auditee_response":{access: "NONE", actions: ["No access to response workflow"]},
      "7_follow_up":       {access: "READ", actions: ["View action plans (Implemented, Verified, Closed only)", "Read only"]},
      "8_verification":    {access: "NONE", actions: ["Cannot verify"]},
      "9_reporting":       {access: "FULL", actions: ["Generate board reports (Word document)", "View dashboard", "Export summaries"]},
      "10_closure":        {access: "NONE", actions: ["No access"]}
    }
  },
  EXTERNAL_AUDITOR: {
    role_description: "External auditor with limited read-only access to approved work papers and completed action plans. Cannot generate board reports.",
    access_path: "Path 1 (Work Papers, read only)",
    nav_sections: ["Work Papers (read only)", "Action Plans (read only)", "Dashboard"],
    stages: {
      "1_planning":        {access: "NONE", actions: ["No access"]},
      "2_fieldwork":       {access: "NONE", actions: ["No access"]},
      "3_review":          {access: "NONE", actions: ["No access"]},
      "4_approval":        {access: "NONE", actions: ["No access"]},
      "5_communication":   {access: "READ", actions: ["Can see approved and sent work papers (read only)"]},
      "6_auditee_response":{access: "NONE", actions: ["No access"]},
      "7_follow_up":       {access: "READ", actions: ["View completed action plans (read only)"]},
      "8_verification":    {access: "NONE", actions: ["Cannot verify"]},
      "9_reporting":       {access: "READ", actions: ["View dashboard", "Export reports"]},
      "10_closure":        {access: "NONE", actions: ["No access"]}
    }
  },
  // Alias: Firestore stores role_code='BOARD' — mirrors BOARD_MEMBER
  BOARD: {
    role_description: "Board member with read-only oversight access. Can view approved work papers, completed action plans, and generate board-level summary reports. Cannot modify any data.",
    access_path: "Path 1 (Work Papers, read only)",
    nav_sections: ["Work Papers (read only)", "Action Plans (read only)", "Board Reports", "Dashboard"],
    stages: {
      "1_planning":        {access: "NONE", actions: ["No access (cannot see drafts)"]},
      "2_fieldwork":       {access: "NONE", actions: ["No access"]},
      "3_review":          {access: "NONE", actions: ["No access"]},
      "4_approval":        {access: "NONE", actions: ["No access"]},
      "5_communication":   {access: "READ", actions: ["Can see work papers after they are approved or sent to auditee (read only)"]},
      "6_auditee_response":{access: "NONE", actions: ["No access to response workflow"]},
      "7_follow_up":       {access: "READ", actions: ["View action plans (Implemented, Verified, Closed only)", "Read only"]},
      "8_verification":    {access: "NONE", actions: ["Cannot verify"]},
      "9_reporting":       {access: "FULL", actions: ["Generate board reports (Word document)", "View dashboard", "Export summaries"]},
      "10_closure":        {access: "NONE", actions: ["No access"]}
    }
  }
};

/**
 * Get role workflow access data
 */
function getRoleWorkflowAccess(roleCode) {
  if (!roleCode) return null;
  if (roleCode === 'ALL') return ROLE_WORKFLOW_ACCESS;
  return ROLE_WORKFLOW_ACCESS[roleCode] || null;
}

var _idBlockCache = {};
var ID_BLOCK_SIZE = 10;

var _ID_CONFIG_KEY_MAP = {
  'WORK_PAPER': 'NEXT_WP_ID',
  'ACTION_PLAN': 'NEXT_AP_ID',
  'USER': 'NEXT_USER_ID',
  'REQUIREMENT': 'NEXT_REQ_ID',
  'FILE': 'NEXT_FILE_ID',
  'REVISION': 'NEXT_REV_ID',
  'EVIDENCE': 'NEXT_EVIDENCE_ID',
  'HISTORY': 'NEXT_HISTORY_ID',
  'SESSION': 'NEXT_SESSION_ID',
  'NOTIFICATION': 'NEXT_NOTIF_ID',
  'LOG': 'NEXT_LOG_ID',
  'AUDITEE_RESPONSE': 'NEXT_AR_ID'
};

var _ID_PREFIX_MAP = {
  'WORK_PAPER': 'WP-',
  'ACTION_PLAN': 'AP-',
  'USER': 'USR-',
  'REQUIREMENT': 'REQ-',
  'FILE': 'FILE-',
  'REVISION': 'REV-',
  'EVIDENCE': 'EVI-',
  'HISTORY': 'HIST-',
  'SESSION': 'SES-',
  'NOTIFICATION': 'NOTIF-',
  'LOG': 'LOG-',
  'AUDITEE_RESPONSE': 'AR-'
};

function generateId(entityType) {
  // Check cached block first (no lock needed)
  if (_idBlockCache[entityType] && _idBlockCache[entityType].remaining > 0) {
    var cached = _idBlockCache[entityType];
    var id = cached.prefix + String(cached.next).padStart(6, '0');
    cached.next++;
    cached.remaining--;
    return id;
  }

  // Allocate a new block (requires lock + Firestore)
  var configKey = _ID_CONFIG_KEY_MAP[entityType];
  var prefix = _ID_PREFIX_MAP[entityType];
  if (!configKey || !prefix) throw new Error('Unknown entity type: ' + entityType);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    var configDoc = firestoreGet(SHEETS.CONFIG, configKey);
    var currentValue = configDoc ? (parseInt(configDoc.config_value) || 1) : 1;

    // Allocate block: increment by ID_BLOCK_SIZE instead of 1
    firestoreSet(SHEETS.CONFIG, configKey, {
      config_key: configKey,
      config_value: currentValue + ID_BLOCK_SIZE,
      description: 'Auto-generated ID counter',
      updated_at: new Date().toISOString()
    });

    _idBlockCache[entityType] = {
      prefix: prefix,
      next: currentValue,
      remaining: ID_BLOCK_SIZE
    };

    lock.releaseLock();
    return generateId(entityType); // Recurse to use cached block
  } finally {
    try { lock.releaseLock(); } catch(e) {}
  }
}

function generateIds(entityType, count) {
  if (count <= 0) return [];
  if (count === 1) return [generateId(entityType)];

  var lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);

    var configKeyMap = {
      'WORK_PAPER': 'NEXT_WP_ID',
      'ACTION_PLAN': 'NEXT_AP_ID',
      'FILE': 'NEXT_FILE_ID',
      'REQUIREMENT': 'NEXT_REQ_ID',
      'EVIDENCE': 'NEXT_EVIDENCE_ID'
    };

    var prefixMap = {
      'WORK_PAPER': 'WP-',
      'ACTION_PLAN': 'AP-',
      'FILE': 'FILE-',
      'REQUIREMENT': 'REQ-',
      'EVIDENCE': 'EVI-'
    };

    var configKey = configKeyMap[entityType];
    var prefix = prefixMap[entityType];
    if (!configKey || !prefix) throw new Error('Unknown entity type for batch: ' + entityType);

    var currentValue = 1;

    var configDoc = firestoreGet(SHEETS.CONFIG, configKey);
    currentValue = configDoc ? (parseInt(configDoc.config_value) || 1) : 1;

    firestoreSet(SHEETS.CONFIG, configKey, {
      config_key: configKey,
      config_value: currentValue + count,
      description: 'Auto-generated ID counter',
      updated_at: new Date().toISOString()
    });

    var ids = [];
    for (var j = 0; j < count; j++) {
      ids.push(prefix + String(currentValue + j).padStart(6, '0'));
    }
    return ids;

  } finally {
    lock.releaseLock();
  }
}

function getDropdownData() {
  const cacheKey = 'dropdown_data_all';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  
  const dropdowns = {
    affiliates: getAffiliatesDropdown(),
    auditAreas: getAuditAreasDropdown(),
    subAreas: getSubAreasDropdown(),
    users: getUsersDropdown(),
    auditors: getAuditorsDropdown(),
    auditees: getAuditeesDropdown(),
    roles: getRolesDropdown(),
    riskRatings: getRiskRatings(),
    controlClassifications: getControlClassifications(),
    controlTypes: getControlTypes(),
    controlFrequencies: getControlFrequencies(),
    wpStatuses: Object.values(STATUS.WORK_PAPER),
    apStatuses: Object.values(STATUS.ACTION_PLAN),
    years: getYearOptions()
  };
  
  cache.put(cacheKey, JSON.stringify(dropdowns), CONFIG.CACHE_TTL.DROPDOWNS);
  return dropdowns;
}

function invalidateDropdownCache() {
  const cache = CacheService.getScriptCache();
  cache.remove('dropdown_data_all');
  cache.remove('affiliates_dropdown');
  cache.remove('audit_areas_dropdown');
  cache.remove('sub_areas_dropdown');
  cache.remove('users_dropdown');
  cache.remove('roles_dropdown');
  console.log('All dropdown caches invalidated');
}

function clearAllCaches() {
  const cache = CacheService.getScriptCache();
  const keysToRemove = [
    'dropdown_data_all',
    'affiliates_dropdown', 
    'audit_areas_dropdown',
    'sub_areas_dropdown',
    'users_dropdown',
    'roles_dropdown',
    'perm_SUPER_ADMIN',
    'perm_SENIOR_AUDITOR',
    'perm_AUDITOR',
    'perm_JUNIOR_STAFF',
    'perm_UNIT_MANAGER',
    'perm_SENIOR_MGMT',
    'perm_BOARD_MEMBER',
    'perm_EXTERNAL_AUDITOR',
    'perm_AUDITEE',
    'perm_MANAGEMENT',
    'perm_BOARD',
    'perm_OBSERVER'
  ];
  
  keysToRemove.forEach(key => {
    try { cache.remove(key); } catch(e) {}
  });
  
  console.log('All caches cleared successfully');
  return { success: true, message: 'All caches cleared' };
}

function isActive(value) {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'active';
  }
  return false;
}

function getRolesDropdown() {
  const cacheKey = 'roles_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.ROLES);
  if (!data || data.length < 2) return [];
  const headers = data[0];

  const codeIdx = headers.indexOf('role_code');
  const nameIdx = headers.indexOf('role_name');
  const levelIdx = headers.indexOf('role_level');
  const activeIdx = headers.indexOf('is_active');
  
  const roles = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      var displayName = ROLE_DISPLAY_NAMES[row[codeIdx]] || row[nameIdx];
      roles.push({ code: row[codeIdx], name: displayName, level: row[levelIdx] });
    }
  }
  
  roles.sort((a, b) => (b.level || 0) - (a.level || 0));
  cache.put(cacheKey, JSON.stringify(roles), CONFIG.CACHE_TTL.DROPDOWNS);
  return roles;
}

function getAffiliatesDropdown() {
  const cacheKey = 'affiliates_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.AFFILIATES);
  if (!data || data.length < 2) return [];
  const headers = data[0];

  const codeIdx = headers.indexOf('affiliate_code');
  const nameIdx = headers.indexOf('affiliate_name');
  const countryIdx = headers.indexOf('country');
  const activeIdx = headers.indexOf('is_active');
  const orderIdx = headers.indexOf('display_order');
  
  const affiliates = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      affiliates.push({
        code: row[codeIdx],
        name: row[nameIdx],
        country: row[countryIdx],
        order: row[orderIdx] || 999,
        display: row[codeIdx] + ' - ' + row[nameIdx]
      });
    }
  }
  
  affiliates.sort((a, b) => (a.order || 999) - (b.order || 999));
  cache.put(cacheKey, JSON.stringify(affiliates), CONFIG.CACHE_TTL.DROPDOWNS);
  return affiliates;
}

function getAuditAreasDropdown() {
  const cacheKey = 'audit_areas_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.AUDIT_AREAS);
  if (!data || data.length < 2) return [];
  const headers = data[0];

  const idIdx = headers.indexOf('area_id');
  const codeIdx = headers.indexOf('area_code');
  const nameIdx = headers.indexOf('area_name');
  const activeIdx = headers.indexOf('is_active');
  const orderIdx = headers.indexOf('display_order');
  
  const areas = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      areas.push({
        id: row[idIdx],
        code: row[codeIdx],
        name: row[nameIdx],
        order: row[orderIdx] || 999,
        display: row[codeIdx] + ' - ' + row[nameIdx]
      });
    }
  }
  
  areas.sort((a, b) => (a.order || 999) - (b.order || 999));
  cache.put(cacheKey, JSON.stringify(areas), CONFIG.CACHE_TTL.DROPDOWNS);
  return areas;
}

function getSubAreasDropdown() {
  const cacheKey = 'sub_areas_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.SUB_AREAS);
  if (!data || data.length < 2) return [];
  const headers = data[0];

  const idIdx = headers.indexOf('sub_area_id');
  const areaIdIdx = headers.indexOf('area_id');
  const codeIdx = headers.indexOf('sub_area_code');
  const nameIdx = headers.indexOf('sub_area_name');
  const activeIdx = headers.indexOf('is_active');
  const orderIdx = headers.indexOf('display_order');
  const controlObjIdx = headers.indexOf('control_objectives');
  const riskDescIdx = headers.indexOf('risk_description');
  const testObjIdx = headers.indexOf('test_objective');
  const testStepsIdx = headers.indexOf('testing_steps');
  
  const subAreas = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      subAreas.push({
        id: row[idIdx],
        areaId: row[areaIdIdx],
        code: row[codeIdx],
        name: row[nameIdx],
        order: row[orderIdx] || 999,
        controlObjectives: row[controlObjIdx] || '',
        riskDescription: row[riskDescIdx] || '',
        testObjective: row[testObjIdx] || '',
        testingSteps: row[testStepsIdx] || ''
      });
    }
  }
  
  subAreas.sort((a, b) => (a.order || 999) - (b.order || 999));
  cache.put(cacheKey, JSON.stringify(subAreas), CONFIG.CACHE_TTL.DROPDOWNS);
  return subAreas;
}

function getUsersDropdown() {
  const cacheKey = 'users_dropdown';
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.USERS);
  if (!data || data.length < 2) return [];
  const headers = data[0];

  const idIdx = headers.indexOf('user_id');
  const emailIdx = headers.indexOf('email');
  const nameIdx = headers.indexOf('full_name');
  const roleIdx = headers.indexOf('role_code');
  const activeIdx = headers.indexOf('is_active');
  const affiliateIdx = headers.indexOf('affiliate_code');
  const deptIdx = headers.indexOf('department');
  
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (isActive(row[activeIdx])) {
      users.push({
        id: row[idIdx],
        email: row[emailIdx],
        name: row[nameIdx],
        roleCode: row[roleIdx],
        affiliate: row[affiliateIdx],
        department: row[deptIdx],
        display: row[nameIdx] + ' (' + row[emailIdx] + ')'
      });
    }
  }
  
  users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  cache.put(cacheKey, JSON.stringify(users), CONFIG.CACHE_TTL.DROPDOWNS);
  return users;
}

function getAuditorsDropdown() {
  const allUsers = getUsersDropdown();
  const auditorRoles = [ROLES.SUPER_ADMIN, ROLES.SENIOR_AUDITOR, ROLES.JUNIOR_STAFF, ROLES.AUDITOR, 'SUPER_ADMIN', 'SENIOR_AUDITOR', 'JUNIOR_STAFF', 'AUDITOR'];
  return allUsers.filter(u => auditorRoles.includes(u.roleCode));
}

function getAuditeesDropdown() {
  const allUsers = getUsersDropdown();
  const auditeeRoles = [
    'JUNIOR_STAFF', 'UNIT_MANAGER', 'SENIOR_MGMT',
    ROLES.JUNIOR_STAFF, ROLES.UNIT_MANAGER, ROLES.SENIOR_MGMT
  ];
  const auditees = allUsers.filter(u => auditeeRoles.includes(u.roleCode));
  return auditees.length > 0 ? auditees : allUsers;
}

function getRiskRatings() {
  var defaultRatings = [
    { value: 'Extreme', label: 'Extreme', color: '#dc3545' },
    { value: 'High', label: 'High', color: '#fd7e14' },
    { value: 'Medium', label: 'Medium', color: '#ffc107' },
    { value: 'Low', label: 'Low', color: '#28a745' }
  ];
  var riskConfig = firestoreGet(SHEETS.CONFIG, 'DROPDOWN_RISK_RATINGS');
  if (riskConfig && riskConfig.config_value) {
    try {
      var values = JSON.parse(riskConfig.config_value);
      if (Array.isArray(values) && values.length > 0) {
        var colors = { 'Critical': '#7b2d8e', 'Extreme': '#dc3545', 'High': '#fd7e14', 'Medium': '#ffc107', 'Low': '#28a745' };
        return values.map(function(v) {
          return { value: v, label: v, color: colors[v] || '#6c757d' };
        });
      }
    } catch (e) {}
  }
  return defaultRatings;
}

function getControlClassifications() {
  var defaults = ['Preventive', 'Detective', 'Corrective', 'Directive'];
  var config = firestoreGet(SHEETS.CONFIG, 'DROPDOWN_CONTROL_CLASSIFICATIONS');
  if (config && config.config_value) {
    try {
      var values = JSON.parse(config.config_value);
      if (Array.isArray(values) && values.length > 0) return values;
    } catch (e) {}
  }
  return defaults;
}

function getControlTypes() {
  var defaults = ['Manual', 'Automated', 'IT-Dependent Manual', 'Hybrid'];
  var config = firestoreGet(SHEETS.CONFIG, 'DROPDOWN_CONTROL_TYPES');
  if (config && config.config_value) {
    try {
      var values = JSON.parse(config.config_value);
      if (Array.isArray(values) && values.length > 0) return values;
    } catch (e) {}
  }
  return defaults;
}

function getControlFrequencies() {
  var defaults = ['Ad-hoc', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual'];
  var config = firestoreGet(SHEETS.CONFIG, 'DROPDOWN_CONTROL_FREQUENCIES');
  if (config && config.config_value) {
    try {
      var values = JSON.parse(config.config_value);
      if (Array.isArray(values) && values.length > 0) return values;
    } catch (e) {}
  }
  return defaults;
}

function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear + 1; y >= currentYear - 5; y--) {
    years.push(y);
  }
  return years;
}

function getUserByEmail(email) {
  if (!email) return null;
  
  const normalizedEmail = email.toLowerCase().trim();
  const cacheKey = 'user_email_' + normalizedEmail;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  if (cached) { try { return JSON.parse(cached); } catch (e) {} }
  
  var data = getSheetData(SHEETS.USERS);
  if (!data || data.length < 1) return null;
  var headers = data[0];
  if (!headers || typeof headers.indexOf !== 'function') return null;
  var emailIdx = headers.indexOf('email');
  if (emailIdx === -1) return null;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][emailIdx]).toLowerCase().trim() === normalizedEmail) {
      var user = rowToObject(headers, data[i]);
      user._rowIndex = i + 1;
      cache.put(cacheKey, JSON.stringify(user), CONFIG.CACHE_TTL.USER_BY_EMAIL);
      return user;
    }
  }
  return null;
}

function invalidateUserCache(email, userId) {
  if (!email && !userId) return;
  const cache = CacheService.getScriptCache();
  if (email) {
    cache.remove('user_email_' + email.toLowerCase().trim());
  }
  if (userId) {
    cache.remove('user_id_' + userId);
  }
  cache.remove('users_dropdown');
  cache.remove('dropdown_data_all');
}

function getUserById(userId) {
  if (!userId) return null;

  if (typeof firestoreGet === 'function' && isFirestoreEnabled()) {
    var user = firestoreGet(SHEETS.USERS, userId);
    if (user) return user;
  }

  console.log('getUserById: User not found in Firestore:', userId);
  return null;
}

function getWorkPaperById(workPaperId) {
  if (!workPaperId) return null;

  if (typeof firestoreGet === 'function' && isFirestoreEnabled()) {
    return firestoreGet(SHEETS.WORK_PAPERS, workPaperId);
  }

  return null;
}

function getWorkPaperFull(workPaperId) {
  if (!workPaperId) return null;

  var workPaper = getWorkPaperById(workPaperId);
  if (!workPaper) return null;

  workPaper.requirements = getWorkPaperRequirements(workPaperId);
  workPaper.files = getWorkPaperFiles(workPaperId);
  workPaper.revisions = getWorkPaperRevisions(workPaperId);
  workPaper.actionPlans = getActionPlansByWorkPaper(workPaperId);

  return workPaper;
}

function getWorkPaperRequirements(workPaperId) {
  var data = getSheetData(SHEETS.WP_REQUIREMENTS);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var requirements = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var req = rowToObject(headers, data[i]);
      req._rowIndex = i + 1;
      requirements.push(req);
    }
  }
  return requirements.sort(function(a, b) { return (a.requirement_number || 0) - (b.requirement_number || 0); });
}

function getWorkPaperFiles(workPaperId) {
  var data = getSheetData(SHEETS.WP_FILES);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var files = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var file = rowToObject(headers, data[i]);
      file._rowIndex = i + 1;
      files.push(file);
    }
  }
  return files;
}

function getWorkPaperRevisions(workPaperId) {
  var data = getSheetData(SHEETS.WP_REVISIONS);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var revisions = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var rev = rowToObject(headers, data[i]);
      rev._rowIndex = i + 1;
      revisions.push(rev);
    }
  }
  return revisions.sort(function(a, b) { return (b.revision_number || 0) - (a.revision_number || 0); });
}

function getActionPlansByWorkPaper(workPaperId) {
  var data = getSheetData(SHEETS.ACTION_PLANS);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var wpIdIdx = headers.indexOf('work_paper_id');
  var plans = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][wpIdIdx] === workPaperId) {
      var plan = rowToObject(headers, data[i]);
      plan._rowIndex = i + 1;
      plans.push(plan);
    }
  }
  return plans.sort(function(a, b) { return (a.action_number || 0) - (b.action_number || 0); });
}

function getActionPlanById(actionPlanId) {
  if (!actionPlanId) return null;

  if (typeof firestoreGet === 'function' && isFirestoreEnabled()) {
    return firestoreGet(SHEETS.ACTION_PLANS, actionPlanId);
  }

  return null;
}

function getActionPlanFull(actionPlanId) {
  const plan = getActionPlanById(actionPlanId);
  if (!plan) return null;
  
  plan.evidence = getActionPlanEvidence(actionPlanId);
  plan.history = getActionPlanHistory(actionPlanId);
  
  if (plan.work_paper_id) {
    const wp = getWorkPaperById(plan.work_paper_id);
    if (wp) {
      plan.workPaperTitle = wp.observation_title;
      plan.workPaperStatus = wp.status;
    }
  }
  return plan;
}

function getActionPlanEvidence(actionPlanId) {
  var data = getSheetData(SHEETS.AP_EVIDENCE);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var apIdIdx = headers.indexOf('action_plan_id');
  var evidence = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][apIdIdx] === actionPlanId) {
      var ev = rowToObject(headers, data[i]);
      ev._rowIndex = i + 1;
      evidence.push(ev);
    }
  }
  return evidence;
}

function getActionPlanHistory(actionPlanId) {
  var data = getSheetData(SHEETS.AP_HISTORY);
  if (!data || data.length < 2) return [];
  var headers = data[0];
  var apIdIdx = headers.indexOf('action_plan_id');
  var history = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][apIdIdx] === actionPlanId) {
      var h = rowToObject(headers, data[i]);
      h._rowIndex = i + 1;
      history.push(h);
    }
  }
  return history.sort(function(a, b) { return new Date(b.changed_at || 0) - new Date(a.changed_at || 0); });
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, idx) => { obj[header] = row[idx]; });
  return obj;
}

function objectToRow(schemaKey, obj) {
  const schema = SCHEMAS[schemaKey];
  if (!schema) throw new Error('Unknown schema: ' + schemaKey);
  
  return schema.map(col => {
    const val = obj[col];
    if (val instanceof Date) return val;
    if (val === undefined || val === null) return '';
    return val;
  });
}

function getColumnIndex(schemaKey, columnName) {
  const schema = SCHEMAS[schemaKey];
  if (!schema) throw new Error('Unknown schema: ' + schemaKey);
  const idx = schema.indexOf(columnName);
  if (idx === -1) throw new Error('Column not found: ' + columnName + ' in ' + schemaKey);
  return idx;
}

function canUserPerform(user, action, entityType, entity) {
  if (!user) return false;

  const roleCode = user.role_code || user.roleCode;

  if (roleCode === 'SUPER_ADMIN') {
    return true;
  }

  if (typeof checkPermission === 'function') {
    if (!checkPermission(roleCode, entityType, action)) {
      console.log('Permission denied by database:', roleCode, entityType, action);
      return false;
    }
  }
  
  if (entity) {
    if (entityType === 'WORK_PAPER' && (action === 'update' || action === 'delete')) {
      const permissions = getUserPermissions(roleCode);
      if (!permissions.canApproveWorkPaper) {
        if (entity.prepared_by_id !== user.user_id) {
          console.log('Ownership check failed: user', user.user_id, 'vs prepared_by', entity.prepared_by_id);
          return false;
        }
      }
    }
    
    if (entityType === 'ACTION_PLAN' && roleCode === ROLES.JUNIOR_STAFF) {
      const ownerIds = parseIdList(entity.owner_ids);
      if (!ownerIds.includes(user.user_id)) {
        console.log('Auditee not owner of action plan');
        return false;
      }
      if (action === 'delete') return false;
    }
  }
  
  return true;
}

function formatDate(date, format) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  
  format = format || 'YYYY-MM-DD';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

function calculateDaysOverdue(dueDate) {
  if (!dueDate) return 0;
  const due = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (isNaN(due.getTime())) return 0;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  
  const diffMs = today - due;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 0 ? diffDays : 0;
}

function isPastDue(dueDate) {
  return calculateDaysOverdue(dueDate) > 0;
}

function logAuditEvent(action, entityType, entityId, oldData, newData, userId, userEmail) {
  try {
    var logId = generateId('LOG');
    var logData = {
      log_id: logId,
      action: action,
      entity_type: entityType,
      entity_id: entityId || '',
      old_data: oldData ? JSON.stringify(oldData) : '',
      new_data: newData ? JSON.stringify(newData) : '',
      user_id: userId || '',
      user_email: userEmail || Session.getActiveUser().getEmail() || '',
      timestamp: new Date().toISOString(),
      ip_address: ''
    };

    firestoreSet(SHEETS.AUDIT_LOG, logId, logData);
  } catch (e) {
    console.error('Failed to log audit event:', e);
  }
}

function getConfigValue(key) {
  var doc = firestoreGet(SHEETS.CONFIG, key);
  return doc ? doc.config_value : null;
}

function setConfigValue(key, value) {
  firestoreSet(SHEETS.CONFIG, key, {
    config_key: key,
    config_value: value,
    description: '',
    updated_at: new Date().toISOString()
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// Google Drive folder helpers
// ─────────────────────────────────────────────────────────────

/**
 * Get a Drive folder ID from config with fallback to parent folder.
 * @param {string} configKey - The config key for the specific subfolder
 * @return {string|null} The folder ID, or null if no config found
 */
function getDriveFolderId(configKey) {
  return getConfigValue(configKey) || getConfigValue('DRIVE_PARENT_FOLDER_ID') || getConfigValue('AUDIT_FILES_FOLDER_ID');
}

/**
 * Get a DriveApp Folder object from config with fallback.
 * @param {string} configKey - The config key for the specific subfolder
 * @return {GoogleAppsScript.Drive.Folder} The Drive folder
 */
function getDriveFolder(configKey) {
  var folderId = getDriveFolderId(configKey);
  if (!folderId) throw new Error('Drive folder not configured: ' + configKey);
  return DriveApp.getFolderById(folderId);
}

/**
 * Move a Drive file to the appropriate subfolder.
 * Preserves file ID and sharing — existing URLs still work.
 * @param {string} driveFileId - The file's Drive ID
 * @param {string} configKey - Config key for the target subfolder
 * @return {boolean} true if moved, false if skipped
 */
function moveFileToSubfolder(driveFileId, configKey) {
  if (!driveFileId) return false;
  var folderId = getConfigValue(configKey);
  if (!folderId) return false; // No subfolder configured — leave in place
  try {
    var file = DriveApp.getFileById(driveFileId);
    var targetFolder = DriveApp.getFolderById(folderId);
    file.moveTo(targetFolder);
    return true;
  } catch (e) {
    console.warn('Could not move file ' + driveFileId + ' to folder ' + configKey + ':', e.message);
    return false;
  }
}

/**
 * Seed Drive folder config values if they don't already exist.
 * Run once from the Apps Script editor to populate config.
 */
function seedDriveFolderConfig() {
  var folderConfigs = [
    { key: 'DRIVE_PARENT_FOLDER_ID', value: '1t6auxecnutG6JVS9HOXI0ggVIvrJAaM1', desc: 'Root Google Drive folder for the audit system' },
    { key: 'DRIVE_WP_FILES_FOLDER_ID', value: '1NB2L6jsCwdGXkxrPjh7OzYFhEBo0maW5', desc: 'Subfolder for work paper evidence files' },
    { key: 'DRIVE_AP_EVIDENCE_FOLDER_ID', value: '1YbvcAtgu-0AGz_X3Z16XvmUyRBZ52BDz', desc: 'Subfolder for action plan evidence files' },
    { key: 'DRIVE_EXPORTS_FOLDER_ID', value: '1ldoVohMhaeeK6V76rhvetmK1Aaw2eKb-', desc: 'Subfolder for exported reports and documents' }
  ];

  folderConfigs.forEach(function(cfg) {
    var existing = getConfigValue(cfg.key);
    if (!existing) {
      firestoreSet(SHEETS.CONFIG, cfg.key, {
        config_key: cfg.key,
        config_value: cfg.value,
        description: cfg.desc,
        updated_at: new Date().toISOString()
      });
      console.log('Seeded config: ' + cfg.key + ' = ' + cfg.value);
    } else {
      console.log('Config already exists: ' + cfg.key + ' = ' + existing);
    }
  });

  console.log('Drive folder config seeding complete.');
}
