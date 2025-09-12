import { createSuccessResponse, createErrorResponse, logInfo, logError, getUserCountry, getUserById, processCurrencySettings, getFile } from '../utils/common.js';
import { validateProductInput, validateProductId } from '../validate/products.js';
import { getUserProducts, getProductByIdForUser, softDeleteProduct, insertProductMedia, mapProductType, formatProductsForResponse, formatProductForEdit, processFileUploadData, handleMediaProcessing, cleanupMediaFiles, getAvailableProductTags, getProductAdminSettings, processProductAdminSettings } from '../utils/product.js';
import { processUploadRequest } from '../utils/uploadUtils.js';

/**
 * Get product creation form data including pricing, tags, and currency
 */
export const getProductCreateData = async (req, res) => {
  const startTime = Date.now();
  
  try {
    const userId = req.userId;

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

    return res.json(createSuccessResponse(
      'Product creation data retrieved successfully',
      { tags, pricing, limits, currency }
    ));

  } catch (error) {
    const duration = Date.now() - startTime;
    logError('Product create data handler error:', { error: error.message, duration: `${duration}ms` });
    
    return res.status(500).json(error.message.includes('Failed to fetch')
      ? createErrorResponse(500, 'Internal server error. Unable to fetch required product data.')
      : createErrorResponse(500, 'Internal server error. Please try again later.'));
  }
};

/**
 * Retrieves paginated products for the authenticated user
 */
export const getProducts = async (req, res) => {
  try {
    const userId = req.userId;

    // Destructure and parse query parameters for pagination
    const { skip: skipRaw = 0, limit: limitRaw = 20 } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    // Fetch and format products from database (only active products for products page)
    const { products, totalCount } = await getUserProducts(userId, limit, skip, 'all', 'latest');
    const formattedProducts = formatProductsForResponse(products);
    
    logInfo('Products retrieved:', { userId, count: formattedProducts.length, total: totalCount });

    return res.json(createSuccessResponse('Products retrieved successfully', {
      product: formattedProducts,
      pagination: { 
        next: skip + limit < totalCount ? `/products?skip=${skip + limit}&limit=${limit}` : '' 
      },
    }));
  } catch (error) {
    logError('Error in getProducts:', error);
    return res.status(error.statusCode || 500).json(createErrorResponse(error.statusCode || 500, error.message || 'Internal Server Error'));
  }
};

/**
 * Creates a new product for the authenticated user
 */
export const createProduct = async (req, res) => {
  logInfo('Add product request received');
  try {
    const userId = req.userId;
    const body = req.body;

    const validationErrors = validateProductInput(body, { isUpdate: false });
    if (validationErrors.length > 0) {
      return res.status(400).json(createErrorResponse(400, 'Validation failed', { errors: validationErrors }));
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
      
      return res.status(500).json(createErrorResponse(500, 'Media processing failed', error.message));
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
      
      return res.status(500).json(createErrorResponse(500, 'Failed to save product to database', error.message));
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
      
      return res.status(500).json(createErrorResponse(500, 'Failed to save product media to database', error.message));
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

    return res.json(createSuccessResponse('Product saved successfully', { product: body }));
  } catch (error) {
    logError('Error in createProduct:', error);
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * Retrieves a specific product by ID for the authenticated user
 */
export const getProductById = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: productId } = req.params;

    // Validate product ID
    const { isValid, error } = validateProductId(productId);
    if (!isValid) return res.status(400).json(createErrorResponse(400, error));

    // Fetch product from database
    const product = await getProductByIdForUser(userId, productId);
    if (!product) return res.status(404).json(createErrorResponse(404, 'Product not found'));

    return res.json(createSuccessResponse('Product retrieved successfully', { 
      product: [formatProductForEdit(product)]
    }));
  } catch (error) {
    logError('Error in getProductById:', error);
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * Updates a specific product by ID for the authenticated user
 */
export const updateProduct = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: productId } = req.params;
    const body = req.body;

    // Validate product ID
    const { isValid, error } = validateProductId(productId);
    if (!isValid) return res.status(400).json(createErrorResponse(400, error));

    const validationErrors = validateProductInput(body, { isUpdate: true });
    if (validationErrors.length > 0) {
      return res.status(400).json(createErrorResponse(400, 'Validation failed', { errors: validationErrors }));
    }

    // Check if product exists and user owns it
    const existingProduct = await getProductByIdForUser(userId, productId);
    if (!existingProduct) return res.status(404).json(createErrorResponse(404, 'Product not found'));

    // Update product in database
    const { name, price, tags, description, delivery_time = 0 } = body;
    const updateSuccess = await updateProduct({ id: productId, userId, name, price, tags, description, delivery_time });
    if (!updateSuccess) return res.status(404).json(createErrorResponse(404, 'Product not found or not updated'));
    
    // Fetch and process updated product
    const updatedProduct = await getProductByIdForUser(userId, productId);
    
    return res.json(createSuccessResponse('Product updated successfully', { 
      product: [{
        ...updatedProduct,
        file: getFile(updatedProduct.file?.replace(/^uploads\//, '') || '')
      }]
    }));

  } catch (error) {
    logError('Error in updateProduct:', error);
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * Soft deletes a product by ID for the authenticated user
 */
export const deleteProduct = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: productId } = req.params;

    // Validate product ID
    const { isValid, error } = validateProductId(productId);
    if (!isValid) return res.status(400).json(createErrorResponse(400, error));

    // Check if product exists and user owns it
    const product = await getProductByIdForUser(userId, productId);
    if (!product) return res.status(404).json(createErrorResponse(404, 'Product not found'));

    // Perform soft delete
    const deleteSuccess = await softDeleteProduct(userId, productId);
    if (!deleteSuccess) return res.status(404).json(createErrorResponse(404, 'Product not found or not deleted'));

    return res.json(createSuccessResponse('Product deleted successfully', {}));
  } catch (error) {
    logError('Error in deleteProduct:', error);
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal Server Error'));
  }
};

/**
 * Get pre-signed S3 URLs for uploading product files
 */
export const getProductUploadUrl = async (req, res) => {
  try {
    const userId = req.userId;

    // Configuration options for products upload processing
    const uploadOptions = {
      action: 'getProductUploadUrl',
      basePath: 'uploads/shop',
      useFolderOrganization: false, // Products use flat structure without folder organization
      successMessage: 'Pre-signed product upload URLs generated',
      getAuthenticatedUserId: () => ({ userId, errorResponse: null })
    };
    
    // Use shared upload processing utility
    const result = await processUploadRequest(req, uploadOptions);
    
    return res.json(result);
  } catch (error) {
    logError('Error in getProductUploadUrl:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to generate upload URLs'));
  }
};
