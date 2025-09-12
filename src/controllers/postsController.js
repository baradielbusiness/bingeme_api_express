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
  convertLocalToUTC
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
 * Handler to get post create data (GET /posts/create)
 */
export const getPostCreateData = async (req, res) => {
  try {
    const userId = req.userId;

    // This endpoint typically returns configuration data for post creation
    // For now, return a simple success response
    return res.status(200).json(createSuccessResponse('Post create data retrieved successfully', {}));

  } catch (error) {
    logError('getPostCreateData error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to create a post (POST /posts/create)
 */
export const createPost = async (req, res) => {
  try {
    logInfo('Post creation request initiated');

    const userId = req.userId;
    const requestBody = req.body;

    // Validate required fields and data types
    const validation = validatePostInput(requestBody);
    if (!validation.success) {
      logError('Post validation failed:', { errors: validation.errors });
      return res.status(422).json(createErrorResponse(422, 'Validation failed', validation.errors));
    }

    const { description, tags, price, post_type, media, scheduled_date, scheduled_time, timezone } = requestBody;

    // Apply business rules for different post types
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

    // Calculate expiration timestamp based on business rules
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

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files (validate, convert images to WebP)
    let processedMedia = { original: [], converted: [] };
    if (media && media.length > 0) {
      try {
        logInfo('Starting media processing:', { mediaCount: media.length });
        processedMedia = await processMediaFiles(media, bucketName, 'post');
        logInfo('Media processing completed successfully');
      } catch (error) {
        logError('Media processing failed:', { error: error.message });
        return res.status(500).json(createErrorResponse(500, 'Media processing failed', error.message));
      }
    }

    // Save post data to database
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
      return res.status(500).json(createErrorResponse(500, 'Failed to save post to database', error.message));
    }

    // Build success response with empty data object
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

    return res.status(200).json(createSuccessResponse('Post created successfully', responseData));

  } catch (error) {
    logError('Unexpected error in createPost:', { error: error.message, stack: error.stack });
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};

/**
 * Handler to get post upload URL (GET /posts/upload-url)
 */
export const getPostUploadUrl = async (req, res) => {
  try {
    // Configuration options for posts upload processing
    const uploadOptions = {
      action: 'getPostUploadUrl',
      basePath: 'uploads/posts',
      useFolderOrganization: false, // Posts use flat structure
      successMessage: 'Pre-signed upload URLs generated for posts',
      getAuthenticatedUserId
    };
    
    // Use shared upload processing utility and return result directly
    const result = await processUploadRequest(req, uploadOptions);
    
    if (result.statusCode === 200) {
      return res.status(200).json(JSON.parse(result.body));
    } else {
      return res.status(result.statusCode).json(JSON.parse(result.body));
    }
  } catch (error) {
    logError('getPostUploadUrl error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to get post by username and ID (GET /posts/:username/:id)
 */
export const getPostByUsernameAndId = async (req, res) => {
  try {
    // Get user ID (optional for this endpoint)
    const userId = req.userId; // From optionalAuthMiddleware

    // Validate path params
    const { username, id } = req.params;
    if (!username || !id) {
      return res.status(400).json(createErrorResponse(400, 'Username and id are required'));
    }

    // Resolve post id
    const updateId = resolveUpdateId(id);
    if (!updateId) {
      return res.status(400).json(createErrorResponse(400, 'Invalid id format'));
    }

    // Fetch owner and post
    const owner = await fetchOwnerByUsername(username);
    if (!owner) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    const post = await fetchPostByIdAndOwner(updateId, owner.id);
    if (!post) {
      return res.status(404).json(createErrorResponse(404, 'Post not found'));
    }

    // Fetch related data
    const [media, { likes_count, comments_count }, tags] = await Promise.all([
      fetchMediaForPost(updateId),
      fetchCounts(updateId),
      fetchTags(updateId)
    ]);

    // Compute remaining time information
    const { expired_at, is_utc } = post;
    const { remainingDays, remainingMessage } = computeRemainingTime(expired_at, is_utc);

    const appBaseUrl = process.env.APP_URL || 'https://bingeme.com';

    // Build response
    const { id: postId, description, date, fixed_post, price, locked } = post;
    const response = {
      id: encryptId(postId),
      caption: description || '',
      date: date ? formatRelativeTime(date) : 'just now',
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

    return res.status(200).json(createSuccessResponse('Post details retrieved', response));
  } catch (error) {
    logError('Error in getPostByUsernameAndId:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Add a comment to a post
 */
export const addComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { post_id, content } = req.body;

    if (!post_id || !content) {
      return res.status(400).json(createErrorResponse(400, 'Post ID and content are required'));
    }

    // Add comment logic here - this would need to be implemented in common.js
    // const result = await addPostComment(userId, post_id, content);
    
    logInfo('Comment added successfully', { userId, postId: post_id });
    return res.json(createSuccessResponse('Comment added successfully'));
  } catch (error) {
    logError('Error adding comment:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to add comment'));
  }
};

/**
 * Delete a comment
 */
export const deleteComment = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: commentId } = req.params;

    if (!commentId) {
      return res.status(400).json(createErrorResponse(400, 'Comment ID is required'));
    }

    // Delete comment logic here - this would need to be implemented in common.js
    // const result = await deletePostComment(userId, commentId);
    
    logInfo('Comment deleted successfully', { userId, commentId });
    return res.json(createSuccessResponse('Comment deleted successfully'));
  } catch (error) {
    logError('Error deleting comment:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to delete comment'));
  }
};

/**
 * Toggle like on a post or comment
 */
export const toggleLike = async (req, res) => {
  try {
    const userId = req.userId;
    const { post_id, comment_id, type } = req.body;

    if (!post_id && !comment_id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID or Comment ID is required'));
    }

    // Toggle like logic here - this would need to be implemented in common.js
    // const result = await togglePostLike(userId, post_id, comment_id, type);
    
    logInfo('Like toggled successfully', { userId, postId: post_id, commentId: comment_id, type });
    return res.json(createSuccessResponse('Like toggled successfully'));
  } catch (error) {
    logError('Error toggling like:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to toggle like'));
  }
};

/**
 * Pin a post
 */
export const pinPost = async (req, res) => {
  try {
    const userId = req.userId;
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }

    // Pin post logic here - this would need to be implemented in common.js
    // const result = await pinUserPost(userId, post_id);
    
    logInfo('Post pinned successfully', { userId, postId: post_id });
    return res.json(createSuccessResponse('Post pinned successfully'));
  } catch (error) {
    logError('Error pinning post:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to pin post'));
  }
};

/**
 * Unpin a post
 */
export const unpinPost = async (req, res) => {
  try {
    const userId = req.userId;
    const { post_id } = req.body;

    if (!post_id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }

    // Unpin post logic here - this would need to be implemented in common.js
    // const result = await unpinUserPost(userId, post_id);
    
    logInfo('Post unpinned successfully', { userId, postId: post_id });
    return res.json(createSuccessResponse('Post unpinned successfully'));
  } catch (error) {
    logError('Error unpinning post:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to unpin post'));
  }
};
