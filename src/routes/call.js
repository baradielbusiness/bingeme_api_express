import express from 'express';
import * as callController from '../controllers/callController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Protected routes (authentication required)
router.get('/agora/details', authMiddleware, callController.getAgoraDetails);

export default router;
