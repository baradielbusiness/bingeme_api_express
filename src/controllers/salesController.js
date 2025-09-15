import { createSuccessResponse, createErrorResponse, logInfo, logError, getUserSalesList, updatePurchaseStatus, safeDecryptId, createExpressSuccessResponse, createExpressErrorResponse } from '../utils/common.js';

/**
 * Get user's sales list with filtering, sorting, and pagination
 */
export const getSales = async (req, res) => {
  try {
    const userId = req.userId;

    // Destructure query parameters for sorting, filtering, and pagination
    const { sort = null, filter = null, skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    // Fetch sales list using a reusable DB utility
    const { sales, totalSales } = await getUserSalesList(userId, { sort, filter, skip, limit });
    // Log the result
    logInfo('Sales retrieved successfully', { userId, totalSales, returnedCount: sales.length });

    // Pagination next URL logic
    let next = '';
    if (skip + limit < totalSales) {
      next = `/creator/payment-received?skip=${skip + limit}&limit=${limit}`;
    }

    // Return the sales data with pagination
    return res.json(createExpressSuccessResponse('Sales retrieved successfully', {
      sales,
      pagination: { next }
    }));
  } catch (error) {
    // Log and return error
    logError('Error fetching sales:', error);
    return res.status(500).json(createExpressErrorResponse('Failed to fetch sales', 500));
  }
};

/**
 * Mark a purchase as delivered
 */
export const deliveredProduct = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: encryptedPurchaseId } = req.params;

    if (!encryptedPurchaseId) {
      return res.status(400).json(createExpressErrorResponse('Purchase id is required in path', 400));
    }

    // Decrypt the encrypted purchase ID
    let purchaseId;
    try {
      purchaseId = safeDecryptId(encryptedPurchaseId);
      
      // Ensure the decrypted ID is a valid number
      if (typeof purchaseId !== 'number' || isNaN(purchaseId)) {
        throw new Error(`Decrypted ID is not a valid number: ${purchaseId} (type: ${typeof purchaseId})`);
      }
      
    } catch (error) {
      logError('Error decrypting purchase ID:', { 
        encryptedId: encryptedPurchaseId, 
        error: error.message
      });
      return res.status(400).json(createExpressErrorResponse(`Invalid purchase ID format: ${error.message}`, 400));
    }

    // Update purchase status to 'delivered' using a reusable DB utility
    const result = await updatePurchaseStatus(userId, purchaseId, 'delivered');
    // Return success response with encrypted ID
    return res.json(createExpressSuccessResponse('Product delivered successfully', { purchase: [{ id: encryptedPurchaseId }] }));
  } catch (error) {
    // Log and return error
    logError('Error delivering product:', error);
    return res.status(error.statusCode || 500).json(createExpressErrorResponse(error.message || 'Internal Server Error', error.statusCode || 500));
  }
};

/**
 * Mark a purchase as rejected
 */
export const rejectOrder = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: encryptedPurchaseId } = req.params;

    if (!encryptedPurchaseId) {
      return res.status(400).json(createExpressErrorResponse('Purchase id is required in path', 400));
    }

    // Decrypt the encrypted purchase ID
    let purchaseId;
    try {
      purchaseId = safeDecryptId(encryptedPurchaseId);
      
      // Ensure the decrypted ID is a valid number
      if (typeof purchaseId !== 'number' || isNaN(purchaseId)) {
        throw new Error(`Decrypted ID is not a valid number: ${purchaseId} (type: ${typeof purchaseId})`);
      }
      
    } catch (error) {
      logError('Error decrypting purchase ID:', { 
        encryptedId: encryptedPurchaseId, 
        error: error.message
      });
      return res.status(400).json(createExpressErrorResponse(`Invalid purchase ID format: ${error.message}`, 400));
    }

    // Update purchase status to 'rejected' using a reusable DB utility
    const result = await updatePurchaseStatus(userId, purchaseId, 'rejected');
    // Return success response with encrypted ID
    return res.json(createExpressSuccessResponse('Product rejected successfully', { purchase: [{ id: encryptedPurchaseId }] }));
  } catch (error) {
    // Log and return error
    logError('Error rejecting order:', error);
    return res.status(error.statusCode || 500).json(createExpressErrorResponse(error.message || 'Internal Server Error', error.statusCode || 500));
  }
};
