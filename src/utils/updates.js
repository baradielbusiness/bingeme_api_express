import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';
import { v4 as uuidv4 } from 'uuid';
import { validateMediaArray } from './mediaProcessing.js';

/**
 * Get user updates list
 */
const getUserUpdatesList = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT 
        id,
        user_id,
        title,
        content,
        image,
        created_at,
        updated_at
      FROM updates 
      WHERE user_id = ? AND status != "deleted"
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [updates] = await pool.query(query, [userId, limitNum, skipNum]);
    return updates;
  } catch (error) {
    logError('Error getting user updates list:', error);
    throw error;
  }
};

/**
 * Get user updates count
 */
const getUserUpdatesCount = async (userId) => {
  try {
    const query = `
      SELECT COUNT(*) as count 
      FROM updates 
      WHERE user_id = ? AND status != "deleted"
    `;

    const [result] = await pool.query(query, [userId]);
    return result[0].count;
  } catch (error) {
    logError('Error getting user updates count:', error);
    return 0;
  }
};

/**
 * Create user update
 */
const createUserUpdate = async (updateData) => {
  try {
    const { user_id, title, content, image = null } = updateData;
    
    const query = `
      INSERT INTO updates (user_id, title, content, image, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [user_id, title, content, image]);
    logInfo(`Created user update: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error creating user update:', error);
    throw error;
  }
};

/**
 * Update user update
 */
const updateUserUpdate = async (updateId, updateData) => {
  try {
    const { title, content, image } = updateData;
    
    const query = `
      UPDATE updates 
      SET title = ?, content = ?, image = ?, updated_at = NOW() 
      WHERE id = ? AND status != "deleted"
    `;
    
    await pool.query(query, [title, content, image, updateId]);
    logInfo(`Updated user update: ${updateId}`);
  } catch (error) {
    logError('Error updating user update:', error);
    throw error;
  }
};

/**
 * Delete user update
 */
const deleteUserUpdate = async (updateId) => {
  try {
    const query = `UPDATE updates SET deleted = 1 WHERE id = ?`;
    await pool.query(query, [updateId]);
    logInfo(`Deleted user update: ${updateId}`);
  } catch (error) {
    logError('Error deleting user update:', error);
    throw error;
  }
};

/**
 * Get update by ID
 */
const getUpdateById = async (updateId) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        title,
        content,
        image,
        created_at,
        updated_at
      FROM updates 
      WHERE id = ? AND status != "deleted"
    `;

    const [rows] = await pool.query(query, [updateId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting update by ID:', error);
    return null;
  }
};

/**
 * Save a new post/update to the database (parity with Lambda)
 * Handles tags, media, scheduling and expiry
 */
const savePost = async (postData) => {
  try {
    const {
      description,
      tags,
      price,
      post_type,
      media,
      convertedMedia,
      scheduled_date,
      scheduled_time,
      expired_at,
      userId
    } = postData;

    logInfo('Saving new post to database:', { userId, description: description?.substring(0, 50) });

    const numPrice = price !== undefined ? parseFloat(price) : 0;

    let normalizedLocked = 'no';
    if (post_type === 'paid' || post_type === 'subscribers_only') {
      normalizedLocked = 'yes';
    }

    const tokenId = uuidv4();

    let scheduledDateTime = null;
    if (scheduled_date && scheduled_time) {
      try {
        const scheduledDate = new Date(`${scheduled_date}T${scheduled_time}:00`);
        if (!isNaN(scheduledDate.getTime())) {
          scheduledDateTime = scheduledDate.toISOString().slice(0, 19).replace('T', ' ');
        }
      } catch (error) {
        logError('Error parsing scheduled date/time:', error);
      }
    }

    let expiredAt = null;
    if (expired_at) {
      const shouldUseExpiredAt = post_type === 'paid' || post_type === 'subscribers_only';
      if (shouldUseExpiredAt) {
        const expiryDate = new Date(expired_at);
        const now = new Date();
        const toleranceMs = 5 * 60 * 1000;
        if (expiryDate <= (now.getTime() - toleranceMs)) {
          throw new Error('expired_at must be a future timestamp (with 5-minute tolerance)');
        }
        expiredAt = expiryDate.toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    const [result] = await pool.query(`
      INSERT INTO updates (
        image, video, description, user_id, date, token_id, locked, 
        music, file, img_type, fixed_post, price, video_embed, 
        file_name, file_size, status, expired_at, expiry_post_notification, is_utc
      ) VALUES (?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      '',
      '',
      description,
      userId,
      tokenId,
      normalizedLocked,
      '',
      '',
      '',
      '0',
      numPrice,
      '',
      '',
      '0',
      'active',
      expiredAt,
      0,
      '1'
    ]);

    const postId = result.insertId;
    logInfo('Post saved successfully:', { postId, userId });

    if (tags && tags.trim()) {
      await processTags(postId, tags);
    }

    if (media && media.length > 0) {
      await processMedia(postId, userId, media, convertedMedia || []);
    }

    return {
      success: true,
      postId,
      tokenId
    };

  } catch (error) {
    logError('Error saving post to database:', error);
    throw error;
  }
};

/**
 * Process and save tags for a post
 */
const processTags = async (postId, tagsString) => {
  try {
    const tags = tagsString
      .split(/\s+/)
      .map(tag => tag.replace(/^#+/, '').trim())
      .filter(tag => tag.length > 0);

    if (tags.length === 0) return;

    logInfo('Processing tags for post:', { postId, tagsCount: tags.length });

    for (const tagName of tags) {
      let [tagRows] = await pool.query('SELECT id FROM tags WHERE tag = ?', [tagName]);
      let tagId;
      if (tagRows.length === 0) {
        const [tagResult] = await pool.query('INSERT INTO tags (tag, sample) VALUES (?, 1)', [tagName]);
        tagId = tagResult.insertId;
      } else {
        tagId = tagRows[0].id;
        await pool.query('UPDATE tags SET sample = sample + 1 WHERE id = ?', [tagId]);
      }
      await pool.query(
        'INSERT INTO update_tags (update_id, tag_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE tag_id = tag_id',
        [postId, tagId]
      );
    }

    logInfo('Tags processed successfully:', { postId, tagsCount: tags.length });

  } catch (error) {
    logError('Error processing tags:', { postId, error: error.message });
    throw error;
  }
};

/**
 * Process and save media files for a post
 */
const processMedia = async (postId, userId, mediaPaths, convertedPaths = []) => {
  try {
    logInfo('Processing media for post:', { postId, mediaCount: mediaPaths.length });

    for (let i = 0; i < mediaPaths.length; i++) {
      const mediaPath = mediaPaths[i];
      const convertedPath = convertedPaths[i] || '';

      const fileExt = mediaPath.split('.').pop()?.toLowerCase();
      let mediaType = 'file';
      if (['jpg','jpeg','png','gif','webp','bmp','svg','tiff','avif','jfif','heic'].includes(fileExt)) {
        mediaType = 'image';
      } else if (['mp4','mov','avi','mkv','webm','mpeg','3gp','flv','ogv','wmv'].includes(fileExt)) {
        mediaType = 'video';
      } else if (['mp3','wav','m4a','aac','ogg','flac'].includes(fileExt)) {
        mediaType = 'audio';
      }

      const fileName = mediaPath.split('/').pop() || '';
      let imageFileName = '';
      if (mediaType === 'image' && convertedPath) {
        imageFileName = convertedPath.split('/').pop() || '';
      }

      const isWebPConverted = mediaType === 'image' && convertedPath && convertedPath.endsWith('.webp');
      const currentTimestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

      await pool.query(`
        INSERT INTO media (
          updates_id, 
          user_id, 
          type, 
          image,
          img_type,
          video,
          video_embed,
          music,
          file,
          file_name,
          file_size,
          token, 
          status,
          webp,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `, [
        postId,
        userId,
        mediaType,
        imageFileName,
        mediaType === 'image' ? fileExt : '',
        mediaType === 'video' ? mediaPath : '',
        '',
        mediaType === 'audio' ? mediaPath : '',
        mediaType === 'file' ? mediaPath : '',
        fileName,
        '0',
        uuidv4(),
        isWebPConverted ? '1' : '0',
        currentTimestamp,
        currentTimestamp
      ]);
    }

    const webpConvertedCount = mediaPaths.filter((_, index) => {
      const convertedPath = convertedPaths[index] || '';
      return convertedPath && convertedPath.endsWith('.webp');
    }).length;

    logInfo('Media processed successfully:', { 
      postId, 
      mediaCount: mediaPaths.length,
      webpConvertedCount,
      hasWebPConversions: webpConvertedCount > 0
    });

  } catch (error) {
    logError('Error processing media:', { postId, error: error.message });
    throw error;
  }
};

/**
 * Validate post input payload
 */
const validatePostInput = (data) => {
  const errors = [];
  if (!data.description || typeof data.description !== 'string' || data.description.trim().length === 0) {
    errors.push('description is required and must be a non-empty string');
  }
  if (data.description && data.description.length > 5000) {
    errors.push('description must be less than 5000 characters');
  }
  if (data.tags !== undefined && typeof data.tags !== 'string') {
    errors.push('tags must be a string');
  }
  if (!data.post_type || typeof data.post_type !== 'string') {
    errors.push('post_type is required and must be a string');
  } else if (!['free', 'paid', 'subscribers_only'].includes(data.post_type)) {
    errors.push('post_type must be one of: free, paid, subscribers_only');
  }
  if (data.post_type === 'free') {
    if (data.price !== undefined && data.price !== null && data.price !== 0 && data.price !== '0') {
      errors.push('price must be 0 for free posts');
    }
  } else {
    if (data.price !== undefined) {
      const numPrice = parseFloat(data.price);
      if (isNaN(numPrice) || numPrice < 0) {
        errors.push('price must be a valid non-negative number');
      }
    }
  }
  if (data.post_type === 'free') {
    if (data.scheduled_date !== undefined && data.scheduled_date !== null) {
      errors.push('scheduled_date is not allowed for free posts');
    }
    if (data.scheduled_time !== undefined && data.scheduled_time !== null) {
      errors.push('scheduled_time is not allowed for free posts');
    }
  } else if (data.post_type === 'paid' || data.post_type === 'subscribers_only') {
    if ((data.scheduled_date && !data.scheduled_time) || (!data.scheduled_date && data.scheduled_time)) {
      errors.push('Both scheduled_date and scheduled_time must be provided together if scheduling is enabled');
    }
  }
  if (data.media !== undefined) {
    const mediaValidation = validateMediaArray(data.media, 'uploads/updates/', 'post');
    if (!mediaValidation.success) {
      errors.push(...mediaValidation.errors);
    }
  }
  if (data.scheduled_date !== undefined && data.scheduled_date !== null) {
    if (typeof data.scheduled_date !== 'string') {
      errors.push('scheduled_date must be a string');
    } else {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(data.scheduled_date)) {
        errors.push('scheduled_date must be in YYYY-MM-DD format');
      } else {
        const scheduledDate = new Date(data.scheduled_date);
        if (isNaN(scheduledDate.getTime())) {
          errors.push('scheduled_date must be a valid date');
        }
      }
    }
  }
  if (data.scheduled_time !== undefined && data.scheduled_time !== null) {
    if (typeof data.scheduled_time !== 'string') {
      errors.push('scheduled_time must be a string');
    } else {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(data.scheduled_time)) {
        errors.push('scheduled_time must be in HH:MM format');
      }
    }
  }
  return { success: errors.length === 0, errors };
};

// Export all functions at the end
export {
  getUserUpdatesList,
  getUserUpdatesCount,
  createUserUpdate,
  updateUserUpdate,
  deleteUserUpdate,
  getUpdateById,
  savePost,
  processTags,
  processMedia,
  validatePostInput
};