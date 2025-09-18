import { createSuccessResponse, createErrorResponse, logInfo, logError, getUserCountry, getUserById, processCurrencySettings, getFile, createExpressSuccessResponse, createExpressErrorResponse, getAuthenticatedUserId, decryptId, isEncryptedId } from '../utils/common.js';
import { validateProductInput, validateProductId } from '../validate/products.js';
import { getUserProducts, getProductByIdForUser, createProduct, updateProduct, softDeleteProduct, insertProductMedia, mapProductType, formatProductsForResponse, formatProductForEdit, processFileUploadData, handleMediaProcessing, cleanupMediaFiles, getAvailableProductTags, getProductAdminSettings, processProductAdminSettings } from '../utils/product.js';
import { processUploadRequest } from '../utils/uploadUtils.js';

/**
 * Decrypts product ID from encrypted format to database ID
 * @param {string} encryptedId - Encrypted product ID from client
 * @returns {number} Decrypted product ID for database operations
 */
const decryptProductId = (encryptedId) => {
  try {
    // Check if the ID is encrypted (24-character string)
    if (isEncryptedId(encryptedId)) {
      return decryptId(encryptedId);
    }
    
    // If it's a plain number string, parse it
    const parsedId = parseInt(encryptedId, 10);
    if (!isNaN(parsedId) && parsedId > 0) {
      return parsedId;
    }
    
    throw new Error('Invalid product ID format');
  } catch (error) {
    logError('Failed to decrypt product ID:', { encryptedId, error: error.message });
    throw new Error('Invalid product ID');
  }
};

/**
 * GET /products/create - Provides product creation form data including pricing, tags, and currency
 * Exact implementation matching Lambda getProductCreateHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with product creation form data
 */
export const getProductCreateData = async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Authenticate user (early return on failure)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'product creation data' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'product creation data' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'product creation data' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Validate HTTP method
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'GET') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed') to res.status(405).json({ error: 'Method not allowed' })
      return res.status(405).json(createErrorResponse(405, 'Method not allowed'));
    }

    // Get user country for currency determination
    const userCountry = await getUserCountry(req, await getUserById(userId));

    // Fetch data in parallel for optimal performance
    const [tags, adminSettings] = await Promise.all([
      getAvailableProductTags(),
      getProductAdminSettings()
    ]);

    // Process settings and create response
    const { pricing, limits } = processProductAdminSettings(adminSettings, userCountry);
    const { currency } = processCurrencySettings(adminSettings, userCountry);

    // Log success with performance metrics
    const duration = Date.now() - startTime;
    logInfo('Product create data retrieved successfully:', {
      userId,
      userCountry,
      tagsCount: tags.length,
      pricing: `${pricing.min_price}-${pricing.max_price}`,
      limits: `${limits.max_description_length}chars/${limits.max_file_size}bytes`,
      currency: `${currency.symbol} ${currency.code} (${currency.coin_conversion_rate})`,
      duration: `${duration}ms`
    });

    // TODO: Convert createSuccessResponse('Product creation data retrieved successfully', { tags, pricing, limits, currency }) to res.status(200).json(createSuccessResponse('Product creation data retrieved successfully', { tags, pricing, limits, currency }))
    return res.status(200).json(createSuccessResponse(
      'Product creation data retrieved successfully',
      { tags, pricing, limits, currency }
    ));

  } catch (error) {
    const duration = Date.now() - startTime;
    logError('Product create data handler error:', { error: error.message, duration: `${duration}ms` });
    
    // TODO: Convert error.message.includes('Failed to fetch') ? createErrorResponse(500, 'Internal server error. Unable to fetch required product data.') : createErrorResponse(500, 'Internal server error. Please try again later.') to res.status(500).json(error.message.includes('Failed to fetch') ? { error: 'Internal server error. Unable to fetch required product data.' } : { error: 'Internal server error. Please try again later.' })
    return res.status(500).json(createErrorResponse(500, error.message.includes('Failed to fetch')
      ? 'Internal server error. Unable to fetch required product data.'
      : 'Internal server error. Please try again later.'));
  }
};

/**
 * GET /products - Retrieves paginated products for the authenticated user
 * Exact implementation matching Lambda getProductHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with products and pagination info
 */
export const getProducts = async (req, res) => {
  try {
    // Extract and validate user authentication
    // TODO: Convert getAuthenticatedUserId(event, { action: 'products' }) to getAuthenticatedUserId(req, { action: 'products' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'products' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Destructure and parse query parameters for pagination and filtering
    // TODO: Convert event.queryStringParameters to req.query
    const { skip: skipRaw = 0, limit: limitRaw = 20, filter: filterRaw = 'all' } = req.query || {};
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;
    const filter = filterRaw.toLowerCase(); // digital, custom, or all

    // Fetch and format products from database with filtering
    const { products, totalCount } = await getUserProducts(userId, limit, skip, 'all', 'latest', filter);
    const formattedProducts = formatProductsForResponse(products);
    
    logInfo('Products retrieved:', { userId, count: formattedProducts.length, total: totalCount });

    // TODO: Convert createSuccessResponse('Products retrieved successfully', { product: formattedProducts, pagination: { next: skip + limit < totalCount ? `/products?skip=${skip + limit}&limit=${limit}` : '' } }) to res.status(200).json(createSuccessResponse('Products retrieved successfully', { product: formattedProducts, pagination: { next: skip + limit < totalCount ? `/products?skip=${skip + limit}&limit=${limit}` : '' } }))
    return res.status(200).json(createSuccessResponse('Products retrieved successfully', {
      product: formattedProducts,
      pagination: { 
        next: skip + limit < totalCount ? `/products?skip=${skip + limit}&limit=${limit}` : '' 
      },
    }));
  } catch (error) {
    // Error handling
    logError('Error in getProduct handler:', error);
    // TODO: Convert createErrorResponse(error.statusCode || 500, error.message || 'Internal Server Error') to res.status(error.statusCode || 500).json({ error: error.message || 'Internal Server Error' })
    return res.status(error.statusCode || 500).json(createErrorResponse(error.statusCode || 500, error.message || 'Internal Server Error'));
  }
};

/**
 * POST /product/create - Creates a new product for the authenticated user
 * Exact implementation matching Lambda createProductHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with created product info
 */
export const createProduct = async (req, res) => {
  logInfo('Add product request received');
  try {
    // Authenticate user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'creation' }) to getAuthenticatedUserId(req, { action: 'creation' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'creation' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Parse and validate request body
    let body;
    try {
      // TODO: Convert JSON.parse(event.body) to req.body
      body = req.body;
    } catch (parseError) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const validationErrors = validateProductInput(body, { isUpdate: false });
    if (validationErrors.length > 0) {
      // TODO: Convert createErrorResponse(400, 'Validation failed', { errors: validationErrors }) to res.status(400).json({ error: 'Validation failed', errors: validationErrors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    // Extract and prepare product data
    const { name, price, delivery_time = 0, tags, description, type } = body;

    // Process file uploads
    const filePaths = processFileUploadData(body['fileuploader-list-file']);
    const previewPaths = processFileUploadData(body['fileuploader-list-preview']);

    // Get S3 configuration
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      // TODO: Convert createErrorResponse(500, 'Media storage not configured') to res.status(500).json({ error: 'Media storage not configured' })
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files
    let processedFiles = { original: [], converted: [] };
    let processedPreviews = { original: [], converted: [] };

    try {
      // Process files in parallel
      [processedFiles, processedPreviews] = await Promise.all([
        handleMediaProcessing(filePaths, bucketName, 'product'),
        handleMediaProcessing(previewPaths, bucketName, 'product')
      ]);
      
    } catch (error) {
      // Clean up any processed files on error
      await Promise.all([
        cleanupMediaFiles(processedFiles.original, processedFiles.converted, bucketName, 'product'),
        cleanupMediaFiles(processedPreviews.original, processedPreviews.converted, bucketName, 'product')
      ]);
      
      // TODO: Convert createErrorResponse(500, 'Media processing failed', error.message) to res.status(500).json({ error: 'Media processing failed', details: error.message })
      return res.status(500).json(createErrorResponse(500, 'Media processing failed'));
    }

    // Create product in database
    let productId;
    try {
      // Strip 'uploads/shop/' prefix before storing main file in DB
      const mainFileKey = processedFiles.original[0] || '';
      const mainFileName = typeof mainFileKey === 'string'
        ? mainFileKey.replace(/^uploads\/shop\//, '')
        : '';

      productId = await createProduct({ userId, name, type, price, delivery_time, tags, description, file: mainFileName });
      
      logInfo('Product saved to database:', { productId });

    } catch (error) {
      logError('Database product save failed:', error);
      
      // Clean up S3 files on database error
      await Promise.all([
        cleanupMediaFiles(processedFiles.original, processedFiles.converted, bucketName, 'product'),
        cleanupMediaFiles(processedPreviews.original, processedPreviews.converted, bucketName, 'product')
      ]);
      
      // TODO: Convert createErrorResponse(500, 'Failed to save product to database', error.message) to res.status(500).json({ error: 'Failed to save product to database', details: error.message })
      return res.status(500).json(createErrorResponse(500, 'Failed to save product to database'));
    }

    // Insert media files into database
    try {
      await insertProductMedia(productId, [...processedPreviews.original, ...processedFiles.original]);
      logInfo('Product media saved to database');
      
    } catch (error) {
      logError('Database media save failed:', error);
      
      // Clean up S3 files on media save error
      await Promise.all([
        cleanupMediaFiles(processedFiles.original, processedFiles.converted, bucketName, 'product'),
        cleanupMediaFiles(processedPreviews.original, processedPreviews.converted, bucketName, 'product')
      ]);
      
      // TODO: Convert createErrorResponse(500, 'Failed to save product media to database', error.message) to res.status(500).json({ error: 'Failed to save product media to database', details: error.message })
      return res.status(500).json(createErrorResponse(500, 'Failed to save product media to database'));
    }

    // Log successful creation with metrics
    logInfo('Product created successfully:', { 
      productId, 
      userId, 
      files: `${processedFiles.original.length}+${processedFiles.converted.length}`,
      previews: `${processedPreviews.original.length}+${processedPreviews.converted.length}`,
      type: mapProductType(type),
      price
    });

    // TODO: Convert createSuccessResponse('Product saved successfully', { product: body }) to res.status(200).json(createSuccessResponse('Product saved successfully', { product: body }))
    return res.status(200).json(createSuccessResponse('Product saved successfully', { product: body }));
  } catch (error) {
    logError('Error in createProductHandler:', error);
    // TODO: Convert createErrorResponse(500, error.message || 'Internal Server Error') to res.status(500).json({ error: error.message || 'Internal Server Error' })
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * GET /product/edit/{id} - Retrieves a specific product by ID for the authenticated user
 * Exact implementation matching Lambda editProductGetHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with product data
 */
export const getProductById = async (req, res) => {
  try {
    // Authenticate user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'edit' }) to getAuthenticatedUserId(req, { action: 'edit' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'edit' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Get and decrypt product ID from path parameters
    // TODO: Convert event.pathParameters to req.params
    const { id: encryptedProductId } = req.params || {};
    if (!encryptedProductId) {
      // TODO: Convert createErrorResponse(400, 'Product ID is required') to res.status(400).json({ error: 'Product ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Product ID is required'));
    }

    let productId;
    try {
      // TODO: Convert decryptProductId(encryptedProductId) to decryptProductId(encryptedProductId)
      productId = decryptProductId(encryptedProductId);
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid product ID format') to res.status(400).json({ error: 'Invalid product ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid product ID format'));
    }

    // Fetch product from database
    const product = await getProductByIdForUser(userId, productId);
    if (!product) {
      // TODO: Convert createErrorResponse(404, 'Product not found') to res.status(404).json({ error: 'Product not found' })
      return res.status(404).json(createErrorResponse(404, 'Product not found'));
    }

    // TODO: Convert createSuccessResponse('Product retrieved successfully', { product: [formatProductForEdit(product)] }) to res.status(200).json(createSuccessResponse('Product retrieved successfully', { product: [formatProductForEdit(product)] }))
    return res.status(200).json(createSuccessResponse('Product retrieved successfully', { 
      product: [formatProductForEdit(product)]
    }));
  } catch (error) {
    logError('Error in editProductGetHandler:', error);
    // TODO: Convert createErrorResponse(500, error.message || 'Internal Server Error') to res.status(500).json({ error: error.message || 'Internal Server Error' })
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * PUT /product/edit/{id} - Updates a specific product by ID for the authenticated user
 * Exact implementation matching Lambda editProductPutHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with updated product data
 */
export const updateProduct = async (req, res) => {
  try {
    // Authenticate user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'edit' }) to getAuthenticatedUserId(req, { action: 'edit' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'edit' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Validate HTTP method
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'PUT') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed') to res.status(405).json({ error: 'Method not allowed' })
      return res.status(405).json(createErrorResponse(405, 'Method not allowed'));
    }

    // Get and decrypt product ID from path parameters
    // TODO: Convert event.pathParameters to req.params
    const { id: encryptedProductId } = req.params || {};
    if (!encryptedProductId) {
      // TODO: Convert createErrorResponse(400, 'Product ID is required') to res.status(400).json({ error: 'Product ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Product ID is required'));
    }

    let productId;
    try {
      productId = decryptProductId(encryptedProductId);
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid product ID format') to res.status(400).json({ error: 'Invalid product ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid product ID format'));
    }

    // Parse and validate request body
    let body;
    try {
      // TODO: Convert JSON.parse(event.body) to req.body
      body = req.body;
    } catch (parseError) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const validationErrors = validateProductInput(body, { isUpdate: true });
    if (validationErrors.length > 0) {
      // TODO: Convert createErrorResponse(400, 'Validation failed', { errors: validationErrors }) to res.status(400).json({ error: 'Validation failed', errors: validationErrors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    // Check if product exists and user owns it
    const existingProduct = await getProductByIdForUser(userId, productId);
    if (!existingProduct) {
      // TODO: Convert createErrorResponse(404, 'Product not found') to res.status(404).json({ error: 'Product not found' })
      return res.status(404).json(createErrorResponse(404, 'Product not found'));
    }

    // Update product in database
    const { name, price, tags, description, delivery_time = 0 } = body;
    const updateSuccess = await updateProduct({ id: productId, userId, name, price, tags, description, delivery_time });
    if (!updateSuccess) {
      // TODO: Convert createErrorResponse(404, 'Product not found or not updated') to res.status(404).json({ error: 'Product not found or not updated' })
      return res.status(404).json(createErrorResponse(404, 'Product not found or not updated'));
    }
    
    // Fetch and process updated product
    const updatedProduct = await getProductByIdForUser(userId, productId);
    
    // TODO: Convert createSuccessResponse('Product updated successfully', { product: [formatProductForEdit(updatedProduct)] }) to res.status(200).json(createSuccessResponse('Product updated successfully', { product: [formatProductForEdit(updatedProduct)] }))
    return res.status(200).json(createSuccessResponse('Product updated successfully', { 
      product: [formatProductForEdit(updatedProduct)]
    }));

  } catch (error) {
    logError('Error in editProductPutHandler:', error);
    // TODO: Convert createErrorResponse(500, error.message || 'Internal Server Error') to res.status(500).json({ error: error.message || 'Internal Server Error' })
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * DELETE /product/delete/{id} - Soft deletes a product by ID for the authenticated user
 * Exact implementation matching Lambda deleteProductHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response confirming deletion
 */
export const deleteProduct = async (req, res) => {
  try {
    // Authenticate user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'delete' }) to getAuthenticatedUserId(req, { action: 'delete' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'delete' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Validate HTTP method
    // TODO: Convert event.httpMethod to req.method
    if (req.method !== 'DELETE') {
      // TODO: Convert createErrorResponse(405, 'Method not allowed') to res.status(405).json({ error: 'Method not allowed' })
      return res.status(405).json(createErrorResponse(405, 'Method not allowed'));
    }

    // Get and decrypt product ID from path parameters
    // TODO: Convert event.pathParameters to req.params
    const { id: encryptedProductId } = req.params || {};
    if (!encryptedProductId) {
      // TODO: Convert createErrorResponse(400, 'Product ID is required') to res.status(400).json({ error: 'Product ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Product ID is required'));
    }

    let productId;
    try {
      productId = decryptProductId(encryptedProductId);
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid product ID format') to res.status(400).json({ error: 'Invalid product ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid product ID format'));
    }

    // Check if product exists and user owns it
    const product = await getProductByIdForUser(userId, productId);
    if (!product) {
      // TODO: Convert createErrorResponse(404, 'Product not found') to res.status(404).json({ error: 'Product not found' })
      return res.status(404).json(createErrorResponse(404, 'Product not found'));
    }

    // Perform soft delete
    const deleteSuccess = await softDeleteProduct(userId, productId);
    if (!deleteSuccess) {
      // TODO: Convert createErrorResponse(404, 'Product not found or not deleted') to res.status(404).json({ error: 'Product not found or not deleted' })
      return res.status(404).json(createErrorResponse(404, 'Product not found or not deleted'));
    }

    // TODO: Convert createSuccessResponse('Product deleted successfully', {}) to res.status(200).json(createSuccessResponse('Product deleted successfully', {}))
    return res.status(200).json(createSuccessResponse('Product deleted successfully', {}));
  } catch (error) {
    logError('Error in deleteProduct handler:', error);
    // TODO: Convert createErrorResponse(500, error.message || 'Internal Server Error') to res.status(500).json({ error: error.message || 'Internal Server Error' })
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * GET /product/upload-url - Get pre-signed S3 URLs for uploading product files
 * Exact implementation matching Lambda getProductUploadUrlHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with pre-signed URLs or error
 */
export const getProductUploadUrl = async (req, res) => {
  try {
    // Configuration options for products upload processing with destructuring
    const uploadOptions = {
      action: 'getProductUploadUrl',
      basePath: 'uploads/shop',
      useFolderOrganization: false, // Products use flat structure without folder organization
      successMessage: 'Pre-signed product upload URLs generated',
      getAuthenticatedUserId
    };
    
    // Use shared upload processing utility and return result directly
    // TODO: Convert processUploadRequest(event, uploadOptions) to processUploadRequest(req, uploadOptions)
    const result = await processUploadRequest(req, uploadOptions);
    
    // TODO: Convert return result to return res.status(result.statusCode).json(JSON.parse(result.body))
    if (result.statusCode === 200) {
      return res.status(200).json(createSuccessResponse('Product upload URL generated successfully', JSON.parse(result.body)));
    } else {
      return res.status(result.statusCode).json(createErrorResponse(result.statusCode, JSON.parse(result.body).message || JSON.parse(result.body).error));
    }
  } catch (error) {
    logError('Error in getProductUploadUrl:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to generate upload URLs') to res.status(500).json({ error: 'Failed to generate upload URLs' })
    return res.status(500).json(createErrorResponse(500, 'Failed to generate upload URLs'));
  }
};
