import { pool, getDB } from '../config/database.js';
import { logInfo, logError, encryptId, getFile } from './common.js';
import { processMediaFiles } from './mediaProcessing.js';

/**
 * Get user products
 */
const getUserProducts = async (userId, limit = 20, skip = 0, status = 'all', sortBy = 'latest') => {
  try {
    let whereClause = "WHERE p.user_id = ? AND p.status != '2'";
    let orderClause = 'ORDER BY p.created_at DESC';
    
    if (status !== 'all') {
      whereClause += ` AND p.status = '${status}'`;
    }
    
    if (sortBy === 'name') {
      orderClause = 'ORDER BY p.name ASC';
    }
    
    const query = `
      SELECT 
        p.id,
        p.name,
        p.price,
        p.delivery_time,
        p.tags,
        p.description,
        p.type,
        p.status,
        p.created_at,
        p.updated_at,
        mp.name as image,
        COALESCE(purchase_counts.purchases_count, 0) as purchases_count
      FROM products p
      LEFT JOIN media_products mp ON p.id = mp.products_id 
        AND mp.id = (SELECT MIN(id) FROM media_products WHERE products_id = p.id)
      LEFT JOIN (
        SELECT 
          products_id,
          COUNT(*) as purchases_count
        FROM purchases 
        WHERE delivery_status != 'rejected' 
          AND status != '2'
        GROUP BY products_id
      ) as purchase_counts ON p.id = purchase_counts.products_id
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;
    
    const [products] = await pool.query(query, [userId, limit, skip]);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM products p ${whereClause}`;
    const [countResult] = await pool.query(countQuery, [userId]);
    const totalCount = countResult[0].total;
    
    return { products, totalCount };
  } catch (error) {
    logError('Error getting user products:', error);
    throw error;
  }
};

/**
 * Get product by ID for user
 */
const createProduct = async (productData) => {
  try {
    const { userId, name, type, price, delivery_time, tags, description, file } = productData;
    const db = await getDB();
    
    const [result] = await db.execute(`
      INSERT INTO products (user_id, name, type, price, delivery_time, tags, description, file, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '1', NOW(), NOW())
    `, [userId, name, type, price, delivery_time, tags, description, file]);
    
    logInfo('Product created successfully', { productId: result.insertId, userId });
    return result.insertId;
  } catch (error) {
    logError('Error creating product:', error);
    throw error;
  }
};

const getProductByIdForUser = async (userId, productId) => {
  try {
    const query = `
      SELECT 
        id,
        name,
        price,
        delivery_time,
        tags,
        description,
        type,
        status,
        created_at,
        updated_at
      FROM products 
      WHERE id = ? AND user_id = ? AND status != '2'
    `;
    
    const [rows] = await pool.query(query, [productId, userId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting product by ID:', error);
    return null;
  }
};

/**
 * Update product
 */
const updateProduct = async (productData) => {
  try {
    const { id, userId, name, price, delivery_time, tags, description, type, status } = productData || {};
    if (!id) {
      throw new Error('Product ID is required');
    }

    const query = `
      UPDATE products 
      SET name = ?, price = ?, delivery_time = ?, tags = ?, description = ?, 
          ${typeof type !== 'undefined' ? 'type = ?,' : ''} 
          ${typeof status !== 'undefined' ? 'status = ?,' : ''}
          updated_at = NOW() 
      WHERE id = ? ${userId ? 'AND user_id = ?' : ''} AND status != '2'
    `;

    const params = [name, price, delivery_time, tags, description];
    if (typeof type !== 'undefined') params.push(type);
    if (typeof status !== 'undefined') params.push(status);
    params.push(id);
    if (userId) params.push(userId);

    const [result] = await pool.query(query, params);
    logInfo('Updated product', { id, affectedRows: result.affectedRows });
    return result.affectedRows > 0;
  } catch (error) {
    logError('Error updating product:', error);
    throw error;
  }
};

/**
 * Soft delete product
 */
const softDeleteProduct = async (userId, productId) => {
  try {
    const query = `UPDATE products SET status = "2", updated_at = NOW() WHERE id = ? AND user_id = ? AND status != "2"`;
    const [result] = await pool.query(query, [productId, userId]);
    logInfo('Soft deleted product', { productId, userId, affectedRows: result.affectedRows });
    return result.affectedRows > 0;
  } catch (error) {
    logError('Error soft deleting product:', error);
    throw error;
  }
};

/**
 * Insert product media
 * @param {number} productId - Product ID to associate media with
 * @param {Array<string>} filePaths - Array of file paths to insert
 * @param {string} [status='active'] - Media status
 * @returns {Promise<void>}
 */
const insertProductMedia = async (productId, filePaths, status = 'active') => {
  try {
    for (const filePath of filePaths) {
      if (filePath) {
        // Remove 'uploads/shop/' prefix before storing in DB to keep only filename
        const normalizedPath = typeof filePath === 'string' ? filePath.replace(/^uploads\/shop\//, '') : filePath;
        // Extract file extension using destructuring with split
        const [...pathParts] = normalizedPath.split('.');
        const fileExtension = pathParts.pop();
        
        // For preview images, convert extension to webp as they are processed
        const displayName = normalizedPath.includes('preview') 
          ? normalizedPath.replace(/\.[^/.]+$/, '.webp')
          : normalizedPath;

        await pool.query(
          `INSERT INTO media_products (products_id, name, media_extension, created_at, updated_at, status)
           VALUES (?, ?, ?, NOW(), NOW(), ?)`,
          [productId, displayName, fileExtension, status]
        );
      }
    }
  } catch (error) {
    logError('Error inserting product media:', error);
    throw error;
  }
};

/**
 * Map product type
 */
const mapProductType = (type) => {
  const typeMap = {
    'physical': 'Physical Product',
    'digital': 'Digital Product',
    'service': 'Service'
  };
  return typeMap[type] || type;
};

/**
 * Format products for response
 */
const formatProductsForResponse = (products) => {
  return products.map(product => ({
    id: encryptId(product.id), // Encrypt product ID for security
    name: product.name,
    type: product.type,
    price: product.price,
    description: product.description,
    tags: product.tags, // Keep tags as stored string
    delivery_time: product.delivery_time,
    image: product.image ? getFile(`shop/${product.image}`) : null,
    status: product.status,
    created_at: new Date(product.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    purchases_count: product.purchases_count
  }));
};

/**
 * Format product for edit
 */
const formatProductForEdit = (product) => {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    delivery_time: product.delivery_time,
    // Return tags as-is if not JSON
    tags: (() => { try { return product.tags ? JSON.parse(product.tags) : []; } catch { return product.tags || []; } })(),
    description: product.description,
    type: product.type,
    status: product.status
  };
};

/**
 * Process file upload data
 */
const processFileUploadData = (fileData) => {
  if (!fileData || !Array.isArray(fileData)) {
    return [];
  }
  return fileData.map(file => ({
    media_path: file.media_path,
    media_type: file.media_type,
    media_size: file.media_size
  }));
};

/**
 * Handle media processing
 */
const handleMediaProcessing = async (filePaths, bucketName, mediaType) => {
  if (filePaths.length === 0) {
    return { original: [], converted: [] };
  }

  try {
    logInfo(`Starting ${mediaType} file processing:`, { fileCount: filePaths.length });
    const processedFiles = await processMediaFiles(filePaths, bucketName, mediaType);
    logInfo(`${mediaType} file processing completed successfully`);
    return processedFiles;
  } catch (error) {
    logError(`${mediaType} file processing failed:`, { error: error.message });
    throw error;
  }
};

/**
 * Cleanup media files
 */
const cleanupMediaFiles = async (fileKeys) => {
  // This would integrate with S3 cleanup
  return true;
};

/**
 * Get available product tags
 */
const getAvailableProductTags = async () => {
  try {
    const [rows] = await pool.execute(
      `SELECT tag FROM tags WHERE sample = 1 ORDER BY tag ASC LIMIT ${PRODUCT_CONFIG.MAX_TAGS_LIMIT}`
    );
    
    return rows.map(({ tag }) => tag);
  } catch (error) {
    logError('Database error fetching product tags:', error);
    throw new Error('Failed to fetch available product tags');
  }
};

/**
 * Get product admin settings
 */
const getProductAdminSettings = async () => {
  try {
    // Query for product-specific settings that actually exist in the database
    const [rows] = await pool.execute(
      'SELECT min_price_product as min_product_amount, max_price_product as max_product_amount, update_length as product_description_length, currency_symbol, currency_code, coin_conversion_USD, file_size_allowed, min_price_product_usd, max_price_product_usd FROM admin_settings LIMIT 1'
    );
    
    // Use destructuring with default values for fallback logic
    const [firstRow] = rows;
    
    // If we got data, return it, otherwise use defaults
    return firstRow ?? DEFAULT_PRODUCT_SETTINGS;
  } catch (error) {
    logError('Database error fetching product admin settings:', error);
    throw new Error('Failed to fetch product admin settings');
  }
};

/**
 * Default settings for fallback when admin settings unavailable
 */
const DEFAULT_PRODUCT_SETTINGS = {
  min_product_amount: 1,
  max_product_amount: 5000,
  product_description_length: 2000,
  currency_symbol: '₹',
  currency_code: 'INR',
  coin_conversion_USD: 50,
  file_size_allowed: 1000,
};

/**
 * Configuration constants for product creation
 */
const PRODUCT_CONFIG = {
  MAX_TAGS_LIMIT: 100,
  MIN_PRICE: 1,
  MIN_DESCRIPTION_LENGTH: 100,
};

/**
 * Process product admin settings
 */
const processProductAdminSettings = (settings, userCountry = 'IN') => {
  const {
    min_product_amount = DEFAULT_PRODUCT_SETTINGS.min_product_amount,
    max_product_amount = DEFAULT_PRODUCT_SETTINGS.max_product_amount,
    min_price_product_usd = DEFAULT_PRODUCT_SETTINGS.min_product_amount,
    max_price_product_usd = DEFAULT_PRODUCT_SETTINGS.max_product_amount,
    product_description_length = DEFAULT_PRODUCT_SETTINGS.product_description_length,
    file_size_allowed = DEFAULT_PRODUCT_SETTINGS.file_size_allowed
  } = settings;

  // Use destructuring and Math.max for cleaner validation
  const { MIN_PRICE, MIN_DESCRIPTION_LENGTH } = PRODUCT_CONFIG;
  const { min_product_amount: defaultMin, max_product_amount: defaultMax, product_description_length: defaultDesc, file_size_allowed: defaultFileSize } = DEFAULT_PRODUCT_SETTINGS;
  
  // Determine pricing based on user country (similar to PHP Helper logic)
  let minPrice, maxPrice;
  if (userCountry === 'IN') {
    // Use local currency pricing for India
    minPrice = Math.max(MIN_PRICE, parseInt(min_product_amount) || defaultMin);
    maxPrice = Math.max(MIN_PRICE, parseInt(max_product_amount) || defaultMax);
  } else {
    // Use USD pricing for other countries
    minPrice = Math.max(MIN_PRICE, parseInt(min_price_product_usd) || defaultMin);
    maxPrice = Math.max(MIN_PRICE, parseInt(max_price_product_usd) || defaultMax);
  }
  
  return {
    pricing: {
      min_price: minPrice,
      max_price: maxPrice
    },
    limits: {
      max_description_length: Math.max(MIN_DESCRIPTION_LENGTH, parseInt(product_description_length) || defaultDesc),
      max_file_size: Math.max(MIN_DESCRIPTION_LENGTH, parseInt(file_size_allowed) || defaultFileSize) / 1000
    }
  };
};

/**
 * Get user digital and custom products (Lambda function)
 */
const getUserDigitalAndCustomProducts = async (userId, limit = 20, skip = 0, statusFilter = 'all', sort = 'latest') => {
  try {
    // Build status condition based on filter
    let statusCondition = '';
    let countStatusCondition = '';
    
    if (statusFilter === 'active') {
      statusCondition = 'AND p.status = "1"';
      countStatusCondition = 'AND status = "1"';
    } else if (statusFilter === 'disabled') {
      statusCondition = 'AND p.status = "0"';
      countStatusCondition = 'AND status = "0"';
    } else {
      // 'all' - include both active (1) and disabled (0), exclude deleted (2)
      statusCondition = 'AND p.status IN ("0", "1")';
      countStatusCondition = 'AND status IN ("0", "1")';
    }

    // Build order by clause based on sort option
    let orderByClause = 'p.created_at DESC'; // Default
    if (statusFilter === 'active') {
      // For active products, support all sort options
      switch (sort) {
        case 'subscription':
          orderByClause = 'p.price ASC, p.id DESC'; // Lowest price first
          break;
        case 'oldest':
          orderByClause = 'p.id ASC'; // Oldest first
          break;
        case 'latest':
          orderByClause = 'p.id DESC'; // Newest first
          break;
        default:
          orderByClause = 'p.created_at DESC'; // Default
      }
    }

    const db = await getDB();

    // Get total count of digital and custom products for pagination
    const [countRows] = await db.query(
      `SELECT COUNT(*) as total FROM products WHERE user_id = ? AND status != "2" AND type IN ('digital', 'custom') ${countStatusCondition}`,
      [userId]
    );
    const { total: totalCount } = countRows[0];

    // Get digital and custom products from DB with pagination, filtering, sorting and join for purchase count
    const [products] = await db.query(
      `SELECT 
        p.id,
        p.name, 
        p.type, 
        p.price, 
        p.description, 
        p.tags, 
        p.delivery_time, 
        mp.name as image, 
        p.status, 
        p.created_at,
        COALESCE(purchase_counts.purchases_count, 0) as purchases_count
      FROM products p
      LEFT JOIN media_products mp ON p.id = mp.products_id 
        AND mp.id = (SELECT MIN(id) FROM media_products WHERE products_id = p.id)
      LEFT JOIN (
        SELECT 
          products_id,
          COUNT(*) as purchases_count
        FROM purchases 
        WHERE delivery_status != 'rejected' 
          AND status != '2'
        GROUP BY products_id
      ) as purchase_counts ON p.id = purchase_counts.products_id
      WHERE p.user_id = ? AND p.status != '2' AND p.type IN ('digital', 'custom') ${statusCondition}
      ORDER BY ${orderByClause}
      LIMIT ? OFFSET ?`,
      [userId, limit, skip]
    );

    return { products, totalCount };
  } catch (error) {
    logError('Error fetching user digital and custom products:', { userId, error: error.message });
    throw error;
  }
};

// Export all functions at the end
export {
  getUserProducts,
  getUserDigitalAndCustomProducts,
  createProduct,
  getProductByIdForUser,
  updateProduct,
  softDeleteProduct,
  insertProductMedia,
  mapProductType,
  formatProductsForResponse,
  formatProductForEdit,
  processFileUploadData,
  handleMediaProcessing,
  cleanupMediaFiles,
  getAvailableProductTags,
  getProductAdminSettings,
  processProductAdminSettings
};