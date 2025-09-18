/**
 * @file dashboard_overview.js
 * @description Dashboard overview utilities for Bingeme API Express.js
 * Provides functions for dashboard data including social URLs, earnings, and overview
 */

import { getDB } from '../../config/database.js';
import { logInfo, logError } from '../common.js';

/**
 * Get social URLs for a user
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @returns {Promise<object>} Social URLs object
 */
const getSocialUrls = async (userId, username) => {
  try {
    logInfo('Getting social URLs for user:', { userId, username });
    
    // For now, return empty social URLs object
    // This can be expanded to fetch actual social media links from database
    return {
      instagram: '',
      twitter: '',
      youtube: '',
      tiktok: '',
      onlyfans: ''
    };
  } catch (error) {
    logError('Error getting social URLs:', error);
    return {
      instagram: '',
      twitter: '',
      youtube: '',
      tiktok: '',
      onlyfans: ''
    };
  }
};

/**
 * Get creator earnings data
 * @param {number} userId - User ID
 * @param {string} role - User role
 * @returns {Promise<object>} Creator earnings data
 */
const getCreatorEarningsData = async (userId, role) => {
  try {
    logInfo('Getting creator earnings data for user:', { userId, role });
    
    const db = await getDB();
    
    // Query creator earnings
    const [earningsRows] = await db.execute(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_earnings,
        COUNT(*) as transaction_count
      FROM creator_earnings 
      WHERE user_id = ?
    `, [userId]);
    
    const earnings = earningsRows[0] || { total_earnings: 0, transaction_count: 0 };
    
    return {
      total_earnings: parseFloat(earnings.total_earnings) || 0,
      transaction_count: parseInt(earnings.transaction_count) || 0,
      currency: 'USD' // Default currency
    };
  } catch (error) {
    logError('Error getting creator earnings data:', error);
    return {
      total_earnings: 0,
      transaction_count: 0,
      currency: 'USD'
    };
  }
};

/**
 * Get earnings overview for a specific period
 * @param {number} userId - User ID
 * @param {string} role - User role
 * @param {string} period - Time period (day, week, month, year)
 * @returns {Promise<object>} Earnings overview data
 */
const getEarningsOverview = async (userId, role, period = 'month') => {
  try {
    logInfo('Getting earnings overview for user:', { userId, role, period });
    
    const db = await getDB();
    
    // Calculate date range based on period
    let dateCondition = '';
    const now = new Date();
    
    switch (period) {
      case 'day':
        dateCondition = 'DATE(created_at) = CURDATE()';
        break;
      case 'week':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)';
        break;
      case 'month':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        break;
      case 'year':
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
        break;
      default:
        dateCondition = 'created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
    }
    
    // Query earnings for the period
    const [earningsRows] = await db.execute(`
      SELECT 
        COALESCE(SUM(amount), 0) as period_earnings,
        COUNT(*) as period_transactions
      FROM creator_earnings 
      WHERE user_id = ? AND ${dateCondition}
    `, [userId]);
    
    const earnings = earningsRows[0] || { period_earnings: 0, period_transactions: 0 };
    
    return {
      period: period,
      earnings: parseFloat(earnings.period_earnings) || 0,
      transactions: parseInt(earnings.period_transactions) || 0,
      currency: 'USD'
    };
  } catch (error) {
    logError('Error getting earnings overview:', error);
    return {
      period: period,
      earnings: 0,
      transactions: 0,
      currency: 'USD'
    };
  }
};

// Export all functions at the end
export {
  getSocialUrls,
  getCreatorEarningsData,
  getEarningsOverview
};