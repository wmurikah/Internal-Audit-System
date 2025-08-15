/**
 * ===============================================================================
 * PHASE 3: AUTOMATED PERFORMANCE MAINTENANCE
 * This is a separate file: PerformanceTriggers.gs
 * ===============================================================================
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
    
    // Dashboard snapshot rebuild every 10 minutes
    ScriptApp.newTrigger('buildDashboardSnapshot')
      .timeBased()
      .everyMinutes(10)
      .create();
    
    // Rebuild on sheet changes
    ScriptApp.newTrigger('onSheetChange')
      .forSpreadsheet(SPREADSHEET_ID)
      .onChange()
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

function onSheetChange(e) {
  try {
    console.log('Sheet change detected, rebuilding caches...');
    
    // Rebuild dashboard snapshot when data changes
    buildDashboardSnapshot();
    
    // Clear relevant caches
    const cache = CacheService.getScriptCache();
    cache.removeAll(['sheet_Audits_v2', 'sheet_Issues_v2', 'sheet_Actions_v2']);
    
  } catch (error) {
    console.log('Sheet change handler error: ' + error.message);
  }
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
    
    buildDashboardSnapshot();
    
    console.log('🔥 Cache warming completed!');
    return { success: true, message: 'All caches warmed successfully' };
    
  } catch (error) {
    console.log(`❌ Cache warming failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
