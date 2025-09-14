/**
 * RISK REGISTER - Universal Threat Matrix
 */

function createRisk(riskData) {
  const user = getCurrentUser();
  riskData.created_by = user.email;
  riskData.status = 'Open';
  return addRow('RiskRegister', riskData);
}

function updateRisk(id, updates) {
  return updateRow('RiskRegister', id, updates);
}

function listRisks() {
  return getSheetData('RiskRegister');
}

function getRisksByUnit(unit) {
  return getSheetData('RiskRegister')
    .filter(r => r.unit === unit);
}

function mitigateRisk(id, mitigationPlan) {
  return updateRow('RiskRegister', id, {
    status: 'Mitigated',
    mitigation_plan: mitigationPlan,
    mitigated_at: new Date()
  });
}

function calculateRiskScore(risk) {
  const scores = { 'Extreme': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
  return scores[risk.inherent_rating] || 0;
}

function getRiskHeatMap() {
  const risks = getSheetData('RiskRegister');
  const heatMap = {};
  
  risks.forEach(risk => {
    if (!heatMap[risk.unit]) {
      heatMap[risk.unit] = { Extreme: 0, High: 0, Medium: 0, Low: 0 };
    }
    heatMap[risk.unit][risk.inherent_rating]++;
  });
  
  return heatMap;
}
