/** ui.gs - UI helpers and responsiveness
 * - Server methods that UI can call to manage users/config safely
 * - Thin wrappers around users/config modules
 */

function uiAddRiskRating(value){ return updateConfigurationDelta({ addRiskRating: value }); }
function uiRemoveRiskRating(value){ return updateConfigurationDelta({ removeRiskRating: value }); }
function uiAddAuditStatus(value){ return updateConfigurationDelta({ addAuditStatus: value }); }
function uiRemoveAuditStatus(value){ return updateConfigurationDelta({ removeAuditStatus: value }); }

function uiCreateOrUpdateUser(userObj){ return createOrUpdateUser(userObj); }

