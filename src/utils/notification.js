/**
 * @file notification.js
 * @description 
 *   Notification Database Operations - Core database utilities for notification system
 *   
 *   Provides comprehensive database operations for the notification system including:
 *   - Fetching notifications with complex joins and filtering
 *   - Counting notifications for pagination
 *   - Marking notifications as seen
 *
 *   Flow:
 *   1. Execute complex SQL queries with multiple table joins
 *   2. Apply filtering based on notification types
 *   3. Handle pagination with proper limit and offset
 *   4. Update notification status for user engagement tracking
 *
 *   Key Features:
 *   - Complex multi-table joins for comprehensive notification data
 *   - Flexible filtering system for different notification types
 *   - Efficient pagination with proper indexing
 *   - Transaction-safe database operations
 */

import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

/**
 * Fetch notifications for a user with pagination and optional filtering
 * @param {number} userId - The destination user ID
 * @param {number} limit - Number of notifications to fetch
 * @param {number} skip - Number of notifications to skip (for pagination)
 * @param {Array<string>} [filterTypes] - Array of notification types to filter by
 * @returns {Promise<Array>} Array of notification rows with all related data
 */
const fetchNotifications = async (userId, limit, skip, filterTypes = null) => {
  try {
    // Base query with all necessary joins for comprehensive notification data
    const baseQuery = `
      SELECT 
        n.id as id_noty,
        n.type,
        n.created_at,
        u.id as userId,
        u.username,
        u.hide_name,
        u.name,
        u.profile_pic,
        u.verified,
        n.message_id,
        n.post_id,
        n.live_id,
        n.tip_amount,
        n.seen,
        n.extra_data
      FROM notifications n
      LEFT JOIN users u ON n.from_user_id = u.id
      WHERE n.user_id = ?
    `;
    
    let query = baseQuery;
    const params = [userId];
    
    // Add type filtering if specified
    if (filterTypes && filterTypes.length > 0) {
      const placeholders = filterTypes.map(() => '?').join(',');
      query += ` AND n.type IN (${placeholders})`;
      params.push(...filterTypes);
    }
    
    // Add ordering and pagination
    query += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, skip);
    
    const [notifications] = await pool.query(query, params);
    
    logInfo('Fetched notifications', { 
      userId, 
      count: notifications.length, 
      limit, 
      skip 
    });
    
    return notifications;
    
  } catch (error) {
    logError('Error fetching notifications', error);
    throw error;
  }
};

/**
 * Count total notifications for a user with optional filtering
 * @param {number} userId - The destination user ID
 * @param {Array<string>} [filterTypes] - Array of notification types to filter by
 * @returns {Promise<number>} Total count of notifications
 */
const countNotifications = async (userId, filterTypes = null) => {
  try {
    let query = `SELECT COUNT(*) as total FROM notifications WHERE user_id = ?`;
    const params = [userId];
    
    // Add type filtering if specified
    if (filterTypes && filterTypes.length > 0) {
      const placeholders = filterTypes.map(() => '?').join(',');
      query += ` AND type IN (${placeholders})`;
      params.push(...filterTypes);
    }
    
    const [result] = await pool.query(query, params);
    const total = result[0].total;
    
    logInfo('Counted notifications', { userId, total });
    
    return total;
    
  } catch (error) {
    logError('Error counting notifications', error);
    throw error;
  }
};

/**
 * Mark notifications as seen for a user
 * @param {number} userId - The user ID
 * @param {Array<number>} [notificationIds] - Specific notification IDs to mark as seen (optional)
 * @returns {Promise<boolean>} Success status
 */
const markNotificationsAsSeen = async (userId, notificationIds = null) => {
  try {
    let query;
    let params;
    
    if (notificationIds && notificationIds.length > 0) {
      // Mark specific notifications as seen
      const placeholders = notificationIds.map(() => '?').join(',');
      query = `UPDATE notifications SET seen = 1 WHERE user_id = ? AND id IN (${placeholders})`;
      params = [userId, ...notificationIds];
    } else {
      // Mark all notifications as seen
      query = `UPDATE notifications SET seen = 1 WHERE user_id = ? AND seen = 0`;
      params = [userId];
    }
    
    const [result] = await pool.query(query, params);
    const affectedRows = result.affectedRows;
    
    logInfo('Marked notifications as seen', { 
      userId, 
      affectedRows,
      specificIds: notificationIds 
    });
    
    return affectedRows > 0;
    
  } catch (error) {
    logError('Error marking notifications as seen', error);
    throw error;
  }
};

/**
 * Create a new notification
 * @param {Object} notificationData - Notification data
 * @returns {Promise<number>} Created notification ID
 */
const createNotification = async (notificationData) => {
  try {
    const {
      user_id,
      from_user_id,
      type,
      message_id = null,
      post_id = null,
      live_id = null,
      tip_amount = null,
      extra_data = null
    } = notificationData;
    
    const query = `
      INSERT INTO notifications (
        user_id, from_user_id, type, message_id, post_id, live_id, tip_amount, extra_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [
      user_id, from_user_id, type, message_id, post_id, live_id, tip_amount, 
      extra_data ? JSON.stringify(extra_data) : null
    ]);
    
    const notificationId = result.insertId;
    
    logInfo('Created notification', { 
      notificationId, 
      user_id, 
      from_user_id, 
      type 
    });
    
    return notificationId;
    
  } catch (error) {
    logError('Error creating notification', error);
    throw error;
  }
};

/**
 * Delete notifications for a user
 * @param {number} userId - The user ID
 * @param {Array<number>} [notificationIds] - Specific notification IDs to delete (optional)
 * @returns {Promise<boolean>} Success status
 */
const deleteNotifications = async (userId, notificationIds = null) => {
  try {
    let query;
    let params;
    
    if (notificationIds && notificationIds.length > 0) {
      // Delete specific notifications
      const placeholders = notificationIds.map(() => '?').join(',');
      query = `DELETE FROM notifications WHERE user_id = ? AND id IN (${placeholders})`;
      params = [userId, ...notificationIds];
    } else {
      // Delete all notifications for user
      query = `DELETE FROM notifications WHERE user_id = ?`;
      params = [userId];
    }
    
    const [result] = await pool.query(query, params);
    const affectedRows = result.affectedRows;
    
    logInfo('Deleted notifications', { 
      userId, 
      affectedRows,
      specificIds: notificationIds 
    });
    
    return affectedRows > 0;
    
  } catch (error) {
    logError('Error deleting notifications', error);
    throw error;
  }
};

/**
 * Get notification settings for a user
 * @param {number} userId - The user ID
 * @returns {Promise<Object>} Notification settings
 */
const getNotificationSettings = async (userId) => {
  try {
    const query = `
      SELECT 
        push_notifications,
        email_notifications,
        message_notifications,
        post_notifications,
        live_notifications,
        tip_notifications
      FROM notification_settings 
      WHERE user_id = ?
    `;
    
    const [rows] = await pool.query(query, [userId]);
    
    if (rows.length === 0) {
      // Return default settings if none exist
      return {
        push_notifications: 1,
        email_notifications: 1,
        message_notifications: 1,
        post_notifications: 1,
        live_notifications: 1,
        tip_notifications: 1
      };
    }
    
    return rows[0];
    
  } catch (error) {
    logError('Error getting notification settings', error);
    throw error;
  }
};

/**
 * Update notification settings for a user
 * @param {number} userId - The user ID
 * @param {Object} settings - Notification settings to update
 * @returns {Promise<boolean>} Success status
 */
const updateNotificationSettings = async (userId, settings) => {
  try {
    const {
      push_notifications,
      email_notifications,
      message_notifications,
      post_notifications,
      live_notifications,
      tip_notifications
    } = settings;
    
    const query = `
      INSERT INTO notification_settings (
        user_id, push_notifications, email_notifications, message_notifications,
        post_notifications, live_notifications, tip_notifications, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        push_notifications = VALUES(push_notifications),
        email_notifications = VALUES(email_notifications),
        message_notifications = VALUES(message_notifications),
        post_notifications = VALUES(post_notifications),
        live_notifications = VALUES(live_notifications),
        tip_notifications = VALUES(tip_notifications),
        updated_at = NOW()
    `;
    
    await pool.query(query, [
      userId, push_notifications, email_notifications, message_notifications,
      post_notifications, live_notifications, tip_notifications
    ]);
    
    logInfo('Updated notification settings', { userId, settings });
    
    return true;
    
  } catch (error) {
    logError('Error updating notification settings', error);
    throw error;
  }
};

export {
  fetchNotifications,
  countNotifications,
  markNotificationsAsSeen,
  createNotification,
  deleteNotifications,
  getNotificationSettings,
  updateNotificationSettings
};
