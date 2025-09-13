import express from 'express';
import * as dashboardController from '../controllers/dashboardController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// All dashboard routes require authentication
router.use(authMiddleware);

// Dashboard routes
router.get('/', setEdgeCacheHeaders, dashboardController.getDashboard);
router.get('/posts-report', setEdgeCacheHeaders, dashboardController.getPostsReport);
router.get('/income-chart', setEdgeCacheHeaders, dashboardController.getIncomeChart);

export default router;
