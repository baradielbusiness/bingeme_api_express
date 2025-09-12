import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Get payout conversations for user
 */
export const getPayoutConversations = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT 
        tc.id,
        tc.from_user_id,
        tc.to_user_id,
        tc.message,
        tc.image,
        tc.created_at,
        tc.type,
        u1.username as from_username,
        u1.name as from_name,
        u1.profile_pic as from_profile_pic,
        u2.username as to_username,
        u2.name as to_name,
        u2.profile_pic as to_profile_pic
      FROM ticket_conversations tc
      LEFT JOIN users u1 ON tc.from_user_id = u1.id
      LEFT JOIN users u2 ON tc.to_user_id = u2.id
      WHERE tc.type = '2' 
        AND (tc.from_user_id = ? OR tc.to_user_id = ?)
      ORDER BY tc.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [conversations] = await pool.query(query, [userId, userId, limitNum, skipNum]);
    return conversations;
  } catch (error) {
    logError('Error getting payout conversations:', error);
    throw error;
  }
};

/**
 * Store payout conversation
 */
export const storePayoutConversation = async (conversationData) => {
  try {
    const { 
      from_user_id, 
      to_user_id, 
      message, 
      image = null, 
      type = '2' 
    } = conversationData;
    
    const query = `
      INSERT INTO ticket_conversations (from_user_id, to_user_id, message, image, type, created_at) 
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [
      from_user_id, 
      to_user_id, 
      message, 
      image, 
      type
    ]);
    
    logInfo(`Stored payout conversation: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error storing payout conversation:', error);
    throw error;
  }
};

/**
 * Get payout history for user
 */
export const getPayoutHistory = async (userId, skip = 0, limit = 10) => {
  try {
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;

    const query = `
      SELECT 
        id,
        user_id,
        amount,
        status,
        payment_method,
        created_at,
        processed_at
      FROM payouts 
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const [payouts] = await pool.query(query, [userId, limitNum, skipNum]);
    return payouts;
  } catch (error) {
    logError('Error getting payout history:', error);
    throw error;
  }
};

/**
 * Create payout request
 */
export const createPayoutRequest = async (payoutData) => {
  try {
    const { 
      user_id, 
      amount, 
      payment_method, 
      status = 'pending' 
    } = payoutData;
    
    const query = `
      INSERT INTO payouts (user_id, amount, payment_method, status, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [
      user_id, 
      amount, 
      payment_method, 
      status
    ]);
    
    logInfo(`Created payout request: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error creating payout request:', error);
    throw error;
  }
};

/**
 * Update payout status
 */
export const updatePayoutStatus = async (payoutId, status, processedAt = null) => {
  try {
    const query = `
      UPDATE payouts 
      SET status = ?, processed_at = ? 
      WHERE id = ?
    `;
    
    await pool.query(query, [status, processedAt, payoutId]);
    logInfo(`Updated payout status: ${payoutId} -> ${status}`);
  } catch (error) {
    logError('Error updating payout status:', error);
    throw error;
  }
};
