/**
 * @file send_message.js
 * @description Validation functions for send message operations
 */

/**
 * Validate send message input
 * @param {Object} input - Send message input data
 * @returns {Array} Array of validation errors
 */
const validateSendMessageInput = (input) => {
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
        } else {
          const { media_path, media_type, media_size } = item;
          
          if (!media_path || typeof media_path !== 'string') {
            errors.push(`Media item ${index + 1} must have a valid media_path`);
          }
          
          if (!media_type || typeof media_type !== 'string') {
            errors.push(`Media item ${index + 1} must have a valid media_type`);
          }
          
          if (media_size !== undefined) {
            const sizeNum = parseInt(media_size);
            if (isNaN(sizeNum) || sizeNum < 0) {
              errors.push(`Media item ${index + 1} must have a valid media_size`);
            }
          }
        }
      });
    }
  }
  
  return errors;
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
        } else {
          const { media_path, media_type, media_size } = item;
          
          if (!media_path || typeof media_path !== 'string') {
            errors.push(`Media item ${index + 1} must have a valid media_path`);
          }
          
          if (!media_type || typeof media_type !== 'string') {
            errors.push(`Media item ${index + 1} must have a valid media_type`);
          }
          
          if (media_size !== undefined) {
            const sizeNum = parseInt(media_size);
            if (isNaN(sizeNum) || sizeNum < 0) {
              errors.push(`Media item ${index + 1} must have a valid media_size`);
            }
          }
        }
      });
    }
  }
  
  return errors;
};

/**
 * Validate message upload input
 * @param {Object} input - Message upload input data
 * @returns {Array} Array of validation errors
 */
const validateMessageUploadInput = (input) => {
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
  } else if (file_names.length > 10) {
    errors.push('Maximum 10 files allowed');
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
 * Validate user ID
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
  validateSendMessageInput,
  validateMassiveMessageInput,
  validateMessageUploadInput,
  validateMessageId,
  validateConversationId,
  validateUserId
};