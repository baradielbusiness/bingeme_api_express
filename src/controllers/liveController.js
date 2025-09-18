/**
 * @file liveController.js
 * @description Express.js Live Stream Controllers
 * 
 * This module provides live stream functionality including:
 * - Live stream creation and editing
 * - Live stream deletion
 * - Live filter management
 * - Tipping menu management
 * - Goal management
 * - Live stream joining with Agora credentials
 * 
 * Database Tables: live_streamings, live_tipping_menus, live_goals, transactions, live_online_users
 */

import { 
  getAuthenticatedUserId, 
  getAdminSettings, 
  createErrorResponse, 
  createSuccessResponse, 
  getUserById, 
  encryptId, 
  safeDecryptId, 
  logInfo, 
  logError, 
  convertLocalToUTC, 
  getCreatorGroupBasedIds 
} from '../utils/common.js';
import { 
  getExternalUserIds, 
  getActiveLiveTippingMenus, 
  getLatestLiveForUser, 
  getRestrictedLiveEmailCreators, 
  incrementLiveReschedules, 
  updateLiveStreaming, 
  createLiveStreaming, 
  replaceLiveTippingMenus, 
  createLiveGoal, 
  createEmptyLiveGoal, 
  updateLiveGoal, 
  deactivateLiveGoals,
  getLiveStreamings,
  getLiveTotalEarnings,
  getLiveBookingsCount,
  getLiveTipEarnings,
  getActiveLiveGoal,
  getLiveViewersCount,
  upsertLiveGoalDynamo,
  updateCreatorJoined
} from '../utils/live.js';
import { pool } from '../config/database.js';
import { RtcTokenBuilder, Role as RtcRole } from '../agora/RtcTokenBuilder2.js';
import { validateLiveStreamData } from '../validate/live.js';
import dayjs from 'dayjs';

/**
 * List of all available video filters for live streaming.
 * This list must be kept in sync with the frontend and Laravel backend.
 * Keys are used as filter identifiers; values are display names for UI.
 */
const FILTERS = {
  normal: 'Normal',
  'icy-water': 'Icy Water',
  'summer-heat': 'Summer Heat',
  fever: 'Fever',
  strawberry: 'Strawberry',
  ibiza: 'Ibiza',
  'sweet-sunset': 'Sweet Sunset',
  'blue-rock': 'Blue Rock',
  'ocean-wave': 'Ocean Wave',
  'little-red': 'Little Red',
  'vintage-may': 'Vintage May',
  'desert-morning': 'Desert Morning',
  'blue-lagoon': 'Blue Lagoon',
  'warm-ice': 'Warm Ice',
  'burnt-coffee': 'Burnt Coffee',
  waterness: 'Waterness',
  'old-wood': 'Old Wood',
  'distant-mountain': 'Distant Mountain',
  'coal-paper': 'Coal Paper',
  'simple-gray': 'Simple Gray',
  'rose-quartz': 'Rose Quartz',
  amazon: 'Amazon',
  'baseline-special': 'Baseline Special',
  'baby-glass': 'Baby Glass',
  'rose-glass': 'Rose Glass',
  'yellow-haze': 'Yellow Haze',
  'blue-haze': 'Blue Haze',
  'studio-54': 'Studio 54',
  'burnt-peach': 'Burnt Peach',
  'mono-sky': 'Mono Sky',
  'mustard-grass': 'Mustard Grass',
  leaf: 'Leaf',
  ryellow: 'Ryellow',
  'baseline-darken': 'Baseline Darken',
  'red-sky': 'Red Sky',
};

/**
 * Handler to fetch the latest live and tipping menu for a user (GET /live/create)
 *
 * Returns the latest live stream and its tipping menus for the authenticated user.
 *
 * @param {object} req - Express request object
 * @returns {object} API response with tippingMenus and liveId or error
 */
export const getLiveCreate = async (req, res) => {
  // Authenticate user
  // TODO: Convert getAuthenticatedUserId(event, { action: 'access' }) to getAuthenticatedUserId(req, { action: 'access' })
  const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'access' });
  if (errorResponse) {
    // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
    return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
  }

  // Fetch user and verify
  const user = await getUserById(userId);
  if (!user) {
    // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
    return res.status(404).json(createErrorResponse(404, 'User not found'));
  }
  if (user.verified_id !== 'yes') {
    // TODO: Convert createErrorResponse(403, 'User must be verified to access creator settings') to res.status(403).json({ error: 'User must be verified to access creator settings' })
    return res.status(403).json(createErrorResponse(403, 'User must be verified to access creator settings'));
  }

  try {
    // Get latest live for the user using utility function
    const latestLive = await getLatestLiveForUser(userId);
    let tippingMenus = [];
    let liveId = null;
    if (latestLive) {
      tippingMenus = await getActiveLiveTippingMenus(latestLive.id);
      liveId = latestLive.id;
    }

    // Encrypt tipmenu IDs for security
    const encryptedTippingMenus = tippingMenus.map(item => ({
      ...item,
      id: encryptId(item.id)
    }));

    // TODO: Convert createSuccessResponse('Fetched latest live and tipping menu', { ... }) to res.json({ success: true, message: 'Fetched latest live and tipping menu', data: { ... } })
    return res.json({
      success: true,
      message: 'Fetched latest live and tipping menu',
      data: { 
        tippingMenus: encryptedTippingMenus, 
        liveId: liveId ? encryptId(liveId) : null 
      }
    });
  } catch (error) {
    // TODO: Convert createErrorResponse(500, 'Failed to fetch latest live/tipping menu', error.message) to res.status(500).json({ error: 'Failed to fetch latest live/tipping menu', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch latest live/tipping menu'));
  }
};

/**
 * Handler to create or edit a live stream (POST /live/create)
 *
 * Handles both creation and editing logic, including tipping menu and goal management.
 * Validates input, manages scheduling, and updates/creates records as needed.
 *
 * @param {object} req - Express request object with path parameters and request body
 * @returns {object} API response with encrypted liveId and URL or error
 */
export const postLiveCreate = async (req, res) => {
  // Authenticate user
  // TODO: Convert getAuthenticatedUserId(event, { action: 'access' }) to getAuthenticatedUserId(req, { action: 'access' })
  const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'access' });
  if (errorResponse) {
    // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
    return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
  }

  // Fetch user and verify
  const user = await getUserById(userId);
  if (!user) {
    // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
    return res.status(404).json(createErrorResponse(404, 'User not found'));
  }
  if (user.verified_id !== 'yes') {
    // TODO: Convert createErrorResponse(403, 'User must be verified to access creator settings') to res.status(403).json({ error: 'User must be verified to access creator settings' })
    return res.status(403).json(createErrorResponse(403, 'User must be verified to access creator settings'));
  }

  let data;
  try {
    // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
    data = JSON.parse(req.body || '{}');
  } catch (e) {
    // TODO: Convert createErrorResponse(400, 'Invalid JSON body') to res.status(400).json({ error: 'Invalid JSON body' })
    return res.status(400).json(createErrorResponse(400, 'Invalid JSON body'));
  }

  // Get admin settings for price validation
  const adminSettings = await getAdminSettings();
  
  // Validate input fields for live creation/edit using comprehensive validation
  const validationResult = validateLiveStreamData(data, adminSettings);
  if (!validationResult.valid) {
    // TODO: Convert createErrorResponse(422, 'Validation failed', validationResult.errors) to res.status(422).json({ error: 'Validation failed', details: validationResult.errors })
    return res.status(422).json(createErrorResponse(422, 'Validation failed'));
  }
  
  // Use validated data for further processing
  const validatedData = validationResult.data;
  
  // Scheduled time must be in the future (UTC)
  let nowUTC = new Date();
  let liveType = validatedData.type;
  let datetime = null;
  
  if (liveType === 'scheduled' && data.scheduled_date && data.scheduled_time) {
    // Validate timezone is provided for scheduled lives
    if (!data.timezone) {
      // TODO: Convert createErrorResponse(422, 'Validation failed', { timezone: 'Timezone is required for scheduled live streams' }) to res.status(422).json({ error: 'Validation failed', details: { timezone: 'Timezone is required for scheduled live streams' } })
      return res.status(422).json(createErrorResponse(422, 'Timezone is required for scheduled live streams'));
    } else {
      try {
        // Convert user's local timezone to UTC using the utility function
        datetime = convertLocalToUTC(data.scheduled_date, data.scheduled_time, data.timezone);
        
        // Validate that the converted datetime is in the future
        if (datetime <= nowUTC) {
          // TODO: Convert createErrorResponse(422, 'Validation failed', { scheduled_time: 'Scheduled Time Should Be Greater Than Current Time' }) to res.status(422).json({ error: 'Validation failed', details: { scheduled_time: 'Scheduled Time Should Be Greater Than Current Time' } })
          return res.status(422).json(createErrorResponse(422, 'Scheduled Time Should Be Greater Than Current Time'));
        }

      } catch (timezoneError) {
        logError('[liveCreatePostHandler] Timezone conversion failed:', timezoneError);
        // TODO: Convert createErrorResponse(422, 'Validation failed', { timezone: timezoneError.message }) to res.status(422).json({ error: 'Validation failed', details: { timezone: timezoneError.message } })
        return res.status(422).json(createErrorResponse(422, timezoneError.message));
      }
    }
  } else {
    datetime = nowUTC;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let liveId = null;
    let isEdit = false;
    let live = null;
    let channel = null;
    let url = null;
    let liveEmailFlag = true; // Set to true for new live, may change for edit
    // Get admin settings for buffer and max reschedules
    const adminSettings = await getAdminSettings();
    const maxReschedules = adminSettings.max_number_of_reschedules || 3;
    const liveMailBufferMins = adminSettings.live_schedule_delay || 120;
    // Get restricted creators for live email
    const restrictedLiveEmailCreators = await getRestrictedLiveEmailCreators(conn);
    // If editing an existing live
    if (data.encryptedLiveId) {
      liveId = safeDecryptId(data.encryptedLiveId);
      if (!liveId) {
        await conn.rollback();
        conn.release();
        // TODO: Convert createErrorResponse(400, 'Invalid encrypted live_id') to res.status(400).json({ error: 'Invalid encrypted live_id' })
        return res.status(400).json(createErrorResponse(400, 'Invalid encrypted live_id'));
      }
      // Fetch live record
      const [lives] = await conn.query('SELECT * FROM live_streamings WHERE id = ?', [liveId]);
      live = lives[0];
      if (!live) {
        await conn.rollback();
        conn.release();
        // TODO: Convert createErrorResponse(404, 'Live not found') to res.status(404).json({ error: 'Live not found' })
        return res.status(404).json(createErrorResponse(404, 'Live not found'));
      }
      isEdit = true;
      if (live.type !== 'scheduled' && liveType === 'scheduled') {
        await conn.rollback();
        conn.release();
        // TODO: Convert createErrorResponse(400, 'Live type cannot be modified') to res.status(400).json({ error: 'Live type cannot be modified' })
        return res.status(400).json(createErrorResponse(400, 'Live type cannot be modified'));
      }
      // Reschedule logic: only allow if under max, and at least 12 hours in advance
      let newLiveDatetime = datetime;
      let oldLiveDatetime = new Date(live.date_time);
      if (maxReschedules > (live.number_of_reschedules || 0)) {
        if (newLiveDatetime.getTime() !== oldLiveDatetime.getTime()) {
          // Must be at least 12 hours from now unless in skip group
          const skipIds = await getCreatorGroupBasedIds('20'); // Group 20: Creators exempt from 12-hour reschedule rule
          logInfo('[liveCreatePostHandler] Skip IDs:', skipIds);
          const isRescheduledSkipped = skipIds.includes(userId);
          if (newLiveDatetime < new Date(Date.now() + 12 * 60 * 60 * 1000) && !isRescheduledSkipped) {
            await conn.rollback();
            conn.release();
            // TODO: Convert createErrorResponse(400, 'New Livetime should be greater than 12hrs from the Current time') to res.status(400).json({ error: 'New Livetime should be greater than 12hrs from the Current time' })
            return res.status(400).json(createErrorResponse(400, 'New Livetime should be greater than 12hrs from the Current time'));
          }
          // Increment number_of_reschedules using utility
          await incrementLiveReschedules(conn, liveId);
          liveEmailFlag = true;
        }
      } else {
        await conn.rollback();
        conn.release();
        // TODO: Convert createErrorResponse(400, 'Max number of reschedules reached. Please delete and create new.') to res.status(400).json({ error: 'Max number of reschedules reached. Please delete and create new.' })
        return res.status(400).json(createErrorResponse(400, 'Max number of reschedules reached. Please delete and create new.'));
      }
      // Update live fields using utility - merge validated data with original data for fields not validated
      const updateData = { ...data, ...validatedData };
      await updateLiveStreaming(conn, updateData, liveId, datetime);
      channel = live.channel;
    } else {
      // Creating new live
      const [activeLives] = await conn.query('SELECT COUNT(*) as cnt FROM live_streamings WHERE user_id = ? AND status = "0"', [userId]);
      if (activeLives[0].cnt > 0) {
        await conn.rollback();
        conn.release();
        // TODO: Convert createErrorResponse(400, 'Live already created') to res.status(400).json({ error: 'Live already created' })
        return res.status(400).json(createErrorResponse(400, 'Live already created'));
      }
      channel = `live_${Math.random().toString(36).substring(2, 7)}_${userId}`;
      // Create new live using utility - merge validated data with original data for fields not validated
      const createData = { ...data, ...validatedData };
      liveId = await createLiveStreaming(conn, createData, userId, channel, datetime);
      liveEmailFlag = true;
    }
      
      // Buffer and restricted creator logic for liveEmailFlag
      const nowUTCBuffer = new Date(Date.now() + liveMailBufferMins * 60 * 1000);
      const [liveRows] = await conn.query('SELECT date_time, user_id FROM live_streamings WHERE id = ?', [liveId]);
      const liveRow = liveRows[0];
      if (liveRow && (new Date(liveRow.date_time) < nowUTCBuffer || restrictedLiveEmailCreators.includes(liveRow.user_id))) {
        liveEmailFlag = false;
      }
      
      // $follow logic: fetch followers/subscribers for notification
      await getExternalUserIds(userId);
      
      // Tipping menu handling: replace all tipmenu items
      if (Array.isArray(data.activity) && Array.isArray(data.coins)) {
        // Replace all existing tipmenu items with the new data
        await replaceLiveTippingMenus(conn, liveId, data.activity, data.coins);
      }
      
      // Goal handling: update/create/deactivate as needed
      // If goal_name and goal_coins are provided, either update existing goal (if goalid provided) or create new goal
      if (data.goal_name && 
          data.goal_name !== 'string' && 
          data.goal_name.trim() !== '' && 
          data.goal_coins && 
          data.goal_coins > 0) {
        let goalId = data.goalid && data.goalid !== 'string' ? safeDecryptId(data.goalid) : null;
        if (goalId) {
          // Update existing goal using utility
          await updateLiveGoal(conn, data.goal_name, data.goal_coins, goalId);
        } else {
          // Create new goal using utility
          await createLiveGoal(conn, liveId, data.goal_name, data.goal_coins);
        }
      } else {
        // Create empty goal row when no valid goal data is provided
        await createEmptyLiveGoal(conn, liveId);
      }
      
      if (data.delgoalid) {
        const ids = data.delgoalid.split(',')
          .map(id => id ? safeDecryptId(id) : null)
          .filter(Boolean);
        // Deactivate goals using utility
        await deactivateLiveGoals(conn, ids);
      }
      
      // Set the URL for the live stream (live now or scheduled)
      url = data.type === 'livenow' ? `/live/go/${liveId}` : `/${user.username}`;
      
      // Prepare response data
      let responseData = { liveId: encryptId(liveId), url };
      
      // If live type is livenow, include Agora-related data
      if (data.type === 'livenow') {
        try {
          // Fetch admin settings for Agora
          const adminSettings = await getAdminSettings();
          const { agora_app_id: agoraAppId, agora_app_certificate: agoraAppCertificate } = adminSettings;
          
          // Generate random UID and determine role (creator is publisher)
          const uid = Math.floor(Math.random() * 10000);
          const role = RtcRole.PUBLISHER;
          const expireTimeInSeconds = ((data.duration || 0) + 60) * 60 * 24;
          
          // Generate Agora token
          const token = RtcTokenBuilder.buildTokenWithUid(agoraAppId, agoraAppCertificate, channel, uid, role, expireTimeInSeconds);
          
          // Add Agora data to response
          responseData = {
            ...responseData,
            agoraAppId,
            agoraChannel: channel,
            token,
            uid
          };
          
          logInfo('[postLiveCreate] Agora data generated for livenow', { 
            liveId: encryptId(liveId), 
            channel, 
            uid 
          });
        } catch (agoraError) {
          logError('[postLiveCreate] Failed to generate Agora data:', agoraError);
          // Continue without Agora data if there's an error
        }
      }
      
    await conn.commit();
    conn.release();
    // TODO: Convert createSuccessResponse('Live stream created/edited successfully', responseData) to res.json({ success: true, message: 'Live stream created/edited successfully', data: responseData })
    return res.json({
      success: true,
      message: 'Live stream created/edited successfully',
      data: responseData
    });
  } catch (error) {
    await conn.rollback();
    conn.release();
    // TODO: Convert createErrorResponse(500, 'Failed to create/edit live stream', error.message) to res.status(500).json({ error: 'Failed to create/edit live stream', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Failed to create/edit live stream'));
  }
};

/**
 * Handler to retrieve live stream details for editing (GET /live/edit/:liveId)
 */
export const getLiveEdit = async (req, res) => {
  try {
    const userId = req.userId;
    const { liveId } = req.params;

    // Fetch user and verify
    const user = await getUserById(userId);
    if (!user) return res.status(404).json(createErrorResponse(404, 'User not found'));
    if (user.verified_id !== 'yes') return res.status(403).json(createErrorResponse(403, 'User must be verified to access creator settings'));

    // Decrypt live ID
    const decryptedLiveId = safeDecryptId(liveId);
    if (!decryptedLiveId) {
      return res.status(400).json(createErrorResponse(400, 'Invalid live ID format'));
    }

    // Get live streaming details
    const liveStreaming = await getLiveStreamings(decryptedLiveId);
    if (!liveStreaming || Object.keys(liveStreaming).length === 0) {
      return res.status(404).json(createErrorResponse(404, 'Live stream not found'));
    }

    // Check if user owns this live stream
    if (liveStreaming.user_id != userId) {
      return res.status(404).json(createErrorResponse(404, 'Live stream not found'));
    }

    // Check if live stream is editable (status = '0')
    if (liveStreaming.status != '0') {
      return res.status(404).json(createErrorResponse(404, 'Live stream is not editable'));
    }

    // Get tipping menus for this live stream
    const tippingMenus = await getActiveLiveTippingMenus(decryptedLiveId);

    // Get live goal for this live stream
    const liveGoal = await getActiveLiveGoal(decryptedLiveId);

    // Encrypt IDs for security
    const encryptedTippingMenus = tippingMenus.map(item => ({
      ...item,
      id: encryptId(item.id)
    }));

    const encryptedLiveGoal = liveGoal ? {
      ...liveGoal,
      goal_id: encryptId(liveGoal.goal_id)
    } : null;

    // Get admin settings for max reschedules
    const adminSettings = await getAdminSettings();
    const maxReschedules = adminSettings?.max_number_of_reschedules || 10; // Default to 10 if not set
    const remainingReschedules = maxReschedules - liveStreaming.number_of_reschedules;

    // Prepare response data - include only specific fields from live_streamings table
    const responseData = {
      liveStreaming: {
        id: encryptId(liveStreaming.id),
        name: liveStreaming.name,
        price: liveStreaming.price,
        availability: liveStreaming.availability,
        type: liveStreaming.type,
        duration: liveStreaming.duration,
        date: liveStreaming.date_time ? liveStreaming.date_time.split(' ')[0] : null,
        time: liveStreaming.date_time ? liveStreaming.date_time.split(' ')[1] : null,
        date_time: liveStreaming.date_time,
        number_of_reschedules: liveStreaming.number_of_reschedules,
        remaining_reschedules: remainingReschedules
      },
      tippingMenus: encryptedTippingMenus,
      liveGoal: encryptedLiveGoal,
    };

    return res.status(200).json(createSuccessResponse('Live edit details retrieved successfully', responseData));

  } catch (error) {    
    logError('getLiveEdit error:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to retrieve live edit details', error.message));
  }
};

/**
 * Live stream status constants for validation
 */
const LIVE_STREAM_STATUS = {
  SCHEDULED: '0',     // Scheduled - can be deleted
  COMPLETED: '1',     // Completed - cannot be deleted
  DELETED: '2',       // Already deleted - cannot be deleted
  EXPIRED: '3',       // Expired - cannot be deleted
  UNCLOSED_LIVE: '4', // Unclosed Live - cannot be deleted
  REFUNDED: '5'       // Refunded - cannot be deleted
};

/**
 * Get descriptive error message based on live stream status
 */
const getStatusErrorMessage = (status) => {
  const statusMessages = {
    [LIVE_STREAM_STATUS.COMPLETED]: 'Live stream is completed and cannot be deleted',
    [LIVE_STREAM_STATUS.DELETED]: 'Live stream is already deleted',
    [LIVE_STREAM_STATUS.EXPIRED]: 'Live stream is expired and cannot be deleted',
    [LIVE_STREAM_STATUS.UNCLOSED_LIVE]: 'Live stream is unclosed and cannot be deleted',
    [LIVE_STREAM_STATUS.REFUNDED]: 'Live stream is refunded and cannot be deleted'
  };
  
  return statusMessages[status] || 'Live stream cannot be deleted';
};

/**
 * Clean up email notifications for a deleted live stream
 */
const cleanupEmailNotifications = async (connection, liveId) => {
  await connection.execute(
    'DELETE FROM email_notify_schedules WHERE notification_id = ? AND type IN (?, ?) AND status = ?',
    [liveId, 'live', 'live_reminder', '0']
  );
};

/**
 * Update live stream status to deleted
 */
const markLiveStreamAsDeleted = async (connection, liveId, userId) => {
  await connection.execute(
    'UPDATE live_streamings SET status = ?, modify_user = ?, updated_at = NOW() WHERE id = ?',
    [LIVE_STREAM_STATUS.DELETED, userId, liveId]
  );
};

/**
 * Handler to delete a live stream (DELETE /live/delete/:id)
 */
export const deleteLive = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    // Validate ID parameter
    if (!id) return res.status(400).json(createErrorResponse(400, 'Live ID is required'));

    // Fetch and verify user exists
    const user = await getUserById(userId);
    if (!user) return res.status(404).json(createErrorResponse(404, 'User not found'));

    // Decrypt and validate the live ID
    let decryptedId;
    try {
      decryptedId = safeDecryptId(id);
      if (!decryptedId) return res.status(400).json(createErrorResponse(400, 'Invalid live ID format'));
    } catch (error) {
      logError('Failed to decrypt live ID:', { 
        id, 
        error: error.message 
      });
      return res.status(400).json(createErrorResponse(400, 'Invalid live ID'));
    }

    // Begin database transaction for data consistency
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Fetch the live streaming record and verify ownership
      const [liveRows] = await connection.execute(
        'SELECT * FROM live_streamings WHERE id = ? AND user_id = ?',
        [decryptedId, userId]
      );

      if (liveRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json(createErrorResponse(404, 'Live stream not found or access denied'));
      }

      const [liveStreaming] = liveRows;

      // Validate live stream status before deletion
      if (liveStreaming.status !== LIVE_STREAM_STATUS.SCHEDULED) {
        await connection.rollback();
        connection.release();
        
        const statusMessage = getStatusErrorMessage(liveStreaming.status);
        
        logInfo('Live stream deletion rejected due to invalid status:', { 
          liveId: decryptedId, 
          userId, 
          username: user.username,
          currentStatus: liveStreaming.status,
          statusMessage 
        });
        
        return res.status(400).json(createErrorResponse(400, statusMessage, {
          currentStatus: liveStreaming.status,
          liveId: id // Return encrypted ID for security
        }));
      }

      // Perform deletion operations
      await markLiveStreamAsDeleted(connection, decryptedId, userId);
      await cleanupEmailNotifications(connection, decryptedId);

      // Commit transaction
      await connection.commit();
      connection.release();

      // Log successful deletion
      logInfo('Live stream deleted successfully:', { 
        liveId: decryptedId, 
        userId, 
        username: user.username 
      });

      // Return success response with encrypted live ID for security
      return res.status(200).json(createSuccessResponse('Live stream deleted successfully', {
        liveId: id
      }));

    } catch (dbError) {
      // Rollback transaction on database error
      await connection.rollback();
      connection.release();
      
      logError('Database error during live deletion:', { 
        error: dbError.message, 
        liveId: decryptedId, 
        userId 
      });
      
      return res.status(500).json(createErrorResponse(500, 'Failed to delete live stream', dbError.message));
    }

  } catch (error) {
    logError('Unexpected error in live delete handler:', { 
      error: error.message, 
      stack: error.stack 
    });
    
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};



/**
 * Handler to get live filters (GET /live/filter)
 */
/**
 * GET /live/filter handler
 *
 * Fetches the list of all available video filters and the currently applied filter for a given live stream.
 *
 * Business rules:
 *   - Requires user authentication (JWT Bearer token in headers).
 *   - Requires an encrypted live stream ID as a query parameter (?c=...).
 *   - Returns 400 if the parameter is missing or invalid.
 *   - Returns 404 if the live stream does not exist.
 *   - (Optionally) Could restrict access to the creator only, but currently allows any authenticated user.
 *
 * @param {object} req - Express request object
 * @returns {object} API response with { filters, current_filter }
 */
export const getLiveFilter = async (req, res) => {
  try {
    // Step 1: Authenticate the user (throws 401/403 if not valid)
    // TODO: Convert getAuthenticatedUserId(event, { action: 'access' }) to getAuthenticatedUserId(req, { action: 'access' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'access' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Step 2: Parse and validate the encrypted live stream ID from query params
    // TODO: Convert event.queryStringParameters = {} to req.query = {}
    const { queryStringParameters = {} } = req.query;
    const { c: encryptedLiveId } = queryStringParameters;
    if (!encryptedLiveId) {
      // Client did not provide the required parameter
      // TODO: Convert createErrorResponse(400, 'Missing live id parameter') to res.status(400).json({ error: 'Missing live id parameter' })
      return res.status(400).json(createErrorResponse(400, 'Missing live id parameter'));
    }
    
    // Decrypt the live ID for security
    let liveId;
    try {
      liveId = safeDecryptId(encryptedLiveId);
    } catch (error) {
      logError('[getLiveFilterHandler] Failed to decrypt live ID:', { encryptedLiveId, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid live id format') to res.status(400).json({ error: 'Invalid live id format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid live id format'));
    }

    // Step 3: Fetch the live stream from the database
    // Only need id, user_id, and filter_applied fields
    const [rows] = await pool.query('SELECT id, user_id, filter_applied FROM live_streamings WHERE id = ?', [liveId]);
    const live = rows[0];
    if (!live) {
      // No live stream found for this ID
      // TODO: Convert createErrorResponse(404, 'Live stream not found') to res.status(404).json({ error: 'Live stream not found' })
      return res.status(404).json(createErrorResponse(404, 'Live stream not found'));
    }

    // Step 4: (Optional) Restrict filter info to creator only
    // if (live.user_id !== userId) {
    //   return createErrorResponse(403, 'Not authorized to view this live filter');
    // }

    // Step 5: Return the filter list and the current filter (default to 'normal' if not set)
    // TODO: Convert createSuccessResponse('Live filters fetched', { ... }) to res.json({ success: true, message: 'Live filters fetched', data: { ... } })
    return res.json({
      success: true,
      message: 'Live filters fetched',
      data: {
        filters: FILTERS,
        current_filter: live.filter_applied || 'normal',
      }
    });
  } catch (error) {
    // Log and return a generic error response
    logError('getLiveFilterHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to fetch live filters', error.message) to res.status(500).json({ error: 'Failed to fetch live filters', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch live filters'));
  }
};

/**
 * Handler to apply live filter (POST /live/filter)
 */
/**
 * POST /live/filter handler
 *
 * Allows the creator of a live stream to apply a new video filter.
 *
 * Business rules:
 *   - Requires user authentication (JWT Bearer token in headers).
 *   - Requires a JSON body with:
 *       - c: encrypted live stream ID
 *       - filter: filter key (must be in FILTERS)
 *   - Only the creator of the live stream can update the filter.
 *   - All changes are performed in a DB transaction for safety.
 *   - Returns 400 for missing/invalid input, 403 for unauthorized, 404 for not found.
 *   - Returns 200 with success: true if the filter is applied.
 *
 * @param {object} req - Express request object
 * @returns {object} API response with { success: true } on success
 */
export const postLiveFilter = async (req, res) => {
  let conn;
  try {
    // Step 1: Authenticate the user
    // TODO: Convert getAuthenticatedUserId(event, { action: 'access' }) to getAuthenticatedUserId(req, { action: 'access' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'access' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Step 2: Parse and validate the request body
    let data;
    try {
      // TODO: Convert JSON.parse(event.body || '{}') to JSON.parse(req.body || '{}')
      data = JSON.parse(req.body || '{}');
    } catch {
      // Malformed JSON
      // TODO: Convert createErrorResponse(400, 'Invalid JSON body') to res.status(400).json({ error: 'Invalid JSON body' })
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON body'));
    }
    const { c: encryptedLiveId, filter } = data;
    if (!encryptedLiveId) {
      // Client did not provide the required parameter
      // TODO: Convert createErrorResponse(400, 'Missing live id parameter') to res.status(400).json({ error: 'Missing live id parameter' })
      return res.status(400).json(createErrorResponse(400, 'Missing live id parameter'));
    }
    
    // Decrypt the live ID for security
    let liveId;
    try {
      liveId = safeDecryptId(encryptedLiveId);
    } catch (error) {
      logError('[postLiveFilterHandler] Failed to decrypt live ID:', { encryptedLiveId, error: error.message });
      // TODO: Convert createErrorResponse(400, 'Invalid live id format') to res.status(400).json({ error: 'Invalid live id format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid live id format'));
    }
    
    // Sanitize filter: must be a valid key, else set to 'none'
    const filterKey = typeof filter === 'string' && FILTERS.hasOwnProperty(filter) ? filter : 'none';

    // Step 3: Start a DB transaction for atomicity
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Step 4: Fetch the live stream and check ownership
    const [rows] = await conn.query('SELECT id, user_id FROM live_streamings WHERE id = ?', [liveId]);
    const live = rows[0];
    if (!live || live.user_id !== userId) {
      // Only the creator can update the filter
      await conn.rollback();
      conn.release();
      // TODO: Convert createErrorResponse(403, 'Not authorized to apply filter to this live') to res.status(403).json({ error: 'Not authorized to apply filter to this live' })
      return res.status(403).json(createErrorResponse(403, 'Not authorized to apply filter to this live'));
    }

    // Step 5: Update the filter_applied field
    await conn.query('UPDATE live_streamings SET filter_applied = ? WHERE id = ?', [filterKey, liveId]);
    await conn.commit();
    conn.release();
    // TODO: Convert createSuccessResponse('Live filter applied', { success: true }) to res.json({ success: true, message: 'Live filter applied', data: { success: true } })
    return res.json({
      success: true,
      message: 'Live filter applied',
      data: { success: true }
    });
  } catch (error) {
    // Rollback transaction and log error if anything fails
    if (conn) {
      await conn.rollback();
      conn.release();
    }
    logError('postLiveFilterHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to apply live filter', error.message) to res.status(500).json({ error: 'Failed to apply live filter', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Failed to apply live filter'));
  }
};

/**
 * Handler to edit tipmenu (PUT /live/edit/tipmenu)
 */
export const putLiveEditTipmenu = async (req, res) => {
  try {
    const userId = req.userId;
    const { c: encryptedLiveId, activity, coins } = req.body;

    // Decrypt the live ID for security
    let liveId;
    try {
      liveId = safeDecryptId(encryptedLiveId);
    } catch (error) {
      logError('[putLiveEditTipmenu] Failed to decrypt live ID:', { encryptedLiveId, error: error.message });
      return res.status(400).json(createErrorResponse(400, 'Invalid live id format'));
    }
    if (!liveId) {
      return res.status(400).json(createErrorResponse(400, 'Invalid or missing live id'));
    }

    // Fetch live stream and check ownership
    const live = await getLiveStreamings(liveId);
    if (!live) {
      return res.status(404).json(createErrorResponse(404, 'Live stream not found'));
    }
    if (live.user_id !== userId) {
      return res.status(403).json(createErrorResponse(403, 'You are not authorized to edit this live tipping menu'));
    }

    // Fetch min/max tipmenu coins from admin settings
    const adminSettings = await getAdminSettings();
    const min_tipmenu = Number(adminSettings.min_tipmenu_coins) || 1;
    const max_tipmenu = Number(adminSettings.max_tipmenu_coins) || 1000000;

    // Validate activities and coins if they are provided
    if (activity && coins) {
      const errors = {};
      if (!Array.isArray(activity) || !Array.isArray(coins)) {
        errors.activity = 'Activity and coins must be arrays';
      } else {
        for (let i = 0; i < activity.length; i++) {
          const activityName = activity[i];
          const coinValue = Number(coins[i]);
          if (!activityName) errors[`activity_${i}`] = 'Activity name is required';
          if (coinValue < min_tipmenu || coinValue > max_tipmenu)
            errors[`coins_${i}`] = `Amount should be between ${min_tipmenu} and ${max_tipmenu} coins`;
        }
      }
      if (Object.keys(errors).length > 0) {
        return res.status(422).json(createErrorResponse(422, 'Validation failed', errors));
      }
    }

    // Begin DB transaction
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      
      // First, completely delete all existing tipmenu records for this live stream
      logInfo('[putLiveEditTipmenu] Completely deleting all existing tipmenu records for live:', { liveId });
      await conn.query('DELETE FROM live_tipping_menus WHERE live_streamings_id=?', [liveId]);
      
      // Then, create new tipping menu items from incoming data
      if (Array.isArray(activity) && activity.length > 0) {
        for (let i = 0; i < activity.length; i++) {
          const activityName = activity[i];
          const coinValue = Number(coins[i]);
          
          // Log insert operation
          logInfo('[putLiveEditTipmenu] Inserting new tipmenu:', { liveId, activity: activityName, coins: coinValue });
          await conn.query(
            'INSERT INTO live_tipping_menus (live_streamings_id, activity_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [liveId, activityName, coinValue, '1', new Date().toISOString().slice(0, 19).replace('T', ' '), new Date().toISOString().slice(0, 19).replace('T', ' ')]
          );
        }
      }
      
      // Fetch updated tipping menu (active only)
      const [tippingMenus] = await conn.query(
        'SELECT id, activity_name, coins FROM live_tipping_menus WHERE live_streamings_id = ? AND active = ?',
        [liveId, '1']
      );
      const plainMenus = tippingMenus.map(menu => ({ ...menu, id: encryptId(menu.id) }));
      await conn.commit();
      conn.release();
      return res.status(200).json(createSuccessResponse('Tipping menu updated', { data: plainMenus, c: encryptId(liveId) }));
    } catch (error) {
      await conn.rollback();
      conn.release();
      logError('[putLiveEditTipmenu] Error:', error);
      return res.status(500).json(createErrorResponse(500, 'Failed to update tipping menu', error.message));
    }
  } catch (error) {
    logError('putLiveEditTipmenu error:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update tipping menu', error.message));
  }
};

/**
 * Fetch a goal by its id.
 */
const fetchGoalById = async (conn, goalId) => {
  const [rows] = await conn.query(
    'SELECT id, live_streamings_id as live_id, goal_name, coins, active FROM live_goals WHERE id=?',
    [goalId]
  );
  return rows[0] || null;
};

/**
 * Fetch all active goals for a given live stream.
 */
const fetchActiveGoals = async (conn, liveId) => {
  const [rows] = await conn.query(
    'SELECT id, live_streamings_id as live_id, goal_name, coins, active FROM live_goals WHERE live_streamings_id=? AND active="1"',
    [liveId]
  );
  return rows;
};

/**
 * Check if a goal already exists for the given live stream.
 */
const checkExistingGoal = async (conn, liveId) => {
  const [rows] = await conn.query(
    'SELECT id, live_streamings_id as live_id, goal_name, coins, active FROM live_goals WHERE live_streamings_id=?',
    [liveId]
  );
  return rows[0] || null;
};

/**
 * Handler to manage live goals (POST /live/goal)
 */
export const postLiveGoal = async (req, res) => {
  try {
    const userId = req.userId;
    const data = req.body;

    // Check user verification
    const user = await getUserById(userId);
    if (!user) return res.status(404).json(createErrorResponse(404, 'User not found'));
    if (user.verified_id !== 'yes') return res.status(403).json(createErrorResponse(403, 'User must be verified to manage goals'));

    // Validate input fields
    const errors = {};
    if (!data.live_id) errors.live_id = 'live_id is required';
    
    // Check if goal_name and coins are provided together (both must be present or both must be empty)
    const hasGoalName = data.goal_name && data.goal_name.trim() !== '';
    const hasCoins = data.coins !== undefined && data.coins !== null && data.coins !== '' && data.coins !== 0;
    
    // Allow both to be empty (for deactivating goals), but require both if either is provided
    if ((hasGoalName && !hasCoins) || (!hasGoalName && hasCoins)) {
      errors.goal = 'Both goal_name and coins are required together';
    }
    
    if (Object.keys(errors).length > 0) {
      return res.status(422).json(createErrorResponse(422, 'Validation failed', errors));
    }

    const liveId = data.live_id;
    if (!liveId) return res.status(400).json(createErrorResponse(400, 'Invalid live_id'));

    // Decrypt the live ID for security
    let decryptedLiveId = safeDecryptId(liveId);
    if (!decryptedLiveId) {
      logError('[postLiveGoal] Invalid live ID format:', liveId);
      return res.status(400).json(createErrorResponse(400, 'Invalid live id format', {
        message: 'The provided live_id could not be decrypted. Please ensure you are using a valid encrypted ID.',
        providedId: liveId,
        expectedFormat: '24-character encrypted string'
      }));
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Check live stream ownership
      const [lives] = await conn.query('SELECT * FROM live_streamings WHERE id = ?', [decryptedLiveId]);
      const [live] = lives;
      if (!live) {
        await conn.rollback();
        conn.release();
        return res.status(404).json(createErrorResponse(404, 'Live not found'));
      }
      if (live.user_id !== userId) {
        await conn.rollback();
        conn.release();
        return res.status(403).json(createErrorResponse(403, 'You are not authorized to manage this live goal'));
      }

      // Handle goal create or update
      const hasGoalName = data.goal_name && data.goal_name.trim() !== '';
      const hasCoins = data.coins !== undefined && data.coins !== null && data.coins !== '' && data.coins !== 0;
      const hasGoalId = data.goal_id && data.goal_id !== 'string' && data.goal_id.trim() !== '';
      
      if (hasGoalName && hasCoins) {
        // Decrypt goal ID if provided (skip if it's a placeholder value or empty)
        let goalId = null;
        if (hasGoalId) {
          goalId = safeDecryptId(data.goal_id);
          if (!goalId) {
            logError('[postLiveGoal] Failed to decrypt goal ID:', data.goal_id);
            return res.status(400).json(createErrorResponse(400, 'Invalid goal id format', {
              message: 'The provided goal_id could not be decrypted. Please ensure you are using a valid encrypted ID.',
              providedId: data.goal_id,
              expectedFormat: '24-character encrypted string'
            }));
          }
        }
        
        if (goalId) {
          // Update existing goal by ID
          await conn.query(
            'UPDATE live_goals SET goal_name=?, coins=?, active="1", updated_at=NOW() WHERE id=?',
            [data.goal_name, data.coins, goalId]
          );
        } else {
          // Check if a goal already exists for this live stream
          const existingGoal = await checkExistingGoal(conn, decryptedLiveId);
          
          if (existingGoal) {
            // Get the latest (most recent) goal ID for this live stream
            const [latestGoalRows] = await conn.query(
              'SELECT id FROM live_goals WHERE live_streamings_id=? ORDER BY id DESC LIMIT 1',
              [decryptedLiveId]
            );
            
            if (latestGoalRows.length > 0) {
              const latestGoalId = latestGoalRows[0].id;
              // Update the latest goal specifically
              await conn.query(
                'UPDATE live_goals SET goal_name=?, coins=?, active="1", updated_at=NOW() WHERE id=?',
                [data.goal_name, data.coins, latestGoalId]
              );
            }
          } else {
            // Create new goal
            await conn.query(
              'INSERT INTO live_goals (live_streamings_id, goal_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, "1", NOW(), NOW())',
              [decryptedLiveId, data.goal_name, data.coins]
            );
          }
        }
      } else if (!hasGoalName && !hasCoins && !hasGoalId) {
        // Handle case where goal_id, goal_name, and coins are all empty
        // Check if a goal already exists for this live stream
        const existingGoal = await checkExistingGoal(conn, decryptedLiveId);
        
        if (existingGoal) {
          // Get the latest (most recent) goal with full data to check if it's already empty
          const [latestGoalRows] = await conn.query(
            'SELECT id, goal_name, coins FROM live_goals WHERE live_streamings_id=? ORDER BY id DESC LIMIT 1',
            [decryptedLiveId]
          );
          
          if (latestGoalRows.length > 0) {
            const latestGoal = latestGoalRows[0];
            const isLatestGoalEmpty = (!latestGoal.goal_name || latestGoal.goal_name.trim() === '') && 
                                     (latestGoal.coins === 0 || latestGoal.coins === null || latestGoal.coins === '');
            
            if (!isLatestGoalEmpty) {
              // Only deactivate and create new row if the latest goal is not already empty
              const latestGoalId = latestGoal.id;
              // Update the latest goal's active column to 0
              await conn.query(
                'UPDATE live_goals SET active="0", updated_at=NOW() WHERE id=?',
                [latestGoalId]
              );
              
              // Create new row with empty values
              await conn.query(
                'INSERT INTO live_goals (live_streamings_id, goal_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, "1", NOW(), NOW())',
                [decryptedLiveId, '', 0]
              );
            }
            // If the latest goal is already empty, do nothing (no new row created)
          }
        } else {
          // Create new goal with empty values only if no goal exists
          await conn.query(
            'INSERT INTO live_goals (live_streamings_id, goal_name, coins, active, created_at, updated_at) VALUES (?, ?, ?, "1", NOW(), NOW())',
            [decryptedLiveId, '', 0]
          );
        }
      }

      // Get all active goals for this live
      const activeGoals = await fetchActiveGoals(conn, decryptedLiveId);

      await conn.commit();
      conn.release();

      // Sync to DynamoDB if goal data is provided
      if (data.goal_name && data.coins) {
        try {
          await upsertLiveGoalDynamo({
            goal_id: 0, // Will be updated by DynamoDB logic
            live_id: Number(decryptedLiveId),
            goal_name: data.goal_name,
            coins: Number(data.coins),
            tips_received: 0
          });
        } catch (error) {
          logError('[postLiveGoal] Failed to sync to DynamoDB:', error);
          // Continue without failing the request
        }
      }

      // Encrypt IDs and clean up response data
      const encryptedActiveGoals = activeGoals.map(goal => ({
        id: encryptId(goal.id),
        live_id: encryptId(goal.live_id),
        goal_name: goal.goal_name,
        coins: goal.coins
      }));

      return res.status(200).json(createSuccessResponse('Goal Updated successfully', { 
        live: encryptedActiveGoals
      }));
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      await conn.rollback();
      conn.release();
      logError('Failed to update live goal', error);
      return res.status(500).json(createErrorResponse(500, 'Failed to update live goal', error.message));
    }
  } catch (error) {
    logError('postLiveGoal error:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update live goal', error.message));
  }
};

/**
 * Handler to provide all live details and Agora token for a given liveId (GET /live/go/:liveId)
 */
/**
 * Handler to provide all live details and Agora token for a given liveId.
 *
 * Route: /live/go/{liveId}
 * Returns: Agora token, earnings (total, bookings, tip), goal, tipmenu, viewers count.
 * Only returns details if current time is within 5 minutes before or after the live's scheduled time.
 *
 * @param {object} req - Express request object
 * @returns {object} API response with live details or error
 */
export const getLiveGo = async (req, res) => {
  // Authenticate user and check permissions
  // TODO: Convert getAuthenticatedUserId(event, { action: 'access' }) to getAuthenticatedUserId(req, { action: 'access' })
  const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'access' });
  if (errorResponse) {
    // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
    return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
  }

  // Get live ID from path and decrypt it
  // TODO: Convert event.pathParameters && event.pathParameters.liveId to req.params && req.params.liveId
  const encryptedLiveId = req.params && req.params.liveId;
  if (!encryptedLiveId) {
    // TODO: Convert createErrorResponse(400, 'Live id is required in path') to res.status(400).json({ error: 'Live id is required in path' })
    return res.status(400).json(createErrorResponse(400, 'Live id is required in path'));
  }

  // Decrypt the live ID from path parameter for security
  let liveId;
  try {
    liveId = safeDecryptId(encryptedLiveId);
  } catch (error) {
    logError('[liveGoDetailsHandler] Failed to decrypt live ID:', { encryptedLiveId, error: error.message });
    // TODO: Convert createErrorResponse(400, 'Invalid live id format') to res.status(400).json({ error: 'Invalid live id format' })
    return res.status(400).json(createErrorResponse(400, 'Invalid live id format'));
  }

  // Fetch user and verify
  const user = await getUserById(userId);
  if (!user) {
    // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
    return res.status(404).json(createErrorResponse(404, 'User not found'));
  }
  if (user.verified_id !== 'yes') {
    // TODO: Convert createErrorResponse(403, 'User must be verified to access creator settings') to res.status(403).json({ error: 'User must be verified to access creator settings' })
    return res.status(403).json(createErrorResponse(403, 'User must be verified to access creator settings'));
  }

  // Fetch live details and verify
  const live = await getLiveStreamings(liveId);
  if (!live) {
    // TODO: Convert createErrorResponse(404, 'Live not found') to res.status(404).json({ error: 'Live not found' })
    return res.status(404).json(createErrorResponse(404, 'Live not found'));
  }
  if (live.status !== '0') {
    // TODO: Convert createErrorResponse(400, 'Live already closed') to res.status(400).json({ error: 'Live already closed' })
    return res.status(400).json(createErrorResponse(400, 'Live already closed'));
  }
  if (live.user_id !== user.id) {
    // TODO: Convert createErrorResponse(403, 'You are not authorized to access this live') to res.status(403).json({ error: 'You are not authorized to access this live' })
    return res.status(403).json(createErrorResponse(403, 'You are not authorized to access this live'));
  }

  // Update creator_joined to 1 if creator is joining their own live and hasn't joined yet
  if (live.creator_joined === 0 && live.user_id === user.id) {
    try {
      await updateCreatorJoined(liveId);
      logInfo('[liveGoDetailsHandler] Creator joined live stream', { liveId, userId: user.id });
    } catch (error) {
      logError('[liveGoDetailsHandler] Failed to update creator_joined:', error);
      // Continue execution even if update fails
    }
  }

  // Check if current time is within 5 minutes BEFORE the live's scheduled time
  const now = dayjs.utc ? dayjs.utc() : dayjs();
  const liveTime = dayjs(live.date_time);
  const diffMinutes = liveTime.diff(now, 'minute');
  // Todo: enable this later
  // if (diffMinutes >= 5) {
  //   return createErrorResponse(403, 'Live details are only available within 5 minutes before the live starts');
  // }

  try {
    // Fetch admin settings for Agora
    const adminSettings = await getAdminSettings();
    const { agora_app_id: agoraAppId, agora_app_certificate: agoraAppCertificate } = adminSettings;
    const { channel: agoraChannel, duration: liveDuration, user_id } = live;
    // Generate random UID and determine role
    const uid = Math.floor(Math.random() * 10000);
    const role = (user_id === user.id) ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const expireTimeInSeconds = ((live.duration || 0) + 60) * 60 * 24;
    const token = RtcTokenBuilder.buildTokenWithUid( agoraAppId, agoraAppCertificate, agoraChannel, uid, role, expireTimeInSeconds );

    // Fetch all live-related data using utility functions
    const totalEarnings = await getLiveTotalEarnings(liveId);
    const bookings = await getLiveBookingsCount(liveId);
    const tip = await getLiveTipEarnings(liveId);
    const goal = await getActiveLiveGoal(liveId);
    const tipmenu = await getActiveLiveTippingMenus(liveId);
    const viewersCount = await getLiveViewersCount(liveId);

    // Process goal and create DynamoDB record if needed
    let finalGoal = goal;
    if (goal && goal.name && goal.price) {
      const dynamoGoal = await upsertLiveGoalDynamo({
        goal_id: goal.goal_id,
        live_id: liveId,
        goal_name: goal.name,
        coins: goal.price
      });
      
      if (dynamoGoal) {
        const { goal_name, coins, ...rest } = dynamoGoal;
        finalGoal = {
          ...rest,
          name: goal_name,
          price: coins
        };
        logInfo('[liveGoDetailsHandler] DynamoDB goal processed', { goalId: goal.goal_id });
      }
    }

    // Encrypt goal IDs if goal exists
    if (finalGoal) {
      try {
        finalGoal.goal_id = encryptId(finalGoal.goal_id);
        // Use the original encrypted liveId instead of encrypting the numeric live_id again
        // This ensures consistency between input and output
        finalGoal.live_id = encryptedLiveId;
      } catch (error) {
        logError('[liveGoDetailsHandler] Failed to encrypt goal IDs:', { 
          goalId: finalGoal.goal_id, 
          liveId: finalGoal.live_id, 
          error: error.message 
        });
      }
    }

    // Encrypt tipmenu IDs
    const encryptedTipmenu = tipmenu.map(item => {
      try {
        return {
          ...item,
          id: encryptId(item.id)
        };
      } catch (error) {
        logError('[liveGoDetailsHandler] Failed to encrypt tipmenu ID:', { 
          originalId: item.id, 
          error: error.message 
        });
        // Return item without encryption if it fails
        return item;
      }
    });

    // Return all details including Agora token with encrypted IDs
    // TODO: Convert createSuccessResponse('Live details fetched', { ... }) to res.json({ success: true, message: 'Live details fetched', data: { ... } })
    return res.json({
      success: true,
      message: 'Live details fetched',
      data: {
        agoraAppId,
        agoraChannel,
        token,
        uid,
        liveDuration,
        earnings: {
          total: totalEarnings,
          bookings,
          tip
        },
        goal: finalGoal,
        tipmenu: encryptedTipmenu,
        viewersCount
      }
    });
  } catch (error) {
    logError('[liveGoDetailsHandler] Error:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to fetch live details', error.message) to res.status(500).json({ error: 'Failed to fetch live details', details: error.message })
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch live details'));
  }
};
