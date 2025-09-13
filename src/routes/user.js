import express from 'express';
import * as userController from '../controllers/userController.js';
import { authMiddleware } from '../middleware/auth.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/posts', setEdgeCacheHeaders, userController.getMyPosts);
router.get('/updates', setEdgeCacheHeaders, userController.getUpdates);
router.get('/comments/:id', setEdgeCacheHeaders, userController.getComments);
router.get('/profile', setEdgeCacheHeaders, userController.getSettings);
router.get('/restrictions', setEdgeCacheHeaders, userController.getRestrictions);
router.get('/:slug', setEdgeCacheHeaders, optionalAuthMiddleware, userController.getProfile);

export default router;
