import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getVerificationUploadUrl,
  getVerificationAccount,
  verifyAccountSend,
  getVerificationConversations,
  storeVerificationConversation
} from '../controllers/verificationController.js';

const router = express.Router();

// Verification upload URL
router.get('/upload-url', authMiddleware, getVerificationUploadUrl);

// Verification account management
router.get('/account', authMiddleware, getVerificationAccount);
router.post('/account', authMiddleware, verifyAccountSend);

// Verification conversations
router.get('/conversations', authMiddleware, getVerificationConversations);
router.post('/conversations', authMiddleware, storeVerificationConversation);

export default router;
