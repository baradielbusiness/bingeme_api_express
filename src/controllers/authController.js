/**
 * @file authController.js
 * @description Authentication controller for Bingeme API Express.js
 * Handles all authentication-related operations including login, registration, OTP verification, etc.
 */

import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  createErrorResponse, 
  createSuccessResponse, 
  createExpressSuccessResponse,
  createExpressErrorResponse,
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
  upsertFcmTokenRecord
} from '../utils/common.js';
import { sendWhatsAppOTP } from '../utils/whatsapp.js';
import { sendEmailOTP } from '../utils/mail.js';
import { validateEmail, validateMobile } from '../utils/validations.js';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

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
      return res.status(429).json(createExpressErrorResponse('Too many requests', 429));
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
      return res.json(createExpressSuccessResponse('Swagger session initialized', {
        ...session,
        client: 'swagger'
      }));
    }

    // Android client: placeholder, no-op for now
    if (isAndroid) {
      return res.json(createExpressSuccessResponse('Android init acknowledged', {
        client: 'android',
        action: 'noop'
      }));
    }

    // iOS (default) flow: App Attest with fallback
    if (unsupported === true) {
      const session = await issueAnonymousSession(req);
      if (session.error) return res.status(500).json(session.error);
      return res.json(createExpressSuccessResponse('Anonymous session initialized (fallback)', {
        ...session,
        fallback: true
      }));
    }

    // Basic input checks
    if (!keyId || !attestationObject || !clientDataHash || !challenge) {
      return res.status(400).json(createExpressErrorResponse('Missing required fields', 400));
    }

    // Decode base64 inputs
    const attObjBuf = decodeBase64(attestationObject);
    const clientHashBuf = decodeBase64(clientDataHash);
    const challengeBuf = decodeBase64(challenge);
    if (!attObjBuf || !clientHashBuf || !challengeBuf) {
      return res.status(400).json(createExpressErrorResponse('Invalid base64 encoding', 400));
    }

    // Ensure challenge is 32 bytes
    if (challengeBuf.length !== 32) {
      return res.status(400).json(createExpressErrorResponse('Invalid challenge length', 400));
    }

    // Challenge freshness and replay protection
    const fresh = await consumeChallengeIfFresh(challenge);
    if (!fresh) {
      return res.status(400).json(createExpressErrorResponse('Challenge already used or invalid', 400));
    }

    const session = await issueAnonymousSession(req);
    if (session.error) return res.status(500).json(session.error);
    
    return res.json(createExpressSuccessResponse('Anonymous session initialized', {
      ...session,
      appAttestVerified: true,
      bundleId: bundleId || null,
      teamId: teamId || null,
      appVersion: appVersion || null
    }));
  } catch (error) {
    logError('Anonymous user initialization error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
    let body;
    try {
      body = req.body;
    } catch (parseErr) {
      logError('Failed to parse request body', { error: parseErr });
      return res.status(400).json(createExpressErrorResponse('Invalid JSON in request body', 400));
    }
    
    // Destructure and set defaults
    const { name, email, phone, countryCode, terms } = body;
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    logInfo('Extracted input fields');

    // Validate input fields
    const inputError = validateRegistrationInput({ name, email, phone, countryCode, terms });
    if (inputError) return res.status(400).json(createExpressErrorResponse(inputError.error, 400));

    // Rate limiting to prevent abuse
    logInfo('Checking rate limit');
    if (!await checkRateLimit(ip, '/auth/signup')) {
      logError('Rate limit exceeded', { ip });
      return res.status(429).json(createExpressErrorResponse('Too many requests', 429));
    }

    // At least one contact method must be provided
    if (!name || terms !== '1' || (!email && (!phone || !countryCode))) {
      logError('Missing required fields', { name, email, phone, countryCode, terms });
      return res.status(400).json(createExpressErrorResponse('Missing required fields', 400));
    }
    
    // If phone is provided, countryCode is required
    if (phone && !countryCode) {
      logError('Country code required when phone number is provided', { phone });
      return res.status(400).json(createExpressErrorResponse('Country code is required when providing phone number', 400));
    }

    // Email-specific validation (run in parallel for performance)
    if (email) {
      logInfo('Starting parallel email validations');
      const validationPromises = [
        isValidEmailDomain(email),
        checkEmailValidation(email),
        validateEmailWithListClean(email)
      ];
      try {
        const [domainValid, emailValidation, listCleanValid] = await Promise.allSettled(validationPromises);
        logInfo('Email validation results', { domainValid, emailValidation, listCleanValid });
        if (domainValid.status === 'fulfilled' && !domainValid.value) {
          logError('Invalid email domain');
          return res.status(403).json(createExpressErrorResponse('Invalid email domain', 403));
        }
        if (emailValidation.status === 'fulfilled' && emailValidation.value?.status === 'error') {
          logError('Unable to send OTP to this email');
          return res.status(400).json(createExpressErrorResponse('Unable to send OTP to this email', 400));
        }
        if (listCleanValid.status === 'fulfilled' && !listCleanValid.value) {
          logError('Invalid email address (ListClean)');
          return res.status(400).json(createExpressErrorResponse('Invalid email address', 400));
        }
        // Log any failed validations for monitoring (do not expose to client)
        [domainValid, emailValidation, listCleanValid].forEach((result, index) => {
          if (result.status === 'rejected') {
            logError(`Email validation ${index} failed:`, result.reason);
          }
        });
      } catch (error) {
        logError('Error in parallel email validation:', error);
        // Continue with signup even if some validations fail
      }
    }

    // Check for duplicate account (prevents account enumeration)
    logInfo('Checking for duplicate account');
    if (await checkDuplicateAccount(email, phone)) {
      logError('Account already exists');
      return res.status(409).json(createExpressErrorResponse('Account already exists', 409));
    }

    // Generate OTP securely
    const identifier = email || phone;
    logInfo('Generating OTP');
    const generatedOTP = await generateOTP(identifier);
    logInfo('OTP generated');

    // Send OTP asynchronously (fire-and-forget)
    await sendOtpAsync({ email, phone, countryCode, otp: generatedOTP });
    logInfo('OTP sent successfully');
    return res.json(createExpressSuccessResponse('OTP sent successfully'));
  } catch (error) {
    logError('Signup error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const verifyOtp = async (req, res) => {
  try {
    // Destructure headers for Authorization
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createExpressErrorResponse('Access token required', 401));
    }
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    
    // Verify access token
    const decoded = verifyAccessToken(accessToken);
    if (!decoded) {
      return res.status(401).json(createExpressErrorResponse('Invalid access token', 401));
    }
    
    // Parse and destructure body
    const { identifier, otp, name, email, phone, countryCode } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    logInfo('OTP verification request', {
      identifier,
      ip,
      timestamp: new Date().toISOString(),
      userAgent: req.headers['user-agent'],
    });
    
    // Validate required fields
    if (!identifier || !otp) {
      return res.status(400).json(createExpressErrorResponse('Identifier and OTP are required', 400));
    }
    if (typeof otp !== 'string' || !/^\d{5,8}$/.test(otp)) {
      return res.status(400).json(createExpressErrorResponse('Invalid OTP format', 400));
    }
    
    // Fetch OTP record from DynamoDB
    const tableName = `otp-${process.env.NODE_ENV || 'dev'}`;
    const { Item: otpRecord } = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { identifier },
    }));
    
    if (!otpRecord) {
      return res.status(404).json(createExpressErrorResponse('OTP not found or has expired', 404));
    }
    
    // Check for too many attempts (max 5)
    if (otpRecord.attempts >= 5) {
      return res.status(429).json(createExpressErrorResponse('Too many failed OTP attempts. Please request a new OTP.', 429));
    }
    
    // Validate the OTP
    if (otpRecord.otp !== otp) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: tableName,
          Key: { identifier },
          UpdateExpression: 'SET #attempts = #attempts + :inc',
          ExpressionAttributeNames: { '#attempts': 'attempts' },
          ExpressionAttributeValues: { ':inc': 1 },
        }));
      } catch (updateError) {
        logError('Failed to increment OTP attempt counter:', updateError);
      }
      return res.status(400).json(createExpressErrorResponse('Invalid OTP', 400));
    }
    
    // Check if OTP is expired (10-minute window)
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - otpRecord.timestamp > tenMinutes) {
      return res.status(400).json(createExpressErrorResponse('OTP has expired', 400));
    }
    
    // OTP is valid, proceed to create user
    const userData = {
      name: name || 'User',
      email: email || (identifier && identifier.includes('@') ? identifier : undefined),
      phone: (countryCode ? countryCode.replace(/^\+?/, '+') : '') + (phone || ''),
      ip: ip || '127.0.0.1',
    };
    
    // Ensure we have an email or phone to create the user
    if (!userData.email && !userData.phone) {
      return res.status(400).json(createExpressErrorResponse('Cannot create user without an email or phone number.', 400));
    }
    
    const createdUser = await createUser(userData);
    
    // Check referral system and create referral record if applicable
    try {
      const adminSettings = await getAdminSettings();
      if (adminSettings.referral_system === 'on') {
        // Get referral from cookie (similar to Templar's Cookie::get('referred'))
        const cookies = {};
        const cookieHeader = req.headers.cookie || req.headers.Cookie;
        if (cookieHeader) {
          cookieHeader.split(';').forEach(cookie => {
            const [name, value] = cookie.trim().split('=');
            if (name && value) {
              cookies[name.trim()] = value.trim();
            }
          });
        }
        
        const referredBy = cookies.referred;
        if (referredBy) {
          logInfo('Referral cookie found:', { referredBy });
          
          // Find the referring user
          const pool = getDB();
          const [referringUserRows] = await pool.query(`
            SELECT id FROM users WHERE id = ? AND status = 'active'
          `, [referredBy]);
          
          if (referringUserRows.length > 0) {
            const referringUserId = referringUserRows[0].id;
            // Create referral record
            await createReferralRecord(createdUser.id, referringUserId);
            logInfo('Referral record created:', { 
              newUserId: createdUser.id, 
              referredBy: referringUserId 
            });
          } else {
            logInfo('Referring user not found or inactive:', { referredBy });
          }
        }
      }
    } catch (referralError) {
      logError('Error in referral system:', referralError);
      // Don't fail user creation if referral system fails
    }
    
    // Generate new access and refresh tokens (without email)
    const newAccessToken = generateAccessToken({ id: parseInt(createdUser.id, 10), role: 'normal' });
    const newRefreshToken = generateRefreshToken({ id: parseInt(createdUser.id, 10), role: 'normal' });
    
    // Store refresh token in DynamoDB
    const storeResult = await storeRefreshToken(createdUser.id.toString(), newRefreshToken, req);
    if (!storeResult) {
      logError('Failed to store refresh token for new user');
      return res.status(500).json(createExpressErrorResponse('Failed to create session', 500));
    }
    
    // Upsert FCM token if provided (signup verify path)
    try {
      if (req.body.fcm_token) {
        await upsertFcmTokenRecord(createdUser.id, req.body.fcm_token, req.body.platform, req.body.voip_token);
      }
    } catch (e) {
      logError('register.verifyOtp FCM upsert error', e);
    }

    // Delete the OTP record from DynamoDB to prevent reuse
    try {
      await docClient.send(new DeleteCommand({
        TableName: tableName,
        Key: { identifier },
      }));
    } catch (deleteError) {
      logError('Failed to delete OTP record:', deleteError);
    }
    
    // Compute currency/coin conversion for the user based on country
    let currency = null;
    try {
      const adminSettings = await getAdminSettings();
      const userCountry = await getUserCountry(req, { countries_id: createdUser.countries_id });
      currency = processCurrencySettings(adminSettings, userCountry).currency;
    } catch (e) {
      // ignore currency errors
    }

    return res.json(createExpressSuccessResponse('OTP verified successfully. User account created.', {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      // Include basic profile details for client UI
      user: {
        id: createdUser.id.toString(),
        username: createdUser.username,
        name: name || 'User',
        avatar: createdUser.avatar ? getFile('avatar/' + createdUser.avatar) : '',
        email: createdUser.email,
        mobile: createdUser.mobile,
        countries_id: createdUser.countries_id || ''
      },
      currency
    }));
  } catch (error) {
    logError('OTP verification error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('is_otp_login field is required and must be a boolean.', 400));
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
        if (!user) return res.status(404).json(createExpressErrorResponse('Invalid credentials', 404));
        
        const otp = await generateOTP(identifier);
        const sent = await sendWhatsAppOTP(phone, country_code, otp);
        if (sent) {
        return res.json(createExpressSuccessResponse('OTP sent. Please verify to continue.', {
            actionRequired: '2fa_verify'
        }));
        }
        return res.status(500).json(createExpressErrorResponse('Could not send WhatsApp OTP. Please try again later.', 500));
      } else if (username_email && validateEmail(username_email)) {
        type = 'email_otp';
        identifier = username_email.toLowerCase();
        loginType = 'email';
        user = await findUser(identifier, loginType);
        if (!user) return res.status(404).json(createExpressErrorResponse('Invalid credentials', 404));
        
        const otp = await generateOTP(identifier);
        const sent = await sendEmailOTP(identifier, otp, 'login');
        if (sent) {
        return res.json(createExpressSuccessResponse('OTP sent to your email. Please verify to continue.', {
            actionRequired: '2fa_verify'
        }));
        }
        return res.status(500).json(createExpressErrorResponse('Could not send OTP. Please try again later.', 500));
      } else {
        return res.status(400).json(createExpressErrorResponse('Invalid phone number or email format', 400));
      }
    }

    // Password-based login flow
    if (!username_email || !password) {
      return res.status(400).json(createExpressErrorResponse('Username/email and password are required', 400));
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
      return res.status(404).json(createExpressErrorResponse('Invalid credentials', 404));
    }

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json(createExpressErrorResponse('Your account has been deleted.', 403));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createExpressErrorResponse('Your account is pending confirmation.', 403));
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json(createExpressErrorResponse('Invalid credentials', 401));
    }

    // Check if 2FA is enabled
    if (user.two_factor_enabled === '1') {
      const otp = await generateOTP(identifier);
      const sent = await sendEmailOTP(identifier, otp, '2fa');
      if (sent) {
        return res.json(createExpressSuccessResponse('2FA code sent. Please verify to continue.', {
          actionRequired: '2fa_verify'
        }));
      }
      return res.status(500).json(createExpressErrorResponse('Could not send 2FA code. Please try again later.', 500));
    }

    // Determine effective role for parity with Lambda
    const effectiveRole = (user.role === 'normal') ? (user.verified_id === 'yes' ? 'creator' : 'user') : (user.role || 'normal');

    // Generate tokens and return success
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: effectiveRole });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: effectiveRole });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // Upsert FCM token if provided
    try {
      const { fcm_token, platform, voip_token } = req.body || {};
      if (fcm_token) {
        await upsertFcmTokenRecord(user.id, fcm_token, platform, voip_token);
      }
    } catch (e) {
      logError('login FCM upsert error', e);
    }

    // Get admin settings and user country for currency processing
    const adminSettings = await getAdminSettings();
    const userCountry = await getUserCountry(req, user);
    const { currency } = processCurrencySettings(adminSettings, userCountry);

    // Suspended users: success with actionRequired and redirect
    if (user.status === 'suspended') {
      return res.json(createExpressSuccessResponse('Login successful but account is suspended', {
        actionRequired: 'suspended',
        redirectTo: '/auth/suspended',
        accessToken,
        refreshToken,
        user: {
          id: String(user.id),
          username: user.username,
          name: user.name,
          avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
          countries_id: user.countries_id,
          status: user.status,
          role: effectiveRole
        },
        currency
      }));
    }

    return res.json(createExpressSuccessResponse('Login successful', {
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
        countries_id: user.countries_id
      },
      currency
    }));
  } catch (error) {
    logError('Login error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('OTP is required', 400));
    }

    let identifier, loginType, user;

    if (phone && country_code) {
      identifier = `${country_code}${phone}`;
      loginType = 'mobile';
    } else if (username_email && validateEmail(username_email)) {
      identifier = username_email.toLowerCase();
      loginType = 'email';
    } else {
      return res.status(400).json(createExpressErrorResponse('Invalid phone number or email format', 400));
    }

    user = await findUser(identifier, loginType);
    if (!user) {
      return res.status(404).json(createExpressErrorResponse('Invalid credentials', 404));
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(identifier, otp);
    if (!isValid) {
      return res.status(401).json(createExpressErrorResponse('Invalid or expired OTP', 401));
    }

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json(createExpressErrorResponse('Your account has been deleted.', 403));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createExpressErrorResponse('Your account is pending confirmation.', 403));
    }

    // Determine effective role and generate tokens
    const effectiveRole = (user.role === 'normal') ? (user.verified_id === 'yes' ? 'creator' : 'user') : (user.role || 'normal');
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: effectiveRole });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: effectiveRole });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // Upsert FCM token if provided
    try {
      const { fcm_token, platform, voip_token } = req.body || {};
      if (fcm_token) {
        await upsertFcmTokenRecord(user.id, fcm_token, platform, voip_token);
      }
    } catch (e) {
      logError('loginVerify FCM upsert error', e);
    }

    // Get admin settings and user country for currency processing
    const adminSettings = await getAdminSettings();
    const userCountry = await getUserCountry(req, user);
    const { currency } = processCurrencySettings(adminSettings, userCountry);

    if (user.status === 'suspended') {
      return res.json(createExpressSuccessResponse('Login verification successful but account is suspended', {
        actionRequired: 'suspended',
        redirectTo: '/auth/suspended',
        accessToken,
        refreshToken,
        user: {
          id: String(user.id),
          username: user.username,
          name: user.name,
          avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
          countries_id: user.countries_id,
          status: user.status,
          role: effectiveRole
        }
      }));
    }

    return res.json(createExpressSuccessResponse('Login verification successful', {
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
        countries_id: user.countries_id
      },
      currency
    }));
  } catch (error) {
    logError('Login verification error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('Refresh token is required', 400));
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json(createExpressErrorResponse('Invalid refresh token', 401));
    }

    // Get user from database
    const pool = getDB();
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (rows.length === 0) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    const user = rows[0];

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json(createExpressErrorResponse('Your account has been deleted.', 403));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createExpressErrorResponse('Your account is pending confirmation.', 403));
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const newRefreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    
    // Store new refresh token
    await storeRefreshToken(String(user.id), newRefreshToken, req);

    return res.json(createExpressSuccessResponse('Tokens refreshed successfully', {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    }));
  } catch (error) {
    logError('Token refresh error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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

    return res.json(createExpressSuccessResponse('Logout successful'));
  } catch (error) {
    logError('Logout error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
    
    return res.json(createExpressSuccessResponse('Token is valid', {
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null,
        status: user.status,
        role: user.role || 'normal'
      }
    }));
  } catch (error) {
    logError('Token validation error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('Valid email is required', 400));
    }

    // Rate limiting
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!await checkRateLimit(ip, '/auth/forgot-password/otp')) {
      return res.status(429).json(createExpressErrorResponse('Too many requests', 429));
    }

    // Check if user exists
    const pool = getDB();
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (rows.length === 0) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    const user = rows[0];

    // Check account status
    if (user.status === 'deleted') {
      return res.status(403).json(createExpressErrorResponse('Your account has been deleted.', 403));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createExpressErrorResponse('Your account is pending confirmation.', 403));
    }

    // Generate and send OTP
    const otp = await generateOTP(email.toLowerCase());
    const sent = await sendEmailOTP(email, otp, 'forgot_password');
    
    if (sent) {
      return res.json(createExpressSuccessResponse('OTP sent to your email. Please verify to reset password.', {
        actionRequired: 'verify_otp'
      }));
    }
    
    return res.status(500).json(createExpressErrorResponse('Could not send OTP. Please try again later.', 500));
  } catch (error) {
    logError('Forgot password request error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('Email and OTP are required', 400));
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(email.toLowerCase(), otp);
    if (!isValid) {
      return res.status(401).json(createExpressErrorResponse('Invalid or expired OTP', 401));
    }

    return res.json(createExpressSuccessResponse('OTP verified successfully. You can now reset your password.', {
      actionRequired: 'reset_password'
    }));
  } catch (error) {
    logError('Forgot password verification error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('Email, OTP, and new password are required', 400));
    }

    if (newPassword.length < 6) {
      return res.status(400).json(createExpressErrorResponse('Password must be at least 6 characters long', 400));
    }

    // Verify OTP
    const isValid = await verifyEmailOTP(email.toLowerCase(), otp);
    if (!isValid) {
      return res.status(401).json(createExpressErrorResponse('Invalid or expired OTP', 401));
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    const pool = getDB();
    await pool.query('UPDATE users SET password = ?, updated_at = NOW() WHERE email = ?', [hashedPassword, email.toLowerCase()]);

    return res.json(createExpressSuccessResponse('Password reset successfully. You can now login with your new password.'));
  } catch (error) {
    logError('Password reset error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
      return res.status(400).json(createExpressErrorResponse('Google ID token is required', 400));
    }

    // Verify Google ID token
    const payload = await verifyGoogleIdToken(idToken);
    const oauthUid = payload.sub;
    const email = payload.email?.toLowerCase();
    const name = payload.name || 'User';

    if (!email) {
      return res.status(400).json(createExpressErrorResponse('Email is required from Google token', 400));
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
      return res.status(403).json(createExpressErrorResponse('Your account has been deleted.', 403));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createExpressErrorResponse('Your account is pending confirmation.', 403));
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // If suspended, respond accordingly but still provide tokens
    if (user.status === 'suspended') {
      return res.json({
        // success: true, // Replaced with createExpressSuccessResponse
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

    return res.json(createExpressSuccessResponse('Google sign in successful', {
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null
      }
    }));
  } catch (error) {
    logError('Google sign-in error', error);
    return res.status(401).json(createExpressErrorResponse(error.message || 'Unauthorized', 401));
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
      return res.status(400).json(createExpressErrorResponse('idToken or code is required', 400));
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
        return res.status(401).json(createExpressErrorResponse('Apple code exchange failed', 401));
      }
    }

    // Verify Apple ID token
    const payload = await verifyAppleIdToken(idTokenToVerify, resolvedClientId);
    const oauthUid = payload.sub;
    const email = (payload.email || bodyEmail || '').toLowerCase();
    const name = payload.name || bodyName || 'User';

    // Email can be absent on subsequent Apple logins require it from body if not present
    if (!email) {
      return res.status(400).json(createExpressErrorResponse('Email is required from Apple token or body', 400));
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
      return res.status(403).json(createExpressErrorResponse('Your account has been deleted.', 403));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createExpressErrorResponse('Your account is pending confirmation.', 403));
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // If suspended, respond accordingly but still provide tokens
    if (user.status === 'suspended') {
      return res.json({
        // success: true, // Replaced with createExpressSuccessResponse
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

    return res.json(createExpressSuccessResponse('Apple sign in successful', {
      accessToken,
      refreshToken,
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: user.avatar ? getFile('avatar/' + user.avatar) : null
      }
    }));
  } catch (error) {
    logError('Apple sign-in error', error);
    return res.status(401).json(createExpressErrorResponse(error.message || 'Unauthorized', 401));
  }
};

/**
 * Suspended account handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const suspended = async (req, res) => {
  try {
    return res.json(createExpressSuccessResponse('Account is suspended', {
      actionRequired: 'contact_support',
      supportEmail: process.env.SUPPORT_EMAIL || 'support@bingeme.com'
    }));
  } catch (error) {
    logError('Suspended handler error', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
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
 * Creates a referral record in the database.
 * @param {number} userId - The newly created user's ID
 * @param {number} referredBy - The referring user's ID
 * @returns {Promise<boolean>} Success status
 */
const createReferralRecord = async (userId, referredBy) => {
  try {
    const pool = getDB();
    const insertQuery = `
      INSERT INTO referrals (user_id, referred_by, created_at, updated_at) 
      VALUES (?, ?, NOW(), NOW())
    `;
    const insertParams = [userId, referredBy];

    await pool.query(insertQuery, insertParams);
    logInfo('Referral record created successfully:', { userId, referredBy });
    return true;
  } catch (error) {
    logError('Error creating referral record:', error);
    return false;
  }
};

/**
 * Creates a new user in the database.
 * @param {object} userData - User data for creation
 * @param {string} userData.name - User's name
 * @param {string} userData.email - User's email
 * @param {string} userData.phone - User's phone
 * @param {string} userData.ip - User's IP address
 * @returns {Promise<object>} Created user info
 */
const createUser = async ({ name, email, phone, ip }) => {
  try {
    const pool = getDB();
    // Parameterized query to prevent SQL injection
    // Provide placeholder defaults for NOT NULL columns without DB defaults
    // - username: use temporary 'ua' then update to `u{userId}` post-insert
    // - countries_id: insert empty string to satisfy NOT NULL constraint
    const insertQuery = `
    INSERT INTO users (
      name, username, mobile, email, password,
      date, avatar, cover, status, role, permission,
      confirmation_code, oauth_uid, oauth_provider, token, story,
      verified_id, email_verified, ip, language, mobile_verified, countries_id,
      remember_token, paypal_account, payment_gateway, bank, about, profession,
      categories_id, website, price, balance, address, city, zip, facebook,
      twitter, instagram, youtube, pinterest, github, plan, company, gender,
      birthdate, wallet, tiktok, snapchat, paystack_plan, paystack_authorization_code,
      paystack_last4, paystack_exp, paystack_card_brand, last_login, custom_fee,
      payoneer_account, zelle_account, permissions, blocked_countries, net_earnings, creator_agreement,
      telegram, vk, twitch, discord
    ) VALUES (
      ?, 'ua', ?, ?, '',
      NOW(), '', '', 'active', 'normal', 'none',
      '', ?, 'google', '', '',
      'no', '1', ?, 'en', '0', '',
      '', '', '', '', '', '',
      '', '', 0, 0, '', '', '', '',
      '', '', '', '', '', '', '','',
      '', 0.00, '', '', '', '',
      0, '', '', '', 0,
      '', '', '', '', 0.00,
      0, '', '', '', ''
    )
  `;
    const insertParams = [
      name, phone || '', email.toLowerCase(), '', // empty password
      ip || '127.0.0.1'
    ];

    // Add timeout to database operations
    const insertPromise = pool.query(insertQuery, insertParams);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database insert timeout')), 5000)
    );
    const [result] = await Promise.race([insertPromise, timeoutPromise]);
    const userId = result.insertId;

    // Update username with user ID (parameterized)
    const username = `u${userId}`;
    const updateQuery = `UPDATE users SET username = ? WHERE id = ?`;
    const updatePromise = pool.query(updateQuery, [username, userId]);
    const updateTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Database update timeout')), 3000)
    );
    await Promise.race([updatePromise, updateTimeoutPromise]);

    logInfo('User created successfully:', { userId, email, username });
    return {
      id: userId,
      username,
      email: email.toLowerCase(),
      mobile: phone || ''
    };
  } catch (error) {
    logError('Error creating user:', error);
    throw error;
  }
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
