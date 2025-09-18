/**
 * @file profile.js
 * @description Validation functions for profile operations
 */

/**
 * Validate profile update input
 * @param {Object} input - Profile update input data
 * @returns {Array} Array of validation errors
 */
/**
 * Validate profile request
 * @param {Object} req - Express request object
 * @returns {Object} Validation result with valid flag, data, and error
 */
const validateProfileRequest = (req) => {
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
    const { skip, limit, type } = req.query || {};

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

    // Validate type parameter
    if (type !== undefined) {
      const validTypes = ['all', 'posts', 'updates', 'live'];
      if (!validTypes.includes(type)) {
        errors.push('Type must be one of: all, posts, updates, live');
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

const validateProfileUpdateInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { 
    name, 
    username, 
    email, 
    mobile, 
    story, 
    website, 
    gender, 
    birthdate, 
    address, 
    city, 
    state_id, 
    zip, 
    countries_id 
  } = input;
  
  // Validate name
  if (name !== undefined) {
    if (typeof name !== 'string') {
      errors.push('Name must be a string');
    } else if (name.length > 100) {
      errors.push('Name must be less than 100 characters');
    }
  }
  
  // Validate username
  if (username !== undefined) {
    if (typeof username !== 'string') {
      errors.push('Username must be a string');
    } else if (username.length < 3) {
      errors.push('Username must be at least 3 characters');
    } else if (username.length > 30) {
      errors.push('Username must be less than 30 characters');
    } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      errors.push('Username can only contain letters, numbers, and underscores');
    }
  }
  
  // Validate email
  if (email !== undefined) {
    if (typeof email !== 'string') {
      errors.push('Email must be a string');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Email must be a valid email address');
    } else if (email.length > 255) {
      errors.push('Email must be less than 255 characters');
    }
  }
  
  // Validate mobile
  if (mobile !== undefined) {
    if (typeof mobile !== 'string') {
      errors.push('Mobile must be a string');
    } else if (!/^\+?[1-9]\d{1,14}$/.test(mobile)) {
      errors.push('Mobile must be a valid phone number');
    }
  }
  
  // Validate story
  if (story !== undefined) {
    if (typeof story !== 'string') {
      errors.push('story must be a string');
    } else if (story.length > 500) {
      errors.push('story must be less than 500 characters');
    }
  }
  
  // Validate website
  if (website !== undefined) {
    if (typeof website !== 'string') {
      errors.push('Website must be a string');
    } else if (website.length > 255) {
      errors.push('Website must be less than 255 characters');
    } else if (website && !/^https?:\/\/.+/.test(website)) {
      errors.push('Website must be a valid URL starting with http:// or https://');
    }
  }
  
  // Validate gender
  if (gender !== undefined) {
    const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
    if (!validGenders.includes(gender)) {
      errors.push(`Gender must be one of: ${validGenders.join(', ')}`);
    }
  }
  
  // Validate birthdate
  if (birthdate !== undefined) {
    if (typeof birthdate !== 'string') {
      errors.push('Birthdate must be a string');
    } else {
      const date = new Date(birthdate);
      if (isNaN(date.getTime())) {
        errors.push('Birthdate must be a valid date');
      } else if (date > new Date()) {
        errors.push('Birthdate cannot be in the future');
      } else if (date < new Date('1900-01-01')) {
        errors.push('Birthdate cannot be before 1900');
      }
    }
  }
  
  // Validate address
  if (address !== undefined) {
    if (typeof address !== 'string') {
      errors.push('Address must be a string');
    } else if (address.length > 255) {
      errors.push('Address must be less than 255 characters');
    }
  }
  
  // Validate city
  if (city !== undefined) {
    if (typeof city !== 'string') {
      errors.push('City must be a string');
    } else if (city.length > 100) {
      errors.push('City must be less than 100 characters');
    }
  }
  
  // Validate state_id
  if (state_id !== undefined) {
    const stateIdNum = parseInt(state_id);
    if (isNaN(stateIdNum) || stateIdNum < 1) {
      errors.push('State ID must be a positive number');
    }
  }
  
  // Validate zip
  if (zip !== undefined) {
    if (typeof zip !== 'string') {
      errors.push('Zip code must be a string');
    } else if (zip.length > 20) {
      errors.push('Zip code must be less than 20 characters');
    }
  }
  
  // Validate countries_id
  if (countries_id !== undefined) {
    const countryIdNum = parseInt(countries_id);
    if (isNaN(countryIdNum) || countryIdNum < 1) {
      errors.push('Country ID must be a positive number');
    }
  }
  
  return errors;
};

/**
 * Validate profile image upload input
 * @param {Object} input - Profile image upload input data
 * @returns {Array} Array of validation errors
 */
const validateProfileImageUploadInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { image_type } = input;
  
  // Validate image_type
  if (!image_type || typeof image_type !== 'string') {
    errors.push('Image type is required and must be a string');
  } else {
    const validTypes = ['avatar', 'cover'];
    if (!validTypes.includes(image_type)) {
      errors.push(`Image type must be one of: ${validTypes.join(', ')}`);
    }
  }
  
  return errors;
};

/**
 * Validate profile settings input
 * @param {Object} input - Profile settings input data
 * @returns {Array} Array of validation errors
 */
const validateProfileSettingsInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { 
    hide_name, 
    disable_watermark, 
    profile_visibility, 
    contact_visibility, 
    post_visibility 
  } = input;
  
  // Validate hide_name
  if (hide_name !== undefined) {
    if (typeof hide_name !== 'boolean') {
      errors.push('Hide name must be a boolean');
    }
  }
  
  // Validate disable_watermark
  if (disable_watermark !== undefined) {
    if (typeof disable_watermark !== 'boolean') {
      errors.push('Disable watermark must be a boolean');
    }
  }
  
  // Validate profile_visibility
  if (profile_visibility !== undefined) {
    const validVisibilities = ['public', 'private', 'friends'];
    if (!validVisibilities.includes(profile_visibility)) {
      errors.push(`Profile visibility must be one of: ${validVisibilities.join(', ')}`);
    }
  }
  
  // Validate contact_visibility
  if (contact_visibility !== undefined) {
    const validVisibilities = ['public', 'private', 'friends'];
    if (!validVisibilities.includes(contact_visibility)) {
      errors.push(`Contact visibility must be one of: ${validVisibilities.join(', ')}`);
    }
  }
  
  // Validate post_visibility
  if (post_visibility !== undefined) {
    const validVisibilities = ['public', 'private', 'friends'];
    if (!validVisibilities.includes(post_visibility)) {
      errors.push(`Post visibility must be one of: ${validVisibilities.join(', ')}`);
    }
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

/**
 * Validate username
 * @param {string} username - Username to validate
 * @returns {Array} Array of validation errors
 */
const validateUsername = (username) => {
  const errors = [];
  
  if (!username || typeof username !== 'string') {
    errors.push('Username is required and must be a string');
  } else if (username.length < 3) {
    errors.push('Username must be at least 3 characters');
  } else if (username.length > 30) {
    errors.push('Username must be less than 30 characters');
  } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errors.push('Username can only contain letters, numbers, and underscores');
  }
  
  return errors;
};

// Export all functions at the end
export {
  validateProfileRequest,
  validateProfileUpdateInput,
  validateProfileImageUploadInput,
  validateProfileSettingsInput,
  validateUserId,
  validateUsername
};