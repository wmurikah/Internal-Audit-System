function generateExecutiveReport() {
  const data = getDashboardData();
  const timestamp = new Date().toISOString();
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial; margin: 20px; }
        h1 { color: #1a237e; }
        .metric { 
          display: inline-block; 
          margin: 10px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 5px;
        }
        .metric-value { font-size: 24px; font-weight: bold; }
        .metric-label { color: #666; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f0f0f0; }
      </style>
    </head>
    <body>
      <h1>Executive Audit Report</h1>
      <p>Generated: ${timestamp}</p>
      
      <h2>Key Metrics</h2>
      <div class="metrics">
        <div class="metric">
          <div class="metric-value">${data.metrics.activeAudits}</div>
          <div class="metric-label">Active Audits</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.metrics.openIssues}</div>
          <div class="metric-label">Open Issues</div>
        </div>
        <div class="metric">
          <div class="metric-value">${data.metrics.overdueActions}</div>
          <div class="metric-label">Overdue Actions</div>
        </div>
      </div>
      
      <h2>Risk Distribution</h2>
      <table>
        <tr>
          <th>Risk Level</th>
          <th>Count</th>
        </tr>
        ${Object.entries(data.charts.riskDistribution)
          .map(([level, count]) => `
            <tr>
              <td>${level}</td>
              <td>${count}</td>
            </tr>
          `).join('')}
      </table>
      
      <h2>Recent Audits</h2>
      <table>
        <tr>
          <th>ID</th>
          <th>Title</th>
          <th>Status</th>
          <th>Business Unit</th>
        </tr>
        ${data.recentAudits.map(audit => `
          <tr>
            <td>${audit.id}</td>
            <td>${audit.title}</td>
            <td>${audit.status}</td>
            <td>${audit.business_unit}</td>
          </tr>
        `).join('')}
      </table>
    </body>
    </html>
  `;
  
  // Create PDF
  const blob = Utilities.newBlob(html, 'text/html', 'Executive_Report.html');
  const pdf = blob.getAs('application/pdf');
  const file = DriveApp.createFile(pdf);
  
  return {
    success: true,
    fileId: file.getId(),
    fileUrl: file.getUrl()
  };
}

function generateComplianceReport() {
  const audits = getSheetData('Audits');
  const issues = getSheetData('Issues');
  const actions = getSheetData('Actions');
  
  const completedAudits = audits.filter(a => a.status === 'Completed').length;
  const resolvedIssues = issues.filter(i => i.status === 'Resolved').length;
  const completedActions = actions.filter(a => a.status === 'Completed').length;
  
  const complianceRate = (
    (completedAudits + resolvedIssues + completedActions) / 
    (audits.length + issues.length + actions.length) * 100
  ).toFixed(2);
  
  return {
    totalAudits: audits.length,
    completedAudits,
    totalIssues: issues.length,
    resolvedIssues,
    totalActions: actions.length,
    completedActions,
    complianceRate: `${complianceRate}%`
  };
}
