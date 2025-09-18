/**
 * @file my_updates.js
 * @description My updates utilities for Bingeme API Express.js
 * Provides functions for handling user updates, media, comments, likes, and tags
 */

import { getDB } from '../config/database.js';
import { logInfo, logError } from './common.js';

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
    const [mediaRows] = await db.execute(`
      SELECT 
        update_id,
        id,
        file_name,
        file_type,
        file_size,
        created_at
      FROM media 
      WHERE update_id IN (${placeholders})
      ORDER BY update_id, created_at ASC
    `, updateIds);

    // Group media by update_id
    const mediaByUpdate = {};
    mediaRows.forEach(media => {
      if (!mediaByUpdate[media.update_id]) {
        mediaByUpdate[media.update_id] = [];
      }
      mediaByUpdate[media.update_id].push({
        id: media.id,
        file_name: media.file_name,
        file_type: media.file_type,
        file_size: media.file_size,
        created_at: media.created_at
      });
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
        update_id,
        COUNT(*) as count
      FROM comments 
      WHERE update_id IN (${placeholders})
      GROUP BY update_id
    `, updateIds);

    // Get likes counts
    const [likesRows] = await db.execute(`
      SELECT 
        update_id,
        COUNT(*) as count
      FROM likes 
      WHERE update_id IN (${placeholders})
      GROUP BY update_id
    `, updateIds);

    // Convert to objects
    const comments = {};
    commentsRows.forEach(row => {
      comments[row.update_id] = parseInt(row.count) || 0;
    });

    const likes = {};
    likesRows.forEach(row => {
      likes[row.update_id] = parseInt(row.count) || 0;
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
    const db = await getDB();
    
    const [commentRows] = await db.execute(`
      SELECT 
        c.id,
        c.user_id,
        c.comment,
        c.created_at,
        u.username,
        u.avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.update_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `, [updateId, limit]);

    return commentRows.map(comment => ({
      id: comment.id,
      user_id: comment.user_id,
      comment: comment.comment,
      created_at: comment.created_at,
      username: comment.username,
      avatar: comment.avatar
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
    const [tagRows] = await db.execute(`
      SELECT 
        ut.update_id,
        t.id,
        t.name
      FROM update_tags ut
      LEFT JOIN tags t ON ut.tag_id = t.id
      WHERE ut.update_id IN (${placeholders})
      ORDER BY ut.update_id, t.name ASC
    `, updateIds);

    // Group tags by update_id
    const tagsByUpdate = {};
    tagRows.forEach(tag => {
      if (!tagsByUpdate[tag.update_id]) {
        tagsByUpdate[tag.update_id] = [];
      }
      tagsByUpdate[tag.update_id].push({
        id: tag.id,
        name: tag.name
      });
    });

    return tagsByUpdate;
  } catch (error) {
    logError('Error getting tags for updates:', error);
    return {};
  }
};

// Export all functions at the end
export {
  getMediaForUpdates,
  getBatchCommentsAndLikesCounts,
  getLatestComments,
  getTagsForUpdates
};