import express from 'express';
import * as liveController from '../controllers/liveController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/filter', setEdgeCacheHeaders, liveController.getLiveFilter);

export default router;
