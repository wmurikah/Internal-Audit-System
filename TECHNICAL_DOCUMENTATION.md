# HASS PETROLEUM INTERNAL AUDIT SYSTEM - Technical Documentation

## Version 3.0 - January 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Performance Optimizations](#3-performance-optimizations)
4. [New Features](#4-new-features)
5. [API Reference](#5-api-reference)
6. [Deployment Guide](#6-deployment-guide)
7. [Security Considerations](#7-security-considerations)

---

## 1. System Overview

### Purpose
The Hass Petroleum Internal Audit Management System is a web application built on Google Apps Script that manages the complete audit lifecycle including work paper creation, review workflows, action plan tracking, and analytics.

### Technology Stack
- **Backend**: Google Apps Script (server-side JavaScript)
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **UI Framework**: Bootstrap 5.3
- **Charts**: Chart.js
- **Database**: Google Sheets
- **File Storage**: Google Drive
- **Authentication**: Custom session-based auth with PBKDF2 password hashing

### Key Features
- Work paper management with multi-step approval workflow
- Action plan tracking with overdue monitoring
- Role-based access control (RBAC)
- AI-powered insights and validation
- Real-time analytics dashboard
- File attachment support via Google Drive
- Email notifications

---

## 2. Architecture

### File Structure

```
Internal-Audit-System/
├── 00_Migration.gs          # Database migration utilities
├── 01_Core.gs               # Core utilities, sheet access, caching
├── 02_Config.gs             # Configuration, schemas, dropdowns
├── 03_WorkPaperService.gs   # Work paper CRUD operations
├── 04_ActionPlanService.gs  # Action plan CRUD operations
├── 05_AIService.gs          # AI integration (NEW)
├── 06_DashboardService.gs   # Dashboard data aggregation
├── 07_AuthService.gs        # Authentication & authorization
├── 08_WebApp.gs             # Web app entry, API routing
├── 09_AnalyticsService.gs   # Analytics & reporting (NEW)
├── AuditorPortal.html       # Main portal container
├── Login.html               # Login page
├── Dashboard.html           # Dashboard UI
├── Workpaperslist.html      # Work papers list
├── Workpaperform.html       # Work paper form
├── Workpaperview.html       # Work paper detail view
├── Actionplanslist.html     # Action plans list
├── Actionplanview.html      # Action plan detail view
├── Settings.html            # Settings module (NEW)
├── Analytics.html           # Analytics dashboard (NEW)
├── Reports.html             # Reports page
├── Users.html               # User management
├── Modals.html              # Shared modal dialogs
├── Scripts.html             # Core JavaScript
├── Styles.html              # CSS styles
├── DATABASE_MAPPING.md      # Database schema documentation
└── TECHNICAL_DOCUMENTATION.md  # This file
```

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser       │────►│  Google Apps     │────►│  Google Sheets  │
│   (Frontend)    │◄────│  Script (API)    │◄────│  (Database)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌──────────────────┐
                        │  Google Drive    │
                        │  (File Storage)  │
                        └──────────────────┘
```

### API Communication

Frontend communicates with backend via `google.script.run`:

```javascript
// Client-side API call wrapper
function apiCall(action, data) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(reject)
      .apiCall(action, data);
  });
}

// Server-side routing
function apiCall(action, data) {
  const user = getCurrentUser();
  return routeAction(action, data, user);
}
```

---

## 3. Performance Optimizations

### 3.1 Server-Side Caching

The system uses Google's `CacheService` for server-side caching:

```javascript
const CONFIG = {
  CACHE_TTL: {
    DROPDOWNS: 1800,      // 30 minutes
    USER_BY_EMAIL: 300,   // 5 minutes
    SESSION: 300,         // 5 minutes
    INDEX_MAP: 600,       // 10 minutes
    HEADERS: 3600         // 1 hour
  }
};
```

**Cached Items:**
- Dropdown data (affiliates, audit areas, users)
- User lookups by email
- Session tokens
- Index maps for fast lookups
- Sheet headers

### 3.2 Client-Side Caching

New `ClientCache` object for browser-side caching:

```javascript
const ClientCache = {
  _cache: new Map(),
  _ttls: new Map(),

  set(key, value, ttlMs = 300000) { /* ... */ },
  get(key) { /* ... */ },
  has(key) { /* ... */ },
  invalidate(pattern) { /* ... */ }
};
```

### 3.3 Index Tables

Three index sheets provide O(1) lookups:

| Index Sheet | Purpose | Key Fields |
|-------------|---------|------------|
| 17_Index_WorkPapers | Fast WP lookup | work_paper_id, row_number, status |
| 18_Index_ActionPlans | Fast AP lookup | action_plan_id, row_number, status |
| 19_Index_Users | Fast user lookup | user_id, row_number, email |

### 3.4 Batch Operations

```javascript
// Batch insert multiple records
DB.batchInsert('ACTION_PLAN', plansArray);

// Batch update multiple records
DB.batchUpdate('WORK_PAPER', [{id: 'WP-001', data: {...}}, ...]);
```

### 3.5 Parallel Data Loading

```javascript
// Load multiple data sources in parallel
const results = await loadParallel([
  { action: 'getDashboardData', data: {} },
  { action: 'getDropdownData', data: {} },
  { action: 'getNotifications', data: { limit: 5 } }
]);
```

### 3.6 Debounce & Throttle

```javascript
// Debounced search input
const debouncedSearch = debounce(filterWorkPapers, 300);
document.getElementById('searchInput').addEventListener('keyup', debouncedSearch);

// Throttled scroll handler
const throttledScroll = throttle(handleScroll, 100);
window.addEventListener('scroll', throttledScroll);
```

---

## 4. New Features

### 4.1 Settings Module

**Location:** `Settings.html`

**Components:**
- **Access Control Panel**: View and edit role permissions
- **AI Configuration**: Configure AI API providers (OpenAI, Anthropic, Google AI)
- **System Config**: Modify system-wide settings
- **Audit Log**: View system activity log

**Required Role:** SUPER_ADMIN

### 4.2 AI Service

**Location:** `05_AIService.gs`

**Features:**
- Multi-provider support (OpenAI, Anthropic, Google AI)
- Secure API key storage in Script Properties
- Work paper insights generation
- Action plan validation
- Analytics insights

**API Key Storage:**
```javascript
// Keys stored in Script Properties (encrypted)
const props = PropertiesService.getScriptProperties();
props.setProperty('AI_API_KEY_OPENAI', apiKey);
```

**Usage:**
```javascript
// Get AI insights for work paper
const insights = getWorkPaperInsights(workPaperId, user);

// Validate action plan
const validation = validateActionPlan(actionPlanData, wpContext, user);
```

### 4.3 Analytics Dashboard

**Location:** `Analytics.html`, `09_AnalyticsService.gs`

**Components:**
- KPI cards (total findings, action plans, implementation rate, overdue)
- Interactive charts (status distribution, risk, trends, aging)
- High-risk findings table
- Overdue action plans table
- Auditor performance metrics
- AI-powered strategic insights
- CSV export capability

### 4.4 Work Paper AI Insights

**Location:** `Workpaperview.html`

The AI Insights card provides:
- Quality assessment of the finding
- Risk rating validation
- Recommendation enhancement suggestions
- Root cause analysis
- Best practice tips

---

## 5. API Reference

### Authentication APIs

| Action | Parameters | Description |
|--------|------------|-------------|
| `login` | email, password | User login |
| `logout` | - | User logout |
| `changePassword` | currentPassword, newPassword | Change user password |
| `getInitData` | - | Get user info, dropdowns, permissions |

### Work Paper APIs

| Action | Parameters | Description |
|--------|------------|-------------|
| `getWorkPapers` | filters | Get filtered work papers list |
| `getWorkPaper` | workPaperId, includeRelated | Get single work paper |
| `createWorkPaper` | (form data) | Create new work paper |
| `updateWorkPaper` | workPaperId, (data) | Update work paper |
| `deleteWorkPaper` | workPaperId | Delete work paper |
| `submitWorkPaper` | workPaperId | Submit for review |
| `reviewWorkPaper` | workPaperId, action, comments | Approve/return |
| `sendToAuditee` | workPaperId | Send to auditee |

### Action Plan APIs

| Action | Parameters | Description |
|--------|------------|-------------|
| `getActionPlans` | filters | Get filtered action plans |
| `getActionPlan` | actionPlanId, includeRelated | Get single action plan |
| `createActionPlan` | (form data) | Create action plan |
| `updateActionPlan` | actionPlanId, (data) | Update action plan |
| `markAsImplemented` | actionPlanId, implementationNotes | Mark complete |
| `verifyImplementation` | actionPlanId, action, comments | Verify implementation |

### AI APIs

| Action | Parameters | Description |
|--------|------------|-------------|
| `getAIConfigStatus` | - | Get AI provider status |
| `setAIApiKey` | provider, apiKey | Set API key |
| `removeAIApiKey` | provider | Remove API key |
| `setActiveAIProvider` | provider | Set active provider |
| `testAIConnection` | provider | Test API connectivity |
| `getWorkPaperInsights` | workPaperId | Get AI insights |
| `validateActionPlan` | actionPlan, workPaperContext | Validate action plan |
| `getAnalyticsInsights` | analyticsData | Get analytics insights |

### Analytics APIs

| Action | Parameters | Description |
|--------|------------|-------------|
| `getAnalyticsData` | year | Get comprehensive analytics |
| `getDashboardData` | - | Get dashboard summary |

### Settings APIs

| Action | Parameters | Description |
|--------|------------|-------------|
| `getPermissions` | roleCode | Get role permissions |
| `updatePermissions` | roleCode, permissions | Update permissions |
| `getUserStats` | - | Get user statistics |
| `getSystemConfig` | - | Get system configuration |
| `saveSystemConfig` | config | Save configuration |
| `getAuditLog` | action, page, pageSize | Get audit logs |
| `rebuildAllIndexes` | - | Rebuild all index tables |

---

## 6. Deployment Guide

### Prerequisites
1. Google Workspace account with Apps Script access
2. Google Sheets database file
3. Google Drive folder for file uploads

### Deployment Steps

1. **Create Apps Script Project**
   ```
   - Go to script.google.com
   - Create new project
   - Copy all .gs and .html files
   ```

2. **Configure Database**
   ```
   - Create Google Sheets with all required tabs
   - Update SPREADSHEET_ID in 01_Core.gs
   - Run migration script if upgrading
   ```

3. **Configure File Storage**
   ```
   - Create Google Drive folder for uploads
   - Set AUDIT_FILES_FOLDER_ID in 00_Config sheet
   ```

4. **Deploy Web App**
   ```
   - Deploy > New deployment
   - Select "Web app"
   - Execute as: "User accessing the web app"
   - Who has access: "Anyone with Google Account" or your domain
   ```

5. **Configure AI (Optional)**
   ```
   - Login as SUPER_ADMIN
   - Navigate to Settings > AI Configuration
   - Enter API key for preferred provider
   - Set as active provider
   ```

### Environment Variables (Script Properties)

| Property | Description |
|----------|-------------|
| AI_API_KEY_OPENAI | OpenAI API key |
| AI_API_KEY_ANTHROPIC | Anthropic API key |
| AI_API_KEY_GOOGLE_AI | Google AI API key |

---

## 7. Security Considerations

### Password Security
- Passwords hashed with PBKDF2 (10,000 iterations)
- Unique salt per user
- Minimum 8 characters enforced
- Account lockout after 5 failed attempts (30 minutes)

### Session Management
- Session tokens generated with UUID
- 24-hour session expiry
- Sessions invalidated on logout
- Expired sessions cleaned up automatically

### API Key Security
- Stored in Script Properties (encrypted by Google)
- Only SUPER_ADMIN can view/modify
- Keys masked in UI (shows only last 4 characters)
- All key changes logged in audit trail

### Data Access
- Role-based permissions enforced at API level
- Users can only access own work papers (unless reviewer)
- Action plan owners restricted to assigned users
- All CRUD operations logged

### Input Validation
- Server-side validation for all inputs
- XSS prevention via escapeHtml()
- SQL injection not applicable (Sheets API)
- File upload restrictions (size, type validation)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0 | Jan 2026 | Added AI service, Analytics dashboard, Settings module, Performance optimizations |
| 2.0 | Oct 2025 | Added index tables, batch operations, improved caching |
| 1.0 | Jul 2025 | Initial release |

---

*Document generated: January 2026*
*For support, contact: IT Department*
