/**
 * @file validations.js
 * @description Validation utilities for Bingeme API Express.js
 */

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate mobile phone number format
 * @param {string} mobile - Mobile number to validate
 * @returns {boolean} True if valid mobile format
 */
const validateMobile = (mobile) => {
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
const validatePassword = (password) => {
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
const validateUsername = (username) => {
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
const validateName = (name) => {
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
const validateOTP = (otp) => {
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
const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') return '';
  return input.trim().replace(/[<>]/g, '');
};

/**
 * Validate country code format
 * @param {string} countryCode - Country code to validate
 * @returns {boolean} True if valid country code format
 */
const validateCountryCode = (countryCode) => {
  if (!countryCode || typeof countryCode !== 'string') return false;
  // Country code should start with + and have 1-4 digits
  const countryCodeRegex = /^\+\d{1,4}$/;
  return countryCodeRegex.test(countryCode);
};

/**
 * Validate payload for sending massive/broadcast messages
 * Ensures message text or media is present and recipients list is sane
 * @param {object} body - Express request body
 * @returns {{ isValid: boolean, message?: string }}
 */
const validateMassiveMessageInput = (body) => {
  if (!body || typeof body !== 'object') {
    return { isValid: false, message: 'Invalid request body' };
  }

  const { recipients, message, media, schedule_at } = body;

  // recipients must be non-empty array of ids
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { isValid: false, message: 'Recipients are required' };
  }
  if (recipients.length > 1000) {
    return { isValid: false, message: 'Too many recipients' };
  }
  const invalidRecipient = recipients.some(r => !(typeof r === 'number' || (typeof r === 'string' && r.trim().length > 0)));
  if (invalidRecipient) {
    return { isValid: false, message: 'Invalid recipient identifier' };
  }

  // Must have either message text or media
  const hasMessage = typeof message === 'string' && message.trim().length > 0;
  const hasMedia = Array.isArray(media) && media.length > 0;
  if (!hasMessage && !hasMedia) {
    return { isValid: false, message: 'Message text or media is required' };
  }

  // Optional schedule validation: must be a future ISO date if provided
  if (schedule_at) {
    const date = new Date(schedule_at);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) {
      return { isValid: false, message: 'schedule_at must be a valid future datetime' };
    }
  }

  return { isValid: true };
};

/**
 * Validate message media payload for send/upload endpoints
 * @param {object} body
 * @returns {{ isValid: boolean, message?: string }}
 */
const validateMessageMediaInput = (body) => {
  if (!body || typeof body !== 'object') {
    return { isValid: false, message: 'Invalid request body' };
  }

  // Accept either files info array or single media object
  const { media = [], message } = body;

  const hasMessage = typeof message === 'string' && message.trim().length > 0;
  const hasMediaArray = Array.isArray(media) && media.length > 0;

  if (!hasMessage && !hasMediaArray) {
    return { isValid: false, message: 'Message text or media is required' };
  }

  if (hasMediaArray) {
    // Validate each media item minimally: path/type/size
    const invalid = media.some(m => {
      if (!m) return true;
      const hasPath = typeof m.path === 'string' && m.path.trim().length > 0;
      const hasType = typeof m.type === 'string' && m.type.trim().length > 0;
      const hasSize = typeof m.size === 'number' && m.size >= 0;
      return !(hasPath && hasType && hasSize);
    });
    if (invalid) {
      return { isValid: false, message: 'Invalid media payload' };
    }
  }

  return { isValid: true };
};

/**
 * Validate user settings update request body (parity with Lambda)
 * @param {object} body
 * @returns {{ isValid: boolean, message: string|null }}
 */
const validateUserSettings = (body) => {
  if (!body || typeof body !== 'object') {
    return { isValid: false, message: 'Invalid request body' };
  }
  if (!body.name || typeof body.name !== 'string' || body.name.length < 2) {
    return { isValid: false, message: 'Name must be at least 2 characters long' };
  }
  if (body.email && !validateEmail(body.email)) {
    return { isValid: false, message: 'Invalid email address' };
  }
  if (body.mobile && !validateMobile(body.mobile)) {
    return { isValid: false, message: 'Invalid mobile number' };
  }
  if (body.language && (typeof body.language !== 'string' || body.language.length < 2 || body.language.length > 10)) {
    return { isValid: false, message: 'Language must be a valid language abbreviation (2-10 characters)' };
  }
  return { isValid: true, message: null };
};

/**
 * Validate bank details (plain text) minimum requirements
 * - strips HTML tags
 * - checks minimal length (20 chars)
 */
const validateBankDetails = (bankDetails) => {
  if (!bankDetails || typeof bankDetails !== 'string') {
    return false;
  }
  const sanitized = bankDetails.replace(/<[^>]*>/g, '').trim();
  return sanitized.length >= 20;
};

/**
 * Validate Indian bank payout method data
 * Ensures account number, holder name, bank name, and IFSC code are valid
 */
const validateBankIndiaData = (data) => {
  try {
    const { account_number, holder_name, bank_name, ifsc_code } = data || {};

    if (!account_number) {
      return { isValid: false, message: 'Account number is required' };
    }
    if (!holder_name) {
      return { isValid: false, message: 'Account holder name is required' };
    }
    if (!bank_name) {
      return { isValid: false, message: 'Bank name is required' };
    }
    if (!ifsc_code) {
      return { isValid: false, message: 'IFSC code is required' };
    }

    // Account number: 9-18 digits
    const accountNumberRegex = /^[0-9]{9,18}$/;
    if (!accountNumberRegex.test(String(account_number).trim())) {
      return { isValid: false, message: 'Invalid account number format. Must be 9-18 digits' };
    }

    // Holder name: letters, spaces, dots, hyphens; length 2-50
    const trimmedHolder = String(holder_name).trim();
    if (trimmedHolder.length < 2 || trimmedHolder.length > 50) {
      return { isValid: false, message: 'Account holder name must be 2-50 characters' };
    }
    if (!/^[A-Za-z]+(?:\s[A-Za-z]+)*(?:\.[A-Za-z]+)?(?:\-[A-Za-z]+)?$/.test(trimmedHolder)) {
      return { isValid: false, message: 'Invalid account holder name format' };
    }
    if (/(\s{2,}|\.{2,}|\-{2,})/.test(trimmedHolder)) {
      return { isValid: false, message: 'Account holder name has consecutive special characters' };
    }

    // Bank name: letters, numbers, spaces, dots, hyphens; length 2-100; not only numbers
    const trimmedBank = String(bank_name).trim();
    if (trimmedBank.length < 2 || trimmedBank.length > 100) {
      return { isValid: false, message: 'Bank name must be 2-100 characters' };
    }
    if (!/^[A-Za-z0-9]+(?:\s[A-Za-z0-9]+)*(?:\.[A-Za-z0-9]+)?(?:\-[A-Za-z0-9]+)?$/.test(trimmedBank)) {
      return { isValid: false, message: 'Invalid bank name format' };
    }
    if (/^\d+$/.test(trimmedBank)) {
      return { isValid: false, message: 'Bank name cannot be only numbers' };
    }
    if (/(\s{2,}|\.{2,}|\-{2,})/.test(trimmedBank)) {
      return { isValid: false, message: 'Bank name has consecutive special characters' };
    }

    // IFSC code: 11 chars, first 4 letters, 5th is 0, last 6 alphanumeric
    const trimmedIfsc = String(ifsc_code).trim().toUpperCase();
    if (trimmedIfsc.length !== 11) {
      return { isValid: false, message: 'IFSC code must be exactly 11 characters' };
    }
    if (!/^[A-Z]{4}$/.test(trimmedIfsc.substring(0, 4))) {
      return { isValid: false, message: 'First 4 characters of IFSC must be uppercase letters' };
    }
    if (trimmedIfsc.charAt(4) !== '0') {
      return { isValid: false, message: "5th character of IFSC must be '0'" };
    }
    if (!/^[A-Z0-9]{6}$/.test(trimmedIfsc.substring(5))) {
      return { isValid: false, message: 'Last 6 characters of IFSC must be alphanumeric' };
    }

    return {
      isValid: true,
      data: {
        accountNumber: String(account_number).trim(),
        holderName: trimmedHolder,
        bankName: trimmedBank,
        ifscCode: trimmedIfsc
      }
    };
  } catch (error) {
    return { isValid: false, message: 'Invalid Indian bank data format' };
  }
};

/**
 * Validate PayPal payout method data
 */
const validatePayPalData = (data) => {
  try {
    const { paypal_email } = data || {};
    if (!paypal_email) {
      return { isValid: false, message: 'PayPal email is required' };
    }
    if (!validateEmail(paypal_email)) {
      return { isValid: false, message: 'Invalid PayPal email format' };
    }
    return { isValid: true, data: { paypalEmail: paypal_email.trim() } };
  } catch (error) {
    return { isValid: false, message: 'Invalid PayPal data format' };
  }
};

/**
 * Validate UPI ID primitive
 */
const validateUpiId = (upiId) => {
  if (!upiId || typeof upiId !== 'string') return false;
  const UPI_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z]{3,}$/;
  return UPI_REGEX.test(upiId.trim());
};

/**
 * Validate UPI payout payload
 */
const validateUpiData = (data) => {
  try {
    const { upi_id } = data || {};
    if (!upi_id) {
      return { isValid: false, message: 'UPI ID is required' };
    }
    if (!validateUpiId(upi_id)) {
      return { isValid: false, message: 'Invalid UPI ID format. Use format: name@bank' };
    }
    return { isValid: true, data: { upiId: upi_id.trim() } };
  } catch (error) {
    return { isValid: false, message: 'Invalid UPI data format' };
  }
};

// Export all functions at the end
export {
  validateEmail,
  validateMobile,
  validatePassword,
  validateUsername,
  validateName,
  validateOTP,
  sanitizeInput,
  validateCountryCode,
  validateMassiveMessageInput,
  validateMessageMediaInput,
  validateUserSettings,
  validateBankDetails,
  validateBankIndiaData,
  validatePayPalData,
  validateUpiId,
  validateUpiData
};