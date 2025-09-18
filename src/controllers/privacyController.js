import { createSuccessResponse, createErrorResponse, logInfo, logError, getUserById, getAuthenticatedUserId } from '../utils/common.js';
import { fetchPrivacySecurityDetails, updatePrivacySecurityDetails, generateAccountDeletionOTP, verifyAccountDeletionOTP, softDeleteUserAccount, getAccountRetrieveInfo, reactivateUserAccount, clearUserSessions } from '../utils/privacy_security.js';
import { validatePrivacySecurityUpdateRequest, validateAccountDeletionRequest, validateAccountDeletionOTPRequest } from '../validate/privacy_security.js';
import bcrypt from 'bcryptjs';

/**
 * Handler for GET /privacy/security
 * Fetches privacy and security settings for the authenticated user.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const getPrivacySecurity = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'privacy & security' }) to getAuthenticatedUserId(req, { action: 'privacy & security' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'privacy & security' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Fetch privacy/security details using the DB utility function
    const privacyData = await fetchPrivacySecurityDetails(userId);
    if (!privacyData) {
      logError('User not found:', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // hasPassword indicates whether the user has a password configured (true/false)
    const user = await getUserById(userId);
    const hasPassword = !!(user && user.password);

    // Place hasPassword inside the Privacy object as requested by client response shape
    privacyData.hasPassword = hasPassword;

    logInfo('Privacy & Security data retrieved successfully:', { userId });
    // TODO: Convert createSuccessResponse('Privacy & Security retrieved successfully', { Privacy: privacyData }) to res.json({ success: true, message: 'Privacy & Security retrieved successfully', data: { Privacy: privacyData } })
    return res.json({
      success: true,
      message: 'Privacy & Security retrieved successfully',
      data: { Privacy: privacyData }
    });
  } catch (error) {
    logError('Privacy & Security error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for POST /privacy/security
 * Updates privacy and security settings for the authenticated user.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const updatePrivacySecurity = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'privacy & security' }) to getAuthenticatedUserId(req, { action: 'privacy & security' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'privacy & security' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (parseError) {
      logError('Invalid JSON in request body:', parseError);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    // Validate request body using the validation utility function
    const validationResult = validatePrivacySecurityUpdateRequest(requestBody);
    if (!validationResult.isValid) {
      // TODO: Convert createErrorResponse(400, 'Validation failed', validationResult.errors) to res.status(400).json({ error: 'Validation failed', details: validationResult.errors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    // Update privacy/security details using the DB utility function
    const success = await updatePrivacySecurityDetails(userId, requestBody);
    if (!success) {
      logError('User not found for update:', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    logInfo('Privacy & Security settings updated successfully:', { userId });
    // TODO: Convert createSuccessResponse('Privacy & Security settings updated successfully') to res.json({ success: true, message: 'Privacy & Security settings updated successfully' })
    return res.json({ success: true, message: 'Privacy & Security settings updated successfully' });
  } catch (error) {
    logError('Privacy & Security update error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for GET /account/delete
 * Gets account deletion status and information for the authenticated user.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const getAccountDeletionStatus = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'account deletion status' }) to getAuthenticatedUserId(req, { action: 'account deletion status' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'account deletion status' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Get user details to check deletion status
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Check if account is already soft deleted
    if (user.deleted_at) {
      logInfo('Account deletion status retrieved - account is delete:', { userId, deletedAt: user.deleted_at });
      // TODO: Convert createSuccessResponse('Account deletion status retrieved', { isDelete: true, deletedAt: user.deleted_at, deletionReason: user.deletion_reason || 'Account delete' }) to res.json({ success: true, message: 'Account deletion status retrieved', data: { isDelete: true, deletedAt: user.deleted_at, deletionReason: user.deletion_reason || 'Account delete' } })
      return res.json({
        success: true,
        message: 'Account deletion status retrieved',
        data: {
          isDelete: true,
          deletedAt: user.deleted_at,
          deletionReason: user.deletion_reason || 'Account delete'
        }
      });
    }

    // Account is active - return essential information with note message
    logInfo('Account deletion status retrieved - account is active:', { userId });
    // TODO: Convert createSuccessResponse('Account deletion status retrieved', { noteMsg: "We are sorry that you want to delete your account. This action cannot be reversed. All your data, posts, and subscriptions will be deleted after 30 days. If you decide to proceed, please enter your password in the field below. If you don't have a password, click Delete with OTP.", hasPassword: !!user.password }) to res.json({ success: true, message: 'Account deletion status retrieved', data: { noteMsg: "We are sorry that you want to delete your account. This action cannot be reversed. All your data, posts, and subscriptions will be deleted after 30 days. If you decide to proceed, please enter your password in the field below. If you don't have a password, click Delete with OTP.", hasPassword: !!user.password } })
    return res.json({
      success: true,
      message: 'Account deletion status retrieved',
      data: {
        noteMsg: "We are sorry that you want to delete your account. This action cannot be reversed. All your data, posts, and subscriptions will be deleted after 30 days. If you decide to proceed, please enter your password in the field below. If you don't have a password, click Delete with OTP.",
        hasPassword: !!user.password
      }
    });

  } catch (error) {
    logError('Account deletion status error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for POST /account/delete
 * Initiates account deletion process for the authenticated user.
 * If user has password, requires password verification.
 * If user doesn't have password, sends OTP to email and WhatsApp.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const deleteAccount = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'account deletion' }) to getAuthenticatedUserId(req, { action: 'account deletion' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'account deletion' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (parseError) {
      logError('Invalid JSON in request body:', parseError);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    // Validate request body
    const validationResult = validateAccountDeletionRequest(requestBody);
    if (!validationResult.isValid) {
      // TODO: Convert createErrorResponse(400, 'Validation failed', validationResult.errors) to res.status(400).json({ error: 'Validation failed', details: validationResult.errors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    // Get user details to check if they have a password
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Check if user has a password
    if (user.password) {
      // User has password - verify password
      if (!requestBody.password) {
        // TODO: Convert createErrorResponse(400, 'Password is required for account deletion') to res.status(400).json({ error: 'Password is required for account deletion' })
        return res.status(400).json(createErrorResponse(400, 'Password is required for account deletion'));
      }

      // Verify password
      // TODO: Convert bcrypt.default.compare to bcrypt.compare
      const isPasswordValid = await bcrypt.compare(requestBody.password, user.password);
      if (!isPasswordValid) {
        // TODO: Convert createErrorResponse(400, 'Invalid password') to res.status(400).json({ error: 'Invalid password' })
        return res.status(400).json(createErrorResponse(400, 'Invalid password'));
      }

      // Password is valid - proceed with account deletion
      const deletionResult = await softDeleteUserAccount(userId, 'User requested account deletion with password verification');
      if (!deletionResult.success) {
        // TODO: Convert createErrorResponse(500, 'Failed to delete account') to res.status(500).json({ error: 'Failed to delete account' })
        return res.status(500).json(createErrorResponse(500, 'Failed to delete account'));
      }

      logInfo('Account delete successfully with password verification:', { userId });
      // TODO: Convert createSuccessResponse('Account delete successfully') to res.json({ success: true, message: 'Account delete successfully' })
      return res.json({ success: true, message: 'Account delete successfully' });
    } else {
      // User doesn't have password - generate OTP
      const otpResult = await generateAccountDeletionOTP(userId, 'User requested account deletion');
      if (!otpResult.success) {
        // TODO: Convert createErrorResponse(500, 'Failed to generate OTP for account deletion') to res.status(500).json({ error: 'Failed to generate OTP for account deletion' })
        return res.status(500).json(createErrorResponse(500, 'Failed to generate OTP for account deletion'));
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
      // TODO: Convert createSuccessResponse(maskedMessage) to res.json({ success: true, message: maskedMessage })
      return res.json({ success: true, message: maskedMessage });
    }
  } catch (error) {
    logError('Account deletion error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for POST /account/delete/otp
 * Completes account deletion process after OTP verification.
 * This endpoint is only used when user doesn't have a password.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const deleteAccountWithOtp = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'account deletion with OTP' }) to getAuthenticatedUserId(req, { action: 'account deletion with OTP' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'account deletion with OTP' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (parseError) {
      logError('Invalid JSON in request body:', parseError);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    // Validate request body
    const validationResult = validateAccountDeletionOTPRequest(requestBody);
    if (!validationResult.isValid) {
      // TODO: Convert createErrorResponse(400, 'Validation failed', validationResult.errors) to res.status(400).json({ error: 'Validation failed', details: validationResult.errors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    // Get user details to check if they have a password
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // If user has password, they should use password verification instead
    if (user.password) {
      // TODO: Convert createErrorResponse(400, 'Password verification is required for this account. Please use password instead of OTP.') to res.status(400).json({ error: 'Password verification is required for this account. Please use password instead of OTP.' })
      return res.status(400).json(createErrorResponse(400, 'Password verification is required for this account. Please use password instead of OTP.'));
    }

    // Verify OTP for account deletion
    const otpVerification = await verifyAccountDeletionOTP(userId, requestBody.otp);
    if (!otpVerification.success) {
      // TODO: Convert createErrorResponse(400, 'Invalid or expired OTP') to res.status(400).json({ error: 'Invalid or expired OTP' })
      return res.status(400).json(createErrorResponse(400, 'Invalid or expired OTP'));
    }

    // Perform soft delete of user account
    const deletionResult = await softDeleteUserAccount(userId, 'User requested account deletion with OTP verification');
    if (!deletionResult.success) {
      // TODO: Convert createErrorResponse(500, 'Failed to delete account') to res.status(500).json({ error: 'Failed to delete account' })
      return res.status(500).json(createErrorResponse(500, 'Failed to delete account'));
    }

    logInfo('Account delete successfully with OTP verification:', { userId });
    // TODO: Convert createSuccessResponse('Account delete successfully') to res.json({ success: true, message: 'Account delete successfully' })
    return res.json({ success: true, message: 'Account delete successfully' });
  } catch (error) {
    logError('Account deletion with OTP error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for POST /privacy/security/clear-sessions
 * Clears all active sessions for the authenticated user from both MySQL and DynamoDB.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const clearSessions = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'clear sessions' }) to getAuthenticatedUserId(req, { action: 'clear sessions' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'clear sessions' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Clearing sessions for user:', { userId });

    // Import the utility function dynamically to avoid circular imports
    // TODO: Convert const { clearUserSessions } = await import('../utils/privacy_security.js'); to const { clearUserSessions } = await import('../utils/privacy_security.js');
    const { clearUserSessions } = await import('../utils/privacy_security.js');
    
    // Clear sessions from both databases
    const clearResult = await clearUserSessions(userId);

    if (clearResult.success) {
      logInfo('Sessions cleared successfully:', { userId, clearResult });
      // TODO: Convert createSuccessResponse('All sessions cleared successfully', { mysqlDeleted: clearResult.mysqlDeleted, dynamoDeleted: clearResult.dynamoDeleted, totalDeleted: clearResult.totalDeleted }) to res.json({ success: true, message: 'All sessions cleared successfully', data: { mysqlDeleted: clearResult.mysqlDeleted, dynamoDeleted: clearResult.dynamoDeleted, totalDeleted: clearResult.totalDeleted } })
      return res.json({
        success: true,
        message: 'All sessions cleared successfully',
        data: {
          mysqlDeleted: clearResult.mysqlDeleted,
          dynamoDeleted: clearResult.dynamoDeleted,
          totalDeleted: clearResult.totalDeleted
        }
      });
    } else {
      logError('Failed to clear sessions:', { userId, clearResult });
      // TODO: Convert createErrorResponse(500, 'Failed to clear some sessions') to res.status(500).json({ error: 'Failed to clear some sessions' })
      return res.status(500).json(createErrorResponse(500, 'Failed to clear some sessions'));
    }

  } catch (error) {
    logError('Error in clearSessions:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for GET /account/retrieve
 * Gets account retrieve information for the authenticated user.
 * Shows remaining days to retrieve account if user is deleted.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const getAccountRetrieve = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'account retrieve info' }) to getAuthenticatedUserId(req, { action: 'account retrieve info' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'account retrieve info' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Get account retrieve information
    const retrieveInfo = await getAccountRetrieveInfo(userId);
    if (!retrieveInfo.success) {
      logError('Failed to get account retrieve info:', { userId, error: retrieveInfo.error });
      // TODO: Convert createErrorResponse(400, retrieveInfo.message || retrieveInfo.error) to res.status(400).json({ error: retrieveInfo.message || retrieveInfo.error })
      return res.status(400).json(createErrorResponse(400, retrieveInfo.message || retrieveInfo.error));
    }

    logInfo('Account retrieve info retrieved successfully:', { userId, remainingDays: retrieveInfo.remainingDays });
    // TODO: Convert createSuccessResponse('Account retrieve information retrieved successfully', { canRetrieve: retrieveInfo.canRetrieve, remainingDays: retrieveInfo.remainingDays, deletionDate: retrieveInfo.deletionDate, message: retrieveInfo.message }) to res.json({ success: true, message: 'Account retrieve information retrieved successfully', data: { canRetrieve: retrieveInfo.canRetrieve, remainingDays: retrieveInfo.remainingDays, deletionDate: retrieveInfo.deletionDate, message: retrieveInfo.message } })
    return res.json({
      success: true,
      message: 'Account retrieve information retrieved successfully',
      data: {
        canRetrieve: retrieveInfo.canRetrieve,
        remainingDays: retrieveInfo.remainingDays,
        deletionDate: retrieveInfo.deletionDate,
        message: retrieveInfo.message
      }
    });
  } catch (error) {
    logError('Account retrieve info error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler for POST /account/retrieve
 * Reactivates the deleted account for the authenticated user.
 * @param {object} req - Express request object
 * @returns {object} API response
 */
export const retrieveAccount = async (req, res) => {
  try {
    // Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'account retrieve' }) to getAuthenticatedUserId(req, { action: 'account retrieve' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'account retrieve' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      requestBody = JSON.parse(req.body || '{}');
    } catch (parseError) {
      logError('Invalid JSON in request body:', parseError);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    // First check if account can be retrieved
    const retrieveInfo = await getAccountRetrieveInfo(userId);
    if (!retrieveInfo.success || !retrieveInfo.canRetrieve) {
      logError('Account cannot be retrieved:', { userId, error: retrieveInfo.error });
      // TODO: Convert createErrorResponse(400, retrieveInfo.message || retrieveInfo.error) to res.status(400).json({ error: retrieveInfo.message || retrieveInfo.error })
      return res.status(400).json(createErrorResponse(400, retrieveInfo.message || retrieveInfo.error));
    }

    // Reactivate the account
    const reactivationResult = await reactivateUserAccount(userId);
    if (!reactivationResult.success) {
      logError('Failed to reactivate account:', { userId, error: reactivationResult.error });
      // TODO: Convert createErrorResponse(500, 'Failed to reactivate account') to res.status(500).json({ error: 'Failed to reactivate account' })
      return res.status(500).json(createErrorResponse(500, 'Failed to reactivate account'));
    }

    logInfo('Account retrieved successfully:', { userId });
    // TODO: Convert createSuccessResponse('Account retrieved successfully. Welcome back!') to res.json({ success: true, message: 'Account retrieved successfully. Welcome back!' })
    return res.json({
      success: true,
      message: 'Account retrieved successfully. Welcome back!'
    });
  } catch (error) {
    logError('Account retrieve error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
