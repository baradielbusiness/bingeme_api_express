import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logInfo, logError } from './common.js';

// Initialize S3 client
const s3Client = new S3Client({ 
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
});

/**
 * Process upload request - generate pre-signed URLs
 */
export const processUploadRequest = async (fileNames, folder = 'uploads') => {
  try {
    const uploadUrls = [];
    
    for (const fileName of fileNames) {
      try {
        // Generate unique file key
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 15);
        const fileExtension = fileName.split('.').pop();
        const uniqueFileName = `${folder}/${timestamp}_${randomString}.${fileExtension}`;
        
        // Generate pre-signed URL for upload
        const putCommand = new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: uniqueFileName,
          ContentType: getContentType(fileExtension)
        });
        
        const presignedUrl = await getSignedUrl(s3Client, putCommand, { 
          expiresIn: 3600 // 1 hour
        });
        
        uploadUrls.push({
          fileName,
          fileKey: uniqueFileName,
          uploadUrl: presignedUrl,
          contentType: getContentType(fileExtension)
        });
        
        logInfo(`Generated upload URL for: ${fileName} -> ${uniqueFileName}`);
      } catch (error) {
        logError(`Error generating upload URL for ${fileName}:`, error);
        throw error;
      }
    }
    
    return uploadUrls;
  } catch (error) {
    logError('Error processing upload request:', error);
    throw error;
  }
};

/**
 * Get content type based on file extension
 */
const getContentType = (extension) => {
  const contentTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'avi': 'video/x-msvideo',
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain'
  };
  
  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
};
