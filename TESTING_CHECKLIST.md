# HASS PETROLEUM INTERNAL AUDIT SYSTEM - Testing Checklist

## Version 3.0 - January 2026

---

## Instructions
- Test each item and mark as PASS, FAIL, or N/A
- Document any issues in the Notes column
- Test with different user roles where applicable

---

## 1. Authentication & Authorization

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 1.1 | Login with valid credentials | User logged in, redirected to dashboard | [ ] | |
| 1.2 | Login with invalid password | Error message shown, account not locked | [ ] | |
| 1.3 | Login after 5 failed attempts | Account locked for 30 minutes | [ ] | |
| 1.4 | Logout | Session ended, redirected to login | [ ] | |
| 1.5 | Access protected page without login | Redirected to login page | [ ] | |
| 1.6 | Change password | Password updated, can login with new password | [ ] | |
| 1.7 | Force password change on first login | Modal shown, must change before proceeding | [ ] | |
| 1.8 | Session timeout after 24 hours | User automatically logged out | [ ] | |

---

## 2. Dashboard

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 2.1 | Dashboard loads | All stats cards show correct numbers | [ ] | |
| 2.2 | Work paper status chart | Pie chart displays correctly | [ ] | |
| 2.3 | Action plan status chart | Bar chart displays correctly | [ ] | |
| 2.4 | Risk distribution chart | Chart shows all risk levels | [ ] | |
| 2.5 | Trend chart | Line chart shows 6-month trend | [ ] | |
| 2.6 | Recent work papers list | Shows last 5 work papers | [ ] | |
| 2.7 | Overdue action plans list | Shows overdue items with days count | [ ] | |
| 2.8 | Click on work paper | Navigates to work paper view | [ ] | |
| 2.9 | Click on action plan | Navigates to action plan view | [ ] | |
| 2.10 | Refresh button | Data reloaded | [ ] | |

---

## 3. Work Papers List

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 3.1 | List loads | Work papers displayed in table | [ ] | |
| 3.2 | Search by keyword | Filtered results shown | [ ] | |
| 3.3 | Filter by year | Only selected year shown | [ ] | |
| 3.4 | Filter by affiliate | Only selected affiliate shown | [ ] | |
| 3.5 | Filter by status | Only selected status shown | [ ] | |
| 3.6 | Filter by risk | Only selected risk level shown | [ ] | |
| 3.7 | Clear filters | All records shown | [ ] | |
| 3.8 | Sort by ID | Sorted ascending/descending | [ ] | |
| 3.9 | Sort by title | Sorted alphabetically | [ ] | |
| 3.10 | Sort by date | Sorted by date | [ ] | |
| 3.11 | Pagination | Navigate between pages | [ ] | |
| 3.12 | Toggle table/card view | View switches correctly | [ ] | |
| 3.13 | Click row | Opens work paper view | [ ] | |
| 3.14 | Actions menu - View | Opens work paper view | [ ] | |
| 3.15 | Actions menu - Edit | Opens work paper form | [ ] | |
| 3.16 | Actions menu - Delete (Draft only) | Work paper deleted | [ ] | |
| 3.17 | New Work Paper button | Opens blank form | [ ] | |

---

## 4. Work Paper Form

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 4.1 | New form loads | All fields empty, dropdowns populated | [ ] | |
| 4.2 | Edit form loads | Fields populated with existing data | [ ] | |
| 4.3 | Select audit area | Sub-areas dropdown updates | [ ] | |
| 4.4 | Select sub-area | Auto-fill fields (objectives, risk, etc.) | [ ] | |
| 4.5 | Responsible parties autocomplete | Users searchable and selectable | [ ] | |
| 4.6 | Add action plan entry | New row added | [ ] | |
| 4.7 | Remove action plan entry | Row removed | [ ] | |
| 4.8 | Save as draft | Saved, status = Draft | [ ] | |
| 4.9 | Save and submit | Saved, status = Submitted | [ ] | |
| 4.10 | Validation - required fields | Error shown if missing | [ ] | |
| 4.11 | File upload | File uploaded to Drive | [ ] | |
| 4.12 | Cancel button | Returns to list without saving | [ ] | |

---

## 5. Work Paper View

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 5.1 | View loads | All sections populated | [ ] | |
| 5.2 | Back button | Returns to work papers list | [ ] | |
| 5.3 | Edit button (Draft/Revision) | Opens edit form | [ ] | |
| 5.4 | Submit button (Draft/Revision) | Status changes to Submitted | [ ] | |
| 5.5 | Approve button (Submitted) | Status changes to Approved | [ ] | |
| 5.6 | Return button (Submitted) | Status changes to Revision Required | [ ] | |
| 5.7 | Send to Auditee button (Approved) | Status changes to Sent to Auditee | [ ] | |
| 5.8 | Add action plan | Action plan created | [ ] | |
| 5.9 | Click action plan row | Opens action plan view | [ ] | |
| 5.10 | Upload file | File added to files list | [ ] | |
| 5.11 | Delete file | File removed | [ ] | |
| 5.12 | Timeline shows history | Events displayed correctly | [ ] | |
| 5.13 | Review comments shown | Comments visible after review | [ ] | |
| 5.14 | **AI Insights - Generate** | AI analysis displayed | [ ] | |
| 5.15 | **AI Insights - Disclaimer** | Disclaimer shown with insights | [ ] | |

---

## 6. Action Plans List

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 6.1 | List loads | Action plans displayed | [ ] | |
| 6.2 | Search by keyword | Filtered results | [ ] | |
| 6.3 | Filter by status | Only selected status shown | [ ] | |
| 6.4 | Overdue only toggle | Only overdue items shown | [ ] | |
| 6.5 | Clear filters | All records shown | [ ] | |
| 6.6 | Pagination | Navigate between pages | [ ] | |
| 6.7 | Click row | Opens action plan view | [ ] | |
| 6.8 | Overdue badge shows days | Correct number displayed | [ ] | |

---

## 7. Action Plan View

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 7.1 | View loads | All sections populated | [ ] | |
| 7.2 | Back button | Returns to action plans list | [ ] | |
| 7.3 | Work paper link | Opens related work paper | [ ] | |
| 7.4 | Enter implementation notes | Notes saved | [ ] | |
| 7.5 | Save Notes button | Notes persisted | [ ] | |
| 7.6 | Mark as Implemented | Status changes to Implemented | [ ] | |
| 7.7 | Verify button (Auditor) | Status changes to Verified | [ ] | |
| 7.8 | Return button (Auditor) | Status changes, comments saved | [ ] | |
| 7.9 | Upload evidence | Evidence file added | [ ] | |
| 7.10 | Delete evidence | Evidence removed | [ ] | |
| 7.11 | History timeline | Status changes shown | [ ] | |
| 7.12 | Overdue badge | Shows days overdue correctly | [ ] | |

---

## 8. Settings Module (SUPER_ADMIN Only)

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 8.1 | Settings page loads | All tabs visible | [ ] | |
| 8.2 | Roles list populated | All roles shown | [ ] | |
| 8.3 | Select role | Permissions table updated | [ ] | |
| 8.4 | Edit permissions | Checkboxes toggleable | [ ] | |
| 8.5 | Save permissions | Changes persisted | [ ] | |
| 8.6 | User stats displayed | Correct counts shown | [ ] | |
| 8.7 | Rebuild indexes | Indexes rebuilt successfully | [ ] | |
| 8.8 | **AI Config - Status displayed** | Provider status shown | [ ] | |
| 8.9 | **AI Config - Configure OpenAI** | Modal opens, key saveable | [ ] | |
| 8.10 | **AI Config - Configure Anthropic** | Modal opens, key saveable | [ ] | |
| 8.11 | **AI Config - Configure Google AI** | Modal opens, key saveable | [ ] | |
| 8.12 | **AI Config - Set active provider** | Provider activated | [ ] | |
| 8.13 | **AI Config - Test connection** | Connection test successful | [ ] | |
| 8.14 | **AI Config - Remove key** | Key removed, status updated | [ ] | |
| 8.15 | System config loads | Current values displayed | [ ] | |
| 8.16 | Save system config | Values persisted | [ ] | |
| 8.17 | Audit log loads | Log entries displayed | [ ] | |
| 8.18 | Audit log filter | Filtered by action type | [ ] | |
| 8.19 | Audit log pagination | Navigate through pages | [ ] | |

---

## 9. Analytics Dashboard

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 9.1 | Analytics page loads | All sections visible | [ ] | |
| 9.2 | KPI - Total Findings | Correct count | [ ] | |
| 9.3 | KPI - Action Plans | Correct count | [ ] | |
| 9.4 | KPI - Implementation Rate | Correct percentage | [ ] | |
| 9.5 | KPI - Overdue Items | Correct count | [ ] | |
| 9.6 | Findings by Status chart | Doughnut chart displays | [ ] | |
| 9.7 | Risk Distribution chart | Bar chart displays | [ ] | |
| 9.8 | Monthly Trends chart | Line chart displays | [ ] | |
| 9.9 | Action Plan Aging chart | Doughnut chart displays | [ ] | |
| 9.10 | By Affiliate chart | Horizontal bar chart | [ ] | |
| 9.11 | High Risk Findings table | Top 10 shown | [ ] | |
| 9.12 | Overdue Action Plans table | Top 10 shown | [ ] | |
| 9.13 | Auditor Performance table | Metrics displayed | [ ] | |
| 9.14 | Year filter | Data changes for selected year | [ ] | |
| 9.15 | Refresh button | Data reloaded | [ ] | |
| 9.16 | Export button | CSV downloaded | [ ] | |
| 9.17 | **AI Insights - Generate** | Strategic insights displayed | [ ] | |
| 9.18 | Click on high risk finding | Opens work paper view | [ ] | |
| 9.19 | Click on overdue AP | Opens action plan view | [ ] | |

---

## 10. Reports

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 10.1 | Reports page loads | Report options visible | [ ] | |
| 10.2 | Audit summary report | Data displayed correctly | [ ] | |
| 10.3 | Action plan aging report | Aging data shown | [ ] | |
| 10.4 | Risk summary report | Risk breakdown shown | [ ] | |
| 10.5 | Export reports | Data exported correctly | [ ] | |

---

## 11. User Management

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 11.1 | Users list loads | All users displayed | [ ] | |
| 11.2 | Search users | Filtered results | [ ] | |
| 11.3 | Filter by role | Only selected role shown | [ ] | |
| 11.4 | Filter by status | Active/inactive filter works | [ ] | |
| 11.5 | Create new user | User created with temp password | [ ] | |
| 11.6 | Edit user | User details updated | [ ] | |
| 11.7 | Deactivate user | User deactivated | [ ] | |
| 11.8 | Reset password | Password reset, user notified | [ ] | |
| 11.9 | Unlock account | Account unlocked | [ ] | |

---

## 12. Performance Tests

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 12.1 | Initial page load | < 3 seconds | [ ] | |
| 12.2 | Dashboard load | < 2 seconds | [ ] | |
| 12.3 | Work papers list (100+ records) | < 2 seconds | [ ] | |
| 12.4 | Work paper view | < 2 seconds | [ ] | |
| 12.5 | Dropdown population | < 1 second | [ ] | |
| 12.6 | Client cache hit | Instant (< 100ms) | [ ] | |
| 12.7 | Search/filter response | < 1 second | [ ] | |
| 12.8 | File upload (5MB) | < 10 seconds | [ ] | |

---

## 13. Role-Based Access Control

### SUPER_ADMIN
| # | Test Case | Status |
|---|-----------|--------|
| 13.1 | Access all modules | [ ] |
| 13.2 | Create/edit/delete all records | [ ] |
| 13.3 | Access settings | [ ] |
| 13.4 | Configure AI | [ ] |
| 13.5 | Manage users | [ ] |

### HEAD_OF_AUDIT
| # | Test Case | Status |
|---|-----------|--------|
| 13.6 | Access all modules except settings | [ ] |
| 13.7 | Approve/review work papers | [ ] |
| 13.8 | Verify action plans | [ ] |
| 13.9 | Cannot access AI config | [ ] |

### SENIOR_AUDITOR
| # | Test Case | Status |
|---|-----------|--------|
| 13.10 | Create work papers | [ ] |
| 13.11 | Review work papers | [ ] |
| 13.12 | Cannot manage users | [ ] |

### JUNIOR_STAFF
| # | Test Case | Status |
|---|-----------|--------|
| 13.13 | Create own work papers | [ ] |
| 13.14 | Cannot review others' work | [ ] |
| 13.15 | Cannot access reports | [ ] |

### AUDITEE
| # | Test Case | Status |
|---|-----------|--------|
| 13.16 | View assigned work papers only | [ ] |
| 13.17 | Respond to action plans | [ ] |
| 13.18 | Cannot create work papers | [ ] |

---

## 14. Edge Cases & Error Handling

| # | Test Case | Expected Result | Status | Notes |
|---|-----------|-----------------|--------|-------|
| 14.1 | Submit empty form | Validation errors shown | [ ] | |
| 14.2 | Upload invalid file type | Error message | [ ] | |
| 14.3 | Upload oversized file | Error message | [ ] | |
| 14.4 | Network error during save | Error toast, data not lost | [ ] | |
| 14.5 | Concurrent edit conflict | Warning shown | [ ] | |
| 14.6 | Access non-existent record | Error message, redirect | [ ] | |
| 14.7 | API timeout | Timeout error shown | [ ] | |
| 14.8 | AI service unavailable | Graceful fallback message | [ ] | |

---

## Test Summary

| Category | Total | Passed | Failed | N/A |
|----------|-------|--------|--------|-----|
| Authentication | 8 | | | |
| Dashboard | 10 | | | |
| Work Papers List | 17 | | | |
| Work Paper Form | 12 | | | |
| Work Paper View | 15 | | | |
| Action Plans List | 8 | | | |
| Action Plan View | 12 | | | |
| Settings | 19 | | | |
| Analytics | 19 | | | |
| Reports | 5 | | | |
| User Management | 9 | | | |
| Performance | 8 | | | |
| RBAC | 18 | | | |
| Edge Cases | 8 | | | |
| **TOTAL** | **168** | | | |

---

## Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Tester | | | |
| Developer | | | |
| Project Manager | | | |

---

*Testing Checklist v3.0 - January 2026*
