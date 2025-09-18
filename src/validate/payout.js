/**
 * @file payout.js
 * @description Validation functions for payout operations
 */

/**
 * Validate payout conversation input
 * @param {Object} input - Payout conversation input data
 * @returns {Array} Array of validation errors
 */
const validatePayoutConversationInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { message, payout_image_keys } = input;
  
  // Validate message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    errors.push('Message is required and must be a non-empty string');
  } else if (message.length > 255) {
    errors.push('Message must be less than 255 characters');
  }
  
  // Validate payout_image_keys (optional)
  if (payout_image_keys !== undefined) {
    if (!Array.isArray(payout_image_keys)) {
      errors.push('Payout image keys must be an array');
    } else if (payout_image_keys.length > 5) {
      errors.push('Maximum 5 payout images allowed');
    } else {
      payout_image_keys.forEach((key, index) => {
        if (!key || typeof key !== 'string') {
          errors.push(`Payout image key ${index + 1} must be a non-empty string`);
        }
      });
    }
  }
  
  return errors;
};

/**
 * Validate payout upload input
 * @param {Object} input - Payout upload input data
 * @returns {Array} Array of validation errors
 */
const validatePayoutUploadInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { file_names } = input;
  
  // Validate file_names
  if (!file_names || !Array.isArray(file_names)) {
    errors.push('File names must be an array');
  } else if (file_names.length === 0) {
    errors.push('At least one file name is required');
  } else if (file_names.length > 5) {
    errors.push('Maximum 5 files allowed');
  } else {
    file_names.forEach((fileName, index) => {
      if (!fileName || typeof fileName !== 'string') {
        errors.push(`File name ${index + 1} must be a non-empty string`);
      } else if (fileName.length > 255) {
        errors.push(`File name ${index + 1} must be less than 255 characters`);
      }
    });
  }
  
  return errors;
};

/**
 * Validate payout ID
 * @param {number|string} payoutId - Payout ID to validate
 * @returns {Array} Array of validation errors
 */
const validatePayoutId = (payoutId) => {
  const errors = [];
  
  if (!payoutId) {
    errors.push('Payout ID is required');
  } else if (typeof payoutId !== 'number' && typeof payoutId !== 'string') {
    errors.push('Payout ID must be a number or string');
  } else if (isNaN(parseInt(payoutId))) {
    errors.push('Payout ID must be a valid number');
  }
  
  return errors;
};

/**
 * Validate payout status update input
 * @param {Object} input - Payout status update input data
 * @returns {Array} Array of validation errors
 */
const validatePayoutStatusUpdateInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { status, admin_notes } = input;
  
  // Validate status
  if (!status || typeof status !== 'string') {
    errors.push('Status is required and must be a string');
  } else {
    const validStatuses = ['pending', 'approved', 'rejected', 'processing', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      errors.push(`Status must be one of: ${validStatuses.join(', ')}`);
    }
  }
  
  // Validate admin_notes (optional)
  if (admin_notes !== undefined) {
    if (typeof admin_notes !== 'string') {
      errors.push('Admin notes must be a string');
    } else if (admin_notes.length > 1000) {
      errors.push('Admin notes must be less than 1000 characters');
    }
  }
  
  return errors;
};

/**
 * Validate payout amount
 * @param {number|string} amount - Payout amount to validate
 * @returns {Array} Array of validation errors
 */
const validatePayoutAmount = (amount) => {
  const errors = [];
  
  if (amount === undefined || amount === null) {
    errors.push('Payout amount is required');
  } else {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum)) {
      errors.push('Payout amount must be a valid number');
    } else if (amountNum <= 0) {
      errors.push('Payout amount must be greater than 0');
    } else if (amountNum > 1000000) {
      errors.push('Payout amount must be less than 1,000,000');
    }
  }
  
  return errors;
};

/**
 * Validate payout method
 * @param {string} method - Payout method to validate
 * @returns {Array} Array of validation errors
 */
const validatePayoutMethod = (method) => {
  const errors = [];
  
  if (!method || typeof method !== 'string') {
    errors.push('Payout method is required and must be a string');
  } else {
    const validMethods = ['bank_transfer', 'paypal', 'stripe', 'crypto', 'check'];
    if (!validMethods.includes(method)) {
      errors.push(`Payout method must be one of: ${validMethods.join(', ')}`);
    }
  }
  
  return errors;
};

// Export all functions at the end
export {
  validatePayoutConversationInput,
  validatePayoutUploadInput,
  validatePayoutId,
  validatePayoutStatusUpdateInput,
  validatePayoutAmount,
  validatePayoutMethod
};