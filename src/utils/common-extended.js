/**
 * @file common-extended.js
 * @description Extended common utilities for Bingeme API Express.js
 * Additional utility functions that were in the original common.js
 */
import { getDB } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Fetch all languages for select input
 * @returns {Promise<Array>} Array of languages { id, name, abbreviation }
 */
const getAllLanguages = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT id, name, abbreviation FROM languages ORDER BY name ASC',
      []
    );
    return rows;
  } catch (error) {
    logError('Error fetching languages:', error);
    return [];
  }
};

/**
 * Fetch all countries for select input
 * @returns {Promise<Array>} Array of countries { id, country_name, country_code }
 */
const getAllCountries = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT country_name, country_code FROM countries ORDER BY country_name ASC',
      []
    );
    return rows;
  } catch (error) {
    logError('Error fetching countries:', error);
    return [];
  }
};

/**
 * Fetch all states for select input, optionally filtered by country
 * @param {number|null} countries_id - Optional country ID to filter states
 * @returns {Promise<Array>} Array of states { id, name, code, countries_id }
 */
const getStates = async (countries_id = null) => {
  try {
    const pool = getDB();
    let query = 'SELECT id, name, code, countries_id FROM states';
    let params = [];
    if (countries_id) {
      query += ' WHERE countries_id = ?';
      params.push(countries_id);
    }
    query += ' ORDER BY name ASC';
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    logError('Error fetching states:', error);
    return [];
  }
};

/**
 * Fetch gender options from admin_settings table (comma-separated string)
 * @returns {Promise<Array>} Array of gender strings
 */
const getGenderOptions = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT genders FROM admin_settings LIMIT 1', []);
    if (rows.length === 0 || !rows[0].genders) return [];
    return rows[0].genders.split(',').map(g => g.trim()).filter(Boolean);
  } catch (error) {
    logError('Error fetching gender options:', error);
    return [];
  }
};

/**
 * Gets a user by ID (not deleted).
 * @param {number|string} userId
 * @returns {Promise<object|null>} User object or null
 */
const getUserById = async (userId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT id, name, avatar, username, email, mobile, address, city, zip, countries_id, verified_id, role, status, password, custom_fee, email_verified, mobile_verified FROM users WHERE id = ? AND status != "deleted"',
      [userId]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logError('getUserById error:', error);
    return null;
  }
};

/**
 * Get admin settings
 * @returns {Promise<object>} Admin settings object
 */
const getAdminSettings = async () => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT * FROM admin_settings LIMIT 1');
    return rows[0] || {};
  } catch (error) {
    logError('getAdminSettings error:', error);
    return {};
  }
}

/**
 * Get creator settings by user ID
 * @param {number} userId
 * @returns {Promise<object>} Creator settings object
 */
const getCreatorSettingsByUserId = async (userId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query('SELECT * FROM creator_settings WHERE user_id = ?', [userId]);
    return rows[0] || {
      user_id: userId,
      vdcl_status: 'no',
      vdcl_min_coin: 0,
      adcl_status: 'no',
      audio_call_price: 0,
      paid_chat_status: 'no',
      pc_sub_price: 0,
      pc_non_sub_price: 0,
      free_vdcl_status: 'no'
    };
  } catch (error) {
    logError('getCreatorSettingsByUserId error:', error);
    return {
      user_id: userId,
      vdcl_status: 'no',
      vdcl_min_coin: 0,
      adcl_status: 'no',
      audio_call_price: 0,
      paid_chat_status: 'no',
      pc_sub_price: 0,
      pc_non_sub_price: 0,
      free_vdcl_status: 'no'
    };
  }
}

/**
 * Update creator settings by user ID
 * @param {number} userId
 * @param {object} data - Request body
 * @param {object} access - Feature access flags and adminSettings
 * @returns {Promise<{success: boolean, message?: string}>}
 */
const updateCreatorSettingsByUserId = async (userId, data, access) => {
  try {
    const pool = getDB();
    // Prepare update data
    const updateData = { user_id: userId };
    if (access.isVcEnable && data.video_call) {
      updateData.vdcl_status = (data.video_call.vdcl_status === 1 || data.video_call.vdcl_status === '1' || data.video_call.vdcl_status === true || data.video_call.vdcl_status === 'yes') ? 'yes' : 'no';
      updateData.vdcl_min_coin = data.video_call.vdcl_min_coin || 0;
    }
    if (access.isFreeVcEnable && data.free_video_call) {
      updateData.free_vdcl_status = (data.free_video_call.free_vdcl_status === 1 || data.free_video_call.free_vdcl_status === '1' || data.free_video_call.free_vdcl_status === true || data.free_video_call.free_vdcl_status === 'yes') ? 'yes' : 'no';
    }
    if (access.isAcEnable && data.audio_call) {
      updateData.adcl_status = (data.audio_call.adcl_status === 1 || data.audio_call.adcl_status === '1' || data.audio_call.adcl_status === true || data.audio_call.adcl_status === 'yes') ? 'yes' : 'no';
      updateData.audio_call_price = data.audio_call.audio_call_price || 0;
    }
    if (access.isPaidChatEnable && data.paid_chat) {
      updateData.paid_chat_status = (data.paid_chat.paid_chat_status === 1 || data.paid_chat.paid_chat_status === '1' || data.paid_chat.paid_chat_status === true || data.paid_chat.paid_chat_status === 'yes') ? 'yes' : 'no';
      updateData.pc_sub_price = data.paid_chat.pc_sub_price || 0;
      updateData.pc_non_sub_price = data.paid_chat.pc_non_sub_price || 0;
    }
    // Upsert logic
    const [existing] = await pool.query('SELECT id FROM creator_settings WHERE user_id = ?', [userId]);
    if (existing.length > 0) {
      // Update
      const updateFields = [];
      const updateValues = [];
      Object.entries(updateData).forEach(([key, value]) => {
        if (key !== 'user_id') {
          updateFields.push(`${key} = ?`);
          updateValues.push(value);
        }
      });
      updateValues.push(userId);
      const updateQuery = `UPDATE creator_settings SET ${updateFields.join(', ')}, updated_at = NOW() WHERE user_id = ?`;
      await pool.query(updateQuery, updateValues);
    } else {
      // Insert
      const insertFields = Object.keys(updateData);
      const insertValues = Object.values(updateData);
      const placeholders = insertFields.map(() => '?').join(', ');
      const insertQuery = `INSERT INTO creator_settings (${insertFields.join(', ')}, created_at, updated_at) VALUES (${placeholders}, NOW(), NOW())`;
      await pool.query(insertQuery, insertValues);
    }
    return { success: true };
  } catch (error) {
    logError('updateCreatorSettingsByUserId error:', error);
    return { success: false, message: 'Database error while updating creator settings' };
  }
}

/**
 * Check if user has video call access
 * @param {number} userId
 * @param {object} adminSettings
 * @returns {Promise<boolean>}
 */
const checkVideoCallAccess = async (userId, adminSettings) => {
  try {
    const pool = getDB();
    // Check if video call feature is globally enabled
    if (adminSettings.video_call_enabled !== '1') return false;
    
    // Check if it's enabled for all creators or specific groups
    if (adminSettings.video_call_for === '1') {
      // All creators can use video call
      return true;
    } else {
      // Only creators in specific group (group ID: '5')
      const [rows] = await pool.query(
        `SELECT cg.id FROM creator_groups cg WHERE cg.creator_id = ? AND cg.group_id = 5`,
        [userId]
      );
      return rows.length > 0;
    }
  } catch (error) {
    logError('checkVideoCallAccess error:', error);
    return false;
  }
}

/**
 * Check if user has free video call access
 * @param {number} userId
 * @param {object} adminSettings
 * @returns {Promise<boolean>}
 */
const checkFreeVideoCallAccess = async (userId, adminSettings) => {
  try {
    const pool = getDB();
    // Check if free video call feature is globally enabled
    if (adminSettings.free_video_call_enabled !== '1') return false;
    
    // Free video call is always group-based (no "all creators" option)
    // Only creators in specific group (group ID: '19')
    const [rows] = await pool.query(
      `SELECT cg.id FROM creator_groups cg WHERE cg.creator_id = ? AND cg.group_id = 19`,
      [userId]
    );
    return rows.length > 0;
  } catch (error) {
    logError('checkFreeVideoCallAccess error:', error);
    return false;
  }
}

/**
 * Check if user has audio call access
 * @param {number} userId
 * @param {object} adminSettings
 * @returns {Promise<boolean>}
 */
const checkAudioCallAccess = async (userId, adminSettings) => {
  try {
    const pool = getDB();
    // Check if audio call feature is globally enabled
    if (adminSettings.audio_call_enabled !== '1') return false;
    
    // Check if it's enabled for all creators or specific groups
    if (adminSettings.audio_call_for === '1') {
      // All creators can use audio call
      return true;
    } else {
      // Only creators in specific group (group ID: '18')
      const [rows] = await pool.query(
        `SELECT cg.id FROM creator_groups cg WHERE cg.creator_id = ? AND cg.group_id = 18`,
        [userId]
      );
      return rows.length > 0;
    }
  } catch (error) {
    logError('checkAudioCallAccess error:', error);
    return false;
  }
}

/**
 * Check if user has paid chat access
 * @param {number} userId
 * @param {object} adminSettings
 * @returns {Promise<boolean>}
 */
const checkPaidChatAccess = async (userId, adminSettings) => {
  try {
    const pool = getDB();
    // Check if paid chat feature is globally enabled
    if (adminSettings.paid_chat !== '1') return false;
    
    // Check if it's enabled for all creators or specific groups
    if (adminSettings.paid_chat_status === '1') {
      // All creators can use paid chat
      return true;
    } else {
      // Only creators in specific group (group ID: '17')
      const [rows] = await pool.query(
        `SELECT cg.id FROM creator_groups cg WHERE cg.creator_id = ? AND cg.group_id = 17`,
        [userId]
      );
      return rows.length > 0;
    }
  } catch (error) {
    logError('checkPaidChatAccess error:', error);
    return false;
  }
}

/**
 * Get file URL based on Bingeme CDN structure
 * @param {string} path - File path
 * @returns {string} Full file URL
 */
const getFile = (path) => {
  if (!path) return '';
  
  // Extract domain from APP_URL (get part after https://)
  const cdnEnv = process.env.CDN_ENV ?? 'bingeme';
  const cdnBase = `https://cdn.${cdnEnv}.com/uploads`;
  
  // Handle different file types with correct paths
  if (path.startsWith('images/') || path.startsWith('videos/') || path.startsWith('music/') || path.startsWith('files/')) {
    // For media files, use updates/ prefix
    return `${cdnBase}/updates/${path}`;
  } else if (path.startsWith('avatar/') || path.startsWith('cover/') || path.startsWith('messages/') || path.startsWith('shop/')) {
    // For avatars and covers, messages and shop, use direct path
    return `${cdnBase}/${path}`;
  } else if (path.startsWith('shop/')) {
    // For shop/product files, use direct path without additional prefix
    return `${cdnBase}/${path}`;
  } else {
    // For other files, use updates/ prefix
    return `${cdnBase}/updates/${path}`;
  }
};

// Export all functions at the end
export {
  getAllLanguages,
  getAllCountries,
  getStates,
  getGenderOptions,
  getUserById,
  getAdminSettings,
  getCreatorSettingsByUserId,
  updateCreatorSettingsByUserId,
  checkVideoCallAccess,
  checkFreeVideoCallAccess,
  checkAudioCallAccess,
  checkPaidChatAccess,
  getFile
};