/**
 * @file my_updates.js
 * @description My updates utilities for Bingeme API Express.js
 * Provides functions for handling user updates, media, comments, likes, and tags
 */

import { getDB } from '../config/database.js';
import { logInfo, logError, encryptId, formatRelativeTime, getFile, getCommentLikesCount } from './common.js';

/**
 * Get media files for multiple updates
 * @param {Array<number>} updateIds - Array of update IDs
 * @returns {Promise<object>} Object mapping update IDs to their media files
 */
const getMediaForUpdates = async (updateIds) => {
  try {
    if (!updateIds || updateIds.length === 0) {
      return {};
    }

    const db = await getDB();
    
    const placeholders = updateIds.map(() => '?').join(',');
    const [rows] = await db.query(`
      SELECT updates_id, type, image, video, music, file
      FROM media 
      WHERE updates_id IN (${placeholders})
      AND status = 'active'
      ORDER BY updates_id, id
    `, updateIds);
    
    logInfo('Media query results:', { updateIds, rowsCount: rows.length, rows });
    
    // Group media by update ID
    const mediaByUpdate = {};
    rows.forEach(row => {
      if (!mediaByUpdate[row.updates_id]) {
        mediaByUpdate[row.updates_id] = [];
      }
      
      // Create simplified media object with only type and url
      let mediaItem = {
        type: row.type
      };
      
      // Add URL based on media type
      switch (row.type) {
        case 'image':
          if (row.image) {
            mediaItem.url = getFile(`images/${row.image}`);
          }
          break;
        case 'video':
          if (row.video) {
            mediaItem.url = getFile(`videos/${row.video}`);
          }
          break;
        case 'music':
          if (row.music) {
            mediaItem.url = getFile(`music/${row.music}`);
          }
          break;
        case 'file':
          if (row.file) {
            mediaItem.url = getFile(`files/${row.file}`);
          }
          break;
      }
      
      // Only add if URL was set
      if (mediaItem.url) {
        mediaByUpdate[row.updates_id].push(mediaItem);
      }
    });

    return mediaByUpdate;
  } catch (error) {
    logError('Error getting media for updates:', error);
    return {};
  }
};

/**
 * Get batch comments and likes counts for multiple updates
 * @param {Array<number>} updateIds - Array of update IDs
 * @returns {Promise<object>} Object with comments and likes counts
 */
const getBatchCommentsAndLikesCounts = async (updateIds) => {
  try {
    if (!updateIds || updateIds.length === 0) {
      return { comments: {}, likes: {} };
    }

    const db = await getDB();
    
    const placeholders = updateIds.map(() => '?').join(',');
    
    // Get comments counts
    const [commentsRows] = await db.execute(`
      SELECT 
        updates_id,
        COUNT(*) as count
      FROM comments 
      WHERE updates_id IN (${placeholders})
      GROUP BY updates_id
    `, updateIds);

    // Get likes counts
    const [likesRows] = await db.execute(`
      SELECT 
        updates_id,
        COUNT(*) as count
      FROM likes 
      WHERE updates_id IN (${placeholders})
      GROUP BY updates_id
    `, updateIds);

    // Convert to objects
    const comments = {};
    commentsRows.forEach(row => {
      comments[row.updates_id] = parseInt(row.count) || 0;
    });

    const likes = {};
    likesRows.forEach(row => {
      likes[row.updates_id] = parseInt(row.count) || 0;
    });

    return { comments, likes };
  } catch (error) {
    logError('Error getting batch comments and likes counts:', error);
    return { comments: {}, likes: {} };
  }
};

/**
 * Get latest comments for a specific update
 * @param {number} updateId - Update ID
 * @param {number} limit - Maximum number of comments to return
 * @param {number} currentUserId - Current user ID for context
 * @returns {Promise<Array>} Array of latest comments
 */
const getLatestComments = async (updateId, limit = 2, currentUserId = null) => {
  try {
    console.log('getLatestComments called with:', { updateId, limit, currentUserId });
    const db = await getDB();
    
    const [rows] = await db.query(`
      SELECT c.id, c.reply, c.date, c.date_utc, u.name, u.avatar
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.updates_id = ? AND c.status = "1"
      ORDER BY c.id DESC
      LIMIT ?
    `, [updateId, limit]);
    
    console.log('Comments query results:', { updateId, rowsCount: rows.length, rows });
    
    // Get comment IDs to check likes
    const commentIds = rows.map(comment => comment.id);
    let userLikedComments = [];
    
    // Check if current user has liked any of these comments
    if (currentUserId && commentIds.length > 0) {
      const [likeRows] = await db.query(`
        SELECT comments_id 
        FROM comments_likes 
        WHERE user_id = ? AND comments_id IN (${commentIds.map(() => '?').join(',')})
      `, [currentUserId, ...commentIds]);
      
      userLikedComments = likeRows.map(row => row.comments_id);
    }
    
    // Get likes count for each comment
    const commentsWithLikes = await Promise.all(rows.map(async (comment) => {
      const likesCount = await getCommentLikesCount(comment.id);
      return {
        ...comment,
        likes_count: likesCount
      };
    }));
    
    return commentsWithLikes.map(comment => ({
      id: encryptId(comment.id),
      name: comment.name,
      avatar: comment.avatar ? getFile(`avatar/${comment.avatar}`) : '',
      comment: comment.reply,
      date: comment.date_utc ? formatRelativeTime(comment.date_utc) : (comment.date ? formatRelativeTime(comment.date) : 'just now'),
      like: userLikedComments.includes(comment.id),
      likes_count: comment.likes_count
    }));
  } catch (error) {
    logError('Error getting latest comments:', error);
    return [];
  }
};

/**
 * Get tags for multiple updates
 * @param {Array<number>} updateIds - Array of update IDs
 * @returns {Promise<object>} Object mapping update IDs to their tags
 */
const getTagsForUpdates = async (updateIds) => {
  try {
    if (!updateIds || updateIds.length === 0) {
      return {};
    }

    const db = await getDB();
    
    const placeholders = updateIds.map(() => '?').join(',');
    const [rows] = await db.query(`
      SELECT update_tags.update_id, GROUP_CONCAT(DISTINCT CONCAT('#', tags.tag) SEPARATOR ', ') as tagname
      FROM update_tags 
      JOIN tags ON update_tags.tag_id = tags.id
      WHERE update_tags.update_id IN (${placeholders})
      GROUP BY update_tags.update_id
    `, updateIds);
    
    const tags = {};
    
    // Initialize all update IDs with empty arrays
    updateIds.forEach(id => {
      tags[id] = [];
    });
    
    // Override with actual tags where they exist
    rows.forEach(row => {
      if (row.tagname && row.tagname.trim() !== '') {
        // Convert comma-separated string to array, trim whitespace, and filter empty tags
        // Ensure each tag starts with # symbol
        tags[row.update_id] = row.tagname
          .split(',')
          .map(tag => {
            const trimmedTag = tag.trim();
            // Add # if it's missing
            return trimmedTag.startsWith('#') ? trimmedTag : `#${trimmedTag}`;
          })
          .filter(tag => tag.length > 0);
      }
      // If tagname is NULL or empty, keep the default empty array
    });

    return tags;
  } catch (error) {
    logError('Error getting tags for updates:', error);
    return {};
  }
};

/**
 * Get media type from filter parameter
 * @param {string} media - Media filter
 * @returns {string|null} Media type or null
 */
const getMediaTypeFromFilter = (media) => {
  const mediaMap = {
    'photos': 'image',
    'videos': 'video',
    'audio': 'music',
    'files': 'file',
    'shop': 'shop'
  };
  return mediaMap[media] || null;
};

/**
 * Get ORDER BY clause based on sort parameter and media type
 * @param {string} sort - Sort option
 * @param {string} mediaType - Media type (shop, image, video, etc.)
 * @returns {string} ORDER BY clause
 */
const getOrderByClause = (sort, mediaType = null) => {
  // For shop media type, only allow limited sort options
  if (mediaType === 'shop') {
    const shopSortMap = {
      'subscription': 'u.price ASC, u.id DESC',
      'oldest': 'u.id ASC',
      'latest': 'u.id DESC'
    };
    
    const baseSort = shopSortMap[sort] || 'u.id DESC';
    return baseSort; // No pinned post sorting for shop items
  }
  
  // For other media types (images, videos, etc.), keep existing logic
  const sortMap = {
    'unlockable': 'u.price DESC, u.id DESC',
    'free': 'u.price ASC, u.id DESC',
    'subscription': 'u.locked DESC, u.id DESC',
    'oldest': 'u.id ASC',
    'latest': 'u.id DESC'
  };
  
  // Always show pinned posts first, then apply the specific sort
  const baseSort = sortMap[sort] || 'u.id DESC';
  return `u.fixed_post DESC, ${baseSort}`;
};

/**
 * Extract and validate query parameters
 * @param {object} queryParams - Query parameters object
 * @returns {object} Extracted and validated parameters
 */
const extractQueryParameters = (queryParams = {}) => {
  const skip = Math.max(0, parseInt(queryParams.skip) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(queryParams.limit) || 20));
  const media = queryParams.media || null;
  const sort = queryParams.sort || null;
  
  return { skip, limit, media, sort };
};

/**
 * Execute updates queries with filtering and sorting
 * @param {number} userId - User ID
 * @param {string} mediaType - Media type filter
 * @param {string} orderBy - ORDER BY clause
 * @param {number} limit - Limit
 * @param {number} skip - Skip
 * @returns {Promise<object>} Total count and updates
 */
const executeUpdatesQueries = async (userId, mediaType, orderBy, limit, skip) => {
  try {
    // Build WHERE clause for media type filtering
    let mediaWhereClause = '';
    if (mediaType && mediaType !== 'shop') {
      mediaWhereClause = `AND EXISTS (
        SELECT 1 FROM media m 
        WHERE m.updates_id = u.id 
        AND m.status = 'active'
        AND m.type = '${mediaType}'
      )`;
    }
    
    logInfo('Executing updates query:', { userId, mediaType, orderBy, limit, skip, mediaWhereClause });
    
    // Get total count
    const db = await getDB();
    logInfo('Database connection obtained:', { dbType: typeof db });
    
    const query = `
      SELECT COUNT(*) as total
      FROM updates u
      WHERE u.user_id = ? 
        AND u.status <> 'encode'
        AND u.status IN ('active', 'disabled')
        AND (u.expired_at IS NULL OR u.expired_at >= NOW())
        ${mediaWhereClause}
    `;
    
    logInfo('Executing count query:', { query, userId, mediaWhereClause });
    
    const [countRows] = await db.query(query, [userId]);
    
    const totalUpdates = countRows[0].total;
    logInfo('Total updates count:', { totalUpdates, countRows });
    
    // Get updates with pagination
    const [updateRows] = await getDB().query(`
      SELECT 
        u.id,
        u.user_id,
        u.description,
        u.date,
        u.is_utc,
        u.fixed_post,
        u.price,
        u.expired_at,
        u.locked,
        u.status
      FROM updates u
      WHERE u.user_id = ? 
        AND u.status <> 'encode'
        AND u.status IN ('active', 'disabled')
        AND (u.expired_at IS NULL OR u.expired_at >= NOW())
        ${mediaWhereClause}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [userId, limit, skip]);
    
    logInfo('Update rows found:', { count: updateRows.length, rows: updateRows });
    
    return {
      totalUpdates,
      updates: updateRows
    };
  } catch (error) {
    logError('Error executing updates queries:', error);
    return { totalUpdates: 0, updates: [] };
  }
};

/**
 * Apply additional post query filters
 * @param {Array} updates - Updates array
 * @param {string} sort - Sort parameter
 * @returns {Array} Filtered updates
 */
const applyPostQueryFilters = (updates, sort) => {
  // For now, just return updates as-is
  // Additional filtering logic can be added here if needed
  return updates;
};

// Export all functions at the end
export {
  getMediaForUpdates,
  getBatchCommentsAndLikesCounts,
  getLatestComments,
  getTagsForUpdates,
  getMediaTypeFromFilter,
  getOrderByClause,
  extractQueryParameters,
  executeUpdatesQueries,
  applyPostQueryFilters
};