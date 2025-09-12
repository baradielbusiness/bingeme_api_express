/**
 * Validate privacy settings input
 */
export const validatePrivacySettings = (privacySettings) => {
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
export const validateSecuritySettings = (securitySettings) => {
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
export const validateAccountDeletionRequest = (requestData) => {
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
