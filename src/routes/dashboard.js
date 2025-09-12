import express from 'express';
import * as dashboardController from '../controllers/dashboardController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// All dashboard routes require authentication
router.use(authMiddleware);

// Dashboard routes
router.get('/', dashboardController.getDashboard);
router.get('/posts-report', dashboardController.getPostsReport);
router.get('/income-chart', dashboardController.getIncomeChart);

export default router;
