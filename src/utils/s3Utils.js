import { S3Client, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
const checkFileExists = async (s3Key) => {
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
const deleteFile = async (s3Key) => {
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

/**
 * Download a file from S3
 * @param {string} bucketName - The S3 bucket name
 * @param {string} s3Key - The S3 object key
 * @returns {Promise<Buffer>} - The file content as Buffer
 */
const downloadFile = async (bucketName, s3Key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    });
    
    const response = await s3Client.send(command);
    const chunks = [];
    
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    
    const buffer = Buffer.concat(chunks);
    logInfo(`File downloaded from S3: ${s3Key}`);
    return buffer;
  } catch (error) {
    logError('Error downloading file from S3:', error);
    throw error;
  }
};

/**
 * Upload a file to S3
 * @param {string} bucketName - The S3 bucket name
 * @param {string} s3Key - The S3 object key
 * @param {Buffer} fileBuffer - The file content as Buffer
 * @param {string} contentType - The MIME type of the file
 * @returns {Promise<boolean>} - True if upload successful, false otherwise
 */
const uploadFile = async (bucketName, s3Key, fileBuffer, contentType) => {
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType
    });
    
    await s3Client.send(command);
    logInfo(`File uploaded to S3: ${s3Key}`);
    return true;
  } catch (error) {
    logError('Error uploading file to S3:', error);
    throw error;
  }
};

// Export all functions at the end
export {
  checkFileExists,
  deleteFile,
  downloadFile,
  uploadFile
};