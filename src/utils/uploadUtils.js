// =====================================================
// uploadUtils.js - Shared utilities for S3 Pre-signed Upload URLs
// =====================================================
/**
 * @file uploadUtils.js
 * @description
 *   This file contains shared utilities for generating pre-signed S3 URLs for secure file uploads.
 *   It serves as the core engine for both posts and products upload handlers, providing
 *   a unified approach to file upload processing with configurable storage strategies.
 * 
 *   Overall Purpose:
 *     - Generate secure, time-limited pre-signed URLs for AWS S3 file uploads
 *     - Support multiple file types (images, audio, video, documents, archives)
 *     - Provide configurable storage paths with optional folder organization
 *     - Handle comprehensive validation and error management
 *     - Eliminate code duplication across different upload contexts
 * 
 *   File Structure and Flow:
 *     1. Constants & Configuration: File extensions, MIME types, upload settings
 *     2. Utility Functions: File extension extraction, folder mapping, JSON parsing
 *     3. Core Upload Functions: S3 client creation, URL generation, request validation
 *     4. Main Handler: processUploadRequest - orchestrates the entire upload flow
 * 
 *   Upload Flow:
 *     Validate request parameters → Authenticate user → Extract file extensions →
 *     Determine MIME types → Generate unique S3 keys → Create pre-signed URLs →
 *     Return structured response with metadata
 * 
 *   Key Features:
 *     - Automatic MIME type detection from file extensions
 *     - Configurable S3 path structure (flat vs. folder organization)
 *     - Comprehensive input validation and error handling
 *     - Support for multiple file types and formats
 *     - Reusable across different upload contexts (posts, products, etc.)
 * 
 *   Usage Examples:
 *     - Posts: uploads/updates/{folder}/{userId}{uuid}.{ext} (with folder organization)
 *     - Products: uploads/shop/{userId}{uuid}.{ext} (flat structure)
 *     - Messages: uploads/messages/{folder}/{userId}{uuid}.{ext} (with folder organization)  
 */

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import { createErrorResponse, createSuccessResponse, logInfo, logError } from './common.js';

// =========================
// Constants and Configuration
// =========================

/**
 * File extension groups for S3 folder routing and MIME type detection
 */
const FILE_EXTENSIONS = {
  IMAGES: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'avif', 'jfif', 'heic'],
  AUDIO: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
  VIDEO: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mpeg', '3gp', 'flv', 'ogv', 'wmv'],
  FILES: ['zip', 'rar', '7z', 'tar', 'gz', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf']
};

/**
 * MIME type mapping for supported file extensions
 */
const MIME_TYPES = {
  // Images
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', tiff: 'image/tiff', avif: 'image/avif', jfif: 'image/jpeg', heic: 'image/heic',
  // Audio
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
  // Video
  mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska', webm: 'video/webm',
  mpeg: 'video/mpeg', '3gp': 'video/3gpp', flv: 'video/x-flv', ogv: 'video/ogg', wmv: 'video/x-ms-wmv',
  // Documents
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', rtf: 'application/rtf',
  // Archives
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', tar: 'application/x-tar', gz: 'application/gzip'
};

// Configuration constants
const UPLOAD_CONFIG = {
  EXPIRY_SECONDS: 1200, // 20 minutes
  DEFAULT_MIME_TYPE: 'application/octet-stream'
};

// Pre-compiled regex for better performance
const FILE_EXTENSION_REGEX = /\.([a-zA-Z0-9]+)$/;

// Folder mapping for better performance (avoid repeated array searches)
const FOLDER_MAPPING = new Map([
  ['images', FILE_EXTENSIONS.IMAGES],
  ['music', FILE_EXTENSIONS.AUDIO],
  ['videos', FILE_EXTENSIONS.VIDEO],
  ['files', FILE_EXTENSIONS.FILES]
]);

// =========================
// Utility Functions
// =========================

/**
 * Extracts the file extension from a filename (case-insensitive)
 * @param {string} fileName - The filename to extract extension from
 * @returns {string} File extension in lowercase, or empty string if not found
 */
const getFileExtension = (fileName) => {
  if (!fileName || typeof fileName !== 'string') return '';
  const match = fileName.match(FILE_EXTENSION_REGEX);
  return match ? match[1].toLowerCase() : '';
};

/**
 * Determines the appropriate S3 folder based on file extension
 * @param {string} extension - File extension to categorize
 * @returns {string} Folder name for S3 organization
 */
const getS3FolderByExtension = (extension) => {
  if (!extension) return 'other';
  for (const [folder, extensions] of FOLDER_MAPPING) {
    if (extensions.includes(extension)) return folder;
  }
  return 'other';
};

/**
 * Gets the appropriate MIME type for a file extension
 * @param {string} extension - File extension to get MIME type for
 * @returns {string} MIME type string, or default if not found
 */
const getMimeTypeFromExtension = (extension) => {
  return MIME_TYPES[extension] || UPLOAD_CONFIG.DEFAULT_MIME_TYPE;
};

/**
 * Safely parses a JSON string, returning null if invalid
 * @param {string} jsonString - JSON string to parse
 * @returns {any} Parsed object or null if invalid
 */
const parseJsonSafely = (jsonString) => {
  if (!jsonString || typeof jsonString !== 'string') return null;
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
};

/**
 * Validates that input is a non-empty array
 * @param {any} input - Value to validate
 * @returns {boolean} True if input is a valid non-empty array
 */
const isValidArray = (input) => {
  return Array.isArray(input) && input.length > 0;
};

// =========================
// Core Upload Functions
// =========================

/**
 * Generates a pre-signed URL for uploading a single file to S3
 * @param {S3Client} s3Client - AWS S3 client instance
 * @param {string} bucketName - S3 bucket name
 * @param {string} fileName - Original filename
 * @param {string} userId - User ID for unique key generation
 * @param {string} basePath - Base S3 path (e.g., 'uploads/updates' or 'uploads/shop' or 'uploads/messages')
 * @param {boolean} useFolderOrganization - Whether to organize files by type in subfolders
 * @returns {Promise<object>} Object containing uploadUrl, key, expiresIn, and filename
 * @throws {Error} If fileName is missing extension or invalid parameters
 */
const generateSingleUploadUrl = async (s3Client, bucketName, fileName, userId, basePath, useFolderOrganization = true) => {
  // Input validation with destructuring
  if (!s3Client || !bucketName || !fileName || !userId || !basePath) {
    throw new Error('Missing required parameters for upload URL generation');
  }
  
  // Extract and validate file extension
  const fileExtension = getFileExtension(fileName);
  if (!fileExtension) {
    throw new Error(`Invalid fileName: missing file extension for ${fileName}`);
  }
  
  // Get MIME type and generate unique S3 key
  const mimeType = getMimeTypeFromExtension(fileExtension);
  const uniqueId = uuidv4();
  const uniqueKey = useFolderOrganization
    ? `${basePath}/${getS3FolderByExtension(fileExtension)}/${userId}${uniqueId}.${fileExtension}`
    : `${basePath}/${userId}${uniqueId}.${fileExtension}`;
  
  // Create S3 PUT command and generate pre-signed URL
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: uniqueKey,
    ContentType: mimeType,
  });
  
  const uploadUrl = await getSignedUrl(s3Client, command, { 
    expiresIn: UPLOAD_CONFIG.EXPIRY_SECONDS 
  });
  
  return {
    uploadUrl,
    key: uniqueKey,
    expiresIn: UPLOAD_CONFIG.EXPIRY_SECONDS,
    filename: fileName
  };
};

/**
 * Creates and returns an AWS S3 client instance
 * @param {string} region - AWS region for the S3 client
 * @returns {S3Client} Configured S3 client instance
 */
const createS3Client = (region) => {
  if (!region) throw new Error('AWS region is required for S3 client creation');
  return new S3Client({ region });
};

/**
 * Validates upload request parameters from Express request
 * @param {object} req - Express request object
 * @param {Array<string>} allowedFileTypes - Optional array of allowed file extensions (without dots)
 * @returns {object} Object with parsed fileNames array or error response
 */
const validateUploadRequest = (req, allowedFileTypes = null) => {
  if (!req || typeof req !== 'object') {
    return createErrorResponse(400, 'Invalid request object');
  }
  
  // Destructure request properties with default values
  const { method, query = {} } = req;
  const { fileNames } = query;
  
  // Validate HTTP method and required parameters
  if (method !== 'GET') return createErrorResponse(405, 'Method not allowed');
  if (!fileNames) return createErrorResponse(400, 'Missing fileNames in query parameters');
  
  // Parse and validate JSON array
  const parsedFileNames = parseJsonSafely(fileNames);
  if (!isValidArray(parsedFileNames)) {
    return createErrorResponse(400, 'fileNames must be a valid non-empty JSON array');
  }
  
  // Validate file types if restrictions are specified
  if (allowedFileTypes && Array.isArray(allowedFileTypes)) {
    const invalidFiles = [];
    for (const fileName of parsedFileNames) {
      const fileExtension = getFileExtension(fileName);
      if (!fileExtension || !allowedFileTypes.includes(fileExtension.toLowerCase())) {
        invalidFiles.push(fileName);
      }
    }
    
    if (invalidFiles.length > 0) {
      return createErrorResponse(400, `File type not allowed. Allowed types: ${allowedFileTypes.join(', ')}`, {
        invalidFiles,
        allowedTypes: allowedFileTypes
      });
    }
  }
  
  return { fileNames: parsedFileNames };
};

/**
 * Retrieves S3 configuration from environment variables
 * @returns {object} Object with bucketName and region, or error response
 */
const getS3Config = () => {
  // Destructure environment variables with aliasing
  const bucketName = process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1';
  
  if (!bucketName) return createErrorResponse(500, 'S3 bucket not configured');
  return { bucketName, region };
};

/**
 * Shared upload handler that processes multiple files and generates pre-signed URLs
 * This function eliminates code duplication between posts and products upload handlers
 * @param {object} req - Express request object
 * @param {object} options - Configuration options for the upload handler
 * @param {string} options.action - Action name for logging
 * @param {string} options.basePath - Base S3 path (e.g., 'uploads/updates' or 'uploads/shop' or 'uploads/messages')
 * @param {boolean} options.useFolderOrganization - Whether to organize files by type in subfolders
 * @param {string} options.successMessage - Success message for the response
 * @param {function} options.getAuthenticatedUserId - Function to get authenticated user ID
 * @param {Array<string>} options.allowedFileTypes - Optional array of allowed file extensions (without dots) for file type restrictions
 * @returns {Promise<object>} API response with pre-signed URLs or error
 */
const processUploadRequest = async (req, options) => {
  // Destructure options with clear variable names
  const { action, basePath, useFolderOrganization, successMessage, getAuthenticatedUserId, allowedFileTypes } = options;
  
  try {
    logInfo(`Get multiple upload URLs request received for ${action}`);
    
    // 1. Authenticate user (no anonymous allowed)
    const { userId, errorResponse } = getAuthenticatedUserId(req, { allowAnonymous: false, action });
    if (errorResponse) return errorResponse;
    
    // 2. Validate request parameters using shared utility with file type restrictions
    const validationResult = validateUploadRequest(req, allowedFileTypes);
    if (validationResult.statusCode) return validationResult;
    const { fileNames: parsedFileNames } = validationResult;
    
    // 3. Get S3 configuration using shared utility
    const s3Config = getS3Config();
    if (s3Config.statusCode) {
      logError('S3 configuration error:', s3Config);
      return s3Config;
    }
    const { bucketName, region } = s3Config;
    
    // 4. Create S3 client and generate pre-signed URLs for each file
    const s3Client = createS3Client(region);
    const uploadResults = [];
    const errors = [];
    
    // Process each file with error handling
    for (const fileName of parsedFileNames) {
      try {
        const result = await generateSingleUploadUrl(s3Client, bucketName, fileName, userId, basePath, useFolderOrganization);
        uploadResults.push(result);
      } catch (error) {
        logError(`Error generating upload URL for file ${fileName}:`, error);
        errors.push({ filename: fileName, error: error.message });
      }
    }
    
    // 5. Check if any files were processed successfully
    if (uploadResults.length === 0) {
      return createErrorResponse(500, 'Failed to generate upload URLs for any files', { errors });
    }
    
    // 6. Log success and return results
    logInfo('Multiple pre-signed upload URLs generated', { 
      userId, totalFiles: parsedFileNames.length, successfulFiles: uploadResults.length, failedFiles: errors.length 
    });
    
    return createSuccessResponse(successMessage, uploadResults);
    
  } catch (err) {
    logError(`Unexpected error in ${action}:`, err);
    return createErrorResponse(500, err.message || 'Internal server error');
  }
};

// =========================
// Module Exports
// =========================

export { processUploadRequest };