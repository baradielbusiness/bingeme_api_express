import express from 'express';
import * as verificationController from '../controllers/verificationController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

// Upload endpoints
router.get('/upload-url', verificationController.getVerificationUploadUrl);

// Verification account endpoints
router.get('/account', setEdgeCacheHeaders, verificationController.getVerificationAccount);
router.post('/account', verificationController.verifyAccountSend);

// Verification conversation endpoints
router.get('/conversations', setEdgeCacheHeaders, verificationController.getVerificationConversations);
router.post('/conversations', verificationController.storeVerificationConversation);

export default router;
