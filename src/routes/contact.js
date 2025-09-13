import express from 'express';
import * as contactController from '../controllers/contactController.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// Contact form routes (optional authentication)
router.get('/', setEdgeCacheHeaders, optionalAuthMiddleware, contactController.getContactUserInfo);
router.post('/', optionalAuthMiddleware, contactController.submitContactForm);

export default router;
