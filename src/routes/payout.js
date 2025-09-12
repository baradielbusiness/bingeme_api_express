import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getPayoutMethod,
  createPayoutMethod,
  deletePayoutMethod,
  getPayoutConversations,
  storePayoutConversation,
  getPayoutUploadUrl
} from '../controllers/payoutController.js';

const router = express.Router();

// Payout method routes
router.get('/', authMiddleware, getPayoutMethod);
router.post('/create', authMiddleware, createPayoutMethod);
router.delete('/delete', authMiddleware, deletePayoutMethod);

// Payout conversation routes
router.get('/conversations', authMiddleware, getPayoutConversations);
router.post('/conversations/store', authMiddleware, storePayoutConversation);

// Payout upload routes
router.get('/upload-url', authMiddleware, getPayoutUploadUrl);

export default router;
