import { createSuccessResponse, createErrorResponse, logInfo, logError, getGenderOptions, getFile, getUserById, getVerificationRequestInfo, getVerificationConversationsList, storeVerificationConversationData, getAuthenticatedUserId } from '../utils/common.js';
import { processUploadRequest } from '../utils/uploadUtils.js';
import { processMediaFiles, cleanupS3Files } from '../utils/mediaProcessing.js';
import { validateVerificationRequest, validateVerificationFiles } from '../validate/verification.js';
import { checkExistingVerificationRequest, updateUserProfileData, saveVerificationDocuments } from '../utils/verification.js';
import { pool } from '../config/database.js';
import crypto from 'crypto';

// =========================
// Verification-Specific Functions
// =========================

/**
 * Fetches user's verification request status and history
 * @param {number} userId - Authenticated user ID
 * @returns {Promise<object>} Verification request information
 */
const getVerificationRequestInfoHelper = async (userId) => {
  try {
    // First check if verification_requests table exists
    const [tableCheck] = await pool.query(`
      SELECT COUNT(*) as table_exists 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'verification_requests'
    `);
    
    if (tableCheck[0]?.table_exists === 0) {
      logInfo('verification_requests table does not exist, returning default values');
      return {
        hasRequest: false,
        latestRequest: null,
        totalRequests: 0,
        canSubmitNew: true
      };
    }
    
    // Check for existing verification requests
    const [requestRows] = await pool.query(`
      SELECT id, status
      FROM verification_requests 
      WHERE user_id = ? 
      ORDER BY id DESC 
      LIMIT 1
    `, [userId]);
    
    const latestRequest = requestRows.length > 0 ? requestRows[0] : null;
    
    // Get verification request count
    const [countRows] = await pool.query(`
      SELECT COUNT(*) as total_requests
      FROM verification_requests 
      WHERE user_id = ?
    `, [userId]);
    
    const totalRequests = countRows[0]?.total_requests || 0;
    
    return {
      hasRequest: !!latestRequest,
      latestRequest: latestRequest ? {
        id: latestRequest.id,
        status: latestRequest.status
      } : null,
      totalRequests,
      canSubmitNew: !latestRequest || latestRequest.status === 'rejected'
    };
  } catch (error) {
    logError('getVerificationRequestInfo error:', error);
    // Return default values if verification_requests table doesn't exist or query fails
    return {
      hasRequest: false,
      latestRequest: null,
      totalRequests: 0,
      canSubmitNew: true
    };
  }
};

/**
 * Fetches user's categories for verification
 * @param {string} categoriesId - Comma-separated category IDs
 * @returns {Promise<Array>} Array of category objects
 */
const getUserCategories = async (categoriesId) => {
  if (!categoriesId) return [];
  
  try {
    // First check if categories table exists
    const [tableCheck] = await pool.query(`
      SELECT COUNT(*) as table_exists 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'categories'
    `);
    
    if (tableCheck[0]?.table_exists === 0) {
      logInfo('categories table does not exist, returning empty array');
      return [];
    }
    
    const categoryIds = categoriesId.split(',').map(id => id.trim()).filter(id => id);
    if (categoryIds.length === 0) return [];
    
    const [rows] = await pool.query(`
      SELECT id, name, description
      FROM categories 
      WHERE id IN (?) AND status = 'active'
      ORDER BY name ASC
    `, [categoryIds]);
    
    return rows;
  } catch (error) {
    logError('getUserCategories error:', error);
    // Return empty array if categories table doesn't exist or query fails
    return [];
  }
};

/**
 * Fetches all available categories for verification forms
 * @returns {Promise<Array>} Array of all active categories
 */
const getAllCategories = async () => {
  try {
    // First check if categories table exists
    const [tableCheck] = await pool.query(`
      SELECT COUNT(*) as table_exists 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'categories'
    `);
    
    if (tableCheck[0]?.table_exists === 0) {
      logInfo('categories table does not exist, returning empty array');
      return [];
    }
    
    const [rows] = await pool.query(`
      SELECT id, name, description
      FROM categories 
      WHERE status = 'active'
      ORDER BY name ASC
    `);
    
    return rows;
  } catch (error) {
    logError('getAllCategories error:', error);
    // Return empty array if categories table doesn't exist or query fails
    return [];
  }
};

/**
 * Generates unique filename for verification files following Laravel's pattern
 * Laravel pattern: strtolower(auth()->id() . time() . Str::random(40) . '.' . extension)
 * 
 * @param {number} userId - User ID
 * @param {string} originalFilename - Original filename with extension
 * @returns {string} Generated unique filename
 */
const generateVerificationFilename = (userId, originalFilename) => {
  try {
    // Extract file extension
    const extension = originalFilename.split('.').pop().toLowerCase();
    
    // Generate random string (40 characters like Laravel's Str::random(40))
    const randomString = crypto.randomBytes(20).toString('hex'); // 40 hex characters
    
    // Create filename following Laravel pattern: userId + timestamp + random + extension
    const timestamp = Date.now();
    const filename = `${userId}${timestamp}${randomString}.${extension}`;
    
    return filename.toLowerCase();
  } catch (error) {
    logError('Error generating verification filename:', error);
    // Fallback to timestamp-based filename
    const extension = originalFilename.split('.').pop().toLowerCase();
    const timestamp = Date.now();
    return `verification_${timestamp}.${extension}`;
  }
};

/**
 * Returns the first file name in an array or an empty string
 * This mirrors the Laravel code which stores only one file name per field
 * 
 * @param {Array<string>} arr - Array of file names
 * @returns {string} First file name or empty string
 */
const getFirstFileNameOrEmpty = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr[0] : '');

/**
 * Normalizes and processes incoming file inputs for the given fields.
 * - Accepts either multipart-like objects ({ name, path }) or string keys
 * - Generates Laravel-style unique filenames for DB storage
 * - Collects original file paths/keys for S3 processing
 * 
 * @param {number} userId - Authenticated user ID
 * @param {Object} body - Request body potentially containing file fields
 * @param {Array<string>} fileFields - Fields to extract from body
 * @returns {{ files: Object, generatedFilenames: Object, allMediaKeys: Array<string> }}
 */
const processVerificationFiles = (userId, body, fileFields) => {
  const files = {};
  const generatedFilenames = {};
  const allMediaKeys = [];

  for (const field of fileFields) {
    const value = body[field];
    if (!value) continue;

    const fileArray = Array.isArray(value) ? value : [value];

    // Accept either objects with a name property (multipart) or string keys
    const validFiles = fileArray.filter((file) => (
      (file && typeof file === 'object' && file.name) || (typeof file === 'string' && file.trim().length > 0)
    ));

    if (validFiles.length === 0) continue;

    const processedFiles = validFiles.map((file) => {
      const isObjectFile = file && typeof file === 'object' && file.name;
      const originalFilename = isObjectFile ? file.name : (file.split('/').pop() || String(file));
      const filePath = isObjectFile ? (file.path || file.tempFilePath || null) : String(file);

      // Generate unique filename for DB storage
      const uniqueFilename = generateVerificationFilename(userId, originalFilename);

      // Store single filename per field (consistent with Laravel behavior)
      generatedFilenames[field] = uniqueFilename;
      files[field] = [uniqueFilename];

      if (filePath) allMediaKeys.push(filePath);

      return { originalFilename, uniqueFilename, filePath };
    });

    logInfo(`Processed ${field} files`, {
      field,
      count: processedFiles.length,
      filenames: processedFiles.map((f) => f.uniqueFilename)
    });
  }

  return { files, generatedFilenames, allMediaKeys };
};

/**
 * Handler to generate pre-signed S3 URLs for uploading verification files.
 * Uses the shared processUploadRequest utility with file type restrictions.
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Express response with pre-signed URLs or error
 */
const getVerificationUploadUrl = async (req, res) => {
  // Configuration options for verification upload processing with destructuring
    const uploadOptions = {
      action: 'getVerificationUploadUrl',
      basePath: 'uploads/verification',
    useFolderOrganization: false, // Verification uses flat structure without folder organization
    successMessage: 'Pre-signed verification upload URLs generated',
    getAuthenticatedUserId,
    // Add file type restrictions for verification uploads
    allowedFileTypes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heif', 'heic', 'pdf']
  };
  
  // Use shared upload processing utility and return result directly
  // TODO: Convert processUploadRequest(event, uploadOptions) to processUploadRequest(req, uploadOptions)
    const result = await processUploadRequest(req, uploadOptions);
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode === 200) {
    return res.status(200).json(JSON.parse(result.body));
  } else {
    return res.status(result.statusCode).json(JSON.parse(result.body));
  }
};

/**
 * Main verification account handler function
 * This is a thin wrapper that calls the existing getSettingsHandler logic
 * and adds verification-specific data on top of the user profile data
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with verification data or error
 */
const getVerificationAccount = async (req, res) => {
  try {
    logInfo('Verification account request received');
    
    // Step 1: Authenticate user using JWT from Authorization header
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'verification account access' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verification account access' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'verification account access' 
    });
    
    if (errorResponse) {
      logError('Verification account: Authentication failed', { errorResponse });
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }
    
    logInfo('Verification account: User authenticated successfully', { userId });
    
    // Step 2: Get user profile data using existing logic
    // We'll simulate what getSettingsHandler does but add verification data
    const { getUserSettings } = await import('../utils/settings_page.js');
    
    const userSettings = await getUserSettings(userId);
    if (!userSettings) {
      logError('Verification account: User not found', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Step 3: Get verification-specific data
    const [verificationInfo, userCategories, allCategories] = await Promise.all([
      getVerificationRequestInfoHelper(userId),
      getUserCategories(userSettings.categories_id),
      getAllCategories()
    ]);
    
    // Step 4: Get additional dropdown options needed for verification
    // Do not fetch full countries/states; only include genders here
    const genders = await getGenderOptions();
    
    // Step 5: Format response data
    const responseData = {
      user: {
        ...userSettings,
        // Process avatar and cover fields using getFile() function to generate full URLs
        avatar: userSettings.avatar ? getFile(`avatar/${userSettings.avatar}`) : userSettings.avatar,
        cover: userSettings.cover ? getFile(`cover/${userSettings.cover}`) : userSettings.cover,
        // Add verification-specific data
        verification: verificationInfo,
        categories: userCategories
      },
      dropdowns: {
        genders,
        categories: allCategories
      }
    };
    
    logInfo('Verification account: Data retrieved successfully', { 
      userId, 
      verifiedStatus: userSettings.verified_id,
      hasVerificationRequest: verificationInfo.hasRequest,
      categoriesCount: userCategories.length
    });
    
    // TODO: Convert createSuccessResponse('Verification account data retrieved successfully', responseData) to res.json(createSuccessResponse('Verification account data retrieved successfully', responseData))
    return res.json(createSuccessResponse('Verification account data retrieved successfully', responseData));
    
  } catch (error) {
    logError('Verification account handler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', { error: error.message || 'Unknown error occurred' }) to res.status(500).json({ error: 'Internal server error', details: { error: error.message || 'Unknown error occurred' } })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * POST /verification/account - Upload verification files and process media
 * Exact implementation matching Laravel UserController@verifyAccountSend
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Express response with processed media and user data
 */
const verifyAccountSend = async (req, res) => {
  try {
    logInfo('Verification upload request initiated');

    const { method: httpMethod, body: rawBody } = req;

    // 1) Authenticate user (no anonymous)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'verificationUpload' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verificationUpload' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verificationUpload' });
    if (errorResponse) {
      logError('Authentication failed for verification upload', { errorResponse });
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // 2) HTTP method validation
    // TODO: Convert event.httpMethod to req.method
    if (httpMethod !== 'POST') {
      logError('Invalid HTTP method for verification upload', { method: httpMethod });
      // TODO: Convert createErrorResponse(405, 'Method not allowed. Only POST requests are accepted.') to res.status(405).json({ error: 'Method not allowed. Only POST requests are accepted.' })
      return res.status(405).json(createErrorResponse(405, 'Method not allowed. Only POST requests are accepted.'));
    }

    // 3) Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(rawBody || '{}');
    } catch (error) {
      logError('Invalid JSON in request body for verification upload', { error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid JSON format in request body') to res.status(400).json({ error: 'Invalid JSON format in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON format in request body'));
    }

    // 4) Check for existing pending verification request (Laravel logic)
    const hasPendingRequest = await checkExistingVerificationRequest(userId);
    if (hasPendingRequest) {
      logError('User already has pending verification request', { userId });
      // TODO: Convert createErrorResponse(400, 'You have one application pending approval, you cannot send another one.') to res.status(400).json({ error: 'You have one application pending approval, you cannot send another one.' })
      return res.status(400).json(createErrorResponse(400, 'You have one application pending approval, you cannot send another one.'));
    }

    // Rejection guard: block resubmission when user has a rejected request
    const hasRejectedRequest = await checkExistingVerificationRequest(userId, 'rejected');
    if (hasRejectedRequest) {
      logError('User has rejected verification request; blocking resubmission', { userId });
      // TODO: Convert createErrorResponse(400, 'Sorry! You cannot submit a request to verify your account because your previously submitted request was rejected.') to res.status(400).json({ error: 'Sorry! You cannot submit a request to verify your account because your previously submitted request was rejected.' })
      return res.status(400).json(createErrorResponse(400, 'Sorry! You cannot submit a request to verify your account because your previously submitted request was rejected.'));
    }

    // 5) Get existing user data for validation
    const existingUser = await getUserById(userId);
    if (!existingUser) {
      logError('User not found for verification', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // 6) Validate request body using Laravel validation rules
    const validation = await validateVerificationRequest(requestBody, { userId, existingUser });
    if (!validation.success) {
      logError('Verification upload validation failed', { errors: validation.errors });
      // TODO: Convert createErrorResponse(400, 'Validation failed', validation.errors) to res.status(400).json({ error: 'Validation failed', details: validation.errors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    // 7) Validate files separately (kept for compatibility/future use)
    const fileValidation = validateVerificationFiles(requestBody, { country: validation.country });
    if (!fileValidation.success) {
      logError('File validation failed', { errors: fileValidation.errors });
      // TODO: Convert createErrorResponse(400, 'File validation failed', fileValidation.errors) to res.status(400).json({ error: 'File validation failed', details: fileValidation.errors })
      return res.status(400).json(createErrorResponse(400, 'File validation failed'));
    }

    // 8) Process file uploads and generate filenames (Laravel-style)
    const fileFields = ['form_w9', 'pancard_image', 'aadhar_image', 'selfie_image', 'identity'];
    const { files, generatedFilenames, allMediaKeys } = processVerificationFiles(userId, requestBody, fileFields);

    // Log which files are being processed for each country
    const { countries_id } = requestBody;
    const countryName = countries_id === 99 ? 'India' : (countries_id === 1 ? 'US' : 'Other');
    logInfo('Processing verification files for country', { 
      countryId: countries_id, 
      countryName, 
      totalFiles: allMediaKeys.length,
      fileFields: Object.keys(files).filter(key => files[key] && files[key].length > 0),
      generatedFilenames: Object.keys(generatedFilenames).filter(key => generatedFilenames[key])
    });

    // 9) Process media files and upload to S3 (if files are provided)
    let processedMedia = { original: [], converted: [] };
    
    if (allMediaKeys.length > 0) {
      const { AWS_BUCKET_NAME: bucketName } = process.env;
      if (!bucketName) {
        logError('S3 bucket not configured for verification upload');
        // TODO: Convert createErrorResponse(500, 'S3 bucket not configured') to res.status(500).json({ error: 'S3 bucket not configured' })
        return res.status(500).json(createErrorResponse(500, 'S3 bucket not configured'));
      }

      // Process and upload files to S3
      processedMedia = await processMediaFiles(allMediaKeys, bucketName, 'verification', { continueOnError: false });
      
      // Update generated filenames with actual S3 paths if files were uploaded
      if (processedMedia.original && processedMedia.original.length > 0) {
        logInfo('Files processed and uploaded to S3:', { 
          uploadedCount: processedMedia.original.length,
          paths: processedMedia.original
        });
      }
    }

    // 10) Update user profile data in database (users table)
    const profileUpdateSuccess = await updateUserProfileData(userId, requestBody);
    if (!profileUpdateSuccess) {
      logError('Failed to update user profile data', { userId });
      // TODO: Convert createErrorResponse(500, 'Failed to update user profile data') to res.status(500).json({ error: 'Failed to update user profile data' })
      return res.status(500).json(createErrorResponse(500, 'Failed to update user profile data'));
    }

    // 11) Save verification document references to database (verification_requests table)
    // Note: PAN card and Aadhar numbers are automatically encrypted for India users
    const documentSaveSuccess = await saveVerificationDocuments(userId, files, requestBody);
    if (!documentSaveSuccess) {
      logError('Failed to save verification documents', { userId });
      // TODO: Convert createErrorResponse(500, 'Failed to save verification documents') to res.status(500).json({ error: 'Failed to save verification documents' })
      return res.status(500).json(createErrorResponse(500, 'Failed to save verification documents'));
    }

    // 12) Fetch authenticated user data to return
    const user = await getUserById(userId);
    if (!user) {
      logError('Verification upload: user not found after processing', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    const { id, username } = user;

    const data = {
      user: { id: id ? parseInt(id) : undefined, username: username || null },
      media: processedMedia,
      profileUpdated: profileUpdateSuccess,
      documentsSaved: documentSaveSuccess
    };

    logInfo('Verification upload completed successfully', {
      userId,
      originals: processedMedia.original?.length || 0,
      converted: processedMedia.converted?.length || 0,
      profileUpdated: profileUpdateSuccess,
      documentsSaved: documentSaveSuccess,
      sensitiveDataEncrypted: countries_id === 99 && (requestBody.pancard || requestBody.aadhar),
      generatedFilenames: Object.keys(generatedFilenames).filter(key => generatedFilenames[key]).reduce((acc, key) => {
        acc[key] = generatedFilenames[key];
        return acc;
        }, {})
    });

    // TODO: Convert createSuccessResponse('Verification files uploaded and profile updated successfully', data) to res.json(createSuccessResponse('Verification files uploaded and profile updated successfully', data))
    return res.json(createSuccessResponse('Verification files uploaded and profile updated successfully', data));
  } catch (error) {
    logError('Unexpected error in verification upload', { error: error.message, stack: error.stack });
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /verification/conversations - Get verification conversations
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Express response with conversations data
 */
const getVerificationConversations = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'verificationConversations' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verificationConversations' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verificationConversations' });
    if (errorResponse) {
      logError('Authentication failed for verification conversations', { errorResponse });
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // TODO: Convert event.queryStringParameters to req.query
    const { page = 1, limit = 10 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);

    // TODO: Convert getVerificationConversationsList(userId, pageNum, limitNum) to getVerificationConversationsList(userId, pageNum, limitNum)
    const conversations = await getVerificationConversationsList(userId, pageNum, limitNum);
    
    logInfo('Verification conversations retrieved successfully', { userId, page: pageNum, limit: limitNum });
    // TODO: Convert createSuccessResponse('Verification conversations retrieved successfully', { conversations }) to res.json(createSuccessResponse('Verification conversations retrieved successfully', { conversations }))
    return res.json(createSuccessResponse('Verification conversations retrieved successfully', { conversations }));
  } catch (error) {
    logError('Error retrieving verification conversations:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to retrieve verification conversations') to res.status(500).json({ error: 'Failed to retrieve verification conversations' })
    return res.status(500).json(createErrorResponse(500, 'Failed to retrieve verification conversations'));
  }
};

/**
 * POST /verification/conversations - Store verification conversation
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Express response with conversation data
 */
const storeVerificationConversation = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'verificationConversationStore' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verificationConversationStore' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action: 'verificationConversationStore' });
    if (errorResponse) {
      logError('Authentication failed for verification conversation store', { errorResponse });
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
    const requestBody = JSON.parse(req.body || '{}');
    const { message, verification_request_id } = requestBody;

    if (!message || !verification_request_id) {
      logError('Missing required fields for verification conversation', { message: !!message, verification_request_id: !!verification_request_id });
      // TODO: Convert createErrorResponse(400, 'Message and verification request ID are required') to res.status(400).json({ error: 'Message and verification request ID are required' })
      return res.status(400).json(createErrorResponse(400, 'Message and verification request ID are required'));
    }

    // TODO: Convert storeVerificationConversationData(userId, verification_request_id, message) to storeVerificationConversationData(userId, verification_request_id, message)
    const conversation = await storeVerificationConversationData(userId, verification_request_id, message);
    
    logInfo('Verification conversation stored successfully', { userId, verification_request_id });
    // TODO: Convert createSuccessResponse('Verification conversation stored successfully', { conversation }) to res.json(createSuccessResponse('Verification conversation stored successfully', { conversation }))
    return res.json(createSuccessResponse('Verification conversation stored successfully', { conversation }));
  } catch (error) {
    logError('Error storing verification conversation:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to store verification conversation') to res.status(500).json({ error: 'Failed to store verification conversation' })
    return res.status(500).json(createErrorResponse(500, 'Failed to store verification conversation'));
  }
};

// Export all functions at the end
export {
  getVerificationRequestInfoHelper,
  getUserCategories,
  getAllCategories,
  getVerificationUploadUrl,
  getVerificationAccount,
  verifyAccountSend,
  getVerificationConversations,
  storeVerificationConversation
};