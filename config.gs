/** config.gs - Central configuration management
 * - Delta updates for validation lists (dropdowns, radios, checklists)
 * - Stored in Settings sheet -> key/value JSON
 */

function updateValidationSet(sheetName, columnName, options){
  try{
    const user = getCurrentUser();
    if (!user.permissions || !user.permissions.includes('manage_config')){
      throw new Error('Insufficient permissions');
    }
    const cfg = getConfig();
    const key = `validation:${sheetName}:${columnName}`;
    cfg[key] = options;
    return updateConfig(cfg);
  }catch(e){ return { success:false, error: e.message }; }
}

function getValidationSet(sheetName, columnName){
  try{
    const cfg = getConfig();
    const key = `validation:${sheetName}:${columnName}`;
    return cfg[key] || [];
  }catch(e){ return []; }
}
