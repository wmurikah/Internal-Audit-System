// 07_AuthService.gs - Authentication, Session Management, Password Management, User Management

const AUTH_CONFIG = {
  SESSION_DURATION_HOURS: 24,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  PBKDF2_ITERATIONS: 1000,  // Keep at 1000 - do NOT change without re-hashing all passwords
  SALT_LENGTH: 32,
  TOKEN_LENGTH: 64,
  TEMP_PASSWORD_LENGTH: 12
};

function login(email, password) {
  const startTime = new Date().getTime();
  console.log('Login attempt for:', email);

  if (!email || !password) {
    return { success: false, error: 'Email and password are required' };
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  
  const user = getUserByEmailCached(normalizedEmail);
  console.log('User lookup:', new Date().getTime() - startTime, 'ms');

  if (!user) {
    Utilities.sleep(200);
    return { success: false, error: 'Access denied. Contact administrator.' };
  }

  if (!isActive(user.is_active)) {
    return { success: false, error: 'Account is inactive. Contact administrator.' };
  }
  
  if (user.locked_until) {
    const lockUntil = new Date(user.locked_until);
    if (lockUntil > new Date()) {
      const minutesLeft = Math.ceil((lockUntil - new Date()) / (1000 * 60));
      return { success: false, error: `Account is locked. Try again in ${minutesLeft} minute(s).` };
    }
  }
  
  const verifyStart = new Date().getTime();
  const passwordValid = verifyPassword(password, user.password_salt, user.password_hash);
  console.log('Password verify:', new Date().getTime() - verifyStart, 'ms');
  
  if (!passwordValid) {
    incrementFailedAttempts(user);
    return { success: false, error: 'Invalid email or password' };
  }
  
  const session = createSession(user);
  console.log('Session created:', new Date().getTime() - startTime, 'ms');

  prewarmUserCache(user);

  const cache = CacheService.getScriptCache();
  let roleName = cache.get('role_name_' + user.role_code);
  if (!roleName) {
    roleName = getRoleName(user.role_code) || user.role_code;
    cache.put('role_name_' + user.role_code, roleName, 3600);
  }
  
  let permissions = {};
  try {
    const cachedPerm = cache.get('perm_' + user.role_code);
    if (cachedPerm) {
      permissions = JSON.parse(cachedPerm);
    } else {
      permissions = getUserPermissions(user.role_code);
      cache.put('perm_' + user.role_code, JSON.stringify(permissions), 1800);
    }
  } catch(e) {}
  
  let dropdowns = {};
  try {
    const cachedDropdowns = cache.get('dropdown_data_all');
    if (cachedDropdowns) {
      dropdowns = JSON.parse(cachedDropdowns);
    }
  } catch(e) {}
  
  console.log('Total login time:', new Date().getTime() - startTime, 'ms');
  
  return sanitizeForClient({
    success: true,
    sessionToken: session.session_token,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: roleName,
      affiliate_code: user.affiliate_code || '',
      department: user.department || '',
      must_change_password: user.must_change_password === true || user.must_change_password === 'true' || user.must_change_password === 'TRUE'
    },
    permissions: permissions,
    dropdowns: dropdowns,
    config: {
      systemName: 'Hass Petroleum Internal Audit System',
      currentYear: new Date().getFullYear()
    },
    _needsCleanup: true
  });
}

function postLoginCleanup(data) {
  try {
    const userId = data.userId;
    const userEmail = data.email;
    const roleCode = data.roleCode;
    
    try {
      const user = getUserByEmailCached(userEmail);
      if (user) {
        const sheet = getSheet(SHEETS.USERS);
        const rowIndex = user._rowIndex || findUserRowIndex(user.user_id);
        if (rowIndex) {
          const attemptsIdx = getColumnIndex(SHEETS.USERS, 'login_attempts');
          const lockedIdx = getColumnIndex(SHEETS.USERS, 'locked_until');
          const lastLoginIdx = getColumnIndex(SHEETS.USERS, 'last_login');
          
          if (shouldWriteToSheet()) {
            sheet.getRange(rowIndex, attemptsIdx + 1).setValue(0);
            sheet.getRange(rowIndex, lockedIdx + 1).setValue('');
            sheet.getRange(rowIndex, lastLoginIdx + 1).setValue(new Date());
          }
        }
        invalidateUserCache(userEmail, user.user_id);
      }
    } catch(e) { console.warn('Cleanup: reset attempts failed:', e); }
    
    try {
      logAuditEvent('LOGIN', 'USER', userId, null, { email: userEmail }, userId, userEmail);
    } catch(e) { console.warn('Cleanup: audit log failed:', e); }
    
    try {
      const cache = CacheService.getScriptCache();
      if (!cache.get('dropdown_data_all')) {
        const dropdowns = getDropdownData();
        cache.put('dropdown_data_all', JSON.stringify(dropdowns), 1800);
      }
    } catch(e) { console.warn('Cleanup: dropdown warm failed:', e); }
    
    return { success: true };
  } catch(e) {
    console.error('postLoginCleanup error:', e);
    return { success: false };
  }
}

function getUserByEmailCached(email) {
  if (!email) return null;
  
  const normalizedEmail = email.toLowerCase().trim();
  const cacheKey = 'user_email_' + normalizedEmail;
  const cache = CacheService.getScriptCache();
  
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const user = JSON.parse(cached);
      if (!user._rowIndex) {
        user._rowIndex = findUserRowIndex(user.user_id);
      }
      return user;
    } catch (e) {
      console.warn('Cache parse error:', e);
    }
  }
  
  const user = getUserByEmail(normalizedEmail);
  
  if (user) {
    const userForCache = { ...user };
    delete userForCache._rowIndex;
    cache.put(cacheKey, JSON.stringify(userForCache), 600);
  }
  
  return user;
}

function findUserRowIndex(userId) {
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('user_id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === userId) {
      return i + 1;
    }
  }
  return null;
}

function prewarmUserCache(user) {
  try {
    const cache = CacheService.getScriptCache();
    
    const permissions = getUserPermissions(user.role_code);
    cache.put('perm_' + user.role_code, JSON.stringify(permissions), 1800);
    
    const roleName = getRoleName(user.role_code);
    cache.put('role_name_' + user.role_code, roleName, 3600);
    
    try {
      const existingDropdowns = cache.get('dropdown_data_all');
      if (!existingDropdowns) {
        const dropdowns = getDropdownData();
        cache.put('dropdown_data_all', JSON.stringify(dropdowns), 1800);
        console.log('Dropdown cache warmed during login');
      }
    } catch(e) {
      console.warn('Dropdown pre-warm failed (non-fatal):', e);
    }
    
    console.log('Cache pre-warmed for user:', user.email);
  } catch (e) {
    console.warn('Cache pre-warm failed:', e);
  }
}

function updateLastLoginAsync(user) {
  try {
    const sheet = getSheet(SHEETS.USERS);
    const rowIndex = user._rowIndex || findUserRowIndex(user.user_id);

    if (rowIndex) {
      const lastLoginIdx = getColumnIndex(SHEETS.USERS, 'last_login');
      if (shouldWriteToSheet()) {
        sheet.getRange(rowIndex, lastLoginIdx + 1).setValue(new Date());
      }
    }

    invalidateUserCache(user.email, user.user_id);
  } catch (e) {
    console.warn('updateLastLoginAsync failed:', e);
  }
}

function logout(sessionToken) {
  if (!sessionToken) {
    return { success: false, error: 'Session token required' };
  }
  
  const session = getSessionByToken(sessionToken);
  if (session) {
    invalidateSession(session.session_id);
    
    const cache = CacheService.getScriptCache();
    cache.remove('session_' + sessionToken.substring(0, 16));
    
    logAuditEvent('LOGOUT', 'USER', session.user_id, null, null, session.user_id, '');
  }
  
  return { success: true };
}

function validateSession(sessionToken) {
  const startTime = new Date().getTime();
  
  if (!sessionToken) {
    return { valid: false, error: 'No session token' };
  }

  const session = getSessionByTokenCached(sessionToken);
  
  if (!session) {
    return { valid: false, error: 'Session not found' };
  }

  if (!isActive(session.is_valid)) {
    return { valid: false, error: 'Session invalidated' };
  }

  const expiresAt = new Date(session.expires_at);
  if (expiresAt < new Date()) {
    invalidateSession(session.session_id);
    return { valid: false, error: 'Session expired' };
  }

  let user = getUserByIdCached(session.user_id);

  if (!user || !isActive(user.is_active)) {
    invalidateSession(session.session_id);
    return { valid: false, error: 'User not found or inactive' };
  }

  console.log('Session validation took:', new Date().getTime() - startTime, 'ms');

  return sanitizeForClient({
    valid: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: getRoleName(user.role_code),
      affiliate_code: user.affiliate_code,
      department: user.department,
      must_change_password: user.must_change_password === true || user.must_change_password === 'true' || user.must_change_password === 'TRUE',
      is_active: user.is_active
    }
  });
}

function getSessionByTokenCached(token) {
  if (!token) return null;
  
  const cacheKey = 'session_' + token.substring(0, 16);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    try { 
      return JSON.parse(cached); 
    } catch (e) {}
  }
  
  const session = getSessionByToken(token);
  
  if (session) {
    cache.put(cacheKey, JSON.stringify(session), 300);
  }
  
  return session;
}

function getUserByIdCached(userId) {
  if (!userId) return null;
  
  const cacheKey = 'user_id_' + userId;
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }
  
  const user = getUserById(userId);
  
  if (user) {
    const userForCache = { ...user };
    delete userForCache._rowIndex;
    cache.put(cacheKey, JSON.stringify(userForCache), 600);
  }
  
  return user;
}

function getCurrentUser() {
  try {
    const email = Session.getActiveUser().getEmail();

    if (!email) {
      return null;
    }

    const user = getUserByEmailCached(email);

    if (!user || !isActive(user.is_active)) {
      return null;
    }

    return user;
  } catch (e) {
    console.error('getCurrentUser error:', e);
    return null;
  }
}

function createSession(user) {
  const sessionId = generateId('SESSION');
  const sessionToken = generateSecureToken(AUTH_CONFIG.TOKEN_LENGTH);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + AUTH_CONFIG.SESSION_DURATION_HOURS * 60 * 60 * 1000);
  
  const session = {
    session_id: sessionId,
    user_id: user.user_id,
    session_token: sessionToken,
    created_at: now,
    expires_at: expiresAt,
    ip_address: '',
    user_agent: '',
    is_valid: true
  };
  
  const sheet = getSheet(SHEETS.SESSIONS);
  const row = objectToRow('SESSIONS', session);
  if (shouldWriteToSheet()) {
    sheet.appendRow(row);
  }
  
  const cache = CacheService.getScriptCache();
  const cacheKey = 'session_' + sessionToken.substring(0, 16);
  cache.put(cacheKey, JSON.stringify(session), 300);
  
  return session;
}

function getSessionByToken(token) {
  if (!token) return null;
  
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tokenIdx = headers.indexOf('session_token');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] === token) {
      const session = rowToObject(headers, data[i]);
      session._rowIndex = i + 1;
      return session;
    }
  }
  
  return null;
}

function invalidateSession(sessionId) {
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('session_id');
  const validIdx = headers.indexOf('is_valid');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === sessionId) {
      if (shouldWriteToSheet()) {
        sheet.getRange(i + 1, validIdx + 1).setValue(false);
      }

      const token = data[i][headers.indexOf('session_token')];
      if (token) {
        const cache = CacheService.getScriptCache();
        cache.remove('session_' + token.substring(0, 16));
      }
      
      return true;
    }
  }
  
  return false;
}

function cleanupExpiredSessions() {
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const expiresIdx = headers.indexOf('expires_at');
  const validIdx = headers.indexOf('is_valid');
  
  const now = new Date();
  let cleaned = 0;
  
  for (let i = data.length - 1; i >= 1; i--) {
    const expiresAt = data[i][expiresIdx];
    const isValid = data[i][validIdx];
    
    if (!isValid || (expiresAt && new Date(expiresAt) < now)) {
      if (shouldWriteToSheet()) {
        sheet.deleteRow(i + 1);
      }
      cleaned++;
    }
  }
  
  console.log('Cleaned up sessions:', cleaned);
  return cleaned;
}

function hashPassword(password, salt) {
  let hash = password;
  
  for (let i = 0; i < AUTH_CONFIG.PBKDF2_ITERATIONS; i++) {
    const signature = Utilities.computeHmacSignature(
      Utilities.MacAlgorithm.HMAC_SHA_256,
      hash + salt + i,
      salt
    );
    hash = Utilities.base64Encode(signature);
  }
  
  return hash;
}

function verifyPassword(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  const computedHash = hashPassword(password, salt);
  return computedHash === storedHash;
}

function generateSalt() {
  // Use Utilities.getUuid() as a cryptographic entropy source instead of Math.random()
  const uuids = Utilities.getUuid() + Utilities.getUuid();
  const bytes = [];
  const hex = uuids.replace(/-/g, '');
  for (let i = 0; i < AUTH_CONFIG.SALT_LENGTH && i * 2 < hex.length; i++) {
    bytes.push(parseInt(hex.substr(i * 2, 2), 16));
  }
  return Utilities.base64Encode(bytes);
}

function generateSecureToken(length) {
  // Use Utilities.getUuid() for cryptographic randomness instead of Math.random()
  let token = '';
  while (token.length < length) {
    token += Utilities.getUuid().replace(/-/g, '');
  }
  return token.substring(0, length);
}

function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%';

  // Use UUID-based entropy instead of Math.random()
  function secureRandom(max) {
    var hex = Utilities.getUuid().replace(/-/g, '').substring(0, 8);
    return parseInt(hex, 16) % max;
  }

  let chars = [];

  chars.push(upper.charAt(secureRandom(upper.length)));
  chars.push(lower.charAt(secureRandom(lower.length)));
  chars.push(numbers.charAt(secureRandom(numbers.length)));
  chars.push(special.charAt(secureRandom(special.length)));

  const allChars = upper + lower + numbers;
  for (let i = chars.length; i < AUTH_CONFIG.TEMP_PASSWORD_LENGTH; i++) {
    chars.push(allChars.charAt(secureRandom(allChars.length)));
  }

  // Fisher-Yates shuffle for uniform distribution
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandom(i + 1);
    var tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}

function changePassword(userId, currentPassword, newPassword) {
  console.log('changePassword called for userId:', userId);

  const user = getUserByIdCached(userId);
  if (!user) {
    console.error('changePassword: User not found:', userId);
    return { success: false, error: 'User not found' };
  }

  if (!user._rowIndex) {
    user._rowIndex = findUserRowIndex(userId);
    if (!user._rowIndex) {
      return { success: false, error: 'Unable to locate user record for update' };
    }
  }

  if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
    return { success: false, error: 'Current password is incorrect' };
  }

  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const salt = generateSalt();
  const hash = hashPassword(newPassword, salt);

  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;

  const sheetName = SHEETS.USERS;
  const hashIdx = getColumnIndex(sheetName, 'password_hash');
  const saltIdx = getColumnIndex(sheetName, 'password_salt');
  const mustChangeIdx = getColumnIndex(sheetName, 'must_change_password');
  const updatedIdx = getColumnIndex(sheetName, 'updated_at');

  if (hashIdx < 0 || saltIdx < 0 || mustChangeIdx < 0 || updatedIdx < 0) {
    console.error('changePassword: Column index lookup failed for sheet:', sheetName);
    return { success: false, error: 'Internal configuration error' };
  }

  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, hashIdx + 1).setValue(hash);
    sheet.getRange(rowIndex, saltIdx + 1).setValue(salt);
    sheet.getRange(rowIndex, mustChangeIdx + 1).setValue(false);
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(new Date());
  }

  invalidateUserCache(user.email, user.user_id);

  logAuditEvent('CHANGE_PASSWORD', 'USER', userId, null, null, userId, user.email);

  return { success: true };
}

function resetPassword(userId, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  if (adminUser.role_code !== ROLES.SUPER_ADMIN && adminUser.role_code !== ROLES.SENIOR_AUDITOR) {
    return { success: false, error: 'Permission denied' };
  }

  const user = getUserByIdCached(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (!user._rowIndex) {
    user._rowIndex = findUserRowIndex(userId);
  }

  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  const hash = hashPassword(tempPassword, salt);
  
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  const sheetName = SHEETS.USERS;

  const hashIdx = getColumnIndex(sheetName, 'password_hash');
  const saltIdx = getColumnIndex(sheetName, 'password_salt');
  const mustChangeIdx = getColumnIndex(sheetName, 'must_change_password');
  const updatedIdx = getColumnIndex(sheetName, 'updated_at');
  const attemptsIdx = getColumnIndex(sheetName, 'login_attempts');
  const lockedIdx = getColumnIndex(sheetName, 'locked_until');

  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, hashIdx + 1).setValue(hash);
    sheet.getRange(rowIndex, saltIdx + 1).setValue(salt);
    sheet.getRange(rowIndex, mustChangeIdx + 1).setValue(true);
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(new Date());
    sheet.getRange(rowIndex, attemptsIdx + 1).setValue(0);
    sheet.getRange(rowIndex, lockedIdx + 1).setValue('');
  }

  invalidateUserCache(user.email, user.user_id);

  invalidateUserSessions(userId);

  const loginUrl = ScriptApp.getService().getUrl();

  var resetPlain = 'Dear ' + (user.first_name || user.full_name.split(' ')[0]) + ',\n\n' +
    'Your password has been reset by an administrator.\n\n' +
    'Your new temporary password is: ' + tempPassword + '\n\n' +
    'For security, please log in and change your password immediately.\n\n' +
    loginUrl + '\n\n' +
    'If you did not request this reset, please contact your administrator immediately.';

  var resetHtml = formatPasswordResetEmailHtml({
    firstName: user.first_name || user.full_name.split(' ')[0],
    email: user.email,
    tempPassword: tempPassword,
    loginUrl: loginUrl,
    reason: 'admin_reset'
  });

  const emailResult = sendEmail(user.email, 'Password Reset - Hass Petroleum Audit System', resetPlain, resetHtml, null, 'Internal Audit Notification', 'hassaudit@outlook.com');
  if (!emailResult.success) {
    console.error('Failed to send password reset email:', emailResult.error);
  }
  
  logAuditEvent('RESET_PASSWORD', 'USER', userId, null, null, adminUser.user_id, adminUser.email);
  
  return { success: true };
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter' };
  }
  
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter' };
  }
  
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one number' };
  }
  
  return { valid: true };
}

function incrementFailedAttempts(user) {
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex || findUserRowIndex(user.user_id);

  if (!rowIndex) return;

  const attemptsIdx = getColumnIndex(SHEETS.USERS, 'login_attempts');
  const lockedIdx = getColumnIndex(SHEETS.USERS, 'locked_until');
  
  const attempts = (parseInt(user.login_attempts) || 0) + 1;
  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, attemptsIdx + 1).setValue(attempts);
  }

  if (attempts >= AUTH_CONFIG.MAX_LOGIN_ATTEMPTS) {
    const lockUntil = new Date();
    lockUntil.setMinutes(lockUntil.getMinutes() + AUTH_CONFIG.LOCKOUT_DURATION_MINUTES);
    if (shouldWriteToSheet()) {
      sheet.getRange(rowIndex, lockedIdx + 1).setValue(lockUntil);
    }
    
    logAuditEvent('ACCOUNT_LOCKED', 'USER', user.user_id, null, { attempts: attempts }, '', user.email);
  }
  
  invalidateUserCache(user.email, user.user_id);
}

function resetFailedAttempts(user) {
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex || findUserRowIndex(user.user_id);

  if (!rowIndex) return;

  const attemptsIdx = getColumnIndex(SHEETS.USERS, 'login_attempts');
  const lockedIdx = getColumnIndex(SHEETS.USERS, 'locked_until');
  
  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, attemptsIdx + 1).setValue(0);
    sheet.getRange(rowIndex, lockedIdx + 1).setValue('');
  }

  invalidateUserCache(user.email, user.user_id);
}

function updateLastLogin(user) {
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex || findUserRowIndex(user.user_id);

  if (!rowIndex) return;

  const lastLoginIdx = getColumnIndex(SHEETS.USERS, 'last_login');
  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, lastLoginIdx + 1).setValue(new Date());
  }

  invalidateUserCache(user.email, user.user_id);
}

function createUser(userData, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  if (adminUser.role_code !== ROLES.SUPER_ADMIN && adminUser.role_code !== ROLES.SENIOR_AUDITOR) {
    return { success: false, error: 'Permission denied' };
  }

  if (!userData.email || !userData.full_name || !userData.role_code) {
    return { success: false, error: 'Email, full name, and role are required' };
  }
  
  const existing = getUserByEmailCached(userData.email);
  if (existing) {
    return { success: false, error: 'User with this email already exists' };
  }
  
  const userId = generateId('USER');
  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  const hash = hashPassword(tempPassword, salt);
  const now = new Date();
  
  const nameParts = userData.full_name.trim().split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  
  const user = {
    user_id: userId,
    email: userData.email.toLowerCase().trim(),
    password_hash: hash,
    password_salt: salt,
    full_name: sanitizeInput(userData.full_name),
    first_name: sanitizeInput(firstName),
    last_name: sanitizeInput(lastName),
    role_code: userData.role_code,
    affiliate_code: userData.affiliate_code || '',
    department: sanitizeInput(userData.department || ''),
    phone: sanitizeInput(userData.phone || ''),
    is_active: true,
    must_change_password: true,
    login_attempts: 0,
    locked_until: '',
    last_login: '',
    created_at: now,
    created_by: adminUser.user_id,
    updated_at: now,
    updated_by: adminUser.user_id
  };
  
  const sheet = getSheet(SHEETS.USERS);
  const row = objectToRow('USERS', user);

  // Lock to make appendRow + getLastRow atomic
  const lock = LockService.getScriptLock();
  let rowNum;
  try {
    lock.waitLock(15000);
    if (shouldWriteToSheet()) {
      sheet.appendRow(row);
    }
    rowNum = sheet.getLastRow();
    lock.releaseLock();
  } catch (lockErr) {
    try { lock.releaseLock(); } catch (ignored) {}
    throw lockErr;
  }

  updateUserIndex(userId, user, rowNum);
  
  invalidateDropdownCache();
  
  const loginUrl = ScriptApp.getService().getUrl();

  // Build professional welcome email using branded HTML template
  var roleName = '';
  try { roleName = getRoleName(user.role_code) || user.role_code; } catch(e) { roleName = user.role_code; }

  var welcomeHtml = formatWelcomeEmailHtml({
    fullName: user.full_name,
    firstName: user.first_name || user.full_name.split(' ')[0],
    email: user.email,
    tempPassword: tempPassword,
    roleName: roleName,
    loginUrl: loginUrl
  });

  var welcomeSubject = 'Welcome to Hass Petroleum Internal Audit System';
  var welcomePlain = 'Hello ' + user.full_name + ',\n\n' +
    'Your account has been created for the Internal Audit System.\n\n' +
    'Email: ' + user.email + '\n' +
    'Temporary Password: ' + tempPassword + '\n\n' +
    'Please log in and change your password immediately.\n\n' +
    loginUrl + '\n\nBest regards,\nInternal Audit Department';

  // Send via Outlook Graph API with HTML, or fall back to MailApp
  var emailResult = sendEmail(user.email, welcomeSubject, welcomePlain, welcomeHtml, null, 'Hass Audit', 'hassaudit@outlook.com');
  if (!emailResult.success) {
    console.error('Failed to send welcome email:', emailResult.error);
  }
  
  logAuditEvent('CREATE', 'USER', userId, null, user, adminUser.user_id, adminUser.email);
  
  return sanitizeForClient({ success: true, userId: userId, tempPassword: tempPassword });
}

function updateUser(userId, userData, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  const user = getUserByIdCached(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  if (!user._rowIndex) {
    user._rowIndex = findUserRowIndex(userId);
  }
  
  const isSelf = adminUser.user_id === userId;
  const isAdmin = adminUser.role_code === ROLES.SUPER_ADMIN || adminUser.role_code === ROLES.SENIOR_AUDITOR;

  if (!isSelf && !isAdmin) {
    return { success: false, error: 'Permission denied' };
  }
  
  const now = new Date();
  const updates = { updated_at: now, updated_by: adminUser.user_id };
  
  const selfEditableFields = ['full_name', 'phone', 'department'];
  const adminFields = ['email', 'role_code', 'affiliate_code', 'is_active'];
  
  selfEditableFields.forEach(field => {
    if (userData[field] !== undefined) {
      updates[field] = sanitizeInput(userData[field]);
    }
  });
  
  if (isAdmin) {
    adminFields.forEach(field => {
      if (userData[field] !== undefined) {
        updates[field] = field === 'email' ? userData[field].toLowerCase().trim() : userData[field];
      }
    });
  }
  
  if (updates.full_name) {
    const nameParts = updates.full_name.trim().split(' ');
    updates.first_name = nameParts[0] || '';
    updates.last_name = nameParts.slice(1).join(' ') || '';
  }
  
  const updated = { ...user, ...updates };
  
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  const row = objectToRow('USERS', updated);
  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  }

  invalidateUserCache(user.email, user.user_id);
  if (updates.email && updates.email !== user.email) {
    invalidateUserCache(updates.email);
  }
  invalidateDropdownCache();
  
  logAuditEvent('UPDATE', 'USER', userId, user, updated, adminUser.user_id, adminUser.email);
  
  return sanitizeForClient({ success: true, user: updated });
}

function deactivateUser(userId, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  if (adminUser.role_code !== ROLES.SUPER_ADMIN) {
    return { success: false, error: 'Permission denied' };
  }
  
  if (adminUser.user_id === userId) {
    return { success: false, error: 'Cannot deactivate your own account' };
  }
  
  const user = getUserByIdCached(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  if (!user._rowIndex) {
    user._rowIndex = findUserRowIndex(userId);
  }
  
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  const activeIdx = getColumnIndex(SHEETS.USERS, 'is_active');
  
  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, activeIdx + 1).setValue(false);
  }

  invalidateUserSessions(userId);

  invalidateUserCache(user.email, user.user_id);
  invalidateDropdownCache();

  logAuditEvent('DEACTIVATE', 'USER', userId, user, null, adminUser.user_id, adminUser.email);
  
  return { success: true };
}

function forgotPassword(email) {
  if (!email) {
    return { success: false, error: 'Email is required' };
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  const user = getUserByEmailCached(normalizedEmail);
  
  if (!user || !isActive(user.is_active)) {
    Utilities.sleep(500);
    return { success: true, message: 'If an account exists with that email, a temporary password has been sent.' };
  }
  
  if (!user._rowIndex) {
    user._rowIndex = findUserRowIndex(user.user_id);
  }
  
  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  const hash = hashPassword(tempPassword, salt);
  
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  const sheetName = SHEETS.USERS;

  const hashIdx = getColumnIndex(sheetName, 'password_hash');
  const saltIdx = getColumnIndex(sheetName, 'password_salt');
  const mustChangeIdx = getColumnIndex(sheetName, 'must_change_password');
  const updatedIdx = getColumnIndex(sheetName, 'updated_at');
  const attemptsIdx = getColumnIndex(sheetName, 'login_attempts');
  const lockedIdx = getColumnIndex(sheetName, 'locked_until');

  if (shouldWriteToSheet()) {
    sheet.getRange(rowIndex, hashIdx + 1).setValue(hash);
    sheet.getRange(rowIndex, saltIdx + 1).setValue(salt);
    sheet.getRange(rowIndex, mustChangeIdx + 1).setValue(true);
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(new Date());
    sheet.getRange(rowIndex, attemptsIdx + 1).setValue(0);
    sheet.getRange(rowIndex, lockedIdx + 1).setValue('');
  }

  invalidateUserCache(user.email, user.user_id);
  invalidateUserSessions(user.user_id);

  const loginUrl = ScriptApp.getService().getUrl();

  var forgotPlain = 'Dear ' + (user.first_name || user.full_name.split(' ')[0]) + ',\n\n' +
    'A password reset was requested for your account.\n\n' +
    'Your new temporary password is: ' + tempPassword + '\n\n' +
    'Please log in and change your password immediately.\n\n' +
    loginUrl + '\n\n' +
    'If you did not request this, please contact your administrator immediately.';

  var forgotHtml = formatPasswordResetEmailHtml({
    firstName: user.first_name || user.full_name.split(' ')[0],
    email: user.email,
    tempPassword: tempPassword,
    loginUrl: loginUrl,
    reason: 'forgot'
  });

  const emailResult = sendEmail(user.email, 'Password Reset - Hass Petroleum Audit System', forgotPlain, forgotHtml, null, 'Internal Audit Notification', 'hassaudit@outlook.com');
  if (!emailResult.success) {
    console.error('Failed to send forgot password email:', emailResult.error);
  }
  
  logAuditEvent('FORGOT_PASSWORD', 'USER', user.user_id, null, null, user.user_id, user.email);
  
  return { success: true, message: 'If an account exists with that email, a temporary password has been sent.' };
}

function invalidateUserSessions(userId) {
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const userIdIdx = headers.indexOf('user_id');
  const validIdx = headers.indexOf('is_valid');
  const tokenIdx = headers.indexOf('session_token');
  const cache = CacheService.getScriptCache();

  for (let i = 1; i < data.length; i++) {
    if (data[i][userIdIdx] === userId) {
      if (shouldWriteToSheet()) {
        sheet.getRange(i + 1, validIdx + 1).setValue(false);
      }
      // Also invalidate the session cache entry
      var token = data[i][tokenIdx];
      if (token) {
        try { cache.remove('session_' + String(token).substring(0, 16)); } catch (e) {}
      }
    }
  }
}

function getUsers(filters, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  const isAdmin = adminUser.role_code === ROLES.SUPER_ADMIN || adminUser.role_code === ROLES.SENIOR_AUDITOR;
  if (!isAdmin) {
    return { success: false, error: 'Permission denied' };
  }

  filters = filters || {};
  
  const sheet = getSheet(SHEETS.USERS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const colMap = {};
  headers.forEach((h, i) => colMap[h] = i);
  
  let users = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[colMap['user_id']]) continue;
    
    let match = true;
    
    if (filters.role_code && row[colMap['role_code']] !== filters.role_code) match = false;
    if (filters.is_active !== undefined) {
      const rowActive = isActive(row[colMap['is_active']]);
      if (rowActive !== filters.is_active) match = false;
    }
    if (filters.affiliate_code && row[colMap['affiliate_code']] !== filters.affiliate_code) match = false;
    
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const name = String(row[colMap['full_name']] || '').toLowerCase();
      const email = String(row[colMap['email']] || '').toLowerCase();
      if (!name.includes(searchLower) && !email.includes(searchLower)) {
        match = false;
      }
    }
    
    if (match) {
      const user = rowToObject(headers, row);
      delete user.password_hash;
      delete user.password_salt;
      user._rowIndex = i + 1;
      users.push(user);
    }
  }
  
  users.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  
  return sanitizeForClient({ success: true, users: users, total: users.length });
}

function updateUserIndex(userId, user, rowNumber) {
  const indexSheet = getSheet(SHEETS.INDEX_USERS);
  const data = indexSheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('user_id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === userId) {
      const row = [userId, rowNumber, user.email, user.role_code, user.is_active, new Date()];
      indexSheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  
  const row = [userId, rowNumber, user.email, user.role_code, user.is_active, new Date()];
  indexSheet.appendRow(row);
}

// sanitizeForClient() is defined in 01_Core.gs (canonical)
