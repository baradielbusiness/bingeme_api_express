/**
 * @file creatorController.js
 * @description Creator controller for Bingeme API Express.js
 * Handles all creator-related operations including settings, agreements, payments, etc.
 */

import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  getAuthenticatedUserId, 
  getUserById, 
  getAdminSettings, 
  getCreatorSettingsByUserId, 
  updateCreatorSettingsByUserId, 
  checkVideoCallAccess, 
  checkFreeVideoCallAccess, 
  checkAudioCallAccess, 
  checkPaidChatAccess,
  getFile,
  createExpressSuccessResponse,
  createExpressErrorResponse,
  createSuccessResponse,
  createErrorResponse
} from '../utils/common.js';
import { getUserSubscriptionPlans, updateSubscriptionPlan, updateSubscriptionMessage, updateUserFreeSubscription } from '../utils/subscription.js';
import { checkFileExists, downloadFile, uploadFile } from '../utils/s3Utils.js';
import { checkFaceVisibility } from '../utils/faceDetection.js';
import { generateCreatorAgreementPDF } from '../utils/pdfGenerator.js';
import { processMediaFiles, cleanupS3Files } from '../utils/mediaProcessing.js';
import { processUploadRequest } from '../utils/uploadUtils.js';

/**
 * GET /creator/settings - Fetch creator settings for the authenticated user.
 * Exact implementation matching Lambda getCreatorSettingsHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const getCreatorSettings = async (req, res) => {
  // Extract and validate authenticated user
  // TODO: Convert getAuthenticatedUserId(event, { action: 'creator_settings getCreatorSettingsHandler' }) to getAuthenticatedUserId(req, { action: 'creator_settings getCreatorSettingsHandler' })
  const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'creator_settings getCreatorSettingsHandler' });
  if (errorResponse) {
    // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
  try {
    logInfo('Fetching creator settings', { userId });
    
    // Fetch user and admin settings
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    
    // Core Enablement Check: User must be verified
    if (user.verified_id !== 'yes') {
      // TODO: Convert createErrorResponse(404, 'User must be verified to access creator settings') to res.status(404).json({ error: 'User must be verified to access creator settings' })
      return res.status(404).json(createErrorResponse(404, 'User must be verified to access creator settings'));
    }
    
    const adminSettings = await getAdminSettings();
    
    // Check feature access for each feature
    const isVcEnable = await checkVideoCallAccess(userId, adminSettings);
    const isFreeVcEnable = await checkFreeVideoCallAccess(userId, adminSettings);
    const isAcEnable = await checkAudioCallAccess(userId, adminSettings);
    const isPaidChatEnable = await checkPaidChatAccess(userId, adminSettings);
    
    // Core Enablement Check: At least one feature must be enabled
    const isCreatorSettingsEnable = isVcEnable || isAcEnable || isPaidChatEnable || isFreeVcEnable;
    if (!isCreatorSettingsEnable) {
      // TODO: Convert createErrorResponse(404, 'Creator settings not available for this user') to res.status(404).json({ error: 'Creator settings not available for this user' })
      return res.status(404).json(createErrorResponse(404, 'Creator settings not available for this user'));
    }
    
    // Fetch creator settings
    const creatorSettings = await getCreatorSettingsByUserId(userId);

    // Build the settings configuration structure as an array for easier iteration
    const settingsConfigArray = [
      // Message Settings Section
      {
        section_id: "message_settings",
        section_title: "Message Settings",
        section_description: "Configure your messaging preferences and pricing",
        section_enabled: true,
        fields: [
          {
            field_id: "paid_messages",
            field_type: "toggle",
            field_enabled: true,
            field_label: "Paid Messages",
            field_description: "Enable this if you need to allow paid messages from fans",
            field_default_value: false,
            field_key: "paid_chat_status",
            field_value: creatorSettings.paid_chat_status || "no"
          },
          {
            field_id: "subscriber_price",
            field_type: "price_input",
            field_enabled: true,
            field_label: "Price per message for Subscriber",
            field_description: "Set price for messages from subscribers (0 = free)",
            field_min_value: Number(adminSettings.paid_chat_min) || 0,
            field_max_value: Number(adminSettings.paid_chat_max) || 999999,
            field_default_value: 0,
            field_key: "pc_sub_price",
            field_value: creatorSettings.pc_sub_price || 0,
            field_currency_icon: "🪙",
            field_validation: {
              required: false,
              min_validation_message: "Price must be at least {min_value} coins",
              max_validation_message: "Price should not exceed {max_value} coins"
            }
          },
          {
            field_id: "non_subscriber_price",
            field_type: "price_input",
            field_enabled: true,
            field_label: "Price per message for Non-Subscriber",
            field_description: "Set price for messages from non-subscribers",
            field_min_value: Number(adminSettings.paid_chat_min) || 0,
            field_max_value: Number(adminSettings.paid_chat_max) || 999999,
            field_default_value: 10,
            field_key: "pc_non_sub_price",
            field_value: creatorSettings.pc_non_sub_price || 10,
            field_currency_icon: "🪙",
            field_validation: {
              required: true,
              min_validation_message: "Price must be at least {min_value} coins",
              max_validation_message: "Price should not exceed {max_value} coins",
              custom_validation: "Subscriber price should not be greater than non-subscriber price"
            }
          }
        ]
      },
      // Call Features Section
      {
        section_id: "call_features",
        section_title: "Call Features",
        section_description: "Configure your video and audio calling preferences",
        section_enabled: true,
        fields: [
          {
            field_id: "free_video_call",
            field_type: "toggle",
            field_enabled: true,
            field_label: "Free Video Call",
            field_description: "Let everyone enjoy free 1-minute video calls — turn this on!",
            field_default_value: false,
            field_key: "free_video_call_status",
            field_value: creatorSettings.free_vdcl_status || "no"
          },
          {
            field_id: "video_call",
            field_type: "toggle",
            field_enabled: true,
            field_label: "Video Call",
            field_description: "Enable paid video calling for all users",
            field_default_value: false,
            field_key: "vdcl_status",
            field_value: creatorSettings.vdcl_status || "no"
          },
          {
            field_id: "video_call_price",
            field_type: "price_input",
            field_enabled: true,
            field_label: "Set your per minute price for video call",
            field_description: "Price per minute for video calls",
            field_min_value: Number(adminSettings.min_vdcl_coins) || 0,
            field_max_value: Number(adminSettings.max_vdcl_coins) || 999999,
            field_default_value: 0,
            field_key: "vdcl_min_coin",
            field_value: creatorSettings.vdcl_min_coin || 0,
            field_currency_icon: "🪙",
            field_validation: {
              required: false,
              min_validation_message: "Video call price must be at least {min_value} coins",
              max_validation_message: "Video call price should not exceed {max_value} coins"
            },
            field_depends_on: {
              field: "video_call",
              condition: "enabled"
            }
          },
          {
            field_id: "audio_call",
            field_type: "toggle",
            field_enabled: true,
            field_label: "Audio Call",
            field_description: "Enable paid audio calling for all users",
            field_default_value: false,
            field_key: "adcl_status",
            field_value: creatorSettings.adcl_status || "no"
          },
          {
            field_id: "audio_call_price",
            field_type: "price_input",
            field_enabled: true,
            field_label: "Set your per minute price for audio call",
            field_description: "Price per minute for audio calls",
            field_min_value: Number(adminSettings.min_audio_call_price) || 0,
            field_max_value: Number(adminSettings.max_audio_call_price) || 999999,
            field_default_value: 0,
            field_key: "audio_call_price",
            field_value: creatorSettings.audio_call_price || 0,
            field_currency_icon: "🪙",
            field_validation: {
              required: false,
              min_validation_message: "Audio call price must be at least {min_value} coins",
              max_validation_message: "Audio call price should not exceed {max_value} coins"
            },
            field_depends_on: {
              field: "audio_call",
              condition: "enabled"
            }
          }
        ]
      }
    ];

    // Build feature access object
    const featureAccess = {
      video_call_enabled: isVcEnable,
      audio_call_enabled: isAcEnable,
      paid_chat_enabled: isPaidChatEnable,
      free_video_call_enabled: isFreeVcEnable
    };

    // Build admin limits from admin settings
    const adminLimits = {
      paid_chat: {
        min_price: Number(adminSettings.paid_chat_min) || 0,
        max_price: Number(adminSettings.paid_chat_max) || 999999
      },
      video_call: {
        min_price: Number(adminSettings.min_vdcl_coins) || 0,
        max_price: Number(adminSettings.max_vdcl_coins) || 999999
      },
      audio_call: {
        min_price: Number(adminSettings.min_audio_call_price) || 0,
        max_price: Number(adminSettings.max_audio_call_price) || 999999
      }
    };

    // Build current values from user settings
    const currentValues = {
      paid_chat_status: creatorSettings.paid_chat_status,
      pc_sub_price: creatorSettings.pc_sub_price || 0,
      pc_non_sub_price: creatorSettings.pc_non_sub_price || 10,
      free_video_call_status: creatorSettings.free_vdcl_status,
      vdcl_status: creatorSettings.vdcl_status,
      vdcl_min_coin: creatorSettings.vdcl_min_coin || 0,
      adcl_status: creatorSettings.adcl_status,
      audio_call_price: creatorSettings.audio_call_price || 0
    };

    // Build UI configuration
    const uiConfig = {
      currency_symbol: "🪙",
      currency_code: "INR",
      currency_position: "left",
      decimal_format: "dot",
      button_style: "rounded"
    };

    // Return the complete structured response with array format
    // TODO: Convert createSuccessResponse('Creator settings configuration retrieved successfully', {...}) to res.status(200).json(createSuccessResponse('Creator settings configuration retrieved successfully', {...}))
    return res.status(200).json(createSuccessResponse('Creator settings configuration retrieved successfully', {
      settings_config: settingsConfigArray,
      feature_access: featureAccess,
      admin_limits: adminLimits,
      current_values: currentValues,
      ui_config: uiConfig
    }));
  } catch (error) {
    logError('Error fetching creator settings', error);
    // TODO: Convert createErrorResponse(500, 'Failed to fetch creator settings') to res.status(500).json({ error: 'Failed to fetch creator settings' })
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch creator settings'));
  }
};

/**
 * POST /creator/settings - Update creator settings for the authenticated user.
 * Exact implementation matching Lambda updateCreatorSettingsHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const updateCreatorSettings = async (req, res) => {
  // Extract and validate authenticated user
  // TODO: Convert getAuthenticatedUserId(event, { action: 'creator_settings updateCreatorSettingsHandler' }) to getAuthenticatedUserId(req, { action: 'creator_settings updateCreatorSettingsHandler' })
  const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'creator_settings updateCreatorSettingsHandler' });
  if (errorResponse) {
    // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
    return res.status(errorResponse.statusCode).json(errorResponse.body);
  }
  try {
    logInfo('Updating creator settings', { userId });
    
    // Parse request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body) to req.body (already parsed by Express middleware)
      requestBody = req.body;
    } catch (parseError) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }
    
    // Fetch user and admin settings
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    
    // Core Enablement Check: User must be verified
    if (user.verified_id !== 'yes') {
      // TODO: Convert createErrorResponse(404, 'User must be verified to update creator settings') to res.status(404).json({ error: 'User must be verified to update creator settings' })
      return res.status(404).json(createErrorResponse(404, 'User must be verified to update creator settings'));
    }
    
    const adminSettings = await getAdminSettings();
    
    // Check feature access for each feature
    const isVcEnable = await checkVideoCallAccess(userId, adminSettings);
    const isFreeVcEnable = await checkFreeVideoCallAccess(userId, adminSettings);
    const isAcEnable = await checkAudioCallAccess(userId, adminSettings);
    const isPaidChatEnable = await checkPaidChatAccess(userId, adminSettings);
    
    // Core Enablement Check: At least one feature must be enabled
    const isCreatorSettingsEnable = isVcEnable || isAcEnable || isPaidChatEnable || isFreeVcEnable;
    if (!isCreatorSettingsEnable) {
      // TODO: Convert createErrorResponse(404, 'Creator settings not available for this user') to res.status(404).json({ error: 'Creator settings not available for this user' })
      return res.status(404).json(createErrorResponse(404, 'Creator settings not available for this user'));
    }

    // --- Structured Validation for Flat Array Format ---
    const errors = [];
    
    // Validate required fields exist
    const requiredFields = ['vdcl_status', 'adcl_status', 'paid_chat_status', 'free_video_call_status'];
    for (const field of requiredFields) {
      if (requestBody[field] === undefined) {
        errors.push(`${field} is required.`);
      } else if (!['yes', 'no'].includes(requestBody[field])) {
        errors.push(`${field} must be 'yes' or 'no'.`);
      }
    }

    // Video Call validation - only validate price if video call is enabled
    if (isVcEnable && requestBody.vdcl_status === 'yes') {
      const min = Number(adminSettings.min_vdcl_coins) || 0;
      const max = Number(adminSettings.max_vdcl_coins) || 999999;
      const price = Number(requestBody.vdcl_min_coin);
      
      if (requestBody.vdcl_min_coin === undefined) {
        errors.push('Video call price (vdcl_min_coin) is required when video call is enabled.');
      } else if (!Number.isInteger(price)) {
        errors.push('Video call price must be a valid integer.');
      } else {
        if (price < min) errors.push(`Video call price must be at least ${min} coins.`);
        if (price > max) errors.push(`Video call price should not exceed ${max} coins.`);
      }
    }
    
    // Audio Call validation - only validate price if audio call is enabled
    if (isAcEnable && requestBody.adcl_status === 'yes') {
      const min = Number(adminSettings.min_audio_call_price) || 0;
      const max = Number(adminSettings.max_audio_call_price) || 999999;
      const price = Number(requestBody.audio_call_price);
      
      if (requestBody.audio_call_price === undefined) {
        errors.push('Audio call price (audio_call_price) is required when audio call is enabled.');
      } else if (!Number.isInteger(price)) {
        errors.push('Audio call price must be a valid integer.');
      } else {
        if (price < min) errors.push(`Audio call price must be at least ${min} coins.`);
        if (price > max) errors.push(`Audio call price should not exceed ${max} coins.`);
      }
    }
    
    // Paid Chat validation - only validate prices if paid chat is enabled
    if (isPaidChatEnable && requestBody.paid_chat_status === 'yes') {
      const min = Number(adminSettings.paid_chat_min) || 0;
      const max = Number(adminSettings.paid_chat_max) || 999999;
      const subPrice = Number(requestBody.pc_sub_price);
      const nonSubPrice = Number(requestBody.pc_non_sub_price);
      
      // Validate subscriber price
      if (requestBody.pc_sub_price === undefined) {
        errors.push('Subscriber price (pc_sub_price) is required when paid chat is enabled.');
      } else if (!Number.isInteger(subPrice)) {
        errors.push('Subscriber price must be a valid integer.');
      } else {
        if (subPrice !== 0 && subPrice < min) errors.push(`Subscriber price must be at least ${min} coins.`);
        if (subPrice > max) errors.push(`Subscriber price should not exceed ${max} coins.`);
      }
      
      // Validate non-subscriber price
      if (requestBody.pc_non_sub_price === undefined) {
        errors.push('Non-subscriber price (pc_non_sub_price) is required when paid chat is enabled.');
      } else if (!Number.isInteger(nonSubPrice)) {
        errors.push('Non-subscriber price must be a valid integer.');
      } else {
        if (nonSubPrice < min) errors.push(`Non-subscriber price must be at least ${min} coins.`);
        if (nonSubPrice > max) errors.push(`Non-subscriber price should not exceed ${max} coins.`);
      }
      
      // Custom validation: subscriber price <= non-subscriber price
      if (
        subPrice !== undefined && nonSubPrice !== undefined &&
        Number.isInteger(subPrice) && Number.isInteger(nonSubPrice) &&
        subPrice > nonSubPrice
      ) {
        errors.push('Subscriber price should not be greater than non-subscriber price.');
      }
    }

    // If validation errors, return all
    if (errors.length > 0) {
      // TODO: Convert Lambda response format to Express response format
      return res.status(400).json({
        success: false,
        errors
      });
    }

    // Transform flat format to the expected nested format for the utility function
    const transformedData = {
      video_call: {
        vdcl_status: requestBody.vdcl_status,
        vdcl_min_coin: requestBody.vdcl_min_coin || 0
      },
      audio_call: {
        adcl_status: requestBody.adcl_status,
        audio_call_price: requestBody.audio_call_price || 0
      },
      paid_chat: {
        paid_chat_status: requestBody.paid_chat_status,
        pc_sub_price: requestBody.pc_sub_price || 0,
        pc_non_sub_price: requestBody.pc_non_sub_price || 0
      },
      free_video_call: {
        free_vdcl_status: requestBody.free_video_call_status
      }
    };

    // Update creator settings
    const updateResult = await updateCreatorSettingsByUserId(userId, transformedData, {
      isVcEnable,
      isFreeVcEnable,
      isAcEnable,
      isPaidChatEnable,
      adminSettings
    });
    
    if (!updateResult.success) {
      // TODO: Convert createErrorResponse(400, updateResult.message) to res.status(400).json({ error: updateResult.message })
      return res.status(400).json(createErrorResponse(400, updateResult.message));
    }
    
    // TODO: Convert createSuccessResponse('Creator settings updated successfully') to res.status(200).json(createSuccessResponse('Creator settings updated successfully'))
    return res.status(200).json(createSuccessResponse('Creator settings updated successfully'));
  } catch (error) {
    logError('Error updating creator settings', error);
    // TODO: Convert createErrorResponse(500, 'Failed to update creator settings') to res.status(500).json({ error: 'Failed to update creator settings' })
    return res.status(500).json(createErrorResponse(500, 'Failed to update creator settings'));
  }
};

/**
 * Fetches the blocked country codes for a user from the database.
 * @param {number} userId - The user's ID.
 * @returns {Promise<string[]>} Array of blocked country codes.
 */
const getBlockedCountriesByUserId = async (userId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT blocked_countries FROM users WHERE id = ?',
      [userId]
    );
    if (!rows.length || !rows[0].blocked_countries) return [];
    return rows[0].blocked_countries.split(',').map(code => code.trim()).filter(Boolean);
  } catch (error) {
    logError('Error fetching blocked countries:', error);
    return [];
  }
};

/**
 * GET /creator/block-countries - Returns the list of countries blocked by the authenticated creator.
 * Exact implementation matching Lambda getBlockedCountriesHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const getBlockedCountries = async (req, res) => {
  try {
    // Authenticate and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'block_countries GET handler' }) to getAuthenticatedUserId(req, { action: 'block_countries GET handler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'block_countries GET handler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Check user verification status
    // TODO: Convert getVerifiedUserById(userId) to getUserById(userId) and check verified_id
    const user = await getUserById(userId);
    if (!user || user.verified_id !== 'yes') {
      // TODO: Convert createErrorResponse(404, 'User not found or access denied') to res.status(404).json({ error: 'User not found or access denied' })
      return res.status(404).json(createErrorResponse(404, 'User not found or access denied'));
    }

    // Fetch user's blocked countries (array of country codes)
    const userBlockedCountries = await getBlockedCountriesByUserId(userId);

    // TODO: Convert createSuccessResponse('Block countries/region retrieved successfully', {...}) to res.status(200).json(createSuccessResponse('Block countries/region retrieved successfully', {...}))
    return res.status(200).json(createSuccessResponse('Block countries/region retrieved successfully', {
      'blocked_countries': userBlockedCountries
    }));
  } catch (error) {
    logError('Error in getBlockedCountriesHandler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Updates the blocked countries for a user in the database.
 * @param {number} userId - The user's ID.
 * @param {string[]} countries - Array of country codes to block.
 * @returns {Promise<boolean>} Success status.
 */
const updateBlockedCountriesByUserId = async (userId, countries) => {
  try {
    const pool = getDB();
    const blockedCountriesString = countries.join(',');
    const [result] = await pool.query(
      'UPDATE users SET blocked_countries = ? WHERE id = ?',
      [blockedCountriesString, userId]
    );
    return result.affectedRows > 0;
  } catch (error) {
    logError('Error updating blocked countries:', error);
    return false;
  }
};

/**
 * Checks if all provided country codes exist in the countries table.
 * @param {string[]} countries - Array of country codes.
 * @returns {Promise<boolean>} True if all codes are valid.
 */
const validateCountryCodes = async (countries) => {
  if (!Array.isArray(countries) || countries.length === 0) return true;
  const pool = getDB();
  const placeholders = countries.map(() => '?').join(',');
  const [validCountries] = await pool.query(
    `SELECT country_code FROM countries WHERE country_code IN (${placeholders})`,
    countries
  );
  return validCountries.length === countries.length;
};

/**
 * POST /creator/block-countries - Updates the list of blocked countries for the authenticated creator.
 * Exact implementation matching Lambda postBlockedCountriesHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response
 */
export const updateBlockedCountries = async (req, res) => {
  try {
    // Authenticate and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'block_countries POST handler' }) to getAuthenticatedUserId(req, { action: 'block_countries POST handler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'block_countries POST handler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Check user verification status
    // TODO: Convert getVerifiedUserById(userId) to getUserById(userId) and check verified_id
    const user = await getUserById(userId);
    if (!user || user.verified_id !== 'yes') {
      // TODO: Convert createErrorResponse(404, 'User not found or access denied') to res.status(404).json({ error: 'User not found or access denied' })
      return res.status(404).json(createErrorResponse(404, 'User not found or access denied'));
    }

    // Parse and validate request body
    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body) to req.body (already parsed by Express middleware)
      requestBody = req.body;
    } catch (error) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }
    const { countries } = requestBody;
    if (!Array.isArray(countries)) {
      // TODO: Convert createErrorResponse(400, 'Countries must be an array') to res.status(400).json({ error: 'Countries must be an array' })
      return res.status(400).json(createErrorResponse(400, 'Countries must be an array'));
    }
    // Validate country codes
    const valid = await validateCountryCodes(countries);
    if (!valid) {
      // TODO: Convert createErrorResponse(400, 'Invalid country code provided') to res.status(400).json({ error: 'Invalid country code provided' })
      return res.status(400).json(createErrorResponse(400, 'Invalid country code provided'));
    }
    
    // Determine update mode: default to toggling provided countries (remove if already blocked, add if not)
    // const mode = typeof requestBody.mode === 'string' ? requestBody.mode.toLowerCase() : 'toggle';

    // Fetch existing blocked countries for this user
    // const existingBlockedCountries = await getBlockedCountriesByUserId(userId);

    // let finalBlockedCountries;
    // if (mode === 'replace') {
    //   // Replace entire list with provided countries (deduplicated)
    //   finalBlockedCountries = Array.from(new Set(countries));
    // } else if (mode === 'remove') {
    //   // Remove provided countries from existing list
    //   const removeSet = new Set(countries);
    //   finalBlockedCountries = existingBlockedCountries.filter(code => !removeSet.has(code));
    // } else if (mode === 'toggle') {
    //   // Toggle: if a code exists, remove it; otherwise add it
    //   const toggledSet = new Set(existingBlockedCountries);
    //   for (const code of new Set(countries)) {
    //     if (toggledSet.has(code)) {
    //       toggledSet.delete(code);
    //     } else {
    //       toggledSet.add(code);
    //     }
    //   }
    //   finalBlockedCountries = Array.from(toggledSet);
    // } else {
    //   // Merge (fallback): add provided countries to existing list (deduplicated)
    //   finalBlockedCountries = Array.from(new Set([...existingBlockedCountries, ...countries]));
    // }

    const finalBlockedCountries = Array.from(new Set(countries));

    // Update blocked countries
    const success = await updateBlockedCountriesByUserId(userId, finalBlockedCountries);
    if (!success) {
      // TODO: Convert createErrorResponse(500, 'Failed to update blocked countries') to res.status(500).json({ error: 'Failed to update blocked countries' })
      return res.status(500).json(createErrorResponse(500, 'Failed to update blocked countries'));
    }
    // TODO: Convert createSuccessResponse('Block countries updated successfully') to res.status(200).json(createSuccessResponse('Block countries updated successfully'))
    return res.status(200).json(createSuccessResponse('Block countries updated successfully'));
  } catch (error) {
    logError('Error in postBlockedCountriesHandler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

// Subscription intervals in display order
const SUBSCRIPTION_INTERVALS = ['weekly', 'monthly', 'quarterly', 'biannually', 'yearly'];

// Human-readable interval names for consistent UI labels
const INTERVAL_DISPLAY_NAMES = {
  weekly: 'Weekly',
  monthly: 'Per month',
  quarterly: '3 months',
  biannually: '6 months',
  yearly: '12 months'
};

// Commission configuration will be computed per-request based on user/admin settings
// Default fallback values used only if DB values are unavailable
const DEFAULT_COMMISSION_PERCENTAGE = 75;

// UI configuration constants
const UI_CONFIG = {
  currency_symbol: '🪙',
  currency_code: 'INR'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get human-readable interval name for consistent UI labels
 * @param {string} interval - Subscription interval key
 * @returns {string} Human-readable interval name
 */
const getIntervalDisplayName = (interval) => {
  return INTERVAL_DISPLAY_NAMES[interval] || interval;
};

/**
 * Validate subscription request data against business rules
 * @param {object} requestBody - Request body data
 * @param {object} adminSettings - Admin settings for validation
 * @returns {object} Validation result with success status and errors
 */
const validateSubscriptionRequest = (requestBody, adminSettings) => {
  const errors = [];
  const { min_subscription_amount = 0, max_subscription_amount = 999999 } = adminSettings || {};
  
  const hasActiveSubscription = SUBSCRIPTION_INTERVALS.some(interval => {
    const priceKey = interval === 'monthly' ? 'price' : `price_${interval}`;
    return requestBody[priceKey] && parseFloat(requestBody[priceKey]) > 0;
  });
  
  if (!hasActiveSubscription && !requestBody.free_subscription) errors.push('At least one subscription option must be enabled or free subscription must be enabled');
  
  SUBSCRIPTION_INTERVALS.forEach(interval => {
    const statusKey = `status_${interval}`;
    const priceKey = interval === 'monthly' ? 'price' : `price_${interval}`;
    
    if (requestBody[statusKey] === '1' && (!requestBody[priceKey] || parseFloat(requestBody[priceKey]) <= 0)) {
      errors.push(`Subscription Price field is required when status is on for ${getIntervalDisplayName(interval)}`);
    }
    
    if (requestBody[priceKey]) {
      const price = parseFloat(requestBody[priceKey]);
      if (isNaN(price) || price < min_subscription_amount) errors.push(`${getIntervalDisplayName(interval)} price must be at least ${min_subscription_amount} coins`);
      if (price > max_subscription_amount) errors.push(`${getIntervalDisplayName(interval)} price cannot exceed ${max_subscription_amount} coins`);
    }
  });
  
  return { isValid: errors.length === 0, errors };
};

// ============================================================================
// DATA FORMATTING
// ============================================================================

/**
 * Format subscription plans data for API response
 * @param {object} subscriptionData - Raw subscription data from database
 * @returns {object} Formatted subscription data for UI consumption
 */
const formatSubscriptionPlansData = ({ plansByInterval, welcomeMessage, freeSubscription }, commissionPercentage) => {
  const formattedData = SUBSCRIPTION_INTERVALS.map(interval => {
    const planData = plansByInterval[interval] || { price: 0, status: '0' };
    const priceKey = interval === 'monthly' ? 'price' : `price_${interval}`;
    const statusKey = `status_${interval}`;
    
    return {
      interval,
      display_name: getIntervalDisplayName(interval),
      [priceKey]: parseFloat(planData.price) || 0,
      [statusKey]: planData.status || '0'
    };
  });

  const pct = Number(commissionPercentage) || DEFAULT_COMMISSION_PERCENTAGE;
  const commission = {
    percentage: pct,
    message: `You will receive ${pct}% for each transaction`
  };

  return { plans: formattedData, subscribe_chatmessage: welcomeMessage, free_subscription: freeSubscription, commission, ui_config: UI_CONFIG };
};

/**
 * Process subscription plan updates for all intervals
 * @param {number} userId - User ID
 * @param {object} requestBody - Request body data
 * @returns {Promise<boolean>} Success status
 */
const processSubscriptionPlanUpdates = async (userId, requestBody) => {
  const updatePromises = [];
  
  SUBSCRIPTION_INTERVALS.forEach(interval => {
    const statusKey = `status_${interval}`;
    const priceKey = interval === 'monthly' ? 'price' : `price_${interval}`;
    
    if (requestBody[statusKey] !== undefined || requestBody[priceKey] !== undefined) {
      const price = requestBody[priceKey] ? parseFloat(requestBody[priceKey]) : 0;
      const status = requestBody[statusKey] || '0';
      updatePromises.push(updateSubscriptionPlan(userId, interval, { price, status }));
    }
  });

  if (updatePromises.length > 0) {
    const planUpdateResults = await Promise.all(updatePromises);
    return !planUpdateResults.some(result => !result);
  }
  
  return true;
};

/**
 * GET /creator/subscription-setting - Main handler to fetch creator subscription settings (GET)
 * Exact implementation matching Lambda subscriptionHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response with subscription data or error
 */
export const getSubscriptionSettings = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { action: 'fetch subscription settings' }) to getAuthenticatedUserId(req, { action: 'fetch subscription settings' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'fetch subscription settings' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'Creator not found') to res.status(404).json({ error: 'Creator not found' })
      return res.status(404).json(createErrorResponse(404, 'Creator not found'));
    }

    const subscriptionData = await getUserSubscriptionPlans(userId, SUBSCRIPTION_INTERVALS);
    if (!subscriptionData) {
      // TODO: Convert createErrorResponse(500, 'Failed to fetch subscription data') to res.status(500).json({ error: 'Failed to fetch subscription data' })
      return res.status(500).json(createErrorResponse(500, 'Failed to fetch subscription data'));
    }
    
    // Compute commission percentage: use user's custom_fee; if 0 use admin fee_commission
    const admin = await getAdminSettings();
    const userCustomFee = Number(user.custom_fee || 0);
    const adminFeeCommission = Number(admin?.fee_commission || 0);
    const commissionPercentage = userCustomFee > 0 ? (100 - userCustomFee) : (100 - adminFeeCommission);

    logInfo('Creator subscription plans fetched successfully:', { userId, username: user.username, plansCount: subscriptionData.plans?.length || 0 });

    // TODO: Convert createSuccessResponse('Creator subscription plans fetched successfully', {...}) to res.status(200).json(createSuccessResponse('Creator subscription plans fetched successfully', {...}))
    return res.status(200).json(createSuccessResponse('Creator subscription plans fetched successfully', { subscriptionSettings: formatSubscriptionPlansData(subscriptionData, commissionPercentage) }));

  } catch (error) {
    logError('Unexpected error in creator subscription handler:', { error: error.message, stack: error.stack });
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', message: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * POST /creator/subscription-setting - Handler to update creator subscription settings (POST)
 * Exact implementation matching Lambda updateSubscriptionHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response with success status or error
 */
export const updateSubscriptionSettings = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { action: 'update subscription settings' }) to getAuthenticatedUserId(req, { action: 'update subscription settings' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'update subscription settings' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    let requestBody;
    try {
      // TODO: Convert JSON.parse(event.body) to req.body (already parsed by Express middleware)
      requestBody = req.body;
    } catch (parseError) {
      // TODO: Convert createErrorResponse(400, 'Invalid JSON in request body') to res.status(400).json({ error: 'Invalid JSON in request body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }

    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'Creator not found') to res.status(404).json({ error: 'Creator not found' })
      return res.status(404).json(createErrorResponse(404, 'Creator not found'));
    }

    const adminSettings = await getAdminSettings();
    if (!adminSettings) {
      // TODO: Convert createErrorResponse(500, 'Failed to fetch admin settings') to res.status(500).json({ error: 'Failed to fetch admin settings' })
      return res.status(500).json(createErrorResponse(500, 'Failed to fetch admin settings'));
    }

    const validation = validateSubscriptionRequest(requestBody, adminSettings);
    if (!validation.isValid) {
      // TODO: Convert createErrorResponse(400, 'Validation failed', validation.errors) to res.status(400).json({ error: 'Validation failed', errors: validation.errors })
      return res.status(400).json(createErrorResponse(400, 'Validation failed'));
    }

    const planUpdateSuccess = await processSubscriptionPlanUpdates(userId, requestBody);
    if (!planUpdateSuccess) {
      // TODO: Convert createErrorResponse(500, 'Failed to update some subscription plans') to res.status(500).json({ error: 'Failed to update some subscription plans' })
      return res.status(500).json(createErrorResponse(500, 'Failed to update some subscription plans'));
    }

    if (!requestBody.free_subscription || requestBody.free_subscription !== 'yes') {
      const messageUpdateSuccess = await updateSubscriptionMessage(userId, requestBody.subscribe_chatmessage);
      if (!messageUpdateSuccess) {
        // TODO: Convert createErrorResponse(500, 'Failed to update subscription message') to res.status(500).json({ error: 'Failed to update subscription message' })
        return res.status(500).json(createErrorResponse(500, 'Failed to update subscription message'));
      }
    }

    const freeSubscriptionUpdateSuccess = await updateUserFreeSubscription(userId, requestBody.free_subscription);
    if (!freeSubscriptionUpdateSuccess) {
      // TODO: Convert createErrorResponse(500, 'Failed to update free subscription status') to res.status(500).json({ error: 'Failed to update free subscription status' })
      return res.status(500).json(createErrorResponse(500, 'Failed to update free subscription status'));
    }

    // Fetch updated subscription data to return in response
    const updatedSubscriptionData = await getUserSubscriptionPlans(userId, SUBSCRIPTION_INTERVALS);
    if (!updatedSubscriptionData) {
      // TODO: Convert createErrorResponse(500, 'Failed to fetch updated subscription data') to res.status(500).json({ error: 'Failed to fetch updated subscription data' })
      return res.status(500).json(createErrorResponse(500, 'Failed to fetch updated subscription data'));
    }

    // Recompute commission percentage for response
    const userCustomFee = Number(user.custom_fee || 0);
    const adminFeeCommission = Number(adminSettings?.fee_commission || 0);
    const commissionPercentage = userCustomFee > 0 ? (100 - userCustomFee) : (100 - adminFeeCommission);

    logInfo('Subscription Price Updated!!!', { 
      userId, 
      username: user.username,
      updatedIntervals: Object.keys(requestBody).filter(key => key.startsWith('price_') && requestBody[key] && parseFloat(requestBody[key]) > 0).map(key => key.replace('price_', '')),
      freeSubscription: requestBody.free_subscription
    });

    // TODO: Convert createSuccessResponse('Subscription Price Updated', {...}) to res.status(200).json(createSuccessResponse('Subscription Price Updated', {...}))
    return res.status(200).json(createSuccessResponse('Subscription Price Updated', { 
      message: 'Subscription Price Updated!!!',
      subscriptionSettings: formatSubscriptionPlansData(updatedSubscriptionData, commissionPercentage)
    }));

  } catch (error) {
    logError('Unexpected error in creator subscription update handler:', { error: error.message, stack: error.stack });
    // TODO: Convert createErrorResponse(500, 'Internal server error', error.message) to res.status(500).json({ error: 'Internal server error', message: error.message })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /creator/agreement - Handler for creator agreement page
 * Exact implementation matching Lambda getCreatorAgreementHandler
 * Returns user details and company information needed for the agreement form
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} Response object with user details and company info
 */
export const getCreatorAgreement = async (req, res) => {
  try {
    logInfo('Creator agreement GET handler called', { event: req });

    // Authenticate user and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'creator agreement access' }) to getAuthenticatedUserId(req, { action: 'creator agreement access' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      action: 'creator agreement access' 
    });

    if (errorResponse) {
      logError('Authentication failed for creator agreement', { userId, error: errorResponse });
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Get user details from database
    const user = await getUserById(userId);
    if (!user) {
      logError('User not found for creator agreement', { userId });
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Prepare response data based on what's shown in creator_agreement.blade.php
    const responseData = {
      user: {
        id: user.id,
        name: user.name || '',
        email: user.email || '',
        mobile: user.mobile || '',
        address: user.address || '',
        city: user.city || '',
        zip: user.zip || '',
      },
      agreement: {
        current_date: new Date().toISOString(),
        current_month: new Date().toLocaleString('en-US', { month: 'long' }),
        current_year: new Date().getFullYear(),
        current_day: new Date().getDate()
      }
    };

    // TODO: Convert createSuccessResponse(responseData, 'Creator agreement data retrieved successfully') to res.status(200).json(createSuccessResponse('Creator agreement data retrieved successfully', responseData))
    return res.status(200).json(createSuccessResponse('Creator agreement data retrieved successfully', responseData));

  } catch (error) {
    // TODO: Convert createErrorResponse(500, 'Internal server error while retrieving agreement data') to res.status(500).json({ error: 'Internal server error while retrieving agreement data' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error while retrieving agreement data'));
  }
};

/**
 * Update user's agreement_date in database
 * @param {number} userId - User ID
 */
const updateUserAgreementDate = async (userId) => {
  try {
    const pool = getDB();
    await pool.query(
      'UPDATE users SET agreement_date = NOW() WHERE id = ?',
      [userId]
    );
    logInfo('User agreement date updated', { userId });
  } catch (error) {
    logError('Error updating user agreement date', { userId, error: error.message });
    throw error;
  }
};

/**
 * Create ticket conversation records for agreement
 * @param {number} userId - User ID
 * @param {string} imageName - Image name (e.g., 'creator_123')
 * @param {object} processedMedia - Processed media information
 * @param {string} creatorPhoto - Creator photo filename
 */
const createTicketConversations = async (userId, imageName, processedMedia, creatorPhoto) => {
  try {
    const pool = getDB();
    // Insert agreement-download record - following Templar structure
    await pool.query(
      'INSERT INTO ticket_conversations (user_id, to_user_id, message, image, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [userId, 1, 'agreement-download', '', '2']
    );

    // Insert agreement-image record
    // Find the creator photo filename from processed media
    let imageFilename = '';
    if (processedMedia && processedMedia.converted.length > 0) {
      // Look for the creator photo in converted files (WebP)
      const creatorPhotoKey = processedMedia.converted.find(key => key.includes(creatorPhoto));
      if (creatorPhotoKey) {
        imageFilename = creatorPhotoKey.split('/').pop(); // Get filename without path
      }
    }
    
    if (!imageFilename && processedMedia && processedMedia.original.length > 0) {
      // Fallback: Look for creator photo in original files
      const creatorPhotoKey = processedMedia.original.find(key => key.includes(creatorPhoto));
      if (creatorPhotoKey) {
        imageFilename = creatorPhotoKey.split('/').pop();
      }
    }
    
    if (!imageFilename) {
      // Fallback to original pattern if no processed media found
      imageFilename = `${imageName}.webp`;
    }

    await pool.query(
      'INSERT INTO ticket_conversations (user_id, to_user_id, message, image, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
      [userId, 1, 'agreement-image', imageFilename, '2']
    );

    logInfo('Ticket conversations created for agreement', { userId, imageName, imageFilename });
  } catch (error) {
    logError('Error creating ticket conversations', { userId, error: error.message });
    throw error;
  }
};

/**
 * Send agreement notification to user - following Templar structure
 * @param {number} userId - User ID
 */
const sendAgreementNotification = async (userId) => {
  try {
    const pool = getDB();
    // Insert notification record - following Templar's Notifications::send('1', $authId, '24', $authId)
    await pool.query(
      'INSERT INTO notifications (author, destination, type, target, created_at) VALUES (?, ?, ?, ?, NOW())',
      [1, userId, '24', userId]
    );

    logInfo('Agreement notification sent', { userId });
  } catch (error) {
    logError('Error sending agreement notification', { userId, error: error.message });
    // Don't throw error for notification failure as it's not critical
  }
};

/**
 * POST /creator/agreement - Handler for creator agreement submission
 * Exact implementation matching Lambda postCreatorAgreementHandler
 * Processes agreement form data including images and signature
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} Response object with success/error message
 */
export const postCreatorAgreement = async (req, res) => {
  try {
    // Authenticate user and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'creator agreement submission' }) to getAuthenticatedUserId(req, { action: 'creator agreement submission' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'creator agreement submission' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Parse request body
    // TODO: Convert JSON.parse(event.body) to req.body (already parsed by Express middleware)
    const requestBody = req.body;
    
    // Validate required fields
    const requiredFields = ['creatorName', 'creator_name', 'email', 'mobile', 'address', 'creatorPhoto', 'signature'];
    const missingFields = requiredFields.filter(field => !requestBody[field]);
    
    if (missingFields.length > 0) {
      logError('Missing required fields for creator agreement', { userId, missingFields });
      // TODO: Convert createErrorResponse(400, `Missing required fields: ${missingFields.join(', ')}`) to res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` })
      return res.status(400).json(createErrorResponse(400, `Missing required fields: ${missingFields.join(', ')}`));
    }

    // Extract data from request
    const {
      creatorName,
      creator_name,
      email,
      mobile,
      address,
      creatorPhoto,
      signature
    } = requestBody;

    // Validate that images are filenames (uploaded via upload URL first)
    if (!creatorPhoto || typeof creatorPhoto !== 'string' || creatorPhoto.trim().length === 0) {
      // TODO: Convert createErrorResponse(400, 'Creator photo filename is required') to res.status(400).json({ error: 'Creator photo filename is required' })
      return res.status(400).json(createErrorResponse(400, 'Creator photo filename is required'));
    }
    
    if (!signature || typeof signature !== 'string' || signature.trim().length === 0) {
      // TODO: Convert createErrorResponse(400, 'Signature filename is required') to res.status(400).json({ error: 'Signature filename is required' })
      return res.status(400).json(createErrorResponse(400, 'Signature filename is required'));
    }

    // Get user details to verify
    const user = await getUserById(userId);
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Get S3 bucket configuration from environment
    const { AWS_AGREEMENT_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      // TODO: Convert createErrorResponse(500, 'Media storage not configured') to res.status(500).json({ error: 'Media storage not configured' })
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files if provided (exactly like posts, messages, and payout do)
    let processedMedia = { original: [], converted: [] };
    let mediaProcessingFailed = false;
    
    // Create array of image filenames for processing
    const imageFiles = [creatorPhoto, signature];
    
    try {
      logInfo('Starting creator agreement media processing:', { mediaCount: imageFiles.length, files: imageFiles });
      processedMedia = await processMediaFiles(imageFiles, bucketName, 'creator_agreement', { continueOnError: false });
      logInfo('Creator agreement media processing completed successfully:', { 
        originalCount: processedMedia.original.length,
        convertedCount: processedMedia.original.length
      });
    } catch (error) {
      logError('Creator agreement media processing failed:', { error: error.message });
      mediaProcessingFailed = true;
      
      // Clean up any S3 files that might have been uploaded during processing
      try {
        logInfo('Cleaning up S3 files due to media processing failure');
        await cleanupS3Files(processedMedia.original, processedMedia.converted, bucketName, 'creator_agreement');
      } catch (cleanupError) {
        logError('Failed to cleanup S3 files after media processing failure:', { 
          cleanupError: cleanupError.message 
        });
      }
      
      // TODO: Convert createErrorResponse(500, 'Media processing failed', error.message) to res.status(500).json({ error: 'Media processing failed', message: error.message })
      return res.status(500).json(createErrorResponse(500, 'Media processing failed'));
    }

    // Check if face is visible using AWS Rekognition (only for creator photo)
    if (processedMedia.original.length > 0) {
      try {
        // Download the creator photo from S3 for face detection
        const creatorPhotoKey = processedMedia.original.find(key => key.includes(creatorPhoto));
        if (creatorPhotoKey) {
          const creatorPhotoBuffer = await downloadFile(bucketName, creatorPhotoKey);
          const faceDetectionResult = await checkFaceVisibility(creatorPhotoBuffer);
          
          if (faceDetectionResult.face_found !== true) {
            // Clean up uploaded files if face detection fails
            await cleanupS3Files(processedMedia.original, processedMedia.converted, bucketName, 'creator_agreement');
            // TODO: Convert createErrorResponse(400, 'Face is not visible in creator photo') to res.status(400).json({ error: 'Face is not visible in creator photo' })
            return res.status(400).json(createErrorResponse(400, 'Face is not visible in creator photo'));
          }
        }
      } catch (faceError) {
        logError('Face detection failed:', { error: faceError.message });
        // Clean up uploaded files if face detection fails
        await cleanupS3Files(processedMedia.original, processedMedia.converted, bucketName, 'creator_agreement');
        // TODO: Convert createErrorResponse(500, 'Face detection failed') to res.status(500).json({ error: 'Face detection failed' })
        return res.status(500).json(createErrorResponse(500, 'Face detection failed'));
      }
    }

    // Generate image name for database storage
    const imageName = `creator_${userId}`;

    // Note: Signature is NOT stored separately - it's only rendered in the PDF

    // Generate PDF agreement using processed media
    const pdfData = {
      creatorName: creatorName,
      creator_name: creator_name,
      email: email,
      mobile: mobile,
      address: address,
      signatureData: signature // Use signature filename
    };

    let pdfBuffer;
    try {
      pdfBuffer = await generateCreatorAgreementPDF(pdfData);
      logInfo('PDF agreement generated successfully', { userId, pdfSize: pdfBuffer.length });
    } catch (pdfError) {
      logError('PDF generation failed', { userId, error: pdfError.message });
      // Continue without PDF if generation fails
    }

    // Upload PDF to S3 if generated successfully
    let pdfKey = null;
    if (pdfBuffer) {
      try {
        // Use the agreement bucket with agreement_pdf folder structure
        pdfKey = `agreement_pdf/creator_${userId}.pdf`;
        await uploadFile(bucketName, pdfKey, pdfBuffer, 'application/pdf');
        logInfo('PDF agreement uploaded to S3', { userId, pdfKey });
      } catch (uploadError) {
        logError('PDF upload failed', { userId, error: uploadError.message });
        // Continue without PDF upload if it fails
      }
    }

    // Update user agreement_date in database
    await updateUserAgreementDate(userId);
    
    // Create ticket conversation records using processed media
    await createTicketConversations(userId, imageName, processedMedia, creatorPhoto);

    // Send notification
    await sendAgreementNotification(userId);

    // TODO: Convert createSuccessResponse({...}, 'Creator agreement submitted successfully') to res.status(200).json(createSuccessResponse('Creator agreement submitted successfully', {...}))
    return res.status(200).json(createSuccessResponse('Creator agreement submitted successfully', {
      message: 'Creator agreement submitted successfully',
      agreement_date: new Date().toISOString(),
      image_name: imageName,
      redirect_url: '/payout/conversations',
      pdf_generated: !!pdfBuffer,
      pdf_key: pdfKey,
      media_processed: !mediaProcessingFailed,
      original_count: processedMedia.original.length,
      converted_count: processedMedia.converted.length
    }));

  } catch (error) {
    logError('Error in creator agreement POST handler', { 
      error: error.message, 
      stack: error.stack,
      userId: req?.userId 
    });
    
    // TODO: Convert createErrorResponse(500, 'Internal server error while submitting agreement') to res.status(500).json({ error: 'Internal server error while submitting agreement' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error while submitting agreement'));
  }
};

/**
 * GET /creator/upload-url - Handler to generate pre-signed S3 URLs for uploading multiple creator agreement files.
 * Exact implementation matching Lambda getCreatorAgreementUploadUrlHandler
 * Uses the shared processUploadRequest utility to eliminate code duplication.
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} API response with pre-signed URLs or error
 */
export const getUploadUrl = async (req, res) => {
  // Configuration options for creator agreement upload processing with destructuring
  const uploadOptions = {
    action: 'getCreatorAgreementUploadUrl',
    basePath: 'agreement_image',
    useFolderOrganization: false,
    successMessage: 'Pre-signed creator agreement upload URLs generated',
    getAuthenticatedUserId
  };
  
  // Use shared upload processing utility and return result directly
  // TODO: Convert processUploadRequest(event, uploadOptions) to processUploadRequest(req, uploadOptions)
  const result = await processUploadRequest(req, uploadOptions);
  
  // TODO: Convert Lambda response format to Express response format
  if (result.statusCode) {
    return res.status(result.statusCode).json(JSON.parse(result.body));
  }
  
  return res.json(result);
};

/**
 * GET /creator/agreement-pdf - Handler for downloading creator agreement PDF
 * Exact implementation matching Lambda downloadCreatorAgreementPdfHandler
 * Downloads the PDF file from S3 and returns it as a downloadable response
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} Response object with PDF file or error message
 */
export const downloadCreatorAgreementPdf = async (req, res) => {
  try {
    // Authenticate user and get user ID
    // TODO: Convert getAuthenticatedUserId(event, { action: 'creator agreement PDF download' }) to getAuthenticatedUserId(req, { action: 'creator agreement PDF download' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      action: 'creator agreement PDF download' 
    });

    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    // Fetch user to build a friendly download filename
    let safeUserName = 'user';
    try {
      const user = await getUserById(userId);
      if (user?.name) {
        safeUserName = String(user.name)
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
      }
    } catch (_) {
      // ignore, fallback to default
    }

    // Get PDF from S3
    const bucketName = process.env.AWS_AGREEMENT_BUCKET_NAME || 'bingmeee-agreement';
    const pdfKey = `agreement_pdf/creator_${userId}.pdf`;
    
    // Prefer S3 existence over DB flags: if the file exists, serve it
    const exists = await checkFileExists(bucketName, pdfKey);
    if (!exists) {
      // TODO: Convert createErrorResponse(404, 'PDF not found') to res.status(404).json({ error: 'PDF not found' })
      return res.status(404).json(createErrorResponse(404, 'PDF not found'));
    }
    
    const pdfBuffer = await downloadFile(bucketName, pdfKey);
    
    // Return PDF as downloadable file
    // TODO: Convert Lambda response format to Express response format
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="agreement-${safeUserName}.pdf"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
    });
    
    return res.send(pdfBuffer);

  } catch (error) {
    logError('Error in creator agreement PDF download handler', { 
      error: error.message, 
      stack: error.stack,
      userId: req?.userId 
    });
    
    // TODO: Convert createErrorResponse(500, 'Internal server error while downloading PDF') to res.status(500).json({ error: 'Internal server error while downloading PDF' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error while downloading PDF'));
  }
};

/**
 * GET /creator/payment-received - Get payments received by creator
 * Exact implementation matching Lambda getPaymentsReceivedHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response with payments data
 */
export const getPaymentsReceived = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { action: 'get payments received' }) to getAuthenticatedUserId(req, { action: 'get payments received' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'get payments received' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    const { page = 1, limit = 10 } = req.query;
    const pool = getDB();
    
    const offset = (page - 1) * limit;
    
    // Get payments received
    const [payments] = await pool.query(`
      SELECT 
        p.*,
        u.name as payer_name,
        u.username as payer_username
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.creator_id = ?
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);
    
    // Get total count
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM payments WHERE creator_id = ?',
      [userId]
    );
    
    const total = countResult[0].total;
    
    // TODO: Convert createSuccessResponse('Payments received retrieved successfully', {...}) to res.status(200).json(createSuccessResponse('Payments received retrieved successfully', {...}))
    return res.status(200).json(createSuccessResponse('Payments received retrieved successfully', {
      payments,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }));
  } catch (error) {
    logError('Error fetching payments received:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /creator/withdrawals - Get withdrawals for creator
 * Exact implementation matching Lambda getWithdrawalsHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {object} API response with withdrawals data
 */
export const getWithdrawals = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { action: 'get withdrawals' }) to getAuthenticatedUserId(req, { action: 'get withdrawals' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'get withdrawals' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(errorResponse.body);
    }

    const { page = 1, limit = 10 } = req.query;
    const pool = getDB();
    
    const offset = (page - 1) * limit;
    
    // Get withdrawals
    const [withdrawals] = await pool.query(`
      SELECT *
      FROM withdrawals
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);
    
    // Get total count
    const [countResult] = await pool.query(
      'SELECT COUNT(*) as total FROM withdrawals WHERE user_id = ?',
      [userId]
    );
    
    const total = countResult[0].total;
    
    // TODO: Convert createSuccessResponse('Withdrawals retrieved successfully', {...}) to res.status(200).json(createSuccessResponse('Withdrawals retrieved successfully', {...}))
    return res.status(200).json(createSuccessResponse('Withdrawals retrieved successfully', {
      withdrawals,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    }));
  } catch (error) {
    logError('Error fetching withdrawals:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
}