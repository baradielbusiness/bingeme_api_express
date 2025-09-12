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
 * Handler to get conversation messages (GET /messages/conversation)
 */
export const getConversation = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip = '0', limit = '10' } = req.query;
    const skipNum = parseInt(skip) || 0;
    const limitNum = parseInt(limit) || 10;
    
    const user = await getUserById(userId);
    if (!user) return res.status(404).json(createErrorResponse(404, 'User not found'));
    
    let supportConfig;
    try {
      supportConfig = await getSupportConfiguration(user);
    } catch (error) {
      logError('Error getting support configuration:', error);
      supportConfig = { supportId: 1, supportAvatar: "default.webp", supportName: "Support", supportUsername: "support" };
    }
    
    const { supportId } = supportConfig;
    const defaultSupportMessage = createDefaultSupportMessage(supportConfig, userId);
    
    const { messages: rows, totalMessages, conversationRoomMap } = await getUserInboxWithMedia(userId, skipNum, limitNum);
    
    const userIds = [...new Set(rows.flatMap(({ from_user_id, to_user_id }) => [
      parseInt(from_user_id), 
      parseInt(to_user_id)
    ]))];
    const usersMap = await fetchUsersMap(userIds);
    
    const { supportIndex } = checkSupportUserPresence(rows, supportId);
    
    const formattedMessagesInbox = rows.map(row => formatMessageRow(row, userId, usersMap, conversationRoomMap));
    
    const finalMessagesInbox = positionSupportConversation(formattedMessagesInbox, supportIndex, defaultSupportMessage);
    
    logInfo('Messages retrieved successfully', { userId, totalMessages, returnedCount: finalMessagesInbox.length });
    
    const hasMore = skipNum + limitNum < totalMessages;
    const nextUrl = hasMore ? `/conversation?skip=${skipNum + limitNum}&limit=${limitNum}` : '';
    
    return res.status(200).json(createApiResponse(200, 'Messages retrieved successfully', {
      messagesInbox: finalMessagesInbox,
      pagination: { total: totalMessages, next: nextUrl }
    }));
  } catch (error) {
    logError('getConversation error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to search conversations (GET /messages/conversation/search)
 */
export const getConversationSearch = async (req, res) => {
  try {
    const userId = req.userId;
    const { search } = req.query;

    if (!search || search.length < 2) {
      return res.status(400).json(createErrorResponse(400, 'Search term must be at least 2 characters'));
    }

    const messages = await searchConversations(userId, search);
    
    logInfo('Search completed', { 
      userId, 
      searchTerm: search, 
      resultCount: messages.length 
    });

    return res.status(200).json(createApiResponse(200, 'Messages retrieved successfully', {
      messagesInbox: messages
    }));

  } catch (error) {
    logError('getConversationSearch error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to get messages inbox (GET /messages/:id and GET /messages/:id/:username)
 */
export const getMessagesInbox = async (req, res) => {
  try {
    const userId = req.userId;
    const { id, username } = req.params;
    const { skip, limit } = req.query;

    if (!id) {
      return res.status(400).json(createErrorResponse(400, 'User ID is required'));
    }

    const targetUserId = parseInt(id);
    if (isNaN(targetUserId)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid user ID format'));
    }

    // Security check: Prevent user from accessing their own messages
    if (userId === targetUserId) {
      logError('User attempting to access own messages', { userId });
      return res.status(400).json(createErrorResponse(400, 'Cannot access messages with yourself'));
    }

    const skipNum = parseInt(skip) || 0;
    const limitNum = Math.min(parseInt(limit) || 50, 100);

    logInfo('Processing messages request', { 
      userId, 
      targetUserId, 
      username, 
      skip: skipNum, 
      limit: limitNum 
    });

    let messages, totalCount, otherUser;

    if (username) {
      // Mode 2: URL contains both user ID and username
      const userValidation = await validateUserByUsername(username);
      if (!userValidation.valid) {
        logError('Username validation failed', { error: userValidation.error });
        return res.status(404).json(createErrorResponse(404, userValidation.error));
      }

      if (userValidation.user.id !== targetUserId) {
        logError('Username and user ID belong to different users', { 
          providedUserId: targetUserId, 
          usernameUserId: userValidation.user.id,
          username: username 
        });
        return res.status(400).json(createErrorResponse(400, 'Username and user ID belong to different users'));
      }

      const result = await getUserMessagesByUsername(
        userId, 
        username, 
        { skip: skipNum, limit: limitNum }
      );

      if (result.error) {
        logError('Error fetching messages by username', { error: result.error });
        return res.status(404).json(createErrorResponse(404, result.error));
      }

      messages = result.messages;
      totalCount = result.totalCount;
      otherUser = result.otherUser;
    } else {
      // Mode 1: URL contains only user ID
      const accessValidation = await validateUserAccess(userId, targetUserId);
      if (!accessValidation.hasAccess) {
        logError('User access denied', { error: accessValidation.error });
        return res.status(403).json(createErrorResponse(403, accessValidation.error));
      }

      try {
        const result = await getUserMessagesById(
          userId, 
          targetUserId, 
          { skip: skipNum, limit: limitNum }
        );

        logInfo('Messages retrieved by user ID', { 
          userId, 
          targetUserId,
          messageCount: result.messages.length,
          totalCount: result.totalCount 
        });

        messages = result.messages;
        totalCount = result.totalCount;
        otherUser = accessValidation.otherUser;
      } catch (error) {
        logError('Error fetching messages by user ID', { 
          error: error.message, 
          userId, 
          targetUserId 
        });
        return res.status(500).json(createErrorResponse(500, 'Failed to retrieve messages'));
      }
    }

    const formattedMessagesByDate = formatMessagesByDate(messages, userId);

    const hasMore = (skipNum + limitNum) < totalCount;
    
    const isValidUsername = username && 
                           username !== 'undefined' && 
                           username !== 'null' && 
                           username !== '{username}' && 
                           !(username.startsWith('{') && username.endsWith('}'));
    
    const nextUrl = hasMore ? `/messages/${targetUserId}${isValidUsername ? `/${username}` : ''}?skip=${skipNum + limitNum}&limit=${limitNum}` : null;

    const responseData = {
      conversations: formattedMessagesByDate,
      pagination: {
        skip: skipNum,
        limit: limitNum,
        total: totalCount,
        has_more: hasMore,
        next_url: nextUrl
      }
    };

    logInfo('Messages retrieved successfully', { 
      userId, 
      targetUserId, 
      username, 
      totalCount, 
      returnedCount: messages.length,
      dateGroups: formattedMessagesByDate.length 
    });

    return res.status(200).json(createSuccessResponse('Messages retrieved successfully', responseData));

  } catch (error) {
    logError('getMessagesInbox error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to delete a message (DELETE /messages/delete)
 */
export const deleteMessage = async (req, res) => {
  try {
    const userId = req.userId;
    const { message_id } = req.body;

    if (!message_id) {
      logError('message_id is required');
      return res.status(400).json(createErrorResponse(400, 'message_id is required'));
    }

    // Fetch message and check ownership
    const message = await getMessageByIdUtil(message_id);
    if (!message) {
      logError('Message not found', { message_id });
      return res.status(404).json(createErrorResponse(404, 'Message not found'));
    }
    if (message.from_user_id !== userId) {
      logError('User does not own the message', { userId, message_id });
      return res.status(403).json(createErrorResponse(403, 'You can only delete your own messages'));
    }

    // Soft delete message and related data
    await markMessageDeleted(message_id);
    await markMediaMessagesDeletedUtil(message_id);
    await removeMessageNotifications(message_id);

    // Count remaining (not deleted) messages in the conversation
    const countMessages = await countActiveMessages(message.conversations_id);

    // Update conversation status if needed
    const conversation = await getConversationById(message.conversations_id);
    if (conversation) {
      if (countMessages === 0) {
        await setConversationInactive(conversation.id);
      } else {
        const latestMsgTime = await getLatestMessageTime(conversation.id);
        await updateConversationTimestamp(conversation.id, latestMsgTime);
      }
    }

    logInfo('Message deleted successfully', { message_id, userId });
    return res.status(200).json(createSuccessResponse('Message deleted successfully'));
  } catch (error) {
    logError('deleteMessage error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to delete a conversation (DELETE /messages/conversation/delete/:id)
 */
export const deleteConversation = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json(createErrorResponse(400, 'Valid user ID is required'));
    }

    const otherUserId = parseInt(id);

    // Security check - prevent self-deletion
    if (userId === otherUserId) {
      return res.status(400).json(createErrorResponse(400, 'Cannot delete conversation with yourself'));
    }

    // Start database transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    
    try {
      // Get message and conversation IDs
      const { messageIds, conversationIds } = await getMessageAndConversationIds(
        userId, 
        otherUserId
      );
      
      logInfo('Found message and conversation IDs', { 
        messageIds, 
        conversationIds, 
        messageCount: messageIds.length,
        conversationCount: conversationIds.length 
      });
      
      // If no messages found, return early success
      if (!messageIds.length) {
        logInfo('No messages found to delete');
        await connection.commit();
        connection.release();
        return res.status(200).json(createApiResponse(200, 'Conversation deleted successfully', {
          deleted_messages_count: 0,
          conversation_id: null,
          cleared_notifications: false
        }));
      }
      
      // Mark resources as deleted/inactive
      await markMediaMessagesDeleted(messageIds);
      await markMessagesDeleted(messageIds);
      await markConversationsInactive(conversationIds);
      await removeUserNotifications(userId);
      
      await connection.commit();
      connection.release();
      
      logInfo('Deletion operations completed', {
        deletedMessagesCount: messageIds.length,
        conversationId: conversationIds[0] || null,
        clearedNotifications: true
      });
      
      return res.status(200).json(createApiResponse(200, 'Conversation deleted successfully', {
        deleted_messages_count: messageIds.length,
        conversation_id: conversationIds[0] || null,
        cleared_notifications: true
      }));
    } catch (dbError) {
      await connection.rollback();
      connection.release();
      logError('Database error, rolling back', dbError);
      return res.status(500).json(createErrorResponse(500, 'Failed to delete conversation'));
    }
  } catch (error) {
    logError('deleteConversation error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to get message upload URL (GET /messages/upload-url)
 */
export const getMessageUploadUrl = async (req, res) => {
  try {
    // Configuration options for messages upload processing
    const uploadOptions = {
      action: 'getMessageUploadUrl',
      basePath: 'uploads/messages',
      useFolderOrganization: false, // Messages use flat structure without folder organization
      successMessage: 'Pre-signed message upload URLs generated',
      getAuthenticatedUserId
    };
    
    // Use shared upload processing utility and return result directly
    const result = await processUploadRequest(req, uploadOptions);
    
    if (result.statusCode === 200) {
      return res.status(200).json(JSON.parse(result.body));
    } else {
      return res.status(result.statusCode).json(JSON.parse(result.body));
    }
  } catch (error) {
    logError('getMessageUploadUrl error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to send a message (POST /messages/send)
 */
export const sendMessage = async (req, res) => {
  try {
    logInfo('Message media upload request initiated');
    
    const userId = req.userId;
    const { user_id, message, price, media, expires_at, expired_at } = req.body;

    // Validate required fields and data types
    const validation = validateMessageMediaInput(req.body);
    if (!validation.success) {
      logError('Message media validation failed:', { errors: validation.errors });
      return res.status(422).json(createErrorResponse(422, 'Validation failed', validation.errors));
    }
    logInfo('Validation passed successfully');

    // Prevent self-sending: authenticated user cannot send message to themselves
    if (parseInt(user_id) === parseInt(userId)) {
      logError('Self-sending attempt blocked:', { authenticatedUserId: userId, targetUserId: user_id });
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
      logInfo('Finding or creating conversation between users:', { senderId: userId, receiverId: user_id });
      conversationId = await findOrCreateConversation(userId, user_id);
      logInfo('Conversation management completed:', { conversationId });
    } catch (error) {
      logError('Conversation management failed:', { error: error.message });
      return res.status(500).json(createErrorResponse(500, 'Failed to manage conversation', error.message));
    }

    // Create new message in database FIRST (before S3 processing)
    let messageId;
    try {
      logInfo('Creating new message in database');
      const messageResult = await saveMessage({
        conversation_id: conversationId,
        from_user_id: userId,
        to_user_id: user_id,
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
      return res.status(500).json(createErrorResponse(500, 'Failed to create message in database', error.message));
    }

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
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
        
        return res.status(500).json(createErrorResponse(500, 'Media processing failed', error.message));
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
          userId
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
        
        return res.status(500).json(createErrorResponse(500, 'Failed to save media to database', error.message));
      }
    } else if (!mediaProcessingFailed) {
      logInfo('No media to save to database');
    }

    // Log successful message creation with detailed metrics
    logInfo('Message sent successfully:', { 
      messageId,
      userId, 
      user_id,
      message,
      mediaCount: processedMedia.original.length,
      convertedCount: processedMedia.converted.length,
      conversation_id: conversationId
    });

    // Return success response with additional details
    return res.status(200).json(createSuccessResponse('Message sent successfully', {
      user_id: parseInt(user_id),
      message_id: messageId,
      auth_id: parseInt(userId),
      message: message
    }));

  } catch (error) {
    logError('Unexpected error in message media upload:', { 
      error: error.message,
      stack: error.stack 
    });
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
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
 * Handler to send massive message (POST /messages/send-massive)
 */
export const sendMassiveMessage = async (req, res) => {
  try {
    logInfo('Massive message request initiated');
    
    const userId = req.userId;
    const { message, price, media, expires_at, expired_at } = req.body;

    // Validate required fields and data types
    const validation = validateMassiveMessageInput(req.body);
    if (!validation.success) {
      logError('Massive message validation failed:', { errors: validation.errors });
      return res.status(422).json(createErrorResponse(422, 'Validation failed', validation.errors));
    }
    logInfo('Validation passed successfully');

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
      logInfo('Getting active subscribers for creator:', { creatorId: userId });
      subscriberIds = await getActiveSubscribers(userId);
      logInfo('Active subscribers retrieved:', { count: subscriberIds.length });
      
      if (subscriberIds.length === 0) {
        return res.status(400).json(createErrorResponse(400, 'No active subscribers found. Cannot send massive message.'));
      }
    } catch (error) {
      logError('Failed to get subscribers:', { error: error.message });
      return res.status(500).json(createErrorResponse(500, 'Failed to retrieve subscribers', error.message));
    }

    // Get S3 bucket configuration from environment
    const { AWS_BUCKET_NAME: bucketName } = process.env;
    if (!bucketName) {
      logError('S3 bucket configuration missing from environment');
      return res.status(500).json(createErrorResponse(500, 'Media storage not configured'));
    }

    // Process media files if present
    let processedMedia = { original: [], converted: [] };
    if (cleanMedia.length > 0) {
      try {
        processedMedia = await processMassiveMessageMedia(cleanMedia, bucketName);
      } catch (error) {
        return res.status(500).json(createErrorResponse(500, 'Media processing failed', error.message));
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

    // Process each subscriber
    for (const subscriberId of subscriberIds) {
      const subscriberResult = await processSubscriber(subscriberId, {
        creatorId: userId, message, price: cleanPrice, media: cleanMedia, processedMedia, expiresAtTimestamp
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
    }

    // Build and return comprehensive response
    const responseData = buildResponseData(results, message, cleanPrice, processedMedia, expiresAtTimestamp);

    // Log successful massive message send with detailed metrics
    logInfo('Massive message sent successfully:', { 
      userId, totalSubscribers: results.totalSubscribers,
      successfulSends: results.successfulSends, failedSends: results.failedSends,
      messageIdsCount: results.messageIds.length, mediaIdsCount: results.mediaIds.length,
      hasMedia: cleanMedia.length > 0
    });

    return res.status(200).json(createSuccessResponse('Massive message sent successfully', responseData));

  } catch (error) {
    logError('Unexpected error in massive message send:', { error: error.message, stack: error.stack });
    return res.status(500).json(createErrorResponse(500, 'Internal server error', error.message));
  }
};

/**
 * Handler to get message by ID (GET /messages/by-id/:messageId)
 */
export const getMessageById = async (req, res) => {
  try {
    const userId = req.userId;
    const { messageId } = req.params;

    if (!messageId) {
      return res.status(400).json(createErrorResponse(400, 'Message ID parameter is required'));
    }

    // Validate message ID is a valid number
    const messageIdNum = parseInt(messageId);
    if (isNaN(messageIdNum) || messageIdNum <= 0) {
      logError('Invalid message ID format', { messageId });
      return res.status(400).json(createErrorResponse(400, 'Invalid message ID format'));
    }

    logInfo('Processing message by ID request', { 
      userId, 
      messageId: messageIdNum 
    });

    try {
      // Retrieve the specific message by its ID with full details
      const message = await getMessageByIdWithDetails(messageIdNum);
      
      if (!message) {
        logError('Message not found in database', { 
          messageId: messageIdNum, 
          userId,
          searchCriteria: 'messageId=' + messageIdNum
        });
        return res.status(404).json(createErrorResponse(404, 'Message not found'));
      }

      // Security check: Ensure the authenticated user is either the sender or recipient
      if (message.from_user_id !== userId && message.to_user_id !== userId) {
        logError('User not authorized to access this message', { 
          messageId: messageIdNum, 
          userId,
          messageFromUserId: message.from_user_id,
          messageToUserId: message.to_user_id
        });
        return res.status(403).json(createErrorResponse(403, 'You are not authorized to access this message'));
      }

      // Check if message is deleted or inactive
      if (message.status === 'deleted' || message.mode !== 'active') {
        logError('Message is deleted or inactive', { 
          messageId: messageIdNum, 
          status: message.status,
          mode: message.mode 
        });
        return res.status(404).json(createErrorResponse(404, 'Message not found'));
      }

      logInfo('Message retrieved successfully', { 
        messageId: messageIdNum,
        userId,
        messageFromUserId: message.from_user_id,
        messageToUserId: message.to_user_id
      });

      // Format the single message in conversations format for consistency
      const formattedMessages = formatMessagesByDate([message], userId);

      // Prepare response data in the same format as conversation endpoints
      const responseData = {
        conversations: formattedMessages
      };

      // Log successful response for monitoring and analytics
      logInfo('Message by ID retrieved successfully', { 
        messageId: messageIdNum,
        userId,
        conversationGroups: formattedMessages.length
      });

      return res.status(200).json(createSuccessResponse('Message retrieved successfully', responseData));

    } catch (error) {
      logError('Error fetching message by ID', { 
        error: error.message, 
        messageId: messageIdNum,
        userId 
      });
      return res.status(500).json(createErrorResponse(500, 'Failed to retrieve message'));
    }

  } catch (error) {
    logError('getMessageById error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
