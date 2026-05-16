const GAS_URL = 'https://script.google.com/macros/s/AKfycbx301LxL--m-lCv52quMpgfS8lLZ26k7YBNuEauLb_cb_3dKVm8AWknrfTWGnW7i1eu/exec';

// Cache TTLs in seconds
const TTL = {
  DROPDOWNS:   3600,  // 1 hour — affiliates, audit areas, sub areas
  PERMISSIONS:  600,  // 10 minutes — role permissions
  USER_DATA:    300,  // 5 minutes — user profile
  WORK_PAPERS:   60,  // 1 minute — work paper lists
  DASHBOARD:    120,  // 2 minutes — dashboard counts
};

// Routes that can be cached (read-only)
const CACHEABLE = {
  'getAffiliatesDropdownData':   TTL.DROPDOWNS,
  'getAuditAreasDropdownData':   TTL.DROPDOWNS,
  'getSubAreasDropdownData':     TTL.DROPDOWNS,
  'getPermissionMatrix':         TTL.PERMISSIONS,
  'getDashboardInitData':        TTL.USER_DATA,
  'getWorkPapers':               TTL.WORK_PAPERS,
  'getWorkPaper':                TTL.WORK_PAPERS,
  'getActionPlans':              TTL.WORK_PAPERS,
  'getDashboardDataV2':          TTL.DASHBOARD,
};

// Routes that must never be cached (writes, auth)
const NEVER_CACHE = new Set([
  'login', 'logout', 'validateSession',
  'createWorkPaper', 'updateWorkPaper', 'submitWorkPaper',
  'approveWorkPaper', 'sendToAuditee',
  'createActionPlan', 'updateActionPlan',
  'createUser', 'resetUserPasswordAdmin',
  'acceptPrivacyConsent', 'changePassword',
  'updatePermissions', 'toggleUserStatus',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── API proxy ──────────────────────────────────────────
    if (url.pathname === '/api/call') {
      return handleApiCall(request, env, url);
    }

    // ── Cache invalidation webhook (called by GAS) ─────────
    if (url.pathname === '/api/invalidate' &&
        request.method === 'POST') {
      return handleInvalidate(request, env);
    }

    // ── Static assets (index.html, dashboard.html etc) ─────
    return env.ASSETS.fetch(request);
  }
};

async function handleApiCall(request, env, url) {
  const body   = request.method === 'POST'
    ? await request.json().catch(() => ({}))
    : {};
  const action = body.action || url.searchParams.get('action');
  const token  = body.token  || url.searchParams.get('token') || '';

  if (!action) {
    return jsonResponse({ error: 'action required' }, 400);
  }

  // Never cache writes or auth
  if (NEVER_CACHE.has(action)) {
    return forwardToGAS(body, env);
  }

  const ttl = CACHEABLE[action];
  if (!ttl) {
    // Unknown action — forward without caching
    return forwardToGAS(body, env);
  }

  // Build cache key — include token for user-specific data
  const userKey = token ? token.substring(0, 16) : 'anon';
  const dataKey = JSON.stringify(body.data || {});
  const cacheKey = `${action}:${userKey}:${hashStr(dataKey)}`;

  // Check KV cache
  if (env.AUDIT_CACHE) {
    const cached = await env.AUDIT_CACHE.get(cacheKey, 'json')
                     .catch(() => null);
    if (cached) {
      return jsonResponse(cached, 200, { 'X-Cache': 'HIT' });
    }
  }

  // Cache miss — call GAS
  const result = await forwardToGAS(body, env, true);
  const data   = await result.clone().json().catch(() => null);

  // Cache successful responses
  if (data && data.success !== false && env.AUDIT_CACHE) {
    await env.AUDIT_CACHE.put(
      cacheKey,
      JSON.stringify(data),
      { expirationTtl: ttl }
    ).catch(() => {});
  }

  return jsonResponse(data, 200, { 'X-Cache': 'MISS' });
}

async function forwardToGAS(body, env, returnRaw) {
  const response = await fetch(GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  }).catch(err => {
    return jsonResponse({ error: 'GAS unreachable', detail: err.message }, 503);
  });
  return returnRaw ? response : response;
}

async function handleInvalidate(request, env) {
  if (!env.AUDIT_CACHE) return jsonResponse({ ok: true });
  const body    = await request.json().catch(() => ({}));
  const pattern = body.pattern || ''; // e.g. 'getWorkPapers'
  // KV doesn't support pattern delete — delete specific keys
  if (body.keys && Array.isArray(body.keys)) {
    await Promise.all(
      body.keys.map(k => env.AUDIT_CACHE.delete(k).catch(() => {}))
    );
  }
  return jsonResponse({ ok: true, invalidated: body.keys || [] });
}

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status:  status || 200,
    headers: Object.assign({
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    }, extraHeaders || {})
  });
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
