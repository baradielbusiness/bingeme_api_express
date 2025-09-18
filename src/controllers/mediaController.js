import { createSuccessResponse, createErrorResponse, logInfo, logError } from '../utils/common.js';
import { checkFileExists, deleteFile } from '../utils/s3Utils.js';

/**
 * Validates the S3 object key for security and format
 */
const validateS3Key = (s3Key) => {
  const errors = [];
  
  // Check if key is provided
  if (!s3Key || typeof s3Key !== 'string') {
    errors.push('S3 key is required and must be a string');
    return { isValid: false, errors };
  }
  
  // Check for dangerous path traversal patterns
  if (s3Key.includes('..') || s3Key.includes('//') || s3Key.startsWith('/')) {
    errors.push('S3 key contains invalid path patterns');
  }
  
  // Check length (reasonable limit)
  if (s3Key.length > 1024) {
    errors.push('S3 key is too long');
  }
  
  // Check for empty key
  if (s3Key.trim().length === 0) {
    errors.push('S3 key cannot be empty');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Delete media file from S3
 */
export const deleteMediaFile = async (req, res) => {
  try {
    const userId = req.userId;
    let s3Key;

    // Try to get S3 key from query parameters first, then from body
    s3Key = req.query.key || req.body.key;

    if (!s3Key) {
      return res.status(400).json(createErrorResponse(400, 'S3 key is required'));
    }

    // Validate S3 key
    const validation = validateS3Key(s3Key);
    if (!validation.isValid) {
      return res.status(400).json(createErrorResponse(400, 'Invalid S3 key'));
    }

    // Check if file exists before attempting deletion
    const fileExists = await checkFileExists(s3Key);
    if (!fileExists) {
      return res.status(404).json(createErrorResponse(404, 'File not found'));
    }

    // Delete the file
    const deleteResult = await deleteFile(s3Key);
    if (!deleteResult.success) {
      return res.status(500).json(createErrorResponse(500, 'Failed to delete file'));
    }

    logInfo('Media file deleted successfully', { userId, s3Key });
    return res.json(createSuccessResponse('Media file deleted successfully', {
      key: s3Key,
      deleted: true
    }));

  } catch (error) {
    logError('Error deleting media file:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
