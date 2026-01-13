/**
 * HASS PETROLEUM INTERNAL AUDIT MANAGEMENT SYSTEM
 * Authentication Service v1.0
 * 
 * Handles login, password management, and session management
 */

// ============================================================
// LOGIN / LOGOUT
// ============================================================

/**
 * Authenticate user with email and password
 */
function login(email, password) {
  try {
    if (!email || !password) {
      return { success: false, error: 'Email and password are required' };
    }
    
    const sheet = getSheet('05_Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Get column indices
    const cols = {
      userId: headers.indexOf('user_id'),
      email: headers.indexOf('email'),
      fullName: headers.indexOf('full_name'),
      roleCode: headers.indexOf('role_code'),
      affiliateCode: headers.indexOf('affiliate_code'),
      department: headers.indexOf('department'),
      isActive: headers.indexOf('is_active'),
      passwordHash: headers.indexOf('password_hash'),
      passwordSalt: headers.indexOf('password_salt'),
      mustChangePassword: headers.indexOf('must_change_password'),
      loginAttempts: headers.indexOf('login_attempts'),
      lockedUntil: headers.indexOf('locked_until'),
      lastLogin: headers.indexOf('last_login')
    };
    
    // Find user by email
    let userRow = -1;
    let userData = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][cols.email].toString().toLowerCase() === email.toLowerCase()) {
        userRow = i;
        userData = data[i];
        break;
      }
    }
    
    if (!userData) {
      return { success: false, error: 'Invalid email or password' };
    }
    
    // Check if user is active
    if (!userData[cols.isActive] || userData[cols.isActive] === 'FALSE') {
      return { success: false, error: 'Account is deactivated. Contact administrator.' };
    }
    
    // Check if account is locked
    const lockedUntil = userData[cols.lockedUntil];
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      const remainingMins = Math.ceil((new Date(lockedUntil) - new Date()) / 60000);
      return { success: false, error: `Account locked. Try again in ${remainingMins} minutes.` };
    }
    
    // Verify password
    const storedHash = userData[cols.passwordHash];
    const salt = userData[cols.passwordSalt];
    
    if (!storedHash || !salt) {
      return { success: false, error: 'Account not set up. Contact administrator.' };
    }
    
    const inputHash = hashPassword(password, salt);
    
    if (inputHash !== storedHash) {
      // Increment failed attempts
      const attempts = (parseInt(userData[cols.loginAttempts]) || 0) + 1;
      sheet.getRange(userRow + 1, cols.loginAttempts + 1).setValue(attempts);
      
      // Lock account after 5 failed attempts
      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        sheet.getRange(userRow + 1, cols.lockedUntil + 1).setValue(lockUntil);
        return { success: false, error: 'Too many failed attempts. Account locked for 30 minutes.' };
      }
      
      return { success: false, error: `Invalid email or password. ${5 - attempts} attempts remaining.` };
    }
    
    // Successful login - reset attempts and update last login
    sheet.getRange(userRow + 1, cols.loginAttempts + 1).setValue(0);
    sheet.getRange(userRow + 1, cols.lockedUntil + 1).setValue('');
    sheet.getRange(userRow + 1, cols.lastLogin + 1).setValue(new Date());
    
    // Create session
    const sessionToken = createSession(userData[cols.userId]);
    
    // Check if password change required
    const mustChange = userData[cols.mustChangePassword] === true || 
                       userData[cols.mustChangePassword] === 'TRUE';
    
    return {
      success: true,
      sessionToken: sessionToken,
      mustChangePassword: mustChange,
      user: {
        user_id: userData[cols.userId],
        email: userData[cols.email],
        full_name: userData[cols.fullName],
        role_code: userData[cols.roleCode],
        role_name: getRoleName(userData[cols.roleCode]),
        affiliate_code: userData[cols.affiliateCode],
        department: userData[cols.department]
      }
    };
    
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: 'Login failed. Please try again.' };
  }
}

/**
 * Logout - invalidate session
 */
function logout(sessionToken) {
  try {
    if (!sessionToken) {
      return { success: true };
    }
    
    const sheet = getSheet('20_Sessions');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const tokenIdx = headers.indexOf('session_token');
    const validIdx = headers.indexOf('is_valid');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][tokenIdx] === sessionToken) {
        sheet.getRange(i + 1, validIdx + 1).setValue(false);
        break;
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Logout error:', error);
    return { success: true }; // Still return success - don't block user
  }
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Create a new session for user
 */
function createSession(userId) {
  const sheet = getSheet('20_Sessions');
  
  // Generate session token
  const sessionToken = generateSessionToken();
  const sessionId = 'SES-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-8);
  
  // Session expires in 8 hours
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  
  // Add session row
  sheet.appendRow([
    sessionId,
    userId,
    sessionToken,
    new Date(),
    expiresAt,
    '', // IP address (not available in Apps Script)
    '', // User agent
    true
  ]);
  
  return sessionToken;
}

/**
 * Validate session token and return user info
 */
function validateSession(sessionToken) {
  try {
    if (!sessionToken) {
      return { valid: false, error: 'No session token' };
    }
    
    const sessionsSheet = getSheet('20_Sessions');
    const sessData = sessionsSheet.getDataRange().getValues();
    const sessHeaders = sessData[0];
    
    const cols = {
      sessionId: sessHeaders.indexOf('session_id'),
      userId: sessHeaders.indexOf('user_id'),
      token: sessHeaders.indexOf('session_token'),
      expiresAt: sessHeaders.indexOf('expires_at'),
      isValid: sessHeaders.indexOf('is_valid')
    };
    
    // Find session
    let session = null;
    let sessionRow = -1;
    
    for (let i = 1; i < sessData.length; i++) {
      if (sessData[i][cols.token] === sessionToken) {
        session = sessData[i];
        sessionRow = i;
        break;
      }
    }
    
    if (!session) {
      return { valid: false, error: 'Invalid session' };
    }
    
    // Check if valid
    if (!session[cols.isValid] || session[cols.isValid] === 'FALSE') {
      return { valid: false, error: 'Session invalidated' };
    }
    
    // Check expiry
    const expiresAt = new Date(session[cols.expiresAt]);
    if (expiresAt < new Date()) {
      // Mark as invalid
      sessionsSheet.getRange(sessionRow + 1, cols.isValid + 1).setValue(false);
      return { valid: false, error: 'Session expired' };
    }
    
    // Get user info
    const userId = session[cols.userId];
    const usersSheet = getSheet('05_Users');
    const userData = usersSheet.getDataRange().getValues();
    const userHeaders = userData[0];
    
    const userCols = {
      userId: userHeaders.indexOf('user_id'),
      email: userHeaders.indexOf('email'),
      fullName: userHeaders.indexOf('full_name'),
      roleCode: userHeaders.indexOf('role_code'),
      affiliateCode: userHeaders.indexOf('affiliate_code'),
      department: userHeaders.indexOf('department'),
      isActive: userHeaders.indexOf('is_active'),
      mustChangePassword: userHeaders.indexOf('must_change_password')
    };
    
    let user = null;
    for (let i = 1; i < userData.length; i++) {
      if (userData[i][userCols.userId] === userId) {
        user = userData[i];
        break;
      }
    }
    
    if (!user || !user[userCols.isActive] || user[userCols.isActive] === 'FALSE') {
      return { valid: false, error: 'User not found or inactive' };
    }
    
    const mustChange = user[userCols.mustChangePassword] === true || 
                       user[userCols.mustChangePassword] === 'TRUE';
    
    return {
      valid: true,
      mustChangePassword: mustChange,
      user: {
        user_id: user[userCols.userId],
        email: user[userCols.email],
        full_name: user[userCols.fullName],
        role_code: user[userCols.roleCode],
        role_name: getRoleName(user[userCols.roleCode]),
        affiliate_code: user[userCols.affiliateCode],
        department: user[userCols.department]
      }
    };
    
  } catch (error) {
    console.error('validateSession error:', error);
    return { valid: false, error: 'Session validation failed' };
  }
}

/**
 * Get current user from session (called by frontend)
 */
function getSessionUser(sessionToken) {
  const result = validateSession(sessionToken);
  
  if (!result.valid) {
    return { success: false, error: result.error };
  }
  
  // Get permissions
  const permissions = getUserPermissions(result.user.role_code);
  
  return {
    success: true,
    mustChangePassword: result.mustChangePassword,
    user: result.user,
    permissions: permissions
  };
}

/**
 * Generate secure session token
 */
function generateSessionToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// ============================================================
// PASSWORD MANAGEMENT
// ============================================================

/**
 * Change password
 */
function changePassword(sessionToken, currentPassword, newPassword) {
  try {
    // Validate session
    const sessionResult = validateSession(sessionToken);
    if (!sessionResult.valid) {
      return { success: false, error: 'Invalid session. Please login again.' };
    }
    
    const userId = sessionResult.user.user_id;
    
    // Validate new password
    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters' };
    }
    
    if (!/[A-Z]/.test(newPassword)) {
      return { success: false, error: 'Password must contain at least one uppercase letter' };
    }
    
    if (!/[a-z]/.test(newPassword)) {
      return { success: false, error: 'Password must contain at least one lowercase letter' };
    }
    
    if (!/[0-9]/.test(newPassword)) {
      return { success: false, error: 'Password must contain at least one number' };
    }
    
    // Get user data
    const sheet = getSheet('05_Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const cols = {
      userId: headers.indexOf('user_id'),
      passwordHash: headers.indexOf('password_hash'),
      passwordSalt: headers.indexOf('password_salt'),
      mustChangePassword: headers.indexOf('must_change_password')
    };
    
    let userRow = -1;
    let userData = null;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][cols.userId] === userId) {
        userRow = i;
        userData = data[i];
        break;
      }
    }
    
    if (!userData) {
      return { success: false, error: 'User not found' };
    }
    
    // Verify current password (skip if must_change_password is true - first login)
    const mustChange = userData[cols.mustChangePassword] === true || 
                       userData[cols.mustChangePassword] === 'TRUE';
    
    if (!mustChange) {
      const currentHash = hashPassword(currentPassword, userData[cols.passwordSalt]);
      if (currentHash !== userData[cols.passwordHash]) {
        return { success: false, error: 'Current password is incorrect' };
      }
    }
    
    // Generate new salt and hash
    const newSalt = generateSalt();
    const newHash = hashPassword(newPassword, newSalt);
    
    // Update password
    sheet.getRange(userRow + 1, cols.passwordHash + 1).setValue(newHash);
    sheet.getRange(userRow + 1, cols.passwordSalt + 1).setValue(newSalt);
    sheet.getRange(userRow + 1, cols.mustChangePassword + 1).setValue(false);
    
    return { success: true, message: 'Password changed successfully' };
    
  } catch (error) {
    console.error('changePassword error:', error);
    return { success: false, error: 'Failed to change password' };
  }
}

/**
 * Generate salt for password hashing
 */
function generateSalt() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let salt = '';
  for (let i = 0; i < 32; i++) {
    salt += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return salt;
}

/**
 * Hash password with salt
 */
function hashPassword(password, salt) {
  const input = password + salt;
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  return rawHash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

// ============================================================
// ADMIN - USER MANAGEMENT
// ============================================================

/**
 * Admin: Create new user
 */
function adminCreateUser(sessionToken, userData) {
  try {
    // Validate admin session
    const sessionResult = validateSession(sessionToken);
    if (!sessionResult.valid) {
      return { success: false, error: 'Invalid session' };
    }
    
    if (sessionResult.user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only administrators can create users' };
    }
    
    // Validate required fields
    if (!userData.email || !userData.first_name || !userData.last_name || !userData.role_code) {
      return { success: false, error: 'Missing required fields' };
    }
    
    // Check email doesn't already exist
    const sheet = getSheet('05_Users');
    const existingData = sheet.getDataRange().getValues();
    const headers = existingData[0];
    const emailIdx = headers.indexOf('email');
    
    for (let i = 1; i < existingData.length; i++) {
      if (existingData[i][emailIdx].toString().toLowerCase() === userData.email.toLowerCase()) {
        return { success: false, error: 'User with this email already exists' };
      }
    }
    
    // Generate user ID
    const userId = getNextId('USER');
    
    // Generate temp password
    const emailPrefix = userData.email.split('@')[0].substring(0, 4).toLowerCase();
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = emailPrefix + randomDigits;
    
    // Generate salt and hash
    const salt = generateSalt();
    const hash = hashPassword(tempPassword, salt);
    
    // Prepare row data
    const fullName = userData.first_name + ' ' + userData.last_name;
    const now = new Date();
    
    // Get column count from headers
    const newRow = new Array(headers.length).fill('');
    
    // Set values by column index
    newRow[headers.indexOf('user_id')] = userId;
    newRow[headers.indexOf('email')] = userData.email;
    newRow[headers.indexOf('first_name')] = userData.first_name;
    newRow[headers.indexOf('last_name')] = userData.last_name;
    newRow[headers.indexOf('full_name')] = fullName;
    newRow[headers.indexOf('role_code')] = userData.role_code;
    newRow[headers.indexOf('affiliate_code')] = userData.affiliate_code || '';
    newRow[headers.indexOf('department')] = userData.department || '';
    newRow[headers.indexOf('phone')] = userData.phone || '';
    newRow[headers.indexOf('is_active')] = true;
    newRow[headers.indexOf('created_at')] = now;
    newRow[headers.indexOf('created_by')] = sessionResult.user.user_id;
    newRow[headers.indexOf('password_hash')] = hash;
    newRow[headers.indexOf('password_salt')] = salt;
    newRow[headers.indexOf('must_change_password')] = true;
    newRow[headers.indexOf('login_attempts')] = 0;
    
    // Append row
    sheet.appendRow(newRow);
    
    // Log audit
    logAudit('CREATE', 'USER', userId, null, { email: userData.email, role: userData.role_code });
    
    return {
      success: true,
      user_id: userId,
      temp_password: tempPassword,
      message: `User created. Temporary password: ${tempPassword}`
    };
    
  } catch (error) {
    console.error('adminCreateUser error:', error);
    return { success: false, error: 'Failed to create user' };
  }
}

/**
 * Admin: Reset user password
 */
function adminResetPassword(sessionToken, userId) {
  try {
    // Validate admin session
    const sessionResult = validateSession(sessionToken);
    if (!sessionResult.valid) {
      return { success: false, error: 'Invalid session' };
    }
    
    if (sessionResult.user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only administrators can reset passwords' };
    }
    
    const sheet = getSheet('05_Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const cols = {
      userId: headers.indexOf('user_id'),
      email: headers.indexOf('email'),
      passwordHash: headers.indexOf('password_hash'),
      passwordSalt: headers.indexOf('password_salt'),
      mustChangePassword: headers.indexOf('must_change_password'),
      loginAttempts: headers.indexOf('login_attempts'),
      lockedUntil: headers.indexOf('locked_until')
    };
    
    let userRow = -1;
    let userEmail = '';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][cols.userId] === userId) {
        userRow = i;
        userEmail = data[i][cols.email];
        break;
      }
    }
    
    if (userRow === -1) {
      return { success: false, error: 'User not found' };
    }
    
    // Generate new temp password
    const emailPrefix = userEmail.split('@')[0].substring(0, 4).toLowerCase();
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = emailPrefix + randomDigits;
    
    // Generate new salt and hash
    const salt = generateSalt();
    const hash = hashPassword(tempPassword, salt);
    
    // Update user
    sheet.getRange(userRow + 1, cols.passwordHash + 1).setValue(hash);
    sheet.getRange(userRow + 1, cols.passwordSalt + 1).setValue(salt);
    sheet.getRange(userRow + 1, cols.mustChangePassword + 1).setValue(true);
    sheet.getRange(userRow + 1, cols.loginAttempts + 1).setValue(0);
    sheet.getRange(userRow + 1, cols.lockedUntil + 1).setValue('');
    
    // Log audit
    logAudit('PASSWORD_RESET', 'USER', userId, null, { reset_by: sessionResult.user.user_id });
    
    return {
      success: true,
      temp_password: tempPassword,
      message: `Password reset. New temporary password: ${tempPassword}`
    };
    
  } catch (error) {
    console.error('adminResetPassword error:', error);
    return { success: false, error: 'Failed to reset password' };
  }
}

/**
 * Admin: Deactivate/Activate user
 */
function adminToggleUserStatus(sessionToken, userId, isActive) {
  try {
    // Validate admin session
    const sessionResult = validateSession(sessionToken);
    if (!sessionResult.valid) {
      return { success: false, error: 'Invalid session' };
    }
    
    if (sessionResult.user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only administrators can modify users' };
    }
    
    // Prevent self-deactivation
    if (userId === sessionResult.user.user_id && !isActive) {
      return { success: false, error: 'Cannot deactivate your own account' };
    }
    
    const sheet = getSheet('05_Users');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const userIdIdx = headers.indexOf('user_id');
    const isActiveIdx = headers.indexOf('is_active');
    const updatedAtIdx = headers.indexOf('updated_at');
    const updatedByIdx = headers.indexOf('updated_by');
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][userIdIdx] === userId) {
        sheet.getRange(i + 1, isActiveIdx + 1).setValue(isActive);
        sheet.getRange(i + 1, updatedAtIdx + 1).setValue(new Date());
        sheet.getRange(i + 1, updatedByIdx + 1).setValue(sessionResult.user.user_id);
        
        logAudit(isActive ? 'ACTIVATE' : 'DEACTIVATE', 'USER', userId, null, null);
        
        return { success: true, message: `User ${isActive ? 'activated' : 'deactivated'}` };
      }
    }
    
    return { success: false, error: 'User not found' };
    
  } catch (error) {
    console.error('adminToggleUserStatus error:', error);
    return { success: false, error: 'Failed to update user status' };
  }
}

/**
 * Admin: Get all users
 */
function adminGetUsers(sessionToken) {
  try {
    const sessionResult = validateSession(sessionToken);
    if (!sessionResult.valid) {
      return { success: false, error: 'Invalid session' };
    }
    
    if (sessionResult.user.role_code !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only administrators can view all users' };
    }
    
    const users = getSheetData('05_Users');
    
    // Remove sensitive fields
    const safeUsers = users.map(u => ({
      user_id: u.user_id,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      full_name: u.full_name,
      role_code: u.role_code,
      role_name: getRoleName(u.role_code),
      affiliate_code: u.affiliate_code,
      department: u.department,
      phone: u.phone,
      is_active: u.is_active,
      last_login: u.last_login,
      must_change_password: u.must_change_password
    }));
    
    return { success: true, data: safeUsers };
    
  } catch (error) {
    console.error('adminGetUsers error:', error);
    return { success: false, error: 'Failed to get users' };
  }
}

// ============================================================
// CLEANUP - Remove expired sessions (run daily)
// ============================================================
function cleanupExpiredSessions() {
  try {
    const sheet = getSheet('20_Sessions');
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const expiresIdx = headers.indexOf('expires_at');
    const validIdx = headers.indexOf('is_valid');
    
    const now = new Date();
    let cleaned = 0;
    
    // Go from bottom to top to avoid row shift issues
    for (let i = data.length - 1; i >= 1; i--) {
      const expires = new Date(data[i][expiresIdx]);
      if (expires < now || !data[i][validIdx]) {
        sheet.deleteRow(i + 1);
        cleaned++;
      }
    }
    
    console.log(`Cleaned up ${cleaned} expired sessions`);
  } catch (error) {
    console.error('cleanupExpiredSessions error:', error);
  }
}
