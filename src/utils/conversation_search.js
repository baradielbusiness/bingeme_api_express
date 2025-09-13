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

/**
 * Format relative time for display
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted relative time
 */
const formatRelativeTime = (dateString) => {
  try {
    const now = new Date();
    const messageDate = new Date(dateString);
    const diffInSeconds = Math.floor((now - messageDate) / 1000);
    
    if (diffInSeconds < 60) {
      return 'Just now';
    } else if (diffInSeconds < 3600) {
      const minutes = Math.floor(diffInSeconds / 60);
      return `${minutes}m ago`;
    } else if (diffInSeconds < 86400) {
      const hours = Math.floor(diffInSeconds / 3600);
      return `${hours}h ago`;
    } else if (diffInSeconds < 604800) {
      const days = Math.floor(diffInSeconds / 86400);
      return `${days}d ago`;
    } else {
      return messageDate.toLocaleDateString();
    }
  } catch (error) {
    logError('formatRelativeTime: Error', error);
    return 'Unknown';
  }
};

export {
  searchUsersInConversations,
  getLatestMessageInConversation,
  formatRelativeTime
};
