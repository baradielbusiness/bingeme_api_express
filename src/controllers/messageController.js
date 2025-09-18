/**
 * @file messageController.js
 * @description Express.js Message Controllers
 * 
 * This module provides message functionality including:
 * - Conversation management
 * - Message sending and retrieval
 * - Message deletion
 * - Media upload handling
 * - Massive message broadcasting
 * 
 * Database Tables: messages, media_messages, conversations, users, notifications
 */

import { 
  getAuthenticatedUserId, 
  createErrorResponse, 
  createSuccessResponse, 
  logInfo, 
  logError, 
  getSupportCreatorIds, 
  getUserById, 
  getFile, 
  formatRelativeTime,
  convertExpiresAtToTimestamp
} from '../utils/common.js';
import { 
  getUserInboxWithMedia, 
  createApiResponse, 
  fetchUsersMap,
  getMessageAndConversationIds,
  markMediaMessagesDeleted,
  markMessagesDeleted,
  markConversationsInactive,
  removeUserNotifications,
  searchConversations
} from '../utils/conversation.js';
import { 
  getUserMessagesById, 
  getUserMessagesByUsername, 
  formatMessagesByDate, 
  validateUserAccess, 
  validateUserByUsername,
  getMessageById as getMessageByIdUtil,
  markMessageDeleted,
  markMediaMessagesDeleted as markMediaMessagesDeletedUtil,
  removeMessageNotifications,
  countActiveMessages,
  countActiveMessagesOnDay,
  getConversationById,
  setConversationInactive,
  updateConversationTimestamp,
  getLatestMessageTime,
  getMessageByIdWithDetails
} from '../utils/messages.js';
import { 
  saveMessageMedia, 
  saveMessage, 
  deleteMessage as deleteMessageUtil 
} from '../utils/send_message.js';
import { 
  processMediaFiles, 
  cleanupS3Files 
} from '../utils/mediaProcessing.js';
import { 
  validateMessageMediaInput,
  validateMassiveMessageInput
} from '../utils/validations.js';
import { validateConversationSearchRequest } from '../validate/conversation_search.js';
import { validateMessagesInboxRequest } from '../validate/messages.js';
import { 
  findOrCreateConversation 
} from '../utils/conversation.js';
import { 
  processUploadRequest 
} from '../utils/uploadUtils.js';
import { pool } from '../config/database.js';

/**
 * Get support user configuration based on user verification status
 */
const getSupportConfiguration = async (user) => {
  if (!user) {
    logError('getSupportConfiguration: user parameter is null or undefined');
    return {
      supportId: 1,
      supportAvatar: "default.webp",
      supportName: "Support",
      supportUsername: "support"
    };
  }
  
  const { verified_id = 'no' } = user;
  const defaultConfig = {
    supportId: 1,
    supportAvatar: "default.webp",
    supportName: "Support",
    supportUsername: "support"
  };
  
  if (verified_id !== 'yes') return defaultConfig;
  
  try {
    const supportCreatorIds = await getSupportCreatorIds();
    if (supportCreatorIds?.length > 0) {
      const supportId = supportCreatorIds[0] || 1;
      
      if (supportId && supportId !== 1) {
        try {
          const supportUser = await getUserById(supportId);
          if (supportUser) {
            const { name, username, avatar } = supportUser;
            return {
              supportId: Number(supportId),
              supportName: name || "Support",
              supportUsername: username || "support",
              supportAvatar: avatar || "default.webp"
            };
          }
        } catch (userError) {
          logError('Error fetching support user details:', userError);
        }
      }
    } else {
      try {
        const [verifiedCreators] = await pool.query(
          'SELECT id, name, avatar, username FROM users WHERE verified_id = "yes" AND status = "active" LIMIT 1'
        );
        
        if (verifiedCreators.length > 0) {
          const { id, name, avatar, username } = verifiedCreators[0];
          return {
            supportId: Number(id),
            supportAvatar: avatar || "default.webp",
            supportName: name || "Support",
            supportUsername: username || "support"
          };
        }
      } catch (error) {
        logError('Error finding fallback support creator:', error);
      }
    }
  } catch (error) {
    logError('Error in getSupportConfiguration for verified user:', error);
  }
  
  return defaultConfig;
};

/**
 * Create default support message object for new users
 */
const createDefaultSupportMessage = (supportConfig, userId) => {
  const { supportId, supportAvatar, supportName, supportUsername } = supportConfig;
  const supportIdInt = parseInt(supportId) || 1;
  
  const avatarUrl = getFile(`avatar/${supportAvatar}`);
  
  return {
    id: 0,
    message: "Welcome! How can we help you today?",
    time: formatRelativeTime(new Date()),
    status: "new",
    tip: false,
    media: null,
    unread_count: 0,
    msg_type: "incoming",
    chat_user: {
      id: supportIdInt,
      name: supportName,
      username: supportUsername,
      avatar: avatarUrl,
      room_id: ''
    }
  };
};

/**
 * Format message row for frontend consumption
 */
const formatMessageRow = (row, userId, usersMap, conversationRoomMap) => {
  const { id, from_user_id, to_user_id, message, created_at, status, tip, media, count, conversations_id } = row;
  
  const currentUserId = parseInt(userId);
  const fromUserId = parseInt(from_user_id);
  const toUserId = parseInt(to_user_id);
  
  const otherUserId = fromUserId === currentUserId ? toUserId : fromUserId;
  const { name = 'Unknown User', username = 'unknown', avatar = 'default.webp' } = usersMap[otherUserId] || {};
  
  const msg_type = fromUserId === currentUserId ? 'outgoing' : 'incoming';
  
  let mediaType = null;
  if (media) {
    const mediaTypes = media.split(',').map(type => type.trim());
    mediaType = mediaTypes[mediaTypes.length - 1];
  }
  
  const isTip = tip === 'yes';
  const avatarUrl = getFile(`avatar/${avatar}`);
  const room_id = conversationRoomMap[conversations_id] || '';
  
  return {
    id,
    message,
    time: formatRelativeTime(created_at),
    status,
    tip: isTip,
    media: mediaType,
    unread_count: parseInt(count) || 0,
    msg_type,
    chat_user: {
      id: otherUserId,
      name,
      username,
      avatar: avatarUrl,
      room_id: room_id
    }
  };
};

/**
 * Check if support user exists in conversation rows and find its position
 */
const checkSupportUserPresence = (rows, supportId) => {
  if (!rows.length) return { supportUserIdExistsInFirst: false, supportIndex: null };
  
  const firstConversation = rows[0];
  const { from_user_id: firstFromId, to_user_id: firstToId } = firstConversation;
  
  const supportIdInt = parseInt(supportId);
  
  const supportUserIdExistsInFirst = parseInt(firstFromId) === supportIdInt || parseInt(firstToId) === supportIdInt;
  
  const supportIndex = rows.findIndex(row => {
    const { from_user_id, to_user_id } = row;
    return parseInt(from_user_id) === supportIdInt || parseInt(to_user_id) === supportIdInt;
  });
  
  return { 
    supportUserIdExistsInFirst, 
    supportIndex: supportIndex !== -1 ? supportIndex : null 
  };
};

/**
 * Position support conversation at the top of the inbox
 */
const positionSupportConversation = (formattedMessagesInbox, supportIndex, defaultSupportMessage) => {
  if (supportIndex !== null) {
    if (supportIndex > 0) {
      const supportMessage = formattedMessagesInbox[supportIndex];
      formattedMessagesInbox.splice(supportIndex, 1);
      formattedMessagesInbox.unshift(supportMessage);
    }
  } else {
    formattedMessagesInbox.unshift(defaultSupportMessage);
  }
  
  return formattedMessagesInbox;
};

/**
 * GET /messages/conversation - Get authenticated user's inbox messages with support integration
 * Exact implementation matching Lambda getUserMessagesHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with formatted messages and pagination
 */
export const getConversation = async (req, res) => {
  try {
    // TODO: Convert getAuthenticatedUserId(event, { action: 'conversation getUserMessagesHandler' }) to getAuthenticatedUserId(req, { action: 'conversation getUserMessagesHandler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { action: 'conversation getUserMessagesHandler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }
    
    logInfo('My messages request received', { userId });
    
    // TODO: Convert event.queryStringParameters to req.query
    const { queryStringParameters = {} } = req; // Extract pagination parameters
    const { skip: skipRaw = '0', limit: limitRaw = '10' } = queryStringParameters;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 10;
    
    const user = await getUserById(userId); // Fetch user info for verification status
    if (!user) {
      // TODO: Convert createErrorResponse(404, 'User not found') to res.status(404).json({ error: 'User not found' })
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    
    let supportConfig; // Get support configuration
    try {
      supportConfig = await getSupportConfiguration(user);
    } catch (error) {
      logError('Error getting support configuration:', error);
      supportConfig = { supportId: 1, supportAvatar: "default.webp", supportName: "Support", supportUsername: "support" };
    }
    
    const { supportId } = supportConfig;
    const defaultSupportMessage = createDefaultSupportMessage(supportConfig, userId);
    
    const { messages: rows, totalMessages, conversationRoomMap } = await getUserInboxWithMedia(userId, skip, limit); // Fetch messages
    
    // Ensure all user IDs are integers for consistent processing
    const userIds = [...new Set(rows.flatMap(({ from_user_id, to_user_id }) => [
      parseInt(from_user_id), 
      parseInt(to_user_id)
    ]))]; // Get unique user IDs
    const usersMap = await fetchUsersMap(userIds);
    
    const { supportIndex } = checkSupportUserPresence(rows, supportId); // Check support presence
    
    const formattedMessagesInbox = rows.map(row => formatMessageRow(row, userId, usersMap, conversationRoomMap)); // Format messages
    
    const finalMessagesInbox = positionSupportConversation(formattedMessagesInbox, supportIndex, defaultSupportMessage);
    
    logInfo('Messages retrieved successfully', { userId, totalMessages, returnedCount: finalMessagesInbox.length });
    
    const hasMore = skip + limit < totalMessages; // Build pagination info
    const nextUrl = hasMore ? `messages/conversation?skip=${skip + limit}&limit=${limit}` : '';
    
    // TODO: Convert createApiResponse(200, 'Messages retrieved successfully', { messagesInbox: finalMessagesInbox, pagination: { total: totalMessages, next: nextUrl } }) to res.status(200).json(createApiResponse(200, 'Messages retrieved successfully', { messagesInbox: finalMessagesInbox, pagination: { total: totalMessages, next: nextUrl } }))
    return res.status(200).json(createSuccessResponse('Messages retrieved successfully', {
      messagesInbox: finalMessagesInbox,
      pagination: { total: totalMessages, next: nextUrl }
    }));
  } catch (error) {
    logError('getUserMessagesHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /messages/conversation/search - Search conversations by username or name
 * Exact implementation matching Lambda searchConversationHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with search results or error details
 */
export const getConversationSearch = async (req, res) => {
  try {
    logInfo('searchConversationHandler: Request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.queryStringParameters to req.query
      queryParams: req.query 
    });

    // Step 1: Authenticate user
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'conversation search searchConversationHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'conversation search searchConversationHandler' })
    const { userId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'conversation search searchConversationHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('searchConversationHandler: User authenticated', { userId });

    // Step 2: Validate search parameters
    // TODO: Convert validateConversationSearchRequest(event) to validateConversationSearchRequest(req)
    const validation = validateConversationSearchRequest(req);
    if (!validation.valid) {
      logError('searchConversationHandler: Validation failed', { error: validation.error });
      // TODO: Convert createErrorResponse(400, validation.error) to res.status(400).json({ error: validation.error })
      return res.status(400).json(createErrorResponse(400, validation.error));
    }

    const { searchTerm } = validation.data;
    logInfo('searchConversationHandler: Search parameters validated', { searchTerm });

    // Step 3: Execute conversation search
    const messages = await searchConversations(userId, searchTerm);
    
    logInfo('searchConversationHandler: Search completed', { 
      userId, 
      searchTerm, 
      resultCount: messages.length 
    });

    // Step 4: Build and return response
    // TODO: Convert createApiResponse(200, 'Messages retrieved successfully', { messagesInbox: messages }) to res.status(200).json(createApiResponse(200, 'Messages retrieved successfully', { messagesInbox: messages }))
    return res.status(200).json(createSuccessResponse('Messages retrieved successfully', {
      messagesInbox: messages
    }));

  } catch (error) {
    logError('searchConversationHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /messages/{id} and GET /messages/{id}/{username} - Retrieve conversation messages between authenticated user and another user
 * Exact implementation matching Lambda messagesInboxHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with messages or error details
 */
export const getMessagesInbox = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Messages inbox request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.pathParameters to req.params
      pathParameters: req.params 
    });

    // Validate request parameters using dedicated validation utility
    // TODO: Convert validateMessagesInboxRequest(event) to validateMessagesInboxRequest(req)
    const validation = validateMessagesInboxRequest(req);
    if (!validation.valid) {
      logError('Request validation failed', { error: validation.error });
      // TODO: Convert createErrorResponse(400, validation.error) to res.status(400).json({ error: validation.error })
      return res.status(400).json(createErrorResponse(400, validation.error));
    }

    const { userId, username } = validation.data;

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'messages inbox messagesInboxHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'messages inbox messagesInboxHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'messages inbox messagesInboxHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    // Security check: Prevent user from accessing their own messages
    // This is a business logic requirement to prevent self-conversation access
    if (authenticatedUserId === userId) {
      logError('User attempting to access own messages', { userId: authenticatedUserId });
      // TODO: Convert createErrorResponse(400, 'Cannot access messages with yourself') to res.status(400).json({ error: 'Cannot access messages with yourself' })
      return res.status(400).json(createErrorResponse(400, 'Cannot access messages with yourself'));
    }

    // Extract and validate pagination parameters from query string
    // Provides flexible pagination with reasonable defaults and limits
    // TODO: Convert event.queryStringParameters to req.query
    const { skip: skipRaw, limit: limitRaw } = req.query || {};
    const skip = parseInt(skipRaw) || 0;
    const limit = Math.min(parseInt(limitRaw) || 50, 100); // Max 100 messages per request for performance

    logInfo('Processing messages request', { 
      authenticatedUserId, 
      targetUserId: userId, 
      username, 
      skip, 
      limit 
    });

    // Initialize variables to store message data and user information
    let messages, totalCount, otherUser;

    if (username) {
      // Mode 2: URL contains both user ID and username
      // This mode provides additional validation and flexibility
      
      // First validate that the username exists in the system
      const userValidation = await validateUserByUsername(username);
      if (!userValidation.valid) {
        logError('Username validation failed', { error: userValidation.error });
        // TODO: Convert createErrorResponse(404, userValidation.error) to res.status(404).json({ error: userValidation.error })
        return res.status(404).json(createErrorResponse(404, userValidation.error));
      }

      // Security check: Ensure username belongs to the user ID provided in URL
      // This prevents URL manipulation attacks where username and user ID don't match
      if (userValidation.user.id !== userId) {
        logError('Username and user ID belong to different users', { 
          providedUserId: userId, 
          usernameUserId: userValidation.user.id,
          username: username 
        });
        // TODO: Convert createErrorResponse(400, 'Username and user ID belong to different users') to res.status(400).json({ error: 'Username and user ID belong to different users' })
        return res.status(400).json(createErrorResponse(400, 'Username and user ID belong to different users'));
      }

      // Username and user ID validation successful - proceed to retrieve messages
      logInfo('Username and user ID validation successful - same user', { 
        userId: userId,
        username: username,
        authenticatedUserId: authenticatedUserId
      });

      // Retrieve messages using username-based query
      const result = await getUserMessagesByUsername(
        authenticatedUserId, 
        username, 
        { skip, limit }
      );

      if (result.error) {
        logError('Error fetching messages by username', { error: result.error });
        // TODO: Convert createErrorResponse(404, result.error) to res.status(404).json({ error: result.error })
        return res.status(404).json(createErrorResponse(404, result.error));
      }

      messages = result.messages;
      totalCount = result.totalCount;
      otherUser = result.otherUser;
    } else {
      // Mode 1: URL contains only user ID - retrieve messages based on user ID
      // This is the simpler, more direct approach
      
      // Validate user access permissions (checks for blocked users, etc.)
      const accessValidation = await validateUserAccess(authenticatedUserId, userId);
      if (!accessValidation.hasAccess) {
        logError('User access denied', { error: accessValidation.error });
        // TODO: Convert createErrorResponse(403, accessValidation.error) to res.status(403).json({ error: accessValidation.error })
        return res.status(403).json(createErrorResponse(403, accessValidation.error));
      }

      logInfo('User access validated successfully', { 
        authenticatedUserId, 
        targetUserId: userId,
        otherUser: accessValidation.otherUser 
      });

      try {
        // Retrieve messages using user ID-based query
        const result = await getUserMessagesById(
          authenticatedUserId, 
          userId, 
          { skip, limit }
        );

        logInfo('Messages retrieved by user ID', { 
          authenticatedUserId, 
          targetUserId: userId,
          messageCount: result.messages.length,
          totalCount: result.totalCount 
        });

        messages = result.messages;
        totalCount = result.totalCount;
        otherUser = accessValidation.otherUser;
      } catch (error) {
        logError('Error fetching messages by user ID', { 
          error: error.message, 
          authenticatedUserId, 
          targetUserId: userId 
        });
        // TODO: Convert createErrorResponse(500, 'Failed to retrieve messages') to res.status(500).json({ error: 'Failed to retrieve messages' })
        return res.status(500).json(createErrorResponse(500, 'Failed to retrieve messages'));
      }
    }

    // Format messages grouped by date for better user experience
    // This provides a more intuitive conversation view
    const formattedMessagesByDate = formatMessagesByDate(messages, authenticatedUserId);

    // Calculate pagination metadata for client-side navigation
    const hasMore = (skip + limit) < totalCount;
    
    // Generate clean pagination URLs by filtering out placeholder values
    // This ensures URLs are clean and consistent across different request types
    const isValidUsername = username && 
                           username !== 'undefined' && 
                           username !== 'null' && 
                           username !== '{username}' && 
                           !(username.startsWith('{') && username.endsWith('}'));
    
    const nextUrl = hasMore ? `/messages/${userId}${isValidUsername ? `/${username}` : ''}?skip=${skip + limit}&limit=${limit}` : null;

    // Prepare comprehensive response data with date-grouped messages and pagination info
    const responseData = {
      conversations: formattedMessagesByDate,
      pagination: {
        skip,
        limit,
        total: totalCount,
        has_more: hasMore,
        next_url: nextUrl
      }
    };

    // Log successful response for monitoring and analytics
    logInfo('Messages retrieved successfully', { 
      authenticatedUserId, 
      targetUserId: userId, 
      username, 
      totalCount, 
      returnedCount: messages.length,
      dateGroups: formattedMessagesByDate.length 
    });

    // TODO: Convert createSuccessResponse('Messages retrieved successfully', responseData) to res.status(200).json(createSuccessResponse('Messages retrieved successfully', responseData))
    return res.status(200).json(createSuccessResponse('Messages retrieved successfully', responseData));

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('messagesInboxHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * DELETE /messages/delete - Delete a specific message
 * Exact implementation matching Lambda deleteMessageHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with deletion result or error details
 */
export const deleteMessage = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Delete message request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.body to req.body
      body: req.body ? Object.keys(req.body) : 'no body'
    });

    // Parse request body to extract message ID
    // TODO: Convert JSON.parse(event.body || '{}') to req.body
    const { messageId } = req.body || {};
    
    // Validate message ID parameter
    if (!messageId) {
      logError('Message ID is required');
      // TODO: Convert createErrorResponse(400, 'Message ID is required') to res.status(400).json({ error: 'Message ID is required' })
      return res.status(400).json(createErrorResponse(400, 'Message ID is required'));
    }

    // Validate message ID is a valid number
    const messageIdNum = parseInt(messageId);
    if (isNaN(messageIdNum) || messageIdNum <= 0) {
      logError('Invalid message ID format', { messageId });
      // TODO: Convert createErrorResponse(400, 'Invalid message ID format') to res.status(400).json({ error: 'Invalid message ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid message ID format'));
    }

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'message delete deleteMessageHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'message delete deleteMessageHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'message delete deleteMessageHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Processing message deletion request', { 
      authenticatedUserId, 
      messageId: messageIdNum 
    });

    try {
      // Check if message exists and user has access
      const message = await getMessageById(messageIdNum);
      
    if (!message) {
        logError('Message not found', { 
          messageId: messageIdNum, 
          authenticatedUserId 
        });
        // TODO: Convert createErrorResponse(404, 'Message not found') to res.status(404).json({ error: 'Message not found' })
      return res.status(404).json(createErrorResponse(404, 'Message not found'));
    }

      // Security check: Ensure the authenticated user is either the sender or recipient
      // This prevents users from deleting messages they're not part of
      if (message.from_user_id !== authenticatedUserId && message.to_user_id !== authenticatedUserId) {
        logError('User not authorized to delete this message', { 
          messageId: messageIdNum, 
          authenticatedUserId,
          messageFromUserId: message.from_user_id,
          messageToUserId: message.to_user_id
        });
        // TODO: Convert createErrorResponse(403, 'You are not authorized to delete this message') to res.status(403).json({ error: 'You are not authorized to delete this message' })
        return res.status(403).json(createErrorResponse(403, 'You are not authorized to delete this message'));
      }

      // Check if message is already deleted
      if (message.status === 'deleted') {
        logError('Message already deleted', { 
          messageId: messageIdNum, 
          authenticatedUserId 
        });
        // TODO: Convert createErrorResponse(400, 'Message already deleted') to res.status(400).json({ error: 'Message already deleted' })
        return res.status(400).json(createErrorResponse(400, 'Message already deleted'));
      }

      // Delete the message (soft delete by updating status)
      const deleteResult = await deleteMessageById(messageIdNum, authenticatedUserId);
      
      if (!deleteResult.success) {
        logError('Failed to delete message', { 
          messageId: messageIdNum, 
          authenticatedUserId,
          error: deleteResult.error 
        });
        // TODO: Convert createErrorResponse(500, 'Failed to delete message') to res.status(500).json({ error: 'Failed to delete message' })
        return res.status(500).json(createErrorResponse(500, 'Failed to delete message'));
      }

      logInfo('Message deleted successfully', { 
        messageId: messageIdNum,
        authenticatedUserId
      });

      // TODO: Convert createSuccessResponse('Message deleted successfully', { messageId: messageIdNum }) to res.status(200).json(createSuccessResponse('Message deleted successfully', { messageId: messageIdNum }))
      return res.status(200).json(createSuccessResponse('Message deleted successfully', {
        messageId: messageIdNum
      }));

    } catch (error) {
      logError('Error deleting message', { 
        error: error.message, 
        messageId: messageIdNum,
        authenticatedUserId 
      });
      // TODO: Convert createErrorResponse(500, 'Failed to delete message') to res.status(500).json({ error: 'Failed to delete message' })
      return res.status(500).json(createErrorResponse(500, 'Failed to delete message'));
    }

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('deleteMessageHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * DELETE /messages/conversation/delete/{id} - Delete a conversation and all its messages
 * Exact implementation matching Lambda deleteConversationHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with deletion result or error details
 */
export const deleteConversation = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Delete conversation request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.pathParameters to req.params
      pathParameters: req.params
    });

    // Extract conversation ID from path parameters
    // TODO: Convert event.pathParameters?.id to req.params?.id
    const { id } = req.params || {};
    
    // Validate conversation ID parameter
    if (!id) {
      logError('Conversation ID parameter is required');
      // TODO: Convert createErrorResponse(400, 'Conversation ID parameter is required') to res.status(400).json({ error: 'Conversation ID parameter is required' })
      return res.status(400).json(createErrorResponse(400, 'Conversation ID parameter is required'));
    }

    // Validate conversation ID is a valid number
    const conversationId = parseInt(id);
    if (isNaN(conversationId) || conversationId <= 0) {
      logError('Invalid conversation ID format', { conversationId: id });
      // TODO: Convert createErrorResponse(400, 'Invalid conversation ID format') to res.status(400).json({ error: 'Invalid conversation ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid conversation ID format'));
    }

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'conversation delete deleteConversationHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'conversation delete deleteConversationHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'conversation delete deleteConversationHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Processing conversation deletion request', { 
      authenticatedUserId, 
      conversationId 
    });

    try {
      // Check if conversation exists and user has access
      const conversation = await getConversationById(conversationId);
      
      if (!conversation) {
        logError('Conversation not found', { 
          conversationId, 
          authenticatedUserId 
        });
        // TODO: Convert createErrorResponse(404, 'Conversation not found') to res.status(404).json({ error: 'Conversation not found' })
        return res.status(404).json(createErrorResponse(404, 'Conversation not found'));
      }

      // Security check: Ensure the authenticated user is part of this conversation
      // This prevents users from deleting conversations they're not part of
      if (conversation.from_user_id !== authenticatedUserId && conversation.to_user_id !== authenticatedUserId) {
        logError('User not authorized to delete this conversation', { 
          conversationId, 
          authenticatedUserId,
          conversationFromUserId: conversation.from_user_id,
          conversationToUserId: conversation.to_user_id
        });
        // TODO: Convert createErrorResponse(403, 'You are not authorized to delete this conversation') to res.status(403).json({ error: 'You are not authorized to delete this conversation' })
        return res.status(403).json(createErrorResponse(403, 'You are not authorized to delete this conversation'));
      }

      // Delete the conversation (soft delete by updating status)
      const deleteResult = await deleteConversationById(conversationId, authenticatedUserId);
      
      if (!deleteResult.success) {
        logError('Failed to delete conversation', { 
          conversationId, 
          authenticatedUserId,
          error: deleteResult.error 
        });
        // TODO: Convert createErrorResponse(500, 'Failed to delete conversation') to res.status(500).json({ error: 'Failed to delete conversation' })
        return res.status(500).json(createErrorResponse(500, 'Failed to delete conversation'));
      }

      logInfo('Conversation deleted successfully', { 
        conversationId,
        authenticatedUserId,
        deletedMessagesCount: deleteResult.deletedMessagesCount
      });

      // TODO: Convert createSuccessResponse('Conversation deleted successfully', { conversationId, deletedMessagesCount: deleteResult.deletedMessagesCount }) to res.status(200).json(createSuccessResponse('Conversation deleted successfully', { conversationId, deletedMessagesCount: deleteResult.deletedMessagesCount }))
      return res.status(200).json(createSuccessResponse('Conversation deleted successfully', {
        conversationId,
        deletedMessagesCount: deleteResult.deletedMessagesCount
      }));

    } catch (error) {
      logError('Error deleting conversation', { 
        error: error.message, 
        conversationId,
        authenticatedUserId 
      });
      // TODO: Convert createErrorResponse(500, 'Failed to delete conversation') to res.status(500).json({ error: 'Failed to delete conversation' })
      return res.status(500).json(createErrorResponse(500, 'Failed to delete conversation'));
    }

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('deleteConversationHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /messages/upload-url - Get pre-signed upload URLs for message media
 * Exact implementation matching Lambda getMessageUploadUrlHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with upload URLs or error details
 */
export const getMessageUploadUrl = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Message upload URL request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.queryStringParameters to req.query
      queryParams: req.query
    });

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'message upload URL getMessageUploadUrlHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'message upload URL getMessageUploadUrlHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'message upload URL getMessageUploadUrlHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Processing message upload URL request', { 
      authenticatedUserId
    });

    try {
      // Generate pre-signed upload URLs for message media
      const uploadUrls = await generateMessageUploadUrls(authenticatedUserId);
      
      if (!uploadUrls || !uploadUrls.length) {
        logError('Failed to generate upload URLs', { 
          authenticatedUserId 
        });
        // TODO: Convert createErrorResponse(500, 'Failed to generate upload URLs') to res.status(500).json({ error: 'Failed to generate upload URLs' })
        return res.status(500).json(createErrorResponse(500, 'Failed to generate upload URLs'));
      }

      logInfo('Upload URLs generated successfully', { 
        authenticatedUserId,
        urlCount: uploadUrls.length
      });

      // TODO: Convert createSuccessResponse('Upload URLs generated successfully', { uploadUrls }) to res.status(200).json(createSuccessResponse('Upload URLs generated successfully', { uploadUrls }))
      return res.status(200).json(createSuccessResponse('Upload URLs generated successfully', {
        uploadUrls
      }));

  } catch (error) {
      logError('Error generating upload URLs', { 
        error: error.message, 
        authenticatedUserId 
      });
      // TODO: Convert createErrorResponse(500, 'Failed to generate upload URLs') to res.status(500).json({ error: 'Failed to generate upload URLs' })
      return res.status(500).json(createErrorResponse(500, 'Failed to generate upload URLs'));
    }

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('getMessageUploadUrlHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * POST /messages/send - Send a message to another user
 * Exact implementation matching Lambda sendMessageHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with message result or error details
 */
export const sendMessage = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Send message request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.body to req.body
      body: req.body ? Object.keys(req.body) : 'no body'
    });

    // Parse request body to extract message data
    // TODO: Convert JSON.parse(event.body || '{}') to req.body
    const { user_id, message, price, media, expires_at, expired_at } = req.body || {};

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'message send sendMessageHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'message send sendMessageHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'message send sendMessageHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Processing send message request', { 
      authenticatedUserId,
      targetUserId: user_id,
      hasMessage: !!message,
      hasPrice: !!price,
      mediaCount: media ? media.length : 0
    });

    // Validate required fields
    if (!user_id) {
      logError('User ID is required');
      // TODO: Convert createErrorResponse(400, 'User ID is required') to res.status(400).json({ error: 'User ID is required' })
      return res.status(400).json(createErrorResponse(400, 'User ID is required'));
    }

    if (!message) {
      logError('Message content is required');
      // TODO: Convert createErrorResponse(400, 'Message content is required') to res.status(400).json({ error: 'Message content is required' })
      return res.status(400).json(createErrorResponse(400, 'Message content is required'));
    }

    // Validate user ID is a valid number
    const targetUserId = parseInt(user_id);
    if (isNaN(targetUserId) || targetUserId <= 0) {
      logError('Invalid user ID format', { user_id });
      // TODO: Convert createErrorResponse(400, 'Invalid user ID format') to res.status(400).json({ error: 'Invalid user ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
    }

    // Prevent self-sending: authenticated user cannot send message to themselves
    if (targetUserId === authenticatedUserId) {
      logError('User attempting to send message to themselves', { 
        authenticatedUserId, 
        targetUserId 
      });
      // TODO: Convert createErrorResponse(400, 'Cannot send message to yourself') to res.status(400).json({ error: 'Cannot send message to yourself' })
      return res.status(400).json(createErrorResponse(400, 'Cannot send message to yourself'));
    }
    
    // Clean up the data: convert empty price to null and filter out empty media
    const cleanPrice = (price === '' || price === null || price === undefined) ? null : price;
    const cleanMedia = media ? media.filter(item => typeof item === 'string' && item.trim() !== '') : [];
    
    // Convert expires_at option to timestamp (support both field names for backward compatibility)
    const expiresAtTimestamp = convertExpiresAtToTimestamp(expires_at || expired_at);

    // Find or create conversation between sender and receiver
    let conversationId;
    try {
      logInfo('Finding or creating conversation between users:', { 
        senderId: authenticatedUserId, 
        receiverId: targetUserId 
      });
      conversationId = await findOrCreateConversation(authenticatedUserId, targetUserId);
      logInfo('Conversation management completed:', { conversationId });
    } catch (error) {
      logError('Conversation management failed:', { error: error.message });
      // TODO: Convert createErrorResponse(500, 'Failed to manage conversation') to res.status(500).json({ error: 'Failed to manage conversation' })
      return res.status(500).json(createErrorResponse(500, 'Failed to manage conversation'));
    }

    // Create new message in database FIRST (before S3 processing)
    let messageId;
    try {
      logInfo('Creating new message in database');
      const messageResult = await saveMessage({
        conversation_id: conversationId,
        from_user_id: authenticatedUserId,
        to_user_id: targetUserId,
        message,
        price: cleanPrice || 0,
        format: cleanMedia.length > 0 ? cleanMedia[0].split('.').pop() : '',
        size: cleanMedia.length > 0 ? '0' : '',
        expires_at: expiresAtTimestamp
      });
      messageId = messageResult.messageId;
      
      // Validate that messageId was created successfully
      if (!messageId) {
        throw new Error('Message ID was not generated after message creation');
      }
      
      logInfo('Message created in database successfully:', { messageId });
    } catch (error) {
      logError('Database message creation failed:', { error: error.message });
      // TODO: Convert createErrorResponse(500, 'Failed to create message in database') to res.status(500).json({ error: 'Failed to create message in database' })
      return res.status(500).json(createErrorResponse(500, 'Failed to create message in database'));
    }

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      // TODO: Convert createErrorResponse(500, 'Media storage not configured') to res.status(500).json({ error: 'Media storage not configured' })
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files (validate, convert images to WebP) only if message creation succeeded
    let processedMedia = { original: [], converted: [] };
    let mediaProcessingFailed = false;
    if (cleanMedia && cleanMedia.length > 0) {
      try {
        logInfo('Starting message media processing:', { mediaCount: cleanMedia.length });
        processedMedia = await processMediaFiles(cleanMedia, bucketName, 'message', { continueOnError: false });
        logInfo('Message media processing completed successfully:', { 
          originalCount: processedMedia.original.length,
          convertedCount: processedMedia.converted.length
        });
      } catch (error) {
        logError('Message media processing failed:', { error: error.message });
        mediaProcessingFailed = true;
        
        // Clean up any S3 files that might have been uploaded during processing
        try {
          logInfo('Cleaning up S3 files due to media processing failure');
          await cleanupS3Files(processedMedia.original, processedMedia.converted, bucketName, 'message');
        } catch (cleanupError) {
          logError('Failed to cleanup S3 files after media processing failure:', { 
            cleanupError: cleanupError.message 
          });
        }
        
        // Rollback: Delete the message since media processing failed
        try {
          logInfo('Rolling back message creation due to media processing failure:', { messageId });
          await deleteMessageUtil(messageId);
          logInfo('Message rollback completed successfully');
        } catch (rollbackError) {
          logError('Failed to rollback message after media processing failure:', { 
            messageId, 
            rollbackError: rollbackError.message 
          });
        }
        
        // TODO: Convert createErrorResponse(500, 'Media processing failed') to res.status(500).json({ error: 'Media processing failed' })
        return res.status(500).json(createErrorResponse(500, 'Media processing failed'));
      }
    }

    // Save media data to database (only if we have processed media and processing didn't fail)
    if (!mediaProcessingFailed && (processedMedia.original.length > 0 || processedMedia.converted.length > 0)) {
      try {
        logInfo('Saving message media to database');
        await saveMessageMedia({
          media: processedMedia.original,
          convertedMedia: processedMedia.converted,
          message_id: messageId,
          conversation_id: conversationId,
          userId: authenticatedUserId
        });
        logInfo('Message media saved to database successfully');
      } catch (error) {
        logError('Database media save operation failed:', { error: error.message });
        
        // Clean up S3 files since database save failed
        try {
          logInfo('Cleaning up S3 files due to database save failure');
          await cleanupS3Files(processedMedia.original, processedMedia.converted, bucketName, 'message');
        } catch (cleanupError) {
          logError('Failed to cleanup S3 files after database save failure:', { 
            cleanupError: cleanupError.message 
          });
        }
        
        // Rollback: Delete the message since media save failed
        try {
          logInfo('Rolling back message creation due to media save failure:', { messageId });
          await deleteMessageUtil(messageId);
          logInfo('Message rollback completed successfully');
        } catch (rollbackError) {
          logError('Failed to rollback message after media save failure:', { 
            messageId, 
            rollbackError: rollbackError.message 
          });
        }
        
        // TODO: Convert createErrorResponse(500, 'Failed to save media to database') to res.status(500).json({ error: 'Failed to save media to database' })
        return res.status(500).json(createErrorResponse(500, 'Failed to save media to database'));
      }
    } else if (!mediaProcessingFailed) {
      logInfo('No media to save to database');
    }

    // Log successful message creation with detailed metrics
    logInfo('Message sent successfully:', { 
      messageId,
      authenticatedUserId, 
      targetUserId,
      message,
      mediaCount: processedMedia.original.length,
      convertedCount: processedMedia.converted.length,
      conversation_id: conversationId
    });

    // TODO: Convert createSuccessResponse('Message sent successfully', { user_id: parseInt(user_id), message_id: messageId, auth_id: parseInt(authenticatedUserId), message: message }) to res.status(200).json(createSuccessResponse('Message sent successfully', { user_id: parseInt(user_id), message_id: messageId, auth_id: parseInt(authenticatedUserId), message: message }))
    return res.status(200).json(createSuccessResponse('Message sent successfully', {
      user_id: parseInt(user_id),
      message_id: messageId,
      auth_id: parseInt(authenticatedUserId),
      message: message
    }));

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('sendMessageHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Get active subscribers for a creator
 */
const getActiveSubscribers = async (creatorId) => {
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT s.user_id as subscriber_id
      FROM subscriptions s
      INNER JOIN plans p ON s.stripe_price = p.name
      WHERE p.user_id = ? 
        AND p.status = '1'
        AND (
          (s.cancelled = 'no' AND s.ends_at > NOW()) 
          OR (s.free = 'yes' AND s.cancelled = 'no')
        )
    `, [creatorId]);
    
    return rows.map(({ subscriber_id }) => subscriber_id);
  } catch (error) {
    logError('Failed to get active subscribers:', { error: error.message, creatorId });
    throw error;
  }
};

/**
 * Process media files for massive message
 */
const processMassiveMessageMedia = async (media, bucketName) => {
  if (!media || media.length === 0) return { original: [], converted: [] };

  try {
    logInfo('Starting massive message media processing:', { mediaCount: media.length });
    const processedMedia = await processMediaFiles(media, bucketName, 'message', { continueOnError: false });
    logInfo('Media processing completed:', { 
      originalCount: processedMedia.original.length,
      convertedCount: processedMedia.converted.length
    });
    return processedMedia;
  } catch (error) {
    logError('Media processing failed:', { error: error.message });
    try {
      await cleanupS3Files([], [], bucketName, 'message');
    } catch (cleanupError) {
      logError('Cleanup failed:', { cleanupError: cleanupError.message });
    }
    throw error;
  }
};

/**
 * Process a single subscriber for massive message sending
 */
const processSubscriber = async (subscriberId, { creatorId, message, price, media, processedMedia, expiresAtTimestamp }) => {
  try {
    // Find or create conversation between creator and subscriber
    const conversationId = await findOrCreateConversation(creatorId, subscriberId);
    
    // Create new message in database
    const messageResult = await saveMessage({
      conversation_id: conversationId,
      from_user_id: creatorId,
      to_user_id: subscriberId,
      message,
      price,
      format: media.length > 0 ? media[0].split('.').pop() : '',
      size: media.length > 0 ? '0' : '',
      expires_at: expiresAtTimestamp
    });
    
    const { messageId } = messageResult;
    if (!messageId) throw new Error('Message ID was not generated');
    
    let mediaIds = [];
    if (processedMedia.original.length > 0 || processedMedia.converted.length > 0) {
      try {
        const mediaResult = await saveMessageMedia({
          media: processedMedia.original,
          convertedMedia: processedMedia.converted,
          message_id: messageId,
          conversation_id: conversationId,
          userId: creatorId
        });
        
        if (mediaResult.mediaId && mediaResult.mediaId.length > 0) {
          mediaIds = mediaResult.mediaId;
        }
      } catch (error) {
        logError('Media save failed for subscriber:', { subscriberId, messageId, error: error.message });
        return { success: true, messageId, mediaIds, error: 'Media save failed' };
      }
    }
    
    logInfo('Message sent successfully to subscriber:', { subscriberId, messageId, conversationId });
    return { success: true, messageId, mediaIds };
    
  } catch (error) {
    logError('Failed to process subscriber:', { subscriberId, error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Build comprehensive response data for massive message send
 */
const buildResponseData = (results, message, price, processedMedia, expiresAtTimestamp) => {
  const { totalSubscribers, successfulSends, failedSends, messageIds, mediaIds, errors } = results;
  const { original, converted } = processedMedia;
  
  const responseData = {
    totalSubscribers,
    successfulSends,
    failedSends,
    messageIds,
    mediaIds,
    message,
    price: price || 0,
    expires_at: expiresAtTimestamp,
    media: { original, converted },
    sent_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    status: 'completed'
  };

  if (errors.length > 0) responseData.errors = errors;
  return responseData;
};

/**
 * POST /messages/send-massive - Send a message to all active subscribers
 * Exact implementation matching Lambda sendMassiveMessageHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with massive message result or error details
 */
export const sendMassiveMessage = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Massive message request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.body to req.body
      body: req.body ? Object.keys(req.body) : 'no body'
    });

    // Parse request body to extract message data
    // TODO: Convert JSON.parse(event.body || '{}') to req.body
    const { message, price, media, expires_at, expired_at } = req.body || {};

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'massive message send sendMassiveMessageHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'massive message send sendMassiveMessageHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'massive message send sendMassiveMessageHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Processing massive message request', { 
      authenticatedUserId,
      hasMessage: !!message,
      hasPrice: !!price,
      mediaCount: media ? media.length : 0
    });

    // Validate required fields
    if (!message) {
      logError('Message content is required');
      // TODO: Convert createErrorResponse(400, 'Message content is required') to res.status(400).json({ error: 'Message content is required' })
      return res.status(400).json(createErrorResponse(400, 'Message content is required'));
    }

    // Extract and clean request data (support both expired_at and expires_at for backward compatibility)
    const cleanPrice = (price === '' || price === null || price === undefined) ? 0 : price;
    const cleanMedia = media ? media.filter(item => typeof item === 'string' && item.trim() !== '') : [];
    
    // Support both field names for backward compatibility
    const expiryOption = expires_at || expired_at;
    
    // Convert expires_at option to timestamp
    const expiresAtTimestamp = convertExpiresAtToTimestamp(expiryOption);

    // Get active subscribers for the creator
    let subscriberIds;
    try {
      logInfo('Getting active subscribers for creator:', { creatorId: authenticatedUserId });
      subscriberIds = await getActiveSubscribers(authenticatedUserId);
      logInfo('Active subscribers retrieved:', { count: subscriberIds.length });
      
      if (subscriberIds.length === 0) {
        logError('No active subscribers found', { creatorId: authenticatedUserId });
        // TODO: Convert createErrorResponse(400, 'No active subscribers found. Cannot send massive message.') to res.status(400).json({ error: 'No active subscribers found. Cannot send massive message.' })
        return res.status(400).json(createErrorResponse(400, 'No active subscribers found. Cannot send massive message.'));
      }
    } catch (error) {
      logError('Failed to get subscribers:', { error: error.message, creatorId: authenticatedUserId });
      // TODO: Convert createErrorResponse(500, 'Failed to retrieve subscribers') to res.status(500).json({ error: 'Failed to retrieve subscribers' })
      return res.status(500).json(createErrorResponse(500, 'Failed to retrieve subscribers'));
    }

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      // TODO: Convert createErrorResponse(500, 'Media storage not configured') to res.status(500).json({ error: 'Media storage not configured' })
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files if present
    let processedMedia = { original: [], converted: [] };
    if (cleanMedia.length > 0) {
      try {
        logInfo('Processing media files for massive message', { mediaCount: cleanMedia.length });
        processedMedia = await processMassiveMessageMedia(cleanMedia, bucketName);
        logInfo('Media processing completed successfully', { 
          originalCount: processedMedia.original.length,
          convertedCount: processedMedia.converted.length
        });
      } catch (error) {
        logError('Media processing failed for massive message', { error: error.message });
        // TODO: Convert createErrorResponse(500, 'Media processing failed') to res.status(500).json({ error: 'Media processing failed' })
        return res.status(500).json(createErrorResponse(500, 'Media processing failed'));
      }
    }

    // Initialize results tracking
    const results = {
      totalSubscribers: subscriberIds.length,
      successfulSends: 0,
      failedSends: 0,
      errors: [],
      messageIds: [],
      mediaIds: []
    };

    logInfo('Starting massive message processing', { 
      totalSubscribers: subscriberIds.length,
      hasMedia: cleanMedia.length > 0
    });

    // Process each subscriber
    for (const subscriberId of subscriberIds) {
      try {
      const subscriberResult = await processSubscriber(subscriberId, {
          creatorId: authenticatedUserId, 
          message, 
          price: cleanPrice, 
          media: cleanMedia, 
          processedMedia, 
          expiresAtTimestamp
      });
      
      if (subscriberResult.success) {
        results.successfulSends++;
        results.messageIds.push(subscriberResult.messageId);
        if (subscriberResult.mediaIds.length > 0) {
          results.mediaIds.push(...subscriberResult.mediaIds);
        }
        if (subscriberResult.error) {
          results.errors.push(`Subscriber ${subscriberId}: ${subscriberResult.error}`);
        }
      } else {
        results.failedSends++;
        results.errors.push(`Subscriber ${subscriberId}: ${subscriberResult.error}`);
        }
      } catch (error) {
        logError('Error processing subscriber', { 
          subscriberId, 
          error: error.message,
          creatorId: authenticatedUserId
        });
        results.failedSends++;
        results.errors.push(`Subscriber ${subscriberId}: ${error.message}`);
      }
    }

    // Build and return comprehensive response
    const responseData = buildResponseData(results, message, cleanPrice, processedMedia, expiresAtTimestamp);

    // Log successful massive message send with detailed metrics
    logInfo('Massive message sent successfully', { 
      creatorId: authenticatedUserId, 
      totalSubscribers: results.totalSubscribers,
      successfulSends: results.successfulSends, 
      failedSends: results.failedSends,
      messageIdsCount: results.messageIds.length, 
      mediaIdsCount: results.mediaIds.length,
      hasMedia: cleanMedia.length > 0
    });

    // TODO: Convert createSuccessResponse('Massive message sent successfully', responseData) to res.status(200).json(createSuccessResponse('Massive message sent successfully', responseData))
    return res.status(200).json(createSuccessResponse('Massive message sent successfully', responseData));

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('sendMassiveMessageHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /messages/by-id/{messageId} - Retrieve a specific message by its ID in conversations format
 * Exact implementation matching Lambda messageByIdHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Express response with message or error details
 */
export const getMessageById = async (req, res) => {
  try {
    // Log incoming request details for monitoring and debugging
    logInfo('Message by ID request received', { 
      // TODO: Convert event.path to req.path
      path: req.path, 
      // TODO: Convert event.httpMethod to req.method
      method: req.method,
      // TODO: Convert event.pathParameters to req.params
      pathParameters: req.params,
      // TODO: Convert event.headers to req.headers
      headers: req.headers ? Object.keys(req.headers) : 'no headers'
    });

    // Extract message ID from path parameters
    // TODO: Convert event.pathParameters?.messageId to req.params?.messageId
    const { messageId } = req.params || {};
    
    // Validate message ID parameter
    if (!messageId) {
      logError('Message ID parameter is required');
      // TODO: Convert createErrorResponse(400, 'Message ID parameter is required') to res.status(400).json({ error: 'Message ID parameter is required' })
      return res.status(400).json(createErrorResponse(400, 'Message ID parameter is required'));
    }

    // Validate message ID is a valid number
    const messageIdNum = parseInt(messageId);
    if (isNaN(messageIdNum) || messageIdNum <= 0) {
      logError('Invalid message ID format', { messageId });
      // TODO: Convert createErrorResponse(400, 'Invalid message ID format') to res.status(400).json({ error: 'Invalid message ID format' })
      return res.status(400).json(createErrorResponse(400, 'Invalid message ID format'));
    }

    // Get authenticated user ID using common utility function
    // This ensures consistent authentication handling across the application
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: false, action: 'message by ID messageByIdHandler' }) to getAuthenticatedUserId(req, { allowAnonymous: false, action: 'message by ID messageByIdHandler' })
    const { userId: authenticatedUserId, errorResponse } = getAuthenticatedUserId(req, { 
      allowAnonymous: false, 
      action: 'message by ID messageByIdHandler' 
    });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }

    logInfo('Processing message by ID request', { 
      authenticatedUserId, 
      messageId: messageIdNum 
    });

    try {
      // Retrieve the specific message by its ID with full details
      const message = await getMessageByIdWithDetails(messageIdNum);
      
      if (!message) {
        logError('Message not found in database', { 
          messageId: messageIdNum, 
          authenticatedUserId,
          searchCriteria: 'messageId=' + messageIdNum
        });
        // TODO: Convert createErrorResponse(404, 'Message not found') to res.status(404).json({ error: 'Message not found' })
        return res.status(404).json(createErrorResponse(404, 'Message not found'));
      }

      // Security check: Ensure the authenticated user is either the sender or recipient
      // This prevents users from accessing messages they're not part of
      if (message.from_user_id !== authenticatedUserId && message.to_user_id !== authenticatedUserId) {
        logError('User not authorized to access this message', { 
          messageId: messageIdNum, 
          authenticatedUserId,
          messageFromUserId: message.from_user_id,
          messageToUserId: message.to_user_id
        });
        // TODO: Convert createErrorResponse(403, 'You are not authorized to access this message') to res.status(403).json({ error: 'You are not authorized to access this message' })
        return res.status(403).json(createErrorResponse(403, 'You are not authorized to access this message'));
      }

      // Check if message is deleted or inactive
      if (message.status === 'deleted' || message.mode !== 'active') {
        logError('Message is deleted or inactive', { 
          messageId: messageIdNum, 
          status: message.status,
          mode: message.mode 
        });
        // TODO: Convert createErrorResponse(404, 'Message not found') to res.status(404).json({ error: 'Message not found' })
        return res.status(404).json(createErrorResponse(404, 'Message not found'));
      }

      logInfo('Message retrieved successfully', { 
        messageId: messageIdNum,
        authenticatedUserId,
        messageFromUserId: message.from_user_id,
        messageToUserId: message.to_user_id
      });

      // Format the single message in conversations format for consistency
      // This ensures the response format matches other message endpoints
      const formattedMessages = formatMessagesByDate([message], authenticatedUserId);

      // Prepare response data in the same format as conversation endpoints
      const responseData = {
        conversations: formattedMessages
      };

      // Log successful response for monitoring and analytics
      logInfo('Message by ID retrieved successfully', { 
        messageId: messageIdNum,
        authenticatedUserId,
        conversationGroups: formattedMessages.length
      });

      // TODO: Convert createSuccessResponse('Message retrieved successfully', responseData) to res.status(200).json(createSuccessResponse('Message retrieved successfully', responseData))
      return res.status(200).json(createSuccessResponse('Message retrieved successfully', responseData));

    } catch (error) {
      logError('Error fetching message by ID', { 
        error: error.message, 
        messageId: messageIdNum,
        authenticatedUserId 
      });
      // TODO: Convert createErrorResponse(500, 'Failed to retrieve message') to res.status(500).json({ error: 'Failed to retrieve message' })
      return res.status(500).json(createErrorResponse(500, 'Failed to retrieve message'));
    }

  } catch (error) {
    // Catch any unexpected errors and log them for debugging
    logError('messageByIdHandler error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
