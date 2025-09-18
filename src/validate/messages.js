/**
 * @file messages.js
 * @description Validation functions for message operations
 */

/**
 * Validate message input
 * @param {Object} input - Message input data
 * @returns {Array} Array of validation errors
 */
const validateMessageInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { message, to_user_id, media } = input;
  
  // Validate message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    errors.push('Message is required and must be a non-empty string');
  } else if (message.length > 1000) {
    errors.push('Message must be less than 1000 characters');
  }
  
  // Validate to_user_id
  if (!to_user_id) {
    errors.push('Recipient user ID is required');
  } else if (typeof to_user_id !== 'number' && typeof to_user_id !== 'string') {
    errors.push('Recipient user ID must be a number or string');
  } else if (isNaN(parseInt(to_user_id))) {
    errors.push('Recipient user ID must be a valid number');
  }
  
  // Validate media (optional)
  if (media !== undefined) {
    if (!Array.isArray(media)) {
      errors.push('Media must be an array');
    } else if (media.length > 10) {
      errors.push('Maximum 10 media files allowed');
    } else {
      media.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
          errors.push(`Media item ${index + 1} must be an object`);
        } else if (!item.media_path || typeof item.media_path !== 'string') {
          errors.push(`Media item ${index + 1} must have a valid media_path`);
        } else if (!item.media_type || typeof item.media_type !== 'string') {
          errors.push(`Media item ${index + 1} must have a valid media_type`);
        }
      });
    }
  }
  
  return errors;
};

/**
 * Validate message ID
 * @param {number|string} messageId - Message ID to validate
 * @returns {Array} Array of validation errors
 */
const validateMessageId = (messageId) => {
  const errors = [];
  
  if (!messageId) {
    errors.push('Message ID is required');
  } else if (typeof messageId !== 'number' && typeof messageId !== 'string') {
    errors.push('Message ID must be a number or string');
  } else if (isNaN(parseInt(messageId))) {
    errors.push('Message ID must be a valid number');
  }
  
  return errors;
};

/**
 * Validate conversation ID
 * @param {number|string} conversationId - Conversation ID to validate
 * @returns {Array} Array of validation errors
 */
const validateConversationId = (conversationId) => {
  const errors = [];
  
  if (!conversationId) {
    errors.push('Conversation ID is required');
  } else if (typeof conversationId !== 'number' && typeof conversationId !== 'string') {
    errors.push('Conversation ID must be a number or string');
  } else if (isNaN(parseInt(conversationId))) {
    errors.push('Conversation ID must be a valid number');
  }
  
  return errors;
};

/**
 * Validate pagination parameters
 * @param {Object} params - Pagination parameters
 * @returns {Array} Array of validation errors
 */
const validatePaginationParams = (params) => {
  const errors = [];
  
  if (!params || typeof params !== 'object') {
    errors.push('Pagination parameters must be an object');
    return errors;
  }
  
  const { skip, limit } = params;
  
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
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      errors.push('Limit must be a number between 1 and 100');
    }
  }
  
  return errors;
};

/**
 * Validate messages inbox request parameters
 * @param {Object} req - Express request object
 * @returns {Object} Validation result with valid flag, data, and error
 */
const validateMessagesInboxRequest = (req) => {
  try {
    const errors = [];
    const data = {};

    // Extract user info from request (assuming it's added by auth middleware)
    if (!req.user || !req.user.userId) {
      errors.push('User authentication required');
      return { valid: false, error: errors.join(', '), data: {} };
    }

    data.userId = req.user.userId;
    data.username = req.user.username || '';

    // Validate query parameters
    const { skip, limit, search, type } = req.query || {};

    // Validate pagination parameters
    if (skip !== undefined) {
      const skipNum = parseInt(skip);
      if (isNaN(skipNum) || skipNum < 0) {
        errors.push('Skip must be a non-negative number');
      } else {
        data.skip = skipNum;
      }
    } else {
      data.skip = 0;
    }

    if (limit !== undefined) {
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
        errors.push('Limit must be a number between 1 and 100');
      } else {
        data.limit = limitNum;
      }
    } else {
      data.limit = 20;
    }

    // Validate search parameter
    if (search !== undefined) {
      if (typeof search !== 'string') {
        errors.push('Search must be a string');
      } else if (search.length > 100) {
        errors.push('Search term must not exceed 100 characters');
      } else {
        data.search = search.trim();
      }
    }

    // Validate type parameter
    if (type !== undefined) {
      const validTypes = ['all', 'unread', 'read'];
      if (!validTypes.includes(type)) {
        errors.push('Type must be one of: all, unread, read');
      } else {
        data.type = type;
      }
    } else {
      data.type = 'all';
    }

    return {
      valid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
      data: data
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid request format',
      data: {}
    };
  }
};

/**
 * Validate massive message input
 * @param {Object} input - Massive message input data
 * @returns {Array} Array of validation errors
 */
const validateMassiveMessageInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { message, media } = input;
  
  // Validate message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    errors.push('Message is required and must be a non-empty string');
  } else if (message.length > 1000) {
    errors.push('Message must be less than 1000 characters');
  }
  
  // Validate media (optional)
  if (media !== undefined) {
    if (!Array.isArray(media)) {
      errors.push('Media must be an array');
    } else if (media.length > 10) {
      errors.push('Maximum 10 media files allowed');
    } else {
      media.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
          errors.push(`Media item ${index + 1} must be an object`);
        } else if (!item.media_path || typeof item.media_path !== 'string') {
          errors.push(`Media item ${index + 1} must have a valid media_path`);
        } else if (!item.media_type || typeof item.media_type !== 'string') {
          errors.push(`Media item ${index + 1} must have a valid media_type`);
        }
      });
    }
  }
  
  return errors;
};

// Export all functions at the end
export {
  validateMessageInput,
  validateMessageId,
  validateConversationId,
  validatePaginationParams,
  validateMessagesInboxRequest,
  validateMassiveMessageInput
};