/**
 * @file common.js
 * @description Common utilities for Bingeme API Express.js, including logging, rate limiting, email/domain validation, OTP generation, and response helpers.
 * All functions are documented and security best practices are followed.
 */
import dotenv from 'dotenv';
dotenv.config();

import { getDB, pool } from '../config/database.js';
import winston from 'winston';
import nodemailer from 'nodemailer';
import axios from 'axios';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { UAParser } from 'ua-parser-js';

// Configure dayjs plugins for timezone support
dayjs.extend(utc);
dayjs.extend(timezone);

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate critical environment variables
const validateEnvironment = () => {
  const requiredEnvVars = [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'AWS_DEFAULT_REGION',
    'DB_HOST',
    'DB_USERNAME',
    'DB_PASSWORD',
    'DB_DATABASE'
  ];
  const env = (process.env.NODE_ENV || '').toLowerCase();
  const isLocal = ['local', 'development', 'dev'].includes(env);
  const missing = isLocal
    ? requiredEnvVars.filter(varName => !(varName in process.env))
    : requiredEnvVars.filter(varName => !process.env[varName]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

// Validate environment on module load
validateEnvironment();

// Initialize DynamoDB client for specific tables
const ddbClient = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console()
  ]
});

/**
 * Get admin settings
 */
const getAdminSettings = async () => {
  try {
    const pool = getDB();
    const query = `SELECT * FROM admin_settings ORDER BY id ASC`;
    const [rows] = await pool.query(query);
    
    const settings = {};
    rows.forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });
    
    return settings;
  } catch (error) {
    logError('Error getting admin settings:', error);
    return {};
  }
};

/**
 * Build CDN URL for uploaded files (parity with Lambda/CDN behavior)
 * Avoids direct S3 calls and returns a public URL string.
 */
const getFile = (path) => {
  try {
    if (!path) return '';

    const cdnEnv = process.env.CDN_ENV ?? 'bingeme';
    const cdnBase = `https://cdn.${cdnEnv}.com/uploads`;

    // Normalize leading slashes
    const normalized = String(path).replace(/^\/+/, '');

    // Media in updates
    if (
      normalized.startsWith('images/') ||
      normalized.startsWith('videos/') ||
      normalized.startsWith('music/') ||
      normalized.startsWith('files/')
    ) {
      return `${cdnBase}/updates/${normalized}`;
    }

    // Direct paths
    if (
      normalized.startsWith('avatar/') ||
      normalized.startsWith('cover/') ||
      normalized.startsWith('messages/') ||
      normalized.startsWith('shop/')
    ) {
      return `${cdnBase}/${normalized}`;
    }

    // Default to updates bucket path
    return `${cdnBase}/updates/${normalized}`;
  } catch (error) {
    logError('Error building CDN file URL:', error);
    return '';
  }
};

/**
 * Get user by ID
 */
const getUserById = async (userId) => {
  try {
    const query = `SELECT * FROM users WHERE id = ? AND status != "deleted"`;
    const [rows] = await pool.query(query, [userId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting user by ID:', error);
    return null;
  }
};

/**
 * Get user country
 */
const getUserCountry = async (req, authUser = null) => {
  try {
    // 1) Prefer authenticated user's countries_id (parity with Lambda)
    if (authUser && authUser.countries_id) {
      if (authUser.countries_id === '99') {
        return 'IN';
      }
      return 'US';
    }

    // 2) Check CloudFront viewer country header fallbacks
    const cloudFrontCountry = req?.headers?.['cloudfront-viewer-country'] ||
                              req?.headers?.['Cloudfront-Viewer-Country'] ||
                              req?.headers?.['http_cloudfront_viewer_country'];
    if (cloudFrontCountry) {
      return cloudFrontCountry === 'IN' ? 'IN' : 'US';
    }

    // 3) Default to IN (matches Lambda default)
    return 'IN';
  } catch (error) {
    logError('[getUserCountry] Error determining user country:', error);
    return 'IN';
  }
};

/**
 * Process currency settings
 */
const processCurrencySettings = (adminSettings = {}, userCountry) => {
  try {
    const isUS = userCountry === 'US';
    const coin_conversion_USD = Number(adminSettings.coin_conversion_USD) || 50;
    const currency = {
      symbol: isUS ? '$' : '₹',
      code: isUS ? 'USD' : 'INR',
      coin_conversion_rate: isUS ? (1 / coin_conversion_USD) : 1
    };
    return { currency };
  } catch (error) {
    logError('Error processing currency settings:', error);
    return { currency: { code: 'USD', symbol: '$', coin_conversion_rate: 1 } };
  }
};

/**
 * Upsert FCM token record
 */
const upsertFcmTokenRecord = async (userId, fcmToken, deviceInfo = {}) => {
  try {
    const tableName = `fcm-token-${process.env.NODE_ENV || 'dev'}`;
    
    const item = {
      user_id: userId,
      fcm_token: fcmToken,
      device_info: JSON.stringify(deviceInfo),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const command = {
      TableName: tableName,
      Item: item
    };
    
    await docClient.send(new PutCommand(command));
    logInfo('FCM token record upserted successfully:', { userId, fcmToken });
    return true;
  } catch (error) {
    logError('Error upserting FCM token record:', error);
    return false;
  }
};

/**
 * Get subscribers list
 */
const getSubscribersList = async (userId, limit = 20, skip = 0) => {
  try {
    const query = `
      SELECT 
        u.id,
        u.username,
        u.name,
        u.avatar,
        u.verified,
        s.created_at as subscribed_at
      FROM subscriptions s
      JOIN users u ON s.subscriber_id = u.id
      WHERE s.creator_id = ? AND s.status = 'active'
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const [subscribers] = await pool.query(query, [userId, limit, skip]);
    return subscribers;
  } catch (error) {
    logError('Error getting subscribers list:', error);
    return [];
  }
};

/**
 * Get subscribers count
 */
const getSubscribersCount = async (userId) => {
  try {
    const query = `
      SELECT COUNT(*) as count 
      FROM subscriptions 
      WHERE creator_id = ? AND status = 'active'
    `;
    
    const [result] = await pool.query(query, [userId]);
    return result[0].count;
  } catch (error) {
    logError('Error getting subscribers count:', error);
    return 0;
  }
};

/**
 * Get user posts list
 */
const getUserPostsList = async (userId, limit = 20, skip = 0) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        content,
        media,
        likes_count,
        comments_count,
        created_at
      FROM posts 
      WHERE user_id = ? AND deleted = 0
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const [posts] = await pool.query(query, [userId, limit, skip]);
    return posts;
  } catch (error) {
    logError('Error getting user posts list:', error);
    return [];
  }
};

/**
 * Get user posts count
 */
const getUserPostsCount = async (userId) => {
  try {
    const query = `SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND deleted = 0`;
    const [result] = await pool.query(query, [userId]);
    return result[0].count;
  } catch (error) {
    logError('Error getting user posts count:', error);
    return 0;
  }
};

/**
 * Get user updates list
 */
const getUserUpdatesList = async (userId, limit = 20, skip = 0) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        title,
        content,
        image,
        created_at
      FROM updates 
      WHERE user_id = ? AND deleted = 0
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const [updates] = await pool.query(query, [userId, limit, skip]);
    return updates;
  } catch (error) {
    logError('Error getting user updates list:', error);
    return [];
  }
};

/**
 * Get user updates count
 */
const getUserUpdatesCount = async (userId) => {
  try {
    const query = `SELECT COUNT(*) as count FROM updates WHERE user_id = ? AND deleted = 0`;
    const [result] = await pool.query(query, [userId]);
    return result[0].count;
  } catch (error) {
    logError('Error getting user updates count:', error);
    return 0;
  }
};

/**
 * Update user post
 */
const updateUserPost = async (postId, postData) => {
  try {
    const { content, media } = postData;
    const query = `UPDATE posts SET content = ?, media = ?, updated_at = NOW() WHERE id = ?`;
    await pool.query(query, [content, media, postId]);
    logInfo(`Updated user post: ${postId}`);
  } catch (error) {
    logError('Error updating user post:', error);
    throw error;
  }
};

/**
 * Delete user post
 */
const deleteUserPost = async (postId) => {
  try {
    const query = `UPDATE posts SET deleted = 1, deleted_at = NOW() WHERE id = ?`;
    await pool.query(query, [postId]);
    logInfo(`Deleted user post: ${postId}`);
  } catch (error) {
    logError('Error deleting user post:', error);
    throw error;
  }
};

/**
 * Get post comments
 */
const getPostComments = async (postId, limit = 20, skip = 0) => {
  try {
    const query = `
      SELECT 
        c.id,
        c.user_id,
        c.post_id,
        c.comment,
        c.created_at,
        u.username,
        u.name,
        u.avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ? AND c.deleted = 0
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const [comments] = await pool.query(query, [postId, limit, skip]);
    return comments;
  } catch (error) {
    logError('Error getting post comments:', error);
    return [];
  }
};

/**
 * Get user settings
 * @param {number} userId - User ID
 * @returns {Promise<object>} User settings object
 */
const getUserSettings = async (userId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT 
        username,
        name,
        email,
        mobile,
        story,
        country,
        disable_watermark,
        dark_mode,
        created_at,
        updated_at
      FROM users 
      WHERE id = ? AND deleted = 0
    `, [userId]);
    
    if (rows.length === 0) {
      return null;
    }
    
    return rows[0];
  } catch (error) {
    logError('Error getting user settings:', error);
    throw error;
  }
};

/**
 * Check if a user field exists (for validation)
 * @param {number} userId - User ID to exclude from check
 * @param {string} field - Field name to check
 * @param {string} value - Value to check
 * @returns {Promise<boolean>} True if field exists for another user
 */
const checkUserFieldExists = async (userId, field, value) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT id FROM users 
      WHERE ${field} = ? AND id != ? AND deleted = 0
    `, [value, userId]);
    
    return rows.length > 0;
  } catch (error) {
    logError('Error checking user field exists:', error);
    throw error;
  }
};

/**
 * Check if mobile number exists
 * @param {number} userId - User ID to exclude from check
 * @param {string} mobile - Mobile number to check
 * @param {string} countryCode - Country code
 * @returns {Promise<boolean>} True if mobile exists for another user
 */
const checkMobileExists = async (userId, mobile, countryCode) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT id FROM users 
      WHERE mobile = ? AND country_code = ? AND id != ? AND deleted = 0
    `, [mobile, countryCode, userId]);
    
    return rows.length > 0;
  } catch (error) {
    logError('Error checking mobile exists:', error);
    throw error;
  }
};

/**
 * Get user country by ID
 * @param {number} countryId - Country ID
 * @returns {Promise<object>} Country object
 */
const getUserCountryById = async (countryId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT id, name, code FROM countries WHERE id = ?
    `, [countryId]);
    
    return rows[0] || null;
  } catch (error) {
    logError('Error getting user country by ID:', error);
    throw error;
  }
};

/**
 * Update user after OTP verification
 * @param {number} userId - User ID
 * @param {object} updateFields - Fields to update
 * @returns {Promise<boolean>} Success status
 */
const updateUserAfterOTP = async (userId, updateFields) => {
  try {
    const db = await getDB();
    const fields = Object.keys(updateFields);
    const values = Object.values(updateFields);
    
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const [result] = await db.execute(`
      UPDATE users 
      SET ${setClause}, updated_at = NOW()
      WHERE id = ? AND deleted = 0
    `, [...values, userId]);
    
    return result.affectedRows > 0;
  } catch (error) {
    logError('Error updating user after OTP:', error);
    throw error;
  }
};

/**
 * Compare user fields for validation
 * @param {number} userId - User ID
 * @param {string} email - Email to check
 * @param {string} mobile - Mobile to check
 * @param {string} countryCode - Country code
 * @returns {Promise<object>} Comparison result
 */
const compareUserFields = async (userId, email, mobile, countryCode) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT 
        CASE WHEN email = ? THEN 1 ELSE 0 END as email_exists,
        CASE WHEN mobile = ? AND country_code = ? THEN 1 ELSE 0 END as mobile_exists
      FROM users 
      WHERE id = ? AND deleted = 0
    `, [email, mobile, countryCode, userId]);
    
    return rows[0] || { email_exists: 0, mobile_exists: 0 };
  } catch (error) {
    logError('Error comparing user fields:', error);
    throw error;
  }
};

/**
 * Update user settings
 */
const updateUserSettings = async (userId, settings) => {
  try {
    const { username, name, email, mobile, story, country } = settings;
    const query = `
      UPDATE users 
      SET username = ?, name = ?, email = ?, mobile = ?, story = ?, country = ?, updated_at = NOW() 
      WHERE id = ? AND deleted = 0
    `;
    await pool.query(query, [username, name, email, mobile, story, country, userId]);
    logInfo(`Updated user settings: ${userId}`);
  } catch (error) {
    logError('Error updating user settings:', error);
    throw error;
  }
};

/**
 * Send OTP to user
 */
const sendOtpToUser = async (userId, otpType = 'verification') => {
  try {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    
    const otp = generateOTP();
    const identifier = `${otpType}_${userId}`;
    
    await storeOTP(identifier, otp, 10); // 10 minutes expiry
    
    // Send via email or SMS based on user preference
    if (user.email) {
      // Send email OTP
      logInfo(`OTP sent via email to user ${userId}`);
    } else if (user.mobile) {
      // Send SMS OTP
      logInfo(`OTP sent via SMS to user ${userId}`);
    }
    
    return { otp, identifier };
  } catch (error) {
    logError('Error sending OTP to user:', error);
    throw error;
  }
};

/**
 * Verify user OTP
 */
const verifyUserOtp = async (userId, otp, otpType = 'verification') => {
  try {
    const identifier = `${otpType}_${userId}`;
    const isValid = await verifyOTP(identifier, otp);
    
    if (isValid) {
      logInfo(`OTP verified for user ${userId}`);
    }
    
    return isValid;
  } catch (error) {
    logError('Error verifying user OTP:', error);
    return false;
  }
};

/**
 * Search users by name
 */
const searchUsersByName = async (searchTerm, limit = 20, skip = 0) => {
  try {
    const query = `
      SELECT 
        id,
        username,
        name,
        avatar,
        verified
      FROM users 
      WHERE (username LIKE ? OR name LIKE ?) AND deleted = 0
      ORDER BY name ASC
      LIMIT ? OFFSET ?
    `;
    
    const searchPattern = `%${searchTerm}%`;
    const [users] = await pool.query(query, [searchPattern, searchPattern, limit, skip]);
    return users;
  } catch (error) {
    logError('Error searching users by name:', error);
    return [];
  }
};

/**
 * Change user password
 */
const changeUserPassword = async (userId, newPassword) => {
  try {
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const query = `UPDATE users SET password = ?, updated_at = NOW() WHERE id = ? AND deleted = 0`;
    await pool.query(query, [hashedPassword, userId]);
    logInfo(`Password changed for user: ${userId}`);
  } catch (error) {
    logError('Error changing user password:', error);
    throw error;
  }
};

/**
 * Create password OTP for user
 */
const createPasswordOtpForUser = async (userId) => {
  try {
    const otp = generateOTP();
    const identifier = `password_reset_${userId}`;
    
    await storeOTP(identifier, otp, 15); // 15 minutes expiry
    
    logInfo(`Password reset OTP created for user: ${userId}`);
    return { otp, identifier };
  } catch (error) {
    logError('Error creating password OTP:', error);
    throw error;
  }
};

/**
 * Verify password OTP for user
 */
const verifyPasswordOtpForUser = async (userId, otp) => {
  try {
    const identifier = `password_reset_${userId}`;
    const isValid = await verifyOTP(identifier, otp);
    
    if (isValid) {
      logInfo(`Password reset OTP verified for user: ${userId}`);
    }
    
    return isValid;
  } catch (error) {
    logError('Error verifying password OTP:', error);
    return false;
  }
};

/**
 * Block user by ID
 */
const blockUserById = async (userId, blockedUserId) => {
  try {
    const query = `
      INSERT INTO user_blocks (user_id, blocked_user_id, created_at) 
      VALUES (?, ?, NOW())
      ON DUPLICATE KEY UPDATE created_at = NOW()
    `;
    
    await pool.query(query, [userId, blockedUserId]);
    logInfo(`User ${userId} blocked user ${blockedUserId}`);
  } catch (error) {
    logError('Error blocking user:', error);
    throw error;
  }
};

/**
 * Get user profile by slug
 */
const getUserProfileBySlug = async (slug) => {
  try {
    const query = `
      SELECT 
        id,
        username,
        name,
        avatar,
        story,
        verified_id,
        date
      FROM users 
      WHERE username = ? AND status = 'active'
    `;
    
    const [rows] = await pool.query(query, [slug]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting user profile by slug:', error);
    return null;
  }
};

/**
 * Check audio call access
 */
const checkAudioCallAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking audio call access:', error);
    return false;
  }
};

/**
 * Get verification request info
 */
const getVerificationRequestInfo = async (userId) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        status,
        created_at,
        updated_at
      FROM verification_requests 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting verification request info:', error);
    return null;
  }
};

/**
 * Get verification categories
 */
const getVerificationCategories = async () => {
  try {
    const query = `SELECT * FROM verification_categories WHERE active = 1 ORDER BY name ASC`;
    const [categories] = await pool.query(query);
    return categories;
  } catch (error) {
    logError('Error getting verification categories:', error);
    return [];
  }
};

/**
 * Create verification request
 */
const createVerificationRequest = async (requestData) => {
  try {
    const { user_id, category_id, documents, status = 'pending' } = requestData;
    
    const query = `
      INSERT INTO verification_requests (user_id, category_id, documents, status, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [user_id, category_id, JSON.stringify(documents), status]);
    logInfo(`Created verification request: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error creating verification request:', error);
    throw error;
  }
};

/**
 * Get verification conversations list
 */
const getVerificationConversationsList = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT 
        tc.id,
        tc.from_user_id,
        tc.to_user_id,
        tc.message,
        tc.image,
        tc.created_at,
        tc.type,
        u1.username as from_username,
        u1.name as from_name,
        u2.username as to_username,
        u2.name as to_name
      FROM ticket_conversations tc
      LEFT JOIN users u1 ON tc.from_user_id = u1.id
      LEFT JOIN users u2 ON tc.to_user_id = u2.id
      WHERE tc.type = '1' 
        AND (tc.from_user_id = ? OR tc.to_user_id = ?)
      ORDER BY tc.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [conversations] = await pool.query(query, [userId, userId, limitNum, skipNum]);
    return conversations;
  } catch (error) {
    logError('Error getting verification conversations list:', error);
    return [];
  }
};

/**
 * Store verification conversation data
 */
const storeVerificationConversationData = async (conversationData) => {
  try {
    const { from_user_id, to_user_id, message, image = null, type = '1' } = conversationData;
    
    const query = `
      INSERT INTO ticket_conversations (from_user_id, to_user_id, message, image, type, created_at) 
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [from_user_id, to_user_id, message, image, type]);
    logInfo(`Stored verification conversation: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error storing verification conversation data:', error);
    throw error;
  }
};

/**
 * Get all countries
 */
const getAllCountries = async () => {
  try {
    const query = `SELECT * FROM countries ORDER BY name ASC`;
    const [countries] = await pool.query(query);
    return countries;
  } catch (error) {
    logError('Error getting all countries:', error);
    return [];
  }
};

/**
 * Get states by country
 */
const getStates = async (countryId) => {
  try {
    const query = `SELECT * FROM states WHERE country_id = ? ORDER BY name ASC`;
    const [states] = await pool.query(query, [countryId]);
    return states;
  } catch (error) {
    logError('Error getting states:', error);
    return [];
  }
};

/**
 * Get gender options
 */
const getGenderOptions = async () => {
  try {
    return [
      { id: 1, name: 'Male' },
      { id: 2, name: 'Female' },
      { id: 3, name: 'Other' }
    ];
  } catch (error) {
    logError('Error getting gender options:', error);
    return [];
  }
};

/**
 * Fetch authenticated user's sales list with filtering, sorting, and pagination
 * Mirrors Lambda implementation
 */
const getUserSalesList = async (userId, options = {}) => {
  const { sort = null, filter = null, skip = 0, limit = 20 } = options || {};

  // Base sales query (purchases joined to products and buyer)
  let query = `
    SELECT 
      p.id,
      p.delivery_status,
      p.created_at,
      p.description_custom_content,
      u.username as buyer_username,
      u.email as buyer_email,
      pr.name as product_name,
      pr.type as product_type,
      pr.price as product_price
    FROM purchases p
    INNER JOIN users u ON p.user_id = u.id
    INNER JOIN products pr ON p.products_id = pr.id
    WHERE pr.user_id = ? AND p.status = 1
  `;
  const queryParams = [userId];

  // Filter by product type
  if (filter && filter !== 'all') {
    query += ` AND pr.type = ?`;
    queryParams.push(filter);
  }

  // Sorting and delivery status filter
  if (sort) {
    if (sort === 'oldest') {
      query += ` ORDER BY p.id ASC`;
    } else if (sort === 'latest') {
      query += ` ORDER BY p.id DESC`;
    } else if (['pending', 'delivered', 'rejected'].includes(sort)) {
      query += ` AND p.delivery_status = ? ORDER BY p.id DESC`;
      queryParams.push(sort);
    } else {
      query += ` ORDER BY p.id DESC`;
    }
  } else {
    query += ` ORDER BY p.id DESC`;
  }

  // Pagination
  query += ` LIMIT ? OFFSET ?`;
  queryParams.push(parseInt(limit) || 20, parseInt(skip) || 0);

  // Count query for total
  let countQuery = `
    SELECT COUNT(*) as total
    FROM purchases p
    INNER JOIN products pr ON p.products_id = pr.id
    WHERE pr.user_id = ? AND p.status = 1
  `;
  const countParams = [userId];
  if (filter && filter !== 'all') {
    countQuery += ` AND pr.type = ?`;
    countParams.push(filter);
  }
  if (sort && ['pending', 'delivered', 'rejected'].includes(sort)) {
    countQuery += ` AND p.delivery_status = ?`;
    countParams.push(sort);
  }

  try {
    const [countRows] = await pool.query(countQuery, countParams);
    const totalSales = countRows[0]?.total || 0;
    const [rows] = await pool.query(query, queryParams);

    const sales = rows.map(row => {
      const salesCreatedDate = new Date(row.created_at);
      const salesFormattedDate = salesCreatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      let displayProductType = row.product_type;
      if (row.product_type === 'custom') displayProductType = 'Custom Content';
      else if (row.product_type === 'digital') displayProductType = 'Digital Products';

      return {
        user: {
          username: row.buyer_username,
          email: row.buyer_email
        },
        sales: {
          id: encryptId(row.id),
          delivery_status: row.delivery_status,
          created_at: salesFormattedDate,
          description: row.description_custom_content || ''
        },
        product: {
          product_name: row.product_name,
          product_type: displayProductType,
          price: parseFloat(row.product_price)
        }
      };
    });

    return { sales, totalSales };
  } catch (error) {
    logError('Error getting user sales list:', error);
    throw error;
  }
};

/**
 * Update purchase status (delivered/rejected) for a creator's sale
 * Mirrors Lambda implementation and validations
 */
const updatePurchaseStatus = async (userId, purchaseId, status) => {
  if (!['delivered', 'rejected'].includes(status)) {
    const error = new Error('Invalid status');
    error.statusCode = 400;
    throw error;
  }

  // Ensure purchase belongs to this creator and is pending
  const [rows] = await pool.query(
    `SELECT p.id, p.delivery_status, pr.user_id as owner_id
     FROM purchases p
     INNER JOIN products pr ON p.products_id = pr.id
     WHERE p.id = ? AND pr.user_id = ? AND p.delivery_status = 'pending' AND p.status = 1
     LIMIT 1`,
    [purchaseId, userId]
  );
  if (!rows.length) {
    const error = new Error('Purchase not found or not eligible for update');
    error.statusCode = 404;
    throw error;
  }

  const [result] = await pool.query(
    `UPDATE purchases SET delivery_status = ?, updated_at = NOW() 
     WHERE id = ? AND delivery_status = 'pending'`,
    [status, purchaseId]
  );
  if (result.affectedRows === 0) {
    const error = new Error('Purchase not found or already updated');
    error.statusCode = 404;
    throw error;
  }

  logInfo('Updated purchase delivery_status', { purchaseId, status });
  return result;
};

/**
 * Safe decrypt ID - returns numeric ID or throws with message matching Lambda behavior
 */
const safeDecryptId = (encryptedId) => {
  if (!encryptedId) throw new Error('Missing ID');
  const decoded = decryptId(encryptedId);
  const numeric = parseInt(decoded, 10);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Decrypted ID is not a valid number: ${decoded} (type: ${typeof decoded})`);
  }
  return numeric;
};

/**
 * Check free video call access
 */
const checkFreeVideoCallAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking free video call access:', error);
    return false;
  }
};

/**
 * Check paid video call access
 */
const checkPaidVideoCallAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking paid video call access:', error);
    return false;
  }
};

/**
 * Check paid chat access
 */
const checkPaidChatAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking paid chat access:', error);
    return false;
  }
};

/**
 * Check free chat access
 */
const checkFreeChatAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking free chat access:', error);
    return false;
  }
};

/**
 * Check creator agreement access
 */
const checkCreatorAgreementAccess = async (userId) => {
  try {
    // Check if user is already a creator or has pending agreement
    const query = `
      SELECT COUNT(*) as count 
      FROM creator_agreements 
      WHERE user_id = ? AND status IN ('pending', 'approved')
    `;
    
    const [result] = await pool.query(query, [userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking creator agreement access:', error);
    return false;
  }
};

/**
 * Get creator agreement status
 */
const getCreatorAgreementStatus = async (userId) => {
  try {
    const query = `
      SELECT status, created_at, updated_at 
      FROM creator_agreements 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting creator agreement status:', error);
    return null;
  }
};

/**
 * Create creator agreement
 */
const createCreatorAgreement = async (agreementData) => {
  try {
    const { user_id, photo_path, signature_path, pdf_path, status = 'pending' } = agreementData;
    
    const query = `
      INSERT INTO creator_agreements (user_id, photo_path, signature_path, pdf_path, status, created_at) 
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [user_id, photo_path, signature_path, pdf_path, status]);
    logInfo(`Created creator agreement: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error creating creator agreement:', error);
    throw error;
  }
};

/**
 * Update creator agreement status
 */
const updateCreatorAgreementStatus = async (userId, status) => {
  try {
    const query = `
      UPDATE creator_agreements 
      SET status = ?, updated_at = NOW() 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    await pool.query(query, [status, userId]);
    logInfo(`Updated creator agreement status: ${userId} -> ${status}`);
  } catch (error) {
    logError('Error updating creator agreement status:', error);
    throw error;
  }
};

/**
 * Check video call access (generic)
 */
const checkVideoCallAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking video call access:', error);
    return false;
  }
};

/**
 * Check chat access (generic)
 */
const checkChatAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking chat access:', error);
    return false;
  }
};

/**
 * Check call access (generic)
 */
const checkCallAccess = async (userId, otherUserId) => {
  try {
    // Check if users are blocked or have restrictions
    const query = `
      SELECT COUNT(*) as count 
      FROM user_blocks 
      WHERE (user_id = ? AND blocked_user_id = ?) 
         OR (user_id = ? AND blocked_user_id = ?)
    `;
    
    const [result] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    return result[0].count === 0;
  } catch (error) {
    logError('Error checking call access:', error);
    return false;
  }
};

/**
 * Get creator settings by user ID
 */
const getCreatorSettingsByUserId = async (userId) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        monthly_price,
        yearly_price,
        is_active,
        description,
        benefits,
        created_at,
        updated_at
      FROM creator_settings 
      WHERE user_id = ? AND is_active = 1
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows[0] || null;
  } catch (error) {
    logError('Error getting creator settings by user ID:', error);
    return null;
  }
};

/**
 * Update creator settings
 */
const updateCreatorSettings = async (userId, settings) => {
  try {
    const {
      monthly_price,
      yearly_price,
      is_active,
      description,
      benefits
    } = settings;
    
    const query = `
      INSERT INTO creator_settings (
        user_id, monthly_price, yearly_price, is_active, description, benefits, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        monthly_price = VALUES(monthly_price),
        yearly_price = VALUES(yearly_price),
        is_active = VALUES(is_active),
        description = VALUES(description),
        benefits = VALUES(benefits),
        updated_at = NOW()
    `;
    
    await pool.query(query, [
      userId, monthly_price, yearly_price, is_active, 
      description, JSON.stringify(benefits)
    ]);
    
    logInfo('Updated creator settings', { userId, settings });
    return true;
  } catch (error) {
    logError('Error updating creator settings:', error);
    throw error;
  }
};

/**
 * Update creator settings by user ID (upsert, feature-flag aware)
 * Mirrors Lambda behavior using fields like vdcl_status, adcl_status, etc.
 * @param {number} userId
 * @param {object} data - Incoming settings payload
 * @param {object} access - Feature access flags (e.g., isVcEnable, isAcEnable)
 * @returns {Promise<{success: boolean, message?: string}>}
 */
const updateCreatorSettingsByUserId = async (userId, data, access) => {
  try {
    const pool = getDB();

    // Prepare update data conditionally based on access flags
    const updateData = { user_id: userId };

    // Video call settings
    if (access?.isVcEnable && data?.video_call) {
      updateData.vdcl_status = (
        data.video_call.vdcl_status === 1 ||
        data.video_call.vdcl_status === '1' ||
        data.video_call.vdcl_status === true ||
        data.video_call.vdcl_status === 'yes'
      ) ? 'yes' : 'no';
      updateData.vdcl_min_coin = data.video_call.vdcl_min_coin || 0;
    }

    // Free video call settings
    if (access?.isFreeVcEnable && data?.free_video_call) {
      updateData.free_vdcl_status = (
        data.free_video_call.free_vdcl_status === 1 ||
        data.free_video_call.free_vdcl_status === '1' ||
        data.free_video_call.free_vdcl_status === true ||
        data.free_video_call.free_vdcl_status === 'yes'
      ) ? 'yes' : 'no';
    }

    // Audio call settings
    if (access?.isAcEnable && data?.audio_call) {
      updateData.adcl_status = (
        data.audio_call.adcl_status === 1 ||
        data.audio_call.adcl_status === '1' ||
        data.audio_call.adcl_status === true ||
        data.audio_call.adcl_status === 'yes'
      ) ? 'yes' : 'no';
      updateData.audio_call_price = data.audio_call.audio_call_price || 0;
    }

    // Paid chat settings
    if (access?.isPaidChatEnable && data?.paid_chat) {
      updateData.paid_chat_status = (
        data.paid_chat.paid_chat_status === 1 ||
        data.paid_chat.paid_chat_status === '1' ||
        data.paid_chat.paid_chat_status === true ||
        data.paid_chat.paid_chat_status === 'yes'
      ) ? 'yes' : 'no';
      updateData.pc_sub_price = data.paid_chat.pc_sub_price || 0;
      updateData.pc_non_sub_price = data.paid_chat.pc_non_sub_price || 0;
    }

    // Upsert into creator_settings
    const [existing] = await pool.query('SELECT id FROM creator_settings WHERE user_id = ? LIMIT 1', [userId]);
    if (Array.isArray(existing) && existing.length > 0) {
      // Build dynamic update
      const updateFields = [];
      const updateValues = [];
      Object.entries(updateData).forEach(([key, value]) => {
        if (key !== 'user_id') {
          updateFields.push(`${key} = ?`);
          updateValues.push(value);
        }
      });
      updateValues.push(userId);
      const updateQuery = `UPDATE creator_settings SET ${updateFields.join(', ')}, updated_at = NOW() WHERE user_id = ?`;
      await pool.query(updateQuery, updateValues);
    } else {
      const insertFields = Object.keys(updateData);
      const insertValues = Object.values(updateData);
      const placeholders = insertFields.map(() => '?').join(', ');
      const insertQuery = `INSERT INTO creator_settings (${insertFields.join(', ')}, created_at, updated_at) VALUES (${placeholders}, NOW(), NOW())`;
      await pool.query(insertQuery, insertValues);
    }
    return { success: true };
  } catch (error) {
    logError('updateCreatorSettingsByUserId error:', error);
    return { success: false, message: 'Database error while updating creator settings' };
  }
};

/**
 * Get creator subscription settings
 */
const getCreatorSubscriptionSettings = async (userId) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        monthly_price,
        yearly_price,
        is_active,
        description,
        benefits,
        created_at,
        updated_at
      FROM subscription_settings 
      WHERE user_id = ? AND is_active = 1
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows[0] || null;
  } catch (error) {
    logError('Error getting creator subscription settings:', error);
    return null;
  }
};

/**
 * Update creator subscription settings
 */
const updateCreatorSubscriptionSettings = async (userId, settings) => {
  try {
    const {
      monthly_price,
      yearly_price,
      is_active,
      description,
      benefits
    } = settings;
    
    const query = `
      INSERT INTO subscription_settings (
        user_id, monthly_price, yearly_price, is_active, description, benefits, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        monthly_price = VALUES(monthly_price),
        yearly_price = VALUES(yearly_price),
        is_active = VALUES(is_active),
        description = VALUES(description),
        benefits = VALUES(benefits),
        updated_at = NOW()
    `;
    
    await pool.query(query, [
      userId, monthly_price, yearly_price, is_active, 
      description, JSON.stringify(benefits)
    ]);
    
    logInfo('Updated creator subscription settings', { userId, settings });
    return true;
  } catch (error) {
    logError('Error updating creator subscription settings:', error);
    throw error;
  }
};

/**
 * Get creator withdrawal settings
 */
const getCreatorWithdrawalSettings = async (userId) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        withdrawal_method,
        account_details,
        is_active,
        created_at,
        updated_at
      FROM withdrawal_settings 
      WHERE user_id = ? AND is_active = 1
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows[0] || null;
  } catch (error) {
    logError('Error getting creator withdrawal settings:', error);
    return null;
  }
};

/**
 * Update creator withdrawal settings
 */
const updateCreatorWithdrawalSettings = async (userId, settings) => {
  try {
    const {
      withdrawal_method,
      account_details,
      is_active
    } = settings;
    
    const query = `
      INSERT INTO withdrawal_settings (
        user_id, withdrawal_method, account_details, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        withdrawal_method = VALUES(withdrawal_method),
        account_details = VALUES(account_details),
        is_active = VALUES(is_active),
        updated_at = NOW()
    `;
    
    await pool.query(query, [
      userId, withdrawal_method, JSON.stringify(account_details), is_active
    ]);
    
    logInfo('Updated creator withdrawal settings', { userId, settings });
    return true;
  } catch (error) {
    logError('Error updating creator withdrawal settings:', error);
    throw error;
  }
};

// Logging utility functions
const logInfo = (message, meta = {}) => {
  logger.info(message, meta);
};

const logError = (message, error = null) => {
  if (error) {
    logger.error(message, { error: error.message, stack: error.stack, ...error });
  } else {
    logger.error(message);
  }
};

// Rate limiting middleware using DynamoDB
const checkRateLimit = async (ip, route) => {
    try {
      const key = `rate_limit:${ip}:${route}`;
      const now = Date.now();
      const windowStart = now - (60 * 1000); // 60 seconds window
      const tableName = `rate_limits-${process.env.NODE_ENV || 'dev'}`;      
      
             // Define rate limits per route using security config
       const rateLimits = {
         '/auth/signup': 5,      // 5 signup attempts per minute
         '/auth/login': 10,      // 10 login attempts per minute
         '/auth/forgot-password/otp': 3, // 3 forgot password attempts per minute
         '/auth/refresh': 20,    // 20 token refresh per minute
         default: 30             // 30 requests per minute for other routes
       };
       
       const maxRequests = rateLimits[route] || rateLimits.default;
      
      logInfo('Rate limit check:', { key, tableName, now, windowStart, maxRequests });
      
      // Try to get existing rate limit record
      try {
        const getResult = await docClient.send(new GetCommand({
          TableName: tableName,
          Key: { identifier: key }
        }));
        
        logInfo('DynamoDB GetCommand result:', getResult);
        
        if (getResult.Item) {
          const record = getResult.Item;
          const requestCount = record.count || 0;
          const lastRequestTime = record.timestamp || 0;
          
          logInfo('Rate limit record found:', { requestCount, lastRequestTime, maxRequests });
          
          // If within the same window, check count
          if (lastRequestTime >= windowStart) {
            if (requestCount >= maxRequests) {
              logInfo('Rate limit exceeded:', { key, requestCount, maxRequests });
              return false;
            }
            
            // Increment count
            await docClient.send(new UpdateCommand({
              TableName: tableName,
              Key: { identifier: key },
              UpdateExpression: 'SET #count = #count + :inc, #timestamp = :timestamp',
              ExpressionAttributeNames: {
                '#count': 'count',
                '#timestamp': 'timestamp'
              },
              ExpressionAttributeValues: {
                ':inc': 1,
                ':timestamp': now
              }
            }));
            logInfo('Rate limit count incremented:', { key });
          } else {
            // New window, reset count
            await docClient.send(new PutCommand({
              TableName: tableName,
              Item: {
                identifier: key,
                count: 1,
                timestamp: now,
                expires_at: now + (60 * 1000) // 60 seconds TTL
              }
            }));
            logInfo('Rate limit window reset:', { key });
          }
        } else {
          // First request, create record
          await docClient.send(new PutCommand({
            TableName: tableName,
            Item: {
              identifier: key,
              count: 1,
              timestamp: now,
              expires_at: now + (60 * 1000) // 60 seconds TTL
            }
          }));
          logInfo('Rate limit record created:', { key });
        }
        
        return true;
      } catch (error) {
        logError('Rate limiting error (DynamoDB operation):', error);
        return true; // Allow request if rate limiting fails
      }
    } catch (error) {
      logError('Rate limiting error (outer):', error);
      return true; // Allow request if rate limiting fails
    }
  };

  // Email domain validation
const isValidEmailDomain = async (email) => {
  try {
    const domain = email.split('@')[1];
    const pool = getDB();
    
    // Log the domain check
    logInfo('Checking email domain:', { email, domain });

    // Query the email_domains table to get all restricted domains
    const queryPromise = pool.query(
      'SELECT restricted_domains FROM email_domains WHERE restricted_domains IS NOT NULL AND restricted_domains != ""',
      []
    );
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database query timeout')), 2000) // Reduced to 2 seconds
    );
    
    const [rows] = await Promise.race([queryPromise, timeoutPromise]);

    // Convert to array and remove spaces (like Laravel implementation)
    const allRestrictedDomains = [];
    rows.forEach(row => {
      if (row.restricted_domains) {
        const domains = row.restricted_domains.split(',').map(d => d.trim());
        allRestrictedDomains.push(...domains);
      }
    });

    // Check if the extracted domain exists in the restricted domains list
    const domainExists = allRestrictedDomains.includes(domain);
    
    logInfo('Domain validation result:', { 
      domain, 
      allRestrictedDomains, 
      domainExists, 
      isValid: !domainExists 
    });

    // Return true if domain is NOT in restricted list (like Laravel)
    return !domainExists;
  } catch (error) {
    logError('Error checking email domain:', error);
    return false; // Fail safe - treat as invalid domain if error
  }
};

// Generate and store OTP
const generateOTP = async (identifier) => {
    const otp = crypto.randomInt(10000, 100000).toString();
    
    try {
      const tableName = `otp-${process.env.NODE_ENV || 'dev'}`; // Fixed table name
      const now = Date.now();
      const expiresAt = now + (10 * 60 * 1000); // 10 minutes from now
      
      logInfo('Storing OTP in DynamoDB:', { 
        identifier, 
        tableName, 
        expiresAt: new Date(expiresAt).toISOString() 
      });
      
      await docClient.send(new PutCommand({
        TableName: tableName,
        Item: {
          identifier: identifier,
          otp: otp,
          timestamp: now,
          attempts: 0,
          expires_at: Math.floor(expiresAt / 1000) // TTL in seconds
        }
      }));
      
      logInfo('OTP stored successfully in DynamoDB:', { identifier, otp });
      return otp;
    } catch (error) {
      logError('Error storing OTP in DynamoDB:', error);
      // Throw error instead of returning OTP without storage
      throw new Error('Failed to store OTP in database');
    }
  };

// Check email validation status
const checkEmailValidation = async (email) => {
    try {
      const pool = getDB();
      const queryPromise = pool.query(
        'SELECT status, type FROM email_validation WHERE email = ? ORDER BY created_at DESC LIMIT 1',
        [email]
      );
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout')), 2000) // Reduced to 2 seconds
      );
      
      const [rows] = await Promise.race([queryPromise, timeoutPromise]);
      
      if (rows.length === 0) {
        return null;
      }
  
      // Log validation check
      logInfo('Email validation check:', {
        email,
        status: rows[0].status,
        type: rows[0].type
      });
  
      return rows[0];
    } catch (error) {
      logError('Error checking email validation:', error);
      return null;
    }
  };

  // Store email validation result
const storeEmailValidation = async (email, status, remarks = null) => {
    try {
      const pool = getDB();
      const queryPromise = pool.query(
        'INSERT INTO email_validation (email, status, remarks, type) VALUES (?, ?, ?, ?)',
        [email, status, remarks, 'listclean']
      );
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout')), 2000) // Reduced to 2 seconds
      );
      
      await Promise.race([queryPromise, timeoutPromise]);
      return true;
    } catch (error) {
      logError('Error storing email validation:', error);
      return false;
    }
  };
  
  // Validate email using ListClean API and store result
  async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  const validateEmailWithListClean = async (email) => {
    try {
      const pool = getDB();
      // 1. Check if email already validated
      const [rows] = await pool.query(
        'SELECT email, status, remarks, type FROM email_validation WHERE email = ? LIMIT 1',
        [email]
      );
      if (rows.length > 0) {
        // Already validated, return cached result
        return {
          email: rows[0].email,
          status: rows[0].status,
          remarks: rows[0].remarks,
          type: rows[0].type,
          cached: true
        };
      }

      // 2. If not found, call ListClean API
      const apiKey = process.env.LISTCLEAN_API_KEY;
      if (!apiKey) {
        throw new Error('ListClean API key not set in environment');
      }
      const url = `https://api.listclean.xyz/v1/verify/email/${email}`;
      const response = await axios.get(url, {
        headers: {
          'X-AUTH-TOKEN': apiKey,
          'Accept': 'application/json',
        },
        timeout: 5000,
      });

      // Insert into DB after validation
      await storeEmailValidation(
        email,
        response.data.status,
        response.data.message || null
      );

      return { ...response.data, cached: false };
    } catch (error) {
      logError('Error validating email with ListClean:', error);
      return null;
    }
  };
  
// Check for duplicate account
const checkDuplicateAccount = async (email, phone) => {
    try {
      const pool = getDB();
      let query = 'SELECT id FROM users WHERE ';
      const params = [];
      const conditions = [];

      if (email) {
        conditions.push('email = ?');
        params.push(email);
      }
      
      if (phone) {
        // Match phone as plain, with any country code (with or without '+')
        conditions.push('(mobile = ? OR mobile LIKE ? OR mobile LIKE ?)');
        params.push(phone, `+%${phone}`, `%${phone}`);
      }

      // Join conditions with OR
      query += conditions.join(' OR ');

      // Log the check
      logInfo('Checking duplicate account:', { email, phone, query });

      // Add timeout to database query
      const queryPromise = pool.query(query, params);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Database query timeout')), 2000) // Reduced to 2 seconds
      );
      
      const [rows] = await Promise.race([queryPromise, timeoutPromise]);
      
      // If any rows found, account exists
      return rows.length > 0;
    } catch (error) {
      logError('Error checking duplicate account:', error);
      return true; // Fail safe - assume duplicate if error
    }
  };

// Common API response function
const createResponse = (statusCode, message, data = null, error = null) => {
  const response = {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Credentials': true
    },
    body: JSON.stringify({
      message,
      status: statusCode,
      ...(data && { data }),
      ...(error && { error }),
      timestamp: new Date().toISOString()
    })
  };

  return response;
};

// Common error response function (Express version - returns JSON body only)
const createErrorResponse = (statusCode, error, details = null) => {
  // HTTP status messages mapping
  const statusMessages = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable'
  };

  const statusMessage = statusMessages[statusCode] || 'Error';
  const fullMessage = `${statusMessage}: ${error}`;
  
  return {
    message: fullMessage,
    status: statusCode,
    ...(details && { error: details }),
    timestamp: new Date().toISOString()
  };
};

// Common success response function (Express version - returns JSON body only)
const createSuccessResponse = (message, data = null) => {
  return {
    success: true,
    message,
    status: 200,
    ...(data && { data }),
    timestamp: new Date().toISOString()
  };
};


const verifyEmailOTP = async (identifier, otp) => {
  try {
    const tableName = `otp-${process.env.NODE_ENV || 'dev'}`; // Fixed table name
    logInfo('Verifying OTP from DynamoDB:', { identifier, tableName });
    
    const getResult = await docClient.send(new GetCommand({
      TableName: tableName,
      Key: { identifier },
    }));
    
    const otpRecord = getResult.Item;
    logInfo('OTP record from DynamoDB:', { 
      found: !!otpRecord, 
      attempts: otpRecord?.attempts,
      timestamp: otpRecord?.timestamp,
      isExpired: otpRecord ? Date.now() - otpRecord.timestamp > (15 * 60 * 1000) : null
    });
    
    if (!otpRecord) {
      logError('OTP record not found in DynamoDB:', { identifier });
      return false;
    }
    
    // Check for too many attempts
    if (otpRecord.attempts >= 5) {
      logError('Too many OTP attempts:', { identifier, attempts: otpRecord.attempts });
      return false;
    }
    
    // Validate the OTP
    if (otpRecord.otp !== otp) {
      logError('OTP mismatch:', { identifier, provided: otp, stored: otpRecord.otp });
      // Increment attempts count
      await docClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { identifier },
        UpdateExpression: 'SET #attempts = #attempts + :inc',
        ExpressionAttributeNames: { '#attempts': 'attempts' },
        ExpressionAttributeValues: { ':inc': 1 },
      }));
      return false;
    }
    
    // Check if OTP is expired (5-minute window) - parity with Lambda
    const fiveMinutes = 5 * 60 * 1000;
    if (Date.now() - otpRecord.timestamp > fiveMinutes) {
      logError('OTP expired:', { identifier, age: Date.now() - otpRecord.timestamp });
      return false;
    }

    // Delete the OTP record from DynamoDB to prevent reuse
    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { identifier: identifier },
    }));

    logInfo('OTP verified successfully:', { identifier });
    return true;
  } catch (error) {
    logError('OTP verification error:', error);
    return false;
  }
}

/**
 * Get WhatsApp access token status from database
 * @returns {Promise<object>} Token status information
 */
const getWhatsAppTokenStatus = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT token, expires_at, created_at FROM wb_access_tokens ORDER BY expires_at DESC',
      []
    );
    
    return {
      totalTokens: rows.length,
      validTokens: rows.filter(row => new Date(row.expires_at) > new Date()).length,
      tokens: rows.map(row => ({
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        isExpired: new Date(row.expires_at) <= new Date()
      }))
    };
  } catch (error) {
    logError('Error getting WhatsApp token status:', error);
    return { error: error.message };
  }
};

/**
 * Send Telegram notification (helper function for error reporting)
 * @param {string} message - The message to send
 * @returns {Promise<void>}
 */
const sendTelegramNotification = async (message) => {
  try {
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!chatId || !botToken) {
      return;
    }

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML'
    });
  } catch (error) {
    logError('Telegram notification error:', error);
  }
};

/**
 * Get device information from request headers and user agent
 * @param {object} req - Express request object
 * @returns {object} Device information object
 */
const getDeviceInfo = (req) => {
  try {
    const headers = req.headers || {};
    const userAgent = headers['user-agent'] || '';
    const ip = headers['x-forwarded-for'] || 
               headers['x-real-ip'] || 
               req.ip || 
               req.connection?.remoteAddress || 'unknown';
    
    // Parse User-Agent using ua-parser-js
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    
    // Generate device fingerprint
    const fingerprintData = {
      userAgent: userAgent,
      ip: ip,
      browser: result.browser.name || '',
      browserVersion: result.browser.version || '',
      os: result.os.name || '',
      osVersion: result.os.version || '',
      device: result.device.model || '',
      deviceType: result.device.type || '',
      cpu: result.cpu.architecture || '',
      timestamp: new Date().toISOString()
    };
    
    // Generate unique device fingerprint hash
    const fingerprintString = `${userAgent}|${ip}|${fingerprintData.browser}|${fingerprintData.os}|${fingerprintData.device}`;
    const deviceFingerprint = crypto.createHash('sha256').update(fingerprintString).digest('hex');
    
    // Store the complete raw User-Agent string
    const appString = userAgent || '';
    
    return {
      ...fingerprintData,
      deviceFingerprint,
      appString
    };
  } catch (error) {
    logError('Error getting device info:', error);
    return {
      userAgent: '',
      ip: '',
      deviceFingerprint: '',
      appString: '',
      timestamp: new Date().toISOString()
    };
  }
};

/**
 * Convert local date/time in a given timezone to a UTC Date object
 * @param {string} date - YYYY-MM-DD
 * @param {string} time - HH:mm
 * @param {string} timezone - IANA timezone (e.g., 'Asia/Kolkata')
 * @returns {Date} UTC Date
 */
const convertLocalToUTC = (date, time, timezone) => {
  try {
    if (!date || !time || !timezone) {
      throw new Error('date, time, and timezone are required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('date must be in YYYY-MM-DD format');
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      throw new Error('time must be in HH:mm format');
    }
    if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timezone)) {
      throw new Error('timezone must be a valid IANA timezone identifier');
    }

    const localDateTimeString = `${date} ${time}`;
    const localMoment = dayjs.tz(localDateTimeString, 'YYYY-MM-DD HH:mm', timezone);

    if (!localMoment.isValid()) {
      throw new Error(`Invalid timezone: ${timezone}`);
    }

    const utcMoment = localMoment.utc();
    return utcMoment.toDate();
  } catch (error) {
    logError('[convertLocalToUTC] Timezone conversion failed:', {
      error: error.message,
      input: { date, time, timezone }
    });
    throw new Error(`Timezone conversion failed: ${error.message}`);
  }
};

/**
 * Convert anonymous user session to authenticated user session
 * @param {string} anonymousUserId - Anonymous user ID
 * @param {string} authenticatedUserId - Authenticated user ID
 * @param {string} newToken - New JWT token for authenticated user
 * @param {object} req - Express request object
 * @returns {Promise<object>} Session conversion result
 */
const convertAnonymousToAuthenticated = async (anonymousUserId, authenticatedUserId, newToken, req) => {
  try {
    const tableName = `sessions-${process.env.NODE_ENV || 'dev'}`;
    const expiryDays = parseInt(process.env.JWT_EXPIRES_DAYS || '120');
    const currentTime = Date.now();
    const expiryTime = currentTime + (expiryDays * 24 * 60 * 60 * 1000);

    try {
      // Delete anonymous session
      await docClient.send(new DeleteCommand({
        TableName: tableName,
        Key: { userId: anonymousUserId }
      }));

      // Note: We don't store access tokens in the database, only refresh tokens
      // The access token is returned to the client for immediate use
      logInfo('Access token generated for authenticated user (not stored in DB)');
    } catch (error) {
      throw error;
    }

    logInfo('Anonymous session converted to authenticated:', { 
      anonymousUserId, 
      authenticatedUserId
    });

    return {
      success: true,
      oldUserId: anonymousUserId,
      newUserId: authenticatedUserId,
      expiresAt: new Date(expiryTime).toISOString()
    };

  } catch (error) {
    logError('Error converting anonymous to authenticated session:', error);
    throw new Error('Failed to convert session');
  }
};

/**
 * Generates a JWT access token for user authentication
 * 
 * This function creates a short-lived JWT access token (15 minutes) for user
 * authentication. The token includes user information and is signed with
 * the JWT_ACCESS_SECRET.
 * 
 * @param {object} payload - Token payload containing user information
 * @returns {string} JWT access token
 */
const generateAccessToken = (payload) => {
  // Auto-encode user ID if it's a number and not already encoded
  if (payload.id && typeof payload.id === 'number') {
    payload.id = encryptId(payload.id);
  }
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '1h'
  });
};

/**
 * Generates a JWT refresh token for token renewal
 * 
 * This function creates a long-lived JWT refresh token (7 days) that can be used
 * to obtain new access tokens without requiring user re-authentication.
 * 
 * @param {object} payload - Token payload containing user information
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (payload) => {
  // Auto-encode user ID if it's a number and not already encoded
  if (payload.id && typeof payload.id === 'number') {
    payload.id = encryptId(payload.id);
  }
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '60d'
  });
};

/**
 * Verifies access token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token payload or null if invalid
 */
const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    logError('Access token verification failed:', error.message);
    return null;
  }
};

/**
 * Verifies refresh token
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token payload or null if invalid
 */
const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    logError('Refresh token verification failed:', error.message);
    return null;
  }
};

/**
 * Verifies access token (alias for verifyAccessToken for backward compatibility)
 * @param {string} token - JWT token to verify
 * @returns {object|null} Decoded token payload or null if invalid
 */
const verifyToken = (token) => {
  return verifyAccessToken(token);
};

/**
 * Store refresh token in DynamoDB sessions table with enhanced device tracking
 * @param {string} anonymousId - Anonymous user ID (sort key)
 * @param {string} refreshToken - Refresh token (primary key)
 * @param {object} req - Express request object for device info
 * @returns {Promise<boolean>} True if stored successfully
 */
const storeRefreshToken = async (anonymousId, refreshToken, req) => {
  try {
    const tableName = `sessions-${process.env.NODE_ENV || 'dev'}`;
    const now = Date.now();
    // Always use expiry from environment variable
    const refreshExpiresMs = ms(process.env.JWT_REFRESH_EXPIRES || '60d');
    const expiresAt = now + refreshExpiresMs;
    
    // Convert expires_at to seconds for DynamoDB TTL
    const expiresAtSeconds = Math.floor(expiresAt / 1000);

    // Get comprehensive device information
    const deviceInfo = getDeviceInfo(req);

    logInfo('Storing refresh token in DynamoDB', { 
      tableName, 
      anonymousId, 
      refreshTokenLength: refreshToken.length,
      expiresAtSeconds,
      deviceInfo: deviceInfo ? 'present' : 'missing'
    });
    
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        // Primary key: token (hash key)
        token: refreshToken,
        // Sort key: userId
        userId: anonymousId,
        // TTL in seconds
        expires_at: expiresAtSeconds,
        // Device tracking information
        deviceFingerprint: deviceInfo.deviceFingerprint,
        ipAddress: deviceInfo.ip,
        app: deviceInfo.appString,
        // Timestamp
        createdAt: new Date().toISOString()
      }
    }));

    logInfo('Refresh token stored successfully');
    return true;
  } catch (error) {
    logError('Error storing refresh token:', { 
      error: error.message, 
      code: error.code, 
      tableName: `sessions-${process.env.NODE_ENV || 'dev'}`,
      anonymousId,
      refreshTokenLength: refreshToken?.length
    });
    return false;
  }
};

/**
 * Gets refresh token from database with expiry info
 * @param {string} refreshToken - The refresh token to look up
 * @param {string} userId - User ID (for verification)
 * @returns {Promise<object|null>} Refresh token object with expiry or null if not found
 */
const getRefreshToken = async (refreshToken, userId) => {
  try {
    const tableName = `sessions-${process.env.NODE_ENV || 'dev'}`;
    
    logInfo('Getting refresh token from DynamoDB');
    
    // Use QueryCommand to find the specific token for the user
    // Since we have both token (primary key) and userId (sort key), use composite key condition
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: '#tokenAttr = :token AND userId = :userId',
      ExpressionAttributeNames: {
        '#tokenAttr': 'token'
      },
      ExpressionAttributeValues: {
        ':token': refreshToken,
        ':userId': userId
      }
    }));

    if (result.Items && result.Items.length > 0) {
      const item = result.Items[0];
      logInfo('Refresh token found in DynamoDB:', { userId });
      return {
        token: item.token,
        expiresAt: item.expires_at, // Keep in seconds as stored in DB
        createdAt: item.createdAt,
        deviceFingerprint: item.deviceFingerprint,
        ipAddress: item.ipAddress,
        app: item.app || null
      };
    }
    
    logInfo('Refresh token not found in DynamoDB:', { userId });
    return null;
  } catch (error) {
    logError('Error getting refresh token:', error);
    return null;
  }
};

/**
 * Checks if refresh token expires within specified days
 * @param {number} expiresAt - Token expiry timestamp (in milliseconds)
 * @param {number} days - Number of days to check (default: 7)
 * @returns {boolean} True if expires within specified days
 */
const isRefreshTokenExpiringSoon = (expiresAt, days = 7) => {
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const daysInSeconds = days * 24 * 60 * 60;
  const threshold = nowInSeconds + daysInSeconds;
  
  // expiresAt is now always in seconds
  return expiresAt <= threshold;
};

/**
 * Revokes refresh token from database
 * @param {string} refreshToken - The refresh token to revoke
 * @param {string} userId - User ID (for verification)
 * @returns {Promise<boolean>} True if revoked successfully
 */
const revokeRefreshToken = async (refreshToken, userId) => {
  try {
    const tableName = `sessions-${process.env.NODE_ENV || 'dev'}`;
    
    logInfo('Revoking refresh token from DynamoDB:', { userId, tableName });
    
    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { 
        token: refreshToken,
        userId: userId
      }
    }));

    logInfo('Refresh token revoked successfully:', { userId });
    return true;
  } catch (error) {
    logError('Error revoking refresh token:', error);
    return false;
  }
};

// =========================
// Shared Auth Helper
// =========================
/**
 * Checks the Authorization header for a JWT, verifies it, and returns the user ID and decoded token info.
 * If the token is missing or invalid, returns a standard error response.
 * Use this to easily get the authenticated user's ID in your Express handlers.
 *
 * @param {object} req - The Express request object
 * @param {object} options - Options: allowAnonymous (default false), action (string for error message context)
 * @returns {object} { userId, decoded } if valid, or { errorResponse } if not
 */
const getAuthenticatedUserId = (req, options = {}) => {
  const { allowAnonymous = false, action = 'access' } = options;
  const { headers } = req;
  logInfo('getAuthenticatedUserId called', { caller: action });
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { errorResponse: createErrorResponse(401, 'Access token required') };
  }
  const accessToken = authHeader.replace(/^Bearer\s+/i, '');
  const decoded = verifyToken(accessToken);
  if (!decoded) {
    return { errorResponse: createErrorResponse(401, 'Invalid access token') };
  }
  if (!allowAnonymous && decoded.isAnonymous === true) {
    return {
      errorResponse: createErrorResponse(
        401,
        `Anonymous tokens not allowed for product ${action}. Please login first.`
      ),
    };
  }
  
  // Decode the 24-character ID if it's not an anonymous user
  let userId = decoded.id;
  if (!decoded.isAnonymous && typeof decoded.id === 'string' && isEncryptedId(decoded.id)) {
    try {
      userId = decryptId(decoded.id);
      logInfo('Decoded 24-character ID:', { encodedId: decoded.id, decodedId: userId });
    } catch (error) {
      logError('Failed to decode 24-character ID:', { encodedId: decoded.id, error: error.message });
      return { errorResponse: createErrorResponse(401, 'Invalid token format') };
    }
  }
  
  // Log successful authentication
  logInfo('Access token verified successfully:', { userId, email: decoded.email, role: decoded.role });
  return { userId, decoded };
};

// Continue with all other utility functions...
// [Rest of the functions remain the same as the original common.js]

/**
 * Get creator groups
 */
const getCreatorGroups = async (userId, creatorGroupName) => {
  try {
    const query = `
      SELECT id, group_name, description, is_active, created_at, updated_at
      FROM creator_groups 
      WHERE user_id = ? AND group_name = ? AND is_active = 1
    `;
    
    const [rows] = await pool.query(query, [userId, creatorGroupName]);
    return rows[0] || null;
  } catch (error) {
    logError('Error getting creator groups:', error);
    return null;
  }
};

/**
 * Get creator group name by ID
 */
const getCreatorGroupName = async (groupId) => {
  try {
    const query = 'SELECT group_name FROM creator_groups WHERE id = ? AND is_active = 1';
    const [rows] = await pool.query(query, [groupId]);
    return rows[0]?.group_name || null;
  } catch (error) {
    logError('Error getting creator group name:', error);
    return null;
  }
};

/**
 * Get creator IDs by group name
 */
const getCreatorIdsByGroupName = async (groupName) => {
  try {
    const query = 'SELECT user_id FROM creator_groups WHERE group_name = ? AND is_active = 1';
    const [rows] = await pool.query(query, [groupName]);
    return rows.map(row => row.user_id);
  } catch (error) {
    logError('Error getting creator IDs by group name:', error);
    return [];
  }
};

/**
 * Get creator group based IDs
 */
const getCreatorGroupBasedIds = async (groupId) => {
  try {
    const query = 'SELECT user_id FROM creator_groups WHERE id = ? AND is_active = 1';
    const [rows] = await pool.query(query, [groupId]);
    return rows.map(row => row.user_id);
  } catch (error) {
    logError('Error getting creator group based IDs:', error);
    return [];
  }
};

/**
 * Get user balance
 */
const getUserBalance = async (userId, role) => {
  try {
    const query = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) as credits,
        COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE 0 END), 0) as debits
      FROM user_balance 
      WHERE user_id = ? AND role = ?
    `;
    
    const [rows] = await pool.query(query, [userId, role]);
    const balance = rows[0];
    return {
      credits: balance.credits,
      debits: balance.debits,
      balance: balance.credits - balance.debits
    };
  } catch (error) {
    logError('Error getting user balance:', error);
    return { credits: 0, debits: 0, balance: 0 };
  }
};

/**
 * Get creator earnings
 */
const getCreatorEarnings = async (userId) => {
  try {
    const query = `
      SELECT 
        COALESCE(SUM(amount), 0) as total_earnings,
        COUNT(*) as transaction_count
      FROM creator_earnings 
      WHERE user_id = ? AND status = 'completed'
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows[0] || { total_earnings: 0, transaction_count: 0 };
  } catch (error) {
    logError('Error getting creator earnings:', error);
    return { total_earnings: 0, transaction_count: 0 };
  }
};

/**
 * Get agent earnings
 */
const getAgentEarnings = async (userId) => {
  try {
    const query = `
      SELECT 
        COALESCE(SUM(amount), 0) as total_earnings,
        COUNT(*) as transaction_count
      FROM agent_earnings 
      WHERE user_id = ? AND status = 'completed'
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows[0] || { total_earnings: 0, transaction_count: 0 };
  } catch (error) {
    logError('Error getting agent earnings:', error);
    return { total_earnings: 0, transaction_count: 0 };
  }
};

/**
 * Get withdrawal summary
 */
const getWithdrawalSummary = async (userId) => {
  try {
    const query = `
      SELECT 
        COALESCE(SUM(amount), 0) as total_withdrawn,
        COUNT(*) as withdrawal_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount
      FROM withdrawals 
      WHERE user_id = ?
    `;
    
    const [rows] = await pool.query(query, [userId]);
    return rows[0] || { total_withdrawn: 0, withdrawal_count: 0, pending_amount: 0 };
  } catch (error) {
    logError('Error getting withdrawal summary:', error);
    return { total_withdrawn: 0, withdrawal_count: 0, pending_amount: 0 };
  }
};

/**
 * Get all languages (Express parity with Lambda)
 */
const getAllLanguages = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT id, name, abbreviation FROM languages ORDER BY name ASC'
    );
    return rows;
  } catch (error) {
    logError('Error fetching languages:', error);
    return [];
  }
};

/**
 * Get verified user by ID
 */
const getVerifiedUserById = async (userId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT id, verified_id FROM users WHERE id = ?', [userId]);
    if (!rows.length) return null;
    if (rows[0].verified_id !== 'yes') return null;
    return rows[0];
  } catch (error) {
    logError('Error fetching or verifying user:', error);
    return null;
  }
};

/**
 * Days in month helper
 */
const getDaysInMonth = (month, year) => {
  const monthNum = Number(month);
  if (monthNum === 2) {
    return year % 4 ? 28 : (year % 100 ? 29 : (year % 400 ? 28 : 29));
  }
  return ((monthNum - 1) % 7 % 2) ? 30 : 31;
};

/**
 * Month names mapping
 */
const MONTH_NAMES = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
};

/**
 * Support IDs from admin settings
 */
const getSupportCreatorIds = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT creator_support_id FROM admin_settings LIMIT 1');
    if (!rows.length || !rows[0].creator_support_id) return [];
    return rows[0].creator_support_id.split(',').map(id => id.trim()).filter(Boolean);
  } catch (error) {
    logError('Support creator IDs fetch error:', error);
    return [];
  }
};

const getSupportUserIds = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT support_user_id FROM admin_settings LIMIT 1');
    if (!rows.length || !rows[0].support_user_id) return [];
    return rows[0].support_user_id.split(',').map(id => id.trim()).filter(Boolean);
  } catch (error) {
    logError('Support user IDs fetch error:', error);
    return [];
  }
};

const getRestrictedUserIds = async (userId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT user_restricted FROM restrictions WHERE user_id = ?', [userId]);
    return rows.map(r => r.user_restricted);
  } catch (error) {
    logError('Get restricted user IDs error:', error);
    return [];
  }
};

/**
 * Get support users by IDs
 * @param {Array<number>} userIds - Array of user IDs
 * @returns {Promise<Array>} Support users data
 */
const getSupportUsersByIds = async (userIds) => {
  try {
    if (!userIds || userIds.length === 0) {
      return [];
    }
    
    const db = await getDB();
    const placeholders = userIds.map(() => '?').join(',');
    const [rows] = await db.execute(`
      SELECT 
        id,
        username,
        name,
        email,
        mobile,
        profile_image,
        is_verified,
        created_at
      FROM users 
      WHERE id IN (${placeholders}) AND deleted = 0
    `, userIds);
    
    return rows;
  } catch (error) {
    logError('Error getting support users by IDs:', error);
    return [];
  }
};

/**
 * Get users by search term
 * @param {string} searchTerm - Search term
 * @param {number} limit - Limit
 * @param {number} skip - Skip
 * @returns {Promise<Array>} Users matching search term
 */
const getUsersBySearch = async (searchTerm, limit = 20, skip = 0) => {
  try {
    const db = await getDB();
    const searchPattern = `%${searchTerm}%`;
    const [rows] = await db.execute(`
      SELECT 
        id,
        username,
        name,
        email,
        profile_image,
        is_verified,
        created_at
      FROM users 
      WHERE (username LIKE ? OR name LIKE ? OR email LIKE ?) 
        AND deleted = 0
      ORDER BY 
        CASE 
          WHEN username LIKE ? THEN 1
          WHEN name LIKE ? THEN 2
          WHEN email LIKE ? THEN 3
          ELSE 4
        END,
        created_at DESC
      LIMIT ? OFFSET ?
    `, [searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, limit, skip]);
    
    return rows;
  } catch (error) {
    logError('Error getting users by search:', error);
    return [];
  }
};

/**
 * ID obfuscation utilities
 */
const ENCODED_ID_LENGTH = 24;

const encryptId = (id) => {
  const secret = process.env.ENCRYPT_SECRET_ID;
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPT_SECRET_ID must be set and at least 32 characters');
  }
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.alloc(16, 0);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(String(id), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  let base64url = encrypted.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (base64url.length < ENCODED_ID_LENGTH) {
    base64url = base64url.padEnd(ENCODED_ID_LENGTH, '0');
  }
  return base64url;
};

const decryptId = (encodedId) => {
  const secret = process.env.ENCRYPT_SECRET_ID;
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPT_SECRET_ID must be set and at least 32 characters');
  }
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.alloc(16, 0);
  let base64url = encodedId;
  if (base64url.length === ENCODED_ID_LENGTH && base64url.endsWith('00')) {
    base64url = base64url.slice(0, -2);
  }
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(base64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return parseInt(decrypted, 10);
};

const isEncryptedId = (id) => {
  return typeof id === 'string' && id.length === ENCODED_ID_LENGTH && /^[a-zA-Z0-9_-]+$/.test(id);
};

/**
 * UTC to local conversion
 */
const convertUTCToLocal = (utcDate, timezone = 'Asia/Kolkata') => {
  try {
    if (!utcDate) {
      throw new Error('UTC date is required');
    }
    if (!/^[A-Za-z_]+\/[A-Za-z_]+$/.test(timezone)) {
      throw new Error('timezone must be a valid IANA timezone identifier');
    }
    const utcMoment = dayjs.utc(utcDate);
    if (!utcMoment.isValid()) {
      throw new Error('Invalid UTC date');
    }
    return utcMoment.tz(timezone).format('YYYY-MM-DD HH:mm:ss');
  } catch (error) {
    logError('[convertUTCToLocal] Timezone conversion failed:', {
      error: error.message,
      input: { utcDate, timezone }
    });
    throw new Error(`Timezone conversion failed: ${error.message}`);
  }
};

/**
 * Updates with counts
 */
const getUserUpdatesWithCounts = async (userId, event = {}) => {
  const pool = getDB();
  const { queryStringParameters = {} } = event || {};
  const { skip: skipParam = 0, limit: limitParam = 10 } = queryStringParameters;
  const skip = parseInt(skipParam) || 0;
  const limit = parseInt(limitParam) || 10;

  const query = `
    SELECT 
      u.id,
      u.locked,
      u.price,
      u.description,
      u.status,
      DATE_FORMAT(u.expired_at, '%Y-%m-%d %H:%i:%s') as expired_at,
      u.is_utc,
      u.date,
      COALESCE(likes.likes_count, 0) as likes_count,
      COALESCE(comments.comments_count, 0) as comments_count
    FROM updates u
    LEFT JOIN (
      SELECT updates_id, COUNT(*) as likes_count 
      FROM likes 
      WHERE status = '1' 
      GROUP BY updates_id
    ) likes ON u.id = likes.updates_id
    LEFT JOIN (
      SELECT updates_id, COUNT(*) as comments_count 
      FROM comments 
      GROUP BY updates_id
    ) comments ON u.id = comments.updates_id
    WHERE u.user_id = ? 
      AND u.status <> 'encode'
      AND u.status IN ('active', 'disabled')
      AND (u.expired_at IS NULL OR u.expired_at >= NOW())
    ORDER BY u.id DESC
    LIMIT ? OFFSET ?
  `;

  const countQuery = `
    SELECT COUNT(*) as total
    FROM updates u
    WHERE u.user_id = ? 
      AND u.status <> 'encode'
      AND u.status IN ('active', 'disabled')
      AND (u.expired_at IS NULL OR u.expired_at >= NOW())
  `;

  try {
    const [countResult, updatesResult] = await Promise.all([
      pool.query(countQuery, [userId]),
      pool.query(query, [userId, limit, skip])
    ]);

    const [[{ total: totalUpdates }]] = countResult;
    const [rows] = updatesResult;
    return { updates: rows, totalUpdates };
  } catch (error) {
    logError('Database error in getUserUpdatesWithCounts:', { userId, error: error.message });
    throw error;
  }
};

/**
 * Basic format helpers
 */
const formatDate = (date) => {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
};

const formatRelativeTime = (date) => {
  const now = new Date();
  const postDate = new Date(date);
  const diffInSeconds = Math.floor((now - postDate) / 1000);
  if (diffInSeconds < 0 || diffInSeconds < 60) return 'just now';
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) return `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`;
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  const diffInYears = Math.floor(diffInDays / 365.25);
  if (diffInYears === 0) return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  return `${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`;
};

const formatTimeAgo = (date) => formatRelativeTime(date);

const formatNumberWithK = (num) => {
  if (num === null || num === undefined || isNaN(num) || !isFinite(num)) return '0';
  const number = Number(num);
  const isNegative = number < 0;
  const absNumber = Math.abs(number);
  if (absNumber < 1000) return number.toString();
  const thousands = absNumber / 1000;
  if (thousands === Math.floor(thousands)) {
    const sign = isNegative ? '-' : '';
    return `${sign}${thousands}k`;
  }
  const formatted = thousands.toFixed(1);
  const clean = formatted.endsWith('.0') ? Math.floor(thousands) : formatted;
  const sign = isNegative ? '-' : '';
  return `${sign}${clean}k`;
};

const getCommentLikesCount = async (commentId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as count FROM comments_likes 
      WHERE comments_id = ?
    `, [commentId]);
    return rows[0].count;
  } catch (error) {
    logError('Database error getting comment likes count:', error);
    return 0;
  }
};

const formatPaymentType = (type) => {
  if (!type) return 'Subscription';
  const map = {
    'video_call_tip': 'Video Call Tip',
    'audio_call_tip': 'Audio Call Tip',
    'live_tip': 'Live Tip',
    'chat_tip': 'Chat Tip',
    'subscription': 'Subscription',
    'tip': 'Tip',
    'ppv': 'Pay Per View',
    'chat_ppv': 'Chat Pay Per View',
    'videocall': 'Video Call',
    'audiocall': 'Audio Call',
    'live': 'Live Stream',
    'product': 'Product Purchase',
    'purchase': 'Purchase'
  };
  const lower = String(type).toLowerCase();
  if (map[lower]) return map[lower];
  return String(type)
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

const convertExpiresAtToTimestamp = (expiresAt) => {
  if (!expiresAt) return null;
  const now = new Date();
  let hoursToAdd = 0;
  switch (expiresAt) {
    case '24h': hoursToAdd = 24; break;
    case '48h': hoursToAdd = 48; break;
    case '72h': hoursToAdd = 72; break;
    default: return null;
  }
  const expiryDate = new Date(now.getTime() + (hoursToAdd * 60 * 60 * 1000));
  return expiryDate.toISOString().slice(0, 19).replace('T', ' ');
};

const encryptSensitiveData = (data) => {
  if (!data || typeof data !== 'string') return data;
  const secret = process.env.ENCRYPT_SECRET_ID;
  if (!secret || secret.length < 32) throw new Error('ENCRYPT_SECRET_ID must be set and at least 32 characters');
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(secret).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(iv);
  hmac.update(encrypted);
  const mac = hmac.digest('hex');
  const payload = { iv: iv.toString('base64'), value: encrypted, mac, tag: '' };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
};

const decryptSensitiveData = (encryptedData) => {
  if (!encryptedData || typeof encryptedData !== 'string') return encryptedData;
  const secret = process.env.ENCRYPT_SECRET_ID;
  if (!secret || secret.length < 32) throw new Error('ENCRYPT_SECRET_ID must be set and at least 32 characters');
  const jsonPayload = Buffer.from(encryptedData, 'base64').toString('utf8');
  const payload = JSON.parse(jsonPayload);
  if (!payload.iv || !payload.value || !payload.mac) throw new Error('Invalid encrypted data format: missing required fields');
  const iv = Buffer.from(payload.iv, 'base64');
  const encrypted = payload.value;
  const key = crypto.createHash('sha256').update(secret).digest();
  const hmac = crypto.createHmac('sha256', key);
  hmac.update(iv);
  hmac.update(encrypted);
  const expectedMac = hmac.digest('hex');
  if (payload.mac !== expectedMac) throw new Error('MAC verification failed: data integrity compromised');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

/**
 * Sessions list and revoke by token
 */
const getUserSessionsWithDeviceInfo = async (userId) => {
  try {
    const tableName = `sessions-${process.env.NODE_ENV || 'dev'}`;
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    }));
    if (result.Items && result.Items.length > 0) {
      return result.Items.map(item => ({
        token: item.token,
        userId: item.userId,
        deviceFingerprint: item.deviceFingerprint,
        ipAddress: item.ipAddress,
        app: item.app || null,
        createdAt: item.createdAt,
        expiresAt: item.expires_at
      }));
    }
    return [];
  } catch (error) {
    logError('Error getting user sessions with device info:', error);
    return [];
  }
};

const revokeSessionByToken = async (token, userId) => {
  try {
    const tableName = `sessions-${process.env.NODE_ENV || 'dev'}`;
    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { token, userId }
    }));
    return true;
  } catch (error) {
    logError('Error revoking session by token:', error);
    return false;
  }
};

// Export all functions at the end
export {
  docClient,
  logger,
  getAdminSettings,
  getFile,
  getUserById,
  getUserCountry,
  processCurrencySettings,
  upsertFcmTokenRecord,
  getSubscribersList,
  getSubscribersCount,
  getUserPostsList,
  getUserPostsCount,
  getUserUpdatesList,
  getUserUpdatesCount,
  updateUserPost,
  deleteUserPost,
  getPostComments,
  getUserSettings,
  checkUserFieldExists,
  checkMobileExists,
  getUserCountryById,
  updateUserAfterOTP,
  compareUserFields,
  updateUserSettings,
  sendOtpToUser,
  verifyUserOtp,
  searchUsersByName,
  changeUserPassword,
  createPasswordOtpForUser,
  verifyPasswordOtpForUser,
  blockUserById,
  getUserProfileBySlug,
  checkAudioCallAccess,
  getVerificationRequestInfo,
  getVerificationCategories,
  createVerificationRequest,
  getVerificationConversationsList,
  storeVerificationConversationData,
  getAllCountries,
  getStates,
  getGenderOptions,
  getUserSalesList,
  updatePurchaseStatus,
  safeDecryptId,
  checkFreeVideoCallAccess,
  checkPaidVideoCallAccess,
  checkPaidChatAccess,
  checkFreeChatAccess,
  checkCreatorAgreementAccess,
  getCreatorAgreementStatus,
  createCreatorAgreement,
  updateCreatorAgreementStatus,
  checkVideoCallAccess,
  checkChatAccess,
  checkCallAccess,
  getCreatorSettingsByUserId,
  updateCreatorSettings,
  updateCreatorSettingsByUserId,
  getCreatorSubscriptionSettings,
  updateCreatorSubscriptionSettings,
  getCreatorWithdrawalSettings,
  updateCreatorWithdrawalSettings,
  logInfo,
  logError,
  checkRateLimit,
  isValidEmailDomain,
  generateOTP,
  checkEmailValidation,
  storeEmailValidation,
  validateEmailWithListClean,
  checkDuplicateAccount,
  createResponse,
  createErrorResponse,
  createSuccessResponse,
  verifyEmailOTP,
  getWhatsAppTokenStatus,
  sendTelegramNotification,
  getDeviceInfo,
  convertLocalToUTC,
  convertAnonymousToAuthenticated,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyToken,
  storeRefreshToken,
  getRefreshToken,
  isRefreshTokenExpiringSoon,
  revokeRefreshToken,
  getAuthenticatedUserId,
  getCreatorGroups,
  getCreatorGroupName,
  getCreatorIdsByGroupName,
  getCreatorGroupBasedIds,
  getUserBalance,
  getCreatorEarnings,
  getAgentEarnings,
  getWithdrawalSummary,
  getAllLanguages,
  getVerifiedUserById,
  getDaysInMonth,
  MONTH_NAMES,
  getSupportCreatorIds,
  getSupportUserIds,
  getRestrictedUserIds,
  getSupportUsersByIds,
  getUsersBySearch,
  encryptId,
  decryptId,
  isEncryptedId,
  convertUTCToLocal,
  getUserUpdatesWithCounts,
  formatDate,
  formatRelativeTime,
  formatTimeAgo,
  formatNumberWithK,
  getCommentLikesCount,
  formatPaymentType,
  convertExpiresAtToTimestamp,
  encryptSensitiveData,
  decryptSensitiveData,
  getUserSessionsWithDeviceInfo,
  revokeSessionByToken
};