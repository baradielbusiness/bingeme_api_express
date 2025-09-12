import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { logInfo, logError } from './common.js';

// Initialize S3 client
const s3Client = new S3Client({ 
  region: process.env.AWS_DEFAULT_REGION || 'us-east-1'
});

/**
 * Check if a file exists in S3
 * @param {string} s3Key - The S3 object key
 * @returns {Promise<boolean>} - True if file exists, false otherwise
 */
export const checkFileExists = async (s3Key) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key
    });
    
    await s3Client.send(command);
    logInfo(`File exists in S3: ${s3Key}`);
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      logInfo(`File not found in S3: ${s3Key}`);
      return false;
    }
    logError('Error checking file existence in S3:', error);
    throw error;
  }
};

/**
 * Delete a file from S3
 * @param {string} s3Key - The S3 object key
 * @returns {Promise<boolean>} - True if deletion successful, false otherwise
 */
export const deleteFile = async (s3Key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: s3Key
    });
    
    await s3Client.send(command);
    logInfo(`File deleted from S3: ${s3Key}`);
    return true;
  } catch (error) {
    logError('Error deleting file from S3:', error);
    throw error;
  }
};
