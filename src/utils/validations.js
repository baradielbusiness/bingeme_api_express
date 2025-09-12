/**
 * @file validations.js
 * @description Validation utilities for Bingeme API Express.js
 */

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
export const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate mobile phone number format
 * @param {string} mobile - Mobile number to validate
 * @returns {boolean} True if valid mobile format
 */
export const validateMobile = (mobile) => {
  if (!mobile || typeof mobile !== 'string') return false;
  // Remove all non-digit characters
  const cleanMobile = mobile.replace(/\D/g, '');
  // Check if it's between 6 and 15 digits
  return cleanMobile.length >= 6 && cleanMobile.length <= 15;
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} Validation result with isValid and message
 */
export const validatePassword = (password) => {
  if (!password || typeof password !== 'string') {
    return { isValid: false, message: 'Password is required' };
  }
  
  if (password.length < 6) {
    return { isValid: false, message: 'Password must be at least 6 characters long' };
  }
  
  if (password.length > 128) {
    return { isValid: false, message: 'Password must be less than 128 characters' };
  }
  
  return { isValid: true, message: 'Password is valid' };
};

/**
 * Validate username format
 * @param {string} username - Username to validate
 * @returns {object} Validation result with isValid and message
 */
export const validateUsername = (username) => {
  if (!username || typeof username !== 'string') {
    return { isValid: false, message: 'Username is required' };
  }
  
  if (username.length < 3) {
    return { isValid: false, message: 'Username must be at least 3 characters long' };
  }
  
  if (username.length > 30) {
    return { isValid: false, message: 'Username must be less than 30 characters' };
  }
  
  // Username can contain letters, numbers, underscores, and hyphens
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(username)) {
    return { isValid: false, message: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  
  return { isValid: true, message: 'Username is valid' };
};

/**
 * Validate name format
 * @param {string} name - Name to validate
 * @returns {object} Validation result with isValid and message
 */
export const validateName = (name) => {
  if (!name || typeof name !== 'string') {
    return { isValid: false, message: 'Name is required' };
  }
  
  const trimmedName = name.trim();
  if (trimmedName.length < 2) {
    return { isValid: false, message: 'Name must be at least 2 characters long' };
  }
  
  if (trimmedName.length > 100) {
    return { isValid: false, message: 'Name must be less than 100 characters' };
  }
  
  // Name can contain letters, spaces, hyphens, and apostrophes
  const nameRegex = /^[a-zA-Z\s\-']+$/;
  if (!nameRegex.test(trimmedName)) {
    return { isValid: false, message: 'Name can only contain letters, spaces, hyphens, and apostrophes' };
  }
  
  return { isValid: true, message: 'Name is valid' };
};

/**
 * Validate OTP format
 * @param {string} otp - OTP to validate
 * @returns {boolean} True if valid OTP format
 */
export const validateOTP = (otp) => {
  if (!otp || typeof otp !== 'string') return false;
  // OTP should be 4-6 digits
  const otpRegex = /^\d{4,6}$/;
  return otpRegex.test(otp);
};

/**
 * Sanitize input string
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized string
 */
export const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '');
};

/**
 * Validate country code format
 * @param {string} countryCode - Country code to validate
 * @returns {boolean} True if valid country code format
 */
export const validateCountryCode = (countryCode) => {
  if (!countryCode || typeof countryCode !== 'string') return false;
  // Country code should start with + and have 1-4 digits
  const countryCodeRegex = /^\+\d{1,4}$/;
  return countryCodeRegex.test(countryCode);
};
