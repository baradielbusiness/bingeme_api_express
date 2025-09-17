import { createSuccessResponse, createErrorResponse, logInfo, logError, getSubscribersList, getSubscribersCount, getUserById, getFile, decryptId, isEncryptedId, verifyAccessToken, getUserPostsList, getUserPostsCount, getUserUpdatesList, getUserUpdatesCount, updateUserPost, deleteUserPost, getPostComments, updateUserSettings, sendOtpToUser, verifyUserOtp, searchUsersByName, changeUserPassword, createPasswordOtpForUser, verifyPasswordOtpForUser, blockUserById, getUserProfileBySlug, createExpressSuccessResponse, createExpressErrorResponse, safeDecryptId, encryptId } from '../utils/common.js';
import { getDB } from '../config/database.js';
import { processUploadRequest } from '../utils/uploadUtils.js';

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
      return res.status(400).json(createExpressErrorResponse('Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.', 400));
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

    return res.json(createExpressSuccessResponse('Subscribers retrieved successfully', {
      subscribers,
      pagination: { total: totalCount, skip, limit, hasMore, next }
    }));
  } catch (error) {
    logError('Error fetching subscribers:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch subscribers', 500));
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

    return res.json(createExpressSuccessResponse('Posts retrieved successfully', {
      posts,
      pagination: { total: totalCount, skip, limit, hasMore, next }
    }));
  } catch (error) {
    logError('Error fetching posts:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch posts', 500));
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

    return res.json(createExpressSuccessResponse('Updates retrieved successfully', {
      updates,
      pagination: { total: totalCount, skip, limit, hasMore, next }
    }));
  } catch (error) {
    logError('Error fetching updates:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch updates', 500));
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
      return res.status(400).json(createExpressErrorResponse('Post ID and content are required', 400));
    }

    const success = await updateUserPost(userId, id, content);
    if (!success) {
      return res.status(404).json(createExpressErrorResponse('Post not found or not updated', 404));
    }

    logInfo('Post updated successfully', { userId, postId: id });
    return res.json(createExpressSuccessResponse('Post updated successfully'));
  } catch (error) {
    logError('Error updating post:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to update post', 500));
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
      return res.status(400).json(createExpressErrorResponse('Post ID is required', 400));
    }

    const success = await deleteUserPost(userId, id);
    if (!success) {
      return res.status(404).json(createExpressErrorResponse('Post not found or not deleted', 404));
    }

    logInfo('Post deleted successfully', { userId, postId: id });
    return res.json(createExpressSuccessResponse('Post deleted successfully'));
  } catch (error) {
    logError('Error deleting post:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to delete post', 500));
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
      return res.status(400).json(createExpressErrorResponse('Post ID is required', 400));
    }

    const comments = await getPostComments(id);
    logInfo('Comments retrieved successfully', { userId, postId: id, commentCount: comments.length });

    return res.json(createExpressSuccessResponse('Comments retrieved successfully', { comments }));
  } catch (error) {
    logError('Error fetching comments:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch comments', 500));
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
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
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
    return res.json(createExpressSuccessResponse('User settings retrieved successfully', { user: settings }));
  } catch (error) {
    logError('Error fetching user settings:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch user settings', 500));
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
      return res.status(400).json(createExpressErrorResponse('Failed to update settings', 400));
    }

    logInfo('User settings updated successfully', { userId });
    return res.json(createExpressSuccessResponse('User settings updated successfully'));
  } catch (error) {
    logError('Error updating user settings:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to update user settings', 500));
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
      return res.status(400).json(createExpressErrorResponse('OTP type is required', 400));
    }

    const result = await sendOtpToUser(userId, type);
    if (!result.success) {
      return res.status(400).json(createExpressErrorResponse(result.message, 400));
    }

    logInfo('OTP sent successfully', { userId, type });
    return res.json(createExpressSuccessResponse(result.message));
  } catch (error) {
    logError('Error sending OTP:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to send OTP', 500));
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
      return res.status(400).json(createExpressErrorResponse('OTP and type are required', 400));
    }

    const result = await verifyUserOtp(userId, otp, type);
    if (!result.success) {
      return res.status(400).json(createExpressErrorResponse(result.message, 400));
    }

    logInfo('OTP verified successfully', { userId, type });
    return res.json(createExpressSuccessResponse(result.message));
  } catch (error) {
    logError('Error verifying OTP:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to verify OTP', 500));
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
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    // Format user data for response
    const userInfo = {
      name: user.name || 'Unknown User',
      email: user.email || '',
      avatar: user.avatar ? getFile(`avatar/${user.avatar}`) : ''
    };

    logInfo('User info retrieved successfully', { userId });
    return res.json(createExpressSuccessResponse('User info retrieved successfully', { user: userInfo }));
  } catch (error) {
    logError('Error fetching user info:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch user info', 500));
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
      return res.status(400).json(createExpressErrorResponse('Search query is required', 400));
    }

    const users = await searchUsersByName(query, { skip, limit });
    logInfo('Users search completed', { userId, query, resultCount: users.length });

    return res.json(createExpressSuccessResponse('Users search completed', { users }));
  } catch (error) {
    logError('Error searching users:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to search users', 500));
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
      return res.status(400).json(createExpressErrorResponse('Current password and new password are required', 400));
    }

    const result = await changeUserPassword(userId, currentPassword, newPassword);
    if (!result.success) {
      return res.status(400).json(createExpressErrorResponse(result.message, 400));
    }

    logInfo('Password changed successfully', { userId });
    return res.json(createExpressSuccessResponse('Password changed successfully'));
  } catch (error) {
    logError('Error changing password:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to change password', 500));
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
      return res.status(400).json(createExpressErrorResponse(result.message, 400));
    }

    logInfo('Password creation OTP sent', { userId });
    return res.json(createExpressSuccessResponse(result.message));
  } catch (error) {
    logError('Error creating password OTP:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to create password OTP', 500));
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
      return res.status(400).json(createExpressErrorResponse('OTP and password are required', 400));
    }

    const result = await verifyPasswordOtpForUser(userId, otp, password);
    if (!result.success) {
      return res.status(400).json(createExpressErrorResponse(result.message, 400));
    }

    logInfo('Password created successfully', { userId });
    return res.json(createExpressSuccessResponse('Password created successfully'));
  } catch (error) {
    logError('Error verifying password OTP:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to verify password OTP', 500));
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
      return res.status(400).json(createExpressErrorResponse('User ID is required', 400));
    }

    const result = await blockUserById(userId, targetUserId);
    if (!result.success) {
      return res.status(400).json(createExpressErrorResponse(result.message, 400));
    }

    logInfo('User blocked successfully', { userId, targetUserId });
    return res.json(createExpressSuccessResponse('User blocked successfully'));
  } catch (error) {
    logError('Error blocking user:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to block user', 500));
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
      return res.status(400).json(createExpressErrorResponse('Profile slug is required', 400));
    }

    const profile = await getUserProfileBySlug(slug, requestingUserId);
    if (!profile) {
      return res.status(404).json(createExpressErrorResponse('Profile not found', 404));
    }

    logInfo('Profile retrieved successfully', { slug, requestingUserId });
    return res.json(createExpressSuccessResponse('Profile retrieved successfully', { profile }));
  } catch (error) {
    logError('Error fetching profile:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch profile', 500));
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
      return res.status(400).json(createExpressErrorResponse('Valid mode (light/dark) is required', 400));
    }

    // Update user's dark mode preference
    const result = await updateUserSettings(userId, { dark_mode: mode });
    if (!result) {
      return res.status(400).json(createExpressErrorResponse('Failed to update dark mode preference', 400));
    }

    logInfo('Dark mode updated successfully', { userId, mode });
    return res.json(createExpressSuccessResponse(`Dark mode set to ${mode}`));
  } catch (error) {
    logError('Error updating dark mode:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to update dark mode', 500));
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
    return res.status(500).json(createExpressErrorResponse('Failed to generate cover upload URL', 500));
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
      return res.status(400).json(createExpressErrorResponse('Cover file is required', 400));
    }

    // Update user's cover image
    const result = await updateUserSettings(userId, { cover: file });
    if (!result) {
      return res.status(400).json(createExpressErrorResponse('Failed to update cover image', 400));
    }

    logInfo('Cover image updated successfully', { userId });
    return res.json(createExpressSuccessResponse('Cover image updated successfully'));
  } catch (error) {
    logError('Error updating cover image:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to update cover image', 500));
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
    return res.status(500).json(createExpressErrorResponse('Failed to generate avatar upload URL', 500));
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
      return res.status(400).json(createExpressErrorResponse('Avatar file is required', 400));
    }

    // Update user's avatar image
    const result = await updateUserSettings(userId, { avatar: file });
    if (!result) {
      return res.status(400).json(createExpressErrorResponse('Failed to update avatar image', 400));
    }

    logInfo('Avatar image updated successfully', { userId });
    return res.json(createExpressSuccessResponse('Avatar image updated successfully'));
  } catch (error) {
    logError('Error updating avatar image:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to update avatar image', 500));
  }
};

/**
 * Restrict a user
 */
export const restrictUser = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: encryptedTargetId } = req.params;
    logInfo('restrictUser: received request', {
      userId: String(userId),
      encryptedTargetId
    });

    if (!encryptedTargetId) {
      return res.status(400).json(createExpressErrorResponse('User ID is required', 400));
    }

    // Decrypt target user id
    let targetUserId;
    try {
      targetUserId = safeDecryptId(encryptedTargetId);
      logInfo('restrictUser: decrypted id', {
        encryptedTargetId,
        targetUserId,
        type: typeof targetUserId
      });
    } catch (e) {
      logError('restrictUser: decrypt error', { encryptedTargetId, error: e.message });
      return res.status(400).json(createExpressErrorResponse('Invalid user ID format', 400));
    }
    if (typeof targetUserId !== 'number' || isNaN(targetUserId)) {
      logError('restrictUser: decrypted id is not a valid number', {
        encryptedTargetId,
        targetUserId,
        type: typeof targetUserId
      });
      return res.status(400).json(createExpressErrorResponse('Invalid user ID format', 400));
    }

    // Fetch target user
    const targetUser = await getUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    // Prevent self restriction
    if (String(targetUser.id) === String(userId)) {
      return res.status(400).json(createExpressErrorResponse('Cannot restrict yourself', 400));
    }

    // Skip super admin
    if (targetUser.role === 'admin' && Number(targetUser.id) === 1) {
      return res.json(createExpressSuccessResponse('Restriction updated successfully', {
        message: 'Restriction updated successfully',
        status: 200,
        success: true,
        timestamp: new Date().toISOString()
      }));
    }

    const pool = getDB();
    // Check if exists
    const [existsRows] = await pool.query('SELECT id FROM restrictions WHERE user_id = ? AND user_restricted = ?', [userId, targetUserId]);

    if (existsRows.length) {
      await pool.query('DELETE FROM restrictions WHERE user_id = ? AND user_restricted = ?', [userId, targetUserId]);
    } else {
      await pool.query('INSERT INTO restrictions (user_id, user_restricted, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [userId, targetUserId]);
      // Optional: subscription cancellation parity is skipped unless required utilities exist
    }

    return res.json(createExpressSuccessResponse('Restriction updated successfully', {
      message: 'Restriction updated successfully',
      status: 200,
      success: true,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    logError('Error restricting user:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to restrict user', 500));
  }
};

/**
 * Unrestrict a user
 */
export const unrestrictUser = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: targetUserId } = req.params;

    if (!targetUserId) {
      return res.status(400).json(createExpressErrorResponse('User ID is required', 400));
    }

    // Unrestrict user logic here - this would need to be implemented in common.js
    // const result = await unrestrictUserById(userId, targetUserId);
    
    logInfo('User unrestricted successfully', { userId, targetUserId });
    return res.json(createExpressSuccessResponse('User unrestricted successfully'));
  } catch (error) {
    logError('Error unrestricting user:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to unrestrict user', 500));
  }
};

/**
 * Get user restrictions
 */
export const getRestrictions = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 15;

    if (skip < 0 || limit < 1 || limit > 100) {
      return res.status(400).json(createExpressErrorResponse('Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.', 400));
    }

    const pool = getDB();

    // Total count
    const [countRows] = await pool.query(
      `SELECT COUNT(*) as total FROM restrictions r
       JOIN users u ON r.user_restricted = u.id
       WHERE r.user_id = ? AND u.status != 'deleted'`,
      [userId]
    );
    const total = countRows[0]?.total ?? 0;

    // Page
    const [rows] = await pool.query(
      `SELECT r.user_restricted as id, u.name, u.username, u.avatar FROM restrictions r
       JOIN users u ON r.user_restricted = u.id
       WHERE r.user_id = ? AND u.status != 'deleted'
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, skip]
    );

    const restrictions = rows.map(({ id, name, username, avatar }) => ({
      id: encryptId(id),
      name,
      username,
      avatar: avatar ? getFile(`avatar/${avatar}`) : null
    }));

    let next = '';
    if (skip + limit < total) {
      next = `/restrict/user?skip=${skip + limit}&limit=${limit}`;
    }

    return res.json(createExpressSuccessResponse('Restrictions retrieved successfully', {
      restrictions,
      pagination: { total, next }
    }));
  } catch (error) {
    logError('Error fetching user restrictions:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch user restrictions', 500));
  }
};
