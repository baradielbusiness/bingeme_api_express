import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Get user products
 */
export const getUserProducts = async (userId, limit = 20, skip = 0, status = 'all', sortBy = 'latest') => {
  try {
    let whereClause = 'WHERE user_id = ? AND status != "deleted"';
    let orderClause = 'ORDER BY created_at DESC';
    
    if (status !== 'all') {
      whereClause += ` AND status = '${status}'`;
    }
    
    if (sortBy === 'name') {
      orderClause = 'ORDER BY name ASC';
    }
    
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
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;
    
    const [products] = await pool.query(query, [userId, limit, skip]);
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM products ${whereClause}`;
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
export const getProductByIdForUser = async (productId, userId) => {
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
      WHERE id = ? AND user_id = ? AND status != "deleted"
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
export const updateProduct = async (productId, productData) => {
  try {
    const { name, price, delivery_time, tags, description, type, status } = productData;
    
    const query = `
      UPDATE products 
      SET name = ?, price = ?, delivery_time = ?, tags = ?, description = ?, type = ?, status = ?, updated_at = NOW() 
      WHERE id = ? AND status != "deleted"
    `;
    
    await pool.query(query, [name, price, delivery_time, tags, description, type, status, productId]);
    logInfo(`Updated product: ${productId}`);
  } catch (error) {
    logError('Error updating product:', error);
    throw error;
  }
};

/**
 * Soft delete product
 */
export const softDeleteProduct = async (productId) => {
  try {
    const query = `UPDATE products SET deleted = 1, deleted_at = NOW() WHERE id = ?`;
    await pool.query(query, [productId]);
    logInfo(`Soft deleted product: ${productId}`);
  } catch (error) {
    logError('Error soft deleting product:', error);
    throw error;
  }
};

/**
 * Insert product media
 */
export const insertProductMedia = async (productId, mediaData) => {
  try {
    const { media_path, media_type, media_size } = mediaData;
    
    const query = `
      INSERT INTO product_media (product_id, media_path, media_type, media_size, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [productId, media_path, media_type, media_size]);
    return result.insertId;
  } catch (error) {
    logError('Error inserting product media:', error);
    throw error;
  }
};

/**
 * Map product type
 */
export const mapProductType = (type) => {
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
export const formatProductsForResponse = (products) => {
  return products.map(product => ({
    id: product.id,
    name: product.name,
    price: product.price,
    delivery_time: product.delivery_time,
    tags: product.tags ? JSON.parse(product.tags) : [],
    description: product.description,
    type: product.type,
    status: product.status,
    created_at: product.created_at,
    updated_at: product.updated_at
  }));
};

/**
 * Format product for edit
 */
export const formatProductForEdit = (product) => {
  return {
    id: product.id,
    name: product.name,
    price: product.price,
    delivery_time: product.delivery_time,
    tags: product.tags ? JSON.parse(product.tags) : [],
    description: product.description,
    type: product.type,
    status: product.status
  };
};

/**
 * Process file upload data
 */
export const processFileUploadData = (fileData) => {
  return fileData.map(file => ({
    media_path: file.media_path,
    media_type: file.media_type,
    media_size: file.media_size
  }));
};

/**
 * Handle media processing
 */
export const handleMediaProcessing = async (mediaFiles) => {
  // This would integrate with the media processing utility
  return mediaFiles;
};

/**
 * Cleanup media files
 */
export const cleanupMediaFiles = async (fileKeys) => {
  // This would integrate with S3 cleanup
  return true;
};

/**
 * Get available product tags
 */
export const getAvailableProductTags = async () => {
  try {
    const query = `SELECT DISTINCT tag FROM product_tags WHERE active = 1 ORDER BY tag ASC`;
    const [rows] = await pool.query(query);
    return rows.map(row => row.tag);
  } catch (error) {
    logError('Error getting available product tags:', error);
    return [];
  }
};

/**
 * Get product admin settings
 */
export const getProductAdminSettings = async () => {
  try {
    const query = `SELECT * FROM admin_settings WHERE setting_type = 'product'`;
    const [rows] = await pool.query(query);
    return rows;
  } catch (error) {
    logError('Error getting product admin settings:', error);
    return [];
  }
};

/**
 * Process product admin settings
 */
export const processProductAdminSettings = (adminSettings, userCountry) => {
  // Process admin settings for product creation
  return {
    pricing: { min_price: 1, max_price: 1000 },
    limits: { max_description_length: 1000, max_file_size: 10485760 }
  };
};
