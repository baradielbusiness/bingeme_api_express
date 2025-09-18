/**
 * @file referralsController.js
 * @description Lambda API controller for retrieving user referrals in the Bingeme platform.
 * 
 * This file handles the complete referral system functionality including:
 * - User authentication and validation
 * - Referral statistics calculation with percentage logic
 * - Referral data retrieval with user grouping and amount aggregation
 * - Pagination support for large referral lists
 * - Response formatting according to API specifications
 * 
 * Flow: Auth → Stats Calculation → Data Retrieval → Response Formatting
 */

import { createSuccessResponse, createErrorResponse, getAuthenticatedUserId, logInfo, logError } from '../utils/common.js';
import { getDB } from '../config/database.js';

// Constants for better maintainability
const DEFAULT_REFERRAL_PERCENTAGE = 0;
const DEFAULT_TRANSACTION_LIMIT = '1';
const DEFAULT_LIMIT = 20;
const DEFAULT_SKIP = 0;
const DEFAULT_BASE_URL = 'https://bingeme.com';
const REFERRAL_SYSTEM_DISABLED_MESSAGE = 'Referral system is currently disabled';

/**
 * Main Express handler for GET /referrals endpoint.
 * Handles authentication, parameter parsing, and response formatting.
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getReferrals = async (req, res) => {
  // Authenticate and validate user
  // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'my_referrals getHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'my_referrals getHandler' })
  const { userId, errorResponse } = getAuthenticatedUserId(req, { 
    allowAnonymous: false, 
    action: 'my_referrals getHandler' 
  });
  
  if (errorResponse) {
    // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
    return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
  }

  // Parse pagination parameters with defaults
  // TODO: Convert event.queryStringParameters = {} to req.query = {}
  const { query: queryStringParameters = {} } = req;
  const skip = parseInt(queryStringParameters.skip) || DEFAULT_SKIP;
  const limit = parseInt(queryStringParameters.limit) || DEFAULT_LIMIT;

  try {
    const data = await getUserReferralsList(userId, skip, limit);
    
    logInfo('Referrals API request completed successfully:', { 
      userId, 
      userCount: data.user?.length || 0,
      pagination: data.pagination
    });
    
    // TODO: Convert createSuccessResponse('Referrals retrieved successfully', [data]) to res.json({ success: true, message: 'Referrals retrieved successfully', data: [data] })
    return res.json({
      success: true,
      message: 'Referrals retrieved successfully',
      data: [data]
    });
  } catch (error) {
    logError('Failed to fetch referrals:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to fetch referrals') to res.status(500).json({ error: 'Failed to fetch referrals' })
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch referrals'));
  }
};

/**
 * Calculates the effective referral percentage for a user.
 * Priority: User earnings percentage > User percentage > Admin default
 * 
 * @param {number} userEarningsPercentage - User's referral earnings percentage (int)
 * @param {number|string} userPercentage - User's referral percentage (decimal)
 * @param {number} adminPercentage - Admin's default percentage
 * @returns {number} The effective referral percentage to use
 */
const calculateReferralPercentage = (userEarningsPercentage, userPercentage, adminPercentage) => {
  if (userEarningsPercentage !== 0) return userEarningsPercentage;
  
  if (userPercentage !== 0 && userPercentage !== "0.00") return userPercentage;
  
  return adminPercentage || DEFAULT_REFERRAL_PERCENTAGE;
};

/**
 * Retrieves referral statistics for a user including earnings and percentage logic.
 * Handles both database schema variations for referral percentages.
 * 
 * @param {string|number} userId - The user ID to fetch stats for
 * @returns {Promise<object>} Referral statistics object
 */
const getReferralStats = async (userId) => {
  try {
    const pool = getDB();
    
    // Fetch user referral percentage settings
    const [userRows] = await pool.query(
      'SELECT referral_earnings_percentage, referral_percentage FROM users WHERE id = ?',
      [userId]
    );
    
    if (!userRows?.length) {
      logError('User not found for referral stats:', { userId });
      return {
        referral_percentage: DEFAULT_REFERRAL_PERCENTAGE,
        total_earnings: 0,
        referral_system: 'off',
        percentage_earnings_referred: DEFAULT_REFERRAL_PERCENTAGE,
        referral_transaction_limit: DEFAULT_TRANSACTION_LIMIT
      };
    }
    
    // Fetch admin settings for fallback values
    const [adminRows] = await pool.query(
      'SELECT percentage_earnings_referred, referral_system, referral_transaction_limit FROM admin_settings LIMIT 1'
    );
    const adminSettings = adminRows[0] || {};
    
    // Extract user percentage values
    const { referral_earnings_percentage: userEarningsPercentage = 0, referral_percentage: userPercentage = 0 } = userRows[0];
    
    // Calculate effective referral percentage
    const referral_percentage = calculateReferralPercentage(
      userEarningsPercentage, 
      userPercentage, 
      adminSettings.percentage_earnings_referred
    );
    
    // Fetch total earnings from referral transactions
    const [earningsRows] = await pool.query(
      'SELECT SUM(earnings) as total_earnings FROM referral_transactions WHERE referred_by = ? AND status = "1"',
      [userId]
    );
    
    const total_earnings = parseFloat(earningsRows[0]?.total_earnings || 0);
    
    logInfo('Referral stats calculated successfully:', { 
      userId, 
      referral_percentage, 
      total_earnings,
      referral_system: adminSettings.referral_system 
    });
    
    return {
      referral_percentage,
      total_earnings,
      referral_system: adminSettings.referral_system || 'off',
      percentage_earnings_referred: adminSettings.percentage_earnings_referred || DEFAULT_REFERRAL_PERCENTAGE,
      referral_transaction_limit: adminSettings.referral_transaction_limit || DEFAULT_TRANSACTION_LIMIT
    };
  } catch (error) {
    logError('Error getting referral stats:', error);
    return {
      referral_percentage: DEFAULT_REFERRAL_PERCENTAGE,
      total_earnings: 0,
      referral_system: 'off',
      percentage_earnings_referred: DEFAULT_REFERRAL_PERCENTAGE,
      referral_transaction_limit: DEFAULT_TRANSACTION_LIMIT
    };
  }
};

/**
 * Generates a referral link for a user.
 * 
 * @param {string|number} userId - The user ID to generate link for
 * @returns {string} Complete referral link
 */
const getReferralLink = (userId) => {
  const baseUrl = process.env.BASE_URL || DEFAULT_BASE_URL;
  return `${baseUrl}?ref=${userId}`;
};

/**
 * Creates referral description messages based on percentage and transaction limits.
 * 
 * @param {number} percentage - The referral percentage to use
 * @param {string} transactionLimit - Transaction limit setting
 * @returns {object} Object containing formatted description messages
 */
const createReferralDescriptions = (percentage, transactionLimit) => {
  const isUnlimited = transactionLimit === 'unlimited';
  
  return {
    referrals_welcome_desc: `Share your link and earn ${percentage}% of your referrals, be it a Subscription, Tip or a PPV!`,
    total_transactions_per_referral: isUnlimited 
      ? `You will earn ${percentage}% for the first transaction of your referral`
      : `You will earn ${percentage}% for the first ${transactionLimit} transactions of your referral`,
    total_transactions_referral_unlimited: `You will earn ${percentage}% for each transaction of your referral`
  };
};

/**
 * Generates pagination information including next page URL.
 * 
 * @param {number} totalReferrals - Total number of referrals
 * @param {number} skip - Current skip value
 * @param {number} limit - Current limit value
 * @returns {object} Pagination information object
 */
const generatePaginationInfo = (totalReferrals, skip, limit) => {
  const hasMore = (skip + limit) < totalReferrals;
  const next = hasMore ? `/referrals?skip=${skip + limit}&limit=${limit}` : "";
  
  return {
    total: totalReferrals,
    skip,
    limit,
    hasMore,
    next
  };
};

/**
 * Gets the total count of referrals for a user.
 * 
 * @param {string|number} userId - The user ID to count referrals for
 * @returns {Promise<number>} Total count of referrals
 */
const getTotalReferralsCount = async (userId) => {
  try {
    const pool = getDB();
    const [countRows] = await pool.query(
      'SELECT COUNT(DISTINCT u.name) as total FROM referral_transactions rt INNER JOIN users u ON u.id = rt.user_id INNER JOIN referrals r ON r.id = rt.referrals_id WHERE rt.referred_by = ? AND rt.status = "1"',
      [userId]
    );
    
    return parseInt(countRows[0]?.total || 0);
  } catch (error) {
    logError('Error getting total referrals count:', error);
    return 0;
  }
};

/**
 * Fetches and formats a user's referral list with grouping and pagination.
 * Groups referrals by user name and aggregates amounts to avoid duplicates.
 * 
 * @param {string|number} userId - The user ID to fetch referrals for
 * @param {number} skip - Number of records to skip for pagination
 * @param {number} limit - Maximum number of records to return
 * @returns {Promise<object>} Formatted referral data object
 */
const getUserReferralsList = async (userId, skip = DEFAULT_SKIP, limit = DEFAULT_LIMIT) => {
  try {
    // Get referral statistics and settings
    const stats = await getReferralStats(userId);
    
    // Handle disabled referral system
    if (stats.referral_system !== 'on') {
      logInfo('Referral system disabled for user:', { userId });
      return {
        referrals_welcome_desc: REFERRAL_SYSTEM_DISABLED_MESSAGE,
        total_transactions_per_referral: "",
        total_transactions_referral_unlimited: "",
        referral_link: getReferralLink(userId),
        total_earnings: 0,
        user: [],
        pagination: {
          total: 0,
          skip: 0,
          limit: 0,
          hasMore: false,
          next: ""
        }
      };
    }
    
    // Get total count for pagination
    const totalReferrals = await getTotalReferralsCount(userId);
    
    // Fetch grouped referral data
    const pool = getDB();
    const query = `
      SELECT
        u.name,
        SUM(rt.earnings) as total_earnings
      FROM referral_transactions rt
      INNER JOIN users u ON u.id = rt.user_id
      INNER JOIN referrals r ON r.id = rt.referrals_id
      WHERE rt.referred_by = ? AND rt.status = "1"
      GROUP BY u.name
      ORDER BY total_earnings DESC
      LIMIT ? OFFSET ?
    `;
    
    const [rows] = await pool.query(query, [userId, limit, skip]);
    
    // Transform data to required format
    const userData = rows.map(({ name, total_earnings }) => ({
      name,
      amount: parseFloat(total_earnings)
    }));
    
    // Create referral descriptions
    const descriptions = createReferralDescriptions(stats.referral_percentage, stats.referral_transaction_limit);
    
    // Generate pagination info
    const pagination = generatePaginationInfo(totalReferrals, skip, limit);
    
    // Build complete response object
    const data = {
      ...descriptions,
      referral_link: getReferralLink(userId),
      total_earnings: stats.total_earnings,
      user: userData,
      pagination
    };
    
    logInfo('Referral list retrieved successfully:', { 
      userId, 
      userCount: userData.length, 
      referral_percentage: stats.referral_percentage,
      pagination
    });
    
    return data;
  } catch (error) {
    logError('Database error while fetching user referrals:', error);
    throw error;
  }
};