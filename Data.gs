/**
 * CONFIGURATION MANAGEMENT MODULE
 * Centralized system configuration with validation and defaults
 */

/**
 * Gets system configuration with fallback to defaults
 */
function getConfig() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let settingsSheet = ss.getSheetByName('Settings');
    
    if (!settingsSheet || settingsSheet.getLastRow() <= 1) {
      Logger.log('Settings sheet not found or empty, initializing defaults');
      return initializeDefaults();
    }
    
    const data = settingsSheet.getDataRange().getValues();
    const config = {};
    
    // Skip header row
    data.slice(1).forEach(row => {
      if (row[0] && row[1]) {
        try {
          config[row[0]] = JSON.parse(row[1]);
        } catch (e) {
          config[row[0]] = row[1]; // Store as string if not JSON
        }
      }
    });
    
    return validateAndFillDefaults(config);
    
  } catch (error) {
    Logger.log('getConfig error: ' + error.toString());
    return getDefaultConfig();
  }
}

/**
 * Updates system configuration
 */
function updateConfig(newConfig) {
  try {
    const user = getCurrentUser();
    if (!user.permissions.includes('manage_config')) {
      throw new Error('Insufficient permissions to update configuration');
    }
    
    const validatedConfig = validateConfig(newConfig);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Settings');
    
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
      sheet.getRange('A1:E1').setValues([['key', 'value', 'description', 'updated_by', 'updated_at']]);
    } else {
      sheet.clear();
      sheet.getRange('A1:E1').setValues([['key', 'value', 'description', 'updated_by', 'updated_at']]);
    }
    
    let row = 2;
    Object.entries(validatedConfig).forEach(([key, value]) => {
      const description = getConfigDescription(key);
      sheet.getRange(`A${row}:E${row}`).setValues([[
        key, 
        JSON.stringify(value),
        description,
        user.email,
        new Date()
      ]]);
      row++;
    });
    
    // Log configuration change
    logAction('Config', 'system', 'update_config', {}, {
      updated_by: user.email,
      config_keys: Object.keys(validatedConfig)
    });
    
    return { success: true, message: 'Configuration updated successfully' };
    
  } catch (error) {
    Logger.log('updateConfig error: ' + error.toString());
    return { success: false, error: error.message };
  }
}

/**
 * Initializes default configuration
 */
function initializeDefaults() {
  const defaultConfig = getDefaultConfig();
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Settings');
    
    if (!sheet) {
      sheet = ss.insertSheet('Settings');
    } else {
      sheet.clear();
    }
    
    sheet.getRange('A1:E1').setValues([['key', 'value', 'description', 'updated_by', 'updated_at']]);
    
    let row = 2;
    Object.entries(defaultConfig).forEach(([key, value]) => {
      const description = getConfigDescription(key);
      sheet.getRange(`A${row}:E${row}`).setValues([[
        key, 
        JSON.stringify(value),
        description,
        'system',
        new Date()
      ]]);
      row++;
    });
    
    Logger.log('Default configuration initialized');
    return defaultConfig;
    
  } catch (error) {
    Logger.log('initializeDefaults error: ' + error.toString());
    return defaultConfig;
  }
}

/**
 * Returns default system configuration
 */
function getDefaultConfig() {
  return {
    riskRatings: ['Extreme', 'High', 'Medium', 'Low'],
    auditStatuses: ['Planning', 'In Progress', 'Review', 'Completed', 'Closed'],
    issueStatuses: ['Open', 'In Progress', 'Under Review', 'Resolved', 'Closed', 'Reopened'],
    actionStatuses: ['Not Started', 'In Progress', 'Pending Review', 'Completed', 'Rejected', 'Overdue'],
    workPaperStatuses: ['Draft', 'Submitted for Review', 'Approved', 'Returned'],
    businessUnits: ['Fleet Logistics Kenya', 'Finance', 'Operations', 'HR', 'IT', 'Compliance', 'Legal', 'Procurement'],
    affiliates: ['Group', 'Kenya', 'Uganda', 'Tanzania', 'Rwanda', 'South Sudan', 'DRC'],
    riskCategories: ['Operational', 'Financial', 'Compliance', 'Strategic', 'Reputational', 'Technology'],
    OPENAI_API_KEY: '',
    SYSTEM_EMAIL: 'audit@company.com',
    EMAIL_NOTIFICATIONS: true,
    AUTO_ASSIGN_ACTIONS: false,
    REQUIRE_EVIDENCE: true,
    MAX_FILE_SIZE_MB: 10
  };
}

/**
 * Validates configuration and fills missing defaults
 */
function validateAndFillDefaults(config) {
  const defaults = getDefaultConfig();
  const validated = { ...config };
  
  Object.keys(defaults).forEach(key => {
    if (!validated[key] || 
        (Array.isArray(defaults[key]) && (!Array.isArray(validated[key]) || validated[key].length === 0))) {
      validated[key] = defaults[key];
    }
  });
  
  return validated;
}

/**
 * Validates configuration values
 */
function validateConfig(config) {
  const validated = { ...config };
  const defaults = getDefaultConfig();
  
  // Validate required arrays
  const requiredArrays = ['riskRatings', 'auditStatuses', 'issueStatuses', 'actionStatuses', 'businessUnits', 'affiliates'];
  requiredArrays.forEach(key => {
    if (!Array.isArray(validated[key]) || validated[key].length === 0) {
      validated[key] = defaults[key];
    }
  });
  
  // Validate API key format
  if (validated.OPENAI_API_KEY && !validated.OPENAI_API_KEY.startsWith('sk-')) {
    throw new Error('Invalid OpenAI API key format');
  }
  
  // Validate file size limit
  if (validated.MAX_FILE_SIZE_MB && (isNaN(validated.MAX_FILE_SIZE_MB) || validated.MAX_FILE_SIZE_MB <= 0)) {
    validated.MAX_FILE_SIZE_MB = defaults.MAX_FILE_SIZE_MB;
  }
  
  return validated;
}

/**
 * Gets description for configuration keys
 */
function getConfigDescription(key) {
  const descriptions = {
    riskRatings: 'Risk severity levels for audit findings',
    auditStatuses: 'Possible statuses for audit engagements',
    issueStatuses: 'Lifecycle statuses for audit issues',
    actionStatuses: 'Status options for corrective actions',
    workPaperStatuses: 'Workflow statuses for work papers',
    businessUnits: 'Organizational units for audit scope',
    affiliates: 'Company affiliates and subsidiaries',
    riskCategories: 'Categories for risk classification',
    OPENAI_API_KEY: 'API key for AI-powered audit assistance',
    SYSTEM_EMAIL: 'Default email address for system notifications',
    EMAIL_NOTIFICATIONS: 'Enable/disable email notifications',
    AUTO_ASSIGN_ACTIONS: 'Automatically assign actions to issue owners',
    REQUIRE_EVIDENCE: 'Require evidence upload for issue resolution',
    MAX_FILE_SIZE_MB: 'Maximum file size for evidence uploads (MB)'
  };
  
  return descriptions[key] || 'System configuration parameter';
}


/**
 * BULK DATA API - ONE CALL FOR EVERYTHING
 */
function getBulkDataUltraFast() {
  const startTime = Date.now();
  
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const bulkData = {};
    
    // Read all sheets in parallel (conceptually)
    ['Audits', 'Issues', 'Actions', 'Users', 'WorkPapers', 'Evidence'].forEach(sheetName => {
      try {
        const sheet = ss.getSheetByName(sheetName);
        if (sheet && sheet.getLastRow() > 1) {
          const data = sheet.getDataRange().getValues();
          const headers = data[0];
          
          bulkData[sheetName] = data.slice(1)
            .filter(row => row.some(cell => cell !== ''))
            .map(row => {
              const obj = {};
              headers.forEach((header, index) => {
                const value = row[index];
                obj[header] = value instanceof Date ? value.toISOString().split('T')[0] : (value || '');
              });
              return obj;
            })
            .filter(row => row.id);
        } else {
          bulkData[sheetName] = [];
        }
      } catch (e) {
        Logger.log(`Error reading ${sheetName}: ${e.message}`);
        bulkData[sheetName] = [];
      }
    });
    
    const loadTime = Date.now() - startTime;
    Logger.log(`🚀 Bulk data loaded: ${loadTime}ms`);
    
    return {
      ...bulkData,
      metadata: {
        loadTime,
        totalRecords: Object.values(bulkData).reduce((sum, arr) => sum + arr.length, 0)
      }
    };
    
  } catch (error) {
    Logger.log(`Bulk data error: ${error.message}`);
    throw error;
  }
}

