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
  // TODO: Convert event.queryStringParameters && event.queryStringParameters.key to req.query && req.query.key
  if (req.query && req.query.key) {
    logInfo('Extracting S3 key from query parameters');
    return { success: true, key: req.query.key };
  }
  
  // Try to get key from request body
  if (req.body) {
    try {
      // Try to parse as JSON first
      // TODO: Convert JSON.parse(event.body) to JSON.parse(req.body)
      const body = JSON.parse(req.body);
      if (body.key) {
        logInfo('Extracting S3 key from JSON request body');
        return { success: true, key: body.key };
      }
    } catch (error) {
      // If JSON parsing fails, try to parse as form data
      logInfo('JSON parsing failed, trying form data parsing');
      // TODO: Convert new URLSearchParams(event.body) to new URLSearchParams(req.body)
      const formData = new URLSearchParams(req.body);
      const key = formData.get('key');
      if (key) {
        logInfo('Extracting S3 key from form data request body');
        return { success: true, key };
      }
    }
  }
  
  errors.push('S3 object key not found in query parameters or request body');
  return { success: false, errors };
};

/**
 * Main Lambda handler for S3 media deletion requests
 * 
 * This is the primary entry point for S3 file deletion. It orchestrates the entire process:
 * 1. Authenticates the user making the request
 * 2. Validates the HTTP method and request format
 * 3. Extracts and validates the S3 object key
 * 4. Checks if the file exists in S3
 * 5. Deletes the file from S3 if it exists
 * 6. Returns a comprehensive response with deletion status
 * 
 * @param {Object} req - Express request object
 * @param {string} req.method - HTTP method (must be DELETE)
 * @param {string} req.query - Query parameters (optional key)
 * @param {string} req.body - Request body (optional key in JSON or form data)
 * @param {Object} req.headers - Request headers including authorization
 * @returns {Object} Express response object
 */
const deleteS3Media = async (req, res) => {
  try {
    logInfo('S3 media deletion request initiated');
    // TODO: Convert event details to req details
    logInfo('Event details:', { 
      httpMethod: req.method,
      path: req.path,
      hasQueryParams: !!req.query,
      hasBody: !!req.body,
      headers: req.headers ? Object.keys(req.headers) : 'No headers'
    });

    // Step 1: Authenticate user (anonymous users not allowed for S3 operations)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 's3MediaDelete' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 's3MediaDelete' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 's3MediaDelete' 
    });
    if (errorResponse) {
      logError('Authentication failed:', { errorResponse });
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }
    logInfo('Authentication successful:', { userId });

    // Step 2: Validate HTTP method (only DELETE allowed)
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'DELETE') {
      logError('Invalid HTTP method for S3 media deletion:', { method: req.method });
      // TODO: Convert createErrorResponse(405, 'Method not allowed. Only DELETE requests are accepted.') to res.status(405).json({ error: 'Method not allowed. Only DELETE requests are accepted.' })
      return res.status(405).json(createErrorResponse(405, 'Method not allowed. Only DELETE requests are accepted.'));
    }

    // Step 3: Extract S3 object key from request
    // TODO: Convert extractS3Key(event) to extractS3Key(req)
    const keyExtraction = extractS3Key(req);
    if (!keyExtraction.success) {
      logError('S3 key extraction failed:', { errors: keyExtraction.errors });
      // TODO: Convert createErrorResponse(400, 'Invalid request format', keyExtraction.errors) to res.status(400).json({ error: 'Invalid request format', details: keyExtraction.errors })
      return res.status(400).json(createErrorResponse(400, 'Invalid request format'));
    }
    
    const { key: rawS3Key } = keyExtraction;
    logInfo('S3 key extracted successfully:', { rawS3Key });

    // Step 4: Validate S3 object key
    const keyValidation = validateS3Key(rawS3Key);
    if (!keyValidation.success) {
      logError('S3 key validation failed:', { errors: keyValidation.errors });
      // TODO: Convert createErrorResponse(422, 'Validation failed', keyValidation.errors) to res.status(422).json({ error: 'Validation failed', details: keyValidation.errors })
      return res.status(422).json(createErrorResponse(422, 'Validation failed'));
    }
    
    const s3Key = keyValidation.key;
    logInfo('S3 key validation passed:', { s3Key });

    // Step 5: Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      // TODO: Convert createErrorResponse(500, 'Media storage not configured') to res.status(500).json({ error: 'Media storage not configured' })
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
      // TODO: Convert createErrorResponse(500, 'Failed to check file existence', error.message) to res.status(500).json({ error: 'Failed to check file existence', details: error.message })
      return res.status(500).json(createErrorResponse(500, 'Failed to check file existence'));
    }

    // Step 7: Delete file from S3 if it exists
    if (fileExists) {
      try {
        logInfo('File exists, proceeding with deletion');
        await deleteFile(bucketName, s3Key);
        logInfo('File deleted successfully from S3');
      } catch (error) {
        logError('Error deleting file from S3:', { error: error.message });
        // TODO: Convert createErrorResponse(500, 'Failed to delete file from S3', error.message) to res.status(500).json({ error: 'Failed to delete file from S3', details: error.message })
        return res.status(500).json(createErrorResponse(500, 'Failed to delete file from S3'));
      }
    } else {
      logInfo('File does not exist in S3, no deletion needed');
    }

    // Step 8: Build success response - Simplified response without data field
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
    // TODO: Convert createSuccessResponse(message) to res.json({ success: true, message })
    return res.json({ success: true, message });

  } catch (error) {
    // Handle any unexpected errors
    logError('Unexpected error in S3 media deletion handler:', { 
      error: error.message, 
      stack: error.stack 
    });
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// Export all functions at the end
export {
  deleteS3Media
};