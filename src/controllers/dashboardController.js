/**
 * @file dashboardController.js
 * @description Dashboard controller for Bingeme API Express.js
 * Handles dashboard data, reports, and analytics
 */

import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  getAuthenticatedUserId, 
  getUserById 
} from '../utils/common.js';

/**
 * GET Dashboard Data
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getDashboard = async (req, res) => {
  try {
    const userId = req.userId;
    const { period = 'month' } = req.query;
    
    logInfo('Dashboard request received', { userId, period });
    
    // Get user info
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const pool = getDB();
    
    // Get basic dashboard statistics
    const [stats] = await pool.query(`
      SELECT 
        COUNT(DISTINCT f.id) as total_followers,
        COUNT(DISTINCT p.id) as total_posts,
        COALESCE(SUM(pay.amount), 0) as total_earnings,
        COUNT(DISTINCT w.id) as pending_withdrawals
      FROM users u
      LEFT JOIN followers f ON u.id = f.creator_id
      LEFT JOIN posts p ON u.id = p.user_id
      LEFT JOIN payments pay ON u.id = pay.creator_id
      LEFT JOIN withdrawals w ON u.id = w.user_id AND w.status = 'pending'
      WHERE u.id = ?
    `, [userId]);
    
    // Get earnings data for different periods
    const [earningsData] = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        SUM(amount) as daily_earnings
      FROM payments 
      WHERE creator_id = ? 
        AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `, [userId]);
    
    // Get recent posts
    const [recentPosts] = await pool.query(`
      SELECT id, title, created_at, status
      FROM posts 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT 5
    `, [userId]);
    
    // Get recent payments
    const [recentPayments] = await pool.query(`
      SELECT p.*, u.name as payer_name
      FROM payments p
      LEFT JOIN users u ON p.user_id = u.id
      WHERE p.creator_id = ?
      ORDER BY p.created_at DESC
      LIMIT 10
    `, [userId]);
    
    const dashboardData = {
      stats: stats[0] || {
        total_followers: 0,
        total_posts: 0,
        total_earnings: 0,
        pending_withdrawals: 0
      },
      earnings_data: earningsData,
      recent_posts: recentPosts,
      recent_payments: recentPayments,
      period: period
    };
    
    return res.json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: dashboardData
    });
  } catch (error) {
    logError('Error fetching dashboard data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET Posts Report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getPostsReport = async (req, res) => {
  try {
    const userId = req.userId;
    const { start_date, end_date } = req.query;
    const pool = getDB();
    
    // Build date filter
    let dateFilter = '';
    let params = [userId];
    
    if (start_date && end_date) {
      dateFilter = 'AND p.created_at BETWEEN ? AND ?';
      params.push(start_date, end_date);
    } else {
      // Default to last 30 days
      dateFilter = 'AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)';
    }
    
    // Get posts report data
    const [postsData] = await pool.query(`
      SELECT 
        p.id,
        p.title,
        p.status,
        p.created_at,
        COUNT(DISTINCT l.id) as likes_count,
        COUNT(DISTINCT c.id) as comments_count,
        COUNT(DISTINCT v.id) as views_count
      FROM posts p
      LEFT JOIN likes l ON p.id = l.post_id
      LEFT JOIN comments c ON p.id = c.post_id
      LEFT JOIN views v ON p.id = v.post_id
      WHERE p.user_id = ? ${dateFilter}
      GROUP BY p.id, p.title, p.status, p.created_at
      ORDER BY p.created_at DESC
    `, params);
    
    // Get summary statistics
    const [summary] = await pool.query(`
      SELECT 
        COUNT(*) as total_posts,
        SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published_posts,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_posts,
        AVG(likes_count) as avg_likes,
        AVG(comments_count) as avg_comments,
        AVG(views_count) as avg_views
      FROM (
        SELECT 
          p.id,
          p.status,
          COUNT(DISTINCT l.id) as likes_count,
          COUNT(DISTINCT c.id) as comments_count,
          COUNT(DISTINCT v.id) as views_count
        FROM posts p
        LEFT JOIN likes l ON p.id = l.post_id
        LEFT JOIN comments c ON p.id = c.post_id
        LEFT JOIN views v ON p.id = v.post_id
        WHERE p.user_id = ? ${dateFilter}
        GROUP BY p.id, p.status
      ) as post_stats
    `, params);
    
    return res.json({
      success: true,
      message: 'Posts report retrieved successfully',
      data: {
        posts: postsData,
        summary: summary[0] || {
          total_posts: 0,
          published_posts: 0,
          draft_posts: 0,
          avg_likes: 0,
          avg_comments: 0,
          avg_views: 0
        }
      }
    });
  } catch (error) {
    logError('Error fetching posts report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET Income Chart Data
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getIncomeChart = async (req, res) => {
  try {
    const userId = req.userId;
    const { period = 'month' } = req.query;
    const pool = getDB();
    
    let dateInterval = '';
    let groupBy = '';
    
    switch (period) {
      case 'week':
        dateInterval = 'INTERVAL 7 DAY';
        groupBy = 'DATE(created_at)';
        break;
      case 'month':
        dateInterval = 'INTERVAL 30 DAY';
        groupBy = 'DATE(created_at)';
        break;
      case 'year':
        dateInterval = 'INTERVAL 365 DAY';
        groupBy = 'YEAR(created_at), MONTH(created_at)';
        break;
      default:
        dateInterval = 'INTERVAL 30 DAY';
        groupBy = 'DATE(created_at)';
    }
    
    // Get income chart data
    const [incomeData] = await pool.query(`
      SELECT 
        ${groupBy} as period,
        SUM(amount) as total_earnings,
        COUNT(*) as transaction_count
      FROM payments 
      WHERE creator_id = ? 
        AND created_at >= DATE_SUB(NOW(), ${dateInterval})
      GROUP BY ${groupBy}
      ORDER BY period DESC
    `, [userId]);
    
    // Get income by source
    const [incomeBySource] = await pool.query(`
      SELECT 
        payment_type,
        SUM(amount) as total_amount,
        COUNT(*) as transaction_count
      FROM payments 
      WHERE creator_id = ? 
        AND created_at >= DATE_SUB(NOW(), ${dateInterval})
      GROUP BY payment_type
    `, [userId]);
    
    return res.json({
      success: true,
      message: 'Income chart data retrieved successfully',
      data: {
        income_data: incomeData,
        income_by_source: incomeBySource,
        period: period
      }
    });
  } catch (error) {
    logError('Error fetching income chart data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
