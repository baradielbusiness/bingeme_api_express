import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logInfo, logError } from './common.js';
import sharp from 'sharp';

// Initialize S3 client
const s3Client = new S3Client({ 
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
});

/**
 * Process media files - convert images to WebP and optimize
 */
export const processMediaFiles = async (fileKeys) => {
  try {
    const processedFiles = [];
    
    for (const fileKey of fileKeys) {
      try {
        // Download file from S3
        const getCommand = new GetObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: fileKey
        });
        
        const response = await s3Client.send(getCommand);
        const fileBuffer = await streamToBuffer(response.Body);
        
        // Check if it's an image
        const isImage = await isImageFile(fileBuffer);
        
        if (isImage) {
          // Convert to WebP
          const processedBuffer = await convertToWebP(fileBuffer);
          const newKey = fileKey.replace(/\.[^.]+$/, '.webp');
          
          // Upload processed file
          const putCommand = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: newKey,
            Body: processedBuffer,
            ContentType: 'image/webp'
          });
          
          await s3Client.send(putCommand);
          
          // Delete original file
          const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: fileKey
          });
          
          await s3Client.send(deleteCommand);
          
          processedFiles.push({
            originalKey: fileKey,
            processedKey: newKey,
            processed: true
          });
          
          logInfo(`Processed image: ${fileKey} -> ${newKey}`);
        } else {
          // Keep original file for non-images
          processedFiles.push({
            originalKey: fileKey,
            processedKey: fileKey,
            processed: false
          });
        }
      } catch (error) {
        logError(`Error processing file ${fileKey}:`, error);
        // Keep original file if processing fails
        processedFiles.push({
          originalKey: fileKey,
          processedKey: fileKey,
          processed: false,
          error: error.message
        });
      }
    }
    
    return processedFiles;
  } catch (error) {
    logError('Error processing media files:', error);
    throw error;
  }
};

/**
 * Cleanup S3 files
 */
export const cleanupS3Files = async (fileKeys) => {
  try {
    for (const fileKey of fileKeys) {
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: fileKey
        });
        
        await s3Client.send(deleteCommand);
        logInfo(`Cleaned up S3 file: ${fileKey}`);
      } catch (error) {
        logError(`Error cleaning up file ${fileKey}:`, error);
      }
    }
  } catch (error) {
    logError('Error cleaning up S3 files:', error);
    throw error;
  }
};

/**
 * Validate an array of media paths for posts/uploads
 * Returns { success: boolean, errors: string[] }
 */
export const validateMediaArray = (media, basePath = 'uploads/updates/', context = 'post') => {
  const errors = [];
  if (!Array.isArray(media)) {
    return { success: false, errors: ['media must be an array'] };
  }
  if (media.length === 0) {
    return { success: true, errors };
  }
  const allowedExt = ['jpg','jpeg','png','gif','webp','bmp','svg','tiff','avif','jfif','heic','mp4','mov','avi','mkv','webm','mpeg','3gp','flv','ogv','wmv','mp3','wav','m4a','aac','ogg','flac','pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','zip','rar','7z','tar','gz'];
  media.forEach((item, idx) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`media[${idx}] must be a non-empty string`);
      return;
    }
    // Optional base path check when a relative key is expected
    if (!/^https?:\/\//i.test(item) && basePath && typeof basePath === 'string' && basePath.length > 0) {
      // allow either starting with basePath or any path if contains '/'
      if (!(item.startsWith(basePath) || item.includes('/'))) {
        errors.push(`media[${idx}] has invalid path; expected to include '${basePath}'`);
      }
    }
    const ext = item.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    if (!allowedExt.includes(ext)) {
      errors.push(`media[${idx}] has unsupported file type: .${ext}`);
    }
  });
  return { success: errors.length === 0, errors };
};

/**
 * Convert stream to buffer
 */
const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

/**
 * Check if file is an image
 */
const isImageFile = async (buffer) => {
  try {
    const metadata = await sharp(buffer).metadata();
    return metadata.format !== undefined;
  } catch (error) {
    return false;
  }
};

/**
 * Convert image to WebP format
 */
const convertToWebP = async (buffer) => {
  try {
    return await sharp(buffer)
      .webp({ quality: 80 })
      .toBuffer();
  } catch (error) {
    logError('Error converting to WebP:', error);
    throw error;
  }
};
