/**
 * @file conversation_search.js
 * @description Validation functions for conversation search operations
 */

/**
 * Validate conversation search input
 * @param {Object} input - Search input data
 * @returns {Array} Array of validation errors
 */
const validateConversationSearchInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { search_term, skip, limit } = input;
  
  // Validate search term
  if (!search_term || typeof search_term !== 'string' || search_term.trim().length === 0) {
    errors.push('Search term is required and must be a non-empty string');
  } else if (search_term.length > 100) {
    errors.push('Search term must be less than 100 characters');
  }
  
  // Validate skip parameter
  if (skip !== undefined) {
    const skipNum = parseInt(skip);
    if (isNaN(skipNum) || skipNum < 0) {
      errors.push('Skip must be a non-negative number');
    }
  }
  
  // Validate limit parameter
  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      errors.push('Limit must be a number between 1 and 50');
    }
  }
  
  return errors;
};

/**
 * Validate user ID for conversation search
 * @param {number|string} userId - User ID to validate
 * @returns {Array} Array of validation errors
 */
const validateUserId = (userId) => {
  const errors = [];
  
  if (!userId) {
    errors.push('User ID is required');
  } else if (typeof userId !== 'number' && typeof userId !== 'string') {
    errors.push('User ID must be a number or string');
  } else if (isNaN(parseInt(userId))) {
    errors.push('User ID must be a valid number');
  }
  
  return errors;
};

// Export all functions at the end
export {
  validateConversationSearchInput,
  validateUserId
};