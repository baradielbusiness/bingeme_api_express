/**
 * @file conversationSearch.js
 * @description Utility functions for searching conversations in the Bingeme API.
 *
 * Provides:
 * - User search within active conversations (by name/username).
 * - Latest message retrieval with media/unread info.
 * - Consistent formatting for API responses.
 *
 * Database tables used:
 * - users
 * - conversations
 * - messages
 * - media_messages
 */

import { pool } from '../config/database.js';
import { logError, logInfo, formatRelativeTime, getFile } from './common.js';

/**
 * Search for users by username or name within user's conversation list
 * @param {number} userId - Authenticated user ID
 * @param {string} searchTerm - Search term to match against username or name
 * @returns {Array} Array of user objects with conversation status
 */
const searchUsersInConversations = async (userId, searchTerm) => {
  try {
    logInfo('searchUsersInConversations: Starting search', { userId, searchTerm });
    
    // Get all users that the authenticated user has conversations with
    const conversationUsersQuery = `
      SELECT DISTINCT 
        CASE 
          WHEN user_1 = ? THEN user_2 
          ELSE user_1 
        END as other_user_id
      FROM conversations 
      WHERE (user_1 = ? OR user_2 = ?) 
        AND status = 1
    `;
    
    const [conversationRows] = await pool.query(conversationUsersQuery, [
      userId, userId, userId
    ]);
    
    const conversationUserIds = conversationRows.map(({ other_user_id }) => other_user_id);
    
    logInfo('searchUsersInConversations: Found conversation users', { 
      conversationUserIds,
      count: conversationUserIds.length
    });
    
    if (conversationUserIds.length === 0) {
      return [];
    }
    
    // Search for users within conversation list
    const placeholders = conversationUserIds.map(() => '?').join(',');
    const searchQuery = `
      SELECT 
        u.id,
        u.username,
        u.name,
        u.avatar,
        u.verified_id,
        u.last_seen,
        c.id as conversation_id,
        c.updated_at as conversation_updated_at
      FROM users u
      JOIN conversations c ON (
        (c.user_1 = ? AND c.user_2 = u.id) OR 
        (c.user_2 = ? AND c.user_1 = u.id)
      )
      WHERE u.id IN (${placeholders})
        AND (u.username LIKE ? OR u.name LIKE ?)
        AND u.status != "deleted"
        AND c.status = 1
      ORDER BY c.updated_at DESC
    `;
    
    const searchPattern = `%${searchTerm}%`;
    const [userRows] = await pool.query(searchQuery, [
      userId, userId, ...conversationUserIds, searchPattern, searchPattern
    ]);
    
    logInfo('searchUsersInConversations: Found matching users', { 
      count: userRows.length 
    });
    
    // Get latest message for each conversation
    const usersWithMessages = await Promise.all(
      userRows.map(async (user) => {
        const latestMessage = await getLatestMessageInConversation(user.conversation_id, userId);
        return {
          ...user,
          latest_message: latestMessage
        };
      })
    );
    
    return usersWithMessages;
  } catch (error) {
    logError('searchUsersInConversations: Error', error);
    throw error;
  }
};

/**
 * Get the latest message in a conversation
 * @param {number} conversationId - Conversation ID
 * @param {number} userId - Authenticated user ID
 * @returns {Object|null} Latest message object or null
 */
const getLatestMessageInConversation = async (conversationId, userId) => {
  try {
    const messageQuery = `
      SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.tip,
        COUNT(mm.id) as media_count,
        GROUP_CONCAT(
          CONCAT(mm.id, ':', mm.media_path, ':', mm.media_type, ':', mm.media_size)
          SEPARATOR '|'
        ) as media
      FROM messages m
      LEFT JOIN media_messages mm ON m.id = mm.message_id AND mm.status != "deleted"
      WHERE m.conversations_id = ? 
        AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip
      ORDER BY m.created_at DESC
      LIMIT 1
    `;
    
    const [messageRows] = await pool.query(messageQuery, [conversationId]);
    
    if (messageRows.length === 0) {
      return null;
    }
    
    const message = messageRows[0];
    
    // Format media if exists
    let media = [];
    if (message.media) {
      media = message.media.split('|').map(mediaItem => {
        const [id, path, type, size] = mediaItem.split(':');
        return {
          id: parseInt(id),
          media_path: path,
          media_type: type,
          media_size: parseInt(size)
        };
      });
    }
    
    return {
      id: message.id,
      from_user_id: message.from_user_id,
      to_user_id: message.to_user_id,
      message: message.message,
      created_at: message.created_at,
      status: message.status,
      tip: message.tip,
      media_count: message.media_count,
      media: media,
      is_from_me: message.from_user_id === userId,
      relative_time: formatRelativeTime(message.created_at)
    };
  } catch (error) {
    logError('getLatestMessageInConversation: Error', error);
    return null;
  }
};

export {
  searchUsersInConversations,
  getLatestMessageInConversation,
  getLatestMessageForConversation,
  formatMessageForResponse
};

/**
 * Get latest message for a specific conversation (Lambda-aligned shape)
 * @param {number} currentUserId - Authenticated user ID
 * @param {number} otherUserId - Other user ID (not used in query but kept for parity)
 * @param {number} conversationId - Conversation ID
 * @param {Object} db - Optional DB connection (uses pool if not provided)
 * @returns {Promise<Object|null>} Latest message row or null
 */
const getLatestMessageForConversation = async (currentUserId, otherUserId, conversationId, db) => {
  try {
    const conn = db || pool;
    const query = `
      SELECT 
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.price,
        m.tip,
        m.tip_amount,
        m.expires_at,
        NULL as media,
        COALESCE(m3.count, 0) as count,
        c.room_id
      FROM messages m
      LEFT JOIN conversations c ON m.conversations_id = c.id
      LEFT JOIN (
        SELECT conversations_id, COUNT(id) as count 
        FROM messages 
        WHERE conversations_id = ? AND status = 'new' AND to_user_id = ?
        GROUP BY conversations_id
      ) m3 ON m.conversations_id = m3.conversations_id
      WHERE m.conversations_id = ? AND m.status != 'deleted'
      ORDER BY m.created_at DESC
      LIMIT 1
    `;
    const exec = conn.execute ? conn.execute.bind(conn) : conn.query.bind(conn);
    const [rows] = await exec(query, [conversationId, currentUserId, conversationId]);
    if (!rows || rows.length === 0) {
      return null;
    }
    return rows[0];
  } catch (error) {
    logError('getLatestMessageForConversation error:', error);
    return null;
  }
};

/**
 * Format message row to API response (Lambda-aligned)
 * @param {Object} message - Message DB row
 * @param {Object} user - Other user object { id, name, username, avatar }
 * @param {number} currentUserId - Authenticated user ID
 * @returns {Object}
 */
const formatMessageForResponse = (message, user, currentUserId) => {
  try {
    const { id, from_user_id, message: messageText, created_at, status, media, count, tip, room_id } = message;
    const { id: userId, name, username, avatar } = user;

    const currentUserIdInt = parseInt(currentUserId);
    const fromUserIdInt = parseInt(from_user_id);
    const userIdInt = parseInt(userId);

    const msgType = fromUserIdInt === currentUserIdInt ? 'outgoing' : 'incoming';
    const time = formatRelativeTime(created_at);
    const messageStatus = status === 'new' ? 'new' : 'read';
    const mediaType = media ? (typeof media === 'string' ? media.split(',')[0] : null) : null;
    const isTip = tip === 1 || tip === '1';

    return {
      id,
      message: messageText,
      time,
      status: messageStatus,
      tip: isTip,
      media: mediaType,
      unread_count: parseInt(count) || 0,
      msg_type: msgType,
      chat_user: {
        id: userIdInt,
        name,
        username,
        avatar: avatar ? getFile(`avatar/${avatar}`) : getFile('avatar/default-1671797639.jpeg'),
        room_id: room_id || ''
      }
    };
  } catch (error) {
    logError('formatMessageForResponse error:', error);
    return null;
  }
};
