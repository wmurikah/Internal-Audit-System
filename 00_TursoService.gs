// 00_TursoService.gs — Turso (libSQL) database layer
// Replaces 00_FirestoreService.gs as the sole data store.
//
// SETUP:
//   1. Project Settings → Script Properties, add:
//      TURSO_DATABASE_URL  e.g. https://hassaudit-wmurikah.turso.io
//      TURSO_AUTH_TOKEN    your database auth token
//   2. Run setupTursoCredentials(url, token) once from the editor to validate.

// ─────────────────────────────────────────────────────────────
// Credentials
// ─────────────────────────────────────────────────────────────

function getTursoConfig_() {
  const props = PropertiesService.getScriptProperties();
  const url   = props.getProperty('TURSO_DATABASE_URL');
  const token = props.getProperty('TURSO_AUTH_TOKEN');
  if (!url || !token) throw new Error('Turso credentials not set in Script Properties');
  return { url, token };
}

// ─────────────────────────────────────────────────────────────
// Arg serialisation
// ─────────────────────────────────────────────────────────────

function toArg_(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float',   value: String(v) };
  }
  return { type: 'text', value: String(v) };
}

// ─────────────────────────────────────────────────────────────
// Core HTTP executor
// ─────────────────────────────────────────────────────────────

function tursoExecute_(requests) {
  const cfg = getTursoConfig_();
  const response = UrlFetchApp.fetch(cfg.url + '/v2/pipeline', {
    method:           'post',
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Content-Type':  'application/json'
    },
    payload:          JSON.stringify({ requests: requests }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) throw new Error('Turso HTTP ' + code + ': ' + text);

  const parsed = JSON.parse(text);
  const results = parsed.results;
  if (!Array.isArray(results)) {
    throw new Error('Unexpected Turso response: ' + text.substring(0, 300));
  }

  results.forEach(function(r) {
    if (r.type === 'error') throw new Error(r.error.message);
  });

  return results;
}

// ─────────────────────────────────────────────────────────────
// Row parser
// ─────────────────────────────────────────────────────────────

// result is results[n].response.result  (cols + rows from a SELECT)
function parseRows_(result) {
  if (!result || !result.cols) return [];
  const cols = result.cols.map(function(c) { return c.name; });
  return (result.rows || []).map(function(row) {
    const obj = {};
    row.forEach(function(cell, i) {
      if (!cell || cell.type === 'null') {
        obj[cols[i]] = null;
      } else if (cell.type === 'integer' || cell.type === 'float') {
        obj[cols[i]] = Number(cell.value);
      } else {
        obj[cols[i]] = String(cell.value);
      }
    });
    return obj;
  });
}

// ─────────────────────────────────────────────────────────────
// Pipeline builders
// ─────────────────────────────────────────────────────────────

// Use for any statement that modifies data or uses foreign keys.
// Actual stmt results begin at results[2] (indices 0–1 are PRAGMA results).
function withPragmas_(stmts) {
  return [
    { type: 'execute', stmt: { sql: 'PRAGMA foreign_keys = ON' } },
    ...stmts,
    { type: 'close' }
  ];
}

// Use for pure SELECT pipelines. Actual stmt result is at results[0].
function readOnly_(stmts) {
  return [...stmts, { type: 'close' }];
}

// ─────────────────────────────────────────────────────────────
// Table & primary-key resolution
// ─────────────────────────────────────────────────────────────

const TURSO_TABLES = {
  '05_Users':                  'users',
  '06_Affiliates':             'affiliates',
  '07_AuditAreas':             'audit_areas',
  '08_ProcessSubAreas':        'sub_areas',
  '09_WorkPapers':             'work_papers',
  '10_WorkPaperRequirements':  'work_paper_requirements',
  '11_WorkPaperFiles':         'files',
  '12_WorkPaperRevisions':     'work_paper_revisions',
  '13_ActionPlans':            'action_plans',
  '14_ActionPlanEvidence':     'files',
  '15_ActionPlanHistory':      'action_plan_history',
  '20_Sessions':               'sessions',
  '00_Config':                 'config',
  '01_Roles':                  'roles',
  '02_Permissions':            'role_permissions',
  '16_AuditLog':               'audit_log',
  '21_NotificationQueue':      'notification_queue',
  '22_EmailTemplates':         'email_templates',
  '24_AuditeeResponses':       'auditee_responses'
};

// Tables that have no deleted_at column — WHERE clause is omitted in reads.
const TABLES_WITHOUT_DELETED_AT = {
  'roles':            true,
  'role_permissions': true,
  'config':           true
};

// Primary-key column per table. null = composite — callers must use tursoQuery_SQL.
// Assumption: affiliates PK is affiliate_code even though the full natural key
// may include organization_id; use tursoQuery_SQL for multi-tenant affiliate lookups.
const TURSO_PK = {
  'users':                   'user_id',
  'affiliates':              'affiliate_code',
  'audit_areas':             'area_id',
  'sub_areas':               'sub_area_id',
  'work_papers':             'work_paper_id',
  'work_paper_requirements': 'requirement_id',
  'files':                   'file_id',
  'work_paper_revisions':    'revision_id',
  'action_plans':            'action_plan_id',
  'action_plan_history':     'history_id',
  'sessions':                'session_id',
  'config':                  'config_key',
  'roles':                   'role_code',
  'role_permissions':        null,   // composite (role_code + permission_code)
  'audit_log':               'log_id',
  'notification_queue':      'notification_id',
  'email_templates':         'template_code',
  'auditee_responses':       'response_id'
};

function resolveTable_(sheetName) {
  const t = TURSO_TABLES[sheetName];
  if (!t) throw new Error('No Turso table mapped for sheet: ' + sheetName);
  return t;
}

function resolvePK_(table) {
  if (!(table in TURSO_PK)) throw new Error('No PK mapped for table: ' + table);
  return TURSO_PK[table]; // may be null for composite-key tables
}

// ─────────────────────────────────────────────────────────────
// Public API — CRUD methods (tursoGet, tursoGetAll, tursoQuery, tursoSet, tursoUpdate, tursoDelete)
// ─────────────────────────────────────────────────────────────

/**
 * Fetch a single row by primary key.
 * Returns the row object or null if not found / soft-deleted.
 */
function tursoGet(sheetName, docId) {
  try {
    const table = resolveTable_(sheetName);
    const pk    = resolvePK_(table);
    if (!pk) throw new Error('Table ' + table + ' has a composite PK — use tursoQuery_SQL');

    let sql = 'SELECT * FROM ' + table + ' WHERE ' + pk + ' = ?';
    if (!TABLES_WITHOUT_DELETED_AT[table]) sql += ' AND deleted_at IS NULL';

    const results = tursoExecute_(readOnly_([
      { type: 'execute', stmt: { sql: sql, args: [toArg_(docId)] } }
    ]));
    const rows = parseRows_(results[0].response.result);
    return rows.length > 0 ? rows[0] : null;
  } catch (e) {
    throw new Error('[TursoService.tursoGet] ' + e.message);
  }
}

/**
 * Fetch all non-deleted rows, newest first.
 * Assumption: all tables have a created_at column in the Turso schema;
 * tables without deleted_at (roles, role_permissions, config) skip the WHERE clause.
 */
function tursoGetAll(sheetName) {
  try {
    const table = resolveTable_(sheetName);

    let sql = 'SELECT * FROM ' + table;
    if (!TABLES_WITHOUT_DELETED_AT[table]) sql += ' WHERE deleted_at IS NULL';
    sql += ' ORDER BY created_at DESC';

    const results = tursoExecute_(readOnly_([
      { type: 'execute', stmt: { sql: sql } }
    ]));
    return parseRows_(results[0].response.result);
  } catch (e) {
    throw new Error('[TursoService.tursoGetAll] ' + e.message);
  }
}

/**
 * Query rows where field matches value.
 * Supported ops: '==', '!=', '<', '<=', '>', '>=', 'array-contains'
 * 'array-contains' maps to a LIKE '%' || ? || '%' for CSV-stored lists.
 */
function tursoQuery(sheetName, field, op, value) {
  try {
    const table = resolveTable_(sheetName);
    let sql, args;

    if (op === 'array-contains') {
      sql  = "SELECT * FROM " + table + " WHERE " + field + " LIKE '%' || ? || '%'";
      args = [toArg_(value)];
    } else if (op === '==') {
      sql  = 'SELECT * FROM ' + table + ' WHERE ' + field + ' = ?';
      args = [toArg_(value)];
    } else {
      // '!=', '<', '<=', '>', '>='
      sql  = 'SELECT * FROM ' + table + ' WHERE ' + field + ' ' + op + ' ?';
      args = [toArg_(value)];
    }

    if (!TABLES_WITHOUT_DELETED_AT[table]) sql += ' AND deleted_at IS NULL';

    const results = tursoExecute_(readOnly_([
      { type: 'execute', stmt: { sql: sql, args: args } }
    ]));
    return parseRows_(results[0].response.result);
  } catch (e) {
    throw new Error('[TursoService.tursoQuery] ' + e.message);
  }
}

/**
 * Insert or replace a row (full upsert — overwrites all columns).
 * Callers must supply all required columns in data; missing columns receive NULL.
 */
function tursoSet(sheetName, docId, data) {
  try {
    const table = resolveTable_(sheetName);
    const now   = new Date().toISOString();
    const row   = Object.assign({}, data);
    if (!row.updated_at) row.updated_at = now;

    const cols         = Object.keys(row);
    const placeholders = cols.map(function() { return '?'; }).join(', ');
    const args         = cols.map(function(c) { return toArg_(row[c]); });
    const sql          = 'INSERT OR REPLACE INTO ' + table +
                         ' (' + cols.join(', ') + ') VALUES (' + placeholders + ')';

    tursoExecute_(withPragmas_([
      { type: 'execute', stmt: { sql: sql, args: args } }
    ]));

    return { id: docId };
  } catch (e) {
    throw new Error('[TursoService.tursoSet] ' + e.message);
  }
}

/**
 * Partial update — only the supplied columns are changed.
 */
function tursoUpdate(sheetName, docId, updates) {
  try {
    const table = resolveTable_(sheetName);
    const pk    = resolvePK_(table);
    if (!pk) throw new Error('Table ' + table + ' has a composite PK — use tursoQuery_SQL');

    const now  = new Date().toISOString();
    const row  = Object.assign({}, updates);
    if (!row.updated_at) row.updated_at = now;

    const cols       = Object.keys(row);
    const setClauses = cols.map(function(c) { return c + ' = ?'; }).join(', ');
    const args       = cols.map(function(c) { return toArg_(row[c]); });
    args.push(toArg_(docId));

    const sql = 'UPDATE ' + table + ' SET ' + setClauses + ' WHERE ' + pk + ' = ?';

    tursoExecute_(withPragmas_([
      { type: 'execute', stmt: { sql: sql, args: args } }
    ]));

    return { id: docId };
  } catch (e) {
    throw new Error('[TursoService.tursoUpdate] ' + e.message);
  }
}

/**
 * Soft delete — sets deleted_at to now; the row is excluded from future reads.
 */
function tursoDelete(sheetName, docId) {
  try {
    const table = resolveTable_(sheetName);
    const pk    = resolvePK_(table);
    if (!pk) throw new Error('Table ' + table + ' has a composite PK — use tursoQuery_SQL');

    const now = new Date().toISOString();
    const sql = 'UPDATE ' + table + ' SET deleted_at = ? WHERE ' + pk + ' = ?';

    tursoExecute_(withPragmas_([
      { type: 'execute', stmt: { sql: sql, args: [toArg_(now), toArg_(docId)] } }
    ]));

    return { id: docId };
  } catch (e) {
    throw new Error('[TursoService.tursoDelete] ' + e.message);
  }
}

/**
 * Execute multiple write operations in a single atomic HTTP pipeline.
 * Each write: { sheetName, docId, data, operation } where operation is 'set'|'update'|'delete'.
 */
function tursoBatchWrite(writes) {
  if (!writes || writes.length === 0) return [];
  try {
    const now   = new Date().toISOString();
    const stmts = writes.map(function(w) {
      const table = resolveTable_(w.sheetName);
      const pk    = resolvePK_(table);

      if (w.operation === 'delete') {
        if (!pk) throw new Error('Table ' + table + ' has a composite PK — cannot batch delete');
        return {
          type: 'execute',
          stmt: {
            sql:  'UPDATE ' + table + ' SET deleted_at = ? WHERE ' + pk + ' = ?',
            args: [toArg_(now), toArg_(w.docId)]
          }
        };
      }

      if (w.operation === 'update') {
        if (!pk) throw new Error('Table ' + table + ' has a composite PK — cannot batch update');
        const row        = Object.assign({}, w.data);
        if (!row.updated_at) row.updated_at = now;
        const cols       = Object.keys(row);
        const setClauses = cols.map(function(c) { return c + ' = ?'; }).join(', ');
        const args       = cols.map(function(c) { return toArg_(row[c]); });
        args.push(toArg_(w.docId));
        return {
          type: 'execute',
          stmt: {
            sql:  'UPDATE ' + table + ' SET ' + setClauses + ' WHERE ' + pk + ' = ?',
            args: args
          }
        };
      }

      // 'set' (default)
      const row          = Object.assign({}, w.data);
      if (!row.updated_at) row.updated_at = now;
      const cols         = Object.keys(row);
      const placeholders = cols.map(function() { return '?'; }).join(', ');
      const args         = cols.map(function(c) { return toArg_(row[c]); });
      return {
        type: 'execute',
        stmt: {
          sql:  'INSERT OR REPLACE INTO ' + table +
                ' (' + cols.join(', ') + ') VALUES (' + placeholders + ')',
          args: args
        }
      };
    });

    tursoExecute_(withPragmas_(stmts));
    return writes.map(function(w) { return { id: w.docId }; });
  } catch (e) {
    throw new Error('[TursoService.tursoBatchWrite] ' + e.message);
  }
}

/**
 * Raw SQL escape hatch for queries that cannot be expressed via the simple API.
 * For SELECT: returns an array of row objects.
 * For DML (INSERT/UPDATE/DELETE): returns affected_row_count.
 *
 * Note: withPragmas_ inserts 1 statement before the caller's stmt, so the
 * actual execute result for DML is at results[1], not results[0].
 */
function tursoQuery_SQL(sql, args) {
  try {
    const convertedArgs = (args || []).map(toArg_);
    const stmt          = { type: 'execute', stmt: { sql: sql, args: convertedArgs } };
    const isSelect      = /^\s*SELECT/i.test(sql);

    let results, resultIdx;
    if (isSelect) {
      results   = tursoExecute_(readOnly_([stmt]));
      resultIdx = 0;
    } else {
      results   = tursoExecute_(withPragmas_([stmt]));
      resultIdx = 1; // indices 0–1 are PRAGMA results
    }

    const execResult = results[resultIdx].response.result;
    return isSelect ? parseRows_(execResult) : execResult.affected_row_count;
  } catch (e) {
    throw new Error('[TursoService.tursoQuery_SQL] ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Config helpers — tursoGetConfig, tursoSetConfig, tursoIncrementCounter
// ─────────────────────────────────────────────────────────────

/**
 * Read a single config value by key + org scope.
 * Returns the raw config_value string, or null if not found.
 * Assumption: the config table has an organization_id column
 * (default 'GLOBAL' for system-wide settings).
 */
function tursoGetConfig(key, orgId) {
  try {
    orgId = orgId || 'GLOBAL';
    const results = tursoExecute_(readOnly_([
      {
        type: 'execute',
        stmt: {
          sql:  'SELECT config_value FROM config WHERE config_key = ? AND organization_id = ?',
          args: [toArg_(key), toArg_(orgId)]
        }
      }
    ]));
    const rows = parseRows_(results[0].response.result);
    return rows.length > 0 ? rows[0].config_value : null;
  } catch (e) {
    throw new Error('[TursoService.tursoGetConfig] ' + e.message);
  }
}

/**
 * Upsert a config value.
 */
function tursoSetConfig(key, value, orgId) {
  try {
    orgId = orgId || 'GLOBAL';
    const now = new Date().toISOString();
    tursoExecute_(withPragmas_([
      {
        type: 'execute',
        stmt: {
          sql:  'INSERT OR REPLACE INTO config (config_key, organization_id, config_value, updated_at) VALUES (?, ?, ?, ?)',
          args: [toArg_(key), toArg_(orgId), toArg_(value), toArg_(now)]
        }
      }
    ]));
  } catch (e) {
    throw new Error('[TursoService.tursoSetConfig] ' + e.message);
  }
}

/**
 * Atomically increment a counter stored in config and return the NEW value.
 * Used for ID generation. Retries up to 3 times on write contention.
 *
 * Note: this is an optimistic increment (read-then-write), not a true atomic
 * SQL increment, because libSQL does not support RETURNING in all versions.
 * Use LockService in the caller (e.g. generateId) to serialise concurrent calls.
 */
function tursoIncrementCounter(counterKey, orgId) {
  orgId = orgId || 'GLOBAL';
  const maxRetries = 3;
  let   attempt    = 0;

  while (attempt < maxRetries) {
    try {
      const selectResults = tursoExecute_(readOnly_([
        {
          type: 'execute',
          stmt: {
            sql:  'SELECT config_value FROM config WHERE config_key = ? AND organization_id = ?',
            args: [toArg_(counterKey), toArg_(orgId)]
          }
        }
      ]));
      const rows    = parseRows_(selectResults[0].response.result);
      const current = rows.length > 0 ? (parseInt(rows[0].config_value, 10) || 0) : 0;
      const newVal  = current + 1;

      const now = new Date().toISOString();
      tursoExecute_(withPragmas_([
        {
          type: 'execute',
          stmt: {
            sql:  'INSERT OR REPLACE INTO config (config_key, organization_id, config_value, updated_at) VALUES (?, ?, ?, ?)',
            args: [toArg_(counterKey), toArg_(orgId), toArg_(String(newVal)), toArg_(now)]
          }
        }
      ]));

      return newVal;
    } catch (e) {
      attempt++;
      if (attempt >= maxRetries) {
        throw new Error('[TursoService.tursoIncrementCounter] ' + e.message);
      }
      Utilities.sleep(attempt * 300); // 300 ms, 600 ms back-off
    }
  }
}

// ─────────────────────────────────────────────────────────────
// One-time setup (run from the Apps Script editor as SUPER_ADMIN)
// ─────────────────────────────────────────────────────────────

function setupTursoCredentials(url, token) {
  PropertiesService.getScriptProperties().setProperties({
    TURSO_DATABASE_URL: url,
    TURSO_AUTH_TOKEN:   token
  });
  // Smoke test — verifies network reachability and valid credentials
  const result = tursoQuery_SQL('SELECT 1 AS ok', []);
  if (!result || result[0]?.ok !== 1) throw new Error('Turso connection test failed');
  Logger.log('Turso connected successfully');
}
