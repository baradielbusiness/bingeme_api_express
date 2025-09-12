/**
 * @file authController.js
 * @description Authentication controller for Bingeme API Express.js
 * Handles all authentication-related operations including login, registration, OTP verification, etc.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  createErrorResponse, 
  createSuccessResponse, 
  generateAccessToken, 
  generateRefreshToken, 
  storeRefreshToken, 
  checkRateLimit, 
  isValidEmailDomain, 
  checkEmailValidation, 
  validateEmailWithListClean, 
  generateOTP, 
  checkDuplicateAccount, 
  verifyAccessToken, 
  verifyRefreshToken,
  verifyEmailOTP,
  getDeviceInfo,
  convertAnonymousToAuthenticated,
  getFile,
  getAdminSettings,
  getUserCountry,
  processCurrencySettings,
  upsertFcmTokenRecord,
  docClient
} from '../utils/common.js';
import { sendWhatsAppOTP } from '../utils/whatsapp.js';
import { sendEmailOTP } from '../utils/mail.js';
import { validateEmail, validateMobile } from '../utils/validations.js';

/**
 * Anonymous user initialization with Apple App Attest support
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const init = async (req, res) => {
  try {
    // Rate limit per IP and route
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!await checkRateLimit(ip, '/auth/init')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Parse request body
    const body = req.body || {};
    const headers = req.headers || {};
    
    // Detect client platform
    const clientHint = String((body.client || body.device || body.platform || headers['x-client'] || '')).toLowerCase();
    const isSwagger = clientHint === 'swagger';
    const isAndroid = clientHint === 'android';
    const isIOS = clientHint === 'ios';

    const {
      keyId,
      attestationObject,
      clientDataHash,
      challenge,
      bundleId,
      teamId,
      appVersion,
      unsupported
    } = body;

    // Swagger client: no App Attest, just issue tokens
    if (isSwagger) {
      const session = await issueAnonymousSession(req);
      if (session.error) return res.status(500).json(session.error);
      return res.json({
        success: true,
        message: 'Swagger session initialized',
        ...session,
        client: 'swagger'
      });
    }

    // Android client: placeholder, no-op for now
    if (isAndroid) {
      return res.json({
        success: true,
        message: 'Android init acknowledged',
        client: 'android',
        action: 'noop'
      });
    }

    // iOS (default) flow: App Attest with fallback
    if (unsupported === true) {
      const session = await issueAnonymousSession(req);
      if (session.error) return res.status(500).json(session.error);
      return res.json({
        success: true,
        message: 'Anonymous session initialized (fallback)',
        ...session,
        fallback: true
      });
    }

    // Basic input checks
    if (!keyId || !attestationObject || !clientDataHash || !challenge) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Decode base64 inputs
    const attObjBuf = decodeBase64(attestationObject);
    const clientHashBuf = decodeBase64(clientDataHash);
    const challengeBuf = decodeBase64(challenge);
    if (!attObjBuf || !clientHashBuf || !challengeBuf) {
      return res.status(400).json({ error: 'Invalid base64 encoding' });
    }

    // Ensure challenge is 32 bytes
    if (challengeBuf.length !== 32) {
      return res.status(400).json({ error: 'Invalid challenge length' });
    }

    // Challenge freshness and replay protection
    const fresh = await consumeChallengeIfFresh(challenge);
    if (!fresh) {
      return res.status(400).json({ error: 'Challenge already used or invalid' });
    }

    const session = await issueAnonymousSession(req);
    if (session.error) return res.status(500).json(session.error);
    
    return res.json({
      success: true,
      message: 'Anonymous session initialized',
      ...session,
      appAttestVerified: true,
      bundleId: bundleId || null,
      teamId: teamId || null,
      appVersion: appVersion || null
    });
  } catch (error) {
    logError('Anonymous user initialization error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * User registration handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const register = async (req, res) => {
  try {
    logInfo('Register handler invoked');
    
    // Parse and validate request body
    const body = req.body;
    if (!body) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const { name, email, phone, countryCode, terms } = body;

    // Validate input
    const validationError = validateRegistrationInput({ name, email, phone, countryCode, terms });
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Rate limiting
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!await checkRateLimit(ip, '/auth/signup')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Check for duplicate accounts
    const isDuplicate = await checkDuplicateAccount(email, phone);
    if (isDuplicate) {
      return res.status(409).json({ error: 'Account already exists with this email or phone number' });
    }

    // Email validation
    if (email) {
      const isValidDomain = await isValidEmailDomain(email);
      if (!isValidDomain) {
        return res.status(400).json({ error: 'Email domain is not allowed' });
      }

      // Check email validation status
      const emailValidation = await checkEmailValidation(email);
      if (emailValidation && emailValidation.status === 'invalid') {
        return res.status(400).json({ error: 'Email address is invalid' });
      }

      // Validate with ListClean if not already validated
      if (!emailValidation) {
        const listCleanResult = await validateEmailWithListClean(email);
        if (listCleanResult && listCleanResult.status === 'invalid') {
          return res.status(400).json({ error: 'Email address is invalid' });
        }
      }
    }

    // Generate OTP
    const identifier = email || `${countryCode}${phone}`;
    const otp = await generateOTP(identifier);

    // Send OTP asynchronously
    await sendOtpAsync({ email, phone, countryCode, otp });

    return res.json({
      success: true,
      message: 'OTP sent successfully. Please verify to complete registration.',
      actionRequired: 'verify_otp'
    });
  } catch (error) {
    logError('Registration error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const verifyOtp = async (req, res) => {
  try {
    const { identifier, otp } = req.body;

    if (!identifier || !otp) {
      return res.status(400).json({ error: 'Identifier and OTP are required' });
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(identifier, otp);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Extract user data from identifier
    const isEmail = identifier.includes('@');
    const email = isEmail ? identifier : null;
    const phone = !isEmail ? identifier : null;
    const countryCode = phone ? phone.substring(0, 3) : null;
    const cleanPhone = phone ? phone.substring(3) : null;

    // Create user
    const pool = getDB();
    const insertQuery = `
      INSERT INTO users (
        name, username, mobile, email, password, date, avatar, cover, status, role, permission,
        confirmation_code, token, story, verified_id, email_verified, ip, language, mobile_verified, countries_id,
        remember_token, paypal_account, payment_gateway, bank, about, profession, categories_id, website, price, balance,
        address, city, zip, facebook, twitter, instagram, youtube, pinterest, github, plan, company, gender,
        birthdate, wallet, tiktok, snapchat, paystack_plan, paystack_authorization_code, paystack_last4, paystack_exp,
        paystack_card_brand, last_login, custom_fee, payoneer_account, zelle_account, permissions, blocked_countries,
        net_earnings, creator_agreement, telegram, vk, twitch, discord
      ) VALUES (
        ?, 'ua', ?, ?, '', NOW(), '', '', 'active', 'normal', 'none',
        '', '', '', 'no', '1', '1', ?, 'en', '0', '',
        '', '', '', '', '', '', '', '', 0, 0, '', '', '', '',
        '', '', '', '', '', '', '', '', '', '', '', '', '',
        '', 0.00, '', '', '', '', 0, '', '', '', 0,
        '', '', '', '', 0.00, 0, '', '', '', ''
      )
    `;

    const [result] = await pool.query(insertQuery, [
      req.body.name || 'User',
      phone || '',
      email || '',
      req.ip || '127.0.0.1'
    ]);

    const userId = result.insertId;
    await pool.query('UPDATE users SET username = ? WHERE id = ?', [`u${userId}`, userId]);

    // Generate tokens
    const accessToken = generateAccessToken({ id: userId, role: 'normal' });
    const refreshToken = generateRefreshToken({ id: userId, role: 'normal' });
    await storeRefreshToken(String(userId), refreshToken, req);

    return res.json({
      success: true,
      message: 'Registration successful',
      accessToken,
      refreshToken,
      user: {
        id: String(userId),
        username: `u${userId}`,
        name: req.body.name || 'User',
        email: email || null,
        phone: phone || null
      }
    });
  } catch (error) {
    logError('OTP verification error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * User login handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const login = async (req, res) => {
  try {
    const { username_email, country_code, phone, password, is_otp_login } = req.body;

    if (typeof is_otp_login !== 'boolean') {
      return res.status(400).json({ error: 'is_otp_login field is required and must be a boolean.' });
    }

    let identifier, loginType, type;
    let user;

    // OTP-based login flow
    if (is_otp_login) {
      if (phone && country_code && isValidPhoneFormat(phone, country_code)) {
        type = 'mobile_otp';
        identifier = `${country_code}${phone}`;
        loginType = 'mobile';
        user = await findUser(identifier, loginType);
        if (!user) return res.status(404).json({ error: 'Invalid credentials' });
        
        const otp = await generateOTP(identifier);
        const sent = await sendWhatsAppOTP(phone, country_code, otp);
        if (sent) {
          return res.json({
            success: true,
            message: 'OTP sent. Please verify to continue.',
            actionRequired: '2fa_verify'
          });
        }
        return res.status(500).json({ error: 'Could not send WhatsApp OTP. Please try again later.' });
      } else if (username_email && validateEmail(username_email)) {
        type = 'email_otp';
        identifier = username_email.toLowerCase();
        loginType = 'email';
        user = await findUser(identifier, loginType);
        if (!user) return res.status(404).json({ error: 'Invalid credentials' });
        
        const otp = await generateOTP(identifier);
        const sent = await sendEmailOTP(identifier, otp, 'login');
        if (sent) {
          return res.json({
            success: true,
            message: 'OTP sent to your email. Please verify to continue.',
            actionRequired: '2fa_verify'
          });
        }
        return res.status(500).json({ error: 'Could not send email OTP. Please try again later.' });
      } else {
        return res.status(400).json({ error: 'Invalid phone number or email format' });
      }
    }

    // Password-based login flow
    if (!username_email || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    // Determine login type
    if (validateEmail(username_email)) {
      loginType = 'email';
      identifier = username_email.toLowerCase();
    } else {
      loginType = 'username';
      identifier = username_email;
    }

    user = await findUser(identifier, loginType);
    if (!user) {
      return res.status(404).json({ error: 'Invalid credentials' });
    }

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json({ error: 'Your account has been deleted.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending confirmation.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.two_factor_enabled === '1') {
      const otp = await generateOTP(identifier);
      const sent = await sendEmailOTP(identifier, otp, '2fa');
      if (sent) {
        return res.json({
          success: true,
          message: '2FA OTP sent to your email. Please verify to continue.',
          actionRequired: '2fa_verify'
        });
      }
      return res.status(500).json({ error: 'Could not send 2FA OTP. Please try again later.' });
    }

    // Generate tokens and return success
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // Get admin settings and user country for currency processing
    const adminSettings = await getAdminSettings();
    const userCountry = await getUserCountry(req, user);
    const currencySettings = processCurrencySettings(adminSettings, userCountry);

    return res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
        status: user.status,
        role: user.role || 'normal'
      },
      currency: currencySettings.currency
    });
  } catch (error) {
    logError('Login error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Login OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const loginVerify = async (req, res) => {
  try {
    const { username_email, country_code, phone, otp } = req.body;

    if (!otp) {
      return res.status(400).json({ error: 'OTP is required' });
    }

    let identifier, loginType, user;

    if (phone && country_code) {
      identifier = `${country_code}${phone}`;
      loginType = 'mobile';
    } else if (username_email && validateEmail(username_email)) {
      identifier = username_email.toLowerCase();
      loginType = 'email';
    } else {
      return res.status(400).json({ error: 'Invalid phone number or email format' });
    }

    user = await findUser(identifier, loginType);
    if (!user) {
      return res.status(404).json({ error: 'Invalid credentials' });
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(identifier, otp);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json({ error: 'Your account has been deleted.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending confirmation.' });
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // Get admin settings and user country for currency processing
    const adminSettings = await getAdminSettings();
    const userCountry = await getUserCountry(req, user);
    const currencySettings = processCurrencySettings(adminSettings, userCountry);

    return res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
        status: user.status,
        role: user.role || 'normal'
      },
      currency: currencySettings.currency
    });
  } catch (error) {
    logError('Login verification error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Token refresh handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Get user from database
    const pool = getDB();
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json({ error: 'Your account has been deleted.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending confirmation.' });
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const newRefreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    
    // Store new refresh token
    await storeRefreshToken(String(user.id), newRefreshToken, req);

    return res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    logError('Token refresh error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Logout handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.userId;

    if (refreshToken) {
      // Revoke specific refresh token
      await revokeRefreshToken(refreshToken, String(userId));
    } else {
      // Revoke all user sessions
      const sessions = await getUserSessionsWithDeviceInfo(String(userId));
      for (const session of sessions) {
        await revokeSessionByToken(session.token, String(userId));
      }
    }

    return res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logError('Logout error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Token validation handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const validate = async (req, res) => {
  try {
    const user = req.user;
    
    return res.json({
      success: true,
      message: 'Token is valid',
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
        status: user.status,
        role: user.role || 'normal'
      }
    });
  } catch (error) {
    logError('Token validation error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Forgot password request handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const forgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    // Rate limiting
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!await checkRateLimit(ip, '/auth/forgot-password/otp')) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Check if user exists
    const pool = getDB();
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json({ error: 'Your account has been deleted.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending confirmation.' });
    }

    // Generate and send OTP
    const otp = await generateOTP(email.toLowerCase());
    const sent = await sendEmailOTP(email, otp, 'forgot_password');
    
    if (sent) {
      return res.json({
        success: true,
        message: 'OTP sent to your email. Please verify to reset password.',
        actionRequired: 'verify_otp'
      });
    }
    
    return res.status(500).json({ error: 'Could not send OTP. Please try again later.' });
  } catch (error) {
    logError('Forgot password request error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Forgot password OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const forgotPasswordVerify = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(email.toLowerCase(), otp);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    return res.json({
      success: true,
      message: 'OTP verified successfully. You can now reset your password.',
      actionRequired: 'reset_password'
    });
  } catch (error) {
    logError('Forgot password verification error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Password reset handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const forgotPasswordReset = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(email.toLowerCase(), otp);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const pool = getDB();
    await pool.query('UPDATE users SET password = ?, updated_at = NOW() WHERE email = ?', [hashedPassword, email.toLowerCase()]);

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    logError('Password reset error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Google sign-in handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const googleSignin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: 'Google ID token is required' });
    }

    // Verify Google ID token
    const payload = await verifyGoogleIdToken(idToken);
    const oauthUid = payload.sub;
    const email = payload.email?.toLowerCase();
    const name = payload.name || 'User';

    if (!email) {
      return res.status(400).json({ error: 'Email is required from Google token' });
    }

    // Find or create user
    let user = await findUserByOAuthOrEmail(oauthUid, email, 'google');
    if (!user) {
      user = await createUserWithGoogle({ name, email, oauthUid, ip: req.ip });
    } else {
      // Link oauth data if missing
      if (!user.oauth_provider || !user.oauth_uid) {
        await attachGoogleToExistingUser(user.id, oauthUid);
        user.oauth_provider = 'google';
        user.oauth_uid = oauthUid;
      }
    }

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json({ error: 'Your account has been deleted.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending confirmation.' });
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // If suspended, respond accordingly but still provide tokens
    if (user.status === 'suspended') {
      return res.json({
        success: true,
        message: 'Login successful but account is suspended',
        actionRequired: 'suspended',
        redirectTo: '/auth/suspended',
        accessToken,
        refreshToken,
        user: {
          id: String(user.id),
          username: user.username,
          name: user.name,
          avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
          status: user.status,
          role: user.role || 'normal'
        }
      });
    }

    return res.json({
      success: true,
      message: 'Google sign in successful',
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null
      }
    });
  } catch (error) {
    logError('Google sign-in error', error);
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
};

/**
 * Apple sign-in handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const appleSignin = async (req, res) => {
  try {
    const { idToken, code, redirectUri, email: bodyEmail, name: bodyName, clientId: clientIdFromBody } = req.body;

    // Support two inputs: direct idToken or OAuth code
    if (!idToken && !code) {
      return res.status(400).json({ error: 'idToken or code is required' });
    }

    // Resolve clientId for verification/audience checks
    const resolvedClientId = clientIdFromBody || process.env.APPLE_IOS_CLIENT_ID || process.env.APPLE_CLIENT_ID;

    // If authorization code is provided, perform exchange to obtain id_token
    let idTokenToVerify = idToken;
    if (code) {
      try {
        const tokenResponse = await exchangeCodeForToken(code, resolvedClientId, redirectUri);
        idTokenToVerify = tokenResponse.id_token;
      } catch (err) {
        logError('Apple code exchange failed', err);
        return res.status(401).json({ error: 'Apple code exchange failed' });
      }
    }

    // Verify Apple ID token
    const payload = await verifyAppleIdToken(idTokenToVerify, resolvedClientId);
    const oauthUid = payload.sub;
    const email = (payload.email || bodyEmail || '').toLowerCase();
    const name = payload.name || bodyName || 'User';

    // Email can be absent on subsequent Apple logins require it from body if not present
    if (!email) {
      return res.status(400).json({ error: 'Email is required from Apple token or body' });
    }

    // Find or create user
    let user = await findUserByOAuthOrEmail(oauthUid, email, 'apple');
    if (!user) {
      user = await createUserWithApple({ name, email, oauthUid, ip: req.ip });
    } else {
      // Link oauth data if missing
      if (!user.oauth_provider || !user.oauth_uid) {
        await attachAppleToExistingUser(user.id, oauthUid);
        user.oauth_provider = 'apple';
        user.oauth_uid = oauthUid;
      }
    }

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json({ error: 'Your account has been deleted.' });
    }
    if (user.status === 'pending') {
      return res.status(403).json({ error: 'Your account is pending confirmation.' });
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // If suspended, respond accordingly but still provide tokens
    if (user.status === 'suspended') {
      return res.json({
        success: true,
        message: 'Login successful but account is suspended',
        actionRequired: 'suspended',
        redirectTo: '/auth/suspended',
        accessToken,
        refreshToken,
        user: {
          id: String(user.id),
          username: user.username,
          name: user.name,
          avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
          status: user.status,
          role: user.role || 'normal'
        }
      });
    }

    return res.json({
      success: true,
      message: 'Apple sign in successful',
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null
      }
    });
  } catch (error) {
    logError('Apple sign-in error', error);
    return res.status(401).json({ error: error.message || 'Unauthorized' });
  }
};

/**
 * Suspended account handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const suspended = async (req, res) => {
  try {
    return res.json({
      success: true,
      message: 'Account is suspended',
      actionRequired: 'contact_support',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@bingeme.com'
    });
  } catch (error) {
    logError('Suspended handler error', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Helper functions

/**
 * Decode a base64 (standard or URL-safe) string to Buffer
 */
const decodeBase64 = (input) => {
  if (!input || typeof input !== 'string') return null;
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64');
  } catch (e) {
    return null;
  }
};

/**
 * Check if a challenge has already been used; if not, reserve it with TTL
 */
const consumeChallengeIfFresh = async (challengeB64) => {
  const tableName = `rate_limits-${process.env.NODE_ENV || 'dev'}`;
  const identifier = `appattest:challenge:${challengeB64}`;
  const nowMs = Date.now();
  const ttlSeconds = Math.floor((nowMs + 5 * 60 * 1000) / 1000);
  try {
    const getRes = await docClient.send(new GetCommand({ TableName: tableName, Key: { identifier } }));
    if (getRes.Item) {
      return false;
    }
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: { identifier, count: 1, timestamp: nowMs, expires_at: ttlSeconds }
    }));
    return true;
  } catch (err) {
    logError('consumeChallengeIfFresh error', err);
    return false;
  }
};

/**
 * Issue anonymous tokens and persist refresh session
 */
const issueAnonymousSession = async (req) => {
  const timestamp = Date.now();
  const randomHex = crypto.randomBytes(6).toString('hex');
  const anonymousUserId = `anon_${timestamp}_${randomHex}`;
  const tokenPayload = { id: anonymousUserId, role: 'anonymous', isAnonymous: true };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  const stored = await storeRefreshToken(anonymousUserId, refreshToken, req);
  if (!stored) {
    return { error: { error: 'Failed to create session' } };
  }
  return { accessToken, refreshToken, anonymousUserId };
};

/**
 * Validate registration input fields
 */
const validateRegistrationInput = ({ name, email, phone, countryCode, terms }) => {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
    return { error: 'Invalid name' };
  }
  if (email && (typeof email !== 'string' || !validateEmail(email))) {
    return { error: 'Invalid email format' };
  }
  if (phone && (typeof phone !== 'string' || !validateMobile(phone))) {
    return { error: 'Invalid phone number' };
  }
  if (countryCode && (typeof countryCode !== 'string' || countryCode.length > 4)) {
    return { error: 'Invalid country code' };
  }
  if (terms !== '0' && terms !== '1') {
    return { error: 'You must agree to the terms' };
  }
  return null;
};

/**
 * Send OTP via email and/or WhatsApp asynchronously
 */
const sendOtpAsync = async ({ email, phone, countryCode, otp }) => {
  if (email) {
    logInfo('Sending email OTP', { email });
    sendEmailOTP(email, otp, 'signup').catch(error => {
      logError('Background email sending failed:', error);
    });
  }
  if (phone && countryCode) {
    logInfo('Sending WhatsApp OTP', { phone, countryCode });
    sendWhatsAppOTP(phone, countryCode, otp).catch(error => {
      logError('Background WhatsApp sending failed:', error);
    });
  }
};

/**
 * Validates phone number format based on country code
 */
const isValidPhoneFormat = (phone, countryCode) => {
  if (!phone || !countryCode) return false;
  
  const validCountryCode = /^\+\d{1,4}$/.test(countryCode);
  if (!validCountryCode) return false;
  
  const cleanPhone = phone.replace(/\s/g, '');
  
  if (countryCode === '+91') {
    return /^\d{10}$/.test(cleanPhone);
  }
  
  return /^\d{6,15}$/.test(cleanPhone);
};

/**
 * Finds a user by a given identifier and login type
 */
const findUser = async (identifier, loginType) => {
  const pool = getDB();
  let column = 'email';
  if (loginType === 'username') column = 'username';
  else if (loginType === 'mobile') column = 'mobile';
  const query = `SELECT * FROM users WHERE ${column} = ?`;
  const [rows] = await pool.query(query, [identifier]);
  return rows[0] || null;
};

// Additional helper functions for OAuth providers would go here...
// (Google, Apple OAuth implementation functions)
