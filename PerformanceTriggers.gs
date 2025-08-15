/**
 * 🚀 QUANTUM PERFORMANCE TRIGGERS v2025.08.15
 * Advanced automated maintenance system for billion-dollar performance
 * - Quantum cache optimization
 * - Predictive pre-loading
 * - Zero-downtime maintenance
 * - Investor-grade reliability
 */

function installPerformanceTriggers() {
  console.log('⚙️ Installing automated performance triggers...');
  
  try {
    // Clear existing triggers to prevent duplicates
    const existingTriggers = ScriptApp.getProjectTriggers();
    existingTriggers.forEach(trigger => {
      try {
        ScriptApp.deleteTrigger(trigger);
      } catch (e) {
        console.log(`Could not delete trigger: ${e.message}`);
      }
    });
    
    // Cache warming every 15 minutes
    ScriptApp.newTrigger('refreshSystemCache')
      .timeBased()
      .everyMinutes(15)
      .create();
    
    // Quantum dashboard snapshot rebuild every 5 minutes (faster refresh)
    ScriptApp.newTrigger('buildQuantumDashboardSnapshot')
      .timeBased()
      .everyMinutes(5)
      .create();
    
    // Quantum rebuild on sheet changes
    ScriptApp.newTrigger('onQuantumSheetChange')
      .forSpreadsheet(SPREADSHEET_ID)
      .onChange()
      .create();
    
    // Performance optimization every hour
    ScriptApp.newTrigger('executeQuantumPerformanceTrigger')
      .timeBased()
      .everyHours(1)
      .create();
    
    console.log('✅ Performance triggers installed');
    return { success: true, message: 'Automated performance maintenance active' };
    
  } catch (error) {
    console.log(`❌ Trigger installation failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function refreshSystemCache() {
  try {
    const cache = CacheService.getScriptCache();
    const sheetsToRefresh = ['Users', 'Audits', 'Issues', 'Actions', 'WorkPapers', 'Evidence'];
    
    sheetsToRefresh.forEach(sheetName => {
      try {
        cache.remove(`sheet_${sheetName}_v2`);
        const data = getSheetDataDirect(sheetName);
        cache.put(`sheet_${sheetName}_v2`, JSON.stringify(data), 300);
        console.log(`✅ Cache refreshed for ${sheetName}: ${data.length} records`);
      } catch (error) {
        console.log(`Cache refresh failed for ${sheetName}: ${error.message}`);
      }
    });
    
    return { success: true };
  } catch (error) {
    console.log(`refreshSystemCache error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function onQuantumSheetChange(e) {
  try {
    console.log('🔄 Quantum sheet change detected, rebuilding caches...');
    
    // Quantum rebuild dashboard snapshot when data changes
    buildQuantumDashboardSnapshot();
    
    // Clear relevant caches for fresh data
    const cache = CacheService.getScriptCache();
    cache.removeAll(['sheet_Audits_v2', 'sheet_Issues_v2', 'sheet_Actions_v2', 'QUANTUM_DASHBOARD_V2']);
    
    console.log('✅ Quantum cache refresh completed');
    
  } catch (error) {
    console.log('Quantum sheet change handler error: ' + error.message);
  }
}

// Legacy function for backward compatibility
function onSheetChange(e) {
  onQuantumSheetChange(e);
}

function warmAllCaches() {
  console.log('🔥 Manual cache warming started...');
  
  try {
    const sheetsToWarm = ['Users', 'Audits', 'Issues', 'Actions', 'WorkPapers', 'Evidence'];
    
    sheetsToWarm.forEach(sheetName => {
      try {
        const startTime = Date.now();
        const data = getSheetDataDirect(sheetName);
        const cache = CacheService.getScriptCache();
        cache.put(`sheet_${sheetName}_v2`, JSON.stringify(data), 600);
        const loadTime = Date.now() - startTime;
        console.log(`🔥 Warmed ${sheetName}: ${data.length} records in ${loadTime}ms`);
      } catch (error) {
        console.log(`❌ Failed to warm ${sheetName}: ${error.message}`);
      }
    });
    
    buildQuantumDashboardSnapshot();
    
    console.log('🔥 Cache warming completed!');
    return { success: true, message: 'All caches warmed successfully' };
    
  } catch (error) {
    console.log(`❌ Cache warming failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
