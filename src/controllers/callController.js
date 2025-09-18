/**
 * @file callController.js
 * @description Call controller for Bingeme API Express.js
 * Handles video call related operations including Agora configuration
 */

import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  getAdminSettings 
} from '../utils/common.js';
import { RtcTokenBuilder, Role } from '../agora/RtcTokenBuilder2.js';

/**
 * Validate if user has access to the specified room_id
 * 
 * Checks if the provided userId has permission to access the room_id by verifying
 * that the user is either the caller or creator in an active video call session.
 * 
 * @param {string} roomId - The room ID to validate access for
 * @param {number} userId - The user ID to validate access for
 * @returns {Promise<{hasAccess: boolean, error?: string, callData?: object}>}
 */
const validateRoomAccess = async (roomId, userId) => {
  try {
    logInfo('Validating room access', { roomId, userId });

    const pool = getDB();
    // Check if there's an active video call session for this room_id
    const [callRows] = await pool.query(
      `SELECT id, user_id, creator_id, status, started_at, ended_at
       FROM video_call 
       WHERE room_id = ? AND status IN (0, 1) 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [roomId]
    );

    if (callRows.length === 0) {
      logError('No active video call found for room_id', { roomId });
      return { hasAccess: false, error: 'No active video call found for this room' };
    }

    const callData = callRows[0];
    
    // Check if the user is either the caller (user_id) or creator (creator_id)
    if (callData.user_id !== parseInt(userId) && callData.creator_id !== parseInt(userId)) {
      logError('User not authorized for this room', { 
        roomId, 
        userId, 
        callUserId: callData.user_id, 
        callCreatorId: callData.creator_id 
      });
      return { hasAccess: false, error: 'Unauthorized access to this room' };
    }

    // Check if the call is in a valid state (calling or answered)
    if (callData.status !== 0 && callData.status !== 1) {
      logError('Video call is not in active state', { roomId, status: callData.status });
      return { hasAccess: false, error: 'Video call is not active' };
    }

    logInfo('Room access validated successfully', { roomId, userId, callId: callData.id });
    return { hasAccess: true, callData };

  } catch (error) {
    logError('validateRoomAccess error:', error);
    return { hasAccess: false, error: 'Failed to validate room access' };
  }
};

/**
 * GET Handler: Fetch Agora app details including configuration with token.
 * - Returns Agora app details with app ID, generated token, and uid.
 * - Used by socket services and other components that need Agora credentials.
 * 
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getAgoraDetails = async (req, res) => {
  try {
    logInfo('Fetching Agora app details for video call configuration');

    // Extract room_id and userId from event parameters
    // TODO: Convert event.queryStringParameters?.room_id || event.body?.room_id to req.query?.room_id || req.body?.room_id
    const roomId = req.query?.room_id || req.body?.room_id;
    // TODO: Convert event.queryStringParameters?.user_id || event.body?.user_id to req.query?.user_id || req.body?.user_id
    const userId = req.query?.user_id || req.body?.user_id;
    const uid = Math.floor(Math.random() * 10000);

    // Validate that we have the required parameters
    if (!roomId) {
      logError('Missing required parameters', { roomId });
      // TODO: Convert createErrorResponse(400, 'Missing required parameters: room_id are required') to res.status(400).json({ error: 'Missing required parameters: room_id are required' })
      return res.status(400).json({ error: 'Missing required parameters: room_id are required' });
    }
    if (!userId) {
      logError('Missing required parameters', { userId });
      // TODO: Convert createErrorResponse(400, 'Missing required parameters: userId are required') to res.status(400).json({ error: 'Missing required parameters: userId are required' })
      return res.status(400).json({ error: 'Missing required parameters: userId are required' });
    }

    // Validate that the user has access to this room_id
    const roomAccessValidation = await validateRoomAccess(roomId, userId);
    if (!roomAccessValidation.hasAccess) {
      logError('Room access validation failed', { 
        roomId, 
        userId, 
        error: roomAccessValidation.error 
      });
      // TODO: Convert createErrorResponse(403, roomAccessValidation.error) to res.status(403).json({ error: roomAccessValidation.error })
      return res.status(403).json({ error: roomAccessValidation.error });
    }

    // Fetch admin settings from database
    const adminSettings = await getAdminSettings();
    
    if (!adminSettings || Object.keys(adminSettings).length === 0) {
      logError('Admin settings not found in database');
      // TODO: Convert createErrorResponse(404, 'Admin settings not found') to res.status(404).json({ error: 'Admin settings not found' })
      return res.status(404).json({ error: 'Admin settings not found' });
    }

    // Extract Agora-related settings
    const { agora_app_id: agoraAppId, agora_app_certificate: agoraAppCertificate } = adminSettings;

    // Validate that we have the required Agora credentials
    if (!agoraAppId || !agoraAppCertificate) {
      logError('Agora credentials not found in admin settings', { 
        hasAppId: !!agoraAppId, 
        hasCertificate: !!agoraAppCertificate 
      });
      // TODO: Convert createErrorResponse(500, 'Agora configuration not available') to res.status(500).json({ error: 'Agora configuration not available' })
      return res.status(500).json({ error: 'Agora configuration not available' });
    }

    // Generate Agora token similar to CallController.php
    const currentUtcTimestamp = Math.floor(Date.now() / 1000);
    const tokenExpirationTime = currentUtcTimestamp + 216000; // 60 hours
    const publisherRole = Role.PUBLISHER; // Use the Role constant from RtcTokenBuilder2
    
    // Generate the token using the parameters from the request
    const agoraToken = RtcTokenBuilder.buildTokenWithUid(
      agoraAppId,
      agoraAppCertificate,
      roomId, // Use room_id from request
      uid, //
      publisherRole,
      tokenExpirationTime
    );

    logInfo('Successfully generated Agora token and fetched app details', { roomId, uid });

    // Return Agora app details with configuration and token
    // TODO: Convert createSuccessResponse('Agora app details retrieved successfully', { agoraAppCertificate, agoraAppId, token: agoraToken, uid, }) to res.json({ success: true, message: 'Agora app details retrieved successfully', data: { agoraAppCertificate, agoraAppId, token: agoraToken, uid, } })
    return res.json({
      success: true,
      message: 'Agora app details retrieved successfully',
      data: {
        agoraAppCertificate,
        agoraAppId,
        token: agoraToken,
        uid,
      }
    });

  } catch (error) {
    logError('Error fetching Agora app details or generating token:', error);
    // TODO: Convert createErrorResponse(500, 'Failed to fetch Agora app details or generate token', error.message) to res.status(500).json({ error: 'Failed to fetch Agora app details or generate token' })
    return res.status(500).json({ error: 'Failed to fetch Agora app details or generate token' });
  }
};
