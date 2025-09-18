import express from 'express';
import * as payoutController from '../controllers/payoutController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

// Payout method endpoints
router.get('/', setEdgeCacheHeaders, payoutController.getPayoutMethod);
router.post('/create', payoutController.createPayoutMethod);
router.delete('/delete', payoutController.deletePayoutMethod);

// Payout conversation endpoints
router.get('/conversations', setEdgeCacheHeaders, payoutController.getPayoutConversations);
router.post('/conversations/store', payoutController.storePayoutConversation);

// Upload endpoints
router.get('/upload-url', setEdgeCacheHeaders, payoutController.getPayoutUploadUrl);

export default router;
