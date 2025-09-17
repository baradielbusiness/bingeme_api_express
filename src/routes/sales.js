import express from 'express';
import * as salesController from '../controllers/salesController.js';
import { authenticatedOnlyMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// All sales routes require authenticated user
router.use(authenticatedOnlyMiddleware);

router.get('/', setEdgeCacheHeaders, salesController.getSales);
router.post('/delivered-product/:id', salesController.deliveredProduct);
router.post('/reject-order/:id', salesController.rejectOrder);

export default router;
