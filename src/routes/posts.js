import express from 'express';
import * as postsController from '../controllers/postsController.js';
import { authMiddleware } from '../middleware/auth.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.get('/create', authMiddleware, setEdgeCacheHeaders, postsController.getPostCreateData);
router.post('/create', authMiddleware, postsController.createPost);
router.get('/upload-url', authMiddleware, postsController.getPostUploadUrl);
router.get('/:username/:id', optionalAuthMiddleware, setEdgeCacheHeaders, postsController.getPostByUsernameAndId);

export default router;
