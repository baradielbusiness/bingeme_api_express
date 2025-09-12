import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Get user updates list
 */
export const getUserUpdatesList = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT 
        id,
        user_id,
        title,
        content,
        image,
        created_at,
        updated_at
      FROM updates 
      WHERE user_id = ? AND deleted = 0
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [updates] = await pool.query(query, [userId, limitNum, skipNum]);
    return updates;
  } catch (error) {
    logError('Error getting user updates list:', error);
    throw error;
  }
};

/**
 * Get user updates count
 */
export const getUserUpdatesCount = async (userId) => {
  try {
    const query = `
      SELECT COUNT(*) as count 
      FROM updates 
      WHERE user_id = ? AND deleted = 0
    `;

    const [result] = await pool.query(query, [userId]);
    return result[0].count;
  } catch (error) {
    logError('Error getting user updates count:', error);
    return 0;
  }
};

/**
 * Create user update
 */
export const createUserUpdate = async (updateData) => {
  try {
    const { user_id, title, content, image = null } = updateData;
    
    const query = `
      INSERT INTO updates (user_id, title, content, image, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [user_id, title, content, image]);
    logInfo(`Created user update: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error creating user update:', error);
    throw error;
  }
};

/**
 * Update user update
 */
export const updateUserUpdate = async (updateId, updateData) => {
  try {
    const { title, content, image } = updateData;
    
    const query = `
      UPDATE updates 
      SET title = ?, content = ?, image = ?, updated_at = NOW() 
      WHERE id = ? AND deleted = 0
    `;
    
    await pool.query(query, [title, content, image, updateId]);
    logInfo(`Updated user update: ${updateId}`);
  } catch (error) {
    logError('Error updating user update:', error);
    throw error;
  }
};

/**
 * Delete user update
 */
export const deleteUserUpdate = async (updateId) => {
  try {
    const query = `UPDATE updates SET deleted = 1 WHERE id = ?`;
    await pool.query(query, [updateId]);
    logInfo(`Deleted user update: ${updateId}`);
  } catch (error) {
    logError('Error deleting user update:', error);
    throw error;
  }
};

/**
 * Get update by ID
 */
export const getUpdateById = async (updateId) => {
  try {
    const query = `
      SELECT 
        id,
        user_id,
        title,
        content,
        image,
        created_at,
        updated_at
      FROM updates 
      WHERE id = ? AND deleted = 0
    `;

    const [rows] = await pool.query(query, [updateId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting update by ID:', error);
    return null;
  }
};
