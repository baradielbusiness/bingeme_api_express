import express from 'express';
import * as pagesController from '../controllers/pagesController.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// Page routes (optional authentication - pages can have access control)
router.get('/pages/:slug', setEdgeCacheHeaders, optionalAuthMiddleware, pagesController.getPage);
router.get('/p/:slug', setEdgeCacheHeaders, optionalAuthMiddleware, pagesController.getPage);

export default router;
