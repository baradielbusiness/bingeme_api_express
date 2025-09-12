/**
 * @file faceDetection.js
 * @description Face detection utilities using AWS Rekognition
 * @author Bingeme API Team
 */

import { RekognitionClient, DetectFacesCommand } from '@aws-sdk/client-rekognition';
import { logInfo, logError } from './common.js';

// Initialize Rekognition client
const rekognitionClient = new RekognitionClient({ 
  region: process.env.AWS_DEFAULT_REGION || 'eu-west-2' 
});

/**
 * Check if a face is visible in the image using AWS Rekognition
 * @param {Buffer} imageBuffer - Image buffer to check
 * @returns {Promise<Object>} Object with face_found property
 */
const checkFaceVisibility = async (imageBuffer) => {
  try {
    if (!imageBuffer || imageBuffer.length < 1000) {
      logInfo('Image too small for face detection', { imageSize: imageBuffer?.length });
      return { face_found: false };
    }

    const command = new DetectFacesCommand({
      Image: {
        Bytes: imageBuffer
      },
      Attributes: ['DEFAULT'],
      MaxFaces: 1
    });

    const response = await rekognitionClient.send(command);
    
    const facesDetected = response.FaceDetails?.length || 0;
    const confidence = response.FaceDetails?.[0]?.Confidence || 0;
    
    // Get face details for validation
    const faceDetails = response.FaceDetails?.[0];
    
    // Primary detection: face_found = true if face detected with reasonable confidence
    const face_found = facesDetected > 0 && confidence >= 20;
    
    // If primary detection fails, try with even lower threshold (10%) as fallback
    let fallbackFaceFound = false;
    if (!face_found && facesDetected > 0 && confidence >= 10) {
      fallbackFaceFound = true;
      logInfo('Face detected with fallback threshold', { confidence, fallbackThreshold: 10 });
    }
    
    // Additional validation: check if face is properly positioned and visible
    let isValidFace = false;
    if (faceDetails) {
      const boundingBox = faceDetails.BoundingBox;
      const pose = faceDetails.Pose;
      
      // Check if face is reasonably sized and positioned
      if (boundingBox) {
        const { Width, Height, Left, Top } = boundingBox;
        
        // Face should be at least 10% of image size
        const minSize = 0.1;
        const isReasonableSize = Width >= minSize && Height >= minSize;
        
        // Face should be within image bounds
        const isWithinBounds = Left >= 0 && Top >= 0 && 
                              (Left + Width) <= 1 && (Top + Height) <= 1;
        
        // Face should not be too close to edges
        const isNotAtEdges = Left >= 0.05 && Top >= 0.05 && 
                            (Left + Width) <= 0.95 && (Top + Height) <= 0.95;
        
        isValidFace = isReasonableSize && isWithinBounds && isNotAtEdges;
      }
      
      // Check pose - face should not be too tilted
      if (pose) {
        const { Roll, Yaw, Pitch } = pose;
        const isReasonablePose = Math.abs(Roll) < 30 && Math.abs(Yaw) < 45 && Math.abs(Pitch) < 30;
        isValidFace = isValidFace && isReasonablePose;
      }
    }
    
    const finalResult = face_found || (fallbackFaceFound && isValidFace);
    
    logInfo('Face detection result', {
      facesDetected,
      confidence,
      face_found: finalResult,
      isValidFace,
      fallbackUsed: fallbackFaceFound && !face_found
    });
    
    return {
      face_found: finalResult,
      confidence,
      faces_detected: facesDetected,
      face_details: faceDetails
    };
    
  } catch (error) {
    logError('Face detection error', error);
    return { 
      face_found: false, 
      error: error.message 
    };
  }
};

/**
 * Extract face features from image using AWS Rekognition
 * @param {Buffer} imageBuffer - Image buffer to analyze
 * @returns {Promise<Object>} Object with face features
 */
const extractFaceFeatures = async (imageBuffer) => {
  try {
    if (!imageBuffer || imageBuffer.length < 1000) {
      return { features: null, error: 'Image too small' };
    }

    const command = new DetectFacesCommand({
      Image: {
        Bytes: imageBuffer
      },
      Attributes: ['ALL'],
      MaxFaces: 1
    });

    const response = await rekognitionClient.send(command);
    
    if (!response.FaceDetails || response.FaceDetails.length === 0) {
      return { features: null, error: 'No face detected' };
    }
    
    const faceDetails = response.FaceDetails[0];
    
    return {
      features: {
        boundingBox: faceDetails.BoundingBox,
        pose: faceDetails.Pose,
        quality: faceDetails.Quality,
        emotions: faceDetails.Emotions,
        landmarks: faceDetails.Landmarks,
        ageRange: faceDetails.AgeRange,
        gender: faceDetails.Gender,
        confidence: faceDetails.Confidence
      }
    };
    
  } catch (error) {
    logError('Face feature extraction error', error);
    return { 
      features: null, 
      error: error.message 
    };
  }
};

export {
  checkFaceVisibility,
  extractFaceFeatures
};
