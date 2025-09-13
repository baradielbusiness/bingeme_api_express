import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Get user messages by ID
 */
export const getUserMessagesById = async (userId, otherUserId, skip = 0, limit = 20) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 20;

    const query = `
      SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.tip,
        m.conversations_id,
        COUNT(mm.id) as media_count,
        GROUP_CONCAT(
          CONCAT(mm.id, ':', mm.media_path, ':', mm.media_type, ':', mm.media_size)
          SEPARATOR '|'
        ) as media
      FROM messages m
      LEFT JOIN media_messages mm ON m.id = mm.message_id AND mm.status != "deleted"
      WHERE ((m.from_user_id = ? AND m.to_user_id = ?) 
         OR (m.from_user_id = ? AND m.to_user_id = ?))
        AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip, m.conversations_id
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [messages] = await pool.query(query, [userId, otherUserId, otherUserId, userId, limitNum, skipNum]);
    return messages;
  } catch (error) {
    logError('Error getting user messages by ID:', error);
    throw error;
  }
};

/**
 * Get user messages by username
 */
export const getUserMessagesByUsername = async (userId, username, skip = 0, limit = 20) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 20;

    const query = `
      SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.tip,
        m.conversations_id,
        COUNT(mm.id) as media_count,
        GROUP_CONCAT(
          CONCAT(mm.id, ':', mm.media_path, ':', mm.media_type, ':', mm.media_size)
          SEPARATOR '|'
        ) as media
      FROM messages m
      JOIN users u ON (
        (m.from_user_id = u.id AND m.to_user_id = ?) OR 
        (m.to_user_id = u.id AND m.from_user_id = ?)
      )
      LEFT JOIN media_messages mm ON m.id = mm.message_id AND mm.status != "deleted"
      WHERE u.username = ? AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip, m.conversations_id
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [messages] = await pool.query(query, [userId, userId, username, limitNum, skipNum]);
    return messages;
  } catch (error) {
    logError('Error getting user messages by username:', error);
    throw error;
  }
};

/**
 * Format messages by date
 */
export const formatMessagesByDate = (messages) => {
  const groupedMessages = {};
  
  messages.forEach(message => {
    const date = new Date(message.created_at).toDateString();
    if (!groupedMessages[date]) {
      groupedMessages[date] = [];
    }
    groupedMessages[date].push(message);
  });

  return groupedMessages;
};

/**
 * Validate user access to message
 */
export const validateUserAccess = async (messageId, userId) => {
  try {
    const query = `
      SELECT id FROM messages 
      WHERE id = ? AND (from_user_id = ? OR to_user_id = ?) AND status != "deleted"
    `;
    
    const [rows] = await pool.query(query, [messageId, userId, userId]);
    return rows.length > 0;
  } catch (error) {
    logError('Error validating user access:', error);
    return false;
  }
};

/**
 * Validate user by username
 */
export const validateUserByUsername = async (username) => {
  try {
    const query = `SELECT id, username, name, avatar, verified_id FROM users WHERE username = ?`;
    const [rows] = await pool.query(query, [username]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error validating user by username:', error);
    return null;
  }
};

/**
 * Get message by ID
 */
export const getMessageById = async (messageId) => {
  try {
    const query = `
      SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.tip,
        m.conversations_id,
        COUNT(mm.id) as media_count,
        GROUP_CONCAT(
          CONCAT(mm.id, ':', mm.media_path, ':', mm.media_type, ':', mm.media_size)
          SEPARATOR '|'
        ) as media
      FROM messages m
      LEFT JOIN media_messages mm ON m.id = mm.message_id AND mm.status != "deleted"
      WHERE m.id = ? AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip, m.conversations_id
    `;

    const [rows] = await pool.query(query, [messageId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting message by ID:', error);
    return null;
  }
};

/**
 * Mark message as deleted
 */
export const markMessageDeleted = async (messageId) => {
  try {
    const query = `UPDATE messages SET deleted = 1 WHERE id = ?`;
    await pool.query(query, [messageId]);
    logInfo(`Marked message ${messageId} as deleted`);
  } catch (error) {
    logError('Error marking message as deleted:', error);
    throw error;
  }
};

/**
 * Mark media messages as deleted
 */
export const markMediaMessagesDeleted = async (messageId) => {
  try {
    const query = `UPDATE media_messages SET deleted = 1 WHERE message_id = ?`;
    await pool.query(query, [messageId]);
    logInfo(`Marked media messages for message ${messageId} as deleted`);
  } catch (error) {
    logError('Error marking media messages as deleted:', error);
    throw error;
  }
};

/**
 * Remove message notifications
 */
export const removeMessageNotifications = async (messageId) => {
  try {
    const query = `DELETE FROM notifications WHERE message_id = ?`;
    await pool.query(query, [messageId]);
    logInfo(`Removed notifications for message ${messageId}`);
  } catch (error) {
    logError('Error removing message notifications:', error);
    throw error;
  }
};

/**
 * Count active messages
 */
export const countActiveMessages = async (conversationId) => {
  try {
    const query = `SELECT COUNT(*) as count FROM messages WHERE conversations_id = ? AND status != "deleted"`;
    const [rows] = await pool.query(query, [conversationId]);
    return rows[0].count;
  } catch (error) {
    logError('Error counting active messages:', error);
    return 0;
  }
};

/**
 * Count active messages on a specific day
 */
export const countActiveMessagesOnDay = async (conversationId, date) => {
  try {
    const query = `
      SELECT COUNT(*) as count 
      FROM messages 
      WHERE conversations_id = ? AND status != "deleted" 
        AND DATE(created_at) = DATE(?)
    `;
    const [rows] = await pool.query(query, [conversationId, date]);
    return rows[0].count;
  } catch (error) {
    logError('Error counting active messages on day:', error);
    return 0;
  }
};

/**
 * Get conversation by ID
 */
export const getConversationById = async (conversationId) => {
  try {
    const query = `SELECT * FROM conversations WHERE id = ?`;
    const [rows] = await pool.query(query, [conversationId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting conversation by ID:', error);
    return null;
  }
};

/**
 * Set conversation as inactive
 */
export const setConversationInactive = async (conversationId) => {
  try {
    const query = `UPDATE conversations SET active = 0 WHERE id = ?`;
    await pool.query(query, [conversationId]);
    logInfo(`Set conversation ${conversationId} as inactive`);
  } catch (error) {
    logError('Error setting conversation as inactive:', error);
    throw error;
  }
};

/**
 * Update conversation timestamp
 */
export const updateConversationTimestamp = async (conversationId, timestamp) => {
  try {
    const query = `UPDATE conversations SET updated_at = ? WHERE id = ?`;
    await pool.query(query, [timestamp, conversationId]);
    logInfo(`Updated conversation ${conversationId} timestamp`);
  } catch (error) {
    logError('Error updating conversation timestamp:', error);
    throw error;
  }
};

/**
 * Get latest message time
 */
export const getLatestMessageTime = async (conversationId) => {
  try {
    const query = `
      SELECT MAX(created_at) as latest_time 
      FROM messages 
      WHERE conversations_id = ? AND status != "deleted"
    `;
    const [rows] = await pool.query(query, [conversationId]);
    return rows[0].latest_time;
  } catch (error) {
    logError('Error getting latest message time:', error);
    return null;
  }
};

/**
 * Get message by ID with details
 */
export const getMessageByIdWithDetails = async (messageId) => {
  try {
    const query = `
      SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.tip,
        m.conversations_id,
        u1.username as from_username,
        u1.name as from_name,
        u1.avatar as from_avatar,
        u1.verified_id as from_verified,
        u2.username as to_username,
        u2.name as to_name,
        u2.avatar as to_avatar,
        u2.verified_id as to_verified,
        COUNT(mm.id) as media_count,
        GROUP_CONCAT(
          CONCAT(mm.id, ':', mm.media_path, ':', mm.media_type, ':', mm.media_size)
          SEPARATOR '|'
        ) as media
      FROM messages m
      LEFT JOIN users u1 ON m.from_user_id = u1.id
      LEFT JOIN users u2 ON m.to_user_id = u2.id
      LEFT JOIN media_messages mm ON m.id = mm.message_id AND mm.status != "deleted"
      WHERE m.id = ? AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip, m.conversations_id, u1.username, u1.name, u1.avatar, u1.verified_id, u2.username, u2.name, u2.avatar, u2.verified_id
    `;

    const [rows] = await pool.query(query, [messageId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting message by ID with details:', error);
    return null;
  }
};
