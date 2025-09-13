import express from 'express';
import * as referralsController from '../controllers/referralsController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', setEdgeCacheHeaders, referralsController.getReferrals);

export default router;
