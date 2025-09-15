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
  createExpressErrorResponse
} from '../utils/common.js';

/**
 * GET Creator Settings
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getCreatorSettings = async (req, res) => {
  try {
    const userId = req.userId;
    logInfo('Fetching creator settings', { userId });
    
    // Fetch user and admin settings
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }
    
    // Core Enablement Check: User must be verified
    if (user.verified_id !== 'yes') {
      return res.status(404).json(createExpressErrorResponse('User must be verified to access creator settings', 404));
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
      return res.status(404).json(createExpressErrorResponse('Creator settings not available for this user', 404));
    }
    
    // Fetch creator settings
    const creatorSettings = await getCreatorSettingsByUserId(userId);

    // Build the settings configuration structure
    const settingsConfig = {
      video_call: {
        enabled: isVcEnable,
        status: creatorSettings.vdcl_status || 'no',
        min_coin: creatorSettings.vdcl_min_coin || 0
      },
      free_video_call: {
        enabled: isFreeVcEnable,
        status: creatorSettings.free_vdcl_status || 'no'
      },
      audio_call: {
        enabled: isAcEnable,
        status: creatorSettings.adcl_status || 'no',
        price: creatorSettings.audio_call_price || 0
      },
      paid_chat: {
        enabled: isPaidChatEnable,
        status: creatorSettings.paid_chat_status || 'no',
        sub_price: creatorSettings.pc_sub_price || 0,
        non_sub_price: creatorSettings.pc_non_sub_price || 0
      }
    };

    return res.json(createExpressSuccessResponse('Creator settings retrieved successfully', {
      settings: settingsConfig,
      admin_settings: {
        video_call_min: adminSettings.video_call_min || 0,
        video_call_max: adminSettings.video_call_max || 999999,
        audio_call_min: adminSettings.audio_call_min || 0,
        audio_call_max: adminSettings.audio_call_max || 999999,
        paid_chat_min: adminSettings.paid_chat_min || 0,
        paid_chat_max: adminSettings.paid_chat_max || 999999
      }
    }));
  } catch (error) {
    logError('Error fetching creator settings:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * POST Update Creator Settings
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const updateCreatorSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const data = req.body;
    
    logInfo('Updating creator settings', { userId, data });
    
    // Fetch user and admin settings
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }
    
    // Core Enablement Check: User must be verified
    if (user.verified_id !== 'yes') {
      return res.status(404).json(createExpressErrorResponse('User must be verified to access creator settings', 404));
    }
    
    const adminSettings = await getAdminSettings();
    
    // Check feature access for each feature
    const isVcEnable = await checkVideoCallAccess(userId, adminSettings);
    const isFreeVcEnable = await checkFreeVideoCallAccess(userId, adminSettings);
    const isAcEnable = await checkAudioCallAccess(userId, adminSettings);
    const isPaidChatEnable = await checkPaidChatAccess(userId, adminSettings);
    
    // Prepare access object
    const access = {
      isVcEnable,
      isFreeVcEnable,
      isAcEnable,
      isPaidChatEnable
    };
    
    // Update creator settings
    const result = await updateCreatorSettingsByUserId(userId, data, access);
    
    if (!result.success) {
      return res.status(400).json(createExpressErrorResponse(result.message || 'Failed to update creator settings', 400));
    }
    
    return res.json(createExpressSuccessResponse('Creator settings updated successfully'));
  } catch (error) {
    logError('Error updating creator settings:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Blocked Countries
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getBlockedCountries = async (req, res) => {
  try {
    const userId = req.userId;
    const pool = getDB();
    
    // Get user's blocked countries
    const [rows] = await pool.query(
      'SELECT blocked_countries FROM users WHERE id = ?',
      [userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }
    
    const blockedCountries = rows[0].blocked_countries ? 
      rows[0].blocked_countries.split(',').map(country => country.trim()) : [];
    
    return res.json(createExpressSuccessResponse('Blocked countries retrieved successfully', {
      blocked_countries: blockedCountries
    }));
  } catch (error) {
    logError('Error fetching blocked countries:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * POST Update Blocked Countries
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const updateBlockedCountries = async (req, res) => {
  try {
    const userId = req.userId;
    const { blocked_countries } = req.body;
    const pool = getDB();
    
    // Validate blocked_countries is an array
    if (!Array.isArray(blocked_countries)) {
      return res.status(400).json(createExpressErrorResponse('blocked_countries must be an array', 400));
    }
    
    // Update blocked countries
    const blockedCountriesString = blocked_countries.join(',');
    await pool.query(
      'UPDATE users SET blocked_countries = ? WHERE id = ?',
      [blockedCountriesString, userId]
    );
    
    return res.json(createExpressSuccessResponse('Blocked countries updated successfully'));
  } catch (error) {
    logError('Error updating blocked countries:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Subscription Settings
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getSubscriptionSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const pool = getDB();
    
    // Get subscription plans for this user
    const [planRows] = await pool.query(
      'SELECT id, name, price, interval, status FROM plans WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    
    // Get free subscription status from subscriptions table (look for free subscription record)
    const [freeSubRows] = await pool.query(
      'SELECT free FROM subscriptions WHERE user_id = ? AND free = "yes" LIMIT 1',
      [userId]
    );
    
    // Check if user exists
    const [userRows] = await pool.query(
      'SELECT id FROM users WHERE id = ?',
      [userId]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }
    
    // Organize plans by interval
    const plansByInterval = {};
    planRows.forEach(plan => {
      plansByInterval[plan.interval] = {
        id: plan.id,
        name: plan.name,
        price: parseFloat(plan.price),
        interval: plan.interval,
        status: plan.status === '1' ? 'active' : 'inactive'
      };
    });
    
    return res.json(createExpressSuccessResponse('Subscription settings retrieved successfully', {
      subscription_price: plansByInterval.monthly?.price || 0,
      subscription_status: freeSubRows.length > 0 ? 'yes' : 'no',
      plans: plansByInterval
    }));
  } catch (error) {
    logError('Error fetching subscription settings:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * POST Update Subscription Settings
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const updateSubscriptionSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const { subscription_price, subscription_status } = req.body;
    const pool = getDB();
    
    // Validate subscription_price is a number
    if (subscription_price !== undefined && (isNaN(subscription_price) || subscription_price < 0)) {
      return res.status(400).json(createExpressErrorResponse('Invalid subscription price', 400));
    }
    
    // Validate subscription_status
    if (subscription_status && !['yes', 'no'].includes(subscription_status)) {
      return res.status(400).json(createExpressErrorResponse('Invalid subscription status', 400));
    }
    
    // Update free subscription status in subscriptions table
    if (subscription_status !== undefined) {
      if (subscription_status === 'yes') {
        // Create or update free subscription record
        await pool.query(
          `INSERT INTO subscriptions (user_id, name, stripe_id, stripe_status, free, subscription_id, created_at) 
           VALUES (?, ?, '', 'active', 'yes', 'free_sub', NOW()) 
           ON DUPLICATE KEY UPDATE free = 'yes', updated_at = NOW()`,
          [userId, 'free_subscription']
        );
      } else {
        // Remove free subscription record
        await pool.query(
          'UPDATE subscriptions SET free = "no", updated_at = NOW() WHERE user_id = ? AND free = "yes"',
          [userId]
        );
      }
    }
    
    // Update or create plan in plans table for monthly subscription
    if (subscription_price !== undefined) {
      // Check if plan exists for this user and monthly interval
      const [existingPlans] = await pool.query(
        'SELECT id FROM plans WHERE user_id = ? AND interval = ?',
        [userId, 'monthly']
      );
      
      if (existingPlans.length > 0) {
        // Update existing plan
        await pool.query(
          'UPDATE plans SET price = ?, updated_at = NOW() WHERE user_id = ? AND interval = ?',
          [subscription_price, userId, 'monthly']
        );
      } else {
        // Create new plan
        await pool.query(
          'INSERT INTO plans (user_id, name, price, interval, paystack, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
          [userId, 'monthly_plan', subscription_price, 'monthly', '', '1']
        );
      }
    }
    
    return res.json(createExpressSuccessResponse('Subscription settings updated successfully', { 
      updated: true,
      price: subscription_price,
      free_subscription: subscription_status
    }));
  } catch (error) {
    logError('Error updating subscription settings:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Creator Agreement
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getCreatorAgreement = async (req, res) => {
  try {
    const userId = req.userId;
    const pool = getDB();
    
    // Get user's creator agreement status
    const [rows] = await pool.query(
      'SELECT creator_agreement FROM users WHERE id = ?',
      [userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json(createExpressErrorResponse('User not found', 404));
    }
    
    const user = rows[0];
    
    return res.json(createExpressSuccessResponse('Creator agreement status retrieved successfully', {
      creator_agreement: user.creator_agreement || 'no'
    }));
  } catch (error) {
    logError('Error fetching creator agreement:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * POST Creator Agreement
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const postCreatorAgreement = async (req, res) => {
  try {
    const userId = req.userId;
    const { agreement_accepted } = req.body;
    const pool = getDB();
    
    if (agreement_accepted !== true) {
      return res.status(400).json(createExpressErrorResponse('Agreement must be accepted', 400));
    }
    
    // Update creator agreement status
    await pool.query(
      'UPDATE users SET creator_agreement = ? WHERE id = ?',
      ['yes', userId]
    );
    
    return res.json(createExpressSuccessResponse('Creator agreement accepted successfully'));
  } catch (error) {
    logError('Error updating creator agreement:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Upload URL
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getUploadUrl = async (req, res) => {
  try {
    const userId = req.userId;
    const { file_type } = req.query;
    
    // TODO: Implement S3 presigned URL generation
    // This is a placeholder implementation
    
    return res.json(createExpressSuccessResponse('Upload URL generated successfully', {
      upload_url: `https://example.com/upload/${userId}/${file_type}`,
      expires_in: 3600
    }));
  } catch (error) {
    logError('Error generating upload URL:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Download Creator Agreement PDF
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const downloadCreatorAgreementPdf = async (req, res) => {
  try {
    const userId = req.userId;
    
    // TODO: Implement PDF generation and download
    // This is a placeholder implementation
    
    return res.json(createExpressSuccessResponse('PDF download initiated', {
      download_url: `https://example.com/agreement-pdf/${userId}`
    }));
  } catch (error) {
    logError('Error downloading creator agreement PDF:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Creator Dashboard
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getDashboard = async (req, res) => {
  try {
    const userId = req.userId;
    const pool = getDB();
    
    // Get dashboard statistics
    const [stats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT followers.id) as total_followers,
        COUNT(DISTINCT posts.id) as total_posts,
        COALESCE(SUM(payments.amount), 0) as total_earnings
      FROM users 
      LEFT JOIN followers ON users.id = followers.creator_id
      LEFT JOIN posts ON users.id = posts.user_id
      LEFT JOIN payments ON users.id = payments.creator_id
      WHERE users.id = ?
    `, [userId]);
    
    return res.json(createExpressSuccessResponse('Dashboard data retrieved successfully', {
      stats: stats[0] || {
        total_followers: 0,
        total_posts: 0,
        total_earnings: 0
      }
    }));
  } catch (error) {
    logError('Error fetching dashboard data:', error);
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Payments Received
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getPaymentsReceived = async (req, res) => {
  try {
    const userId = req.userId;
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
    
    return res.json(createExpressSuccessResponse('Payments received retrieved successfully', {
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
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};

/**
 * GET Withdrawals
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getWithdrawals = async (req, res) => {
  try {
    const userId = req.userId;
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
    
    return res.json(createExpressSuccessResponse('Withdrawals retrieved successfully', {
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
    return res.status(500).json(createExpressErrorResponse('Internal server error', 500));
  }
};
