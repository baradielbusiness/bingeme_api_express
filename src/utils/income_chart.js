/**
 * @file income_chart.js
 * @description Income chart utilities for dashboard
 * Provides functions for generating income chart data
 */

import { getDB } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Get income chart data for a user
 * @param {number} userId - User ID
 * @param {string} period - Time period (day, week, month, year)
 * @param {number|null} targetYear - Target year for data (null for current year)
 * @returns {Promise<object>} Income chart data
 */
const getIncomeChartData = async (userId, period = 'month', targetYear = null) => {
  try {
    logInfo('Getting income chart data for user:', { userId, period, targetYear });
    
    const db = await getDB();
    
    // Use current year if targetYear is null
    const year = targetYear || new Date().getFullYear();
    
    // Calculate date range based on period
    let dateCondition = '';
    let groupBy = '';
    
    switch (period) {
      case 'day':
        dateCondition = `DATE(created_at) = CURDATE()`;
        groupBy = 'HOUR(created_at)';
        break;
      case 'week':
        dateCondition = `created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)`;
        groupBy = 'DATE(created_at)';
        break;
      case 'month':
        dateCondition = `created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
        groupBy = 'DATE(created_at)';
        break;
      case 'year':
        dateCondition = `YEAR(created_at) = ?`;
        groupBy = 'MONTH(created_at)';
        break;
      default:
        dateCondition = `created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
        groupBy = 'DATE(created_at)';
    }
    
    // Query income data for the period
    const queryParams = period === 'year' ? [userId, year] : [userId];
    const [incomeRows] = await db.execute(`
      SELECT 
        ${groupBy} as period_key,
        COALESCE(SUM(amount), 0) as total_amount,
        COUNT(*) as transaction_count
      FROM creator_earnings 
      WHERE user_id = ? AND ${dateCondition}
      GROUP BY ${groupBy}
      ORDER BY period_key ASC
    `, queryParams);
    
    // Format the data for chart display
    const chartData = incomeRows.map(row => ({
      period: row.period_key,
      amount: parseFloat(row.total_amount) || 0,
      transactions: parseInt(row.transaction_count) || 0
    }));
    
    return {
      period: period,
      year: year,
      data: chartData,
      total_earnings: chartData.reduce((sum, item) => sum + item.amount, 0),
      total_transactions: chartData.reduce((sum, item) => sum + item.transactions, 0)
    };
  } catch (error) {
    logError('Error getting income chart data:', error);
    return {
      period: period,
      year: targetYear || new Date().getFullYear(),
      data: [],
      total_earnings: 0,
      total_transactions: 0
    };
  }
};

// Export all functions at the end
export {
  getIncomeChartData
};