import { createSuccessResponse, createErrorResponse, logInfo, logError, getSubscribersList, getSubscribersCount, getUserById, getFile, decryptId, isEncryptedId, verifyAccessToken, getUserPostsList, getUserPostsCount, getUserUpdatesList, getUserUpdatesCount, updateUserPost, deleteUserPost, getPostComments, updateUserSettings, sendOtpToUser, verifyUserOtp, searchUsersByName, changeUserPassword, createPasswordOtpForUser, verifyPasswordOtpForUser, blockUserById, getUserProfileBySlug, getAuthenticatedUserId, safeDecryptId, encryptId } from '../utils/common.js';
import { processUploadRequest } from '../utils/uploadUtils.js';
import { getDB } from '../config/database.js';
import { cancelSubscriptions } from '../utils/subscription.js';

/**
 * Get user's subscribers with pagination and filtering
 */
export const getSubscribers = async (req, res) => {
  try {
    const userId = req.userId;
    const { sort = null, skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    // Validate pagination parameters
    if (skip < 0 || limit < 1 || limit > 100) {
      return res.status(400).json(createErrorResponse(400, 'Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.'));
    }

    // Get subscribers list and count
    const [subscribers, totalCount] = await Promise.all([
      getSubscribersList(userId, { sort, skip, limit }),
      getSubscribersCount(userId, sort)
    ]);

    // Calculate pagination info
    const hasMore = (skip + limit) < totalCount;
    const next = hasMore ? `/creator/subscribers?skip=${skip + limit}&limit=${limit}&sort=${sort || ''}` : '';

    logInfo('Subscribers retrieved successfully', { userId, totalCount, returnedCount: subscribers.length, sort });

    return res.json(createSuccessResponse('Subscribers retrieved successfully', {
      subscribers,
      pagination: { total: totalCount, skip, limit, hasMore, next }
    }));
  } catch (error) {
    logError('Error fetching subscribers:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch subscribers'));
  }
};

/**
 * Get user's posts with pagination
 */
export const getMyPosts = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    // Get posts list and count
    const [posts, totalCount] = await Promise.all([
      getUserPostsList(userId, { skip, limit }),
      getUserPostsCount(userId)
    ]);

    // Calculate pagination info
    const hasMore = (skip + limit) < totalCount;
    const next = hasMore ? `/posts?skip=${skip + limit}&limit=${limit}` : '';

    logInfo('Posts retrieved successfully', { userId, totalCount, returnedCount: posts.length });

    return res.json(createSuccessResponse('Posts retrieved successfully', {
      posts,
      pagination: { total: totalCount, skip, limit, hasMore, next }
    }));
  } catch (error) {
    logError('Error fetching posts:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch posts'));
  }
};

/**
 * Get user's updates with pagination
 */
export const getUpdates = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    // Get updates list and count
    const [updates, totalCount] = await Promise.all([
      getUserUpdatesList(userId, { skip, limit }),
      getUserUpdatesCount(userId)
    ]);

    // Calculate pagination info
    const hasMore = (skip + limit) < totalCount;
    const next = hasMore ? `/updates?skip=${skip + limit}&limit=${limit}` : '';

    logInfo('Updates retrieved successfully', { userId, totalCount, returnedCount: updates.length });

    return res.json(createSuccessResponse('Updates retrieved successfully', {
      updates,
      pagination: { total: totalCount, skip, limit, hasMore, next }
    }));
  } catch (error) {
    logError('Error fetching updates:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch updates'));
  }
};

/**
 * Edit a user update/post
 */
export const editUpdate = async (req, res) => {
  try {
    const userId = req.userId;
    const { id, content } = req.body;

    if (!id || !content) {
      return res.status(400).json(createErrorResponse(400, 'Post ID and content are required'));
    }

    const success = await updateUserPost(userId, id, content);
    if (!success) {
      return res.status(404).json(createErrorResponse(404, 'Post not found or not updated'));
    }

    logInfo('Post updated successfully', { userId, postId: id });
    return res.json(createSuccessResponse('Post updated successfully'));
  } catch (error) {
    logError('Error updating post:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update post'));
  }
};

/**
 * Delete a user update/post
 */
export const deleteUpdate = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }

    const success = await deleteUserPost(userId, id);
    if (!success) {
      return res.status(404).json(createErrorResponse(404, 'Post not found or not deleted'));
    }

    logInfo('Post deleted successfully', { userId, postId: id });
    return res.json(createSuccessResponse('Post deleted successfully'));
  } catch (error) {
    logError('Error deleting post:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to delete post'));
  }
};

/**
 * Get comments for a post
 */
export const getComments = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }

    const comments = await getPostComments(id);
    logInfo('Comments retrieved successfully', { userId, postId: id, commentCount: comments.length });

    return res.json(createSuccessResponse('Comments retrieved successfully', { comments }));
  } catch (error) {
    logError('Error fetching comments:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch comments'));
  }
};

/**
 * Get user settings
 */
export const getSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await getUserById(userId);
    
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Format user data for settings response
    const settings = {
      name: user.name || '',
      email: user.email || '',
      avatar: user.avatar ? getFile(`avatar/${user.avatar}`) : '',
      story: user.story || '',
      location: user.location || '',
      website: user.website || '',
      social_links: user.social_links ? JSON.parse(user.social_links) : {}
    };

    logInfo('User settings retrieved successfully', { userId });
    return res.json(createSuccessResponse('User settings retrieved successfully', { user: settings }));
  } catch (error) {
    logError('Error fetching user settings:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch user settings'));
  }
};

/**
 * Update user settings
 */
export const postSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const settingsData = req.body;

    const success = await updateUserSettings(userId, settingsData);
    if (!success) {
      return res.status(400).json(createErrorResponse(400, 'Failed to update settings'));
    }

    logInfo('User settings updated successfully', { userId });
    return res.json(createSuccessResponse('User settings updated successfully'));
  } catch (error) {
    logError('Error updating user settings:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update user settings'));
  }
};

/**
 * Send OTP to user
 */
export const sendOtp = async (req, res) => {
  try {
    const userId = req.userId;
    const { type } = req.body;

    if (!type) {
      return res.status(400).json(createErrorResponse(400, 'OTP type is required'));
    }

    const result = await sendOtpToUser(userId, type);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('OTP sent successfully', { userId, type });
    return res.json(createSuccessResponse(result.message));
  } catch (error) {
    logError('Error sending OTP:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to send OTP'));
  }
};

/**
 * Verify OTP
 */
export const verifyOtp = async (req, res) => {
  try {
    const userId = req.userId;
    const { otp, type } = req.body;

    if (!otp || !type) {
      return res.status(400).json(createErrorResponse(400, 'OTP and type are required'));
    }

    const result = await verifyUserOtp(userId, otp, type);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('OTP verified successfully', { userId, type });
    return res.json(createSuccessResponse(result.message));
  } catch (error) {
    logError('Error verifying OTP:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to verify OTP'));
  }
};

/**
 * Get user info
 */
export const getUserInfo = async (req, res) => {
  try {
    const userId = req.userId;
    const user = await getUserById(userId);
    
    if (!user || user.status === 'deleted') {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Format user data for response
    const userInfo = {
      name: user.name || 'Unknown User',
      email: user.email || '',
      avatar: user.avatar ? getFile(`avatar/${user.avatar}`) : ''
    };

    logInfo('User info retrieved successfully', { userId });
    return res.json(createSuccessResponse('User info retrieved successfully', { user: userInfo }));
  } catch (error) {
    logError('Error fetching user info:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch user info'));
  }
};

/**
 * Search users by name
 */
export const searchUsers = async (req, res) => {
  try {
    const userId = req.userId;
    const { q: query, skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    if (!query) {
      return res.status(400).json(createErrorResponse(400, 'Search query is required'));
    }

    const users = await searchUsersByName(query, { skip, limit });
    logInfo('Users search completed', { userId, query, resultCount: users.length });

    return res.json(createSuccessResponse('Users search completed', { users }));
  } catch (error) {
    logError('Error searching users:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to search users'));
  }
};

/**
 * Change user password
 */
export const changePassword = async (req, res) => {
  try {
    const userId = req.userId;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json(createErrorResponse(400, 'Current password and new password are required'));
    }

    const result = await changeUserPassword(userId, currentPassword, newPassword);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('Password changed successfully', { userId });
    return res.json(createSuccessResponse('Password changed successfully'));
  } catch (error) {
    logError('Error changing password:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to change password'));
  }
};

/**
 * Create password OTP
 */
export const createPasswordOtp = async (req, res) => {
  try {
    const userId = req.userId;
    const result = await createPasswordOtpForUser(userId);
    
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('Password creation OTP sent', { userId });
    return res.json(createSuccessResponse(result.message));
  } catch (error) {
    logError('Error creating password OTP:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to create password OTP'));
  }
};

/**
 * Verify password OTP
 */
export const verifyPasswordOtp = async (req, res) => {
  try {
    const userId = req.userId;
    const { otp, password } = req.body;

    if (!otp || !password) {
      return res.status(400).json(createErrorResponse(400, 'OTP and password are required'));
    }

    const result = await verifyPasswordOtpForUser(userId, otp, password);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('Password created successfully', { userId });
    return res.json(createSuccessResponse('Password created successfully'));
  } catch (error) {
    logError('Error verifying password OTP:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to verify password OTP'));
  }
};

/**
 * Block a user
 */
export const blockUser = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: targetUserId } = req.params;

    if (!targetUserId) {
      return res.status(400).json(createErrorResponse(400, 'User ID is required'));
    }

    const result = await blockUserById(userId, targetUserId);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('User blocked successfully', { userId, targetUserId });
    return res.json(createSuccessResponse('User blocked successfully'));
  } catch (error) {
    logError('Error blocking user:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to block user'));
  }
};

/**
 * Get user profile by slug (public route)
 */
export const getProfile = async (req, res) => {
  try {
    const { slug } = req.params;
    const requestingUserId = req.userId; // May be null for public access

    if (!slug) {
      return res.status(400).json(createErrorResponse(400, 'Profile slug is required'));
    }

    const profile = await getUserProfileBySlug(slug, requestingUserId);
    if (!profile) {
      return res.status(404).json(createErrorResponse(404, 'Profile not found'));
    }

    logInfo('Profile retrieved successfully', { slug, requestingUserId });
    return res.json(createSuccessResponse('Profile retrieved successfully', { profile }));
  } catch (error) {
    logError('Error fetching profile:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch profile'));
  }
};

/**
 * Dark mode toggle
 */
export const darkMode = async (req, res) => {
  try {
    const userId = req.userId;
    const { mode } = req.params;

    if (!mode || !['light', 'dark'].includes(mode)) {
      return res.status(400).json(createErrorResponse(400, 'Valid mode (light/dark) is required'));
    }

    // Update user's dark mode preference
    const result = await updateUserSettings(userId, { dark_mode: mode });
    if (!result) {
      return res.status(400).json(createErrorResponse(400, 'Failed to update dark mode preference'));
    }

    logInfo('Dark mode updated successfully', { userId, mode });
    return res.json(createSuccessResponse(`Dark mode set to ${mode}`));
  } catch (error) {
    logError('Error updating dark mode:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update dark mode'));
  }
};

/**
 * Get user cover upload URL
 */
export const getUserCoverUploadUrl = async (req, res) => {
  try {
    const userId = req.userId;

    const uploadOptions = {
      action: 'getUserCoverUploadUrl',
      basePath: 'uploads/cover',
      useFolderOrganization: false,
      successMessage: 'Cover upload URL generated',
      getAuthenticatedUserId: () => ({ userId, errorResponse: null })
    };
    
    const result = await processUploadRequest(req, uploadOptions);
    return res.json(result);
  } catch (error) {
    logError('Error generating cover upload URL:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to generate cover upload URL'));
  }
};

/**
 * Create user cover
 */
export const createUserCover = async (req, res) => {
  try {
    const userId = req.userId;
    const { file } = req.body;

    if (!file) {
      return res.status(400).json(createErrorResponse(400, 'Cover file is required'));
    }

    // Update user's cover image
    const result = await updateUserSettings(userId, { cover: file });
    if (!result) {
      return res.status(400).json(createErrorResponse(400, 'Failed to update cover image'));
    }

    logInfo('Cover image updated successfully', { userId });
    return res.json(createSuccessResponse('Cover image updated successfully'));
  } catch (error) {
    logError('Error updating cover image:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update cover image'));
  }
};

/**
 * Get user avatar upload URL
 */
export const getUserAvatarUploadUrl = async (req, res) => {
  try {
    const userId = req.userId;

    const uploadOptions = {
      action: 'getUserAvatarUploadUrl',
      basePath: 'uploads/avatar',
      useFolderOrganization: false,
      successMessage: 'Avatar upload URL generated',
      getAuthenticatedUserId: () => ({ userId, errorResponse: null })
    };
    
    const result = await processUploadRequest(req, uploadOptions);
    return res.json(result);
  } catch (error) {
    logError('Error generating avatar upload URL:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to generate avatar upload URL'));
  }
};

/**
 * Create user avatar
 */
export const createUserAvatar = async (req, res) => {
  try {
    const userId = req.userId;
    const { file } = req.body;

    if (!file) {
      return res.status(400).json(createErrorResponse(400, 'Avatar file is required'));
    }

    // Update user's avatar image
    const result = await updateUserSettings(userId, { avatar: file });
    if (!result) {
      return res.status(400).json(createErrorResponse(400, 'Failed to update avatar image'));
    }

    logInfo('Avatar image updated successfully', { userId });
    return res.json(createSuccessResponse('Avatar image updated successfully'));
  } catch (error) {
    logError('Error updating avatar image:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update avatar image'));
  }
};

/**
 * Gets a restriction record for a user pair.
 * @param {number|string} userId - The user performing the restriction
 * @param {number|string} restrictedId - The user being restricted
 * @returns {Promise<object|null>} Restriction row or null
 */
const dbGetRestriction = async (userId, restrictedId) => {
  const pool = getDB();
  const [rows] = await pool.query(
    'SELECT id FROM restrictions WHERE user_id = ? AND user_restricted = ?',
    [userId, restrictedId]
  );
  return rows.length > 0 ? rows[0] : null;
};

/**
 * Adds a restriction for a user.
 * @param {number|string} userId - The user performing the restriction
 * @param {number|string} restrictedId - The user being restricted
 * @returns {Promise<void>}
 */
const dbAddRestriction = async (userId, restrictedId) => {
  const pool = getDB();
  await pool.query(
    'INSERT INTO restrictions (user_id, user_restricted, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
    [userId, restrictedId]
  );
};

/**
 * Removes a restriction for a user.
 * @param {number|string} userId - The user performing the restriction
 * @param {number|string} restrictedId - The user being unrestricted
 * @returns {Promise<void>}
 */
const dbRemoveRestriction = async (userId, restrictedId) => {
  const pool = getDB();
  await pool.query(
    'DELETE FROM restrictions WHERE user_id = ? AND user_restricted = ?',
    [userId, restrictedId]
  );
};

/**
 * Gets a paginated list of users restricted by the authenticated user.
 * @param {number|string} userId - The user whose restrictions to list
 * @param {number} skip - Number of records to skip
 * @param {number} limit - Number of records to return
 * @returns {Promise<Array<{id: number, name: string, username: string, avatar: string|null}>>}
 */
const dbGetRestrictedUsers = async (userId, skip = 0, limit = 15) => {
  const pool = getDB();
  const [rows] = await pool.query(
    `SELECT r.user_restricted as id, u.name, u.username, u.avatar FROM restrictions r
     JOIN users u ON r.user_restricted = u.id
     WHERE r.user_id = ? AND u.status != 'deleted'
     ORDER BY r.id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, skip]
  );
  // Return array of restricted users with encrypted id, name, username, and avatar
  return rows.map(({ id, name, username, avatar }) => ({ 
    id: encryptId(id), // Encrypt user ID for security
    name, 
    username, 
    avatar: avatar ? getFile(`avatar/${avatar}`) : null 
  }));
};

/**
 * Gets the total count of users restricted by the authenticated user.
 * @param {number|string} userId - The user whose restrictions to count
 * @returns {Promise<number>} Total count of restricted users
 */
const dbGetRestrictedUsersCount = async (userId) => {
  const pool = getDB();
  const [rows] = await pool.query(
    `SELECT COUNT(*) as total FROM restrictions r
     JOIN users u ON r.user_restricted = u.id
     WHERE r.user_id = ? AND u.status != 'deleted'`,
    [userId]
  );
  return rows.length > 0 ? rows[0].total : 0;
};

/**
 * Handler to add or remove a restricted user (toggle restriction).
 * If the restriction exists, it removes it. Otherwise, it adds a new restriction.
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const restrictUser = async (req, res) => {
  try {
    logInfo('Restrict user request received');

    // Authenticate user and get their ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'restriction' }) to getAuthenticatedUserId(req, { action: 'restriction' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'restriction' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Get the user ID to restrict from path parameters
    // TODO: Convert event.pathParameters?.id to req.params?.id
    const encryptedUserToRestrictId = req.params?.id;
    if (!encryptedUserToRestrictId) {
      // TODO: Convert createErrorResponse(400, 'User ID is required') to res.status(400).json({ error: 'User ID is required' })
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Decrypt the encrypted user ID using safeDecryptId
    let userToRestrictId;
    try {
      userToRestrictId = safeDecryptId(encryptedUserToRestrictId);
      logInfo('Decoded user ID:', { originalId: encryptedUserToRestrictId, decodedId: userToRestrictId });
    } catch (error) {
      logError('Error decrypting user ID:', { encryptedUserToRestrictId, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid user ID format') to res.status(400).json({ error: 'Invalid user ID format' })
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    logInfo('Restrict user request:', { userId, userToRestrictId });

    // Fetch the user to restrict
    const targetUser = await getUserById(userToRestrictId);
    if (!targetUser) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent users from restricting themselves
    if (targetUser.id == userId) {
      // TODO: Convert createErrorResponse(400, 'Cannot restrict yourself') to res.status(400).json({ error: 'Cannot restrict yourself' })
      return res.status(400).json({ error: 'Cannot restrict yourself' });
    }

    // Do not restrict super admin (role = 'admin' and id = 1)
    if (targetUser.role === 'admin' && targetUser.id === 1) {
      // TODO: Convert createSuccessResponse('Restriction updated successfully', { message: 'Restriction updated successfully', status: 200, success: true, timestamp: new Date().toISOString() }) to res.json({ success: true, message: 'Restriction updated successfully', data: { message: 'Restriction updated successfully', status: 200, success: true, timestamp: new Date().toISOString() } })
      return res.json({
        success: true,
        message: 'Restriction updated successfully',
        data: {
          message: 'Restriction updated successfully',
          status: 200,
          success: true,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if restriction already exists
    const existingRestriction = await dbGetRestriction(userId, userToRestrictId);
    if (existingRestriction) {
      // Remove restriction if it exists
      await dbRemoveRestriction(userId, userToRestrictId);
      logInfo('Restriction removed:', { userId, userToRestrictId });
    } else {
      // Add restriction if it does not exist
      await dbAddRestriction(userId, userToRestrictId);
      logInfo('Restriction added:', { userId, userToRestrictId });

      // If the current user is verified, cancel active subscriptions from restricted user
      const currentUser = await getUserById(userId);
      if (currentUser && currentUser.verified_id === 'yes') {
        // Get active plan names for the creator
        const pool = getDB();
        const [planRows] = await pool.query(
          'SELECT name FROM plans WHERE user_id = ? AND status = "active"',
          [userId]
        );
        const planNames = planRows.map(row => row.name);
        
        if (planNames.length > 0) {
          // Cancel subscriptions from the restricted user to the current user
          await cancelSubscriptions(userToRestrictId, userId, planNames); // userToRestrictedId is the subscriber, userId is the creator
          logInfo('Active subscriptions cancelled for restricted user:', { userId, userToRestrictedId, cancelledPlans: planNames });
        }
      }
    }

    logInfo('Restriction cache cleared');
    // TODO: Convert createSuccessResponse('Restriction updated successfully', { message: 'Restriction updated successfully', status: 200, success: true, timestamp: new Date().toISOString() }) to res.json({ success: true, message: 'Restriction updated successfully', data: { message: 'Restriction updated successfully', status: 200, success: true, timestamp: new Date().toISOString() } })
    return res.json({
      success: true,
      message: 'Restriction updated successfully',
      data: {
        message: 'Restriction updated successfully',
        status: 200,
        success: true,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logError('Restrict user error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Handler to get the list of users restricted by the authenticated user.
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getRestrictions = async (req, res) => {
  try {
    logInfo('Get restrictions request received');

    // Authenticate user and get their ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'restrictions' }) to getAuthenticatedUserId(req, { action: 'restrictions' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'restrictions' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Pagination: skip (offset), limit (default 15, max 100)
    // TODO: Convert event.queryStringParameters?.skip || '0' to req.query?.skip || '0'
    const skip = parseInt(req.query?.skip || '0');
    // TODO: Convert event.queryStringParameters?.limit || '15' to req.query?.limit || '15'
    const limit = parseInt(req.query?.limit || '15');
    // Validate pagination parameters
    if (skip < 0 || limit < 1 || limit > 100) {
      // TODO: Convert createErrorResponse(400, 'Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.') to res.status(400).json({ error: 'Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.' })
      return res.status(400).json({ error: 'Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.' });
    }
    logInfo('Get restrictions request:', { userId, skip, limit });

    // Get total count for pagination
    const totalRestrictions = await dbGetRestrictedUsersCount(userId);
    if (totalRestrictions === null) {
      // TODO: Convert createErrorResponse(500, 'Failed to fetch restrictions count') to res.status(500).json({ error: 'Failed to fetch restrictions count' })
      return res.status(500).json({ error: 'Failed to fetch restrictions count' });
    }

    // Get restricted users with pagination
    const restrictionsList = await dbGetRestrictedUsers(userId, skip, limit);
    logInfo('Restrictions retrieved successfully:', { userId, count: restrictionsList.length });

    // Build next page URL if more results exist
    let next = '';
    if (skip + limit < totalRestrictions) {
      next = `/restrict/user?skip=${skip + limit}&limit=${limit}`;
    }

    // Return paginated response matching the specified JSON structure
    // TODO: Convert createSuccessResponse('Restrictions retrieved successfully', { restrictions: restrictionsList, pagination: { total: totalRestrictions, next } }) to res.json({ success: true, message: 'Restrictions retrieved successfully', data: { restrictions: restrictionsList, pagination: { total: totalRestrictions, next } } })
    return res.json({
      success: true,
      message: 'Restrictions retrieved successfully',
      data: {
        restrictions: restrictionsList,
        pagination: {
          total: totalRestrictions,
          next
        }
      }
    });
  } catch (error) {
    logError('Get restrictions error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json({ error: 'Internal server error' });
  }
};
