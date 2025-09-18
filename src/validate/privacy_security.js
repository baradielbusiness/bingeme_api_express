/**
 * Validate privacy settings input
 */
const validatePrivacySettings = (privacySettings) => {
  const errors = [];
  
  if (!privacySettings || typeof privacySettings !== 'object') {
    errors.push('Privacy settings must be an object');
    return { isValid: false, errors };
  }
  
  const validKeys = ['profile_visibility', 'contact_visibility', 'post_visibility', 'message_privacy'];
  
  for (const key of validKeys) {
    if (privacySettings[key] !== undefined) {
      if (typeof privacySettings[key] !== 'string') {
        errors.push(`${key} must be a string`);
      } else if (!['public', 'private', 'friends'].includes(privacySettings[key])) {
        errors.push(`${key} must be one of: public, private, friends`);
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate security settings input
 */
const validateSecuritySettings = (securitySettings) => {
  const errors = [];
  
  if (!securitySettings || typeof securitySettings !== 'object') {
    errors.push('Security settings must be an object');
    return { isValid: false, errors };
  }
  
  const validKeys = ['two_factor_enabled', 'login_notifications', 'session_timeout'];
  
  for (const key of validKeys) {
    if (securitySettings[key] !== undefined) {
      if (key === 'two_factor_enabled' || key === 'login_notifications') {
        if (typeof securitySettings[key] !== 'boolean') {
          errors.push(`${key} must be a boolean`);
        }
      } else if (key === 'session_timeout') {
        if (typeof securitySettings[key] !== 'number' || securitySettings[key] < 0) {
          errors.push(`${key} must be a positive number`);
        }
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate account deletion request
 */
const validateAccountDeletionRequest = (requestData) => {
  const errors = [];
  
  if (!requestData || typeof requestData !== 'object') {
    errors.push('Request data must be an object');
    return { isValid: false, errors };
  }
  
  const { reason, password, otp } = requestData;
  
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    errors.push('Reason is required and must be a non-empty string');
  }
  
  if (!password || typeof password !== 'string' || password.length < 6) {
    errors.push('Password is required and must be at least 6 characters');
  }
  
  if (!otp || typeof otp !== 'string' || otp.length !== 6) {
    errors.push('OTP is required and must be 6 digits');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate account deletion OTP verify request (only OTP field)
 */
const validateAccountDeletionOTPRequest = (requestData) => {
  const errors = [];
  if (!requestData || typeof requestData !== 'object') {
    errors.push('Request data must be an object');
    return { isValid: false, errors };
  }
  const { otp } = requestData;
  if (!otp || typeof otp !== 'string' || /^\d{6}$/.test(otp) === false) {
    errors.push('OTP is required and must be 6 digits');
  }
  return { isValid: errors.length === 0, errors };
};

/**
 * Validate combined privacy and security update request
 */
const validatePrivacySecurityUpdateRequest = (requestData) => {
  const errors = [];
  if (!requestData || typeof requestData !== 'object') {
    return { isValid: false, errors: ['Request data must be an object'] };
  }
  const { privacy_settings, security_settings } = requestData;
  if (privacy_settings !== undefined) {
    const r = validatePrivacySettings(privacy_settings);
    if (!r.isValid) errors.push(...r.errors.map(e => `privacy: ${e}`));
  }
  if (security_settings !== undefined) {
    const r = validateSecuritySettings(security_settings);
    if (!r.isValid) errors.push(...r.errors.map(e => `security: ${e}`));
  }
  if (privacy_settings === undefined && security_settings === undefined) {
    errors.push('At least one of privacy_settings or security_settings must be provided');
  }
  return { isValid: errors.length === 0, errors };
};

// Export all functions at the end
export {
  validatePrivacySettings,
  validateSecuritySettings,
  validateAccountDeletionRequest,
  validateAccountDeletionOTPRequest,
  validatePrivacySecurityUpdateRequest
};