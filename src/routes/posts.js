import express from 'express';
import * as postsController from '../controllers/postsController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/create', setEdgeCacheHeaders, postsController.getPostCreateData);
router.get('/:username/:id', setEdgeCacheHeaders, postsController.getPostByUsernameAndId);

export default router;
