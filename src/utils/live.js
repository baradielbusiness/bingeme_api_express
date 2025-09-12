import { getDB } from '../config/database.js';
import { logError, logInfo } from './common.js';
import { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import dotenv from 'dotenv';
dotenv.config();

// Initialize DynamoDB client
const ddbClient = new DynamoDBClient({ region: process.env.AWS_DEFAULT_REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * Get tipping menu for a given live stream
 * @param {number} liveId
 * @returns {Promise<Array>} Array of tipping menu items
 */
const getLatestLiveTippingMenu = async (liveId) => {
    try {
      const pool = getDB();
      const [menu] = await pool.query('SELECT activity_name, coins FROM live_tipping_menus WHERE live_streamings_id = ? AND active != "0"', [liveId]);
      return menu;
    } catch (error) {
      logError('getLatestLiveTippingMenu error:', error);
      return [];
    }
};

/**
 * Get all user IDs who follow or subscribe to a creator (like Helper::getExternalUserId in Laravel)
 * @param {number} creatorId
 * @returns {Promise<string[]>}
 */
const getExternalUserIds = async (creatorId) => {
    const pool = getDB();
    // Get followers
    const [followers] = await pool.query('SELECT user_id FROM follow WHERE creator_id = ? AND follow = 1', [creatorId]);
    // Get subscribers
    const [subscribers] = await pool.query(`
      SELECT s.user_id FROM plans p
      JOIN subscriptions s ON s.stripe_price = p.name
      WHERE p.user_id = ?
    `, [creatorId]);
    // Merge and deduplicate
    const ids = [
      ...followers.map(f => String(f.user_id)),
      ...subscribers.map(s => String(s.user_id))
    ];
    return Array.from(new Set(ids));
};

// Helper to convert DynamoDB item to plain JS object
function dynamoGoalToObject(item) {
  if (!item) return null;
  return {
    goal_id: Number(item.goal_id.S),
    live_id: Number(item.live_id.N),
    goal_name: item.goal_name.S,
    coins: Number(item.coins.N),
    tips_received: Number(item.tips_received.N),
    percentage: Number(item.percentage.N)
  };
}

/**
 * Upsert (create or update) a live goal record in DynamoDB (live-goal-prod).
 * Always recalculates and updates the percentage (floor((tips_received/coins)*100)).
 * @param {Object} goal - { goal_id, live_id, goal_name, coins, tips_received }
 * @returns {Promise<void>}
 */
const upsertLiveGoalDynamo = async (goal) => {
  const {
    goal_id,
    live_id,
    goal_name: rawGoalName = '',
    coins: rawCoins = 0,
    tips_received: rawTipsReceived
  } = goal;

  const goal_name = String(rawGoalName).trim();
  const coins = Number(rawCoins) || 0;
  const TableName = `live-goals-${process.env.NODE_ENV || 'dev'}`;

  if (!goal_id || !live_id) {
    logInfo('[upsertLiveGoalDynamo] Missing goal_id or live_id', { goal_id, live_id });
    return null;
  }

  try {
    // Check if goal exists
    const getKey = { goal_id: { S: String(goal_id) } };
    logInfo('[upsertLiveGoalDynamo] Checking existence', { TableName, getKey });
    const getResult = await docClient.send(new GetItemCommand({ TableName, Key: getKey }));
    const exists = !!getResult.Item;

    let tips_received = typeof rawTipsReceived !== 'undefined'
      ? Number(rawTipsReceived) || 0
      : (getResult.Item && getResult.Item.tips_received ? Number(getResult.Item.tips_received.N) : 0);
    const percentage = coins > 0 ? Math.floor((tips_received / coins) * 100) : 0;

    if (exists) {
      logInfo('[upsertLiveGoalDynamo] Updating existing goal', { goal_id, goal_name, coins, tips_received, percentage });
      let updateExp = 'SET goal_name = :goal_name, coins = :coins, percentage = :percentage';
      let expAttr = {
        ':goal_name': { S: goal_name },
        ':coins': { N: String(coins) },
        ':percentage': { N: String(percentage) }
      };
      if (typeof rawTipsReceived !== 'undefined') {
        updateExp += ', tips_received = :tips_received';
        expAttr[':tips_received'] = { N: String(tips_received) };
      }
      await docClient.send(new UpdateItemCommand({
        TableName,
        Key: getKey,
        UpdateExpression: updateExp,
        ExpressionAttributeValues: expAttr
      }));
    } else {
      if (!goal_name || coins <= 0) {
        logInfo('[upsertLiveGoalDynamo] Not inserting: missing goal_name or coins', { goal_name, coins });
        return null;
      }
      logInfo('[upsertLiveGoalDynamo] Inserting new goal', { goal_id, live_id, goal_name, coins, tips_received, percentage });
      const Item = {
        goal_id: { S: String(goal_id) },
        live_id: { N: String(live_id) },
        goal_name: { S: goal_name },
        coins: { N: String(coins) },
        tips_received: { N: String(tips_received) },
        percentage: { N: String(percentage) }
      };
      await docClient.send(new PutItemCommand({ TableName, Item }));
    }

    logInfo('[upsertLiveGoalDynamo] Fetching upserted item', { TableName, getKey });
    const result = await docClient.send(new GetItemCommand({ TableName, Key: getKey }));
    logInfo('[upsertLiveGoalDynamo] Upserted item result', { item: result.Item });
    return dynamoGoalToObject(result.Item);
  } catch (err) {
    logError('[upsertLiveGoalDynamo] DynamoDB error', err);
    return null;
  }
};

/**
 * Get Live Details
 * @param {number} liveId
 * @returns {Promise<object>} Live stream object
 */
const getLiveStreamings = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(`
      SELECT *, DATE_FORMAT(date_time, '%Y-%m-%d %H:%i:%s') as date_time
      FROM live_streamings 
      WHERE id = ?
    `, [liveId]);
    return rows[0] || {};
  } catch (error) {
    logError('getLiveStreamings error:', error);
    return {};
  }
};

/**
 * Get all active tipping menus for a given live stream
 * @param {number} liveId
 * @returns {Promise<Array>} Array of active tipping menu items
 */
const getActiveLiveTippingMenus = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT id, activity_name as name, coins as price FROM live_tipping_menus WHERE live_streamings_id = ? AND active = "1"',
      [liveId]
    );
    return rows;
  } catch (error) {
    logError('getActiveLiveTippingMenus error:', error);
    return [];
  }
};

/**
 * Get total earnings for a live stream (all types)
 * @param {number} liveId
 * @returns {Promise<number>} Total earnings
 */
const getLiveTotalEarnings = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT SUM(earning_net_user_coins) as total FROM transactions WHERE (live_id = ? OR ref_id = ?) AND type IN ("live_tip", "tipmenu", "live")',
      [liveId, liveId]
    );
    return rows[0]?.total || 0;
  } catch (error) {
    logError('getLiveTotalEarnings error:', error);
    return 0;
  }
};

/**
 * Get bookings count for a live stream
 * @param {number} liveId
 * @returns {Promise<number>} Bookings count
 */
const getLiveBookingsCount = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT COUNT(*) as bookings FROM live_prebooks WHERE live_id = ?',
      [liveId]
    );
    return rows[0]?.bookings || 0;
  } catch (error) {
    logError('getLiveBookingsCount error:', error);
    return 0;
  }
};

/**
 * Get tip earnings for a live stream
 * @param {number} liveId
 * @returns {Promise<number>} Tip earnings
 */
const getLiveTipEarnings = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT SUM(earning_net_user_coins) as tip FROM transactions WHERE (live_id = ? OR ref_id = ?) AND type IN ("live_tip", "tipmenu")',
      [liveId, liveId]
    );
    return rows[0]?.tip || 0;
  } catch (error) {
    logError('getLiveTipEarnings error:', error);
    return 0;
  }
};

/**
 * Get active goal for a live stream
 * @param {number} liveId
 * @returns {Promise<object|null>} Goal object or null
 */
const getActiveLiveGoal = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT id as goal_id, goal_name as name, coins as price FROM live_goals WHERE live_streamings_id = ? AND active = "1" LIMIT 1',
      [liveId]
    );
    return rows[0] || null;
  } catch (error) {
    logError('getActiveLiveGoal error:', error);
    return null;
  }
};

/**
 * Get viewers count for a live stream
 * @param {number} liveId
 * @returns {Promise<number>} Viewers count
 */
const getLiveViewersCount = async (liveId) => {
  try {
    const pool = getDB();
    const [rows] = await pool.query(
      'SELECT COUNT(DISTINCT user_id) as viewers FROM live_online_users WHERE live_streamings_id = ?',
      [liveId]
    );
    return rows[0]?.viewers || 0;
  } catch (error) {
    logError('getLiveViewersCount error:', error);
    return 0;
  }
};

/**
 * Get the latest live stream for a user
 * @param {number} userId - The user ID
 * @returns {Promise<object|null>} Latest live stream object or null
 */
const getLatestLiveForUser = async (userId) => {
  try {
    const pool = getDB();
    const [lives] = await pool.query('SELECT * FROM live_streamings WHERE user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
    return lives[0] || null;
  } catch (error) {
    logError('getLatestLiveForUser error:', error);
    return null;
  }
};

/**
 * Get restricted creators for live email notification
 * @returns {Promise<number[]>} Array of creator IDs
 */
const getRestrictedLiveEmailCreators = async (conn) => {
  try {
    const [rows] = await conn.query('SELECT creator_id FROM admin_restricted_creators WHERE live_email_notification = 1');
    return rows.map(r => r.creator_id);
  } catch (error) {
    logError('getRestrictedLiveEmailCreators error:', error);
    return [];
  }
};

/**
 * Update live stream fields
 * @param {object} conn - DB connection
 * @param {object} data - Live stream data
 * @param {number} liveId - Live stream ID
 */
const updateLiveStreaming = async (conn, data, liveId, datetime) => {
  // Format datetime for MySQL (YYYY-MM-DD HH:mm:ss)
  const formattedDateTime = datetime.toISOString().slice(0, 19).replace('T', ' ');
  
  // Get current time in IST (UTC+5:30)
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // Add 5 hours 30 minutes
  const istDateTime = istTime.toISOString().slice(0, 19).replace('T', ' ');
  
  await conn.query('UPDATE live_streamings SET name=?, price=?, availability=?, type=?, duration=?, date_time=?, updated_at=?, is_utc="0" WHERE id=?', [
    data.name,
    data.price || 0,
    data.availability,
    data.type,
    data.duration || 0,
    formattedDateTime,
    istDateTime, // updated_at in IST
    liveId
  ]);
};

/**
 * Increment number_of_reschedules for a live stream
 * @param {object} conn - DB connection
 * @param {number} liveId - Live stream ID
 */
const incrementLiveReschedules = async (conn, liveId) => {
  // Get current time in IST (UTC+5:30)
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // Add 5 hours 30 minutes
  const istDateTime = istTime.toISOString().slice(0, 19).replace('T', ' ');
  
  await conn.query('UPDATE live_streamings SET number_of_reschedules = number_of_reschedules + 1, user_notification = 0, updated_at = ?, is_utc = "0" WHERE id = ?', [istDateTime, liveId]);
};

/**
 * Create a new live stream
 * @param {object} conn - DB connection
 * @param {object} data - Live stream data
 * @param {number} userId - User ID
 * @param {string} channel - Channel name
 * @param {Date} datetime - Scheduled date/time
 * @returns {Promise<number>} Inserted liveId
 */
const createLiveStreaming = async (conn, data, userId, channel, datetime) => {
  // Format datetime for MySQL (YYYY-MM-DD HH:mm:ss)
  const formattedDateTime = datetime.toISOString().slice(0, 19).replace('T', ' ');
  
  // Get current time in IST (UTC+5:30)
  const now = new Date();
  const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // Add 5 hours 30 minutes
  const istDateTime = istTime.toISOString().slice(0, 19).replace('T', ' ');
  
  const [result] = await conn.query('INSERT INTO live_streamings (user_id, channel, name, price, availability, type, duration, date_time, extended_mins, modify_user, created_at, updated_at, status, number_of_reschedules, is_utc, creator_joined) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, "0", 0, "0", 0)', [
    userId,
    channel,
    data.name,
    data.price || 0,
    data.availability,
    data.type,
    data.duration || 0,
    formattedDateTime,
    istDateTime, // created_at in IST
    istDateTime  // updated_at in IST
  ]);
  return result.insertId;
};

/**
 * Replace all tipping menu items for a live stream
 * @param {object} conn - DB connection
 * @param {number} liveId - Live stream ID
 * @param {string[]} activities - Array of activity names
 * @param {number[]} coins - Array of coin values
 */
const replaceLiveTippingMenus = async (conn, liveId, activities, coins) => {
  // First, delete all existing tipmenu items for this live stream
  await conn.query('DELETE FROM live_tipping_menus WHERE live_streamings_id=?', [liveId]);
  
  // Then, create new tipmenu items from the provided data
  if (activities && coins && activities.length > 0) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (let i = 0; i < activities.length; i++) {
      if (activities[i] && coins[i]) {
        await conn.query(
          'INSERT INTO live_tipping_menus (live_streamings_id, activity_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [liveId, activities[i], coins[i], '1', now, now]
        );
      }
    }
  }
};

/**
 * Update a live goal
 * @param {object} conn - DB connection
 * @param {string} goalName - Goal name
 * @param {number} coins - Coin value
 * @param {number} goalId - Goal ID
 */
const updateLiveGoal = async (conn, goalName, coins, goalId) => {
  // Validate inputs to prevent empty rows
  if (!goalId || !goalName || !coins || goalName.trim() === '' || coins <= 0) {
    logError('[updateLiveGoal] Invalid inputs provided:', { goalId, goalName, coins });
    throw new Error('Invalid goal data provided');
  }
  
  await conn.query('UPDATE live_goals SET goal_name=?, coins=?, active="1", updated_at=NOW() WHERE id=?', [goalName.trim(), coins, goalId]);
};

/**
 * Create a new live goal
 * @param {object} conn - DB connection
 * @param {number} liveId - Live stream ID
 * @param {string} goalName - Goal name
 * @param {number} coins - Coin value
 */
const createLiveGoal = async (conn, liveId, goalName, coins) => {
  // Validate inputs to prevent empty rows
  if (!liveId || !goalName || !coins || goalName.trim() === '' || coins <= 0) {
    logError('[createLiveGoal] Invalid inputs provided:', { liveId, goalName, coins });
    throw new Error('Invalid goal data provided');
  }
  
  await conn.query('INSERT INTO live_goals (live_streamings_id, goal_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, "1", NOW(), NOW())', [liveId, goalName.trim(), coins]);
};

/**
 * Create an empty live goal row (when user doesn't provide goal data)
 * @param {object} conn - DB connection
 * @param {number} liveId - Live stream ID
 */
const createEmptyLiveGoal = async (conn, liveId) => {
  // Validate that liveId is provided
  if (!liveId) {
    logError('[createEmptyLiveGoal] Live ID is required');
    throw new Error('Live ID is required');
  }
  
  await conn.query('INSERT INTO live_goals (live_streamings_id, goal_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, "1", NOW(), NOW())', [liveId, '', 0]);
  logInfo('[createEmptyLiveGoal] Empty goal row created for live:', { liveId });
};

/**
 * Deactivate live goals by IDs
 * @param {object} conn - DB connection
 * @param {number[]} ids - Array of goal IDs
 */
const deactivateLiveGoals = async (conn, ids) => {
  if (ids.length > 0) {
    await conn.query('UPDATE live_goals SET active="0", updated_at=NOW() WHERE id IN (?)', [ids]);
  }
};

/**
 * Update creator_joined status to 1 when creator joins their own live stream
 * @param {number} liveId - Live stream ID
 * @returns {Promise<void>}
 */
const updateCreatorJoined = async (liveId) => {
  try {
    // Get current time in IST (UTC+5:30)
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000)); // Add 5 hours 30 minutes
    const istDateTime = istTime.toISOString().slice(0, 19).replace('T', ' ');
    
    const pool = getDB();
    await pool.query('UPDATE live_streamings SET creator_joined = 1, updated_at = ? WHERE id = ?', [istDateTime, liveId]);
    logInfo('[updateCreatorJoined] Creator joined status updated', { liveId });
  } catch (error) {
    logError('[updateCreatorJoined] Error updating creator_joined:', error);
    throw error;
  }
};

export { 
  getLatestLiveTippingMenu, 
  getExternalUserIds, 
  getLiveStreamings, 
  upsertLiveGoalDynamo, 
  getActiveLiveTippingMenus, 
  getLiveTotalEarnings, 
  getLiveBookingsCount, 
  getLiveTipEarnings, 
  getActiveLiveGoal, 
  getLiveViewersCount, 
  getLatestLiveForUser, 
  getRestrictedLiveEmailCreators, 
  updateLiveStreaming, 
  incrementLiveReschedules, 
  createLiveStreaming, 
  replaceLiveTippingMenus, 
  updateLiveGoal, 
  createLiveGoal, 
  createEmptyLiveGoal, 
  deactivateLiveGoals, 
  updateCreatorJoined 
};
