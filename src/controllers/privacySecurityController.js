/**
 * @file privacySecurityController.js
 * @description Privacy and Security controller for Bingeme API Express.js
 * Handles privacy/security settings, account deletion, and session management
 */

import { 
  logInfo, 
  logError, 
  createErrorResponse, 
  createSuccessResponse, 
  getAuthenticatedUserId,
  getUserById,
  createExpressSuccessResponse,
  createExpressErrorResponse
} from '../utils/common.js';
import { 
  fetchPrivacySecurityDetails, 
  updatePrivacySecurityDetails, 
  generateAccountDeletionOTP, 
  verifyAccountDeletionOTP, 
  softDeleteUserAccount, 
  getAccountRetrieveInfo, 
  reactivateUserAccount,
  clearUserSessions
} from '../utils/privacy_security.js';
import { 
  validatePrivacySecurityUpdateRequest, 
  validateAccountDeletionRequest, 
  validateAccountDeletionOTPRequest 
} from '../validate/privacy_security.js';

/**
 * Get privacy and security settings for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getPrivacySecurity = async (req, res) => {
  try {
    const userId = req.userId;

    // Fetch privacy/security details using the DB utility function
    const privacyData = await fetchPrivacySecurityDetails(userId);
    if (!privacyData) {
      logError('User not found:', { userId });
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    // hasPassword indicates whether the user has a password configured (true/false)
    const user = await getUserById(userId);
    const hasPassword = !!(user && user.password);

    // Place hasPassword inside the Privacy object as requested by client response shape
    privacyData.hasPassword = hasPassword;

    logInfo('Privacy & Security data retrieved successfully:', { userId });
    return res.json(createExpressSuccessResponse('Privacy & Security retrieved successfully', { Privacy: privacyData }));
  } catch (error) {
    logError('Privacy & Security error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Update privacy and security settings for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updatePrivacySecurity = async (req, res) => {
  try {
    const userId = req.userId;
    const requestBody = req.body;

    // Validate request body using the validation utility function
    const validationResult = validatePrivacySecurityUpdateRequest(requestBody);
    if (!validationResult.isValid) {
      return res.status(400).json(createExpressErrorResponse('Validation failed', 400));
    }

    // Update privacy/security details using the DB utility function
    const success = await updatePrivacySecurityDetails(userId, requestBody);
    if (!success) {
      logError('User not found for update:', { userId });
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    logInfo('Privacy & Security settings updated successfully:', { userId });
    return res.json(createExpressSuccessResponse('Privacy & Security settings updated successfully'));
  } catch (error) {
    logError('Privacy & Security update error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Clear all active sessions for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const clearSessions = async (req, res) => {
  try {
    const userId = req.userId;

    logInfo('Clearing sessions for user:', { userId });

    // Clear sessions from both databases
    const clearResult = await clearUserSessions(userId);

    if (clearResult.success) {
      logInfo('Sessions cleared successfully:', { userId, clearResult });
      return res.json(createExpressSuccessResponse('All sessions cleared successfully', {
        mysqlDeleted: clearResult.mysqlDeleted,
        dynamoDeleted: clearResult.dynamoDeleted,
        totalDeleted: clearResult.totalDeleted
      }));
    } else {
      logError('Failed to clear sessions:', { userId, clearResult });
      return res.status(500).json(createExpressErrorResponse('Failed to clear some sessions', 500));
    }

  } catch (error) {
    logError('Error in clearSessions:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Get account deletion status and information for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAccountDeletionStatus = async (req, res) => {
  try {
    const userId = req.userId;

    // Get user details to check deletion status
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    // Check if account is already soft deleted
    if (user.deleted_at) {
      logInfo('Account deletion status retrieved - account is delete:', { userId, deletedAt: user.deleted_at });
      return res.json(createExpressSuccessResponse('Account deletion status retrieved', {
        isDelete: true,
        deletedAt: user.deleted_at,
        deletionReason: user.deletion_reason || 'Account delete'
      }));
    }

    // Account is active - return essential information with note message
    logInfo('Account deletion status retrieved - account is active:', { userId });
    return res.json(createExpressSuccessResponse('Account deletion status retrieved', {
      noteMsg: "We are sorry that you want to delete your account. This action cannot be reversed. All your data, posts, and subscriptions will be deleted after 30 days. If you decide to proceed, please enter your password in the field below. If you don't have a password, click Delete with OTP.",
      hasPassword: !!user.password
    }));

  } catch (error) {
    logError('Account deletion status error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Initiate account deletion process for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.userId;
    const requestBody = req.body;

    // Validate request body
    const validationResult = validateAccountDeletionRequest(requestBody);
    if (!validationResult.isValid) {
      return res.status(400).json(createExpressErrorResponse('Validation failed', 400));
    }

    // Get user details to check if they have a password
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    // Check if user has a password
    if (user.password) {
      // User has password - verify password
      if (!requestBody.password) {
        return res.status(400).json(createExpressErrorResponse('Password is required for account deletion', 400));
      }

      // Verify password
      const bcrypt = await import('bcryptjs');
      const isPasswordValid = await bcrypt.default.compare(requestBody.password, user.password);
      if (!isPasswordValid) {
        return res.status(400).json(createExpressErrorResponse('Invalid password', 400));
      }

      // Password is valid - proceed with account deletion
      const deletionResult = await softDeleteUserAccount(userId, 'User requested account deletion with password verification');
      if (!deletionResult.success) {
        return res.status(500).json(createExpressErrorResponse('Failed to delete account', 500));
      }

      logInfo('Account delete successfully with password verification:', { userId });
      return res.json(createExpressSuccessResponse('Account delete successfully'));
    } else {
      // User doesn't have password - generate OTP
      const otpResult = await generateAccountDeletionOTP(userId, 'User requested account deletion');
      if (!otpResult.success) {
        return res.status(500).json(createExpressErrorResponse('Failed to generate OTP for account deletion', 500));
      }

      // Create the masked message with email and mobile
      let maskedMessage = 'We just sent a 5-digit code to your ';
      const contactInfo = [];
      
      if (otpResult.maskedEmail) {
        contactInfo.push(`Email address ${otpResult.maskedEmail}`);
      }
      
      if (otpResult.maskedMobile) {
        contactInfo.push(`Whatsapp number ${otpResult.maskedMobile}`);
      }
      
      if (contactInfo.length > 0) {
        maskedMessage += contactInfo.join(', and ') + ' enter it below:';
      } else {
        maskedMessage = 'OTP sent successfully for account deletion. Please verify with the OTP to complete deletion.';
      }

      logInfo('Account deletion OTP generated successfully:', { userId });
      return res.json(createExpressSuccessResponse(maskedMessage));
    }
  } catch (error) {
    logError('Account deletion error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Complete account deletion process after OTP verification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteAccountWithOtp = async (req, res) => {
  try {
    const userId = req.userId;
    const requestBody = req.body;

    // Validate request body
    const validationResult = validateAccountDeletionOTPRequest(requestBody);
    if (!validationResult.isValid) {
      return res.status(400).json(createExpressErrorResponse('Validation failed', 400));
    }

    // Get user details to check if they have a password
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }

    // If user has password, they should use password verification instead
    if (user.password) {
      return res.status(400).json(createExpressErrorResponse('Password verification is required for this account. Please use password instead of OTP.', 400));
    }

    // Verify OTP for account deletion
    const otpVerification = await verifyAccountDeletionOTP(userId, requestBody.otp);
    if (!otpVerification.success) {
      return res.status(400).json(createExpressErrorResponse('Invalid or expired OTP', 400));
    }

    // Perform soft delete of user account
    const deletionResult = await softDeleteUserAccount(userId, 'User requested account deletion with OTP verification');
    if (!deletionResult.success) {
      return res.status(500).json(createExpressErrorResponse('Failed to delete account', 500));
    }

    logInfo('Account delete successfully with OTP verification:', { userId });
    return res.json(createExpressSuccessResponse('Account delete successfully'));
  } catch (error) {
    logError('Account deletion with OTP error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Get account retrieve information for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getAccountRetrieve = async (req, res) => {
  try {
    const userId = req.userId;

    // Get account retrieve information
    const retrieveInfo = await getAccountRetrieveInfo(userId);
    if (!retrieveInfo.success) {
      logError('Failed to get account retrieve info:', { userId, error: retrieveInfo.error });
      return res.status(400).json(createExpressErrorResponse(retrieveInfo.message || retrieveInfo.error, 400));
    }

    logInfo('Account retrieve info retrieved successfully:', { userId, remainingDays: retrieveInfo.remainingDays });
    return res.json(createExpressSuccessResponse('Account retrieve information retrieved successfully', {
      canRetrieve: retrieveInfo.canRetrieve,
      remainingDays: retrieveInfo.remainingDays,
      deletionDate: retrieveInfo.deletionDate,
      message: retrieveInfo.message
    }));
  } catch (error) {
    logError('Account retrieve info error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * Reactivate the deleted account for the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const retrieveAccount = async (req, res) => {
  try {
    const userId = req.userId;
    const requestBody = req.body;

    // First check if account can be retrieved
    const retrieveInfo = await getAccountRetrieveInfo(userId);
    if (!retrieveInfo.success || !retrieveInfo.canRetrieve) {
      logError('Account cannot be retrieved:', { userId, error: retrieveInfo.error });
      return res.status(400).json(createExpressErrorResponse(retrieveInfo.message || retrieveInfo.error, 400));
    }

    // Reactivate the account
    const reactivationResult = await reactivateUserAccount(userId);
    if (!reactivationResult.success) {
      logError('Failed to reactivate account:', { userId, error: reactivationResult.error });
      return res.status(500).json(createExpressErrorResponse('Failed to reactivate account', 500));
    }

    logInfo('Account retrieved successfully:', { userId });
    return res.json(createExpressSuccessResponse('Account retrieved successfully. Welcome back!'));
  } catch (error) {
    logError('Account retrieve error:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};
