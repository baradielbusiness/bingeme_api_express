// =====================================================
// verification.js - Query functions for verification flow
// =====================================================
/**
 * @file verification.js
 * @description
 *   Centralizes database-related functions used by verification handlers to keep
 *   handlers focused on orchestration and business logic.
 *
 *   Exposed functions:
 *     - checkExistingVerificationRequest(userId)
 *     - updateUserProfileData(userId, userData)
 *     - saveVerificationDocuments(userId, files, userData)
 */

import { pool } from '../config/database.js';
import { logInfo, logError, encryptSensitiveData } from './common.js';

/**
 * Checks if user has existing verification request by status
 * @param {number} userId - User ID to check
 * @param {string} [status='pending'] - Status to check (e.g. 'pending', 'rejected')
 * @returns {Promise<boolean>} True if a request with the given status exists, false otherwise
 */
const checkExistingVerificationRequest = async (userId, status = 'pending') => {
  try {
    const [rows] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM verification_requests 
      WHERE user_id = ? AND status = ?
    `, [userId, status]);
    
    return rows[0].count > 0;
  } catch (error) {
    logError('Error checking existing verification request:', error);
    return false;
  }
};

/**
 * Updates user profile data in the users table (exact Laravel logic)
 * @param {number} userId - User ID to update
 * @param {Object} userData - User data from request
 * @returns {Promise<boolean>} True if update succeeded, false otherwise
 */
const updateUserProfileData = async (userId, userData) => {
  try {
    const {
      full_name,
      username,
      email,
      mobile,
      address,
      city,
      state_id,
      zip,
      countries_id,
      gender,
      birthdate,
      profession,
      company
    } = userData;
    
    // Encrypt sensitive data
    const encryptedEmail = email ? encryptSensitiveData(email) : null;
    const encryptedMobile = mobile ? encryptSensitiveData(mobile) : null;
    const encryptedAddress = address ? encryptSensitiveData(address) : null;
    
    const query = `
      UPDATE users 
      SET 
        name = ?,
        username = ?,
        email = ?,
        mobile = ?,
        address = ?,
        city = ?,
        state_id = ?,
        zip = ?,
        countries_id = ?,
        gender = ?,
        birthdate = ?,
        profession = ?,
        company = ?,
        updated_at = NOW()
      WHERE id = ?
    `;
    
    await pool.query(query, [
      full_name,
      username,
      encryptedEmail,
      encryptedMobile,
      encryptedAddress,
      city,
      state_id,
      zip,
      countries_id,
      gender,
      birthdate,
      profession,
      company,
      userId
    ]);
    
    logInfo('User profile data updated successfully', { userId });
    return true;
    
  } catch (error) {
    logError('Error updating user profile data:', error);
    return false;
  }
};

/**
 * Saves verification documents and creates verification request
 * @param {number} userId - User ID
 * @param {Array} files - Array of file objects with paths
 * @param {Object} userData - User data from request
 * @returns {Promise<number|null>} Verification request ID or null if failed
 */
const saveVerificationDocuments = async (userId, files, userData) => {
  try {
    const {
      verification_type,
      full_name,
      username,
      email,
      mobile,
      address,
      city,
      state_id,
      zip,
      countries_id,
      gender,
      birthdate,
      profession,
      company
    } = userData;
    
    // Prepare documents data
    const documents = files.map(file => ({
      type: file.type,
      path: file.path,
      original_name: file.original_name,
      size: file.size
    }));
    
    // Create verification request
    const query = `
      INSERT INTO verification_requests (
        user_id,
        verification_type,
        full_name,
        username,
        email,
        mobile,
        address,
        city,
        state_id,
        zip,
        countries_id,
        gender,
        birthdate,
        profession,
        company,
        documents,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())
    `;
    
    const [result] = await pool.query(query, [
      userId,
      verification_type,
      full_name,
      username,
      email,
      mobile,
      address,
      city,
      state_id,
      zip,
      countries_id,
      gender,
      birthdate,
      profession,
      company,
      JSON.stringify(documents)
    ]);
    
    const verificationRequestId = result.insertId;
    
    logInfo('Verification documents saved successfully', { 
      userId, 
      verificationRequestId, 
      documentCount: documents.length 
    });
    
    return verificationRequestId;
    
  } catch (error) {
    logError('Error saving verification documents:', error);
    return null;
  }
};

/**
 * Get verification request by ID
 * @param {number} requestId - Verification request ID
 * @returns {Promise<Object|null>} Verification request or null if not found
 */
const getVerificationRequestById = async (requestId) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM verification_requests WHERE id = ?',
      [requestId]
    );
    
    return rows[0] || null;
  } catch (error) {
    logError('Error getting verification request by ID:', error);
    return null;
  }
};

/**
 * Get verification requests for a user
 * @param {number} userId - User ID
 * @param {number} limit - Number of requests to fetch
 * @param {number} skip - Number of requests to skip
 * @returns {Promise<Array>} Array of verification requests
 */
const getVerificationRequests = async (userId, limit = 10, skip = 0) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        id,
        verification_type,
        status,
        created_at,
        updated_at,
        admin_notes
      FROM verification_requests 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `, [userId, limit, skip]);
    
    return rows;
  } catch (error) {
    logError('Error getting verification requests:', error);
    return [];
  }
};

/**
 * Update verification request status
 * @param {number} requestId - Verification request ID
 * @param {string} status - New status
 * @param {string} adminNotes - Admin notes (optional)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const updateVerificationRequestStatus = async (requestId, status, adminNotes = null) => {
  try {
    const query = `
      UPDATE verification_requests 
      SET status = ?, admin_notes = ?, updated_at = NOW() 
      WHERE id = ?
    `;
    
    await pool.query(query, [status, adminNotes, requestId]);
    
    logInfo('Verification request status updated', { requestId, status, adminNotes });
    return true;
    
  } catch (error) {
    logError('Error updating verification request status:', error);
    return false;
  }
};

/**
 * Get verification categories
 * @returns {Promise<Array>} Array of verification categories
 */
const getVerificationCategories = async () => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM verification_categories WHERE active = 1 ORDER BY name ASC'
    );
    
    return rows;
  } catch (error) {
    logError('Error getting verification categories:', error);
    return [];
  }
};

/**
 * Get verification request with user details
 * @param {number} requestId - Verification request ID
 * @returns {Promise<Object|null>} Verification request with user details or null
 */
const getVerificationRequestWithUser = async (requestId) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        vr.*,
        u.username,
        u.name,
        u.profile_pic,
        u.verified
      FROM verification_requests vr
      JOIN users u ON vr.user_id = u.id
      WHERE vr.id = ?
    `, [requestId]);
    
    return rows[0] || null;
  } catch (error) {
    logError('Error getting verification request with user:', error);
    return null;
  }
};

/**
 * Get all verification requests for admin
 * @param {string} status - Filter by status (optional)
 * @param {number} limit - Number of requests to fetch
 * @param {number} skip - Number of requests to skip
 * @returns {Promise<Array>} Array of verification requests
 */
const getAllVerificationRequests = async (status = null, limit = 20, skip = 0) => {
  try {
    let query = `
      SELECT 
        vr.id,
        vr.verification_type,
        vr.status,
        vr.created_at,
        vr.updated_at,
        vr.admin_notes,
        u.username,
        u.name,
        u.profile_pic
      FROM verification_requests vr
      JOIN users u ON vr.user_id = u.id
    `;
    
    const params = [];
    
    if (status) {
      query += ' WHERE vr.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY vr.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, skip);
    
    const [rows] = await pool.query(query, params);
    
    return rows;
  } catch (error) {
    logError('Error getting all verification requests:', error);
    return [];
  }
};

/**
 * Count verification requests by status
 * @param {string} status - Status to count (optional)
 * @returns {Promise<number>} Count of verification requests
 */
const countVerificationRequests = async (status = null) => {
  try {
    let query = 'SELECT COUNT(*) as count FROM verification_requests';
    const params = [];
    
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    
    const [rows] = await pool.query(query, params);
    
    return rows[0].count;
  } catch (error) {
    logError('Error counting verification requests:', error);
    return 0;
  }
};

export {
  checkExistingVerificationRequest,
  updateUserProfileData,
  saveVerificationDocuments,
  getVerificationRequestById,
  getVerificationRequests,
  updateVerificationRequestStatus,
  getVerificationCategories,
  getVerificationRequestWithUser,
  getAllVerificationRequests,
  countVerificationRequests
};
