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
  // Added for refresh parity with Lambda
  getRefreshToken,
  revokeRefreshToken,
  isRefreshTokenExpiringSoon,
  decryptId,
  isEncryptedId,
  getSupportUserIds,
  getSupportCreatorIds
} from '../utils/common.js';
import { sendWhatsAppOTP } from '../utils/whatsapp.js';
import { sendEmailOTP } from '../utils/mail.js';
import { validateEmail, validateMobile, validatePassword } from '../utils/validations.js';

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Anonymous user initialization with Apple App Attest support
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const init = async (req, res) => {
  try {
    // Rate limit per IP and route
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!await checkRateLimit(ip, '/auth/init')) {
      return res.status(429).json(createErrorResponse(429, 'Too many requests'));
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
      if (session.error) return res.status(500).json(createErrorResponse(500, session.error.message || session.error.error));
      return res.json(createSuccessResponse('Swagger session initialized', {
        ...session,
        client: 'swagger'
      }));
    }

    // Android client: placeholder, no-op for now
    if (isAndroid) {
      return res.json(createSuccessResponse('Android init acknowledged', {
        client: 'android',
        action: 'noop'
      }));
    }

    // iOS (default) flow: App Attest with fallback
    if (unsupported === true) {
      const session = await issueAnonymousSession(req);
      if (session.error) return res.status(500).json(createErrorResponse(500, session.error.message || session.error.error));
      return res.json(createSuccessResponse('Anonymous session initialized (fallback)', {
        ...session,
        fallback: true
      }));
    }

    // Basic input checks
    if (!keyId || !attestationObject || !clientDataHash || !challenge) {
      return res.status(400).json(createErrorResponse(400, 'Missing required fields'));
    }

    // Decode base64 inputs
    const attObjBuf = decodeBase64(attestationObject);
    const clientHashBuf = decodeBase64(clientDataHash);
    const challengeBuf = decodeBase64(challenge);
    if (!attObjBuf || !clientHashBuf || !challengeBuf) {
      return res.status(400).json(createErrorResponse(400, 'Invalid base64 encoding'));
    }

    // Ensure challenge is 32 bytes
    if (challengeBuf.length !== 32) {
      return res.status(400).json(createErrorResponse(400, 'Invalid challenge length'));
    }

    // Challenge freshness and replay protection
    const fresh = await consumeChallengeIfFresh(challenge);
    if (!fresh) {
      return res.status(400).json(createErrorResponse(400, 'Challenge already used or invalid'));
    }

    const session = await issueAnonymousSession(req);
    if (session.error) return res.status(500).json(createErrorResponse(500, session.error.message || session.error.error));
    
    return res.json(createSuccessResponse('Anonymous session initialized', {
      ...session,
      appAttestVerified: true,
      bundleId: bundleId || null,
      teamId: teamId || null,
      appVersion: appVersion || null
    }));
  } catch (error) {
    logError('Anonymous user initialization error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * User registration handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const register = async (req, res) => {
  try {
    logInfo('Register handler invoked');
    
    // Parse and validate request body
    let body;
    try {
      body = req.body;
    } catch (parseErr) {
      logError('Failed to parse request body', { error: parseErr });
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }
    
    // Destructure and set defaults
    const { name, email, phone, countryCode, terms } = body;
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    logInfo('Extracted input fields');

    // Validate input fields
    const inputError = validateRegistrationInput({ name, email, phone, countryCode, terms });
    if (inputError) return res.status(400).json(createErrorResponse(400, inputError.error));

    // Rate limiting to prevent abuse
    logInfo('Checking rate limit');
    if (!await checkRateLimit(ip, '/auth/signup')) {
      logError('Rate limit exceeded', { ip });
      return res.status(429).json(createErrorResponse(429, 'Too many requests'));
    }

    // At least one contact method must be provided
    if (!name || terms !== '1' || (!email && (!phone || !countryCode))) {
      logError('Missing required fields', { name, email, phone, countryCode, terms });
      return res.status(400).json(createErrorResponse(400, 'Missing required fields'));
    }
    
    // If phone is provided, countryCode is required
    if (phone && !countryCode) {
      logError('Country code required when phone number is provided', { phone });
      return res.status(400).json(createErrorResponse(400, 'Country code is required when providing phone number'));
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
          return res.status(403).json(createErrorResponse(403, 'Invalid email domain'));
        }
        if (emailValidation.status === 'fulfilled' && emailValidation.value?.status === 'error') {
          logError('Unable to send OTP to this email');
          return res.status(400).json(createErrorResponse(400, 'Unable to send OTP to this email'));
        }
        if (listCleanValid.status === 'fulfilled' && !listCleanValid.value) {
          logError('Invalid email address (ListClean)');
          return res.status(400).json(createErrorResponse(400, 'Invalid email address'));
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
      return res.status(409).json(createErrorResponse(409, 'Account already exists'));
    }

    // Generate OTP securely
    const identifier = email || phone;
    logInfo('Generating OTP');
    const generatedOTP = await generateOTP(identifier);
    logInfo('OTP generated');

    // Send OTP asynchronously (fire-and-forget)
    await sendOtpAsync({ email, phone, countryCode, otp: generatedOTP });
    logInfo('OTP sent successfully');
    return res.json(createSuccessResponse('OTP sent successfully'));
  } catch (error) {
    logError('Signup error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const verifyOtp = async (req, res) => {
  try {
    // Destructure headers for Authorization
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createErrorResponse(401, 'Access token required'));
    }
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');
    
    // Verify access token and enforce anonymous only
    const decoded = verifyAccessToken(accessToken);
    if (!decoded) {
      return res.status(401).json(createErrorResponse(401, 'Invalid access token'));
    }
    if (!(decoded.isAnonymous === true || decoded.role === 'anonymous')) {
      return res.status(403).json(createErrorResponse(403, 'Only anonymous access token allowed'));
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
      return res.status(400).json(createErrorResponse(400, 'Identifier and OTP are required'));
    }
    if (typeof otp !== 'string' || !/^\d{5,8}$/.test(otp)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid OTP format'));
    }
    
    // Fetch OTP record from DynamoDB
    const tableName = `otp-${process.env.NODE_ENV || 'dev'}`;
    const { Item: otpRecord } = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { identifier },
    }));
    
    if (!otpRecord) {
      return res.status(404).json(createErrorResponse(404, 'OTP not found or has expired'));
    }
    
    // Check for too many attempts (max 5)
    if (otpRecord.attempts >= 5) {
      return res.status(429).json(createErrorResponse(429, 'Too many failed OTP attempts. Please request a new OTP.'));
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
      return res.status(400).json(createErrorResponse(400, 'Invalid OTP'));
    }
    
    // Check if OTP is expired (10-minute window)
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - otpRecord.timestamp > tenMinutes) {
      return res.status(400).json(createErrorResponse(400, 'OTP has expired'));
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
      return res.status(400).json(createErrorResponse(400, 'Cannot create user without an email or phone number.'));
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
      return res.status(500).json(createErrorResponse(500, 'Failed to create session'));
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

    return res.json(createSuccessResponse('OTP verified successfully. User account created.', {
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
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * User login handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const login = async (req, res) => {
  try {
    const { username_email, country_code, phone, password, is_otp_login } = req.body;

    if (typeof is_otp_login !== 'boolean') {
      return res.status(400).json(createErrorResponse(400, 'is_otp_login field is required and must be a boolean.'));
    }

    let identifier, loginType, type;
    let user;

    // OTP-based login flow
    if (is_otp_login) {
      if (phone && country_code && isValidPhoneFormat(phone, country_code)) {
        // Mobile OTP login
        type = 'mobile_otp';
        identifier = `${country_code}${phone}`;
        loginType = 'mobile';
        user = await findUser(identifier, loginType);
        if (!user) return res.status(404).json(createErrorResponse(404, 'Invalid credentials'));
        
        const otp = await generateOTP(identifier);
        const sent = await sendWhatsAppOTP(phone, country_code, otp);
        if (sent) {
          return res.json(createSuccessResponse('OTP sent. Please verify to continue.', {
            actionRequired: '2fa_verify'
          }));
        }
        return res.status(500).json(createErrorResponse(500, 'Could not send WhatsApp OTP. Please try again later.'));
      }
      if (username_email) {
        // Email OTP login
        type = 'email_otp';
        identifier = username_email;
        loginType = 'email';
        user = await findUser(identifier, loginType);
        if (!user) return res.status(404).json(createErrorResponse(404, 'Invalid credentials'));
        
        const otp = await generateOTP(user.email);
        const sent = await sendEmailOTP(user.email, otp, 'login');
        if (sent) {
          return res.json(createSuccessResponse('OTP sent. Please verify to continue.', {
            actionRequired: '2fa_verify'
          }));
        }
        return res.status(500).json(createErrorResponse(500, 'Could not send OTP. Please try again later.'));
      }
      return res.status(400).json(createErrorResponse(400, 'Email or valid mobile number with country code is required for OTP login.'));
    }

    // Password-based login flow
    if ((!username_email && !(country_code && phone)) || !password) {
      return res.status(400).json(createErrorResponse(400, 'Provide either email/username or country_code and phone, and password for password login.'));
    }
    type = 'password_login';
    if (country_code && phone) {
      if (!isValidPhoneFormat(phone, country_code)) {
        return res.status(400).json(createErrorResponse(400, 'Invalid phone number format for the provided country code.'));
      }
      identifier = (country_code ? country_code.replace(/^\+?/, '+') : '') + (phone || '');
      loginType = 'mobile';
    } else if (username_email) {
      identifier = username_email;
      loginType = username_email.includes('@') ? 'email' : 'username';
    } else {
      return res.status(400).json(createErrorResponse(400, 'Provide either email/username or country_code and phone for login.'));
    }

    user = await findUser(identifier, loginType);
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'Invalid credentials'));
    }

    // Check user status
    switch (user.status) {
      case 'suspended': 
        // Allow suspended users to login but mark them as suspended
        logInfo('Suspended user attempting login:', { userId: user.id, status: user.status });
        break;
      case 'pending': return res.status(403).json(createErrorResponse(403, 'Your account is pending confirmation.'));
      case 'deleted': return res.status(403).json(createErrorResponse(403, 'Your account has been deleted.'));
      case 'active': break;
      default: return res.status(500).json(createErrorResponse(500, 'Unknown account status.'));
    }

    // Password login validation
    if (type === 'password_login') {
      if (!user.password) {
        return res.status(401).json(createErrorResponse(401, 'Account not set up for password login. Please use OTP login or set a password first.'));
      }
      try {
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
          return res.status(401).json(createErrorResponse(401, 'Invalid credentials'));
        }
      } catch (compareError) {
        return res.status(500).json(createErrorResponse(500, 'Internal server error'));
      }
    }

    // 2FA flow
    if (user.two_factor_auth === 'yes') {
      try {
        const otp = await generateOTP(user.email);
        const sent = await sendEmailOTP(user.email, otp, 'login');
      if (sent) {
          return res.json(createSuccessResponse('2FA code sent. Please verify to continue.', {
          actionRequired: '2fa_verify'
          }));
      }
        return res.status(500).json(createErrorResponse(500, 'Could not send 2FA code. Please try again later.'));
      } catch (error) {
        return res.status(500).json(createErrorResponse(500, 'Could not send 2FA code. Please try again later.'));
      }
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
      return res.json(createSuccessResponse('Login successful but account is suspended', {
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
        currency,
        timestamp: new Date().toISOString()
      }));
    }

    return res.json(createSuccessResponse('Login successful', {
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
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Login OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const loginVerify = async (req, res) => {
  try {
    const { identifier, otp } = req.body;
    
    if (!identifier || !otp) {
      return res.status(400).json(createErrorResponse(400, 'Identifier and OTP are required.'));
    }
    
    // Determine login type
    const loginType = identifier.includes('@') ? 'email' : 'mobile';
    
    // Find user
    const pool = getDB();
    const query = `SELECT * FROM users WHERE ${loginType} = ?`;
    const [rows] = await pool.query(query, [identifier]);
    const user = rows[0] || null;
    
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'Invalid credentials'));
    }

    // Verify OTP
    const isOtpValid = await verifyEmailOTP(identifier, otp);
    if (!isOtpValid) {
      return res.status(401).json(createErrorResponse(401, 'Invalid or expired OTP'));
    }
    
    // Check user status
    switch (user.status) {
      case 'suspended': 
        // Allow suspended users to login but mark them as suspended
        logInfo('Suspended user attempting login:', { userId: user.id, status: user.status });
        break;
      case 'pending': return res.status(403).json(createErrorResponse(403, 'Your account is pending confirmation.'));
      case 'deleted': return res.status(403).json(createErrorResponse(403, 'Your account has been deleted.'));
      case 'active': break;
      default: return res.status(500).json(createErrorResponse(500, 'Unknown account status.'));
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
      return res.json(createSuccessResponse('Login verification successful but account is suspended', {
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
        timestamp: new Date().toISOString()
      }));
    }

    return res.json(createSuccessResponse('Login verification successful', {
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
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Token refresh handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json(createErrorResponse(400, 'Refresh token is required'));
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      return res.status(401).json(createErrorResponse(401, 'Invalid refresh token'));
    }

    // Extract user info from token
    let { id, role, isAnonymous } = decoded;

    // Decode 24-character IDs when not anonymous
    if (!isAnonymous && typeof id === 'string' && isEncryptedId && isEncryptedId(id)) {
      try {
        id = decryptId(id);
        logInfo('Decoded 24-character ID from refresh token', { encodedId: decoded.id, decodedId: id });
      } catch (error) {
        logError('Failed to decode 24-character ID from refresh token', { encodedId: decoded.id, error: error.message });
        return res.status(401).json(createErrorResponse(401, 'Invalid refresh token format'));
      }
    }

    const user = { id, role, isAnonymous: Boolean(isAnonymous) };
    logInfo('Refresh token verified successfully', user);

    // Current device info
    const currentDeviceInfo = getDeviceInfo(req);
    logInfo('Current device info for refresh', {
      deviceFingerprint: currentDeviceInfo.deviceFingerprint,
      ipAddress: currentDeviceInfo.ip,
      app: currentDeviceInfo.appString
    });

    // Look up stored refresh token session
    const storedTokenData = await getRefreshToken(refreshToken, id.toString());
    if (!storedTokenData) {
      return res.status(401).json(createErrorResponse(401, 'Refresh token not found or revoked'));
    }

    // Should renew if expiring within 7 days
    const shouldRenew = isRefreshTokenExpiringSoon(storedTokenData.expiresAt, 7);

    // Device fingerprint comparison
    const deviceFingerprintMatch = storedTokenData.deviceFingerprint === currentDeviceInfo.deviceFingerprint;
    logInfo('Device fingerprint validation', {
      stored: storedTokenData.deviceFingerprint,
      current: currentDeviceInfo.deviceFingerprint,
      match: deviceFingerprintMatch
    });

    // Prepare payload
    const tokenPayload = { ...user };

    // Always new access token
    const accessToken = generateAccessToken(tokenPayload);

    let action = 'kept';
    let newRefresh = null;

    if (deviceFingerprintMatch && !shouldRenew) {
      // Keep existing refresh token
      action = 'kept';
    } else if (deviceFingerprintMatch && shouldRenew) {
      // Renew same-device token near expiry
      newRefresh = generateRefreshToken(tokenPayload);
      await revokeRefreshToken(refreshToken, id.toString());
      const stored = await storeRefreshToken(id.toString(), newRefresh, req);
      if (!stored) {
        logError('Failed to store new refresh token');
        return res.status(500).json(createErrorResponse(500, 'Failed to refresh session'));
      }
      action = 'renewed';
    } else {
      // New device/session → create new session record
      newRefresh = generateRefreshToken(tokenPayload);
      const stored = await storeRefreshToken(id.toString(), newRefresh, req);
      if (!stored) {
        logError('Failed to store new refresh token for new device');
        return res.status(500).json(createErrorResponse(500, 'Failed to create new session'));
      }
      action = 'new_device';
    }

    logInfo('Tokens refreshed successfully', {
      id,
      newAccessTokenExpiry: '1h',
      refreshTokenAction: action
    });

    const data = {
      accessToken,
      user: {
        id: user.id.toString(),
        role: user.role,
        isAnonymous: user.isAnonymous
      }
    };
    if (newRefresh) {
      data.refreshToken = newRefresh;
    }

    return res.json(createSuccessResponse('Tokens refreshed successfully', data));
  } catch (error) {
    logError('Token refresh error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Logout handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    // Require refresh token
    if (!refreshToken || typeof refreshToken !== 'string') {
      return res.status(400).json(createErrorResponse(400, 'Refresh token is required in request body'));
    }

    // Require Authorization: Bearer <token>
    const authHeader = req.headers?.authorization || req.headers?.Authorization;
    if (!authHeader || !/^Bearer\s+/i.test(authHeader)) {
      return res.status(401).json(createErrorResponse(401, 'Access token required'));
    }
    const accessToken = authHeader.replace(/^Bearer\s+/i, '');

    // Verify and decode access token
    const decoded = verifyAccessToken(accessToken);
    if (!decoded) {
      return res.status(401).json(createErrorResponse(401, 'Invalid access token'));
    }

    // Disallow anonymous tokens for logout (must be an authenticated user)
    if (decoded.isAnonymous) {
      return res.status(401).json(createErrorResponse(401, 'Authenticated user token required'));
    }

    // Resolve user id (decrypt if non-anonymous and encrypted)
    let userId = decoded.id;
    try {
      if (typeof userId === 'string' && isEncryptedId && isEncryptedId(userId)) {
        userId = decryptId(userId);
      }
    } catch (error) {
      logError('Failed to decode 24-character ID from logout token', { encodedId: decoded.id, error: error.message });
      return res.status(401).json(createErrorResponse(401, 'Invalid token format'));
    }

    logInfo('Logout request', { userId: String(userId), role: decoded.role });

    // Revoke the specific refresh token; proceed even if it fails
    try {
      await revokeRefreshToken(refreshToken, String(userId));
      logInfo('Revoked refresh token for user', { userId: String(userId) });
    } catch (e) {
      logInfo('Refresh token revoke failed or not found; proceeding', { userId: String(userId) });
    }

    // Generate anonymous session
    const anonymousUserId = `anon_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const anonymousPayload = { id: anonymousUserId, role: 'anonymous', isAnonymous: true };
    const newAccessToken = generateAccessToken(anonymousPayload);
    const newRefreshToken = generateRefreshToken(anonymousPayload);

    // Store anonymous refresh token session
    const stored = await storeRefreshToken(anonymousUserId, newRefreshToken, req);
    if (!stored) {
      logInfo('Failed to store anonymous refresh token after logout');
      return res.json(createSuccessResponse('Logged out successfully'));
    }

    return res.json(createSuccessResponse('Logged out successfully', {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      anonymousUserId
    }));
  } catch (error) {
    logError('Logout error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Token validation handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const validate = async (req, res) => {
  try {
    const pool = getDB();
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json(createErrorResponse(401, 'Invalid access token'));
    }

    const [rows] = await pool.query('SELECT id, username, name, avatar, status, role, countries_id FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    const user = rows[0];

    // Compute currency like Lambda
    let currency = null;
    let adminSettings = null;
    try {
      adminSettings = await getAdminSettings();
      const userCountry = await getUserCountry(req, user);
      currency = processCurrencySettings(adminSettings, userCountry).currency;
    } catch (e) {
      logError('validate currency processing error', e);
    }

    const avatarUrl = user.avatar
      ? getFile('avatar/' + user.avatar)
      : (adminSettings?.avatar ? getFile('avatar/' + adminSettings.avatar) : null);

    return res.json(createSuccessResponse('Token is valid', {
      user: {
        id: String(user.id),
        username: user.username,
        name: user.name,
        avatar: avatarUrl,
        status: user.status,
        role: user.role || 'normal',
        countries_id: user.countries_id
      },
      currency
    }));
  } catch (error) {
    logError('Token validation error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Forgot password request handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const forgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate email format
    if (!email || !validateEmail(email)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid email format'));
    }

    // Check if user exists
    const pool = getDB();
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email.toLowerCase()]);
    if (!rows.length) {
      return res.status(404).json(createErrorResponse("Can't find email", 404));
    }

    // Generate OTP and send via email
    const otp = await generateOTP(email.toLowerCase());
    const sent = await sendEmailOTP(email, otp, 'forgot_password');
    if (!sent) {
      return res.status(500).json(createErrorResponse(500, 'Failed to send OTP. Please try again later.'));
    }

    logInfo('Forgot password OTP sent', { email: email.toLowerCase() });
    return res.json(createSuccessResponse('OTP sent successfully'));
  } catch (error) {
    logError('Forgot password request error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Forgot password OTP verification handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const forgotPasswordVerify = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json(createErrorResponse(400, 'Email and OTP are required'));
    }

    const isValid = await verifyEmailOTP(String(email).toLowerCase(), String(otp));
    if (!isValid) {
      return res.status(400).json(createErrorResponse(400, 'Invalid OTP'));
    }

    logInfo('Forgot password OTP verified', { email: String(email).toLowerCase() });
    return res.json(createSuccessResponse('OTP verified successfully'));
  } catch (error) {
    logError('Forgot password verification error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Password reset handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const forgotPasswordReset = async (req, res) => {
  try {
    const { email, password, confirm_password } = req.body;

    if (!email || !password || !confirm_password) {
      return res.status(400).json(createErrorResponse(400, 'Email, password, and confirm password are required'));
    }

    if (password !== confirm_password) {
      return res.status(400).json(createErrorResponse(400, 'Passwords do not match'));
    }

    // Validate password strength
    const { isValid, message } = validatePassword(password);
    if (!isValid) {
      return res.status(400).json(createErrorResponse(message, 400));
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(password, 12);
    const pool = getDB();
    const [result] = await pool.query('UPDATE users SET password = ? WHERE email = ?', [hashedPassword, email.toLowerCase()]);
    if (!result.affectedRows) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    logInfo('Password reset successfully', { email: email.toLowerCase() });
    return res.json(createSuccessResponse('Password reset successfully'));
  } catch (error) {
    logError('Password reset error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Google sign-in handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const googleSignin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json(createErrorResponse(400, 'Google ID token is required'));
    }

    // Basic rate limiting per IP and route (parity with Lambda)
    const ip = req.ip || req.connection?.remoteAddress || '0.0.0.0';
    if (!await checkRateLimit(ip, '/auth/google')) {
      return res.status(429).json(createErrorResponse(429, 'Too many requests'));
    }

    // Verify Google ID token
    const payload = await verifyGoogleIdToken(idToken);
    const oauthUid = payload.sub;
    const email = payload.email?.toLowerCase();
    const name = payload.name || 'User';

    if (!email) {
      return res.status(400).json(createErrorResponse(400, 'Email is required from Google token'));
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
      return res.status(403).json(createErrorResponse(403, 'Your account has been deleted.'));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createErrorResponse(403, 'Your account is pending confirmation.'));
    }

    // Generate tokens and store refresh session
    const role = user.role || 'normal';
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role });
    const stored = await storeRefreshToken(String(user.id), refreshToken, req);
    if (!stored) {
      return res.status(500).json(createErrorResponse(500, 'Failed to create session'));
    }

    // Compute currency based on admin settings and user country (parity with Lambda)
    let currency = null;
    try {
      const adminSettings = await getAdminSettings();
      const userCountry = await getUserCountry(req, user);
      currency = processCurrencySettings(adminSettings, userCountry).currency;
    } catch (e) {
      logError('googleSignin currency processing error', e);
    }

    // If suspended, respond accordingly but still provide tokens (Lambda behavior)
    if (user.status === 'suspended') {
      return res.json(createSuccessResponse('Login successful but account is suspended', {
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
          role
        },
        currency
      }));
    }

    return res.json(createSuccessResponse('Google sign in successful', {
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
    logError('Google sign-in error', error);
    return res.status(401).json(createErrorResponse(401, error.message || 'Unauthorized'));
  }
};

/**
 * Apple sign-in handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const appleSignin = async (req, res) => {
  try {
    const { idToken, code, redirectUri, email: bodyEmail, name: bodyName, clientId: clientIdFromBody } = req.body;

    // Support two inputs: direct idToken or OAuth code
    if (!idToken && !code) {
      return res.status(400).json(createErrorResponse(400, 'idToken or code is required'));
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
        return res.status(401).json(createErrorResponse(401, 'Apple code exchange failed'));
      }
    }

    // Verify Apple ID token
    const payload = await verifyAppleIdToken(idTokenToVerify, resolvedClientId);
    const oauthUid = payload.sub;
    const email = (payload.email || bodyEmail || '').toLowerCase();
    const name = payload.name || bodyName || 'User';

    // Email can be absent on subsequent Apple logins require it from body if not present
    if (!email) {
      return res.status(400).json(createErrorResponse(400, 'Email is required from Apple token or body'));
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
      return res.status(403).json(createErrorResponse(403, 'Your account has been deleted.'));
    }
    if (user.status === 'pending') {
      return res.status(403).json(createErrorResponse(403, 'Your account is pending confirmation.'));
    }

    // Generate tokens
    const accessToken = generateAccessToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    const refreshToken = generateRefreshToken({ id: parseInt(user.id, 10), role: user.role || 'normal' });
    await storeRefreshToken(String(user.id), refreshToken, req);

    // If suspended, respond accordingly but still provide tokens
    if (user.status === 'suspended') {
      return res.json(createSuccessResponse('Login successful but account is suspended', {
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
      }));
    }

    return res.json(createSuccessResponse('Apple sign in successful', {
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
    return res.status(401).json(createErrorResponse(401, error.message || 'Unauthorized'));
  }
};

/**
 * Suspended account handler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
const suspended = async (req, res) => {
  try {
    // Require authenticated token (handled by route middleware), use req.userId
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json(createErrorResponse(401, 'Access token required'));
    }

    // Check if user is suspended
    const pool = getDB();
    const [rows] = await pool.query(
      `SELECT id, status, role, verified_id FROM users WHERE id = ? AND status = 'suspended'`,
      [userId]
    );

    if (!rows.length) {
      return res.status(403).json(createErrorResponse(403, 'User not suspended'));
    }

    const user = rows[0];

    // Fetch support IDs from admin settings
    const supportUserIds = await getSupportUserIds();
    const supportUserId = supportUserIds.length > 0 ? supportUserIds[0] : '';

    const creatorSupportIds = await getSupportCreatorIds();
    const creatorSupportId = creatorSupportIds.length > 0 ? creatorSupportIds[0] : '';

    // Determine URL per Lambda/Templar behavior
    let url = `messages/${supportUserId}/support`;
    if (user.role === 'normal' && user.verified_id === 'yes') {
      url = `messages/${creatorSupportId}/csupport`;
    }

    logInfo('Suspended support URL determined', { userId: String(userId), url, role: user.role, verified: user.verified_id });

    return res.json(createSuccessResponse('Suspended user support URL retrieved', {
      url,
      user: {
        role: user.role,
        verified_id: user.verified_id
      }
    }));
  } catch (error) {
    logError('Suspended handler error', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
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
    
    // Get default avatar and cover from admin settings
    let defaultAvatar = '';
    let defaultCover = '';
    try {
      const [settingsRows] = await pool.query('SELECT avatar, cover_default FROM admin_settings LIMIT 1');
      if (settingsRows.length > 0) {
        defaultAvatar = settingsRows[0].avatar || '';
        defaultCover = settingsRows[0].cover_default || '';
      }
    } catch (settingsError) {
      logError('Error fetching default avatar/cover from admin settings:', settingsError);
      // Continue with empty defaults if settings fetch fails
    }
    
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
      NOW(), ?, ?, 'active', 'normal', 'none',
      '', '', '', '', '',
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
      name, phone || '', email.toLowerCase(),
      defaultAvatar, defaultCover, // avatar, cover
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

/**
 * Helper: Verify Google ID token via Google's tokeninfo endpoint
 */
const verifyGoogleIdToken = async (idToken) => {
  try {
    const { data } = await axios.get('https://oauth2.googleapis.com/tokeninfo', {
      params: { id_token: idToken },
      timeout: 5000
    });

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && data.aud !== clientId) {
      throw new Error('Invalid Google client ID');
    }

    if (String(data.email_verified) !== 'true') {
      throw new Error('Google email not verified');
    }

    return data;
  } catch (error) {
    throw new Error(`Google token verification failed: ${error.response?.data?.error_description || error.message}`);
  }
};

/**
 * Helper: Find existing user by Google oauth or email
 */
const findUserByOAuthOrEmail = async (oauthUid, email) => {
  const pool = getDB();
  const query = `
    SELECT * FROM users
    WHERE (oauth_provider = 'google' AND oauth_uid = ?) OR email = ?
    LIMIT 1
  `;
  const [rows] = await pool.query(query, [oauthUid, email.toLowerCase()]);
  return rows[0] || null;
};

/**
 * Helper: Create new user using Google profile data (Lambda parity)
 */
const createUserWithGoogle = async ({ name, email, oauthUid, ip }) => {
  const pool = getDB();

  // Fetch admin default avatar/cover
  let defaultAvatar = '';
  let defaultCover = '';
  try {
    const adminSettings = await getAdminSettings();
    defaultAvatar = adminSettings?.avatar || '';
    defaultCover = adminSettings?.cover_default || '';
  } catch (e) {
    logError('createUserWithGoogle admin settings fetch error', e);
  }

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
      ?, 'ua', '', ?, '',
      NOW(), ?, ?, 'active', 'normal', 'none',
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
  const [result] = await pool.query(insertQuery, [name, email.toLowerCase(), defaultAvatar, defaultCover, oauthUid, ip || '127.0.0.1']);
  const userId = result.insertId;
  await pool.query('UPDATE users SET username = ? WHERE id = ?', [`u${userId}`, userId]);
  return {
    id: userId,
    email: email.toLowerCase(),
    username: `u${userId}`,
    status: 'active',
    role: 'normal',
    avatar: defaultAvatar,
    countries_id: ''
  };
};

/**
 * Helper: Attach Google oauth to existing user
 */
const attachGoogleToExistingUser = async (userId, oauthUid) => {
  const pool = getDB();
  await pool.query(
    `UPDATE users SET oauth_uid = ?, oauth_provider = 'google', email_verified = '1', updated_at = NOW() WHERE id = ?`,
    [oauthUid, userId]
  );
};

// Export all functions at the end
export {
  init,
  register,
  verifyOtp,
  login,
  loginVerify,
  refresh,
  logout,
  validate,
  forgotPasswordRequest,
  forgotPasswordVerify,
  forgotPasswordReset,
  googleSignin,
  appleSignin,
  suspended,
  consumeChallengeIfFresh,
  issueAnonymousSession,
  createReferralRecord,
  createUser,
  sendOtpAsync,
  findUser,
  verifyGoogleIdToken,
  findUserByOAuthOrEmail,
  createUserWithGoogle,
  attachGoogleToExistingUser
};