import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getSales,
  deliveredProduct,
  rejectOrder
} from '../controllers/salesController.js';

const router = express.Router();

// Get user's sales list with filtering, sorting, and pagination
router.get('/', authMiddleware, getSales);

// Mark a purchase as delivered
router.post('/delivered-product/:id', authMiddleware, deliveredProduct);

// Mark a purchase as rejected
router.post('/reject-order/:id', authMiddleware, rejectOrder);

export default router;
