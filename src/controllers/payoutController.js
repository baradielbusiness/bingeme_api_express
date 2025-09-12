/**
 * @file payoutController.js
 * @description Express.js Payout Controllers
 * 
 * This module provides payout functionality including:
 * - Payout method management (get, create, delete)
 * - Payout conversation handling
 * - Payout media upload
 * 
 * Database Tables: users, ticket_conversations
 */

import { 
  getAuthenticatedUserId, 
  createErrorResponse, 
  createSuccessResponse, 
  logInfo, 
  logError
} from '../utils/common.js';
import { 
  fetchUserPayoutDetails, 
  updateUserPayoutMethod, 
  sanitizePayoutData, 
  deleteUserPayoutMethod 
} from '../utils/payout.js';
import { 
  validateBankDetails, 
  validateUpiData, 
  validatePayPalData, 
  validateBankIndiaData 
} from '../utils/validations.js';
import { 
  processMediaFiles, 
  cleanupS3Files 
} from '../utils/mediaProcessing.js';
import { 
  processUploadRequest 
} from '../utils/uploadUtils.js';
import { pool } from '../config/database.js';

/**
 * Safely parses JSON from request body and handles parsing errors gracefully
 */
const parseRequestBody = (req) => {
  try {
    return { body: req.body, error: null };
  } catch (parseError) {
    return { 
      body: null, 
      error: createErrorResponse(400, 'Invalid JSON in request body') 
    };
  }
};

/**
 * Handler to get payout method (GET /payout)
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

    return res.status(200).json(createSuccessResponse('Payout method details retrieved successfully', sanitizedData));

  } catch (error) {
    logError('[getPayoutMethod] Error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};

/**
 * Handler to create payout method (POST /payout/create)
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

        return res.status(200).json(createSuccessResponse('Changes saved successfully', {
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

        return res.status(200).json(createSuccessResponse('Changes saved successfully', {
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

        return res.status(200).json(createSuccessResponse('Changes saved successfully', {
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

        return res.status(200).json(createSuccessResponse('Changes saved successfully', {
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
 * Handler to delete payout method (DELETE /payout/delete)
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

    return res.status(200).json(createSuccessResponse('Payout method deleted successfully'));

  } catch (error) {
    logError('[deletePayoutMethod] Error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};

/**
 * Handler to get payout conversations (GET /payout/conversations)
 */
export const getPayoutConversations = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip = 0, limit = 10 } = req.query;
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    logInfo('Fetching payout conversations', { userId, skip: skipNum, limit: limitNum });

    // Query to get payout conversations where user is involved
    const query = `
      SELECT 
        tc.id,
        tc.user_id,
        tc.to_user_id,
        tc.ticket_id,
        tc.type,
        tc.message,
        tc.image,
        tc.created_at,
        tc.updated_at,
        u1.name as sender_name,
        u1.username as sender_username,
        u2.name as receiver_name,
        u2.username as receiver_username
      FROM ticket_conversations tc
      LEFT JOIN users u1 ON tc.user_id = u1.id
      LEFT JOIN users u2 ON tc.to_user_id = u2.id
      WHERE tc.type = '2' 
        AND (tc.user_id = ? OR tc.to_user_id = ?)
      ORDER BY tc.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [conversations] = await pool.query(query, [userId, userId, limitNum, skipNum]);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ticket_conversations tc
      WHERE tc.type = '2' 
        AND (tc.user_id = ? OR tc.to_user_id = ?)
    `;

    const [countResult] = await pool.query(countQuery, [userId, userId]);
    const total = countResult[0]?.total || 0;

    logInfo('Successfully fetched payout conversations', { 
      userId, 
      count: conversations.length, 
      total 
    });

    // Calculate next pagination URL
    const nextSkip = skipNum + limitNum;
    let next = null;
    
    if (nextSkip < total) {
      const queryParams = new URLSearchParams();
      queryParams.set('skip', nextSkip.toString());
      queryParams.set('limit', limitNum.toString());
      next = `/payout/conversations?${queryParams.toString()}`;
    }

    return res.status(200).json(createSuccessResponse('Payout conversations retrieved successfully', {
      conversations,
      pagination: {
        total,
        skip: skipNum,
        limit: limitNum,
        next
      }
    }));

  } catch (error) {
    logError('Error fetching payout conversations', { 
      error: error.message, 
      stack: error.stack 
    });

    return res.status(500).json(createErrorResponse(500, 'Failed to fetch payout conversations'));
  }
};

/**
 * Handler to store payout conversation (POST /payout/conversations/store)
 */
export const storePayoutConversation = async (req, res) => {
  try {
    const userId = req.userId;
    const { message, payout_image_keys } = req.body;
    
    if (!message) {
      return res.status(400).json(createErrorResponse(400, 'Missing required field: message is required'));
    }

    // Validate message length
    if (message.length > 255) {
      return res.status(400).json(createErrorResponse(400, 'Message too long. Maximum 255 characters allowed.'));
    }

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files if provided
    let processedMedia = { original: [], converted: [] };
    let mediaProcessingFailed = false;
    
    if (payout_image_keys && Array.isArray(payout_image_keys) && payout_image_keys.length > 0) {
      try {
        logInfo('Starting payout media processing:', { mediaCount: payout_image_keys.length });
        processedMedia = await processMediaFiles(payout_image_keys, bucketName, 'payout', { continueOnError: false });
        logInfo('Payout media processing completed successfully:', { 
          originalCount: processedMedia.original.length,
          convertedCount: processedMedia.converted.length
        });
      } catch (error) {
        logError('Payout media processing failed:', { error: error.message });
        mediaProcessingFailed = true;
        
        // Clean up any S3 files that might have been uploaded during processing
        try {
          logInfo('Cleaning up S3 files due to media processing failure');
          await cleanupS3Files(processedMedia.original, processedMedia.converted, bucketName, 'payout');
        } catch (cleanupError) {
          logError('Failed to cleanup S3 files after media processing failure:', { 
            cleanupError: cleanupError.message 
          });
        }
        
        return res.status(500).json(createErrorResponse(500, 'Media processing failed', error.message));
      }
    }

    // Insert new conversation with media information
    const insertQuery = `
      INSERT INTO ticket_conversations 
        (user_id, to_user_id, message, image, type)
      VALUES (?, ?, ?, ?, ?)
    `;

    // Store only the filename (without path) following Templar's pattern
    let imageFilename = '';
    if (!mediaProcessingFailed && processedMedia.converted.length > 0) {
      // Extract just the filename from the converted S3 key (WebP file)
      const fullPath = processedMedia.converted[0];
      imageFilename = fullPath.split('/').pop(); // Get filename without path
      
    } else if (!mediaProcessingFailed && processedMedia.original.length > 0) {
      // Fallback: If no WebP conversion, use original file
      const fullPath = processedMedia.original[0];
      imageFilename = fullPath.split('/').pop();
      
    } else {
      logInfo('No payout media processed, conversation will be text-only:', { userId });
    }

    const insertParams = [
      userId,
      1,
      message,
      imageFilename,
      '2'
    ];

    const [result] = await pool.query(insertQuery, insertParams);

    return res.status(201).json(createSuccessResponse('Payout conversation stored successfully'));

  } catch (error) {
    logError('Error storing payout conversation', { 
      error: error.message, 
      stack: error.stack 
    });

    return res.status(500).json(createErrorResponse(500, 'Failed to store payout conversation'));
  }
};

/**
 * Handler to get payout upload URL (GET /payout/upload-url)
 */
export const getPayoutUploadUrl = async (req, res) => {
  try {
    // Configuration options for payout upload processing
    const uploadOptions = {
      action: 'getPayoutUploadUrl',
      basePath: 'uploads/payout',
      useFolderOrganization: false, // Payout uses flat structure
      successMessage: 'Pre-signed upload URLs generated for payout conversation',
      getAuthenticatedUserId
    };
    
    // Use shared upload processing utility and return result directly
    const result = await processUploadRequest(req, uploadOptions);
    
    if (result.statusCode === 200) {
      return res.status(200).json(JSON.parse(result.body));
    } else {
      return res.status(result.statusCode).json(JSON.parse(result.body));
    }
  } catch (error) {
    logError('getPayoutUploadUrl error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
