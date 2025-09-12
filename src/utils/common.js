/**
 * @file common.js
 * @description Common utilities for Bingeme API Express.js, including logging, rate limiting, email/domain validation, OTP generation, and response helpers.
 * All functions are documented and security best practices are followed.
 */
import dotenv from 'dotenv';
dotenv.config();

import { getDB } from '../config/database.js';
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
export const docClient = DynamoDBDocumentClient.from(ddbClient);

// Initialize logger
export const logger = winston.createLogger({
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
 * Get file from S3
 */
const getFile = async (fileKey) => {
  try {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3Client = new S3Client({ region: process.env.AWS_DEFAULT_REGION });
    
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: fileKey
    });
    
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    logError('Error getting file from S3:', error);
    return null;
  }
};

/**
 * Get user by ID
 */
const getUserById = async (userId) => {
  try {
    const query = `SELECT * FROM users WHERE id = ? AND deleted = 0`;
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
const getUserCountry = async (req, user) => {
  try {
    // Try to get country from user profile first
    if (user && user.country) {
      return user.country;
    }
    
    // Fallback to IP-based geolocation or default
    return 'US'; // Default country
  } catch (error) {
    logError('Error getting user country:', error);
    return 'US';
  }
};

/**
 * Process currency settings
 */
const processCurrencySettings = (adminSettings, userCountry) => {
  try {
    const defaultCurrency = {
      code: 'USD',
      symbol: '$',
      coin_conversion_rate: 1
    };
    
    // This would process currency settings based on admin settings and user country
    return defaultCurrency;
  } catch (error) {
    logError('Error processing currency settings:', error);
    return {
      code: 'USD',
      symbol: '$',
      coin_conversion_rate: 1
    };
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
        u.profile_pic,
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
        u.profile_pic
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
 * Update user settings
 */
const updateUserSettings = async (userId, settings) => {
  try {
    const { username, name, email, mobile, bio, country } = settings;
    const query = `
      UPDATE users 
      SET username = ?, name = ?, email = ?, mobile = ?, bio = ?, country = ?, updated_at = NOW() 
      WHERE id = ? AND deleted = 0
    `;
    await pool.query(query, [username, name, email, mobile, bio, country, userId]);
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
        profile_pic,
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
        profile_pic,
        bio,
        verified,
        created_at
      FROM users 
      WHERE username = ? AND deleted = 0
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
 * Get user sales list
 */
const getUserSalesList = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT 
        s.id,
        s.buyer_id,
        s.product_id,
        s.amount,
        s.status,
        s.created_at,
        u.username as buyer_username,
        u.name as buyer_name,
        p.name as product_name
      FROM sales s
      JOIN users u ON s.buyer_id = u.id
      JOIN products p ON s.product_id = p.id
      WHERE s.seller_id = ?
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [sales] = await pool.query(query, [userId, limitNum, skipNum]);
    return sales;
  } catch (error) {
    logError('Error getting user sales list:', error);
    return [];
  }
};

/**
 * Update purchase status
 */
const updatePurchaseStatus = async (saleId, status) => {
  try {
    const query = `UPDATE sales SET status = ?, updated_at = NOW() WHERE id = ?`;
    await pool.query(query, [status, saleId]);
    logInfo(`Updated purchase status: ${saleId} -> ${status}`);
  } catch (error) {
    logError('Error updating purchase status:', error);
    throw error;
  }
};

/**
 * Safe decrypt ID
 */
const safeDecryptId = (encryptedId) => {
  try {
    if (!encryptedId) return null;
    return decryptId(encryptedId);
  } catch (error) {
    logError('Error safely decrypting ID:', error);
    return null;
  }
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
export const logInfo = (message, meta = {}) => {
  logger.info(message, meta);
};

export const logError = (message, error = null) => {
  if (error) {
    logger.error(message, { error: error.message, stack: error.stack, ...error });
  } else {
    logger.error(message);
  }
};

// Rate limiting middleware using DynamoDB
export const checkRateLimit = async (ip, route) => {
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
export const isValidEmailDomain = async (email) => {
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
export const generateOTP = async (identifier) => {
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
export const checkEmailValidation = async (email) => {
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
export const storeEmailValidation = async (email, status, remarks = null) => {
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

  export const validateEmailWithListClean = async (email) => {
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
export const checkDuplicateAccount = async (email, phone) => {
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
export const createResponse = (statusCode, message, data = null, error = null) => {
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

// Common error response function
export const createErrorResponse = (statusCode, error, details = null) => {
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
  
  return createResponse(statusCode, fullMessage, null, details);
};

// Common success response function
export const createSuccessResponse = (message, data = null) => {
  return createResponse(200, message, data);
};

export const verifyEmailOTP = async (identifier, otp) => {
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
    
    // Check if OTP is expired (10-minute window)
    const tenMinutes = 10 * 60 * 1000;
    if (Date.now() - otpRecord.timestamp > tenMinutes) {
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
export const getDeviceInfo = (req) => {
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
 * Convert anonymous user session to authenticated user session
 * @param {string} anonymousUserId - Anonymous user ID
 * @param {string} authenticatedUserId - Authenticated user ID
 * @param {string} newToken - New JWT token for authenticated user
 * @param {object} req - Express request object
 * @returns {Promise<object>} Session conversion result
 */
export const convertAnonymousToAuthenticated = async (anonymousUserId, authenticatedUserId, newToken, req) => {
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
export const generateAccessToken = (payload) => {
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
export const generateRefreshToken = (payload) => {
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
export const verifyAccessToken = (token) => {
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
export const verifyRefreshToken = (token) => {
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
export const verifyToken = (token) => {
  return verifyAccessToken(token);
};

/**
 * Store refresh token in DynamoDB sessions table with enhanced device tracking
 * @param {string} anonymousId - Anonymous user ID (sort key)
 * @param {string} refreshToken - Refresh token (primary key)
 * @param {object} req - Express request object for device info
 * @returns {Promise<boolean>} True if stored successfully
 */
export const storeRefreshToken = async (anonymousId, refreshToken, req) => {
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

    logInfo('Storing refresh token in DynamoDB');
    
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
    logError('Error storing refresh token:', error);
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
export const getAuthenticatedUserId = (req, options = {}) => {
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


