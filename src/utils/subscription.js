/**
 * @file subscription.js
 * @description Database utility functions for subscription operations
 * 
 * This module provides database operations for subscription plans, messages, and user settings.
 * It handles all database interactions related to subscription functionality.
 * 
 * FUNCTIONS:
 * - getAdminSettings: Fetch admin settings for validation
 * - getUserSubscriptionPlans: Fetch user's subscription plans and data
 * - updateSubscriptionPlan: Update or create subscription plan
 * - updateSubscriptionMessage: Update subscription welcome message
 * - updateUserFreeSubscription: Update user's free subscription status
 * 
 * Database Tables: plans, subscription_messages, users, admin_settings
 * 
 */

import { pool, getDB } from '../config/database.js';
import { logError, logInfo } from './common.js';

const getAdminSettings = async () => {
  try {
    const [rows] = await pool.query('SELECT min_subscription_amount, max_subscription_amount, fee_commission FROM admin_settings LIMIT 1');
    return rows[0] || null;
  } catch (error) {
    logError('Error fetching admin settings:', { error: error.message });
    return null;
  }
};

/**
 * Fetch user's subscription plans and pricing information from the database
 * @param {number} userId - The authenticated user's ID
 * @param {Array<string>} intervals - Array of subscription intervals to fetch
 * @returns {Promise<object|null>} User subscription plans and pricing data or null on error
 */
const getUserSubscriptionPlans = async (userId, intervals) => {
  try {
    const [plansRows] = await pool.query(`SELECT name, price, \`interval\`, status FROM plans WHERE user_id = ? AND \`interval\` IN (${intervals.map(() => '?').join(', ')}) ORDER BY FIELD(\`interval\`, ${intervals.map(() => '?').join(', ')})`, [userId, ...intervals, ...intervals]);
    const [messageRows] = await pool.query('SELECT message FROM subscription_messages WHERE user_id = ?', [userId]);
    const [userRows] = await pool.query('SELECT free_subscription FROM users WHERE id = ?', [userId]);

    const plansByInterval = {};
    plansRows.forEach(({ interval, price, status }) => {
      plansByInterval[interval] = { price, status };
    });

    return { plans: plansRows, plansByInterval, welcomeMessage: messageRows[0]?.message || '', freeSubscription: userRows[0]?.free_subscription || 'no' };
  } catch (error) {
    logError('Error fetching user subscription plans:', { error: error.message, userId, intervals });
    return null;
  }
};

/**
 * Update or create a subscription plan for a user
 * @param {number} userId - The authenticated user's ID
 * @param {string} interval - The subscription interval (monthly, yearly, etc.)
 * @param {number} price - The subscription price
 * @param {string} name - The plan name
 * @param {string} status - The plan status (active, inactive)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const updateSubscriptionPlan = async (userId, interval, price, name, status = 'active') => {
  try {
    const query = `
      INSERT INTO plans (user_id, \`interval\`, price, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
      price = VALUES(price),
      name = VALUES(name),
      status = VALUES(status),
      updated_at = NOW()
    `;
    
    await pool.query(query, [userId, interval, price, name, status]);
    
    logInfo('Subscription plan updated successfully', { userId, interval, price, name, status });
    return true;
  } catch (error) {
    logError('Error updating subscription plan:', { error: error.message, userId, interval, price, name, status });
    return false;
  }
};

/**
 * Update subscription welcome message for a user
 * @param {number} userId - The authenticated user's ID
 * @param {string} message - The welcome message
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const updateSubscriptionMessage = async (userId, message) => {
  try {
    const query = `
      INSERT INTO subscription_messages (user_id, message, created_at, updated_at)
      VALUES (?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
      message = VALUES(message),
      updated_at = NOW()
    `;
    
    await pool.query(query, [userId, message]);
    
    logInfo('Subscription message updated successfully', { userId, messageLength: message.length });
    return true;
  } catch (error) {
    logError('Error updating subscription message:', { error: error.message, userId });
    return false;
  }
};

/**
 * Update user's free subscription status
 * @param {number} userId - The authenticated user's ID
 * @param {string} freeSubscription - The free subscription status (yes, no)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const updateUserFreeSubscription = async (userId, freeSubscription) => {
  try {
    const query = 'UPDATE users SET free_subscription = ?, updated_at = NOW() WHERE id = ?';
    await pool.query(query, [freeSubscription, userId]);
    
    logInfo('User free subscription updated successfully', { userId, freeSubscription });
    return true;
  } catch (error) {
    logError('Error updating user free subscription:', { error: error.message, userId, freeSubscription });
    return false;
  }
};

/**
 * Get subscription plan by ID
 * @param {number} planId - The plan ID
 * @returns {Promise<object|null>} Plan object or null if not found
 */
const getSubscriptionPlanById = async (planId) => {
  try {
    const [rows] = await pool.query('SELECT * FROM plans WHERE id = ?', [planId]);
    return rows[0] || null;
  } catch (error) {
    logError('Error getting subscription plan by ID:', { error: error.message, planId });
    return null;
  }
};

/**
 * Get all subscription plans for a user
 * @param {number} userId - The user ID
 * @returns {Promise<Array>} Array of subscription plans
 */
const getAllUserSubscriptionPlans = async (userId) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM plans WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows;
  } catch (error) {
    logError('Error getting all user subscription plans:', { error: error.message, userId });
    return [];
  }
};

/**
 * Delete a subscription plan
 * @param {number} planId - The plan ID
 * @param {number} userId - The user ID (for security)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const deleteSubscriptionPlan = async (planId, userId) => {
  try {
    const query = 'DELETE FROM plans WHERE id = ? AND user_id = ?';
    const [result] = await pool.query(query, [planId, userId]);
    
    if (result.affectedRows > 0) {
      logInfo('Subscription plan deleted successfully', { planId, userId });
      return true;
    } else {
      logInfo('No subscription plan found to delete', { planId, userId });
      return false;
    }
  } catch (error) {
    logError('Error deleting subscription plan:', { error: error.message, planId, userId });
    return false;
  }
};

/**
 * Get subscription statistics for a user
 * @param {number} userId - The user ID
 * @returns {Promise<object>} Subscription statistics
 */
const getSubscriptionStats = async (userId) => {
  try {
    const [totalSubscribers] = await pool.query(
      'SELECT COUNT(*) as count FROM subscriptions WHERE creator_id = ? AND status = "active"',
      [userId]
    );
    
    const [monthlyRevenue] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM subscription_payments WHERE creator_id = ? AND status = "completed" AND MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())',
      [userId]
    );
    
    const [totalRevenue] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM subscription_payments WHERE creator_id = ? AND status = "completed"',
      [userId]
    );
    
    return {
      total_subscribers: totalSubscribers[0].count,
      monthly_revenue: monthlyRevenue[0].total,
      total_revenue: totalRevenue[0].total
    };
  } catch (error) {
    logError('Error getting subscription stats:', { error: error.message, userId });
    return {
      total_subscribers: 0,
      monthly_revenue: 0,
      total_revenue: 0
    };
  }
};

/**
 * Check if user is subscribed to a creator
 * @param {number} subscriberId - The subscriber user ID
 * @param {number} creatorId - The creator user ID
 * @returns {Promise<boolean>} True if subscribed, false otherwise
 */
const isUserSubscribed = async (subscriberId, creatorId) => {
  try {
    const [rows] = await pool.query(
      'SELECT id FROM subscriptions WHERE subscriber_id = ? AND creator_id = ? AND status = "active"',
      [subscriberId, creatorId]
    );
    
    return rows.length > 0;
  } catch (error) {
    logError('Error checking subscription status:', { error: error.message, subscriberId, creatorId });
    return false;
  }
};

/**
 * Create a new subscription
 * @param {number} subscriberId - The subscriber user ID
 * @param {number} creatorId - The creator user ID
 * @param {number} planId - The plan ID
 * @param {string} status - The subscription status
 * @returns {Promise<number|null>} Subscription ID or null if failed
 */
const createSubscription = async (subscriberId, creatorId, planId, status = 'active') => {
  try {
    const query = `
      INSERT INTO subscriptions (subscriber_id, creator_id, plan_id, status, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [subscriberId, creatorId, planId, status]);
    
    logInfo('Subscription created successfully', { 
      subscriptionId: result.insertId, 
      subscriberId, 
      creatorId, 
      planId, 
      status 
    });
    
    return result.insertId;
  } catch (error) {
    logError('Error creating subscription:', { error: error.message, subscriberId, creatorId, planId, status });
    return null;
  }
};

/**
 * Cancel a subscription
 * @param {number} subscriptionId - The subscription ID
 * @param {number} subscriberId - The subscriber user ID (for security)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
const cancelSubscription = async (subscriptionId, subscriberId) => {
  try {
    const query = 'UPDATE subscriptions SET status = "cancelled", updated_at = NOW() WHERE id = ? AND subscriber_id = ?';
    const [result] = await pool.query(query, [subscriptionId, subscriberId]);
    
    if (result.affectedRows > 0) {
      logInfo('Subscription cancelled successfully', { subscriptionId, subscriberId });
      return true;
    } else {
      logInfo('No subscription found to cancel', { subscriptionId, subscriberId });
      return false;
    }
  } catch (error) {
    logError('Error cancelling subscription:', { error: error.message, subscriptionId, subscriberId });
    return false;
  }
};

/**
 * Cancel multiple subscriptions for a user
 * @param {number} userId - User ID (subscriber)
 * @param {number} creatorId - Creator ID
 * @param {Array<string>} planNames - Array of plan names to cancel
 * @returns {Promise<boolean>} Success status
 */
const cancelSubscriptions = async (userId, creatorId, planNames) => {
  try {
    const db = await getDB();
    
    if (!planNames || planNames.length === 0) {
      return true;
    }
    
    const placeholders = planNames.map(() => '?').join(',');
    const [result] = await db.execute(`
      UPDATE subscriptions 
      SET status = 'cancelled', updated_at = NOW()
      WHERE user_id = ? AND creator_id = ? AND plan_name IN (${placeholders}) AND status = 'active'
    `, [userId, creatorId, ...planNames]);
    
    logInfo('Subscriptions cancelled', { userId, creatorId, planNames, affectedRows: result.affectedRows });
    return true;
  } catch (error) {
    logError('Error cancelling subscriptions:', error);
    throw error;
  }
};

// Export all functions at the end
export {
  getAdminSettings,
  getUserSubscriptionPlans,
  updateSubscriptionPlan,
  updateSubscriptionMessage,
  updateUserFreeSubscription,
  getSubscriptionPlanById,
  getAllUserSubscriptionPlans,
  deleteSubscriptionPlan,
  getSubscriptionStats,
  isUserSubscribed,
  createSubscription,
  cancelSubscription,
  cancelSubscriptions
};