import express from 'express';
import * as productsController from '../controllers/productsController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', setEdgeCacheHeaders, productsController.getProducts);
router.get('/create', productsController.getProductCreateData);

export default router;
