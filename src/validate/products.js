/**
 * @file products.js
 * @description Product validation utilities for the Bingeme API.
 * Contains validation functions for product creation, updating, and input validation.
 */

import { logError } from '../utils/common.js';

/**
 * Validates product input data for create and update operations
 * @param {Object} data - Product data to validate
 * @param {string} data.name - Product name
 * @param {number} data.price - Product price
 * @param {string} data.tags - Product tags (comma-separated)
 * @param {string} data.description - Product description
 * @param {number} [data.delivery_time] - Delivery time in days
 * @param {string} [data.type] - Product type (digital, custom, fixed) - optional for updates
 * @param {string} [data.fileuploader-list-file] - Main file path for digital products
 * @param {string} [data.fileuploader-list-preview] - Preview image path
 * @param {Object} [options={}] - Validation options
 * @param {boolean} [options.isUpdate=false] - Whether this is an update operation
 * @returns {Array<string>} Array of validation error messages
 */
const validateProductInput = (data, options = {}) => {
  const errors = [];
  
  // Destructure product fields for easier access
  const {
    name = '',
    price,
    tags = '',
    description = '',
    delivery_time,
    type,
    ['fileuploader-list-file']: fileListFile,
    ['fileuploader-list-preview']: fileListPreview
  } = data;
  
  const { isUpdate = false } = options;

  try {
    // Name validation - required, must be string between 5-100 characters
    if (typeof name !== 'string' || name.length < 5 || name.length > 100) {
      errors.push('Name must be between 5 and 100 characters.');
    }

    // Price validation - required, must be a valid number
    if (price === undefined || price === null || isNaN(Number(price))) {
      errors.push('Price is required and must be a number.');
    }

    // Tags validation - required, minimum 2 characters
    if (typeof tags !== 'string' || tags.length < 2) {
      errors.push('Tags are required.');
    }

    // Description validation - required, minimum 10 characters
    if (typeof description !== 'string' || description.length < 10) {
      errors.push('Description must be at least 10 characters.');
    }

    // Define digital types for consistent validation
    const digitalTypes = ['digital', 'digital_products'];

    // Delivery time validation for non-digital products
    if (
      type && 
      !digitalTypes.includes(type) &&
      (delivery_time === undefined || 
       delivery_time === null || 
       isNaN(Number(delivery_time)) || 
       delivery_time < 1 || 
       delivery_time > 30)
    ) {
      errors.push('Delivery time must be between 1 and 30 days.');
    }

    // Individual tag validation - each tag must be at least 2 characters
    if (tags) {
      const tagsArray = tags.split(',');
      if (tagsArray.some(tag => tag.trim().length < 2)) {
        errors.push('Each tag must be at least 2 characters.');
      }
    }

    // File validation for digital products - required only on create (only validate if type is provided)
    if (type && digitalTypes.includes(type) && !isUpdate && !fileListFile) {
      errors.push('File is required for digital products.');
    }

    // Preview image validation - required only on create
    if (!isUpdate && !fileListPreview) {
      errors.push('Preview image is required.');
    }

    // S3 path validation for files
    if (fileListFile && typeof fileListFile === 'string' && !fileListFile.startsWith('uploads/shop/')) {
      errors.push('File path must start with uploads/shop/');
    }

    // S3 path validation for previews
    if (fileListPreview && typeof fileListPreview === 'string' && !fileListPreview.startsWith('uploads/shop/')) {
      errors.push('Preview file path must start with uploads/shop/');
    }

  } catch (error) {
    logError('Error during product validation:', error);
    errors.push('Validation error occurred.');
  }

  return errors;
};

/**
 * Validates product ID parameter
 * @param {string|number} productId - Product ID to validate
 * @returns {Object} Validation result with isValid boolean and error message
 */
const validateProductId = (productId) => {
  if (!productId) {
    return {
      isValid: false,
      error: 'Product ID is required.'
    };
  }

  const id = parseInt(productId);
  if (isNaN(id) || id <= 0) {
    return {
      isValid: false,
      error: 'Product ID must be a positive number.'
    };
  }

  return {
    isValid: true,
    error: null
  };
};

export {
  validateProductInput,
  validateProductId
};