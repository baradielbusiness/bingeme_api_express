/**
 * @file userSettings.js
 * @description Database utility functions for user settings operations in the Bingeme API.
 * This file contains reusable database queries for user settings, language, state, and country operations.
 */

import { pool } from '../config/database.js';
import { logError, logInfo } from './common.js';

/**
 * Fetch user settings/profile information from the database.
 * @param {number} userId - The authenticated user's ID
 * @returns {Promise<object|null>} User settings or null if not found
 */
const getUserSettings = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, username, email, mobile, avatar, cover, about, story, profession, website, gender, birthdate, address, city, state_id, zip, countries_id, language, facebook, twitter, instagram, youtube, pinterest, github, tiktok, snapchat, telegram, vk, twitch, discord, company, hide_name, disable_watermark FROM users WHERE id = ?`,
       [userId]
    );
    
    if (rows.length === 0) return null;
    
    // Process the user settings to handle empty/null values
    const userSettings = rows[0];
    
    // Convert "Na" values and null values to empty strings for specific fields
    const fieldsToProcess = ['address', 'city', 'state_id', 'zip', 'about', 'story', 'profession', 'website', 'company'];
    fieldsToProcess.forEach(field => {
      if (userSettings[field] === 'Na' || userSettings[field] === null || userSettings[field] === undefined) {
        userSettings[field] = '';
      }
    });
    
    return userSettings;
  } catch (error) {
    logError('Error getting user settings:', error);
    return null;
  }
};

/**
 * Update user settings/profile information in the database.
 * @param {number} userId - The authenticated user's ID
 * @param {object} settings - The settings to update
 * @returns {Promise<boolean>} True if update succeeded, false otherwise
 */
const updateUserSettings = async (userId, settings) => {
  try {
    // Only allow updating specific fields
    const allowedFields = [
      'name', 'username', 'email', 'mobile', 'avatar', 'cover', 'about', 'story',
      'profession', 'website', 'gender', 'birthdate', 'address', 'city', 'state_id',
      'zip', 'countries_id', 'language', 'facebook', 'twitter', 'instagram', 'youtube',
      'pinterest', 'github', 'tiktok', 'snapchat', 'telegram', 'vk', 'twitch',
      'discord', 'company', 'hide_name', 'disable_watermark'
    ];
    
    // Filter settings to only include allowed fields
    const filteredSettings = {};
    Object.keys(settings).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredSettings[key] = settings[key];
      }
    });
    
    if (Object.keys(filteredSettings).length === 0) {
      logInfo('No valid fields to update', { userId });
      return true;
    }
    
    // Build dynamic update query
    const updateFields = Object.keys(filteredSettings).map(field => `${field} = ?`).join(', ');
    const values = Object.values(filteredSettings);
    values.push(userId);
    
    const query = `UPDATE users SET ${updateFields}, updated_at = NOW() WHERE id = ?`;
    
    await pool.query(query, values);
    
    logInfo('User settings updated successfully', { userId, updatedFields: Object.keys(filteredSettings) });
    return true;
    
  } catch (error) {
    logError('Error updating user settings:', error);
    return false;
  }
};

/**
 * Get all available countries from the database.
 * @returns {Promise<Array>} Array of country objects
 */
const getAllCountries = async () => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, code, phone_code FROM countries ORDER BY name ASC`
    );
    
    return rows;
  } catch (error) {
    logError('Error getting countries:', error);
    return [];
  }
};

/**
 * Get states/provinces for a specific country.
 * @param {number} countryId - The country ID
 * @returns {Promise<Array>} Array of state objects
 */
const getStatesByCountry = async (countryId) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, code FROM states WHERE country_id = ? ORDER BY name ASC`,
      [countryId]
    );
    
    return rows;
  } catch (error) {
    logError('Error getting states:', error);
    return [];
  }
};

/**
 * Get all available languages from the database.
 * @returns {Promise<Array>} Array of language objects
 */
const getAllLanguages = async () => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, code FROM languages ORDER BY name ASC`
    );
    
    return rows;
  } catch (error) {
    logError('Error getting languages:', error);
    return [];
  }
};

/**
 * Get user's privacy settings.
 * @param {number} userId - The authenticated user's ID
 * @returns {Promise<object|null>} Privacy settings or null if not found
 */
const getPrivacySettings = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM privacy_settings WHERE user_id = ?`,
      [userId]
    );
    
    if (rows.length === 0) {
      // Return default privacy settings
      return {
        profile_visibility: 'public',
        contact_visibility: 'public',
        post_visibility: 'public',
        message_privacy: 'public',
        show_online_status: true,
        allow_search: true
      };
    }
    
    return rows[0];
  } catch (error) {
    logError('Error getting privacy settings:', error);
    return null;
  }
};

/**
 * Update user's privacy settings.
 * @param {number} userId - The authenticated user's ID
 * @param {object} privacySettings - The privacy settings to update
 * @returns {Promise<boolean>} True if update succeeded, false otherwise
 */
const updatePrivacySettings = async (userId, privacySettings) => {
  try {
    const allowedFields = [
      'profile_visibility', 'contact_visibility', 'post_visibility',
      'message_privacy', 'show_online_status', 'allow_search'
    ];
    
    // Filter settings to only include allowed fields
    const filteredSettings = {};
    Object.keys(privacySettings).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredSettings[key] = privacySettings[key];
      }
    });
    
    if (Object.keys(filteredSettings).length === 0) {
      logInfo('No valid privacy fields to update', { userId });
      return true;
    }
    
    // Build dynamic update query
    const updateFields = Object.keys(filteredSettings).map(field => `${field} = ?`).join(', ');
    const values = Object.values(filteredSettings);
    values.push(userId);
    
    const query = `
      INSERT INTO privacy_settings (user_id, ${Object.keys(filteredSettings).join(', ')}, updated_at)
      VALUES (?, ${Object.keys(filteredSettings).map(() => '?').join(', ')}, NOW())
      ON DUPLICATE KEY UPDATE
      ${updateFields}, updated_at = NOW()
    `;
    
    const allValues = [userId, ...values];
    await pool.query(query, allValues);
    
    logInfo('Privacy settings updated successfully', { userId, updatedFields: Object.keys(filteredSettings) });
    return true;
    
  } catch (error) {
    logError('Error updating privacy settings:', error);
    return false;
  }
};

/**
 * Get user's notification settings.
 * @param {number} userId - The authenticated user's ID
 * @returns {Promise<object|null>} Notification settings or null if not found
 */
const getNotificationSettings = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM notification_settings WHERE user_id = ?`,
      [userId]
    );
    
    if (rows.length === 0) {
      // Return default notification settings
      return {
        push_notifications: true,
        email_notifications: true,
        message_notifications: true,
        post_notifications: true,
        live_notifications: true,
        tip_notifications: true
      };
    }
    
    return rows[0];
  } catch (error) {
    logError('Error getting notification settings:', error);
    return null;
  }
};

/**
 * Update user's notification settings.
 * @param {number} userId - The authenticated user's ID
 * @param {object} notificationSettings - The notification settings to update
 * @returns {Promise<boolean>} True if update succeeded, false otherwise
 */
const updateNotificationSettings = async (userId, notificationSettings) => {
  try {
    const allowedFields = [
      'push_notifications', 'email_notifications', 'message_notifications',
      'post_notifications', 'live_notifications', 'tip_notifications'
    ];
    
    // Filter settings to only include allowed fields
    const filteredSettings = {};
    Object.keys(notificationSettings).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredSettings[key] = notificationSettings[key];
      }
    });
    
    if (Object.keys(filteredSettings).length === 0) {
      logInfo('No valid notification fields to update', { userId });
      return true;
    }
    
    // Build dynamic update query
    const updateFields = Object.keys(filteredSettings).map(field => `${field} = ?`).join(', ');
    const values = Object.values(filteredSettings);
    values.push(userId);
    
    const query = `
      INSERT INTO notification_settings (user_id, ${Object.keys(filteredSettings).join(', ')}, updated_at)
      VALUES (?, ${Object.keys(filteredSettings).map(() => '?').join(', ')}, NOW())
      ON DUPLICATE KEY UPDATE
      ${updateFields}, updated_at = NOW()
    `;
    
    const allValues = [userId, ...values];
    await pool.query(query, allValues);
    
    logInfo('Notification settings updated successfully', { userId, updatedFields: Object.keys(filteredSettings) });
    return true;
    
  } catch (error) {
    logError('Error updating notification settings:', error);
    return false;
  }
};

/**
 * Get user's security settings.
 * @param {number} userId - The authenticated user's ID
 * @returns {Promise<object|null>} Security settings or null if not found
 */
const getSecuritySettings = async (userId) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM security_settings WHERE user_id = ?`,
      [userId]
    );
    
    if (rows.length === 0) {
      // Return default security settings
      return {
        two_factor_enabled: false,
        login_notifications: true,
        session_timeout: 30,
        require_password_change: false
      };
    }
    
    return rows[0];
  } catch (error) {
    logError('Error getting security settings:', error);
    return null;
  }
};

/**
 * Update user's security settings.
 * @param {number} userId - The authenticated user's ID
 * @param {object} securitySettings - The security settings to update
 * @returns {Promise<boolean>} True if update succeeded, false otherwise
 */
const updateSecuritySettings = async (userId, securitySettings) => {
  try {
    const allowedFields = [
      'two_factor_enabled', 'login_notifications', 'session_timeout', 'require_password_change'
    ];
    
    // Filter settings to only include allowed fields
    const filteredSettings = {};
    Object.keys(securitySettings).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredSettings[key] = securitySettings[key];
      }
    });
    
    if (Object.keys(filteredSettings).length === 0) {
      logInfo('No valid security fields to update', { userId });
      return true;
    }
    
    // Build dynamic update query
    const updateFields = Object.keys(filteredSettings).map(field => `${field} = ?`).join(', ');
    const values = Object.values(filteredSettings);
    values.push(userId);
    
    const query = `
      INSERT INTO security_settings (user_id, ${Object.keys(filteredSettings).join(', ')}, updated_at)
      VALUES (?, ${Object.keys(filteredSettings).map(() => '?').join(', ')}, NOW())
      ON DUPLICATE KEY UPDATE
      ${updateFields}, updated_at = NOW()
    `;
    
    const allValues = [userId, ...values];
    await pool.query(query, allValues);
    
    logInfo('Security settings updated successfully', { userId, updatedFields: Object.keys(filteredSettings) });
    return true;
    
  } catch (error) {
    logError('Error updating security settings:', error);
    return false;
  }
};

export {
  getUserSettings,
  updateUserSettings,
  getAllCountries,
  getStatesByCountry,
  getAllLanguages,
  getPrivacySettings,
  updatePrivacySettings,
  getNotificationSettings,
  updateNotificationSettings,
  getSecuritySettings,
  updateSecuritySettings
};
