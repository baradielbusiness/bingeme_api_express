import { createSuccessResponse, createErrorResponse, logInfo, logError, getAllCountries, getStates, getGenderOptions, getFile, getUserById, getVerificationRequestInfo, getVerificationCategories, createVerificationRequest, getVerificationConversationsList, storeVerificationConversationData } from '../utils/common.js';
import { processUploadRequest } from '../utils/uploadUtils.js';

/**
 * Get verification upload URL
 */
export const getVerificationUploadUrl = async (req, res) => {
  try {
    const userId = req.userId;

    const uploadOptions = {
      action: 'getVerificationUploadUrl',
      basePath: 'uploads/verification',
      useFolderOrganization: false,
      successMessage: 'Verification upload URL generated',
      getAuthenticatedUserId: () => ({ userId, errorResponse: null })
    };
    
    const result = await processUploadRequest(req, uploadOptions);
    return res.json(result);
  } catch (error) {
    logError('Error generating verification upload URL:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to generate verification upload URL'));
  }
};

/**
 * Get verification account data
 */
export const getVerificationAccount = async (req, res) => {
  try {
    const userId = req.userId;

    // Get user data
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }

    // Get verification request info
    const verificationInfo = await getVerificationRequestInfo(userId);
    
    // Get verification categories
    const categories = await getVerificationCategories();

    // Get additional data for verification forms
    const [countries, states, genderOptions] = await Promise.all([
      getAllCountries(),
      getStates(),
      getGenderOptions()
    ]);

    // Format user data for verification
    const userData = {
      name: user.name || '',
      email: user.email || '',
      avatar: user.avatar ? getFile(`avatar/${user.avatar}`) : '',
      bio: user.bio || '',
      location: user.location || '',
      website: user.website || '',
      social_links: user.social_links ? JSON.parse(user.social_links) : {},
      verification_status: verificationInfo.status || 'not_verified',
      verification_request: verificationInfo.request || null
    };

    logInfo('Verification account data retrieved successfully', { userId });
    return res.json(createSuccessResponse('Verification account data retrieved successfully', {
      user: userData,
      categories,
      countries,
      states,
      genderOptions
    }));
  } catch (error) {
    logError('Error fetching verification account data:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch verification account data'));
  }
};

/**
 * Send verification request
 */
export const verifyAccountSend = async (req, res) => {
  try {
    const userId = req.userId;
    const verificationData = req.body;

    // Validate required fields
    const { category, documents, personal_info } = verificationData;
    if (!category || !documents || !personal_info) {
      return res.status(400).json(createErrorResponse(400, 'Category, documents, and personal info are required'));
    }

    // Create verification request
    const result = await createVerificationRequest(userId, verificationData);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('Verification request submitted successfully', { userId, category });
    return res.json(createSuccessResponse('Verification request submitted successfully', {
      request_id: result.requestId
    }));
  } catch (error) {
    logError('Error submitting verification request:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to submit verification request'));
  }
};

/**
 * Get verification conversations
 */
export const getVerificationConversations = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip: skipRaw, limit: limitRaw } = req.query;
    const skip = parseInt(skipRaw) || 0;
    const limit = parseInt(limitRaw) || 20;

    const conversations = await getVerificationConversationsList(userId, { skip, limit });
    
    logInfo('Verification conversations retrieved successfully', { userId, count: conversations.length });
    return res.json(createSuccessResponse('Verification conversations retrieved successfully', {
      conversations
    }));
  } catch (error) {
    logError('Error fetching verification conversations:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch verification conversations'));
  }
};

/**
 * Store verification conversation
 */
export const storeVerificationConversation = async (req, res) => {
  try {
    const userId = req.userId;
    const conversationData = req.body;

    // Validate required fields
    const { message, attachments } = conversationData;
    if (!message) {
      return res.status(400).json(createErrorResponse(400, 'Message is required'));
    }

    // Store conversation
    const result = await storeVerificationConversationData(userId, conversationData);
    if (!result.success) {
      return res.status(400).json(createErrorResponse(400, result.message));
    }

    logInfo('Verification conversation stored successfully', { userId });
    return res.json(createSuccessResponse('Verification conversation stored successfully', {
      conversation_id: result.conversationId
    }));
  } catch (error) {
    logError('Error storing verification conversation:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to store verification conversation'));
  }
};
