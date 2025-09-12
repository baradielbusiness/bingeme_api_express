import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getConversation,
  getConversationSearch,
  getMessagesInbox,
  deleteMessage,
  deleteConversation,
  getMessageUploadUrl,
  sendMessage,
  sendMassiveMessage,
  getMessageById
} from '../controllers/messageController.js';

const router = express.Router();

// Conversation routes
router.get('/conversation', authMiddleware, getConversation);
router.get('/conversation/search', authMiddleware, getConversationSearch);

// Message routes
router.get('/:id', authMiddleware, getMessagesInbox);
router.get('/:id/:username', authMiddleware, getMessagesInbox);
router.get('/by-id/:messageId', authMiddleware, getMessageById);

// Message management routes
router.delete('/delete', authMiddleware, deleteMessage);
router.delete('/conversation/delete/:id', authMiddleware, deleteConversation);

// Upload routes
router.get('/upload-url', authMiddleware, getMessageUploadUrl);

// Send message routes
router.post('/send', authMiddleware, sendMessage);
router.post('/send-massive', authMiddleware, sendMassiveMessage);

export default router;
