import express from 'express';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { getPage } from '../controllers/pagesController.js';

const router = express.Router();

// Pages routes
router.get('/:slug', optionalAuthMiddleware, getPage);

export default router;
