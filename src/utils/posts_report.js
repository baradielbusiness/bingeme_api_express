/**
 * @file posts_report.js
 * @description Posts report utilities for dashboard
 * Provides functions for generating posts report data
 */

import { getDB } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Get posts report data for a user
 * @param {number} userId - User ID
 * @param {string} period - Time period (day, week, month, year)
 * @returns {Promise<object>} Posts report data
 */
const getPostsReportData = async (userId, period = 'month') => {
  try {
    logInfo('Getting posts report data for user:', { userId, period });
    
    const db = await getDB();
    
    // Calculate date range based on period
    let dateCondition = '';
    
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
    
    // Query posts data for the period
    const [postsRows] = await db.execute(`
      SELECT 
        COUNT(*) as total_posts,
        COALESCE(SUM(likes_count), 0) as total_likes,
        COALESCE(SUM(comments_count), 0) as total_comments,
        COALESCE(SUM(views_count), 0) as total_views
      FROM updates 
      WHERE user_id = ? AND ${dateCondition}
    `, [userId]);
    
    const postsData = postsRows[0] || { 
      total_posts: 0, 
      total_likes: 0, 
      total_comments: 0, 
      total_views: 0 
    };
    
    return {
      period: period,
      total_posts: parseInt(postsData.total_posts) || 0,
      total_likes: parseInt(postsData.total_likes) || 0,
      total_comments: parseInt(postsData.total_comments) || 0,
      total_views: parseInt(postsData.total_views) || 0
    };
  } catch (error) {
    logError('Error getting posts report data:', error);
    return {
      period: period,
      total_posts: 0,
      total_likes: 0,
      total_comments: 0,
      total_views: 0
    };
  }
};

// Export all functions at the end
export {
  getPostsReportData
};