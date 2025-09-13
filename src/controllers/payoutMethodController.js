/**
 * @file payoutMethodController.js
 * @description Payout Method controller for Bingeme API Express.js
 * Handles payout method operations including retrieval, creation, and deletion
 */

import { 
  logInfo, 
  logError, 
  createErrorResponse, 
  createSuccessResponse, 
  getAuthenticatedUserId 
} from '../utils/common.js';
import { fetchUserPayoutDetails, updateUserPayoutMethod, sanitizePayoutData, deleteUserPayoutMethod } from '../utils/payout.js';
import { validateBankDetails, validateUpiData, validatePayPalData, validateBankIndiaData } from '../validate/payout.js';

/**
 * Safely parses JSON from request body and handles parsing errors gracefully
 * 
 * @param {Object} req - Express request object containing request body
 * @returns {Object} Object with parsed body and error status
 */
const parseRequestBody = (req) => {
  try {
    const body = req.body || {};
    return { body, error: null };
  } catch (parseError) {
    return { 
      body: null, 
      error: createErrorResponse(400, 'Invalid JSON in request body') 
    };
  }
};

/**
 * Retrieves payout method details for the authenticated user with sensitive information sanitized
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getPayoutMethod = async (req, res) => {
  try {
    const userId = req.userId;

    // Fetch user payout details from database
    const user = await fetchUserPayoutDetails(userId);
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Sanitize sensitive information before responding
    const sanitizedData = await sanitizePayoutData(user);

    return res.json(createSuccessResponse('Payout method details retrieved successfully', sanitizedData));

  } catch (error) {
    logError('[getPayoutMethod] Error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};

/**
 * Create payout method for the authenticated user
 * 
 * Supports bank, bank_india, upi, and paypal payment types.
 * Validates input data, sanitizes content, and updates user's payout configuration
 * in the database according to Laravel implementation patterns.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const createPayoutMethod = async (req, res) => {
  try {
    const userId = req.userId;

    // Parse request body JSON
    const { body: requestBody, error: parseError } = parseRequestBody(req);
    if (parseError) return res.status(400).json(parseError);

    // Extract payout type from request body
    let { type } = requestBody;
    
    // If type is not explicitly provided, detect it from request body structure
    if (!type) {
      if (requestBody.upi || requestBody.upi_id) {
        type = 'upi';
      } else if (requestBody.bank_details || (requestBody.bank && typeof requestBody.bank === 'string')) {
        type = 'bank';
      } else if (requestBody.bank && (requestBody.bank.acc_no || requestBody.bank.account_number)) {
        type = 'bank_india';
      } else if (requestBody.email_paypal || requestBody.paypal_email) {
        type = 'paypal';
      }
    }

    // Validate payout type is provided and valid
    if (!type) {
      return res.status(400).json(createErrorResponse(400, 'Payout type is required'));
    }

    // Validate type is one of the supported payout methods
    const validTypes = ['paypal', 'bank', 'bank_india', 'upi'];
    if (!validTypes.includes(type)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid payout type. Must be one of: paypal, bank, bank_india, upi'));
    }

    // Handle different payout types with type-specific validation and processing
    switch (type) {
      case 'paypal': {
        const { paypal_email, email_paypal } = requestBody;
        const email = paypal_email || email_paypal;
        
        // Validate PayPal email fields
        if (!email) {
          return res.status(400).json(createErrorResponse(400, 'PayPal email is required'));
        }
        
        // Validate email format using existing validation function
        const validation = validatePayPalData({ paypal_email: email });
        if (!validation.valid) {
          return res.status(400).json(createErrorResponse(400, validation.error));
        }

        // Update user with PayPal configuration
        await updateUserPayoutMethod(userId, 'PayPal', '', validation.data.paypalEmail);

        return res.json(createSuccessResponse('Changes saved successfully', {
          paypal: {
            email: validation.data.paypalEmail
          }
        }));
      }

      case 'bank': {
        const { bank_details, bank } = requestBody;
        const details = bank_details || bank;
        
        // Validate bank details using the validation function
        if (!details) {
          return res.status(400).json(createErrorResponse(400, 'Bank details are required'));
        }
        
        if (!validateBankDetails(details)) {
          return res.status(400).json(createErrorResponse(400, `Bank details must be at least 20 characters long`));
        }

        // Sanitize bank details to remove HTML tags
        const sanitizedBankDetails = details.replace(/<[^>]*>/g, '').trim();

        // Update user with bank configuration
        await updateUserPayoutMethod(userId, 'Bank', sanitizedBankDetails);

        return res.json(createSuccessResponse('Changes saved successfully', {
          bank: {
            bank_details: sanitizedBankDetails
          }
        }));
      }

      case 'bank_india': {
        const { bank } = requestBody;
        if (!bank) {
          return res.status(400).json(createErrorResponse(400, 'Bank details are required'));
        }
        
        // Map field names to match validation expectations
        const account_number = bank.acc_no || bank.account_number;
        const holder_name = bank.name || bank.holder_name;
        const bank_name = bank.bank_name;
        const ifsc_code = bank.ifsc || bank.ifsc_code;
        
        // Validate all required Indian bank fields
        if (!account_number) {
          return res.status(400).json(createErrorResponse(400, 'Account number is required'));
        }
        if (!holder_name) {
          return res.status(400).json(createErrorResponse(400, 'Account holder name is required'));
        }
        if (!bank_name) {
          return res.status(400).json(createErrorResponse(400, 'Bank name is required'));
        }
        if (!ifsc_code) {
          return res.status(400).json(createErrorResponse(400, 'IFSC code is required'));
        }
        
        // Validate using existing validation function
        const validation = validateBankIndiaData({ account_number, holder_name, bank_name, ifsc_code });
        
        if (!validation.valid) {
          return res.status(400).json(createErrorResponse(400, validation.error));
        }

        // Serialize bank data as PHP serialized format for Laravel compatibility
        // Escape special characters to prevent SQL injection
        const escapedAccountNumber = account_number.replace(/['"\\]/g, '\\$&');
        const escapedHolderName = holder_name.replace(/['"\\]/g, '\\$&');
        const escapedBankName = bank_name.replace(/['"\\]/g, '\\$&');
        const escapedIfscCode = ifsc_code.replace(/['"\\]/g, '\\$&');

        const bankData = `a:4:{s:14:"account_number";s:${escapedAccountNumber.length}:"${escapedAccountNumber}";s:11:"holder_name";s:${escapedHolderName.length}:"${escapedHolderName}";s:9:"bank_name";s:${escapedBankName.length}:"${escapedBankName}";s:9:"ifsc_code";s:${escapedIfscCode.length}:"${escapedIfscCode}";}`;

        // Update user with Indian bank configuration
        await updateUserPayoutMethod(userId, 'Bank_india', bankData);

        return res.json(createSuccessResponse('Changes saved successfully', {
          bank_india: {
            acc_no: validation.data.accountNumber,
            name: validation.data.holderName,
            bank_name: validation.data.bankName,
            ifsc: validation.data.ifscCode
          }
        }));
      }

      case 'upi': {
        const { upi, upi_id } = requestBody;
        const upiId = upi || upi_id;
        
        // Validate UPI ID presence
        if (!upiId) {
          return res.status(400).json(createErrorResponse(400, 'UPI ID is required'));
        }
        
        // Validate UPI format using existing validation function
        const validation = validateUpiData({ upi_id: upiId });
        if (!validation.valid) {
          return res.status(400).json(createErrorResponse(400, validation.error));
        }

        // Update user with UPI configuration
        await updateUserPayoutMethod(userId, 'upi', validation.data.upiId);

        return res.json(createSuccessResponse('Changes saved successfully', {
          upi: validation.data.upiId
        }));
      }

      default:
        return res.status(400).json(createErrorResponse(400, 'Unsupported payout type'));
    }

  } catch (error) {
    logError('[createPayoutMethod] Error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};

/**
 * Delete payout method for the authenticated user
 * 
 * Clears all payout method configuration for the authenticated user by
 * setting payment_gateway, bank, and paypal_account fields to empty strings.
 * This effectively removes all configured payout methods.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deletePayoutMethod = async (req, res) => {
  try {
    const userId = req.userId;

    // Verify user exists before attempting deletion
    const user = await fetchUserPayoutDetails(userId);
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Delete payout method by clearing all payment-related fields
    const result = await deleteUserPayoutMethod(userId);
    
    if (result.affectedRows === 0) {
      return res.status(404).json(createErrorResponse(404, 'User not found or no payout method to delete'));
    }

    return res.json(createSuccessResponse('Payout method deleted successfully'));

  } catch (error) {
    logError('[deletePayoutMethod] Error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};
