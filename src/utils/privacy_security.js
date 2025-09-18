import { pool } from '../config/database.js';
import { logInfo, logError, generateOTP, verifyEmailOTP } from './common.js';

/**
 * Fetch privacy and security details for user
 */
const fetchPrivacySecurityDetails = async (userId) => {
  try {
    const query = `
      SELECT 
        id,
        username,
        email,
        mobile,
        avatar,
        verified_id,
        created_at,
        last_login,
        privacy_settings,
        security_settings
      FROM users 
      WHERE id = ? AND status != "deleted"
    `;

    const [rows] = await pool.query(query, [userId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error fetching privacy security details:', error);
    throw error;
  }
};

/**
 * Update privacy and security details
 */
const updatePrivacySecurityDetails = async (userId, settings) => {
  try {
    const { privacy_settings, security_settings } = settings;
    
    const query = `
      UPDATE users 
      SET privacy_settings = ?, security_settings = ?, updated_at = NOW() 
      WHERE id = ? AND status != "deleted"
    `;
    
    await pool.query(query, [privacy_settings, security_settings, userId]);
    logInfo(`Updated privacy security details for user: ${userId}`);
  } catch (error) {
    logError('Error updating privacy security details:', error);
    throw error;
  }
};

/**
 * Generate account deletion OTP
 */
const generateAccountDeletionOTP = async (userId) => {
  try {
    const identifier = `delete_account_${userId}`;
    const otp = await generateOTP(identifier);
    
    logInfo(`Generated account deletion OTP for user: ${userId}`);
    return { otp, identifier };
  } catch (error) {
    logError('Error generating account deletion OTP:', error);
    throw error;
  }
};

/**
 * Verify account deletion OTP
 */
const verifyAccountDeletionOTP = async (userId, otp) => {
  try {
    const identifier = `delete_account_${userId}`;
    const isValid = await verifyEmailOTP(identifier, otp);
    
    if (isValid) {
      logInfo(`Account deletion OTP verified for user: ${userId}`);
    }
    
    return isValid;
  } catch (error) {
    logError('Error verifying account deletion OTP:', error);
    return false;
  }
};

/**
 * Soft delete user account
 */
const softDeleteUserAccount = async (userId) => {
  try {
    // Mark user as deleted
    const userQuery = `UPDATE users SET deleted = 1, deleted_at = NOW() WHERE id = ?`;
    await pool.query(userQuery, [userId]);
    
    // Mark user posts as deleted
    const postsQuery = `UPDATE posts SET deleted = 1 WHERE user_id = ?`;
    await pool.query(postsQuery, [userId]);
    
    // Mark user messages as deleted
    const messagesQuery = `UPDATE messages SET deleted = 1 WHERE from_user_id = ? OR to_user_id = ?`;
    await pool.query(messagesQuery, [userId, userId]);
    
    // Mark user updates as deleted
    const updatesQuery = `UPDATE updates SET deleted = 1 WHERE user_id = ?`;
    await pool.query(updatesQuery, [userId]);
    
    logInfo(`Soft deleted user account: ${userId}`);
  } catch (error) {
    logError('Error soft deleting user account:', error);
    throw error;
  }
};

/**
 * Get account retrieve info
 */
const getAccountRetrieveInfo = async (userId) => {
  try {
    const query = `
      SELECT 
        id,
        username,
        email,
        mobile,
        deleted_at,
        created_at
      FROM users 
      WHERE id = ? AND deleted = 1
    `;

    const [rows] = await pool.query(query, [userId]);
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('Error getting account retrieve info:', error);
    return null;
  }
};

/**
 * Reactivate user account
 */
const reactivateUserAccount = async (userId) => {
  try {
    const query = `UPDATE users SET status = "active", updated_at = NOW() WHERE id = ?`;
    await pool.query(query, [userId]);
    
    logInfo(`Reactivated user account: ${userId}`);
  } catch (error) {
    logError('Error reactivating user account:', error);
    throw error;
  }
};

/**
 * Clear user sessions
 */
const clearUserSessions = async (userId) => {
  try {
    // Clear from sessions table (if using MySQL)
    const sessionsQuery = `DELETE FROM sessions WHERE user_id = ?`;
    await pool.query(sessionsQuery, [userId]);
    
    // Clear from DynamoDB sessions table
    // This would be handled by the common.js functions
    
    logInfo(`Cleared sessions for user: ${userId}`);
  } catch (error) {
    logError('Error clearing user sessions:', error);
    throw error;
  }
};

// Export all functions at the end
export {
  fetchPrivacySecurityDetails,
  updatePrivacySecurityDetails,
  generateAccountDeletionOTP,
  verifyAccountDeletionOTP,
  softDeleteUserAccount,
  getAccountRetrieveInfo,
  reactivateUserAccount,
  clearUserSessions
};