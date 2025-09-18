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
import { pool, getDB } from '../config/database.js';

/**
 * Safely parses JSON from request body and handles parsing errors gracefully
 * 
 * @param {object} req - Express request object containing request body
 * @returns {object} Object with parsed body and error status
 */
const parseRequestBody = (req) => {
  try {
    // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
    const body = JSON.parse(req.body || '{}');
    return { body, error: null };
  } catch (parseError) {
    return { 
      body: null, 
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to { error: 'Invalid JSON in request body' }
      error: { error: 'Invalid JSON in request body' }
    };
  }
};

/**
 * Retrieves payout method details for the authenticated user with sensitive information sanitized
 * 
 * Response: Sanitized user payout method details with masked account numbers, emails, and other sensitive data
 * 
 * @param {object} req - Express request object with headers containing Authorization token
 * @returns {object} API response with sanitized payout method details or error response
 */
const getPayoutMethod = async (req, res) => {
  try {
    // Extract and validate user authentication	
    // TODO: Convert getAuthenticatedUserId(event, { action: 'payout_method getPayoutMethodHandler' }) to getAuthenticatedUserId(req, { action: 'payout_method getPayoutMethodHandler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'payout_method getPayoutMethodHandler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Fetch user payout details from database
    const user = await fetchUserPayoutDetails(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Sanitize sensitive information before responding
    const sanitizedData = await sanitizePayoutData(user);

    // TODO: Convert createSuccessResponse('Payout method details retrieved successfully', sanitizedData) to res.json({ success: true, message: 'Payout method details retrieved successfully', data: sanitizedData })
    return res.json({
      success: true,
      message: 'Payout method details retrieved successfully',
      data: sanitizedData
    });

  } catch (error) {
    logError('[getPayoutMethodHandler] Error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Create payout method for the authenticated user
 * 
 * Supports bank, bank_india, upi, and paypal payment types.
 * Validates input data, sanitizes content, and updates user's payout configuration
 * in the database according to Laravel implementation patterns.
 * 
 * Path Parameters: type (bank|bank_india|upi|paypal)
 * Request Body: Type-specific validation schema
 * 
 * @param {object} req - Express request object with path parameters and request body
 * @returns {object} API response with configuration result or error response
 */
const createPayoutMethod = async (req, res) => {
  try {
    // Authenticate user using common.js utility
    // TODO: Convert getAuthenticatedUserId(event, { action: 'payout_method createPayoutMethodHandler' }) to getAuthenticatedUserId(req, { action: 'payout_method createPayoutMethodHandler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'payout_method createPayoutMethodHandler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Parse request body JSON
    // TODO: Convert parseRequestBody(event) to parseRequestBody(req)
    const { body: requestBody, error: parseError } = parseRequestBody(req);
    if (parseError) {
      // TODO: Convert return parseError to return res.status(400).json(parseError)
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

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
      // TODO: Convert createErrorResponse(400, 'Payout type is required') to res.status(400).json({ error: 'Payout type is required' })
      return res.status(400).json(createErrorResponse(400, 'Payout type is required'));
    }

    // Validate type is one of the supported payout methods
    const validTypes = ['paypal', 'bank', 'bank_india', 'upi'];
    if (!validTypes.includes(type)) {
      // TODO: Convert createErrorResponse(400, 'Invalid payout type. Must be one of: paypal, bank, bank_india, upi') to res.status(400).json({ error: 'Invalid payout type. Must be one of: paypal, bank, bank_india, upi' })
      return res.status(400).json(createErrorResponse(400, 'Invalid payout type. Must be one of: paypal, bank, bank_india, upi'));
    }

    // Handle different payout types with type-specific validation and processing
    switch (type) {
      case 'paypal': {
        const { paypal_email, email_paypal } = requestBody;
        const email = paypal_email || email_paypal;
        
        // Validate PayPal email fields
        if (!email) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'PayPal email is required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'PayPal email is required' } })
          return res.status(400).json(createErrorResponse(400, 'PayPal email is required'));
        }
        
        // Validate email format using existing validation function
        const validation = validatePayPalData({ paypal_email: email });
        if (!validation.valid) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: validation.error }) to res.status(400).json({ error: 'Validation failed', details: { error: validation.error } })
          return res.status(400).json(createErrorResponse(400, validation.error));
        }

        // Update user with PayPal configuration
        await updateUserPayoutMethod(userId, 'PayPal', '', validation.data.paypalEmail);

        // TODO: Convert createSuccessResponse('Changes saved successfully', { paypal: { email: validation.data.paypalEmail } }) to res.json({ success: true, message: 'Changes saved successfully', data: { paypal: { email: validation.data.paypalEmail } } })
        return res.json({
          success: true,
          message: 'Changes saved successfully',
          data: {
            paypal: {
              email: validation.data.paypalEmail
            }
          }
        });
      }

      case 'bank': {
        const { bank_details, bank } = requestBody;
        const details = bank_details || bank;
        
        // Validate bank details using the validation function
        if (!details) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'Bank details are required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'Bank details are required' } })
          return res.status(400).json(createErrorResponse(400, 'Bank details are required'));
        }
        
        if (!validateBankDetails(details)) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'Bank details must be at least 20 characters long' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'Bank details must be at least 20 characters long' } })
          return res.status(400).json(createErrorResponse(400, 'Bank details must be at least 20 characters long'));
        }

        // Sanitize bank details to remove HTML tags
        const sanitizedBankDetails = details.replace(/<[^>]*>/g, '').trim();

        // Update user with bank configuration
        await updateUserPayoutMethod(userId, 'Bank', sanitizedBankDetails);

        // TODO: Convert createSuccessResponse('Changes saved successfully', { bank: { bank_details: sanitizedBankDetails } }) to res.json({ success: true, message: 'Changes saved successfully', data: { bank: { bank_details: sanitizedBankDetails } } })
        return res.json({
          success: true,
          message: 'Changes saved successfully',
          data: {
            bank: {
              bank_details: sanitizedBankDetails
            }
          }
        });
      }

      case 'bank_india': {
        const { bank } = requestBody;
        if (!bank) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'Bank details are required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'Bank details are required' } })
          return res.status(400).json(createErrorResponse(400, 'Bank details are required'));
        }
        
        // Map field names to match validation expectations
        const account_number = bank.acc_no || bank.account_number;
        const holder_name = bank.name || bank.holder_name;
        const bank_name = bank.bank_name;
        const ifsc_code = bank.ifsc || bank.ifsc_code;
        
        // Validate all required Indian bank fields
        if (!account_number) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'Account number is required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'Account number is required' } })
          return res.status(400).json(createErrorResponse(400, 'Account number is required'));
        }
        if (!holder_name) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'Account holder name is required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'Account holder name is required' } })
          return res.status(400).json(createErrorResponse(400, 'Account holder name is required'));
        }
        if (!bank_name) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'Bank name is required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'Bank name is required' } })
          return res.status(400).json(createErrorResponse(400, 'Bank name is required'));
        }
        if (!ifsc_code) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'IFSC code is required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'IFSC code is required' } })
          return res.status(400).json(createErrorResponse(400, 'IFSC code is required'));
        }
        
        // Validate using existing validation function
        const validation = validateBankIndiaData({ account_number, holder_name, bank_name, ifsc_code });
        
        if (!validation.valid) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: validation.error }) to res.status(400).json({ error: 'Validation failed', details: { error: validation.error } })
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

        // TODO: Convert createSuccessResponse('Changes saved successfully', { bank_india: { acc_no: validation.data.accountNumber, name: validation.data.holderName, bank_name: validation.data.bankName, ifsc: validation.data.ifscCode } }) to res.json({ success: true, message: 'Changes saved successfully', data: { bank_india: { acc_no: validation.data.accountNumber, name: validation.data.holderName, bank_name: validation.data.bankName, ifsc: validation.data.ifscCode } } })
        return res.json({
          success: true,
          message: 'Changes saved successfully',
          data: {
            bank_india: {
              acc_no: validation.data.accountNumber,
              name: validation.data.holderName,
              bank_name: validation.data.bankName,
              ifsc: validation.data.ifscCode
            }
          }
        });
      }

      case 'upi': {
        const { upi, upi_id } = requestBody;
        const upiId = upi || upi_id;
        
        // Validate UPI ID presence
        if (!upiId) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: 'UPI ID is required' }) to res.status(400).json({ error: 'Validation failed', details: { error: 'UPI ID is required' } })
          return res.status(400).json(createErrorResponse(400, 'UPI ID is required'));
        }
        
        // Validate UPI format using existing validation function
        const validation = validateUpiData({ upi_id: upiId });
        if (!validation.valid) {
          // TODO: Convert createErrorResponse(400, 'Validation failed', { error: validation.error }) to res.status(400).json({ error: 'Validation failed', details: { error: validation.error } })
          return res.status(400).json(createErrorResponse(400, validation.error));
        }

        // Update user with UPI configuration
        await updateUserPayoutMethod(userId, 'upi', validation.data.upiId);

        // TODO: Convert createSuccessResponse('Changes saved successfully', { upi: validation.data.upiId }) to res.json({ success: true, message: 'Changes saved successfully', data: { upi: validation.data.upiId } })
        return res.json({
          success: true,
          message: 'Changes saved successfully',
          data: {
            upi: validation.data.upiId
          }
        });
      }

      default:
        // TODO: Convert createErrorResponse(400, 'Unsupported payout type') to res.status(400).json({ error: 'Unsupported payout type' })
        return res.status(400).json(createErrorResponse(400, 'Unsupported payout type'));
    }

  } catch (error) {
    logError('[createPayoutMethodHandler] Error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Delete payout method for the authenticated user
 * 
 * Clears all payout method configuration for the authenticated user by
 * setting payment_gateway, bank, and paypal_account fields to empty strings.
 * This effectively removes all configured payout methods.
 * 
 * HTTP Method: DELETE
 * 
 * @param {object} req - Express request object with headers containing Authorization token
 * @returns {object} API response with deletion result or error response
 */
const deletePayoutMethod = async (req, res) => {
  try {
    // Extract and validate user authentication
    // TODO: Convert getAuthenticatedUserId(event, { action: 'payout_method deletePayoutMethodHandler' }) to getAuthenticatedUserId(req, { action: 'payout_method deletePayoutMethodHandler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'payout_method deletePayoutMethodHandler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Verify user exists before attempting deletion
    const user = await fetchUserPayoutDetails(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Delete payout method by clearing all payment-related fields
    const result = await deleteUserPayoutMethod(userId);
    
    if (result.affectedRows === 0) {
      // TODO: Convert createErrorResponse(404, 'User not found or no payout method to delete') to res.status(404).json({ error: 'User not found or no payout method to delete' })
      return res.status(404).json(createErrorResponse(404, 'User not found or no payout method to delete'));
    }

    // TODO: Convert createSuccessResponse('Payout method deleted successfully') to res.json({ success: true, message: 'Payout method deleted successfully' })
    return res.json({
      success: true,
      message: 'Payout method deleted successfully'
    });

  } catch (error) {
    logError('[deletePayoutMethodHandler] Error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Get payout conversations for the authenticated user
 * Retrieves conversations where type = '2' (payout) and user is either sender or receiver
 */
const getPayoutConversations = async (req, res) => {
  try {
    // Authenticate user and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'get payout conversations' }) to getAuthenticatedUserId(req, { action: 'get payout conversations' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      action: 'get payout conversations' 
    });

    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Get query parameters for pagination
    // TODO: Convert event.queryStringParameters to req.query
    const queryParams = req.query || {};
    const skip = parseInt(queryParams.skip) || 0;
    const limit = parseInt(queryParams.limit) || 10;

    logInfo('Fetching payout conversations', { userId, skip, limit });

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

    // TODO: Convert pool.query to getDB().query
    const [conversations] = await pool.query(query, [userId, userId, limit, skip]);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM ticket_conversations tc
      WHERE tc.type = '2' 
        AND (tc.user_id = ? OR tc.to_user_id = ?)
    `;

    // TODO: Convert pool.query to getDB().query
    const [countResult] = await pool.query(countQuery, [userId, userId]);
    const total = countResult[0]?.total || 0;

    logInfo('Successfully fetched payout conversations', { 
      userId, 
      count: conversations.length, 
      total 
    });

    // Calculate next pagination URL
    const nextSkip = skip + limit;
    let next = null;
    
    if (nextSkip < total) {
      const queryParams = new URLSearchParams();
      queryParams.set('skip', nextSkip.toString());
      queryParams.set('limit', limit.toString());
      next = `/payout/conversations?${queryParams.toString()}`;
    }

    // TODO: Convert Lambda response format to Express response format
    return res.status(200).json(createSuccessResponse('Payout conversations retrieved successfully', {
        conversations,
        pagination: {
          total,
          skip,
          limit,
          next
        }
      }));

  } catch (error) {
    logError('Error fetching payout conversations', { 
      error: error.message, 
      stack: error.stack 
    });

    // TODO: Convert Lambda response format to Express response format
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch payout conversations'));
  }
};

/**
 * Store a new payout conversation with media processing
 * Creates a new conversation entry in ticket_conversations table with type = '2'
 * Processes media files exactly like posts and messages do:
 * 1. Downloads files from S3 using provided keys
 * 2. Converts images to WebP format
 * 3. Uploads processed files back to S3
 * 4. Stores both original and processed paths in database
 */
const storePayoutConversation = async (req, res) => {
  try {
    // Authenticate user and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'store payout conversation' }) to getAuthenticatedUserId(req, { action: 'store payout conversation' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'store payout conversation' });
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
      logError('Error parsing request body:', parseError);
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    // Validate required fields - message is required, payout_image_keys is optional
    const { message, payout_image_keys } = requestBody;
    
    if (!message) {
      // TODO: Convert createErrorResponse(400, 'Missing required field: message is required') to res.status(400).json({ error: 'Missing required field: message is required' })
      return res.status(400).json(createErrorResponse(400, 'Missing required field: message is required'));
    }

    // Validate message length
    if (message.length > 255) {
      // TODO: Convert createErrorResponse(400, 'Message too long. Maximum 255 characters allowed.') to res.status(400).json({ error: 'Message too long. Maximum 255 characters allowed.' })
      return res.status(400).json(createErrorResponse(400, 'Message too long. Maximum 255 characters allowed.'));
    }

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      // TODO: Convert createErrorResponse(500, 'Media storage not configured') to res.status(500).json({ error: 'Media storage not configured' })
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files if provided (exactly like posts and messages do)
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
        
        // TODO: Convert createErrorResponse(500, 'Media processing failed', error.message) to res.status(500).json({ error: 'Media processing failed', details: error.message })
        return res.status(500).json(createErrorResponse(500, 'Media processing failed'));
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

    // TODO: Convert pool.query to getDB().query
    const [result] = await pool.query(insertQuery, insertParams);

    // TODO: Convert createSuccessResponse('Payout conversation stored successfully') to res.json({ success: true, message: 'Payout conversation stored successfully' })
    const response = { success: true, message: 'Payout conversation stored successfully' };
    
    // Override status code to 201 for resource creation
    // TODO: Convert response.statusCode = 201 to res.status(201)
    return res.status(201).json(createSuccessResponse('Payout method created successfully', response));

  } catch (error) {
    logError('Error storing payout conversation', { 
      error: error.message, 
      stack: error.stack 
    });

    // TODO: Convert createErrorResponse(500, 'Failed to store payout conversation') to res.status(500).json({ error: 'Failed to store payout conversation' })
    return res.status(500).json(createErrorResponse(500, 'Failed to store payout conversation'));
  }
};

/**
 * Handler to generate pre-signed S3 URLs for uploading payout conversation media files.
 * Uses the shared processUploadRequest utility to eliminate code duplication.
 * 
 * @param {object} req - Express request object
 * @returns {Promise<object>} API response with pre-signed URLs or error
 */
const getPayoutUploadUrl = async (req, res) => {
  // Configuration options for payout upload processing
  const uploadOptions = {
    action: 'getPayoutUploadUrl',
    basePath: 'uploads/payout',
    useFolderOrganization: false, // Payout uses flat structure
    successMessage: 'Pre-signed upload URLs generated for payout conversation',
    getAuthenticatedUserId
  };
  
  // Use shared upload processing utility and return result directly
  // TODO: Convert processUploadRequest(event, uploadOptions) to processUploadRequest(req, uploadOptions)
  const result = await processUploadRequest(req, uploadOptions);
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode === 200) {
    return res.status(200).json(createSuccessResponse('Payout method retrieved successfully', JSON.parse(result.body)));
  } else {
    return res.status(result.statusCode).json(createErrorResponse(result.statusCode, JSON.parse(result.body).message || JSON.parse(result.body).error));
  }
};

// Export all functions at the end
export {
  getPayoutMethod,
  createPayoutMethod,
  deletePayoutMethod,
  getPayoutConversations,
  storePayoutConversation,
  getPayoutUploadUrl
};