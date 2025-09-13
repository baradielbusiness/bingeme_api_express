import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Fetch payout method details for a user from the database
 */
export const fetchUserPayoutDetails = async (userId) => {
  try {
    logInfo('[fetchUserPayoutDetails] Fetching payout details for user:', { userId });
    const query = `
      SELECT id, username, payment_gateway, bank, paypal_account, countries_id
      FROM users
      WHERE id = ?
    `;
    const [rows] = await pool.query(query, [userId]);
    const user = rows.length ? rows[0] : null;
    logInfo('[fetchUserPayoutDetails] User found:', { userId, hasData: !!user });
    return user;
  } catch (error) {
    logError('[fetchUserPayoutDetails] Database error:', { userId, error: error.message });
    throw error;
  }
};

/**
 * Update user payout method in users table (gateway/bank/paypal)
 * Mirrors Lambda behavior
 */
export const updateUserPayoutMethod = async (userId, paymentGateway, bankData = '', paypalAccount = '') => {
  try {
    logInfo('[updateUserPayoutMethod] Updating payout method:', {
      userId,
      paymentGateway,
      hasBankData: !!bankData,
      hasPayPal: !!paypalAccount
    });

    const query = `
      UPDATE users 
      SET payment_gateway = ?, 
          bank = ?, 
          paypal_account = ?
      WHERE id = ?
    `;

    const [result] = await pool.query(query, [paymentGateway, bankData, paypalAccount, userId]);
    logInfo('[updateUserPayoutMethod] Update result:', { userId, affectedRows: result.affectedRows });
    return result;
  } catch (error) {
    logError('[updateUserPayoutMethod] Database error:', { userId, error: error.message });
    throw error;
  }
};

/**
 * Parse serialized PHP-like array data (e.g., a:4:{s:...}) into a JS object
 */
const parseSerializedData = (serialized) => {
  try {
    const arrayMatch = serialized.match(/a:\d+:\{([\s\S]*)\}/);
    if (!arrayMatch) return null;
    const content = arrayMatch[1];
    const pairs = content.match(/s:\d+:"([^"]+)";s:\d+:"([^"]+)"/g) || [];
    const obj = {};
    for (const pair of pairs) {
      const m = pair.match(/s:\d+:"([^"]+)";s:\d+:"([^"]+)"/);
      if (m) obj[m[1]] = m[2];
    }
    return obj;
  } catch (error) {
    logError('[parseSerializedData] failed:', { error: error.message });
    return null;
  }
};

/**
 * Parse bank data from JSON, serialized, or plain text
 */
const parseBankData = async (bankData) => {
  try {
    if (!bankData || typeof bankData !== 'string') return null;
    try {
      return JSON.parse(bankData);
    } catch (_) {
      const parsed = parseSerializedData(bankData);
      return parsed || null;
    }
  } catch (error) {
    logError('[parseBankData] failed:', { error: error.message });
    return null;
  }
};

/**
 * Sanitize payout data and format for API response (parity with Lambda)
 */
export const sanitizePayoutData = async (user) => {
  try {
    logInfo('[sanitizePayoutData] Sanitizing data for user:', { userId: user.id });
    const sanitized = {
      country_id: user.countries_id ? String(user.countries_id) : '99',
      selected: user.payment_gateway ? String(user.payment_gateway).toLowerCase() : null
    };

    switch (sanitized.selected) {
      case 'upi':
        if (user.bank) {
          sanitized.upi = user.bank;
        }
        break;
      case 'paypal':
        if (user.paypal_account) {
          sanitized.paypal = { email: user.paypal_account };
        }
        break;
      case 'bank':
        if (user.bank) {
          sanitized.bank = { bank_details: user.bank };
        }
        break;
      case 'bank_india':
        if (user.bank) {
          const bd = await parseBankData(user.bank);
          if (bd) {
            sanitized.bank_india = {
              acc_no: bd.account_number || bd.acc_no,
              name: bd.holder_name || bd.name,
              bank_name: bd.bank_name,
              ifsc: bd.ifsc_code || bd.ifsc
            };
          }
        }
        break;
      default:
        break;
    }

    return sanitized;
  } catch (error) {
    logError('[sanitizePayoutData] Sanitization error:', { userId: user?.id, error: error.message });
    throw error;
  }
};

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
        u1.avatar as from_avatar,
        u2.username as to_username,
        u2.name as to_name,
        u2.avatar as to_avatar
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

/**
 * Delete user payout method by clearing all payment-related fields
 * Mirrors Lambda behavior: sets payment_gateway, bank, paypal_account to empty strings
 */
export const deleteUserPayoutMethod = async (userId) => {
  try {
    logInfo('[deleteUserPayoutMethod] Deleting payout method for user:', { userId });
    const query = `UPDATE users SET payment_gateway = '', bank = '', paypal_account = '' WHERE id = ?`;
    const [result] = await pool.query(query, [userId]);
    logInfo('[deleteUserPayoutMethod] Delete result:', { userId, affectedRows: result.affectedRows });
    return result;
  } catch (error) {
    logError('[deleteUserPayoutMethod] Database error:', { userId, error: error.message });
    throw error;
  }
};
