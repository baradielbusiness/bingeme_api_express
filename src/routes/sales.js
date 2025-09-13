import express from 'express';
import * as salesController from '../controllers/salesController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', setEdgeCacheHeaders, salesController.getSales);

export default router;
