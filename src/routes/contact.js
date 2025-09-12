import express from 'express';
import * as contactController from '../controllers/contactController.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Contact form routes (optional authentication)
router.get('/', optionalAuthMiddleware, contactController.getContactInfo);
router.post('/', optionalAuthMiddleware, contactController.submitContactForm);

export default router;
