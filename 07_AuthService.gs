// 07_AuthService.gs - Authentication, Session Management, Password Management, User Management

const AUTH_CONFIG = {
  SESSION_DURATION_HOURS: 24,
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MINUTES: 30,
  PBKDF2_ITERATIONS: 10000,
  SALT_LENGTH: 32,
  TOKEN_LENGTH: 64,
  TEMP_PASSWORD_LENGTH: 12
};

function login(email, password) {
  if (!email || !password) {
    return { success: false, error: 'Email and password are required' };
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  const user = getUserByEmail(normalizedEmail);

  // APPLICATION-LEVEL ACCESS CONTROL
  // Only users in the Users sheet can access the system
  // This allows deployment as "Anyone with Google Account" while controlling access via database
  if (!user) {
    Utilities.sleep(500); // Timing attack mitigation
    return { success: false, error: 'Access denied. Contact administrator.' };
  }

  // Check if account is active
  if (!isActive(user.is_active)) {
    return { success: false, error: 'Account is inactive. Contact administrator.' };
  }
  
  // Check if account is locked
  if (user.locked_until) {
    const lockUntil = new Date(user.locked_until);
    if (lockUntil > new Date()) {
      const minutesLeft = Math.ceil((lockUntil - new Date()) / (1000 * 60));
      return { 
        success: false, 
        error: `Account is locked. Try again in ${minutesLeft} minute(s).` 
      };
    }
  }
  
  // Verify password
  const passwordValid = verifyPassword(password, user.password_salt, user.password_hash);
  
  if (!passwordValid) {
    // Increment failed attempts
    incrementFailedAttempts(user);
    return { success: false, error: 'Invalid email or password' };
  }
  
  // Reset failed attempts on successful login
  resetFailedAttempts(user);
  
  // Create session
  const session = createSession(user);
  
  // Update last login
  updateLastLogin(user);
  
  // Log audit event
  logAuditEvent('LOGIN', 'USER', user.user_id, null, { email: user.email }, user.user_id, user.email);
  
  return {
    success: true,
    sessionToken: session.session_token,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: getRoleName(user.role_code),
      affiliate_code: user.affiliate_code,
      must_change_password: user.must_change_password
    }
  };
}

/**
 * Logout - invalidate session
 */
function logout(sessionToken) {
  if (!sessionToken) {
    return { success: false, error: 'Session token required' };
  }
  
  const session = getSessionByToken(sessionToken);
  if (session) {
    invalidateSession(session.session_id);
    logAuditEvent('LOGOUT', 'USER', session.user_id, null, null, session.user_id, '');
  }
  
  return { success: true };
}

/**
 * Validate session and return user
 */
function validateSession(sessionToken) {
  console.log('validateSession called, token provided:', !!sessionToken);

  if (!sessionToken) {
    return { valid: false, error: 'No session token' };
  }

  const session = getSessionByToken(sessionToken);
  console.log('Session lookup result:', session ? 'found' : 'not found');

  if (!session) {
    return { valid: false, error: 'Session not found' };
  }

  if (!isActive(session.is_valid)) {
    console.log('Session is invalidated');
    return { valid: false, error: 'Session invalidated' };
  }

  const expiresAt = new Date(session.expires_at);
  if (expiresAt < new Date()) {
    console.log('Session expired at:', expiresAt);
    invalidateSession(session.session_id);
    return { valid: false, error: 'Session expired' };
  }

  // Get user - try multiple methods
  console.log('Looking up user:', session.user_id);
  let user = getUserById(session.user_id);

  // Fallback: If getUserById fails (index issue), try direct lookup
  if (!user) {
    console.log('getUserById returned null, trying direct sheet lookup...');
    try {
      const sheet = getSheet(SHEETS.USERS);
      if (sheet) {
        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const idIdx = headers.indexOf('user_id');

        for (let i = 1; i < data.length; i++) {
          if (data[i][idIdx] === session.user_id) {
            user = rowToObject(headers, data[i]);
            user._rowIndex = i + 1;
            console.log('Found user via direct lookup:', user.email);
            break;
          }
        }
      }
    } catch (e) {
      console.error('Direct user lookup failed:', e);
    }
  }

  if (!user || !isActive(user.is_active)) {
    console.log('User not found or inactive');
    invalidateSession(session.session_id);
    return { valid: false, error: 'User not found or inactive' };
  }

  console.log('Session valid for user:', user.email);

  return {
    valid: true,
    user: {
      user_id: user.user_id,
      email: user.email,
      full_name: user.full_name,
      role_code: user.role_code,
      role_name: getRoleName(user.role_code),
      affiliate_code: user.affiliate_code,
      department: user.department,
      must_change_password: user.must_change_password,
      is_active: user.is_active
    }
  };
}

/**
 * Get current user from Google session (for Apps Script web apps)
 * Note: Returns null when deployed as web app with "Anyone with Google Account"
 * because Session.getActiveUser().getEmail() returns empty string
 */
function getCurrentUser() {
  try {
    const email = Session.getActiveUser().getEmail();
    console.log('getCurrentUser - email from Session:', email || '(empty)');

    if (!email) {
      // This is NORMAL for web apps deployed as "Anyone with Google Account"
      // Authentication will fall back to session token validation
      return null;
    }

    const user = getUserByEmail(email);
    console.log('getCurrentUser - user lookup:', user ? user.email : 'not found');

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
  sheet.appendRow(row);
  
  return session;
}

/**
 * Get session by token
 */
function getSessionByToken(token) {
  if (!token) return null;
  
  // Check cache first
  const cacheKey = 'session_' + token.substring(0, 16);
  const cache = CacheService.getScriptCache();
  const cached = cache.get(cacheKey);
  
  if (cached) {
    try { return JSON.parse(cached); } catch (e) {}
  }
  
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const tokenIdx = headers.indexOf('session_token');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][tokenIdx] === token) {
      const session = rowToObject(headers, data[i]);
      session._rowIndex = i + 1;
      
      // Cache for 5 minutes
      cache.put(cacheKey, JSON.stringify(session), 300);
      return session;
    }
  }
  
  return null;
}

/**
 * Invalidate a session
 */
function invalidateSession(sessionId) {
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idIdx = headers.indexOf('session_id');
  const validIdx = headers.indexOf('is_valid');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idIdx] === sessionId) {
      sheet.getRange(i + 1, validIdx + 1).setValue(false);
      
      // Clear cache
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

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions() {
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const expiresIdx = headers.indexOf('expires_at');
  const validIdx = headers.indexOf('is_valid');
  
  const now = new Date();
  let cleaned = 0;
  
  // Delete from bottom to top
  for (let i = data.length - 1; i >= 1; i--) {
    const expiresAt = data[i][expiresIdx];
    const isValid = data[i][validIdx];
    
    // Delete if expired or invalid
    if (!isValid || (expiresAt && new Date(expiresAt) < now)) {
      sheet.deleteRow(i + 1);
      cleaned++;
    }
  }
  
  console.log('Cleaned up sessions:', cleaned);
  return cleaned;
}

function hashPassword(password, salt) {
  // Use HMAC-SHA256 with iterations to simulate PBKDF2
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

/**
 * Verify password
 */
function verifyPassword(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  
  const computedHash = hashPassword(password, salt);
  return computedHash === storedHash;
}

/**
 * Generate salt
 */
function generateSalt() {
  const bytes = [];
  for (let i = 0; i < AUTH_CONFIG.SALT_LENGTH; i++) {
    bytes.push(Math.floor(Math.random() * 256));
  }
  return Utilities.base64Encode(bytes);
}

/**
 * Generate secure token
 */
function generateSecureToken(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Generate temporary password
 */
function generateTempPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const numbers = '23456789';
  const special = '!@#$%';
  
  let password = '';
  
  // Ensure at least one of each type
  password += upper.charAt(Math.floor(Math.random() * upper.length));
  password += lower.charAt(Math.floor(Math.random() * lower.length));
  password += numbers.charAt(Math.floor(Math.random() * numbers.length));
  password += special.charAt(Math.floor(Math.random() * special.length));
  
  // Fill the rest
  const allChars = upper + lower + numbers;
  for (let i = password.length; i < AUTH_CONFIG.TEMP_PASSWORD_LENGTH; i++) {
    password += allChars.charAt(Math.floor(Math.random() * allChars.length));
  }
  
  // Shuffle
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Change password
 */
function changePassword(userId, currentPassword, newPassword) {
  try {
    console.log('changePassword called for userId:', userId);

    if (!userId) {
      console.error('changePassword: No userId provided');
      return { success: false, error: 'User ID is required' };
    }

    if (!currentPassword || !newPassword) {
      console.error('changePassword: Missing password parameters');
      return { success: false, error: 'Current and new passwords are required' };
    }

    const user = getUserById(userId);
    if (!user) {
      console.error('changePassword: User not found:', userId);
      return { success: false, error: 'User not found' };
    }

    console.log('changePassword: User found:', user.email, ', _rowIndex:', user._rowIndex);

    // CRITICAL: Verify _rowIndex exists
    if (!user._rowIndex) {
      console.error('changePassword: User found but _rowIndex is missing:', user.email);
      // Try to find the row index directly
      try {
        const sheet = getSheet(SHEETS.USERS);
        if (!sheet) {
          console.error('changePassword: Users sheet not found');
          return { success: false, error: 'System error: Users sheet not found' };
        }

        const data = sheet.getDataRange().getValues();
        const headers = data[0];
        const idIdx = headers.indexOf('user_id');

        if (idIdx === -1) {
          console.error('changePassword: user_id column not found in sheet');
          return { success: false, error: 'System error: Invalid sheet structure' };
        }

        for (let i = 1; i < data.length; i++) {
          if (data[i][idIdx] === userId) {
            user._rowIndex = i + 1;
            console.log('changePassword: Found _rowIndex via direct lookup:', user._rowIndex);
            break;
          }
        }

        if (!user._rowIndex) {
          console.error('changePassword: Could not find user row after direct lookup');
          return { success: false, error: 'Unable to locate user record for update' };
        }
      } catch (lookupError) {
        console.error('changePassword: Error during direct lookup:', lookupError);
        return { success: false, error: 'System error during user lookup: ' + lookupError.message };
      }
    }

    // Verify current password
    console.log('changePassword: Verifying current password');
    if (!verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
      console.log('changePassword: Current password verification failed');
      return { success: false, error: 'Current password is incorrect' };
    }

    // Validate new password
    console.log('changePassword: Validating new password');
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      console.log('changePassword: New password validation failed:', validation.error);
      return { success: false, error: validation.error };
    }

    // Hash new password
    console.log('changePassword: Hashing new password');
    const salt = generateSalt();
    const hash = hashPassword(newPassword, salt);

    // Update user
    const sheet = getSheet(SHEETS.USERS);
    if (!sheet) {
      console.error('changePassword: Could not get Users sheet for update');
      return { success: false, error: 'System error: Users sheet not found' };
    }

    const rowIndex = user._rowIndex;
    console.log('changePassword: Updating row', rowIndex, 'for user', user.email);

    // Get column indexes
    const hashIdx = getColumnIndex('USERS', 'password_hash');
    const saltIdx = getColumnIndex('USERS', 'password_salt');
    const mustChangeIdx = getColumnIndex('USERS', 'must_change_password');
    const updatedIdx = getColumnIndex('USERS', 'updated_at');

    console.log('changePassword: Column indexes - hash:', hashIdx, 'salt:', saltIdx, 'mustChange:', mustChangeIdx, 'updated:', updatedIdx);

    // Perform updates
    sheet.getRange(rowIndex, hashIdx + 1).setValue(hash);
    sheet.getRange(rowIndex, saltIdx + 1).setValue(salt);
    sheet.getRange(rowIndex, mustChangeIdx + 1).setValue(false);
    sheet.getRange(rowIndex, updatedIdx + 1).setValue(new Date());

    console.log('changePassword: Sheet updated successfully');

    // Invalidate user cache
    try {
      invalidateUserCache(user.email);
      console.log('changePassword: User cache invalidated');
    } catch (cacheError) {
      console.error('changePassword: Error invalidating cache (non-fatal):', cacheError);
    }

    // Log audit event
    try {
      logAuditEvent('CHANGE_PASSWORD', 'USER', userId, null, null, userId, user.email);
      console.log('changePassword: Audit event logged');
    } catch (auditError) {
      console.error('changePassword: Error logging audit event (non-fatal):', auditError);
    }

    console.log('changePassword: Success for user', user.email);
    return { success: true };

  } catch (error) {
    console.error('changePassword: Unexpected error:', error);
    console.error('changePassword: Error stack:', error.stack);
    return { success: false, error: 'System error: ' + error.message };
  }
}

/**
 * Reset password (admin function)
 */
function resetPassword(userId, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  // Check permission
  if (adminUser.role_code !== ROLES.SUPER_ADMIN && adminUser.role_code !== ROLES.HEAD_OF_AUDIT) {
    return { success: false, error: 'Permission denied' };
  }
  
  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  // Generate temp password
  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  const hash = hashPassword(tempPassword, salt);
  
  // Update user
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  
  const hashIdx = getColumnIndex('USERS', 'password_hash');
  const saltIdx = getColumnIndex('USERS', 'password_salt');
  const mustChangeIdx = getColumnIndex('USERS', 'must_change_password');
  const updatedIdx = getColumnIndex('USERS', 'updated_at');
  const attemptsIdx = getColumnIndex('USERS', 'login_attempts');
  const lockedIdx = getColumnIndex('USERS', 'locked_until');
  
  sheet.getRange(rowIndex, hashIdx + 1).setValue(hash);
  sheet.getRange(rowIndex, saltIdx + 1).setValue(salt);
  sheet.getRange(rowIndex, mustChangeIdx + 1).setValue(true);
  sheet.getRange(rowIndex, updatedIdx + 1).setValue(new Date());
  sheet.getRange(rowIndex, attemptsIdx + 1).setValue(0);
  sheet.getRange(rowIndex, lockedIdx + 1).setValue('');
  
  // Invalidate user cache
  invalidateUserCache(user.email);
  
  // Send email with temp password
  queueEmail({
    template_code: 'PASSWORD_RESET',
    recipient_email: user.email,
    recipient_user_id: user.user_id,
    subject: 'Your Password Has Been Reset',
    body: `Hello ${user.full_name},\n\nYour password has been reset by an administrator.\n\n` +
          `Your temporary password is: ${tempPassword}\n\n` +
          `Please log in and change your password immediately.\n\n` +
          `If you did not request this reset, please contact your administrator.`,
    module: 'AUTH',
    record_id: userId
  });
  
  logAuditEvent('RESET_PASSWORD', 'USER', userId, null, null, adminUser.user_id, adminUser.email);
  
  return { success: true, tempPassword: tempPassword };
}

/**
 * Validate password strength
 */
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
  const rowIndex = user._rowIndex;
  
  const attemptsIdx = getColumnIndex('USERS', 'login_attempts');
  const lockedIdx = getColumnIndex('USERS', 'locked_until');
  
  const attempts = (parseInt(user.login_attempts) || 0) + 1;
  sheet.getRange(rowIndex, attemptsIdx + 1).setValue(attempts);
  
  // Lock account if too many attempts
  if (attempts >= AUTH_CONFIG.MAX_LOGIN_ATTEMPTS) {
    const lockUntil = new Date();
    lockUntil.setMinutes(lockUntil.getMinutes() + AUTH_CONFIG.LOCKOUT_DURATION_MINUTES);
    sheet.getRange(rowIndex, lockedIdx + 1).setValue(lockUntil);
    
    logAuditEvent('ACCOUNT_LOCKED', 'USER', user.user_id, null, { attempts: attempts }, '', user.email);
  }
  
  // Invalidate cache
  invalidateUserCache(user.email);
}

/**
 * Reset failed login attempts
 */
function resetFailedAttempts(user) {
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  
  const attemptsIdx = getColumnIndex('USERS', 'login_attempts');
  const lockedIdx = getColumnIndex('USERS', 'locked_until');
  
  sheet.getRange(rowIndex, attemptsIdx + 1).setValue(0);
  sheet.getRange(rowIndex, lockedIdx + 1).setValue('');
  
  // Invalidate cache
  invalidateUserCache(user.email);
}

/**
 * Update last login timestamp
 */
function updateLastLogin(user) {
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  
  const lastLoginIdx = getColumnIndex('USERS', 'last_login');
  sheet.getRange(rowIndex, lastLoginIdx + 1).setValue(new Date());
  
  // Invalidate cache
  invalidateUserCache(user.email);
}

function createUser(userData, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  if (adminUser.role_code !== ROLES.SUPER_ADMIN && adminUser.role_code !== ROLES.HEAD_OF_AUDIT) {
    return { success: false, error: 'Permission denied' };
  }
  
  // Validate required fields
  if (!userData.email || !userData.full_name || !userData.role_code) {
    return { success: false, error: 'Email, full name, and role are required' };
  }
  
  // Check if email already exists
  const existing = getUserByEmail(userData.email);
  if (existing) {
    return { success: false, error: 'User with this email already exists' };
  }
  
  // Generate user ID and temp password
  const userId = generateId('USER');
  const tempPassword = generateTempPassword();
  const salt = generateSalt();
  const hash = hashPassword(tempPassword, salt);
  const now = new Date();
  
  // Split name
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
  
  // Insert into sheet
  const sheet = getSheet(SHEETS.USERS);
  const row = objectToRow('USERS', user);
  sheet.appendRow(row);
  
  // Update index
  const rowNum = sheet.getLastRow();
  updateUserIndex(userId, user, rowNum);
  
  // Invalidate dropdown cache
  invalidateDropdownCache();
  
  // Send welcome email
  queueEmail({
    template_code: 'WELCOME_USER',
    recipient_email: user.email,
    recipient_user_id: userId,
    subject: 'Welcome to Hass Petroleum Internal Audit System',
    body: `Hello ${user.full_name},\n\n` +
          `Your account has been created for the Hass Petroleum Internal Audit System.\n\n` +
          `Email: ${user.email}\n` +
          `Temporary Password: ${tempPassword}\n\n` +
          `Please log in and change your password immediately.\n\n` +
          `Best regards,\nAudit Team`,
    module: 'AUTH',
    record_id: userId
  });
  
  logAuditEvent('CREATE', 'USER', userId, null, user, adminUser.user_id, adminUser.email);
  
  return { success: true, userId: userId, tempPassword: tempPassword };
}

/**
 * Update user
 */
function updateUser(userId, userData, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  // Check permission (can update self or be admin)
  const isSelf = adminUser.user_id === userId;
  const isAdmin = adminUser.role_code === ROLES.SUPER_ADMIN || adminUser.role_code === ROLES.HEAD_OF_AUDIT;
  
  if (!isSelf && !isAdmin) {
    return { success: false, error: 'Permission denied' };
  }
  
  const now = new Date();
  const updates = { updated_at: now, updated_by: adminUser.user_id };
  
  // Fields that users can update themselves
  const selfEditableFields = ['full_name', 'phone', 'department'];
  
  // Fields that only admins can update
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
  
  // Update name parts
  if (updates.full_name) {
    const nameParts = updates.full_name.trim().split(' ');
    updates.first_name = nameParts[0] || '';
    updates.last_name = nameParts.slice(1).join(' ') || '';
  }
  
  // Apply updates
  const updated = { ...user, ...updates };
  
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  const row = objectToRow('USERS', updated);
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  
  // Invalidate caches
  invalidateUserCache(user.email);
  if (updates.email && updates.email !== user.email) {
    invalidateUserCache(updates.email);
  }
  invalidateDropdownCache();
  
  logAuditEvent('UPDATE', 'USER', userId, user, updated, adminUser.user_id, adminUser.email);
  
  return { success: true, user: updated };
}

/**
 * Deactivate user
 */
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
  
  const user = getUserById(userId);
  if (!user) {
    return { success: false, error: 'User not found' };
  }
  
  // Update is_active to false
  const sheet = getSheet(SHEETS.USERS);
  const rowIndex = user._rowIndex;
  const activeIdx = getColumnIndex('USERS', 'is_active');
  
  sheet.getRange(rowIndex, activeIdx + 1).setValue(false);
  
  // Invalidate all user sessions
  invalidateUserSessions(userId);
  
  // Invalidate caches
  invalidateUserCache(user.email);
  invalidateDropdownCache();
  
  logAuditEvent('DEACTIVATE', 'USER', userId, user, null, adminUser.user_id, adminUser.email);
  
  return { success: true };
}

/**
 * Invalidate all sessions for a user
 */
function invalidateUserSessions(userId) {
  const sheet = getSheet(SHEETS.SESSIONS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const userIdIdx = headers.indexOf('user_id');
  const validIdx = headers.indexOf('is_valid');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][userIdIdx] === userId) {
      sheet.getRange(i + 1, validIdx + 1).setValue(false);
    }
  }
}

/**
 * Get all users (for admin)
 */
function getUsers(filters, adminUser) {
  if (!adminUser) {
    return { success: false, error: 'Admin user required' };
  }
  
  const isAdmin = adminUser.role_code === ROLES.SUPER_ADMIN || adminUser.role_code === ROLES.HEAD_OF_AUDIT;
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
      // Remove sensitive fields
      delete user.password_hash;
      delete user.password_salt;
      user._rowIndex = i + 1;
      users.push(user);
    }
  }
  
  users.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  
  return { success: true, users: users, total: users.length };
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

function queueEmail(data) {
  return queueNotification({
    template_code: data.template_code || '',
    recipient_user_id: data.recipient_user_id || '',
    recipient_email: data.recipient_email || '',
    subject: data.subject || '',
    body: data.body || '',
    module: data.module || 'AUTH',
    record_id: data.record_id || ''
  });
}





