/**
 * @file imageOptimizer.js
 * @description Image optimization utilities for creator agreements
 * @author Bingeme API Team
 */

import sharp from 'sharp';
import { logInfo, logError } from './common.js';

/**
 * Optimize creator photo to WebP format with 80% quality
 * @param {Buffer} imageBuffer - Original image buffer
 * @returns {Promise<Buffer>} Optimized WebP buffer
 */
const optimizeCreatorPhoto = async (imageBuffer) => {
  try {
    const optimizedBuffer = await sharp(imageBuffer)
      .webp({ 
        quality: 80,
        effort: 4,
        nearLossless: false,
        smartSubsample: true
      })
      .toBuffer();

    return optimizedBuffer;

  } catch (error) {
    logError('Creator photo optimization failed', { 
      error: error.message, 
      stack: error.stack 
    });
    throw new Error(`Image optimization failed: ${error.message}`);
  }
};

/**
 * Optimize signature image to PNG format
 * @param {Buffer} imageBuffer - Original signature buffer
 * @returns {Promise<Buffer>} Optimized PNG buffer
 */
const optimizeSignature = async (imageBuffer) => {
  try {
    const optimizedBuffer = await sharp(imageBuffer)
      .png({
        compressionLevel: 6,
        adaptiveFiltering: true,
        palette: false
      })
      .toBuffer();

    return optimizedBuffer;

  } catch (error) {
    logError('Signature optimization failed', { 
      error: error.message, 
      stack: error.stack 
    });
    throw new Error(`Signature optimization failed: ${error.message}`);
  }
};

/**
 * Resize and optimize image for profile pictures
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {number} width - Target width
 * @param {number} height - Target height
 * @returns {Promise<Buffer>} Optimized image buffer
 */
const optimizeProfileImage = async (imageBuffer, width = 300, height = 300) => {
  try {
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ 
        quality: 85,
        effort: 4
      })
      .toBuffer();

    return optimizedBuffer;

  } catch (error) {
    logError('Profile image optimization failed', { 
      error: error.message, 
      stack: error.stack 
    });
    throw new Error(`Profile image optimization failed: ${error.message}`);
  }
};

/**
 * Optimize image for posts and messages
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @returns {Promise<Buffer>} Optimized image buffer
 */
const optimizePostImage = async (imageBuffer, maxWidth = 1200, maxHeight = 1200) => {
  try {
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ 
        quality: 80,
        effort: 4
      })
      .toBuffer();

    return optimizedBuffer;

  } catch (error) {
    logError('Post image optimization failed', { 
      error: error.message, 
      stack: error.stack 
    });
    throw new Error(`Post image optimization failed: ${error.message}`);
  }
};

/**
 * Get image metadata
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<Object>} Image metadata
 */
const getImageMetadata = async (imageBuffer) => {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: imageBuffer.length,
      hasAlpha: metadata.hasAlpha,
      density: metadata.density,
      space: metadata.space
    };
  } catch (error) {
    logError('Failed to get image metadata', { 
      error: error.message 
    });
    return null;
  }
};

/**
 * Convert image to WebP format
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {number} quality - WebP quality (1-100)
 * @returns {Promise<Buffer>} WebP buffer
 */
const convertToWebP = async (imageBuffer, quality = 80) => {
  try {
    const webpBuffer = await sharp(imageBuffer)
      .webp({ 
        quality,
        effort: 4
      })
      .toBuffer();

    return webpBuffer;

  } catch (error) {
    logError('WebP conversion failed', { 
      error: error.message 
    });
    throw new Error(`WebP conversion failed: ${error.message}`);
  }
};

/**
 * Create thumbnail from image
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {number} size - Thumbnail size (square)
 * @returns {Promise<Buffer>} Thumbnail buffer
 */
const createThumbnail = async (imageBuffer, size = 150) => {
  try {
    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(size, size, {
        fit: 'cover',
        position: 'center'
      })
      .webp({ 
        quality: 75,
        effort: 3
      })
      .toBuffer();

    return thumbnailBuffer;

  } catch (error) {
    logError('Thumbnail creation failed', { 
      error: error.message 
    });
    throw new Error(`Thumbnail creation failed: ${error.message}`);
  }
};

export {
  optimizeCreatorPhoto,
  optimizeSignature,
  optimizeProfileImage,
  optimizePostImage,
  getImageMetadata,
  convertToWebP,
  createThumbnail
};
