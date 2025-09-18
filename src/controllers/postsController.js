/**
 * @file postsController.js
 * @description Express.js Posts Controllers
 * 
 * This module provides posts functionality including:
 * - Post creation with media processing
 * - Post retrieval and display
 * - Post upload URL generation
 * 
 * Database Tables: updates, media, users, likes, comments, tags, update_tags
 */

import { 
  getAuthenticatedUserId, 
  createErrorResponse, 
  createSuccessResponse, 
  logInfo, 
  logError,
  getFile,
  decryptId,
  isEncryptedId,
  encryptId,
  formatRelativeTime,
  convertLocalToUTC,
  getUserCountry,
  getUserById,
  processCurrencySettings,
  getAdminSettings,
  getUserSettings,
  getRestrictedUserIds,
  safeDecryptId,
  getCommentLikesCount,
  createExpressSuccessResponse,
  createExpressErrorResponse
} from '../utils/common.js';
import { 
  savePost, 
  validatePostInput 
} from '../utils/updates.js';
import { 
  processMediaFiles 
} from '../utils/mediaProcessing.js';
import { 
  processUploadRequest 
} from '../utils/uploadUtils.js';
import { pool } from '../config/database.js';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

/**
 * Default settings for fallback when admin settings unavailable
 */
const DEFAULT_SETTINGS = {
  min_ppv_amount: 1,
  max_ppv_amount: 1000,
  update_length: 1000,
  currency_symbol: '₹',
  currency_code: 'INR',
  coin_conversion_USD: 50,
  file_size_allowed: 1000,
};

/**
 * Configuration constants
 */
const CONFIG = {
  MAX_TAGS_LIMIT: 100,
  MIN_PRICE: 1,
  MIN_DESCRIPTION_LENGTH: 100,
  HTTP_METHOD: 'GET'
};

// ============================================================================
// DATABASE QUERIES
// ============================================================================

/**
 * Fetches available tags from database (sample = 1 only)
 * @returns {Promise<Array<string>>} Array of tag strings
 */
const getAvailableTags = async () => {
  try {
    const [rows] = await pool.execute(
      `SELECT tag FROM tags WHERE sample = 1 ORDER BY tag ASC LIMIT ${CONFIG.MAX_TAGS_LIMIT}`
    );
    
    return rows.map(({ tag }) => tag);
  } catch (error) {
    logError('Database error fetching tags:', error);
    throw new Error('Failed to fetch available tags');
  }
};

/**
 * Fetches admin settings for pricing, post limits, and currency information
 * @returns {Promise<Object>} Admin settings or default settings
 */
const getAdminSettingsForPosts = async () => {
  try {
    const [rows] = await pool.execute(
      'SELECT min_ppv_amount, max_ppv_amount, update_length, currency_symbol, currency_code, coin_conversion_USD, file_size_allowed FROM admin_settings LIMIT 1'
    );
    
    return rows[0] || DEFAULT_SETTINGS;
  } catch (error) {
    logError('Database error fetching admin settings:', error);
    throw new Error('Failed to fetch admin settings');
  }
};

// ============================================================================
// DATA PROCESSING & VALIDATION
// ============================================================================

/**
 * Processes tags by splitting comma-separated values, removing duplicates, and trimming spaces
 * @param {Array<string>} tags - Array of tag strings that may contain comma-separated values
 * @returns {Array<string>} Processed array of individual tags
 */
const processTags = (tags) => {
  // Early return for invalid input
  if (!Array.isArray(tags)) return [];

  // Use Set for automatic deduplication and better performance
  const uniqueTags = new Set();

  // Process each tag
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    
    if (tag.includes(',')) {
      // Split by comma and add individual tags
      const individualTags = tag.split(',');
      for (const individualTag of individualTags) {
        const trimmedTag = individualTag.trim();
        if (trimmedTag.length > 0) uniqueTags.add(trimmedTag);
      }
    } else {
      // Single tag, just trim and add if not empty
      const trimmedTag = tag.trim();
      if (trimmedTag.length > 0) uniqueTags.add(trimmedTag);
    }
  }

  // Convert Set back to array
  return Array.from(uniqueTags);
};

/**
 * Processes and validates admin settings with optimized defaults
 * @param {Object} settings - Raw admin settings from database
 * @returns {Object} Processed settings with validated values
 */
const processAdminSettings = ({ 
  min_ppv_amount = DEFAULT_SETTINGS.min_ppv_amount,
  max_ppv_amount = DEFAULT_SETTINGS.max_ppv_amount,
  update_length = DEFAULT_SETTINGS.update_length,
  file_size_allowed = DEFAULT_SETTINGS.file_size_allowed
} = {}) => ({
  pricing: {
    min_price: Math.max(CONFIG.MIN_PRICE, parseInt(min_ppv_amount) || DEFAULT_SETTINGS.min_ppv_amount),
    max_price: Math.max(CONFIG.MIN_PRICE, parseInt(max_ppv_amount) || DEFAULT_SETTINGS.max_ppv_amount)
  },
  limits: {
    max_description_length: Math.max(CONFIG.MIN_DESCRIPTION_LENGTH, parseInt(update_length) || DEFAULT_SETTINGS.update_length),
    max_file_size: Math.max(CONFIG.MIN_DESCRIPTION_LENGTH, parseInt(file_size_allowed) || DEFAULT_SETTINGS.file_size_allowed) / 1000
  }
});

/**
 * Validates HTTP method for the request
 * @param {string} method - HTTP method from request
 * @returns {Object|null} Error response if invalid, null if valid
 */
const validateHttpMethod = (method) => 
  method !== CONFIG.HTTP_METHOD 
    ? createErrorResponse(405, 'Method not allowed. Only GET requests are supported.')
    : null;

/**
 * Extracts and processes request metadata for logging
 * @param {Object} req - Express request object
 * @param {number} userId - Authenticated user ID
 * @returns {Object} Processed request metadata
 */
const extractRequestMetadata = ({ 
  method,
  path,
  headers = {},
  ip
} = {}, userId) => ({
  method,
  path,
  userAgent: headers['User-Agent'] || 'Unknown',
  ip: ip || 'Unknown',
  userId
});

/**
 * Calculates the expiration timestamp based on scheduling parameters
 */
const calculateExpiredAt = (scheduled_date, scheduled_time, timezone, post_type, price) => {
  // Business rule: Free posts never expire (always active)
  if (post_type === 'free') {
    logInfo('Post is free, no expiration set (always active)');
    return null;
  }

  // For paid or subscribers_only posts, scheduled_date and scheduled_time are optional
  if ((post_type === 'paid' || post_type === 'subscribers_only') && (!scheduled_date || !scheduled_time)) {
    logInfo('No scheduling provided for paid/subscribers_only post, will be active immediately:', { post_type, scheduled_date, scheduled_time });
    return null;
  }

  // Validate that scheduling information is provided
  if (!scheduled_date || !scheduled_time) {
    logInfo('No scheduling information provided, no expiration set');
    return null;
  }

  try {
    // Use the existing convertLocalToUTC function from common.js
    const utcDate = convertLocalToUTC(scheduled_date, scheduled_time, timezone);
    
    // Return ISO 8601 formatted timestamp (UTC)
    const expiredAt = utcDate.toISOString();
    logInfo('Expiration timestamp calculated with timezone conversion:', { 
      scheduled_date, 
      scheduled_time, 
      timezone, 
      utcTime: expiredAt, 
      post_type 
    });
    
    return expiredAt;
  } catch (error) {
    logError('Error calculating expired_at:', { scheduled_date, scheduled_time, timezone, error: error.message });
    return null;
  }
};

/**
 * Resolve an update/post id that can be encrypted (24-char) or numeric string
 */
const resolveUpdateId = (id) => {
  try {
    if (isEncryptedId(id)) return decryptId(id);
    const parsed = parseInt(id, 10);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
};

/**
 * Fetch owner (user) row by username
 */
const fetchOwnerByUsername = async (username) => {
  const [rows] = await pool.query(
    'SELECT id, username, name, avatar FROM users WHERE username = ? AND status != "deleted" LIMIT 1',
    [username]
  );
  return rows.length ? rows[0] : null;
};

/**
 * Fetch a post by id and owner id (enforces ownership scope and active statuses)
 */
const fetchPostByIdAndOwner = async (updateId, ownerId) => {
  const [rows] = await pool.query(
    `SELECT u.id, u.description, u.date, u.fixed_post, u.locked, u.price,
            DATE_FORMAT(u.expired_at, '%Y-%m-%d %H:%i:%s') as expired_at, u.is_utc, u.status
       FROM updates u
      WHERE u.id = ? AND u.user_id = ? AND u.status IN ('active','disabled')
      LIMIT 1`,
    [updateId, ownerId]
  );
  return rows.length ? rows[0] : null;
};

/**
 * Fetch media rows for a post and map to simplified objects
 */
const fetchMediaForPost = async (updateId) => {
  const [rows] = await pool.query(
    `SELECT type, image, video, music, file, video_embed FROM media WHERE updates_id = ? AND status = 'active' ORDER BY id ASC`,
    [updateId]
  );

  return rows
    .map(({ type, image, video, music, file, video_embed }) => {
      const item = { type };
      if (type === 'image' && image) item.url = getFile(`images/${image}`);
      else if (type === 'video' && video) item.url = getFile(`videos/${video}`);
      else if (type === 'music' && music) item.url = getFile(`music/${music}`);
      else if (type === 'file' && file) item.url = getFile(`files/${file}`);
      else if (video_embed) item.video_embed = video_embed;
      return item;
    })
    .filter(({ url, video_embed }) => url || video_embed);
};

/**
 * Fetch likes and comments counts for a post
 */
const fetchCounts = async (updateId) => {
  const likesPromise = pool.query(
    'SELECT COUNT(*) AS likes_count FROM likes WHERE updates_id = ? AND status = "1"',
    [updateId]
  );
  const commentsPromise = pool.query(
    'SELECT COUNT(*) AS comments_count FROM comments WHERE updates_id = ? AND status = "1"',
    [updateId]
  );
  const [[[{ likes_count = 0 }]], [[{ comments_count = 0 }]]] = await Promise.all([likesPromise, commentsPromise]);
  return { likes_count, comments_count };
};

/**
 * Fetch tags (array of #tag) for a post
 */
const fetchTags = async (updateId) => {
  const [rows] = await pool.query(
    `SELECT GROUP_CONCAT(DISTINCT CONCAT('#', t.tag) SEPARATOR ', ') AS tagname
       FROM update_tags ut JOIN tags t ON ut.tag_id = t.id
      WHERE ut.update_id = ?`,
    [updateId]
  );
  const tagname = rows[0]?.tagname || '';
  return tagname
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
};

// ============================================================================
// COMMENT HELPER FUNCTIONS
// ============================================================================

/**
 * Validates comment content
 * @param {string} comment - Comment text
 * @param {number} maxLength - Maximum allowed length from admin settings
 * @returns {Object} Validation result with isValid and error
 */
const validateComment = (comment, maxLength) => {
  if (!comment || typeof comment !== 'string') {
    return { isValid: false, error: 'Comment is required' };
  }

  const trimmedComment = comment.trim();
  
  if (trimmedComment.length < 1) {
    return { isValid: false, error: 'Comment cannot be empty' };
  }

  if (trimmedComment.length > maxLength) {
    return { isValid: false, error: `Comment cannot exceed ${maxLength} characters` };
  }

  return { isValid: true, comment: trimmedComment };
};

/**
 * Fetches update details and validates accessibility
 * @param {number} updateId - Update ID
 * @param {number} userId - Current user ID
 * @returns {Promise<Object|null>} Update details or null if not accessible
 */
const getUpdateDetails = async (updateId, userId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT u.id, u.user_id, u.locked, u.price, u.status, u.description,
             u.date, u.token_id, u.fixed_post, DATE_FORMAT(u.expired_at, '%Y-%m-%d %H:%i:%s') as expired_at,
             usr.name as creator_name, usr.avatar as creator_avatar,
             usr.notify_commented_post
      FROM updates u
      JOIN users usr ON u.user_id = usr.id
      WHERE u.id = ? AND u.status = 'active'
    `, [updateId]);

    if (rows.length === 0) {
      return null;
    }

    const update = rows[0];

    // Check if user is the creator (always allowed to comment)
    if (update.user_id === userId) {
      return update;
    }

    // Check if creator is restricted
    const restrictedUsers = await getRestrictedUserIds(userId);
    if (restrictedUsers.includes(update.user_id)) {
      return null;
    }

    // Check locked content access
    if (update.locked === 'yes') {
      if (update.price > 0) {
        // Check if user has paid for this content
        const [payPerViewRows] = await pool.execute(`
          SELECT id FROM pay_per_views 
          WHERE updates_id = ? AND user_id = ? AND status = 1
        `, [updateId, userId]);

        if (payPerViewRows.length === 0) {
          return null; // User hasn't paid
        }
      } else {
        // Check if user has subscription
        const [subscriptionRows] = await pool.execute(`
          SELECT id FROM subscriptions 
          WHERE subscribed = ? AND user_id = ? AND status = 'active'
        `, [update.user_id, userId]);

        if (subscriptionRows.length === 0) {
          return null; // User doesn't have subscription
        }
      }
    }

    return update;
  } catch (error) {
    logError('Database error fetching update details:', error);
    throw new Error('Failed to fetch update details');
  }
};

/**
 * Stores comment in database
 * @param {number} updateId - Update ID
 * @param {number} userId - User ID
 * @param {string} comment - Comment text
 * @returns {Promise<number>} Comment ID
 */
const storeComment = async (updateId, userId, comment) => {
  try {
    const [result] = await pool.execute(`
      INSERT INTO comments (updates_id, user_id, reply, date, date_utc, status)
      VALUES (?, ?, ?, NOW(), UTC_TIMESTAMP(), '1')
    `, [updateId, userId, comment]);

    return result.insertId;
  } catch (error) {
    logError('Database error storing comment:', error);
    throw new Error('Failed to store comment');
  }
};

/**
 * Gets comment details for deletion authorization
 * @param {number} commentId - Comment ID
 * @returns {Promise<Object|null>} Comment details or null if not found
 */
const getCommentDetails = async (commentId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.id, c.updates_id, c.user_id, c.reply, c.date, c.status,
             u.user_id as update_user_id
      FROM comments c
      JOIN updates u ON c.updates_id = u.id
      WHERE c.id = ? AND c.status = '1'
    `, [commentId]);

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Database error fetching comment details:', error);
    throw new Error('Failed to fetch comment details');
  }
};

/**
 * Deletes comment and related data
 * @param {number} commentId - Comment ID
 * @returns {Promise<boolean>} Success status
 */
const deleteCommentHelper = async (commentId) => {
  try {
    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Delete comment likes first
      await connection.execute(`
        DELETE FROM comments_likes WHERE comments_id = ?
      `, [commentId]);

      // Delete notifications related to this comment
      await connection.execute(`
        DELETE FROM notifications 
        WHERE author = (SELECT user_id FROM comments WHERE id = ?)
        AND target = (SELECT updates_id FROM comments WHERE id = ?)
        AND type = 3
      `, [commentId, commentId]);

      // Delete the comment
      const [result] = await connection.execute(`
        DELETE FROM comments WHERE id = ?
      `, [commentId]);

      await connection.commit();
      connection.release();

      return result.affectedRows > 0;
    } catch (error) {
      await connection.rollback();
      connection.release();
      throw error;
    }
  } catch (error) {
    logError('Database error deleting comment:', error);
    throw new Error('Failed to delete comment');
  }
};

/**
 * Gets comment count for an update
 * @param {number} updateId - Update ID
 * @returns {Promise<number>} Comment count
 */
const getCommentCount = async (updateId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as count FROM comments 
      WHERE updates_id = ? AND status = '1'
    `, [updateId]);

    return rows[0].count;
  } catch (error) {
    logError('Database error getting comment count:', error);
    return 0;
  }
};

/**
 * Sends notification to post owner
 * @param {number} postOwnerId - Post owner user ID
 * @param {number} commenterId - Commenter user ID
 * @param {number} updateId - Update ID
 * @param {string} notifySetting - Notification setting
 */
const sendNotification = async (postOwnerId, commenterId, updateId, notifySetting) => {
  try {
    if (postOwnerId === commenterId || notifySetting !== 'yes') {
      return; // Don't notify if same user or notifications disabled
    }

    await pool.execute(`
      INSERT INTO notifications (destination, author, type, target, created_at)
      VALUES (?, ?, 3, ?, NOW())
    `, [postOwnerId, commenterId, updateId]);

    logInfo('Notification sent for comment:', { postOwnerId, commenterId, updateId });
  } catch (error) {
    logError('Error sending notification:', error);
    // Don't throw error as notification failure shouldn't break comment creation
  }
};

/**
 * Gets the newly created comment with user details
 * @param {number} commentId - Comment ID
 * @returns {Promise<Object|null>} Comment details
 */
const getNewComment = async (commentId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT c.id, c.reply, c.date, c.date_utc, u.name, u.avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ? AND c.status = '1'
    `, [commentId]);

    if (rows.length === 0) {
      return null;
    }

    const comment = rows[0];
    const likesCount = await getCommentLikesCount(comment.id);
    
    return {
      id: encryptId(comment.id),
      name: comment.name,
      avatar: comment.avatar ? getFile(`avatar/${comment.avatar}`) : '',
      comment: comment.reply,
      date: comment.date_utc ? formatRelativeTime(comment.date_utc) : (comment.date ? formatRelativeTime(comment.date) : 'just now'),
      date_time: comment.date_utc || comment.date || null,
      like: false,
      likes_count: likesCount
    };
  } catch (error) {
    logError('Database error fetching new comment:', error);
    return null;
  }
};

// ============================================================================
// LIKE HELPER FUNCTIONS
// ============================================================================

/**
 * Gets existing like for a post
 * @param {number} updateId - Update ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} Like details or null if not found
 */
const getPostLike = async (updateId, userId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id, status FROM likes 
      WHERE updates_id = ? AND user_id = ?
    `, [updateId, userId]);

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Database error fetching post like:', error);
    throw new Error('Failed to fetch post like');
  }
};

/**
 * Gets existing like for a comment
 * @param {number} commentId - Comment ID
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} Like details or null if not found
 */
const getCommentLike = async (commentId, userId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id FROM comments_likes 
      WHERE comments_id = ? AND user_id = ?
    `, [commentId, userId]);

    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Database error fetching comment like:', error);
    throw new Error('Failed to fetch comment like');
  }
};

/**
 * Creates or updates post like
 * @param {number} updateId - Update ID
 * @param {number} userId - User ID
 * @param {string} status - Like status ('1' for like, '0' for unlike)
 * @returns {Promise<boolean>} Success status
 */
const togglePostLike = async (updateId, userId, status) => {
  try {
    const existingLike = await getPostLike(updateId, userId);

    if (existingLike) {
      // Update existing like
      await pool.execute(`
        UPDATE likes SET status = ? WHERE id = ?
      `, [status, existingLike.id]);
    } else {
      // Create new like
      await pool.execute(`
        INSERT INTO likes (updates_id, user_id, status) VALUES (?, ?, ?)
      `, [updateId, userId, status]);
    }

    return true;
  } catch (error) {
    logError('Database error toggling post like:', error);
    throw new Error('Failed to toggle post like');
  }
};

/**
 * Toggles comment like (delete if exists, create if not)
 * @param {number} commentId - Comment ID
 * @param {number} userId - User ID
 * @returns {Promise<boolean>} Success status
 */
const toggleCommentLikeHelper = async (commentId, userId) => {
  try {
    const existingLike = await getCommentLike(commentId, userId);

    if (existingLike) {
      // Delete existing like
      await pool.execute(`
        DELETE FROM comments_likes WHERE id = ?
      `, [existingLike.id]);
      return false; // Unlike
    } else {
      // Create new like
      await pool.execute(`
        INSERT INTO comments_likes (comments_id, user_id) VALUES (?, ?)
      `, [commentId, userId]);
      return true; // Like
    }
  } catch (error) {
    logError('Database error toggling comment like:', error);
    throw new Error('Failed to toggle comment like');
  }
};

/**
 * Gets post likes count
 * @param {number} updateId - Update ID
 * @returns {Promise<number>} Likes count
 */
const getPostLikesCount = async (updateId) => {
  try {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as count FROM likes 
      WHERE updates_id = ? AND status = '1'
    `, [updateId]);

    return rows[0].count;
  } catch (error) {
    logError('Database error getting post likes count:', error);
    return 0;
  }
};

/**
 * Sends notification for post like
 * @param {number} postOwnerId - Post owner user ID
 * @param {number} likerId - Liker user ID
 * @param {number} updateId - Update ID
 * @param {string} notifySetting - Notification setting
 */
const sendPostLikeNotification = async (postOwnerId, likerId, updateId, notifySetting) => {
  try {
    if (postOwnerId === likerId || notifySetting !== 'yes') {
      return; // Don't notify if same user or notifications disabled
    }

    await pool.execute(`
      INSERT INTO notifications (destination, author, type, target, created_at)
      VALUES (?, ?, 2, ?, NOW())
    `, [postOwnerId, likerId, updateId]);

    logInfo('Post like notification sent:', { postOwnerId, likerId, updateId });
  } catch (error) {
    logError('Error sending post like notification:', error);
    // Don't throw error as notification failure shouldn't break like creation
  }
};

/**
 * Sends notification for comment like
 * @param {number} commentOwnerId - Comment owner user ID
 * @param {number} likerId - Liker user ID
 * @param {number} updateId - Update ID
 * @param {string} notifySetting - Notification setting
 */
const sendCommentLikeNotification = async (commentOwnerId, likerId, updateId, notifySetting) => {
  try {
    if (commentOwnerId === likerId || notifySetting !== 'yes') {
      return; // Don't notify if same user or notifications disabled
    }

    await pool.execute(`
      INSERT INTO notifications (destination, author, type, target, created_at)
      VALUES (?, ?, 4, ?, NOW())
    `, [commentOwnerId, likerId, updateId]);

    logInfo('Comment like notification sent:', { commentOwnerId, likerId, updateId });
  } catch (error) {
    logError('Error sending comment like notification:', error);
    // Don't throw error as notification failure shouldn't break like creation
  }
};

/**
 * Deletes post like notification
 * @param {number} postOwnerId - Post owner user ID
 * @param {number} likerId - Liker user ID
 * @param {number} updateId - Update ID
 */
const deletePostLikeNotification = async (postOwnerId, likerId, updateId) => {
  try {
    await pool.execute(`
      UPDATE notifications 
      SET status = '1' 
      WHERE destination = ? AND author = ? AND target = ? AND type = 2
    `, [postOwnerId, likerId, updateId]);

    logInfo('Post like notification deleted:', { postOwnerId, likerId, updateId });
  } catch (error) {
    logError('Error deleting post like notification:', error);
  }
};

/**
 * Deletes comment like notification
 * @param {number} commentOwnerId - Comment owner user ID
 * @param {number} likerId - Liker user ID
 * @param {number} updateId - Update ID
 */
const deleteCommentLikeNotification = async (commentOwnerId, likerId, updateId) => {
  try {
    await pool.execute(`
      DELETE FROM notifications 
      WHERE destination = ? AND author = ? AND target = ? AND type = 4
    `, [commentOwnerId, likerId, updateId]);

    logInfo('Comment like notification deleted:', { commentOwnerId, likerId, updateId });
  } catch (error) {
    logError('Error deleting comment like notification:', error);
  }
};

/**
 * Compute remaining time until expired_at in the desired display format
 */
const computeRemainingTime = (expiredAt, isUtcFlag) => {
  if (!expiredAt) return { remainingDays: null, remainingMessage: null };
  try {
    const expiryDate = (isUtcFlag === 1 || isUtcFlag === '1') ? new Date(`${expiredAt}Z`) : new Date(expiredAt);
    const now = new Date();
    const diffMs = Math.max(0, expiryDate.getTime() - now.getTime());
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    let remainingTime = '0';
    let timeUnit = 'minutes';
    if (days > 0) {
      remainingTime = `${days}`;
      timeUnit = `day${days > 1 ? 's' : ''}`;
    } else if (hours > 0) {
      remainingTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      timeUnit = `hour${hours > 1 ? 's' : ''}`;
    } else {
      remainingTime = `${minutes}`;
      timeUnit = `minute${minutes > 1 ? 's' : ''}`;
    }

    return {
      remainingDays: remainingTime,
      remainingMessage: `Act fast! This post deletes in ${remainingTime} ${timeUnit}`
    };
  } catch {
    return { remainingDays: null, remainingMessage: null };
  }
};

/**
 * Main handler for GET /posts/create endpoint
 * Provides optimized post creation form data
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} Express response with form data or error
 */
export const getPostCreateData = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Step 1: Authenticate user (early return on failure)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'post creation data' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'post creation data' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'post creation data' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Step 2: Validate HTTP method (early return on failure)
    // TODO: Convert event.httpMethod to req.method
    const methodError = validateHttpMethod(req.method);
    if (methodError) {
      // TODO: Convert return methodError to return res.status(methodError.statusCode).json(methodError.body)
      return res.status(methodError.statusCode).json(methodError.body);
    }

    // Step 3: Extract request metadata and log
    // TODO: Convert extractRequestMetadata(event, userId) to extractRequestMetadata(req, userId)
    const requestMetadata = extractRequestMetadata(req, userId);
    logInfo('Post create data request received:', requestMetadata);

    const user = await getUserById(userId);

    // Step 4: Get user country for currency determination
    // TODO: Convert getUserCountry(event, user) to getUserCountry(req, user)
    const userCountry = await getUserCountry(req, user);

    // Step 5: Fetch data in parallel for optimal performance
    const [rawTags, adminSettings] = await Promise.all([
      getAvailableTags(),
      getAdminSettingsForPosts()
    ]);

    // Step 6: Process tags to split comma-separated values and remove duplicates
    const processedTags = processTags(rawTags);

    // Step 7: Process settings and create response
    const { pricing, limits } = processAdminSettings(adminSettings);
    const { currency } = processCurrencySettings(adminSettings, userCountry);
    const responseData = { tags: processedTags, pricing, limits, currency };

    // Step 8: Log success with performance metrics
    const duration = Date.now() - startTime;
    const { min_price, max_price } = pricing;
    const { max_description_length, max_file_size } = limits;
    const { symbol, code, coin_conversion_rate } = currency;
    
    logInfo('Post create data retrieved successfully:', {
      userId,
      userCountry,
      originalTagsCount: rawTags.length,
      processedTagsCount: processedTags.length,
      minPrice: min_price,
      maxPrice: max_price,
      maxLength: max_description_length,
      maxFileSize: max_file_size,
      currency: `${symbol} ${code}`,
      coinConversionRate: coin_conversion_rate,
      duration: `${duration}ms`
    });

    // TODO: Convert createSuccessResponse('Post creation data retrieved successfully', responseData) to res.json(createSuccessResponse('Post creation data retrieved successfully', responseData))
    return res.json(createSuccessResponse(
      'Post creation data retrieved successfully',
      responseData
    ));

  } catch (error) {
    const duration = Date.now() - startTime;
    logError('Handler error:', { error: error.message, duration: `${duration}ms` });
    
    return res.status(500).json(createErrorResponse(500, error.message));
  }
};

/**
 * Main Lambda handler for post creation requests
 * 
 * This is the primary entry point for post creation. It orchestrates the entire process:
 * 1. Authenticates the user making the request
 * 2. Validates the HTTP method and request format
 * 3. Processes and validates input data
 * 4. Handles media file processing and WebP conversion
 * 5. Saves the post to the database
 * 6. Returns a comprehensive response with post details
 * 
 * @param {Object} req - Express request object
 * @param {string} req.method - HTTP method (must be POST)
 * @param {string} req.body - JSON string containing post data
 * @param {Object} req.headers - Request headers including authorization
 * @returns {Object} Express response object
 */
export const createPost = async (req, res) => {
  try {
    logInfo('Post creation request initiated');

    // Step 1: Authenticate user (anonymous users not allowed for post creation)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'postCreate' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'postCreate' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'postCreate' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Step 2: Validate HTTP method (only POST allowed)
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'POST') {
      logError('Invalid HTTP method for post creation:', { method: req.method });
      return res.status(405).json(createErrorResponse(405, 'Method not allowed. Only POST requests are accepted.'));
    }

    // Step 3: Parse and validate JSON request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (error) {
      logError('Invalid JSON in request body:', { error: error.message });
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON format in request body'));
    }

    // Step 4: Validate required fields and data types
    const validation = validatePostInput(requestBody);
    if (!validation.success) {
      logError('Post validation failed:', { errors: validation.errors });
      return res.status(422).json(createExpressErrorResponse('Validation failed', 422));
    }

    const { description, tags, price, post_type, media, scheduled_date, scheduled_time, timezone } = requestBody;

    // Step 5: Apply business rules for different post types
    let finalPrice = price;
    let finalScheduledDate = scheduled_date;
    let finalScheduledTime = scheduled_time;
    
    // For free posts, ensure price is 0 and no scheduling
    if (post_type === 'free') {
      finalPrice = 0;
      finalScheduledDate = null;
      finalScheduledTime = null;
    }
    
    // For subscribers_only posts, ensure price is 0 (subscribers access for free)
    if (post_type === 'subscribers_only') {
      finalPrice = 0;
      logInfo('Subscribers_only post detected, setting price to 0 for free subscriber access');
    }

    // Step 6: Calculate expiration timestamp based on business rules
    const expired_at = calculateExpiredAt(finalScheduledDate, finalScheduledTime, timezone, post_type, finalPrice);
    
    // Log timezone conversion details for debugging
    if (finalScheduledDate && finalScheduledTime) {
      logInfo('Timezone conversion details:', {
        userInput: `${finalScheduledDate} ${finalScheduledTime}`,
        userTimezone: timezone,
        calculatedUTC: expired_at,
        post_type
      });
    }

    // Step 7: Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      return res.status(500).json(createExpressErrorResponse('Media storage not configured', 500));
    }

    // Step 7.1: Resolve watermark settings without altering existing behaviors
    // Admin setting 'watermark' must be 'on' and the user must not have disabled watermark
    let watermarkEnabled = false;
    let watermarkText = '';
    try {
      const [adminSettings, userSettings] = await Promise.all([
        getAdminSettings(),
        getUserSettings(userId)
      ]);
      const isAdminWatermarkOn = (adminSettings?.watermark || 'on') === 'on';
      const isUserWatermarkDisabled = (userSettings?.disable_watermark || 0) === 1;
      watermarkEnabled = Boolean(isAdminWatermarkOn && !isUserWatermarkDisabled);
      if (watermarkEnabled) {
        const siteBase = (process.env.APP_URL || 'https://bingeme.com').replace(/\/+$/, '');
        const username = userSettings?.username || String(userId);
        watermarkText = `${siteBase}/${username}`;
      }
    } catch (e) {
      // Do not fail post creation if settings fetch fails; keep existing behavior
      logError('Failed to resolve watermark settings, continuing without watermark', { error: e.message });
      watermarkEnabled = false;
    }

    // Step 8: Process media files (validate, convert images to WebP). Apply watermark if enabled.
    let processedMedia = { original: [], converted: [] };
    if (media && media.length > 0) {
      try {
        logInfo('Starting media processing:', { mediaCount: media.length });
        processedMedia = await processMediaFiles(media, bucketName, 'post', {
          continueOnError: false,
          watermark: watermarkEnabled,
          watermarkText
        });
        logInfo('Media processing completed successfully');
      } catch (error) {
        logError('Media processing failed:', { error: error.message });
        return res.status(500).json(createExpressErrorResponse('Media processing failed', 500));
      }
    }

    // Step 9: Save post data to database
    let postResult;
    try {
      logInfo('Saving post to database');
      postResult = await savePost({
        description,
        tags,
        price: finalPrice,
        post_type,
        media: processedMedia.original,
        convertedMedia: processedMedia.converted,
        scheduled_date: finalScheduledDate,
        scheduled_time: finalScheduledTime,
        expired_at,
        userId
      });
      logInfo('Post saved to database successfully');
    } catch (error) {
      logError('Database save operation failed:', { error: error.message });
      return res.status(500).json(createExpressErrorResponse('Failed to save post to database', 500));
    }

    // Step 10: Build success response with empty data object
    const responseData = {};

    // Log successful post creation with detailed metrics
    logInfo('Post created successfully:', { 
      postId: postResult.postId, 
      userId, 
      mediaCount: processedMedia.original.length,
      convertedCount: processedMedia.converted.length,
      post_type,
      price: finalPrice,
      hasScheduledDate: !!finalScheduledDate,
      hasExpiredAt: !!expired_at,
      calculatedExpiredAt: expired_at
    });

    return res.status(200).json(createExpressSuccessResponse('Post created successfully', responseData));

  } catch (error) {
    logError('Unexpected error in createPost:', { error: error.message, stack: error.stack });
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Handler to generate pre-signed S3 URLs for uploading multiple post files.
 * Uses the shared processUploadRequest utility to eliminate code duplication.
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Express response with pre-signed URLs or error
 */
export const getPostUploadUrl = async (req, res) => {
  // Configuration options for posts upload processing with destructuring
    const uploadOptions = {
      action: 'getPostUploadUrl',
    basePath: 'uploads/updates',
    useFolderOrganization: true, // Posts use folder organization by file type
    successMessage: 'Pre-signed upload URLs generated',
      getAuthenticatedUserId
    };
    
    // Use shared upload processing utility and return result directly
  // TODO: Convert processUploadRequest(event, uploadOptions) to processUploadRequest(req, uploadOptions)
    const result = await processUploadRequest(req, uploadOptions);
    
  // TODO: Convert Lambda response format to Express response format
    if (result.statusCode === 200) {
      return res.status(200).json(JSON.parse(result.body));
    } else {
      return res.status(result.statusCode).json(JSON.parse(result.body));
  }
};

/**
 * GET /posts/{username}/{id}
 * Returns post details by username and id (encrypted or numeric).
 */
export const getPostByUsernameAndId = async (req, res) => {
  try {
    // 1) Authenticate request
    // TODO: Convert getAuthenticatedUserId(event, { action: 'get_post_by_username_and_id' }) to getAuthenticatedUserId(req, { action: 'get_post_by_username_and_id' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'get_post_by_username_and_id' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // 2) Validate path params
    // TODO: Convert event.pathParameters to req.params
    const { username, id } = req.params;
    if (!username || !id) {
      return res.status(400).json(createExpressErrorResponse('Username and id are required', 400));
    }

    // 3) Resolve post id
    const updateId = resolveUpdateId(id);
    if (!updateId) {
      return res.status(400).json(createExpressErrorResponse('Invalid id format', 400));
    }

    // 4) Fetch owner and post
    const owner = await fetchOwnerByUsername(username);
    if (!owner) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }
    const post = await fetchPostByIdAndOwner(updateId, owner.id);
    if (!post) {
      return res.status(404).json(createExpressErrorResponse('Post not found', 404));
    }

    // 5) Fetch related data
    const [media, { likes_count, comments_count }, tags] = await Promise.all([
      fetchMediaForPost(updateId),
      fetchCounts(updateId),
      fetchTags(updateId)
    ]);

    // 6) Compute remaining time information
    const { expired_at } = post;
    const { remainingDays, remainingMessage } = computeRemainingTime(expired_at);

    const appBaseUrl = process.env.APP_URL || 'https://bingeme.com';

    // 7) Build response
    const { id: postId, description, date, date_utc, fixed_post, price, locked } = post;
    const response = {
      id: encryptId(postId),
      caption: description || '',
      date: date_utc ? formatRelativeTime(date_utc) : (date ? formatRelativeTime(date) : 'just now'),
      pinned: fixed_post === '1',
      price: price || 0,
      expired_at,
      remaining_days: remainingDays,
      remaining_message: remainingMessage,
      locked: locked === 'yes',
      media,
      likes: likes_count,
      comments_count,
      tags,
      user: {
        username: owner.username,
        name: owner.name || owner.username,
        avatar: owner.avatar ? getFile(`avatar/${owner.avatar}`) : ''
      },
      post_url: `${appBaseUrl}/posts/${owner.username}/${encryptId(postId)}`
    };

    return res.status(200).json(createExpressSuccessResponse('Post details retrieved', response));
  } catch (error) {
    logError('Error in getPostByUsernameAndId:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Handler for storing comments on posts
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} API response
 */
export const addComment = async (req, res) => {
  try {
    // Get authenticated user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'store_comment' }) to getAuthenticatedUserId(req, { action: 'store_comment' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'store_comment' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const { update_id, comment } = requestBody;

    // Validate update ID
    if (!update_id) {
      // TODO: Convert createErrorResponse(400, 'Update ID is required') to res.status(400).json({ error: 'Update ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Update ID is required'));
    }

    // Decrypt update ID
    let decryptedUpdateId;
    try {
      decryptedUpdateId = safeDecryptId(update_id);
  } catch (error) {
      logError('Failed to decrypt update ID:', { update_id, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid update ID format') to res.status(400).json({ error: 'Invalid update ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid update ID format'));
    }

    // Get admin settings for comment length validation
    const adminSettings = await getAdminSettings();
    const maxCommentLength = adminSettings.comment_length;

    // Validate comment content
    const commentValidation = validateComment(comment, maxCommentLength);
    if (!commentValidation.isValid) {
      // TODO: Convert createErrorResponse(400, commentValidation.error) to res.status(400).json({ error: commentValidation.error })
      return res.status(400).json(createErrorResponse(400, commentValidation.error));
    }

    // Get update details and validate accessibility
    const update = await getUpdateDetails(decryptedUpdateId, userId);
    if (!update) {
      // TODO: Convert createErrorResponse(404, 'Post not found or not accessible') to res.status(404).json({ error: 'Post not found or not accessible' })
      return res.status(404).json(createErrorResponse(404, 'Post not found or not accessible'));
    }

    // Store comment in database
    const commentId = await storeComment(decryptedUpdateId, userId, commentValidation.comment);

    // Send notification to post owner
    await sendNotification(update.user_id, userId, decryptedUpdateId, update.notify_commented_post);

    // Get updated comment count
    const totalComments = await getCommentCount(decryptedUpdateId);

    // Get the newly created comment details
    const newComment = await getNewComment(commentId);

    const responseData = {
      success: true,
      total: totalComments === 0 ? null : totalComments,
      comment: newComment,
      update_id: update_id
    };

    logInfo('Comment stored successfully:', {
      commentId,
      updateId: decryptedUpdateId,
      userId,
    });

    // TODO: Convert createSuccessResponse('Comment stored successfully', responseData) to res.json(createSuccessResponse('Comment stored successfully', responseData))
    return res.json(createSuccessResponse('Comment stored successfully', responseData));

  } catch (error) {
    logError('Error in store comment handler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', { message: 'Failed to store comment' }) to res.status(500).json({ error: 'Internal server error', details: { message: 'Failed to store comment' } })
    return res.status(500).json(createErrorResponse(500, 'Failed to store comment'));
  }
};

/**
 * Handler for deleting comments
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} API response
 */
export const deleteComment = async (req, res) => {
  try {
    // Get authenticated user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'delete_comment' }) to getAuthenticatedUserId(req, { action: 'delete_comment' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'delete_comment' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const { comment_id } = requestBody;

    // Validate comment ID
    if (!comment_id) {
      // TODO: Convert createErrorResponse(400, 'Comment ID is required') to res.status(400).json({ error: 'Comment ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Comment ID is required'));
    }

    // Decrypt comment ID
    let decryptedCommentId;
    try {
      decryptedCommentId = safeDecryptId(comment_id);
  } catch (error) {
      logError('Failed to decrypt comment ID:', { comment_id, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid comment ID format') to res.status(400).json({ error: 'Invalid comment ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid comment ID format'));
    }

    // Get comment details and check authorization
    const comment = await getCommentDetails(decryptedCommentId);
    if (!comment) {
      // TODO: Convert createErrorResponse(404, 'Comment not found') to res.status(404).json({ error: 'Comment not found' })
      return res.status(404).json(createErrorResponse(404, 'Comment not found'));
    }

    // Check if user is authorized to delete the comment
    // User can delete if: they are the comment author, post owner, or admin
    const user = await getUserById(userId);
    const isCommentAuthor = comment.user_id === userId;
    const isPostOwner = comment.update_user_id === userId;
    const isAdmin = user.role === 'admin';

    if (!isCommentAuthor && !isPostOwner && !isAdmin) {
      // TODO: Convert createErrorResponse(403, 'Not authorized to delete this comment') to res.status(403).json({ error: 'Not authorized to delete this comment' })
      return res.status(403).json(createErrorResponse(403, 'Not authorized to delete this comment'));
    }

    // Delete the comment
    const deleteSuccess = await deleteCommentHelper(decryptedCommentId);
    if (!deleteSuccess) {
      // TODO: Convert createErrorResponse(500, 'Failed to delete comment') to res.status(500).json({ error: 'Failed to delete comment' })
    return res.status(500).json(createErrorResponse(500, 'Failed to delete comment'));
    }

    // Get updated comment count
    const totalComments = await getCommentCount(comment.updates_id);

    const responseData = {
      success: true,
      total: totalComments === 0 ? null : totalComments
    };

    logInfo('Comment deleted successfully:', {
      commentId: decryptedCommentId,
      updateId: comment.updates_id,
      userId,
      deletedBy: isCommentAuthor ? 'author' : isPostOwner ? 'post_owner' : 'admin'
    });

    // TODO: Convert createSuccessResponse('Comment deleted successfully', responseData) to res.json(createSuccessResponse('Comment deleted successfully', responseData))
    return res.json(createSuccessResponse('Comment deleted successfully', responseData));

  } catch (error) {
    logError('Error in delete comment handler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', { message: 'Failed to delete comment' }) to res.status(500).json({ error: 'Internal server error', details: { message: 'Failed to delete comment' } })
    return res.status(500).json(createErrorResponse(500, 'Failed to delete comment'));
  }
};

/**
 * Handler for post/update likes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} API response
 */
export const toggleLike = async (req, res) => {
  try {
    // Get authenticated user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'post_like' }) to getAuthenticatedUserId(req, { action: 'post_like' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'post_like' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const { update_id } = requestBody;

    // Validate update ID
    if (!update_id) {
      // TODO: Convert createErrorResponse(400, 'Update ID is required') to res.status(400).json({ error: 'Update ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Update ID is required'));
    }

    // Decrypt update ID
    let decryptedUpdateId;
    try {
      decryptedUpdateId = safeDecryptId(update_id);
  } catch (error) {
      logError('Failed to decrypt update ID:', { update_id, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid update ID format') to res.status(400).json({ error: 'Invalid update ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid update ID format'));
    }

    // Get update details and validate accessibility
    const update = await getUpdateDetails(decryptedUpdateId, userId);
    if (!update) {
      // TODO: Convert createErrorResponse(404, 'Post not found or not accessible') to res.status(404).json({ error: 'Post not found or not accessible' })
      return res.status(404).json(createErrorResponse(404, 'Post not found or not accessible'));
    }

    // Get existing like
    const existingLike = await getPostLike(decryptedUpdateId, userId);
    let newLikeStatus;
    let isLiked;

    if (existingLike) {
      // Toggle existing like
      newLikeStatus = existingLike.status === '1' ? '0' : '1';
      isLiked = newLikeStatus === '1';

      await togglePostLike(decryptedUpdateId, userId, newLikeStatus);

      // Handle notifications
      if (isLiked) {
        // Send notification for new like
        await sendPostLikeNotification(update.user_id, userId, decryptedUpdateId, update.notify_liked_post);
      } else {
        // Delete notification for unlike
        await deletePostLikeNotification(update.user_id, userId, decryptedUpdateId);
      }
    } else {
      // Create new like
      newLikeStatus = '1';
      isLiked = true;

      await togglePostLike(decryptedUpdateId, userId, newLikeStatus);

      // Send notification for new like
      await sendPostLikeNotification(update.user_id, userId, decryptedUpdateId, update.notify_liked_post);
    }

    // Get updated likes count
    const totalLikes = await getPostLikesCount(decryptedUpdateId);

    const responseData = {
      success: true,
      total: totalLikes,
      like: isLiked
    };

    logInfo('Post like toggled successfully:', {
      updateId: decryptedUpdateId,
      userId,
      isLiked,
      totalLikes
    });

    // TODO: Convert createSuccessResponse('Post like updated successfully', responseData) to res.json(createSuccessResponse('Post like updated successfully', responseData))
    return res.json(createSuccessResponse('Post like updated successfully', responseData));

  } catch (error) {
    logError('Error in post like handler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', { message: 'Failed to update post like' }) to res.status(500).json({ error: 'Internal server error', details: { message: 'Failed to update post like' } })
    return res.status(500).json(createErrorResponse(500, 'Failed to update post like'));
  }
};

/**
 * Handler for comment likes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} API response
 */
export const toggleCommentLike = async (req, res) => {
  try {
    // Get authenticated user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'comment_like' }) to getAuthenticatedUserId(req, { action: 'comment_like' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'comment_like' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const { comment_id } = requestBody;

    // Validate comment ID
    if (!comment_id) {
      // TODO: Convert createErrorResponse(400, 'Comment ID is required') to res.status(400).json({ error: 'Comment ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Comment ID is required'));
    }

    // Decrypt comment ID
    let decryptedCommentId;
    try {
      decryptedCommentId = safeDecryptId(comment_id);
    } catch (error) {
      logError('Failed to decrypt comment ID:', { comment_id, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid comment ID format') to res.status(400).json({ error: 'Invalid comment ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid comment ID format'));
    }

    // Get comment details
    const comment = await getCommentDetails(decryptedCommentId);
    if (!comment) {
      // TODO: Convert createErrorResponse(404, 'Comment not found') to res.status(404).json({ error: 'Comment not found' })
      return res.status(404).json(createErrorResponse(404, 'Comment not found'));
    }

    // Get existing like
    const existingLike = await getCommentLike(decryptedCommentId, userId);
    let isLiked;

    if (existingLike) {
      // Unlike - delete existing like
      isLiked = false;
      await toggleCommentLikeHelper(decryptedCommentId, userId);

      // Delete notification
      await deleteCommentLikeNotification(comment.user_id, userId, comment.updates_id);
    } else {
      // Like - create new like
      isLiked = true;
      await toggleCommentLikeHelper(decryptedCommentId, userId);

      // Send notification for new like
      await sendCommentLikeNotification(comment.user_id, userId, comment.updates_id, comment.notify_liked_comment);
    }

    // Get updated likes count
    const totalLikes = await getCommentLikesCount(decryptedCommentId);

    const responseData = {
      success: true,
      total: totalLikes,
      like: isLiked
    };

    logInfo('Comment like toggled successfully:', {
      commentId: decryptedCommentId,
      userId,
      isLiked,
      totalLikes
    });

    return res.json(createSuccessResponse('Comment like updated successfully', responseData));

  } catch (error) {
    logError('Error in comment like handler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', { message: 'Failed to update comment like' }) to res.status(500).json({ error: 'Internal server error', details: { message: 'Failed to update comment like' } })
    return res.status(500).json(createErrorResponse(500, 'Failed to update comment like'));
  }
};

/**
 * Pin or unpin a post handler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} API response
 */
export const pinPost = async (req, res) => {
  try {
    // Step 1: Authenticate user
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'pin post' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'pin post' })
    const authResult = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'pin post' });
    if (authResult.errorResponse) {
      // TODO: Convert return authResult.errorResponse to return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body)
      return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body);
    }
    
    const userId = authResult.userId;
    
    // Step 2: Parse request body
    let data;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      data = JSON.parse(req.body || '{}');
    } catch (error) {
      logError('[pinPostHandler] JSON parsing failed:', error.message);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON body') to res.status(400).json({ error: 'Invalid JSON body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON body'));
    }
    
    // Step 3: Validate input
    if (!data.id) {
      // TODO: Convert createErrorResponse(400, 'Post ID is required') to res.status(400).json({ error: 'Post ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }

    // Step 4: Decrypt post ID
    let updateId;
    try {
      updateId = safeDecryptId(data.id);
  } catch (error) {
      logError('[pinPostHandler] Failed to decrypt post ID:', error.message);
      // TODO: Convert createErrorResponse(400, 'Invalid post ID format') to res.status(400).json({ error: 'Invalid post ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid post ID format'));
    }
    
    if (!updateId) {
      // TODO: Convert createErrorResponse(400, 'Invalid post ID') to res.status(400).json({ error: 'Invalid post ID' })
      return res.status(400).json(createErrorResponse(400, 'Invalid post ID'));
    }
    
    // Step 5: Execute pin/unpin operation
    const result = await pinPostHelper(userId, updateId);
    
    // Step 6: Return success response
    // TODO: Convert createSuccessResponse to res.json
    return res.json(createSuccessResponse(
      `Post ${result.status === 'pin' ? 'pinned' : 'unpinned'} successfully`,
      {
        success: result.success,
        status: result.status
      }
    ));
    
  } catch (error) {
    // TODO: Convert createErrorResponse(500, 'Failed to pin/unpin post', error.message) to res.status(500).json({ error: 'Failed to pin/unpin post', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Failed to pin/unpin post'));
  }
};

/**
 * Pin or unpin a post for a user
 * @param {number} userId - The user ID
 * @param {number} updateId - The update/post ID to pin/unpin
 * @returns {Promise<Object>} Result with success status and action performed
 */
const pinPostHelper = async (userId, updateId) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Find the post to pin/unpin
    const [postRows] = await connection.query(
      'SELECT id, fixed_post FROM updates WHERE id = ? AND user_id = ? AND status = "active"',
      [updateId, userId]
    );
    
    if (postRows.length === 0) {
      throw new Error('Post not found or not authorized');
    }
    
    const post = postRows[0];
    let status, pinnedPost = false;
    
    if (post.fixed_post === '0') {
      // Pin the post
      status = 'pin';
      
      // Find current pinned post and unpin it
      const [currentPinnedRows] = await connection.query(
        'SELECT id FROM updates WHERE user_id = ? AND fixed_post = "1" AND status = "active"',
        [userId]
      );
      
      if (currentPinnedRows.length > 0) {
        await connection.query(
          'UPDATE updates SET fixed_post = "0" WHERE id = ?',
          [currentPinnedRows[0].id]
        );
        pinnedPost = true;
      }
      
      // Pin the new post
      await connection.query(
        'UPDATE updates SET fixed_post = "1" WHERE id = ?',
        [updateId]
      );
      
    } else {
      // Unpin the post
      status = 'unpin';
      await connection.query(
        'UPDATE updates SET fixed_post = "0" WHERE id = ?',
        [updateId]
      );
    }
    
    await connection.commit();
    
    return {
      success: true,
      status: status
    };
    
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};
