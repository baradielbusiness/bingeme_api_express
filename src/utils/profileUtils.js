/**
 * Profile Utilities - Database queries and helper functions for profile management
 * 
 * This file contains all database-related queries and helper functions used by
 * the profile handler, making the main handler more maintainable and testable.
 */

import { pool, getDB } from '../config/database.js';
import { RtcTokenBuilder, Role as RtcRole } from '../agora/RtcTokenBuilder2.js';
import { getAdminSettings, logInfo, logError } from './common.js';

/**
 * Get user by ID or username with specific columns
 * @param {number|string} identifier - The user ID or username to search for
 * @param {string} type - The type of search: 'id' or 'username'
 * @returns {Promise<Object|null>} User object or null if not found
 */
const getUserByIdOrUsername = async (identifier, type = 'id') => {
  // Only select required fields from users table
  const columns = `id, name, username, countries_id, avatar, cover, verified_id, story, override_currency`;
  
  let query, params;
  
  if (type === 'username') {
    query = `SELECT ${columns} FROM users WHERE username = ? AND status = "active"`;
    params = [identifier];
  } else {
    query = `SELECT ${columns} FROM users WHERE id = ?`;
    params = [identifier];
  }
  
  const [rows] = await pool.query(query, params);
  return rows[0] || null;
};

/**
 * Get user's total posts count
 * @param {number} userId - The user ID
 * @returns {Promise<number>} Total posts count
 */
const getTotalPosts = async (userId) => {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as count FROM updates 
     WHERE user_id = ? 
     AND status = 'active'
     AND (expired_at IS NULL OR expired_at >= NOW())`,
    [userId]
  );
  return rows[0].count;
};

/**
 * Get user's total subscribers count
 * @param {number} userId - The user ID
 * @returns {Promise<number>} Total subscribers count
 */
const getTotalSubscribers = async (userId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(
      `SELECT COUNT(*) as count 
       FROM subscriptions s 
       JOIN plans p ON s.stripe_price = p.name
       WHERE p.user_id = ? 
       AND p.status = "1"
       AND ((s.cancelled = 'no' AND s.ends_at > NOW()) OR (s.free = 'yes' AND s.cancelled = 'no'))`,
      [userId]
    );
    return rows[0]?.count || 0;
  } catch (error) {
    logError('Error getting total subscribers:', error);
    return 0;
  }
};

/**
 * Get user's total earnings
 * @param {number} userId - The user ID
 * @returns {Promise<number>} Total earnings
 */
const getTotalEarnings = async (userId) => {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM earnings 
     WHERE user_id = ? AND status = 'completed'`,
    [userId]
  );
  return rows[0].total;
};

/**
 * Get user's recent posts
 * @param {number} userId - The user ID
 * @param {number} limit - Number of posts to fetch
 * @returns {Promise<Array>} Array of recent posts
 */
const getRecentPosts = async (userId, limit = 5) => {
  const [rows] = await pool.query(
    `SELECT id, title, content, image, created_at 
     FROM updates 
     WHERE user_id = ? 
     AND status = 'active'
     AND (expired_at IS NULL OR expired_at >= NOW())
     ORDER BY created_at DESC 
     LIMIT ?`,
    [userId, limit]
  );
  return rows;
};

/**
 * Get user's subscription settings
 * @param {number} userId - The user ID
 * @returns {Promise<Object|null>} Subscription settings or null
 */
const getSubscriptionSettings = async (userId) => {
  const [rows] = await pool.query(
    `SELECT * FROM subscription_settings WHERE user_id = ?`,
    [userId]
  );
  return rows[0] || null;
};

/**
 * Update user's subscription settings
 * @param {number} userId - The user ID
 * @param {Object} settings - Settings to update
 * @returns {Promise<boolean>} Success status
 */
const updateSubscriptionSettings = async (userId, settings) => {
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
        user_id, monthly_price, yearly_price, is_active, description, benefits, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NOW())
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
    
    logInfo('Updated subscription settings', { userId, settings });
    return true;
    
  } catch (error) {
    logError('Error updating subscription settings', error);
    throw error;
  }
};

/**
 * Get user's profile statistics
 * @param {number} userId - The user ID
 * @returns {Promise<Object>} Profile statistics
 */
const getProfileStats = async (userId) => {
  try {
    const [postsCount] = await pool.query(
      `SELECT COUNT(*) as count FROM updates 
       WHERE user_id = ? AND status = 'active'`,
      [userId]
    );
    
    const [subscribersCount] = await pool.query(
      `SELECT COUNT(*) as count FROM subscriptions 
       WHERE creator_id = ? AND status = 'active'`,
      [userId]
    );
    
    const [earningsResult] = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM earnings 
       WHERE user_id = ? AND status = 'completed'`,
      [userId]
    );
    
    const [likesCount] = await pool.query(
      `SELECT COALESCE(SUM(likes_count), 0) as total FROM updates 
       WHERE user_id = ? AND status = 'active'`,
      [userId]
    );
    
    return {
      posts_count: postsCount[0].count,
      subscribers_count: subscribersCount[0].count,
      total_earnings: earningsResult[0].total,
      total_likes: likesCount[0].total
    };
    
  } catch (error) {
    logError('Error getting profile stats', error);
    throw error;
  }
};

/**
 * Generate Agora token for video calls
 * @param {number} userId - The user ID
 * @param {string} channelName - Channel name
 * @param {number} role - User role (1 = publisher, 2 = subscriber)
 * @returns {Promise<string>} Agora token
 */
const generateAgoraToken = async (userId, channelName, role = 1) => {
  try {
    const adminSettings = await getAdminSettings();
    const appId = adminSettings.AGORA_APP_ID;
    const appCertificate = adminSettings.AGORA_APP_CERTIFICATE;
    
    if (!appId || !appCertificate) {
      throw new Error('Agora credentials not configured');
    }
    
    const tokenExpirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + tokenExpirationTimeInSeconds;
    
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      userId,
      role,
      privilegeExpiredTs
    );
    
    logInfo('Generated Agora token', { userId, channelName, role });
    return token;
    
  } catch (error) {
    logError('Error generating Agora token', error);
    throw error;
  }
};

/**
 * Check if user is subscribed to creator
 * @param {number} userId - The user ID
 * @param {number} creatorId - The creator ID
 * @returns {Promise<boolean>} Subscription status
 */
const isUserSubscribed = async (userId, creatorId) => {
  try {
    const [rows] = await pool.query(
      `SELECT id FROM subscriptions 
       WHERE subscriber_id = ? AND creator_id = ? AND status = 'active'`,
      [userId, creatorId]
    );
    
    return rows.length > 0;
    
  } catch (error) {
    logError('Error checking subscription status', error);
    return false;
  }
};

/**
 * Get user's subscription details
 * @param {number} userId - The user ID
 * @param {number} creatorId - The creator ID
 * @returns {Promise<Object|null>} Subscription details or null
 */
const getSubscriptionDetails = async (userId, creatorId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM subscriptions 
       WHERE subscriber_id = ? AND creator_id = ? AND status = 'active'`,
      [userId, creatorId]
    );
    
    return rows[0] || null;
    
  } catch (error) {
    logError('Error getting subscription details', error);
    return null;
  }
};

/**
 * Update user's profile information
 * @param {number} userId - The user ID
 * @param {Object} profileData - Profile data to update
 * @returns {Promise<boolean>} Success status
 */
const updateProfileInfo = async (userId, profileData) => {
  try {
    const {
      name,
      username,
      story,
      countries_id,
      override_currency
    } = profileData;
    
    const query = `
      UPDATE users 
      SET name = ?, username = ?, story = ?, countries_id = ?, override_currency = ?, updated_at = NOW()
      WHERE id = ?
    `;
    
    await pool.query(query, [
      name, username, story, countries_id, override_currency, userId
    ]);
    
    logInfo('Updated profile info', { userId, profileData });
    return true;
    
  } catch (error) {
    logError('Error updating profile info', error);
    throw error;
  }
};

/**
 * Get user's profile completeness
 * @param {number} userId - The user ID
 * @returns {Promise<Object>} Profile completeness data
 */
const getProfileCompleteness = async (userId) => {
  try {
    const [user] = await pool.query(
      `SELECT name, username, avatar, cover, story, countries_id FROM users WHERE id = ?`,
      [userId]
    );
    
    if (!user[0]) {
      return { completeness: 0, missing_fields: [] };
    }
    
    const userData = user[0];
    const fields = ['name', 'username', 'avatar', 'cover', 'story', 'countries_id'];
    const missingFields = fields.filter(field => !userData[field]);
    const completeness = Math.round(((fields.length - missingFields.length) / fields.length) * 100);
    
    return {
      completeness,
      missing_fields: missingFields
    };
    
  } catch (error) {
    logError('Error getting profile completeness', error);
    return { completeness: 0, missing_fields: [] };
  }
};

/**
 * Get total followers count for a user
 * @param {number} userId - User ID
 * @returns {Promise<number>} Total followers count
 */
const getTotalFollowers = async (userId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM follow 
      WHERE creator_id = ? AND follow = "1"
    `, [userId]);
    
    return rows[0]?.count || 0;
  } catch (error) {
    logError('Error getting total followers:', error);
    return 0;
  }
};

/**
 * Get user cards data
 * @param {number} userId - User ID
 * @returns {Promise<object>} User cards data
 */
const getUserCards = async (userId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT 
        p.id, 
        p.name, 
        p.description, 
        p.price, 
        p.delivery_time,
        p.created_at,
        mp.name as image,
        COALESCE(purchase_stats.purchase_count, 0) as purchase_count
      FROM products p
      LEFT JOIN media_products mp ON p.id = mp.products_id 
        AND mp.id = (SELECT MIN(id) FROM media_products WHERE products_id = p.id)
      LEFT JOIN (
        SELECT 
          products_id,
          COUNT(*) as purchase_count
        FROM purchases 
        WHERE delivery_status != 'rejected'
        GROUP BY products_id
      ) purchase_stats ON p.id = purchase_stats.products_id
      WHERE p.user_id = ? AND p.status = "1" AND p.type = "custom"
      GROUP BY p.id, mp.name
      ORDER BY p.id DESC
    `, [userId]);
    
    return rows;
  } catch (error) {
    logError('Error getting user cards:', error);
    return [];
  }
};

/**
 * Get user updates
 * @param {number} userId - User ID
 * @param {number} limit - Limit
 * @param {number} skip - Skip
 * @returns {Promise<Array>} User updates
 */
const getUserUpdates = async (userId, authUserId) => {
  try {
    const db = await getDB();
    
    // If viewing own profile, show both active and disabled updates
    // If viewing others' profile, show only active updates
    const statusCondition = userId === authUserId 
      ? 'u.status IN ("active", "disabled")' 
      : 'u.status = "active"';
      
    const [rows] = await db.execute(`
      SELECT u.*,
          CASE WHEN u.locked = 'yes' THEN 1 ELSE 0 END as is_locked,
          CASE WHEN u.price > 0 THEN 1 ELSE 0 END as has_price,
          CASE WHEN u.fixed_post = '1' THEN 1 ELSE 0 END as is_pinned,
          DATE_FORMAT(u.expired_at, '%Y-%m-%d %H:%i:%s') as expired_at,
          u.date_utc
      FROM updates u 
      WHERE u.user_id = ? 
      AND ${statusCondition}
      AND (u.expired_at IS NULL OR u.expired_at >= NOW())
      ORDER BY CASE WHEN u.fixed_post = '1' THEN 0 ELSE 1 END, u.id DESC
      LIMIT 10
    `, [userId]);
    
    return rows;
  } catch (error) {
    logError('Error getting user updates:', error);
    return [];
  }
};

/**
 * Get updates info
 * @param {number} userId - User ID
 * @returns {Promise<object>} Updates info
 */
const getUpdatesInfo = async (userId) => {
  try {
    const db = await getDB();
    
    // First, get all active update IDs for this user
    const [updateRows] = await db.execute(`
      SELECT id FROM updates 
      WHERE user_id = ? 
      AND status = 'active'
      AND (expired_at IS NULL OR expired_at >= NOW())
    `, [userId]);
    
    const updateIds = updateRows.map(row => row.id);
    const allCount = updateIds.length;
    
    if (allCount === 0) {
      return {
        all: 0,
        photos: 0,
        videos: 0,
        custom: 0
      };
    }
    
    // Get media counts by type for these updates
    const [mediaRows] = await db.execute(`
      SELECT type, COUNT(*) as count
      FROM media 
      WHERE updates_id IN (${updateIds.map(() => '?').join(',')})
      AND status = 'active'
      GROUP BY type
    `, updateIds);
    
    // Initialize counts
    let photos = 0;
    let videos = 0;
    
    // Process media counts
    mediaRows.forEach(row => {
      switch (row.type) {
        case 'image':
          photos = row.count;
          break;
        case 'video':
          videos = row.count;
          break;
        default:
          // Other media types are not counted
          break;
      }
    });
    
    // Get shop items count
    const [shopRows] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM products 
      WHERE user_id = ? AND status = "1"
    `, [userId]);
    
    const custom = shopRows[0]?.count || 0;
    
    return {
      all: allCount,
      photos: photos,
      videos: videos,
      custom: custom
    };
  } catch (error) {
    logError('Error getting updates info:', error);
    return { all: 0, photos: 0, videos: 0, custom: 0 };
  }
};

/**
 * Get live streaming data
 * @param {number} userId - User ID
 * @returns {Promise<object>} Live streaming data
 */
const getLiveStreamingData = async (userId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT 
        id,
        title,
        description,
        status,
        viewer_count,
        created_at,
        ended_at
      FROM live_streams 
      WHERE user_id = ? 
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);
    
    if (!rows[0]) return null;
    return rows[0];
  } catch (error) {
    // If table doesn't exist or any other error, return null
    logError('Error getting live streaming data:', error);
    return null;
  }
};

/**
 * Get pre-book count
 * @param {number} userId - User ID
 * @returns {Promise<number>} Pre-book count
 */
const getPreBookCount = async (userId) => {
  try {
    const db = await getDB();
    const [rows] = await db.execute(`
      SELECT COUNT(*) as count 
      FROM pre_books 
      WHERE creator_id = ? AND status = 'active'
    `, [userId]);
    
    return rows[0]?.count || 0;
  } catch (error) {
    logError('Error getting pre-book count:', error);
    return 0;
  }
};

// Export all functions at the end
export {
  getUserByIdOrUsername,
  getTotalPosts,
  getTotalSubscribers,
  getTotalEarnings,
  getRecentPosts,
  getSubscriptionSettings,
  updateSubscriptionSettings,
  getProfileStats,
  generateAgoraToken,
  isUserSubscribed,
  getSubscriptionDetails,
  updateProfileInfo,
  getProfileCompleteness,
  getTotalFollowers,
  getUserCards,
  getUserUpdates,
  getUpdatesInfo,
  getLiveStreamingData,
  getPreBookCount
};