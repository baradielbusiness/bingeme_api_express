import { createSuccessResponse, createErrorResponse, logInfo, logError, getSubscribersList, getSubscribersCount, getUserById, getFile, decryptId, isEncryptedId, verifyAccessToken, getUserPostsList, getUserPostsCount, getUserUpdatesList, getUserUpdatesCount, updateUserPost, deleteUserPost, getPostComments, updateUserSettings, sendOtpToUser, verifyUserOtp, searchUsersByName, changeUserPassword, createPasswordOtpForUser, verifyPasswordOtpForUser, blockUserById, getUserProfileBySlug, getAuthenticatedUserId, safeDecryptId, encryptId, createExpressSuccessResponse, createExpressErrorResponse, formatRelativeTime, formatDate, formatNumberWithK, getAllLanguages, getAllCountries, getStates, getGenderOptions, generateOTP, verifyEmailOTP, getUserSettings, checkUserFieldExists, checkMobileExists, getUserCountryById, updateUserAfterOTP, compareUserFields, getSupportCreatorIds, getSupportUserIds, getRestrictedUserIds, getSupportUsersByIds, getUsersBySearch, createApiResponse } from '../utils/common.js';
import { processUploadRequest } from '../utils/uploadUtils.js';
import { getDB } from '../config/database.js';
import { cancelSubscriptions } from '../utils/subscription.js';
import { processMediaFiles, cleanupS3Files } from '../utils/mediaProcessing.js';
import { validateProfileRequest } from '../validate/profile.js';
import { validateUserSettings } from '../utils/validations.js';
import { sendEmailOTP } from '../utils/mail.js';
import { sendWhatsAppOTP } from '../utils/whatsapp.js';
import { getUserByIdOrUsername, getTotalPosts, getTotalFollowers, getTotalSubscribers, getUserCards, getUserUpdates, getUpdatesInfo, getLiveStreamingData, getPreBookCount } from '../utils/profileUtils.js';
import { getMediaForUpdates, getBatchCommentsAndLikesCounts, getLatestComments, getTagsForUpdates } from '../utils/my_updates.js';

/**
 * Shared handler to generate pre-signed S3 URLs for uploading user profile image files.
 * Uses the shared processUploadRequest utility to eliminate code duplication.
 * 
 * @param {object} req - Express request object
 * @param {string} imageType - Type of profile image ('avatar' or 'cover')
 * @returns {Promise<object>} API response with pre-signed URLs or error
 */
const getUserProfileImageUploadUrlHandler = async (req, imageType) => {
  // Validate image type parameter
  if (!['avatar', 'cover'].includes(imageType)) {
    throw new Error(`Invalid image type: ${imageType}. Must be 'avatar' or 'cover'`);
  }

  // Configuration options for user profile image upload processing with destructuring
  const uploadOptions = {
    action: `getUser${imageType.charAt(0).toUpperCase() + imageType.slice(1)}UploadUrl`,
    basePath: `uploads/${imageType}`,
    useFolderOrganization: false, // User profile images use flat structure without folder organization
    successMessage: `Pre-signed user ${imageType} upload URLs generated`,
    getAuthenticatedUserId
  };
  
  // Use shared upload processing utility and return result directly
  return await processUploadRequest(req, uploadOptions);
};

/**
 * Moves processed media files to their final location and cleans up temporary files
 * @param {Object} processedImage - Object containing original and converted file paths
 * @param {string} newImagePath - Final destination path for the profile image
 * @param {string} bucketName - S3 bucket name
 * @param {string} userId - User ID for logging
 * @param {string} imageType - Type of image ('avatar' or 'cover')
 * @returns {Promise<string>} Final image file path
 */
const moveProcessedFileToFinalLocation = async (processedImage, newImagePath, bucketName, userId, imageType) => {
  const { original, converted } = processedImage;
  
  if (converted.length > 0) {
    try {
      // Download the converted WebP file
      const { downloadFile, uploadFile } = await import('../utils/s3Utils.js');
      const webpBuffer = await downloadFile(bucketName, converted[0]);
      
      // Upload to the new filename location
      await uploadFile(bucketName, newImagePath, webpBuffer, 'image/webp');
      
      // Clean up the temporary processed files
      await cleanupS3Files(original, converted, bucketName, imageType);
      
      logInfo(`${imageType} image moved to final location:`, { 
        userId, 
        from: converted[0], 
        to: newImagePath 
      });
      
      return newImagePath;
    } catch (moveError) {
      logError(`Failed to move ${imageType} image to final location:`, { 
        userId, 
        error: moveError.message 
      });
      
      // Fallback to using the processed file path
      return converted[0] || original[0];
    }
  } else {
    // No conversion happened, use original file
    return original[0];
  }
};

/**
 * Cleans up old profile image files from S3 with error handling
 * @param {string} oldImage - Path to the old image file
 * @param {string} bucketName - S3 bucket name
 * @param {string} userId - User ID for logging
 * @param {string} imageType - Type of image ('avatar' or 'cover')
 * @returns {Promise<void>}
 */
const cleanupOldImageFile = async (oldImage, bucketName, userId, imageType) => {
  try {
    // Delete old image from S3
    await cleanupS3Files([oldImage], [], bucketName, imageType);
    logInfo(`Old ${imageType} file cleaned up:`, { userId, oldImage });
  } catch (cleanupError) {
    logError(`Failed to cleanup old ${imageType} file:`, { userId, oldImage, error: cleanupError.message });
    // Don't fail the request if cleanup fails
  }
};

/**
 * Generates filename following the Laravel UserController convention
 * Format: {username}-{userId}{timestamp}{random10chars}.webp
 * @param {Object} user - User object containing username and id
 * @param {string} imageType - Type of image ('avatar' or 'cover')
 * @returns {Object} Object containing filename and full path
 */
const generateProfileImageFilename = (user, imageType) => {
  const { username = `user${user.id}`, id: userId } = user;
  const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
  const randomString = Math.random().toString(36).substring(2, 12); // 10 random characters
  const newFileName = `${username}-${userId}${timestamp}${randomString}.webp`;
  const newImagePath = `uploads/${imageType}/${newFileName}`;
  
  return {
    filename: newFileName,
    fullPath: newImagePath
  };
};

/**
 * Validates the uploaded image path format
 * @param {string} imagePath - Path to validate
 * @param {string} imageType - Expected image type ('avatar' or 'cover')
 * @returns {boolean} True if valid, false otherwise
 */
const validateImagePathFormat = (imagePath, imageType) => {
  if (typeof imagePath !== 'string' || !imagePath.startsWith(`uploads/${imageType}/`)) {
    return false;
  }
  return true;
};

/**
 * Determines if an image is a default image that shouldn't be deleted
 * @param {string} imagePath - Image path to check
 * @param {string} imageType - Type of image ('avatar' or 'cover')
 * @returns {boolean} True if default image, false otherwise
 */
const isDefaultImage = (imagePath, imageType) => {
  if (!imagePath) return false;
  
  const defaultImages = {
    avatar: ['default.webp', 'default.jpg', 'default-avatar.webp', 'default-avatar.jpg'],
    cover: ['default-cover.jpg', 'default-cover.webp', 'default.webp', 'default.jpg']
  };
  
  return defaultImages[imageType]?.includes(imagePath) || false;
};

/**
 * Shared handler to create/update user profile image from uploaded files.
 * Processes the uploaded file, converts to WebP format, and updates the user's profile.
 * 
 * @param {object} req - Express request object
 * @param {object} req.body - JSON string containing image data
 * @param {object} req.headers - Request headers containing authorization
 * @param {string} imageType - Type of profile image ('avatar' or 'cover')
 * @returns {Promise<object>} API response with success status or error
 */
const createUserProfileImageHandler = async (req, imageType) => {
  const startTime = Date.now();
  
  try {
    // Validate image type parameter
    if (!['avatar', 'cover'].includes(imageType)) {
      logError('Invalid image type specified:', { imageType });
      // TODO: Convert createErrorResponse(500, 'Invalid image type specified') to res.status(500).json({ error: 'Invalid image type specified' })
      return { statusCode: 500, body: JSON.stringify({ error: 'Invalid image type specified' }) };
    }

    // Destructure event properties for cleaner access
    // TODO: Convert event.httpMethod and event.body to req.method and req.body
    const { method: httpMethod, body: requestBody } = req;
    
    // Authenticate user (early return on failure)
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: `user ${imageType} creation` 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return { statusCode: errorResponse.statusCode, body: JSON.stringify(errorResponse.body) };
    }

    // Validate HTTP method
    if (httpMethod !== 'POST') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed') to res.status(405).json({ error: 'Method not allowed' })
      return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    // Parse and validate request body
    let body;
    try {
      body = requestBody;
    } catch (parseError) {
      logError(`JSON parse error in createUser${imageType.charAt(0).toUpperCase() + imageType.slice(1)}Handler:`, parseError);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }

    // Validate required fields with destructuring
    const imageField = imageType; // 'avatar' or 'cover'
    const imagePath = body[imageField];
    if (!imagePath) {
      // TODO: Convert createErrorResponse(400, `${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image path is required`) to res.status(400).json({ error: `${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image path is required` })
      return { statusCode: 400, body: JSON.stringify({ error: `${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image path is required` }) };
    }

    // Validate image path format (should be from S3 upload)
    if (!validateImagePathFormat(imagePath, imageType)) {
      // TODO: Convert createErrorResponse(400, `Invalid ${imageType} image path format. Must be uploaded via S3 first.`) to res.status(400).json({ error: `Invalid ${imageType} image path format. Must be uploaded via S3 first.` })
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid ${imageType} image path format. Must be uploaded via S3 first.` }) };
    }

    // Get user information for validation
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }

    // Get S3 bucket name from environment
    const bucketName = process.env.AWS_BUCKET_NAME;
    if (!bucketName) {
      // TODO: Convert createErrorResponse(500, 'S3 bucket not configured') to res.status(500).json({ error: 'S3 bucket not configured' })
      return { statusCode: 500, body: JSON.stringify({ error: 'S3 bucket not configured' }) };
    }

    // Generate the proper filename format like Laravel UserController
    const { filename: newFileName, fullPath: newImagePath } = generateProfileImageFilename(user, imageType);
    
    // For database storage, we only save the filename (without path)
    const dbFileName = newFileName;

    // Process the uploaded profile image file
    let processedImage = { original: [], converted: [] };
    try {
      // Process the image file using the same logic as other media
      processedImage = await processMediaFiles([imagePath], bucketName, imageType);
      logInfo(`${imageType} image processing completed:`, { 
        userId, 
        original: processedImage.original, 
        converted: processedImage.converted 
      });
    } catch (error) {
      logError(`${imageType} image processing failed:`, { userId, imagePath, error: error.message });
      // TODO: Convert createErrorResponse(500, `Failed to process ${imageType} image`) to res.status(500).json({ error: `Failed to process ${imageType} image` })
      return { statusCode: 500, body: JSON.stringify({ error: `Failed to process ${imageType} image` }) };
    }

    // Store old image path for cleanup (if exists and not default)
    const oldImage = user[imageType];
    const isDefault = isDefaultImage(oldImage, imageType);

    // Move the processed WebP file to the new filename location
    const finalImagePath = await moveProcessedFileToFinalLocation(
      processedImage, 
      newImagePath, 
      bucketName, 
      userId,
      imageType
    );

    // Update user's profile image in database
    const pool = getDB();
    const updateQuery = `UPDATE users SET ${imageType} = ?, updated_at = NOW() WHERE id = ?`;
    const [updateResult] = await pool.query(updateQuery, [dbFileName, userId]);

    if (updateResult.affectedRows === 0) {
      logError(`Failed to update user ${imageType} in database:`, { userId, finalImagePath });
      
      // Clean up processed files on database error
      await cleanupS3Files(processedImage.original, processedImage.converted, bucketName, imageType);
      
      // TODO: Convert createErrorResponse(500, `Failed to update ${imageType} image`) to res.status(500).json({ error: `Failed to update ${imageType} image` })
      return { statusCode: 500, body: JSON.stringify({ error: `Failed to update ${imageType} image` }) };
    }

    // Clean up old image file if it exists and is not default
    if (oldImage && !isDefault) {
      await cleanupOldImageFile(oldImage, bucketName, userId, imageType);
    }

    // Log successful profile image update with metrics
    const duration = Date.now() - startTime;
    const { original, converted } = processedImage;
    
    logInfo(`User ${imageType} updated successfully:`, { 
      userId, 
      s3Path: finalImagePath,
      dbFileName,
      oldImage: oldImage || 'none',
      isDefault,
      processedFiles: `${original.length}+${converted.length}`,
      duration: `${duration}ms`
    });

    // Return success response with image information
    // TODO: Convert createSuccessResponse(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image updated successfully`, {...}) to res.status(200).json(createSuccessResponse(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image updated successfully`, {...}))
    return { 
      statusCode: 200, 
      body: JSON.stringify(createSuccessResponse(`${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image updated successfully`, { 
        [imageType]: dbFileName,
        message: `${imageType.charAt(0).toUpperCase() + imageType.slice(1)} image has been updated successfully`
      }))
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    const { message, stack } = error;
    
    logError(`Error in createUser${imageType.charAt(0).toUpperCase() + imageType.slice(1)}Handler:`, { 
      error: message, 
      stack, 
      duration: `${duration}ms` 
    });
    
    // TODO: Convert createErrorResponse(500, 'Internal server error. Please try again later.') to res.status(500).json({ error: 'Internal server error. Please try again later.' })
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error. Please try again later.' }) };
  }
};

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
 * Retrieves user information from database by user ID
 * Uses the existing getUserById function for consistency and reusability
 * 
 * @param {number|string} userId - The user ID to retrieve information for
 * @returns {Promise<Object|null>} User data object or null if not found/inactive
 */
const getUserInfoById = async (userId) => {
  try {
    const user = await getUserById(userId);
    
    // Return null if user doesn't exist or has deleted status
    return user && user.status !== 'deleted' ? user : null;
  } catch (error) {
    logError('Database error in getUserInfoById:', error);
    throw new Error('Failed to retrieve user information from database');
  }
};

/**
 * Formats user data for API response
 * Extracts required fields and generates proper avatar URL
 * 
 * @param {Object} user - Raw user data from database
 * @returns {Object} Formatted user data with proper avatar URL
 */
const formatUserInfo = ({ name, email, avatar }) => ({
  name: name || 'Unknown User',
  email: email || '',
  avatar: avatar ? getFile(`avatar/${avatar}`) : ''
});

/**
 * Validates and extracts JWT token from request headers
 * 
 * @param {Object} headers - Request headers object
 * @returns {string|null} JWT token or null if invalid/missing
 */
const extractJwtToken = (headers = {}) => {
  const { Authorization, authorization } = headers;
  const authHeader = Authorization || authorization;
  
  // Check if Authorization header exists and has Bearer format
  return authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
};

/**
 * Processes and validates JWT token to extract user ID
 * Handles encrypted IDs automatically
 * 
 * @param {string} token - JWT token string
 * @returns {Object} Object containing userId and any errors
 */
const processJwtToken = (token) => {
  // Verify JWT token and decode user information
  const decoded = verifyAccessToken(token);
  if (!decoded) {
    return { error: 'Invalid or expired JWT token' };
  }

  // Extract user ID from decoded token
  const { id: userId } = decoded;
  if (!userId) {
    return { error: 'Token missing user ID' };
  }

  // Decrypt user ID if it's encrypted
  if (typeof userId === 'string' && isEncryptedId(userId)) {
    try {
      const decryptedId = decryptId(userId);
      logInfo('Decoded encrypted user ID:', { encodedId: userId, decodedId: decryptedId });
      return { userId: decryptedId };
    } catch (error) {
      logError('Failed to decode encrypted user ID:', { encodedId: userId, error: error.message });
      return { error: 'Invalid token format' };
    }
  }

  return { userId };
};

/**
 * Main handler function for /user/info endpoint
 * Orchestrates the complete flow from authentication to response
 * Exact implementation matching Lambda userInfoHandler
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} API Gateway response object
 */
export const getUserInfo = async (req, res) => {
  const { path, method: httpMethod, headers } = req;
  const { awsRequestId } = { awsRequestId: 'express-request' }; // TODO: Convert context.awsRequestId to req.id or similar

  try {
    // Log incoming request for debugging
    logInfo('User info endpoint called', { path, method: httpMethod, requestId: awsRequestId });

    // Extract and validate JWT token
    const token = extractJwtToken(headers);
    if (!token) {
      logError('Missing or invalid Authorization header');
      // TODO: Convert createErrorResponse(401, 'Unauthorized: Missing or invalid Authorization header') to res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization header' })
      return res.status(401).json(createErrorResponse(401, 'Unauthorized: Missing or invalid Authorization header'));
    }

    // Process JWT token and extract user ID
    const { userId, error: tokenError } = processJwtToken(token);
    if (tokenError) {
      logError('JWT token error:', tokenError);
      // TODO: Convert createErrorResponse(401, `Unauthorized: ${tokenError}`) to res.status(401).json({ error: `Unauthorized: ${tokenError}` })
      return res.status(401).json(createErrorResponse(401, `Unauthorized: ${tokenError}`));
    }

    // Retrieve user information from database
    const userData = await getUserInfoById(userId);
    if (!userData) {
      logError('User not found in database', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Format user data for response
    const formattedUserInfo = formatUserInfo(userData);

    // Log successful response for monitoring
    logInfo('User info retrieved successfully', { userId, requestId: awsRequestId });

    // Return success response with user information
    // TODO: Convert createSuccessResponse('User info retrieved successfully', formattedUserInfo) to res.status(200).json(createSuccessResponse('User info retrieved successfully', formattedUserInfo))
    return res.status(200).json(createSuccessResponse('User info retrieved successfully', formattedUserInfo));

  } catch (error) {
    // Log error with context for debugging
    logError('Error in user info handler:', {
      error: error.message,
      stack: error.stack,
      requestId: awsRequestId
    });

    // Return appropriate error response based on error type
    const errorMessage = error.message.includes('database') 
      ? 'Internal server error: Database operation failed'
      : 'Internal server error';
    
    // TODO: Convert createErrorResponse(500, errorMessage) to res.status(500).json({ error: errorMessage })
    return res.status(500).json(createErrorResponse(500, errorMessage));
  }
};


/**
 * Updates the user's password in the database.
 * @param {number|string} userId - User's unique ID
 * @param {string} newHashedPassword - New hashed password
 * @returns {Promise<boolean>} True if update succeeded, false otherwise
 */
const updateUserPassword = async (userId, newHashedPassword) => {
  try {
    const pool = getDB();
    const [result] = await pool.query(
      'UPDATE users SET password = ? WHERE id = ?',
      [newHashedPassword, userId]
    );
    return result.affectedRows > 0;
  } catch (error) {
    logError('DB error in updateUserPassword:', error);
    return false;
  }
};

/**
 * Lambda handler for POST /user/change-password
 * Securely updates the password for the authenticated user.
 * Exact implementation matching Lambda changePasswordHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API Gateway response
 */
export const changePassword = async (req, res) => {
  try {
    // 1. Authenticate user using utility (handles JWT extraction/validation)
    // TODO: Convert getAuthenticatedUserId(event, { action: 'change password' }) to getAuthenticatedUserId(req, { action: 'change password' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'change password' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    if (!userId) {
      // TODO: Convert createErrorResponse(401, 'Access token required or invalid') to res.status(401).json({ error: 'Access token required or invalid' })
      return res.status(401).json(createErrorResponse(401, 'Access token required or invalid'));
    }

    // 2. Parse and validate request body
    // TODO: Convert JSON.parse(event.body) to req.body (already parsed by Express middleware)
    let body;
    try {
      body = req.body;
    } catch (err) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }
    const { old_password, new_password, confirm_password } = body || {};
    if (!old_password || !new_password || !confirm_password) {
      // TODO: Convert createErrorResponse(400, 'old_password, new_password, and confirm_password are required') to res.status(400).json({ error: 'old_password, new_password, and confirm_password are required' })
      return res.status(400).json(createErrorResponse(400, 'old_password, new_password, and confirm_password are required'));
    }
    if (old_password === new_password) {
      // TODO: Convert createErrorResponse(400, 'New password must be different from old password') to res.status(400).json({ error: 'New password must be different from old password' })
      return res.status(400).json(createErrorResponse(400, 'New password must be different from old password'));
    }
    if (new_password !== confirm_password) {
      // TODO: Convert createErrorResponse(400, 'New password and confirm password do not match') to res.status(400).json({ error: 'New password and confirm password do not match' })
      return res.status(400).json(createErrorResponse(400, 'New password and confirm password do not match'));
    }
    if (new_password.length < 6) {
      // TODO: Convert createErrorResponse(400, 'New password must be at least 6 characters long') to res.status(400).json({ error: 'New password must be at least 6 characters long' })
      return res.status(400).json(createErrorResponse(400, 'New password must be at least 6 characters long'));
    }

    // 3. Fetch user and check old password
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    if (!user.password) {
      // TODO: Convert createErrorResponse(400, 'No password set for this account. Please create a password first.') to res.status(400).json({ error: 'No password set for this account. Please create a password first.' })
      return res.status(400).json(createErrorResponse(400, 'No password set for this account. Please create a password first.'));
    }
    const { password: hashedPassword } = user;
    // Compare old password with hash
    const bcrypt = await import('bcryptjs');
    const isMatch = await bcrypt.default.compare(old_password, hashedPassword);
    if (!isMatch) {
      // TODO: Convert createErrorResponse(400, 'Old password is incorrect') to res.status(400).json({ error: 'Old password is incorrect' })
      return res.status(400).json(createErrorResponse(400, 'Old password is incorrect'));
    }
    // Prevent setting the same password (even if hash matches, check plaintext)
    const isSame = await bcrypt.default.compare(new_password, hashedPassword);
    if (isSame) {
      // TODO: Convert createErrorResponse(400, 'New password must be different from old password') to res.status(400).json({ error: 'New password must be different from old password' })
      return res.status(400).json(createErrorResponse(400, 'New password must be different from old password'));
    }

    // 4. Hash new password securely
    const newHashedPassword = await bcrypt.default.hash(new_password, 10);

    // 5. Update password
    const updatePassword = await updateUserPassword(userId, newHashedPassword);
    if (!updatePassword) {
      logError('Password update failed for user:', userId);
      // TODO: Convert createErrorResponse(500, 'Failed to update password') to res.status(500).json({ error: 'Failed to update password' })
      return res.status(500).json({ error: 'Failed to update password' });
    }

    // 6. Return success response
    // TODO: Convert createSuccessResponse('Password updated successfully', null) to res.status(200).json(createSuccessResponse('Password updated successfully', null))
    return res.status(200).json(createSuccessResponse('Password updated successfully', null));
  } catch (error) {
    // Log error (never log plain passwords)
    logError('Change password error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Updates a user's password using a secure hash.
 *
 * @param {number|string} userId - User ID
 * @param {string} plainPassword - New password in plain text
 * @returns {Promise<boolean>} True if updated
 */
const updateUserPasswordById = async (userId, plainPassword) => {
  const bcrypt = await import('bcryptjs');
  const hashed = await bcrypt.default.hash(plainPassword, 12);
  const pool = getDB();
  const [result] = await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
  return result.affectedRows > 0;
};

/**
 * Validates password creation input.
 *
 * - Ensures both fields exist and match
 * - Checks basic rule: password must be digits only and at least 6 characters
 *
 * @param {object} params - Input object
 * @param {string} params.password - New password
 * @param {string} params.confirm_password - Confirmation password
 * @returns {{ valid: boolean, message?: string }} Validation result
 */
const validateCreatePassword = ({ password, confirm_password }) => {
  // Require both fields
  if (!password || !confirm_password) {
    return { valid: false, message: 'Password and confirm_password are required' };
  }

  // Ensure they match
  if (password !== confirm_password) {
    return { valid: false, message: 'Passwords do not match' };
  }

  // Basic rule change: allow only digits, minimum length 7
  // - hasMinLength: ensure password length is greater than 6 (i.e., >= 7)
  // - isAllDigits: ensure every character is a digit (0-9)
  const hasMinLength = password.length >= 6;
  const isAllDigits = /^\d+$/.test(password);
  if (!hasMinLength || !isAllDigits) {
    return { valid: false, message: 'Password must be at least 7 digits (numbers only)' };
  }

  return { valid: true };
};

/**
 * Sends OTP to user's verified contact for password creation.
 * - Validates password and confirm_password
 * - Determines verified contact (email and/or mobile)
 * - Sends OTP and stores it in DynamoDB via generateOTP
 * Exact implementation matching Lambda createPasswordOtp
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response
 */
export const createPasswordOtp = async (req, res) => {
  try {
    // Require authenticated user (non-anonymous)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'create password' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'create password' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'create password' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse body and validate (accept new_password)
    // TODO: Convert JSON.parse(event.body || '{}') to req.body (already parsed by Express middleware)
    const { new_password, confirm_password } = req.body || {};
    const { valid, message: validationMessage } = validateCreatePassword({ password: new_password, confirm_password });
    if (!valid) {
      // TODO: Convert createErrorResponse(400, validationMessage) to res.status(400).json({ error: validationMessage })
      return res.status(400).json(createErrorResponse(400, validationMessage));
    }

    // Fetch user and verification flags
    const contact = await getUserById(userId);
    if (!contact) {
      // TODO: Convert createErrorResponse(400, 'No verified contact found') to res.status(400).json({ error: 'No verified contact found' })
      return res.status(400).json(createErrorResponse(400, 'No verified contact found'));
    }

    // If user already has a password, do not send OTP
    if (contact.password) {
      // TODO: Convert createErrorResponse(400, 'You already have a password set. OTP not sent.') to res.status(400).json({ error: 'You already have a password set. OTP not sent.' })
      return res.status(400).json(createErrorResponse(400, 'You already have a password set. OTP not sent.'));
    }

    const destinations = [];
    const { email, mobile, email_verified, mobile_verified } = contact;
    // Check verification flags like Laravel flow (email_verified/mobile_verified stored as '1' or 'yes')
    const isEmailVerified = email && (email_verified === '1' || email_verified === 1 || email_verified === 'yes');
    const isMobileVerified = mobile && (mobile_verified === '1' || mobile_verified === 1 || mobile_verified === 'yes');

    // If no verified contacts, allow direct password update without OTP
    if (!isEmailVerified && !isMobileVerified) {
      // Update password directly without OTP verification
      const updated = await updateUserPasswordById(userId, new_password);
      if (!updated) {
        // TODO: Convert createErrorResponse(500, 'Failed to update password') to res.status(500).json({ error: 'Failed to update password' })
        return res.status(500).json(createErrorResponse(500, 'Failed to update password'));
      }
      
      logInfo('Password updated directly without OTP', { userId });
      // TODO: Convert Lambda response format to Express response format
      return res.status(200).json({ 
        success: true, 
        message: 'Password updated successfully (no verified contact found, OTP verification skipped)' 
      });
    }

    // Generate and send OTP to verified destinations
    const { generateOTP } = await import('../utils/common.js');
    const { sendEmailOTP } = await import('../utils/mail.js');
    const { sendWhatsAppOTP } = await import('../utils/whatsapp.js');
    
    if (isEmailVerified) {
      const otp = await generateOTP(email);
      await sendEmailOTP(email, otp, 'login');
      destinations.push('email');
    }
    if (isMobileVerified) {
      // Expect mobile to include country code already in DB (as used elsewhere)
      // Attempt to extract country code and local part for WhatsApp util
      const match = String(mobile).match(/^(\+\d{1,4})?(\d{6,15})$/);
      if (match) {
        const countryCode = match[1] || '';
        const local = match[2];
        const otp = await generateOTP(`${countryCode}${local}` || mobile);
        await sendWhatsAppOTP(local, countryCode, otp);
        destinations.push('mobile');
      }
    }

    if (!destinations.length) {
      // TODO: Convert createErrorResponse(400, 'Validation errors or no verified contact found') to res.status(400).json({ error: 'Validation errors or no verified contact found' })
      return res.status(400).json(createErrorResponse(400, 'Validation errors or no verified contact found'));
    }

    // Build masked contact message
    const maskEmail = (addr) => {
      if (!addr || typeof addr !== 'string') return '';
      const [local, domain] = addr.split('@');
      if (!local || !domain) return '';
      const head = local.slice(0, 2);
      const masked = head + '*'.repeat(Math.max(0, local.length - 2));
      return `${masked}@${domain}`;
    };
    const maskPhone = (countryCode, local) => {
      const cc = (countryCode || '').startsWith('+') ? countryCode : `+${countryCode || ''}`;
      if (!local) return cc;
      const start = local.slice(0, 2);
      const end = local.slice(-3);
      const stars = '*'.repeat(Math.max(0, local.length - 5));
      return `${cc}${start}${stars}${end}`;
    };

    const parts = [];
    if (isEmailVerified && email) {
      const masked = maskEmail(email);
      if (masked) parts.push(`Email address ${masked}`);
    }
    if (isMobileVerified) {
      const match = String(mobile).match(/^(\+\d{1,4})?(\d{6,15})$/);
      if (match) {
        const countryCode = match[1] || '';
        const local = match[2];
        const masked = maskPhone(countryCode || '+', local);
        if (masked) parts.push(`Whatsapp number ${masked}`);
      }
    }

    const message = parts.length
      ? `We just sent a 5-digit code to your ${parts.join(', and ')}`
      : 'OTP sent successfully';

    logInfo('Password create OTP sent', { userId, destinations });
    // TODO: Convert Lambda response format to Express response format
    return res.status(200).json({ success: true, message });
  } catch (error) {
    logError('createPasswordOtp error', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Verifies OTP and updates password upon success.
 * - Validates provided otp
 * - Checks DynamoDB stored OTP (email or mobile identifier)
 * - On success, hashes and stores password in DB
 * Exact implementation matching Lambda verifyPasswordOtp
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response
 */
export const verifyPasswordOtp = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'verify password otp' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verify password otp' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verify password otp' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse input (accept only otp and password)
    // TODO: Convert JSON.parse(event.body || '{}') to req.body (already parsed by Express middleware)
    const { otp, password } = req.body || {};
    if (!otp || typeof otp !== 'string') {
      // TODO: Convert createErrorResponse(400, 'OTP is required') to res.status(400).json({ error: 'OTP is required' })
      return res.status(400).json(createErrorResponse(400, 'OTP is required'));
    }

    // Validate password rules (reuse validator by mirroring confirm to password)
    const { valid, message: validationMessage2 } = validateCreatePassword({ password, confirm_password: password });
    if (!valid) {
      // TODO: Convert createErrorResponse(400, validationMessage2) to res.status(400).json({ error: validationMessage2 })
      return res.status(400).json(createErrorResponse(400, validationMessage2));
    }

    // Get user verified contacts to decide identifiers to check
    const contact = await getUserById(userId);
    if (!contact) {
      // TODO: Convert createErrorResponse(400, 'Invalid or expired OTP') to res.status(400).json({ error: 'Invalid or expired OTP' })
      return res.status(400).json(createErrorResponse(400, 'Invalid or expired OTP'));
    }
    const { email, mobile, email_verified, mobile_verified } = contact;
    const isEmailVerified = email && (email_verified === '1' || email_verified === 1 || email_verified === 'yes');
    const isMobileVerified = mobile && (mobile_verified === '1' || mobile_verified === 1 || mobile_verified === 'yes');

    // If no verified contacts, allow direct password update without OTP verification
    if (!isEmailVerified && !isMobileVerified) {
      // Update password directly without OTP verification
      const updated = await updateUserPasswordById(userId, password);
      if (!updated) {
        // TODO: Convert createErrorResponse(500, 'Failed to update password') to res.status(500).json({ error: 'Failed to update password' })
        return res.status(500).json(createErrorResponse(500, 'Failed to update password'));
      }
      
      logInfo('Password updated directly without OTP verification', { userId });
      // TODO: Convert Lambda response format to Express response format
      return res.status(200).json({ 
        success: true, 
        message: 'Password updated successfully (no verified contact found, OTP verification skipped)' 
      });
    }

    // Try verifying OTP against email first if verified, else mobile
    const { verifyEmailOTP } = await import('../utils/common.js');
    let verified = false;
    if (isEmailVerified) {
      verified = await verifyEmailOTP(email, otp);
    }
    if (!verified && isMobileVerified) {
      const match = String(mobile).match(/^(\+\d{1,4})?(\d{6,15})$/);
      const identifier = match ? `${match[1] || ''}${match[2]}` : mobile;
      verified = await verifyEmailOTP(identifier, otp);
    }

    if (!verified) {
      // TODO: Convert Lambda response format to Express response format
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    // OTP ok: update password
    const updated = await updateUserPasswordById(userId, password);
    if (!updated) {
      // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
      return res.status(500).json(createErrorResponse(500, 'Internal server error'));
    }

    // TODO: Convert Lambda response format to Express response format
    return res.status(200).json({ success: true, message: 'OTP verified successfully' });
  } catch (error) {
    logError('verifyPasswordOtp error', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// Constants for validation - using the same reasons as the reports table
const VALID_REASONS = ['privacy_issue', 'copyright', 'violent_sexual_content', 'spoofing', 'spam', 'report_abuse', 'under_age', 'bingeme_terms_of_service'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_MESSAGE_LENGTH = 30;
const MAX_NAME_LENGTH = 255;

/**
 * Gets or creates a report record for a user pair using firstOrNew pattern.
 * Uses the existing reports table like reportCreator function.
 * @param {number|string} userId - The user performing the block
 * @param {number|string} blockedUserId - The user being blocked
 * @returns {Promise<object>} Report record with exists property
 */
const getOrCreateReport = async (userId, blockedUserId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT id, reason, message, name, email FROM reports WHERE user_id = ? AND report_id = ? AND type = "user"',
      [userId, blockedUserId]
    );
    
    return rows.length > 0 
      ? { ...rows[0], exists: true }
      : { exists: false };
  } catch (error) {
    logError('Error fetching report record:', error);
    throw error;
  }
};

/**
 * Adds a report for blocking a user with additional user input fields.
 * Uses the existing reports table like reportCreator function.
 * @param {number|string} userId - The user performing the block
 * @param {number|string} blockedUserId - The user being blocked
 * @param {string} reason - Reason for blocking
 * @param {string} message - Detailed message about the block
 * @param {string} name - Name of the user reporting
 * @param {string} email - Email of the user reporting
 * @returns {Promise<void>}
 */
const addReport = async (userId, blockedUserId, reason, message, name, email) => {
  try {
    const pool = getDB();
    await pool.query(
      'INSERT INTO reports (user_id, report_id, type, reason, message, name, email, comments, internal_comments, status, created_at) VALUES (?, ?, "user", ?, ?, ?, ?, "", "", 0, NOW())',
      [userId, blockedUserId, reason, message, name, email]
    );
  } catch (error) {
    logError('Error adding report:', error);
    throw error;
  }
};

/**
 * Validates user input fields for reporting/blocking.
 * @param {object} inputs - Object containing reason, message, name, email
 * @returns {object|null} Error response if validation fails, null if valid
 */
const validateReportInputs = ({ reason, message, name, email }) => {
  if (!reason || !message || !name || !email) {
    // TODO: Convert createErrorResponse(400, 'Missing required fields: reason, message, name, and email are required when reporting a user') to res.status(400).json({ error: 'Missing required fields: reason, message, name, and email are required when reporting a user' })
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: reason, message, name, and email are required when reporting a user' }) };
  }

  if (!VALID_REASONS.includes(reason)) {
    // TODO: Convert createErrorResponse(400, `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}`) to res.status(400).json({ error: `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}` })
    return { statusCode: 400, body: JSON.stringify({ error: `Invalid reason. Must be one of: ${VALID_REASONS.join(', ')}` }) };
  }

  if (message.length < MIN_MESSAGE_LENGTH) {
    // TODO: Convert createErrorResponse(400, `Message must be at least ${MIN_MESSAGE_LENGTH} characters long`) to res.status(400).json({ error: `Message must be at least ${MIN_MESSAGE_LENGTH} characters long` })
    return { statusCode: 400, body: JSON.stringify({ error: `Message must be at least ${MIN_MESSAGE_LENGTH} characters long` }) };
  }

  if (!EMAIL_REGEX.test(email)) {
    // TODO: Convert createErrorResponse(400, 'Invalid email format') to res.status(400).json({ error: 'Invalid email format' })
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid email format' }) };
  }

  if (name.length < 1 || name.length > MAX_NAME_LENGTH) {
    // TODO: Convert createErrorResponse(400, `Name must be between 1 and ${MAX_NAME_LENGTH} characters`) to res.status(400).json({ error: `Name must be between 1 and ${MAX_NAME_LENGTH} characters` })
    return { statusCode: 400, body: JSON.stringify({ error: `Name must be between 1 and ${MAX_NAME_LENGTH} characters` }) };
  }

  return null; // Validation passed
};

/**
 * Handler to add a user report.
 * If the report already exists, returns an error. Otherwise, adds a new report.
 * Exact implementation matching Lambda blockUserHandler
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} Response with report status
 */
export const blockUser = async (req, res) => {
  try {
    logInfo('Report user request received');

    // Authenticate user and get their ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'block user' }) to getAuthenticatedUserId(req, { action: 'block user' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'block user' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Get the user ID to block from path parameters
    // TODO: Convert event.pathParameters to req.params
    const { id: userToBlockId } = req.params || {};
    if (!userToBlockId) {
      // TODO: Convert createErrorResponse(400, 'User ID is required') to res.status(400).json({ error: 'User ID is required' })
      return res.status(400).json(createErrorResponse(400, 'User ID is required'));
    }

    // Decrypt user ID using safeDecryptId
    let parsedUserToBlockId;
    try {
      parsedUserToBlockId = safeDecryptId(userToBlockId);
      logInfo('Decoded user ID:', { originalId: userToBlockId, decodedId: parsedUserToBlockId });
    } catch (error) {
      logError('Error decrypting user ID:', { userToBlockId, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid user ID format') to res.status(400).json({ error: 'Invalid user ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
    }

    // Parse request body for user inputs
    // TODO: Convert event.body to req.body (already parsed by Express middleware)
    let requestBody = {};
    if (req.body) {
      try {
        requestBody = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (parseError) {
        // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
        return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
      }
    }

    // Extract user inputs
    const { reason, message, name, email } = requestBody;

    // Fetch the user to block
    const targetUser = await getUserById(parsedUserToBlockId);
    if (!targetUser) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Prevent users from blocking themselves
    if (targetUser.id == userId) {
      // TODO: Convert createErrorResponse(400, 'Cannot block yourself') to res.status(400).json({ error: 'Cannot block yourself' })
      return res.status(400).json(createErrorResponse(400, 'Cannot block yourself'));
    }

    // Do not allow blocking super admin (role = 'admin' and id = 1)
    if (targetUser.role === 'admin' && targetUser.id === 1) {
      // TODO: Convert createSuccessResponse('Block updated successfully', {...}) to res.status(200).json(createSuccessResponse('Block updated successfully', {...}))
      return res.status(200).json(createSuccessResponse('Block updated successfully', {
        message: 'Block updated successfully',
        status: 200,
        success: true,
        timestamp: new Date().toISOString()
      }));
    }

    // Check if report already exists
    const reportData = await getOrCreateReport(userId, parsedUserToBlockId);
    
    if (reportData.exists) {
      // Report already exists, return error (like reportCreator function)
      // TODO: Convert createErrorResponse(400, 'Report already exists for this user') to res.status(400).json({ error: 'Report already exists for this user' })
      return res.status(400).json(createErrorResponse(400, 'Report already exists for this user'));
    }

    // Report doesn't exist, validate inputs before adding
    const validationError = validateReportInputs({ reason, message, name, email });
    if (validationError) {
      // TODO: Convert return validationError to return res.status(validationError.statusCode).json(JSON.parse(validationError.body))
      return res.status(validationError.statusCode).json(JSON.parse(validationError.body));
    }

    // Add the report with validated inputs
    await addReport(userId, parsedUserToBlockId, reason, message, name, email);
    logInfo('User report added:', { userId, userToBlockId: parsedUserToBlockId, reason, name, email });
    
    // TODO: Convert createSuccessResponse('Report added successfully', {...}) to res.status(200).json(createSuccessResponse('Report added successfully', {...}))
    return res.status(200).json(createSuccessResponse('Report added successfully', {
      message: 'Report added successfully',
      status: 200,
      success: true,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    logError('Report user error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Determine if a live stream is currently ongoing or about to start
 * @param {Object} liveData - Live streaming data object
 * @returns {Object} Object containing goLive boolean and liveLink string
 */
const determineLiveStatus = (liveData) => {
  if (!liveData) {
    return { goLive: false, liveLink: '' };
  }

  const now = new Date();
  
  // Create Date objects directly from UTC datetime strings
  const startTime = liveData.date_time ? new Date(liveData.date_time + 'Z') : null;
  const endTime = liveData.end_at ? new Date(liveData.end_at + 'Z') : null;
  
  if (!startTime || !endTime) {
    return { goLive: false, liveLink: '' };
  }
  
  // Calculate time differences in milliseconds
  const timeUntilStart = startTime.getTime() - now.getTime();
  const timeUntilEnd = endTime.getTime() - now.getTime();
  
  // Live is considered "ongoing" if:
  // 1. It's within 5 minutes before start time, OR
  // 2. It's currently running (between start and end time)
  const fiveMinutesInMs = 5 * 60 * 1000;
        
  // Simplified logic: Check if live is within 5 minutes of start time
  const isWithinFiveMinutes = Math.abs(timeUntilStart) <= fiveMinutesInMs;
  const isCurrentlyRunning = timeUntilStart < 0 && timeUntilEnd > 0;
  
  if (isWithinFiveMinutes || isCurrentlyRunning) {
    return {
      goLive: true,
      liveLink: `${process.env.APP_URL || 'https://bingeme.com'}/live/${liveData.username || 'unknown'}`
    };
  }
  
  return { goLive: false, liveLink: '' };
};

/**
 * Format user profile data with all required fields
 * @param {Object} user - User data object
 * @param {number} totalPosts - Total posts count
 * @param {number} totalFollowers - Total followers count
 * @param {number} totalSubscribers - Total subscribers count
 * @returns {Object} Formatted user profile data
 */
const formatUserProfile = (user, totalPosts, totalFollowers, totalSubscribers) => ({
  ...user, // Basic user data from users table
  avatar: user.avatar ? getFile(`avatar/${user.avatar}`) : '',
  cover: user.cover ? getFile(`cover/${user.cover}`) : '',
  total_posts: formatNumberWithK(totalPosts),
  total_followers: formatNumberWithK(totalFollowers),
  total_subscribers: formatNumberWithK(totalSubscribers)
});

/**
 * Format live streaming data for response
 * @param {Object} liveData - Live streaming data
 * @param {boolean} goLive - Whether live is currently ongoing
 * @param {string} liveLink - Live stream link
 * @param {number} preBookCount - Pre-book count
 * @returns {Object|null} Formatted live data or null
 */
const formatLiveData = (liveData, goLive, liveLink, preBookCount) => {
  if (!liveData) return null;
  
  return {
    live_id: encryptId(liveData.id),
    title: liveData.name,
    date: liveData.date_time ? liveData.date_time.split(' ')[0] : null,
    time: liveData.date_time ? liveData.date_time.split(' ')[1] : null,
    duration: liveData.duration ? `${liveData.duration} minutes` : null,
    price: liveData.price,
    live_status: goLive ? 'Ongoing live' : 'Upcoming live',
    status: liveData.status,
    go_live: goLive,
    prebook_count: preBookCount,
    live_link: liveLink,
    url: liveData.url,
    agoraAppId: liveData.agoraAppId,
    agoraChannel: liveData.agoraChannel,
    token: liveData.token,
    uid: liveData.uid,
    creator_joined: liveData.creator_joined,
    number_of_reschedules: liveData.number_of_reschedules
  };
};

/**
 * Format connect with me cards data
 * @param {Array} cards - Array of user cards/products
 * @returns {Array} Formatted cards data
 */
const formatConnectCards = (cards) => cards.map(card => ({
  id: encryptId(card.id),
  name: card.name,
  description: card.description,
  price: card.price,
  delivery_time: card.delivery_time ? `${card.delivery_time} days` : null,
  created_at: card.created_at ? formatDate(card.created_at) : null,
  purchase_count: card.purchase_count,
  image: card.image ? getFile(`shop/${card.image}`) : ''
}));

/**
 * Format updates data with media, comments, and engagement metrics
 * @param {Array} updates - Array of updates
 * @param {Object} mediaByUpdate - Media data grouped by update ID
 * @param {Object} commentsCounts - Comments counts by update ID
 * @param {Object} likesCounts - Likes counts by update ID
 * @param {Object} tagsByUpdate - Tags data grouped by update ID
 * @param {number} currentUserId - Current authenticated user ID
 * @param {string} username - Creator's username for share URL generation
 * @returns {Promise<Array>} Formatted updates with all details
 */
const formatUpdates = async (updates, mediaByUpdate, commentsCounts, likesCounts, tagsByUpdate, currentUserId, username) => {
  const updatesWithDetails = await Promise.all(updates.map(async (update) => {
    const comments = await getLatestComments(update.id, 2, currentUserId);
    
    return {
      ...update,
      media: mediaByUpdate[update.id] || [],
      comments_count: commentsCounts[update.id] || 0,
      likes: likesCounts[update.id] || 0,
      comments: comments,
      tags: tagsByUpdate[update.id] || []
    };
  }));

  /**
   * Format updates data for profile response
   * Uses object destructuring and rest operator for maintainability
   * @param {Array} updatesWithDetails - Array of updates with media, comments, and tags
   * @param {string} username - Creator's username for share URL generation
   * @returns {Array} Formatted updates array for profile display
   */
  return updatesWithDetails.map(update => {
    // Destructure fields that need custom formatting
    const { id, description, date, date_utc, fixed_post, price, expired_at, ...remainingFields } = update; // All other fields (locked, tags, media, comments_count, likes, comments, etc.) 
    
    return {
      // Custom formatted fields
      id: encryptId(id),
      caption: description || '',
      date: date_utc ? formatRelativeTime(date_utc) : (date ? formatRelativeTime(date) : 'just now'),
      pinned: fixed_post === '1',
      price: price || 0,
      expired_at: expired_at, // Return exact database value without conversion
      share_url: `${process.env.APP_URL || 'https://bingeme.com'}/${username}/post/${id}`, // Share URL for the post
      // Spread remaining fields automatically
      ...remainingFields
    };
  });
};

/**
 * Main profile handler function
 * Retrieves and formats user profile data including posts, followers, live streams, and updates
 * Exact implementation matching Lambda profileHandler
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} API response with profile data or error
 */
export const getProfile = async (req, res) => {
  try {
    // Step 1: Validate request parameters
    // TODO: Convert validateProfileRequest(event) to validateProfileRequest(req)
    const validationResult = validateProfileRequest(req);
    if (!validationResult.isValid) {
      logError('Profile access: Validation failed', { error: validationResult.error });
      // TODO: Convert createErrorResponse(400, validationResult.error) to res.status(400).json({ error: validationResult.error })
      return res.status(400).json(createErrorResponse(400, validationResult.error));
    }
    
    const { slug } = validationResult;

    // Step 2: Handle user authentication (required for profile routes)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'profile access' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'profile access' })
    const authResult = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'profile access' });
    if (authResult.errorResponse) {
      // TODO: Convert return authResult.errorResponse to return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body)
      return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body);
    }
    
    const userId = authResult.userId;
    
    // Get authenticated user from database
    const authUser = await getUserByIdOrUsername(userId, 'id');
    if (!authUser) {
      logError('Profile access: Invalid authenticated user', { userId });
      // TODO: Convert createErrorResponse(400, 'Invalid User') to res.status(400).json({ error: 'Invalid User' })
      return res.status(400).json(createErrorResponse(400, 'Invalid User'));
    }

    // Step 3: Determine if this is own profile or other user's profile
    let user;
    
    if (slug === 'profile') {
      // Own profile - use authenticated user data directly
      user = authUser;
      logInfo('Profile access: Own profile', { userId: authUser.id, username: authUser.username });
    } else {
      // Other user's profile - get user data by username
      user = await getUserByIdOrUsername(slug, 'username');
      if (!user) {
        logError('Profile access: User not found', { slug, authUserId: userId });
        // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
        return res.status(404).json(createErrorResponse(404, 'User not found'));
      }
    }

    // Step 4: Get all required user data
    const totalPosts = await getTotalPosts(user.id);
    const totalFollowers = await getTotalFollowers(user.id);
    const totalSubscribers = await getTotalSubscribers(user.id);
    const cards = await getUserCards(user.id);
    const updates = await getUserUpdates(user.id, userId);
    const updatesInfo = await getUpdatesInfo(user.id);
    const liveData = await getLiveStreamingData(user.id);

    // Step 5: Process updates data
    const updateIds = updates.map(update => update.id);
    const [mediaByUpdate, { comments: commentsCounts, likes: likesCounts }, tagsByUpdate] = await Promise.all([
      getMediaForUpdates(updateIds),
      getBatchCommentsAndLikesCounts(updateIds),
      getTagsForUpdates(updateIds)
    ]);

    // Step 6: Process live streaming data
    let preBookCount = 0;
    let { goLive, liveLink } = determineLiveStatus(liveData);

    if (liveData) {
      preBookCount = await getPreBookCount(liveData.id);
      // Update liveLink with username if available
      if (goLive && user.username) {
          liveLink = `${process.env.APP_URL || 'https://bingeme.com'}/live/${user.username}`;
      }
    }

    // Step 7: Format all data for response
    const responseData = {
      user: formatUserProfile(user, totalPosts, totalFollowers, totalSubscribers),
      live: formatLiveData(liveData, goLive, liveLink, preBookCount),
      connect: formatConnectCards(cards),
      updates_info: updatesInfo,
      updates: await formatUpdates(updates, mediaByUpdate, commentsCounts, likesCounts, tagsByUpdate, userId, user.username)
    };

    // TODO: Convert createSuccessResponse(responseData) to res.status(200).json(createSuccessResponse('Profile retrieved successfully', responseData))
    return res.status(200).json(createSuccessResponse('Profile retrieved successfully', responseData));

  } catch (err) {
    logError('Profile error:', err);
    // TODO: Convert createErrorResponse(500, err.message) to res.status(500).json({ error: err.message })
    return res.status(500).json(createErrorResponse(500, err.message));
  }
};

/**
 * Updates the dark_mode field for a user in the database.
 * @param {string} userId - The user's ID.
 * @param {string} darkModeValue - 'on' for dark mode, 'off' for light mode.
 * @returns {Promise<boolean>} - True if update was successful, false otherwise.
 */
const setUserDarkMode = async (userId, darkModeValue) => {
  const updateQuery = `
    UPDATE users 
    SET dark_mode = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ? AND status != 'deleted'
  `;
  try {
    const pool = getDB();
    const [result] = await pool.query(updateQuery, [darkModeValue, userId]);
    return result.affectedRows > 0;
  } catch (error) {
    logInfo('Database error while updating dark mode:', error);
    throw error;
  }
};

/**
 * Lambda handler for /user/mode/{mode} endpoint (POST).
 * Handles authentication, input validation, DB update, and response formatting.
 * Exact implementation matching Lambda darkModehandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} - API Gateway response.
 */
export const darkMode = async (req, res) => {
  try {
    logInfo('Dark mode request received');

    // Authenticate user and extract userId
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'dark_mode handler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'dark_mode handler' })
    const { userId, decoded, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'dark_mode handler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { email, role } = decoded;
    logInfo('Access token verified successfully:', { userId, email, role });

    // Validate HTTP method (should be POST)
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'POST') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed. Use POST.') to res.status(405).json({ error: 'Method not allowed. Use POST.' })
      return res.status(405).json(createErrorResponse(405, 'Method not allowed. Use POST.'));
    }

    // Get mode from path parameters
    // TODO: Convert event.pathParameters to req.params
    const { mode } = req.params || {};
    if (!mode || !['dark', 'light'].includes(mode)) {
      // TODO: Convert createErrorResponse(400, 'Invalid mode parameter. Must be "dark" or "light"') to res.status(400).json({ error: 'Invalid mode parameter. Must be "dark" or "light"' })
      return res.status(400).json(createErrorResponse(400, 'Invalid mode parameter. Must be "dark" or "light"'));
    }

    // Parse body and extract previous_url if present
    // TODO: Convert event.body to req.body (already parsed by Express middleware)
    let body = {};
    if (req.body) {
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch (parseError) {
        // TODO: Convert createErrorResponse(400, 'Invalid JSON body') to res.status(400).json({ error: 'Invalid JSON body' })
        return res.status(400).json(createErrorResponse(400, 'Invalid JSON body'));
      }
    }
    const { previous_url } = body;
    // TODO: Convert event.queryStringParameters and event.headers to req.query and req.headers
    const { queryStringParameters = {}, headers = {} } = { queryStringParameters: req.query, headers: req.headers };
    const previousUrl = previous_url || queryStringParameters.previous_url || headers['referer'] || headers['referrer'] || '/';

    logInfo('Dark mode request details:', { userId, mode, previousUrl });

    // Prepare values for DB and response
    const darkModeValue = mode === 'dark' ? 'on' : 'off'; // for DB
    const darkModeNumeric = mode === 'dark' ? 1 : 0;

    // Update user's dark mode setting in DB
    try {
      const updateSuccess = await setUserDarkMode(userId, darkModeValue);
      if (!updateSuccess) {
        // TODO: Convert createErrorResponse(404, 'User not found or account deleted') to res.status(404).json({ error: 'User not found or account deleted' })
        return res.status(404).json(createErrorResponse(404, 'User not found or account deleted'));
      }
      logInfo('Dark mode updated successfully:', { userId, mode, darkModeValue });

      // Return only success and mode info
      // TODO: Convert createSuccessResponse('Dark mode updated successfully', {...}) to res.status(200).json(createSuccessResponse('Dark mode updated successfully', {...}))
      return res.status(200).json(createSuccessResponse('Dark mode updated successfully', {
        success: true,
        mode,
        dark_mode: darkModeNumeric
      }));
    } catch (dbError) {
      logInfo('Database error while updating dark mode:', dbError);
      // TODO: Convert createErrorResponse(500, 'Failed to update dark mode setting') to res.status(500).json({ error: 'Failed to update dark mode setting' })
      return res.status(500).json(createErrorResponse(500, 'Failed to update dark mode setting'));
    }
  } catch (error) {
    logInfo('Dark mode error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to generate pre-signed S3 URLs for uploading user cover image files.
 * Delegates to the shared profile image upload handler for consistent processing.
 * Exact implementation matching Lambda getUserCoverUploadUrlHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response with pre-signed URLs or error
 */
export const getUserCoverUploadUrl = async (req, res) => {
  // Delegate to shared profile image upload handler with 'cover' type
  // TODO: Convert getUserProfileImageUploadUrlHandler(event, 'cover') to getUserProfileImageUploadUrlHandler(req, 'cover')
  const result = await getUserProfileImageUploadUrlHandler(req, 'cover');
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode) {
    return res.status(result.statusCode).json(JSON.parse(result.body));
  }
  
  return res.json(result);
};

/**
 * Handler to create/update user cover image from uploaded files.
 * Delegates to the shared profile image handler for consistent processing.
 * Exact implementation matching Lambda createUserCoverHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response with success status or error
 */
export const createUserCover = async (req, res) => {
  // Delegate to shared profile image handler with 'cover' type
  // TODO: Convert createUserProfileImageHandler(event, 'cover') to createUserProfileImageHandler(req, 'cover')
  const result = await createUserProfileImageHandler(req, 'cover');
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode) {
    return res.status(result.statusCode).json(JSON.parse(result.body));
  }
  
  return res.json(result);
};

/**
 * Handler to generate pre-signed S3 URLs for uploading user avatar image files.
 * Delegates to the shared profile image upload handler for consistent processing.
 * Exact implementation matching Lambda getUserAvatarUploadUrlHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response with pre-signed URLs or error
 */
export const getUserAvatarUploadUrl = async (req, res) => {
  // Delegate to shared profile image upload handler with 'avatar' type
  // TODO: Convert getUserProfileImageUploadUrlHandler(event, 'avatar') to getUserProfileImageUploadUrlHandler(req, 'avatar')
  const result = await getUserProfileImageUploadUrlHandler(req, 'avatar');
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode) {
    return res.status(result.statusCode).json(JSON.parse(result.body));
  }
  
  return res.json(result);
};

/**
 * Handler to create/update user avatar image from uploaded files.
 * Delegates to the shared profile image handler for consistent processing.
 * Exact implementation matching Lambda createUserAvatarHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response with success status or error
 */
export const createUserAvatar = async (req, res) => {
  // Delegate to shared profile image handler with 'avatar' type
  // TODO: Convert createUserProfileImageHandler(event, 'avatar') to createUserProfileImageHandler(req, 'avatar')
  const result = await createUserProfileImageHandler(req, 'avatar');
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode) {
    return res.status(result.statusCode).json(JSON.parse(result.body));
  }
  
  return res.json(result);
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
      return res.status(400).json(createErrorResponse(400, 'User ID is required'));
    }

    // Decrypt the encrypted user ID using safeDecryptId
    let userToRestrictId;
    try {
      userToRestrictId = safeDecryptId(encryptedUserToRestrictId);
      logInfo('Decoded user ID:', { originalId: encryptedUserToRestrictId, decodedId: userToRestrictId });
    } catch (error) {
      logError('Error decrypting user ID:', { encryptedUserToRestrictId, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid user ID format') to res.status(400).json({ error: 'Invalid user ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
    }

    logInfo('Restrict user request:', { userId, userToRestrictId });

    // Fetch the user to restrict
    const targetUser = await getUserById(userToRestrictId);
    if (!targetUser) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Prevent users from restricting themselves
    if (targetUser.id == userId) {
      // TODO: Convert createErrorResponse(400, 'Cannot restrict yourself') to res.status(400).json({ error: 'Cannot restrict yourself' })
      return res.status(400).json(createErrorResponse(400, 'Cannot restrict yourself'));
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
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
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
      return res.status(400).json(createErrorResponse(400, 'Invalid pagination parameters. Skip must be >= 0, limit must be between 1-100.'));
    }
    logInfo('Get restrictions request:', { userId, skip, limit });

    // Get total count for pagination
    const totalRestrictions = await dbGetRestrictedUsersCount(userId);
    if (totalRestrictions === null) {
      // TODO: Convert createErrorResponse(500, 'Failed to fetch restrictions count') to res.status(500).json({ error: 'Failed to fetch restrictions count' })
      return res.status(500).json(createErrorResponse(500, 'Failed to fetch restrictions count'));
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
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Creator Subscribers Route
// =========================

export const getCreatorSubscribers = async (req, res) => {
  try {
    logInfo('Creator subscribers request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'get creator subscribers' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { page = 1, limit = 10, sort = 'newest' } = req.query || {};
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json(createErrorResponse(400, 'Invalid page parameter'));
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json(createErrorResponse(400, 'Invalid limit parameter. Must be between 1 and 100'));
    }
    const validSortOptions = ['newest', 'oldest', 'name_asc', 'name_desc'];
    if (!validSortOptions.includes(sort)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid sort parameter. Must be one of: newest, oldest, name_asc, name_desc'));
    }
    const offset = (pageNum - 1) * limitNum;
    let orderBy = 's.created_at DESC';
    if (sort === 'oldest') {
      orderBy = 's.created_at ASC';
    } else if (sort === 'name_asc') {
      orderBy = 'u.name ASC';
    } else if (sort === 'name_desc') {
      orderBy = 'u.name DESC';
    }
    const query = `
      SELECT 
        s.id as subscription_id,
        s.created_at as subscribed_at,
        s.status as subscription_status,
        u.id,
        u.name,
        u.username,
        u.avatar,
        u.verified_id,
        u.role
      FROM subscriptions s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.creator_id = ? AND s.status = 'active'
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    const [subscribers] = await getDB().query(query, [userId, limitNum, offset]);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM subscriptions s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.creator_id = ? AND s.status = 'active'
    `;
    const [countResult] = await getDB().query(countQuery, [userId]);
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);
    const formattedSubscribers = subscribers.map(subscriber => ({
      id: subscriber.id,
      name: subscriber.name,
      username: subscriber.username,
      avatar: subscriber.avatar ? getFile(`avatar/${subscriber.avatar}`) : null,
      verified_id: subscriber.verified_id,
      role: subscriber.role,
      subscription_id: subscriber.subscription_id,
      subscribed_at: subscriber.subscribed_at,
      subscription_status: subscriber.subscription_status
    }));
    logInfo('Creator subscribers retrieved successfully', { 
      userId, 
      total, 
      page: pageNum, 
      limit: limitNum, 
      subscribersCount: formattedSubscribers.length 
    });
    return res.status(200).json(createSuccessResponse('Creator subscribers retrieved successfully', {
      subscribers: formattedSubscribers,
      pagination: {
        current_page: pageNum,
        total_pages: totalPages,
        total_items: total,
        items_per_page: limitNum,
        has_next_page: pageNum < totalPages,
        has_previous_page: pageNum > 1
      }
    }));
  } catch (error) {
    logError('Creator subscribers error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Posts Route
// =========================

export const getPosts = async (req, res) => {
  try {
    logInfo('Posts request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'get posts' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { page = 1, limit = 10, type = 'all' } = req.query || {};
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json(createErrorResponse(400, 'Invalid page parameter'));
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json(createErrorResponse(400, 'Invalid limit parameter. Must be between 1 and 100'));
    }
    const validTypes = ['all', 'free', 'paid'];
    if (!validTypes.includes(type)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid type parameter. Must be one of: all, free, paid'));
    }
    const offset = (pageNum - 1) * limitNum;
    let whereClause = 'WHERE p.user_id = ?';
    if (type === 'free') {
      whereClause += ' AND p.price = 0';
    } else if (type === 'paid') {
      whereClause += ' AND p.price > 0';
    }
    const query = `
      SELECT 
        p.id,
        p.title,
        p.description,
        p.price,
        p.created_at,
        p.updated_at,
        p.status,
        p.media_type,
        p.media_url,
        p.thumbnail_url,
        p.is_pinned,
        COUNT(l.id) as likes_count,
        COUNT(c.id) as comments_count
      FROM posts p
      LEFT JOIN post_likes l ON p.id = l.post_id
      LEFT JOIN post_comments c ON p.id = c.post_id
      ${whereClause}
      GROUP BY p.id
      ORDER BY p.is_pinned DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [posts] = await getDB().query(query, [userId, limitNum, offset]);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM posts p
      ${whereClause}
    `;
    const [countResult] = await getDB().query(countQuery, [userId]);
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);
    const formattedPosts = posts.map(post => ({
      id: post.id,
      title: post.title,
      description: post.description,
      price: parseFloat(post.price),
      created_at: post.created_at,
      updated_at: post.updated_at,
      status: post.status,
      media_type: post.media_type,
      media_url: post.media_url ? getFile(`posts/${post.media_url}`) : null,
      thumbnail_url: post.thumbnail_url ? getFile(`posts/thumbnails/${post.thumbnail_url}`) : null,
      is_pinned: post.is_pinned === 1,
      likes_count: parseInt(post.likes_count),
      comments_count: parseInt(post.comments_count)
    }));
    logInfo('Posts retrieved successfully', { 
      userId, 
      total, 
      page: pageNum, 
      limit: limitNum, 
      type,
      postsCount: formattedPosts.length 
    });
    return res.status(200).json(createSuccessResponse('Posts retrieved successfully', {
      posts: formattedPosts,
      pagination: {
        current_page: pageNum,
        total_pages: totalPages,
        total_items: total,
        items_per_page: limitNum,
        has_next_page: pageNum < totalPages,
        has_previous_page: pageNum > 1
      }
    }));
  } catch (error) {
    logError('Posts error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Updates Route (GET /updates)
// =========================

export const getUpdates = async (req, res) => {
  try {
    logInfo('Updates request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'get updates' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { page = 1, limit = 10, type = 'all', media_type = 'all' } = req.query || {};
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json(createErrorResponse(400, 'Invalid page parameter'));
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json(createErrorResponse(400, 'Invalid limit parameter. Must be between 1 and 100'));
    }
    const validTypes = ['all', 'free', 'paid'];
    if (!validTypes.includes(type)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid type parameter. Must be one of: all, free, paid'));
    }
    const validMediaTypes = ['all', 'image', 'video'];
    if (!validMediaTypes.includes(media_type)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid media_type parameter. Must be one of: all, image, video'));
    }
    const offset = (pageNum - 1) * limitNum;
    let whereClause = 'WHERE p.user_id = ?';
    if (type === 'free') {
      whereClause += ' AND p.price = 0';
    } else if (type === 'paid') {
      whereClause += ' AND p.price > 0';
    }
    if (media_type === 'image') {
      whereClause += ' AND p.media_type = "image"';
    } else if (media_type === 'video') {
      whereClause += ' AND p.media_type = "video"';
    }
    const query = `
      SELECT 
        p.id,
        p.title,
        p.description,
        p.price,
        p.created_at,
        p.updated_at,
        p.status,
        p.media_type,
        p.media_url,
        p.thumbnail_url,
        p.is_pinned,
        COUNT(l.id) as likes_count,
        COUNT(c.id) as comments_count
      FROM posts p
      LEFT JOIN post_likes l ON p.id = l.post_id
      LEFT JOIN post_comments c ON p.id = c.post_id
      ${whereClause}
      GROUP BY p.id
      ORDER BY p.is_pinned DESC, p.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [posts] = await getDB().query(query, [userId, limitNum, offset]);
    const countQuery = `
      SELECT COUNT(*) as total
      FROM posts p
      ${whereClause}
    `;
    const [countResult] = await getDB().query(countQuery, [userId]);
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);
    const formattedPosts = posts.map(post => ({
      id: post.id,
      title: post.title,
      description: post.description,
      price: parseFloat(post.price),
      created_at: post.created_at,
      updated_at: post.updated_at,
      status: post.status,
      media_type: post.media_type,
      media_url: post.media_url ? getFile(`posts/${post.media_url}`) : null,
      thumbnail_url: post.thumbnail_url ? getFile(`posts/thumbnails/${post.thumbnail_url}`) : null,
      is_pinned: post.is_pinned === 1,
      likes_count: parseInt(post.likes_count),
      comments_count: parseInt(post.comments_count)
    }));
    logInfo('Updates retrieved successfully', { 
      userId, 
      total, 
      page: pageNum, 
      limit: limitNum, 
      type,
      media_type,
      postsCount: formattedPosts.length 
    });
    return res.status(200).json(createSuccessResponse('Updates retrieved successfully', {
      posts: formattedPosts,
      pagination: {
        current_page: pageNum,
        total_pages: totalPages,
        total_items: total,
        items_per_page: limitNum,
        has_next_page: pageNum < totalPages,
        has_previous_page: pageNum > 1
      }
    }));
  } catch (error) {
    logError('Updates error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Edit Post Route (PUT /posts/edit)
// =========================

export const editPost = async (req, res) => {
  try {
    logInfo('Edit post request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'edit post' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { post_id, title, description, price, tags } = req.body || {};
    if (!post_id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }
    if (!title || !description) {
      return res.status(400).json(createErrorResponse(400, 'Title and description are required'));
    }
    if (price !== undefined && (isNaN(price) || price < 0)) {
      return res.status(400).json(createErrorResponse(400, 'Price must be a non-negative number'));
    }
    const postId = parseInt(post_id, 10);
    if (isNaN(postId)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid post ID'));
    }
    const query = `
      UPDATE posts 
      SET title = ?, description = ?, price = ?, updated_at = NOW()
      WHERE id = ? AND user_id = ?
    `;
    const [result] = await getDB().query(query, [title, description, price || 0, postId, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json(createErrorResponse(404, 'Post not found or you do not have permission to edit it'));
    }
    if (tags && Array.isArray(tags)) {
      await getDB().query('DELETE FROM post_tags WHERE post_id = ?', [postId]);
      if (tags.length > 0) {
        const tagValues = tags.map(tag => [postId, tag.trim()]);
        await getDB().query('INSERT INTO post_tags (post_id, tag) VALUES ?', [tagValues]);
      }
    }
    logInfo('Post updated successfully', { userId, postId });
    return res.status(200).json(createSuccessResponse('Post updated successfully', {
      post_id: postId,
      title,
      description,
      price: price || 0,
      tags: tags || []
    }));
  } catch (error) {
    logError('Edit post error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Delete Post Route (DELETE /posts/delete/{id})
// =========================

export const deletePost = async (req, res) => {
  try {
    logInfo('Delete post request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'delete post' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { id } = req.params || {};
    if (!id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }
    const postId = parseInt(id, 10);
    if (isNaN(postId)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid post ID'));
    }
    const query = 'DELETE FROM posts WHERE id = ? AND user_id = ?';
    const [result] = await getDB().query(query, [postId, userId]);
    if (result.affectedRows === 0) {
      return res.status(404).json(createErrorResponse(404, 'Post not found or you do not have permission to delete it'));
    }
    await getDB().query('DELETE FROM post_tags WHERE post_id = ?', [postId]);
    await getDB().query('DELETE FROM post_likes WHERE post_id = ?', [postId]);
    await getDB().query('DELETE FROM post_comments WHERE post_id = ?', [postId]);
    logInfo('Post deleted successfully', { userId, postId });
    return res.status(200).json(createSuccessResponse('Post deleted successfully', {
      post_id: postId
    }));
  } catch (error) {
    logError('Delete post error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Comments Route (GET /comments/{id})
// =========================

export const getComments = async (req, res) => {
  try {
    logInfo('Get comments request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'get comments' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { id } = req.params || {};
    if (!id) {
      return res.status(400).json(createErrorResponse(400, 'Post ID is required'));
    }
    const postId = parseInt(id, 10);
    if (isNaN(postId)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid post ID'));
    }
    const { page = 1, limit = 20 } = req.query || {};
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json(createErrorResponse(400, 'Invalid page parameter'));
    }
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json(createErrorResponse(400, 'Invalid limit parameter. Must be between 1 and 100'));
    }
    const offset = (pageNum - 1) * limitNum;
    const query = `
      SELECT 
        c.id,
        c.comment,
        c.created_at,
        c.updated_at,
        u.id as user_id,
        u.name,
        u.username,
        u.avatar,
        u.verified_id,
        u.role,
        COUNT(cl.id) as likes_count
      FROM post_comments c
      INNER JOIN users u ON c.user_id = u.id
      LEFT JOIN comment_likes cl ON c.id = cl.comment_id
      WHERE c.post_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [comments] = await getDB().query(query, [postId, limitNum, offset]);
    const countQuery = 'SELECT COUNT(*) as total FROM post_comments WHERE post_id = ?';
    const [countResult] = await getDB().query(countQuery, [postId]);
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limitNum);
    const formattedComments = comments.map(comment => ({
      id: comment.id,
      comment: comment.comment,
      created_at: comment.created_at,
      updated_at: comment.updated_at,
      user: {
        id: comment.user_id,
        name: comment.name,
        username: comment.username,
        avatar: comment.avatar ? getFile(`avatar/${comment.avatar}`) : null,
        verified_id: comment.verified_id,
        role: comment.role
      },
      likes_count: parseInt(comment.likes_count)
    }));
    logInfo('Comments retrieved successfully', { 
      userId, 
      postId,
      total, 
      page: pageNum, 
      limit: limitNum, 
      commentsCount: formattedComments.length 
    });
    return res.status(200).json(createSuccessResponse('Comments retrieved successfully', {
      comments: formattedComments,
      pagination: {
        current_page: pageNum,
        total_pages: totalPages,
        total_items: total,
        items_per_page: limitNum,
        has_next_page: pageNum < totalPages,
        has_previous_page: pageNum > 1
      }
    }));
  } catch (error) {
    logError('Get comments error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Send OTP Route (POST /user/send-otp)
// =========================

export const sendOtp = async (req, res) => {
  try {
    logInfo('Send OTP request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'send OTP' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    if (!userId) {
      return res.status(401).json(createErrorResponse(401, 'Access token required or invalid'));
    }
    const { email, country_code, mobile } = req.body || {};
    if (!email && !mobile) {
      return res.status(400).json(createErrorResponse(400, 'At least one of email or mobile must be provided'));
    }
    if (mobile && !country_code) {
      return res.status(400).json(createErrorResponse(400, 'Country code is required when mobile is provided'));
    }
    if (email) {
      const emailTaken = await checkUserFieldExists(userId, 'email', email);
      if (emailTaken) {
        return res.status(409).json(createErrorResponse(409, 'Email already taken'));
      }
    }
    if (mobile) {
      const mobileTaken = await checkMobileExists(userId, mobile, country_code);
      if (mobileTaken) {
        return res.status(409).json(createErrorResponse(409, 'Mobile number already taken'));
      }
    }
    const comparison = await compareUserFields(userId, email, mobile, country_code);
    const emailSendOtp = email && !comparison.emailMatches;
    const mobileSendOtp = mobile && !comparison.mobileMatches;
    if (emailSendOtp) {
      try {
        const emailOtp = await generateOTP(email);
        await sendEmailOTP(email, emailOtp, 'settings_update');
      } catch (error) {
        return res.status(500).json(createErrorResponse(500, 'Failed to send email OTP'));
      }
    }
    if (mobileSendOtp) {
      try {
        const mobileIdentifier = country_code + mobile;
        const mobileOtp = await generateOTP(mobileIdentifier);
        await sendWhatsAppOTP(mobile, country_code, mobileOtp);
      } catch (error) {
        return res.status(500).json(createErrorResponse(500, 'Failed to send mobile OTP'));
      }
    }
    logInfo('OTP sent successfully', { userId, emailSendOtp, mobileSendOtp });
    return res.status(200).json(createSuccessResponse('OTP verification completed', {
      user_id: userId,
      email_send_otp: emailSendOtp,
      mobile_send_otp: mobileSendOtp
    }));
  } catch (error) {
    logError('Send OTP error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Verify OTP Route (POST /user/profile/verify-otp)
// =========================

export const verifyOtp = async (req, res) => {
  try {
    logInfo('Verify OTP request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verify OTP' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    if (!userId) {
      return res.status(401).json(createErrorResponse(401, 'Access token required or invalid'));
    }
    const { email, emailOtp, mobile, mobileOtp, country_code, email_otp, mobile_otp } = req.body || {};
    if (!email_otp && !mobile_otp) {
      return res.status(400).json({ error: 'At least one of email_otp or mobile_otp must be true' });
    }
    let emailValid = true, mobileValid = true, updateSuccess = true;
    let updateFields = {};
    if (email_otp) {
      if (!email || !emailOtp) {
        return res.status(400).json({ error: 'Email and OTP are required when email_otp is true' });
      }
      emailValid = await verifyEmailOTP(email, emailOtp);
      if (emailValid) updateFields.email = email;
    }
    if (mobile_otp) {
      if (!mobile || !mobileOtp) {
        return res.status(400).json({ error: 'Mobile and OTP are required when mobile_otp is true' });
      }
      if (!country_code) {
        return res.status(400).json({ error: 'Country code is required when verifying mobile OTP' });
      }
      const mobileIdentifier = country_code + mobile;
      mobileValid = await verifyEmailOTP(mobileIdentifier, mobileOtp);
      if (mobileValid) {
        updateFields.mobile = country_code + mobile;
      }
    }
    if ((email_otp && !emailValid) || (mobile_otp && !mobileValid)) {
      let errorMsg = [];
      if (email_otp && !emailValid) errorMsg.push('Invalid or expired email OTP');
      if (mobile_otp && !mobileValid) errorMsg.push('Invalid or expired mobile OTP');
      return res.status(400).json({ error: errorMsg.join(' and ') });
    }
    if (Object.keys(updateFields).length > 0) {
      updateSuccess = await updateUserAfterOTP(userId, updateFields);
    }
    if (updateSuccess) {
      let updatedFields = Object.keys(updateFields).join(' and ');
      logInfo('OTP verified and profile updated successfully', { userId, updatedFields });
      return res.status(200).json(createSuccessResponse(`${updatedFields.charAt(0).toUpperCase() + updatedFields.slice(1)} updated successfully`));
    } else {
      return res.status(500).json({ error: 'Failed to update user details' });
    }
  } catch (error) {
    logError('Verify OTP error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// User Profile Routes
// =========================

export const getUserProfile = async (req, res) => {
  try {
    logInfo('Get user profile request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'get user profile' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    if (!userId) {
      return res.status(401).json(createErrorResponse(401, 'Access token required or invalid'));
    }
    const userSettings = await getUserSettings(userId);
    if (!userSettings) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    const [languagesForUser, statesForUser, userCountry] = await Promise.all([
      getAllLanguages(),
      getStates(),
      getUserCountryById(userSettings.countries_id)
    ]);
    const userLanguage = userSettings.language ? languagesForUser.find(lang => lang.abbreviation === userSettings.language) || null : null;
    const userState = userSettings.state_id ? statesForUser.find(state => state.id === userSettings.state_id) || null : null;
    const rawMobile = (userSettings.mobile || '').toString().replace(/\s+/g, '');
    let mobile_code = '';
    let mobile_number = '';
    if (/^\+\d+/.test(rawMobile)) {
      const knownDialCodes = [
        '+998','+997','+996','+995','+994','+993','+992','+991','+979','+977','+976','+975','+974','+973','+972','+971','+970','+968','+967','+966','+965','+964','+963','+962','+961','+960','+959','+958','+957','+956','+955','+954','+953','+952','+951',
        '+886','+880','+878','+874','+873','+872','+871','+870','+865','+856','+855','+853','+852','+850',
        '+692','+691','+690','+689','+688','+687','+686','+685','+683','+682','+681','+680','+679','+678','+677','+676','+675','+674','+673','+672','+671','+670',
        '+599','+598','+597','+596','+595','+594','+593','+592','+591','+590','+509','+508','+507','+506','+505','+504','+503','+502','+501','+500',
        '+423','+421','+420','+389','+387','+386','+385','+383','+382','+381','+380','+378','+377','+376','+375','+374','+373','+372','+371','+370','+359','+358','+357','+356','+355','+354','+353','+352','+351','+350',
        '+299','+298','+297','+296','+295','+294','+293','+292','+291','+290',
        '+269','+268','+267','+266','+265','+264','+263','+262','+261','+260','+259','+258','+257','+256','+255','+254','+253','+252','+251','+250','+249','+248','+246','+245','+244','+243','+242','+241','+240','+239','+238','+237','+236','+235','+234','+233','+232','+231','+230','+229','+228','+227','+226','+225','+224','+223','+222','+221','+220',
        '+218','+216','+213','+212','+211','+210',
        '+98','+97','+96','+95','+94','+93','+92','+91','+90','+86','+84','+83','+82','+81','+66','+65','+64','+63','+62','+61','+60','+58','+57','+56','+55','+54','+53','+52','+51','+49','+48','+47','+46','+45','+44','+43','+41','+40','+39','+36','+34','+33','+32','+31','+30','+27','+20','+7','+1'
      ];
      const found = knownDialCodes.find(code => rawMobile.startsWith(code));
      if (found) {
        mobile_code = found;
        mobile_number = rawMobile.slice(found.length);
      } else {
        mobile_number = rawMobile.slice(1);
      }
    } else {
      mobile_number = rawMobile;
    }
    const processedUserSettings = {
      ...userSettings,
      avatar: userSettings.avatar ? getFile(`avatar/${userSettings.avatar}`) : userSettings.avatar,
      cover: userSettings.cover ? getFile(`cover/${userSettings.cover}`) : userSettings.cover,
      language: (userLanguage && userLanguage.name) ? userLanguage.name : (userSettings.language || ''),
      gender: typeof userSettings.gender === 'string' && userSettings.gender
        ? userSettings.gender.charAt(0).toUpperCase() + userSettings.gender.slice(1).toLowerCase()
        : userSettings.gender,
      mobile_code,
      mobile_number,
      selected_language: userLanguage?.name || "",
      selected_state: userState || "",
      selected_country: userCountry || ""
    };
    logInfo('User profile retrieved successfully', { userId });
    return res.status(200).json(createSuccessResponse('User settings retrieved successfully', { 
      user: processedUserSettings,
    }));
  } catch (error) {
    logError('Get user profile error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

export const updateUserProfile = async (req, res) => {
  try {
    logInfo('Update user profile request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'update user profile' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    if (!userId) {
      return res.status(401).json(createErrorResponse(401, 'Access token required or invalid'));
    }
    const validation = validateUserSettings(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }
    if (req.body.username && await checkUserFieldExists(userId, 'username', req.body.username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    if (req.body.email && await checkUserFieldExists(userId, 'email', req.body.email)) {
      return res.status(409).json({ error: 'Email already taken' });
    }
    if (req.body.mobile && await checkMobileExists(userId, req.body.mobile, req.body.country_code)) {
      return res.status(409).json({ error: 'Mobile number already taken' });
    }
    const comparison = await compareUserFields(userId, req.body.email, req.body.mobile, req.body.country_code);
    const emailMatches = comparison.emailMatches;
    const mobileMatches = comparison.mobileMatches;
    const { email_otp, mobile_otp } = req.body;
    if (emailMatches && mobileMatches) {
      const updateFields = { ...req.body };
      delete updateFields.email_otp;
      delete updateFields.mobile_otp;
      if (req.body.mobile && req.body.country_code) {
        updateFields.mobile = req.body.country_code + req.body.mobile;
      }
      const updateSuccess = await updateUserSettings(userId, updateFields);
      if (!updateSuccess) {
        return res.status(500).json({ error: 'Failed to update user settings' });
      }
      return res.status(200).json(createSuccessResponse('Profile updated successfully'));
    }
    if (emailMatches && !mobileMatches) {
      if (!mobile_otp) {
        return res.status(400).json({ error: 'Mobile OTP is required for mobile number change' });
      }
      const mobileIdentifier = req.body.country_code + req.body.mobile;
      const mobileValid = await verifyEmailOTP(mobileIdentifier, mobile_otp);
      if (!mobileValid) {
        return res.status(400).json({ error: 'Invalid or expired mobile OTP' });
      }
      const updateFields = { ...req.body };
      delete updateFields.email_otp;
      delete updateFields.mobile_otp;
      updateFields.mobile = req.body.country_code + req.body.mobile;
      const updateSuccess = await updateUserSettings(userId, updateFields);
      if (!updateSuccess) {
        return res.status(500).json({ error: 'Failed to update user settings' });
      }
      return res.status(200).json(createSuccessResponse('Profile updated successfully'));
    }
    if (!emailMatches && mobileMatches) {
      if (!email_otp) {
        return res.status(400).json({ error: 'Email OTP is required for email change' });
      }
      const emailValid = await verifyEmailOTP(req.body.email, email_otp);
      if (!emailValid) {
        return res.status(400).json({ error: 'Invalid or expired email OTP' });
      }
      const updateFields = { ...req.body };
      delete updateFields.email_otp;
      delete updateFields.mobile_otp;
      if (req.body.mobile && req.body.country_code) {
        updateFields.mobile = req.body.country_code + req.body.mobile;
      }
      const updateSuccess = await updateUserSettings(userId, updateFields);
      if (!updateSuccess) {
        return res.status(500).json({ error: 'Failed to update user settings' });
      }
      return res.status(200).json(createSuccessResponse('Profile updated successfully'));
    }
    if (!emailMatches && !mobileMatches) {
      if (!email_otp || !mobile_otp) {
        return res.status(400).json({ error: 'Both email and mobile OTPs are required for changes' });
      }
      const emailValid = await verifyEmailOTP(req.body.email, email_otp);
      const mobileIdentifier = req.body.country_code + req.body.mobile;
      const mobileValid = await verifyEmailOTP(mobileIdentifier, mobile_otp);
      if (!emailValid || !mobileValid) {
        let errorMsg = [];
        if (!emailValid) errorMsg.push('Invalid or expired email OTP');
        if (!mobileValid) errorMsg.push('Invalid or expired mobile OTP');
        return res.status(400).json({ error: errorMsg.join(' and ') });
      }
      const updateFields = { ...req.body };
      delete updateFields.email_otp;
      delete updateFields.mobile_otp;
      updateFields.mobile = req.body.country_code + req.body.mobile;
      const updateSuccess = await updateUserSettings(userId, updateFields);
      if (!updateSuccess) {
        return res.status(500).json({ error: 'Failed to update user settings' });
      }
      return res.status(200).json(createSuccessResponse('Profile updated successfully'));
    }
  } catch (error) {
    logError('Update user profile error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// =========================
// Search Users Route (GET /user/search)
// =========================

export const searchUsers = async (req, res) => {
  try {
    logInfo('Search users request received');
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'search users' });
    if (errorResponse) {
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }
    const { search = '', q = '', type = '' } = req.query || {};
    const searchTerm = (search || q).trim();
    const searchType = type.trim();
    if (q && !search) {
      logInfo('DEPRECATED: Parameter "q" is deprecated and will be removed in future versions. Please use "search" instead.');
    }
    if (searchType && !['user', 'creator'].includes(searchType)) {
      logInfo('Invalid type parameter', { type: searchType });
      return res.status(400).json({ error: 'Invalid type parameter. Must be "user" or "creator"', users: [] });
    }
    logInfo('Search parameters', { search, q, searchTerm, searchLength: searchTerm.length, type: searchType });
    if (searchTerm.length < 2) {
      logInfo('Search term too short, returning empty results');
      return res.status(200).json(createSuccessResponse('Search completed', { users: [] }));
    }
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { verified_id } = user;
    logInfo('User info retrieved', { userId, verified_id });
    const isSupportSearchRequest = searchTerm.toLowerCase().includes('sup');
    let supportIds = [];
    if (isSupportSearchRequest) {
      if (verified_id === 'yes') {
        supportIds = await getSupportCreatorIds();
      } else {
        supportIds = await getSupportUserIds();
      }
      logInfo('Support search detected', { isSupportSearchRequest, supportIds });
    }
    const restrictedUserIds = await getRestrictedUserIds(userId);
    const excludedUserIds = [...restrictedUserIds, userId, ...supportIds];
    logInfo('Exclusion list built', { excludedUserIds });
    let users = [];
    if (isSupportSearchRequest && supportIds.length > 0) {
      logInfo('Executing support search');
      const supportRows = await getSupportUsersByIds(supportIds);
      const otherRows = await getUsersBySearch({ 
        excludedUserIds, 
        searchTerm, 
        supportIds,
        type: searchType
      });
      users = [...supportRows, ...otherRows];
    } else {
      logInfo('Executing regular search', { searchTerm, excludedUserIds });
      try {
        const [allUsers] = await getDB().query('SELECT id, name, username FROM users WHERE status = "active" AND role = "normal" LIMIT 10');
        logInfo('Sample users in database', { allUsers });
      } catch (debugError) {
        logError('Debug query error', debugError);
      }
      users = await getUsersBySearch({ excludedUserIds, searchTerm, type: searchType });
    }
    const formattedUsers = users.map(user => {
      const { hide_name, ...userData } = user;
      if (userData.avatar) {
        userData.avatar = getFile(`avatar/${userData.avatar}`);
      }
      if (hide_name === 'yes') {
        userData.name = userData.username;
      }
      userData.id = encryptId(userData.id);
      return userData;
    });
    logInfo('Search results', { usersCount: formattedUsers.length, users: formattedUsers });
    return res.status(200).json(createSuccessResponse('Search completed', { users: formattedUsers }));
  } catch (error) {
    logError('Search users error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
