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
        dateCondition = 'DATE(date) = CURDATE()';
        break;
      case 'week':
        dateCondition = 'date >= DATE_SUB(NOW(), INTERVAL 1 WEEK)';
        break;
      case 'month':
        dateCondition = 'date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
        break;
      case 'year':
        dateCondition = 'date >= DATE_SUB(NOW(), INTERVAL 1 YEAR)';
        break;
      default:
        dateCondition = 'date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
    }
    
    // Query posts data for the period with proper joins to get counts
    const [postsRows] = await db.execute(`
      SELECT 
        COUNT(DISTINCT u.id) as total_posts,
        COALESCE(SUM(likes.likes_count), 0) as total_likes,
        COALESCE(SUM(comments.comments_count), 0) as total_comments,
        0 as total_views
      FROM updates u
      LEFT JOIN (
        SELECT updates_id, COUNT(*) as likes_count 
        FROM likes 
        WHERE status = '1' 
        GROUP BY updates_id
      ) likes ON u.id = likes.updates_id
      LEFT JOIN (
        SELECT updates_id, COUNT(*) as comments_count 
        FROM comments 
        WHERE status = '1' 
        GROUP BY updates_id
      ) comments ON u.id = comments.updates_id
      WHERE u.user_id = ? AND ${dateCondition}
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