import express from 'express';
import * as verificationController from '../controllers/verificationController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/account', setEdgeCacheHeaders, verificationController.getVerificationAccount);
router.get('/conversations', setEdgeCacheHeaders, verificationController.getVerificationConversations);

export default router;
