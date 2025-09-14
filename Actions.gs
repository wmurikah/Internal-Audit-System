/**
 * ACTION PLANS - Corrective Measures Control
 */

function createAction(actionData) {
  const user = getCurrentUser();
  actionData.created_by = user.email;
  actionData.status = 'Not Started';
  return addRow('Actions', actionData);
}

function updateAction(id, updates) {
  return updateRow('Actions', id, updates);
}

function listActions() {
  const user = getCurrentUser();
  const actions = getSheetData('Actions');
  
  if (user.role === 'Auditee') {
    return actions.filter(a => a.assignee_email === user.email);
  }
  
  return actions;
}

function completeAction(id) {
  return updateRow('Actions', id, {
    status: 'Completed',
    completed_at: new Date()
  });
}

function getOverdueActions() {
  const today = new Date();
  return getSheetData('Actions').filter(action => {
    if (action.status === 'Completed') return false;
    if (!action.due_date) return false;
    return new Date(action.due_date) < today;
  });
}
