/**
 * @file s3MediaDeleteController.js
 * @description S3 Media Delete controller for Bingeme API Express.js
 * Handles deletion of media files from AWS S3 bucket with comprehensive validation
 */

import { 
  logInfo, 
  logError, 
  createErrorResponse, 
  createSuccessResponse, 
  getAuthenticatedUserId 
} from '../utils/common.js';
import { checkFileExists, deleteFile } from '../utils/s3Utils.js';

/**
 * Validates the S3 object key for security and format
 * 
 * This function ensures the S3 key is:
 * - Not empty or null
 * - Doesn't contain dangerous path traversal patterns
 * - Follows expected format patterns
 * - Doesn't exceed reasonable length limits
 * 
 * @param {string} s3Key - The S3 object key to validate
 * @returns {Object} Validation result with success status and any errors
 */
const validateS3Key = (s3Key) => {
  const errors = [];
  
  // Check if key is provided
  if (!s3Key || typeof s3Key !== 'string') {
    errors.push('S3 object key is required and must be a string');
    return { success: false, errors };
  }
  
  // Trim whitespace
  const trimmedKey = s3Key.trim();
  if (trimmedKey.length === 0) {
    errors.push('S3 object key cannot be empty');
    return { success: false, errors };
  }
  
  // Check for dangerous path traversal patterns
  const dangerousPatterns = [
    '..', '../', '..\\', '..%2f', '..%5c', 
    '..%2F', '..%5C', '%2e%2e', '%5c%5c'
  ];
  
  const lowerKey = trimmedKey.toLowerCase();
  for (const pattern of dangerousPatterns) {
    if (lowerKey.includes(pattern)) {
      errors.push('S3 object key contains invalid path traversal patterns');
      return { success: false, errors };
    }
  }
  
  // Check for reasonable length (S3 keys have a 1024 byte limit, but we'll be more conservative)
  if (trimmedKey.length > 500) {
    errors.push('S3 object key is too long (maximum 500 characters)');
    return { success: false, errors };
  }
  
  // Check for valid characters (basic validation)
  const validKeyPattern = /^[a-zA-Z0-9\/\-_\.]+$/;
  if (!validKeyPattern.test(trimmedKey)) {
    errors.push('S3 object key contains invalid characters');
    return { success: false, errors };
  }
  
  return { success: true, key: trimmedKey };
};

/**
 * Extracts S3 object key from request (query parameters or request body)
 * 
 * This function supports multiple ways to provide the S3 key:
 * - Query parameter: ?key=uploads/images/file.jpg
 * - Request body JSON: {"key": "uploads/images/file.jpg"}
 * - Request body form: key=uploads/images/file.jpg
 * 
 * @param {Object} req - Express request object
 * @returns {Object} Extraction result with success status and key or errors
 */
const extractS3Key = (req) => {
  const errors = [];
  
  // Try to get key from query parameters first
  if (req.query && req.query.key) {
    logInfo('Extracting S3 key from query parameters');
    return { success: true, key: req.query.key };
  }
  
  // Try to get key from request body
  if (req.body) {
    if (req.body.key) {
      logInfo('Extracting S3 key from JSON request body');
      return { success: true, key: req.body.key };
    }
  }
  
  errors.push('S3 object key not found in query parameters or request body');
  return { success: false, errors };
};

/**
 * Delete media file from S3 bucket
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteS3Media = async (req, res) => {
  try {
    logInfo('S3 media deletion request initiated');
    logInfo('Request details:', { 
      method: req.method,
      path: req.path,
      hasQuery: !!req.query,
      hasBody: !!req.body,
      headers: req.headers ? Object.keys(req.headers) : 'No headers'
    });

    // Step 1: Authenticate user (anonymous users not allowed for S3 operations)
    const userId = req.userId;
    if (!userId) {
      logError('Authentication failed: User not authenticated');
      return res.status(401).json(createErrorResponse(401, 'Authentication required'));
    }
    logInfo('Authentication successful:', { userId });

    // Step 2: Validate HTTP method (only DELETE allowed)
    if (req.method !== 'DELETE') {
      logError('Invalid HTTP method for S3 media deletion:', { method: req.method });
      return res.status(405).json(createErrorResponse(405, 'Method not allowed. Only DELETE requests are accepted.'));
    }

    // Step 3: Extract S3 object key from request
    const keyExtraction = extractS3Key(req);
    if (!keyExtraction.success) {
      logError('S3 key extraction failed:', { errors: keyExtraction.errors });
      return res.status(400).json(createErrorResponse(400, 'Invalid request format', keyExtraction.errors));
    }
    
    const { key: rawS3Key } = keyExtraction;
    logInfo('S3 key extracted successfully:', { rawS3Key });

    // Step 4: Validate S3 object key
    const keyValidation = validateS3Key(rawS3Key);
    if (!keyValidation.success) {
      logError('S3 key validation failed:', { errors: keyValidation.errors });
      return res.status(422).json(createErrorResponse(422, 'Validation failed', keyValidation.errors));
    }
    
    const s3Key = keyValidation.key;
    logInfo('S3 key validation passed:', { s3Key });

    // Step 5: Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }
    logInfo('S3 bucket configuration retrieved:', { bucketName });

    // Step 6: Check if file exists in S3 before attempting deletion
    let fileExists;
    try {
      logInfo('Checking if file exists in S3 before deletion');
      fileExists = await checkFileExists(bucketName, s3Key);
      logInfo('File existence check completed:', { fileExists });
    } catch (error) {
      logError('Error checking file existence in S3:', { error: error.message });
      return res.status(500).json(createErrorResponse(500, 'Failed to check file existence', error.message));
    }

    // Step 7: Delete file from S3 if it exists
    if (fileExists) {
      try {
        logInfo('File exists, proceeding with deletion');
        await deleteFile(bucketName, s3Key);
        logInfo('File deleted successfully from S3');
      } catch (error) {
        logError('Error deleting file from S3:', { error: error.message });
        return res.status(500).json(createErrorResponse(500, 'Failed to delete file from S3', error.message));
      }
    } else {
      logInfo('File does not exist in S3, no deletion needed');
    }

    // Step 8: Build success response
    // Log successful operation with detailed metrics
    logInfo('S3 media deletion completed successfully:', { 
      userId, 
      s3Key,
      bucketName,
      fileExisted: fileExists,
      operation: fileExists ? 'deleted' : 'no_action_required'
    });

    const message = fileExists 
      ? 'File deleted successfully from S3' 
      : 'File not found in S3 (no action required)';

    // Return simplified response without data field
    return res.json(createSuccessResponse(message));

  } catch (error) {
    // Handle any unexpected errors
    logError('Unexpected error in S3 media deletion handler:', { 
      error: error.message, 
      stack: error.stack 
    });
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};
