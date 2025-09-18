import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Standard API response payload builder (used by controllers)
 */
const createApiResponse = (status, message, data = null, error = null) => {
  return {
    status,
    message,
    ...(data && { data }),
    ...(error && { error }),
    timestamp: new Date().toISOString()
  };
};

/**
 * Get support users by their IDs
 */
const getSupportUsersByIds = async (supportIds = []) => {
  try {
    if (!Array.isArray(supportIds) || supportIds.length === 0) {
      return [];
    }
    const placeholders = supportIds.map(() => '?').join(',');
    const query = `
      SELECT id, username, name, avatar, verified
      FROM users
      WHERE id IN (${placeholders}) AND status != "deleted"
    `;
    const [rows] = await pool.query(query, supportIds);
    return rows;
  } catch (error) {
    logError('Error fetching support users by IDs:', error);
    throw error;
  }
};

/**
 * Find users by search query with optional exclusions and support-only filter
 */
const getUsersBySearch = async ({ excludedUserIds = [], searchTerm = '', supportIds = [], type = null }) => {
  try {
    const params = [];
    let whereClauses = ['status != "deleted"'];

    // Search term on username or name
    if (searchTerm && String(searchTerm).trim().length > 0) {
      const pattern = `%${String(searchTerm).trim()}%`;
      whereClauses.push('(username LIKE ? OR name LIKE ?)');
      params.push(pattern, pattern);
    }

    // Exclude specific users
    if (Array.isArray(excludedUserIds) && excludedUserIds.length > 0) {
      const placeholders = excludedUserIds.map(() => '?').join(',');
      whereClauses.push(`id NOT IN (${placeholders})`);
      params.push(...excludedUserIds);
    }

    // If supportIds provided and type indicates support, restrict to supportIds
    if (Array.isArray(supportIds) && supportIds.length > 0 && (type === 'support' || type === 'only_support')) {
      const placeholders = supportIds.map(() => '?').join(',');
      whereClauses.push(`id IN (${placeholders})`);
      params.push(...supportIds);
    }

    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT id, username, name, avatar, verified
      FROM users
      ${whereSql}
      ORDER BY name ASC
      LIMIT 50
    `;

    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    logError('Error searching users:', error);
    throw error;
  }
};

/**
 * Get user inbox with media attachments
 */
const getUserInboxWithMedia = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

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
        ) as media,
        c.room_id
      FROM messages m
      LEFT JOIN media_messages mm ON m.id = mm.message_id AND mm.status != "deleted"
      LEFT JOIN conversations c ON m.conversations_id = c.id
      WHERE (m.from_user_id = ? OR m.to_user_id = ?) 
        AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip, m.conversations_id, c.room_id
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [messages] = await pool.query(query, [userId, userId, limitNum, skipNum]);

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT m.id) as total
      FROM messages m
      WHERE (m.from_user_id = ? OR m.to_user_id = ?) 
        AND m.status != "deleted"
    `;
    const [countResult] = await pool.query(countQuery, [userId, userId]);
    const totalMessages = countResult[0].total;

    // Get conversation room mapping
    const conversationRoomMap = {};
    messages.forEach(msg => {
      if (msg.room_id) {
        conversationRoomMap[msg.conversations_id] = msg.room_id;
      }
    });

    return {
      messages,
      totalMessages,
      conversationRoomMap
    };
  } catch (error) {
    logError('Error getting user inbox with media:', error);
    throw error;
  }
};

/**
 * Get users map for message formatting
 */
const fetchUsersMap = async (userIds) => {
  try {
    if (!userIds || userIds.length === 0) return {};

    const placeholders = userIds.map(() => '?').join(',');
    const query = `
      SELECT id, username, name, avatar, verified
      FROM users 
      WHERE id IN (${placeholders})
    `;
    
    const [users] = await pool.query(query, userIds);
    
    const usersMap = {};
    users.forEach(user => {
      usersMap[user.id] = {
        id: user.id,
        username: user.username,
        name: user.name,
        avatar: user.avatar,
        verified_id: user.verified_id
      };
    });

    return usersMap;
  } catch (error) {
    logError('Error fetching users map:', error);
    throw error;
  }
};

/**
 * Get message and conversation IDs for deletion
 */
const getMessageAndConversationIds = async (userId, otherUserId) => {
  try {
    const query = `
      SELECT DISTINCT m.id as message_id, m.conversations_id
      FROM messages m
      WHERE ((m.from_user_id = ? AND m.to_user_id = ?) 
         OR (m.from_user_id = ? AND m.to_user_id = ?))
        AND m.status != "deleted"
    `;
    
    const [rows] = await pool.query(query, [userId, otherUserId, otherUserId, userId]);
    
    const messageIds = rows.map(row => row.message_id);
    const conversationIds = [...new Set(rows.map(row => row.conversations_id))];
    
    return { messageIds, conversationIds };
  } catch (error) {
    logError('Error getting message and conversation IDs:', error);
    throw error;
  }
};

/**
 * Mark media messages as deleted
 */
const markMediaMessagesDeleted = async (messageIds) => {
  try {
    if (!messageIds || messageIds.length === 0) return;

    const placeholders = messageIds.map(() => '?').join(',');
    const query = `
      UPDATE media_messages 
      SET deleted = 1 
      WHERE message_id IN (${placeholders})
    `;
    
    await pool.query(query, messageIds);
    logInfo(`Marked ${messageIds.length} media messages as deleted`);
  } catch (error) {
    logError('Error marking media messages as deleted:', error);
    throw error;
  }
};

/**
 * Mark messages as deleted
 */
const markMessagesDeleted = async (messageIds) => {
  try {
    if (!messageIds || messageIds.length === 0) return;

    const placeholders = messageIds.map(() => '?').join(',');
    const query = `
      UPDATE messages 
      SET deleted = 1 
      WHERE id IN (${placeholders})
    `;
    
    await pool.query(query, messageIds);
    logInfo(`Marked ${messageIds.length} messages as deleted`);
  } catch (error) {
    logError('Error marking messages as deleted:', error);
    throw error;
  }
};

/**
 * Mark conversations as inactive
 */
const markConversationsInactive = async (conversationIds) => {
  try {
    if (!conversationIds || conversationIds.length === 0) return;

    const placeholders = conversationIds.map(() => '?').join(',');
    const query = `
      UPDATE conversations 
      SET active = 0 
      WHERE id IN (${placeholders})
    `;
    
    await pool.query(query, conversationIds);
    logInfo(`Marked ${conversationIds.length} conversations as inactive`);
  } catch (error) {
    logError('Error marking conversations as inactive:', error);
    throw error;
  }
};

/**
 * Remove user notifications
 */
const removeUserNotifications = async (userId, messageIds) => {
  try {
    if (!messageIds || messageIds.length === 0) return;

    const placeholders = messageIds.map(() => '?').join(',');
    const query = `
      DELETE FROM notifications 
      WHERE user_id = ? AND message_id IN (${placeholders})
    `;
    
    await pool.query(query, [userId, ...messageIds]);
    logInfo(`Removed notifications for user ${userId} and ${messageIds.length} messages`);
  } catch (error) {
    logError('Error removing user notifications:', error);
    throw error;
  }
};

/**
 * Search conversations by username or name
 */
const searchConversations = async (userId, searchTerm, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT DISTINCT
        m.id,
        m.from_user_id,
        m.to_user_id,
        m.message,
        m.created_at,
        m.status,
        m.tip,
        m.conversations_id,
        u.id as user_id,
        u.username,
        u.name,
        u.avatar,
        u.verified_id,
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
      WHERE (u.username LIKE ? OR u.name LIKE ?)
        AND m.status != "deleted"
      GROUP BY m.id, m.from_user_id, m.to_user_id, m.message, m.created_at, m.status, m.tip, m.conversations_id, u.id, u.username, u.name, u.avatar, u.verified
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const searchPattern = `%${searchTerm}%`;
    const [messages] = await pool.query(query, [userId, userId, searchPattern, searchPattern, limitNum, skipNum]);

    return messages;
  } catch (error) {
    logError('Error searching conversations:', error);
    throw error;
  }
};

/**
 * Find or create conversation between two users
 */
const findOrCreateConversation = async (userId1, userId2) => {
  try {
    // First, try to find existing conversation
    const findQuery = `
      SELECT id FROM conversations 
      WHERE ((user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?))
        AND active = 1
      LIMIT 1
    `;
    
    const [existing] = await pool.query(findQuery, [userId1, userId2, userId2, userId1]);
    
    if (existing.length > 0) {
      logInfo(`Found existing conversation: ${existing[0].id}`);
      return existing[0].id;
    }

    // Create new conversation
    const insertQuery = `
      INSERT INTO conversations (user1_id, user2_id, active, created_at) 
      VALUES (?, ?, 1, NOW())
    `;
    
    const [result] = await pool.query(insertQuery, [userId1, userId2]);
    const conversationId = result.insertId;
    
    logInfo(`Created new conversation: ${conversationId}`);
    return conversationId;
  } catch (error) {
    logError('Error finding or creating conversation:', error);
    throw error;
  }
};

// Export all functions at the end
export {
  createApiResponse,
  getSupportUsersByIds,
  getUsersBySearch,
  getUserInboxWithMedia,
  fetchUsersMap,
  getMessageAndConversationIds,
  markMediaMessagesDeleted,
  markMessagesDeleted,
  markConversationsInactive,
  removeUserNotifications,
  searchConversations,
  findOrCreateConversation
};