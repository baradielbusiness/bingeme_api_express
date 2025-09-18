/**
 * @file verification.js
 * @description Validation functions for verification operations
 */

/**
 * Validate verification request input
 * @param {Object} input - Verification request input data
 * @returns {Array} Array of validation errors
 */
/**
 * Validate verification files
 * @param {Object} files - Files object from multer
 * @returns {Object} Validation result with valid flag, data, and error
 */
const validateVerificationFiles = (files) => {
  try {
    const errors = [];
    const data = {};

    if (!files || Object.keys(files).length === 0) {
      errors.push('No files provided');
      return { valid: false, error: errors.join(', '), data: {} };
    }

    // Check for required files
    const requiredFiles = ['front_id', 'back_id'];
    const optionalFiles = ['selfie', 'additional_document'];

    for (const fileType of requiredFiles) {
      if (!files[fileType] || files[fileType].length === 0) {
        errors.push(`${fileType} is required`);
      } else {
        data[fileType] = files[fileType];
      }
    }

    // Check optional files
    for (const fileType of optionalFiles) {
      if (files[fileType] && files[fileType].length > 0) {
        data[fileType] = files[fileType];
      }
    }

    // Validate file types and sizes
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    for (const [fileType, fileArray] of Object.entries(data)) {
      if (Array.isArray(fileArray)) {
        for (const file of fileArray) {
          if (!allowedTypes.includes(file.mimetype)) {
            errors.push(`${fileType} must be a valid image or PDF file`);
          }
          if (file.size > maxSize) {
            errors.push(`${fileType} file size must not exceed 5MB`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      error: errors.length > 0 ? errors.join(', ') : null,
      data: data
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid file format',
      data: {}
    };
  }
};

/**
 * Validate verification request
 * @param {Object} req - Express request object
 * @returns {Object} Validation result with valid flag, data, and error
 */
const validateVerificationRequest = (req) => {
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
    const { skip, limit, status, type } = req.query || {};

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

    // Validate status parameter
    if (status !== undefined) {
      const validStatuses = ['pending', 'approved', 'rejected', 'all'];
      if (!validStatuses.includes(status)) {
        errors.push('Status must be one of: pending, approved, rejected, all');
      } else {
        data.status = status;
      }
    } else {
      data.status = 'all';
    }

    // Validate type parameter
    if (type !== undefined) {
      const validTypes = ['id_verification', 'address_verification', 'all'];
      if (!validTypes.includes(type)) {
        errors.push('Type must be one of: id_verification, address_verification, all');
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

const validateVerificationRequestInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const {
    verification_type,
    full_name,
    username,
    email,
    mobile,
    address,
    city,
    state_id,
    zip,
    countries_id,
    gender,
    birthdate,
    profession,
    company
  } = input;
  
  // Validate verification_type
  if (!verification_type || typeof verification_type !== 'string') {
    errors.push('Verification type is required and must be a string');
  } else {
    const validTypes = ['individual', 'business', 'creator', 'influencer'];
    if (!validTypes.includes(verification_type)) {
      errors.push(`Verification type must be one of: ${validTypes.join(', ')}`);
    }
  }
  
  // Validate full_name
  if (!full_name || typeof full_name !== 'string' || full_name.trim().length === 0) {
    errors.push('Full name is required and must be a non-empty string');
  } else if (full_name.length > 100) {
    errors.push('Full name must be less than 100 characters');
  }
  
  // Validate username
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    errors.push('Username is required and must be a non-empty string');
  } else if (username.length < 3) {
    errors.push('Username must be at least 3 characters');
  } else if (username.length > 30) {
    errors.push('Username must be less than 30 characters');
  } else if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    errors.push('Username can only contain letters, numbers, and underscores');
  }
  
  // Validate email
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    errors.push('Email is required and must be a non-empty string');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Email must be a valid email address');
  } else if (email.length > 255) {
    errors.push('Email must be less than 255 characters');
  }
  
  // Validate mobile
  if (!mobile || typeof mobile !== 'string' || mobile.trim().length === 0) {
    errors.push('Mobile number is required and must be a non-empty string');
  } else if (!/^\+?[1-9]\d{1,14}$/.test(mobile)) {
    errors.push('Mobile must be a valid phone number');
  }
  
  // Validate address
  if (!address || typeof address !== 'string' || address.trim().length === 0) {
    errors.push('Address is required and must be a non-empty string');
  } else if (address.length > 255) {
    errors.push('Address must be less than 255 characters');
  }
  
  // Validate city
  if (!city || typeof city !== 'string' || city.trim().length === 0) {
    errors.push('City is required and must be a non-empty string');
  } else if (city.length > 100) {
    errors.push('City must be less than 100 characters');
  }
  
  // Validate state_id
  if (!state_id) {
    errors.push('State ID is required');
  } else {
    const stateIdNum = parseInt(state_id);
    if (isNaN(stateIdNum) || stateIdNum < 1) {
      errors.push('State ID must be a positive number');
    }
  }
  
  // Validate zip
  if (!zip || typeof zip !== 'string' || zip.trim().length === 0) {
    errors.push('Zip code is required and must be a non-empty string');
  } else if (zip.length > 20) {
    errors.push('Zip code must be less than 20 characters');
  }
  
  // Validate countries_id
  if (!countries_id) {
    errors.push('Country ID is required');
  } else {
    const countryIdNum = parseInt(countries_id);
    if (isNaN(countryIdNum) || countryIdNum < 1) {
      errors.push('Country ID must be a positive number');
    }
  }
  
  // Validate gender
  if (!gender || typeof gender !== 'string') {
    errors.push('Gender is required and must be a string');
  } else {
    const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
    if (!validGenders.includes(gender)) {
      errors.push(`Gender must be one of: ${validGenders.join(', ')}`);
    }
  }
  
  // Validate birthdate
  if (!birthdate || typeof birthdate !== 'string') {
    errors.push('Birthdate is required and must be a string');
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
  
  // Validate profession (optional)
  if (profession !== undefined) {
    if (typeof profession !== 'string') {
      errors.push('Profession must be a string');
    } else if (profession.length > 100) {
      errors.push('Profession must be less than 100 characters');
    }
  }
  
  // Validate company (optional)
  if (company !== undefined) {
    if (typeof company !== 'string') {
      errors.push('Company must be a string');
    } else if (company.length > 100) {
      errors.push('Company must be less than 100 characters');
    }
  }
  
  return errors;
};

/**
 * Validate verification conversation input
 * @param {Object} input - Verification conversation input data
 * @returns {Array} Array of validation errors
 */
const validateVerificationConversationInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { message, image } = input;
  
  // Validate message
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    errors.push('Message is required and must be a non-empty string');
  } else if (message.length > 1000) {
    errors.push('Message must be less than 1000 characters');
  }
  
  // Validate image (optional)
  if (image !== undefined) {
    if (typeof image !== 'string') {
      errors.push('Image must be a string');
    } else if (image.length > 255) {
      errors.push('Image path must be less than 255 characters');
    }
  }
  
  return errors;
};

/**
 * Validate verification upload input
 * @param {Object} input - Verification upload input data
 * @returns {Array} Array of validation errors
 */
const validateVerificationUploadInput = (input) => {
  const errors = [];
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { file_names, document_type } = input;
  
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
  
  // Validate document_type
  if (!document_type || typeof document_type !== 'string') {
    errors.push('Document type is required and must be a string');
  } else {
    const validTypes = ['id_card', 'passport', 'driver_license', 'utility_bill', 'bank_statement', 'other'];
    if (!validTypes.includes(document_type)) {
      errors.push(`Document type must be one of: ${validTypes.join(', ')}`);
    }
  }
  
  return errors;
};

/**
 * Validate verification request ID
 * @param {number|string} requestId - Verification request ID to validate
 * @returns {Array} Array of validation errors
 */
const validateVerificationRequestId = (requestId) => {
  const errors = [];
  
  if (!requestId) {
    errors.push('Verification request ID is required');
  } else if (typeof requestId !== 'number' && typeof requestId !== 'string') {
    errors.push('Verification request ID must be a number or string');
  } else if (isNaN(parseInt(requestId))) {
    errors.push('Verification request ID must be a valid number');
  }
  
  return errors;
};

/**
 * Validate verification status update input
 * @param {Object} input - Verification status update input data
 * @returns {Array} Array of validation errors
 */
const validateVerificationStatusUpdateInput = (input) => {
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
    const validStatuses = ['pending', 'approved', 'rejected', 'under_review'];
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
  validateVerificationFiles,
  validateVerificationRequest,
  validateVerificationRequestInput,
  validateVerificationConversationInput,
  validateVerificationUploadInput,
  validateVerificationRequestId,
  validateVerificationStatusUpdateInput,
  validateUserId
};