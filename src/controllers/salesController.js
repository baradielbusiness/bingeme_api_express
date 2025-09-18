import { createSuccessResponse, createErrorResponse, getAuthenticatedUserId, logInfo, logError, getUserSalesList, updatePurchaseStatus, safeDecryptId, createExpressSuccessResponse, createExpressErrorResponse } from '../utils/common.js';

/**
 * Handler for GET /sales
 * Returns the authenticated user's sales list.
 * Exact implementation matching Lambda getMySales
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const getSales = async (req, res) => {
  try {
    
    // Extract and validate user authentication
    // TODO: Convert getAuthenticatedUserId(event, { action: 'my_sales.getMySales' }) to getAuthenticatedUserId(req, { action: 'my_sales.getMySales' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'my_sales.getMySales' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Destructure query parameters for sorting, filtering, and pagination
    // TODO: Convert event.queryStringParameters to req.query
    const { sort = null, filter = null, skip: skipRaw, limit: limitRaw } = req.query || {};
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    // Fetch sales list using a reusable DB utility
    const { sales, totalSales } = await getUserSalesList(userId, { sort, filter, skip, limit });
    // Log the result
    logInfo('Sales retrieved successfully', { userId, totalSales, returnedCount: sales.length });

    // Pagination next URL logic
    let next = '';
    if (skip + limit < totalSales) {
              next = `/sales?skip=${skip + limit}&limit=${limit}&sort=${sort}&filter=${filter}`;
    }

    // Return the sales data with pagination
    // TODO: Convert createSuccessResponse('Sales retrieved successfully', {...}) to res.status(200).json(createSuccessResponse('Sales retrieved successfully', {...}))
    return res.status(200).json(createSuccessResponse('Sales retrieved successfully', {
      sales,
      pagination: { next }
    }));
  } catch (error) {
    // Log and return error
    logError('Error fetching sales:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to fetch sales') to res.status(500).json({ error: 'Failed to fetch sales' })
    return res.status(500).json({ error: 'Failed to fetch sales' });
  }
};

/**
 * Handler for POST /sales/delivered-product/{id}
 * Marks a purchase as delivered for the authenticated user's product.
 * Exact implementation matching Lambda deliveredProduct
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const deliveredProduct = async (req, res) => {
  try {

    // Extract and validate user authentication
    // TODO: Convert getAuthenticatedUserId(event, { action: 'my_sales.deliveredProduct' }) to getAuthenticatedUserId(req, { action: 'my_sales.deliveredProduct' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'my_sales.deliveredProduct' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Validate HTTP method
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'POST') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed') to res.status(405).json({ error: 'Method not allowed' })
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Extract purchase ID from path parameters and decrypt it
    // TODO: Convert event.pathParameters to req.params
    const encryptedPurchaseId = req.params && req.params.id;
    if (!encryptedPurchaseId) {
      // TODO: Convert createErrorResponse(400, 'Purchase id is required in path') to res.status(400).json({ error: 'Purchase id is required in path' })
      return res.status(400).json({ error: 'Purchase id is required in path' });
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
      // TODO: Convert createErrorResponse(400, `Invalid purchase ID format: ${error.message}`) to res.status(400).json({ error: `Invalid purchase ID format: ${error.message}` })
      return res.status(400).json({ error: `Invalid purchase ID format: ${error.message}` });
    }

    // Update purchase status to 'delivered' using a reusable DB utility
    const result = await updatePurchaseStatus(userId, purchaseId, 'delivered');
    // Return success response with encrypted ID
    // TODO: Convert createSuccessResponse('Product delivered successfully', { purchase: [{ id: encryptedPurchaseId }] }) to res.status(200).json(createSuccessResponse('Product delivered successfully', { purchase: [{ id: encryptedPurchaseId }] }))
    return res.status(200).json(createSuccessResponse('Product delivered successfully', { purchase: [{ id: encryptedPurchaseId }] }));
  } catch (error) {
    // Log and return error
    logError('Error delivering product:', error);
    // TODO: Convert createErrorResponse(error.statusCode || 500, error.message || 'Internal Server Error') to res.status(error.statusCode || 500).json({ error: error.message || 'Internal Server Error' })
    return res.status(error.statusCode || 500).json({ error: error.message || 'Internal Server Error' });
  }
};

/**
 * Handler for POST /sales/reject-order/{id}
 * Marks a purchase as rejected for the authenticated user's product.
 * Exact implementation matching Lambda rejectOrder
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const rejectOrder = async (req, res) => {
  try {

    // Extract and validate user authentication
    // TODO: Convert getAuthenticatedUserId(event, { action: 'my_sales.rejectOrder' }) to getAuthenticatedUserId(req, { action: 'my_sales.rejectOrder' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'my_sales.rejectOrder' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Validate HTTP method
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'POST') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed') to res.status(405).json({ error: 'Method not allowed' })
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Extract purchase ID from path parameters and decrypt it
    // TODO: Convert event.pathParameters to req.params
    const encryptedPurchaseId = req.params && req.params.id;
    if (!encryptedPurchaseId) {
      // TODO: Convert createErrorResponse(400, 'Purchase id is required in path') to res.status(400).json({ error: 'Purchase id is required in path' })
      return res.status(400).json({ error: 'Purchase id is required in path' });
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
      // TODO: Convert createErrorResponse(400, `Invalid purchase ID format: ${error.message}`) to res.status(400).json({ error: `Invalid purchase ID format: ${error.message}` })
      return res.status(400).json({ error: `Invalid purchase ID format: ${error.message}` });
    }

    // Update purchase status to 'rejected' using a reusable DB utility
    const result = await updatePurchaseStatus(userId, purchaseId, 'rejected');
    // Return success response with encrypted ID
    // TODO: Convert createSuccessResponse('Product rejected successfully', { purchase: [{ id: encryptedPurchaseId }] }) to res.status(200).json(createSuccessResponse('Product rejected successfully', { purchase: [{ id: encryptedPurchaseId }] }))
    return res.status(200).json(createSuccessResponse('Product rejected successfully', { purchase: [{ id: encryptedPurchaseId }] }));
  } catch (error) {
    // Log and return error
    logError('Error rejecting order:', error);
    // TODO: Convert createErrorResponse(error.statusCode || 500, error.message || 'Internal Server Error') to res.status(error.statusCode || 500).json({ error: error.message || 'Internal Server Error' })
    return res.status(error.statusCode || 500).json({ error: error.message || 'Internal Server Error' });
  }
};
