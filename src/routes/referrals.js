import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { getReferrals } from '../controllers/referralsController.js';

const router = express.Router();

// Get user referrals with pagination
router.get('/', authMiddleware, getReferrals);

export default router;
