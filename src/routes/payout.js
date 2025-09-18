import express from 'express';
import * as payoutController from '../controllers/payoutController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', setEdgeCacheHeaders, payoutController.getPayoutMethod);
router.post('/create', payoutController.createPayoutMethod);
router.delete('/delete', payoutController.deletePayoutMethod);
router.get('/conversations', setEdgeCacheHeaders, payoutController.getPayoutConversations);
router.post('/conversations/store', payoutController.storePayoutConversation);
router.get('/upload-url', setEdgeCacheHeaders, payoutController.getPayoutUploadUrl);

export default router;
