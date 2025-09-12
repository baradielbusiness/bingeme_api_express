import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getLiveCreate,
  postLiveCreate,
  getLiveEdit,
  deleteLive,
  getLiveFilter,
  postLiveFilter,
  putLiveEditTipmenu,
  postLiveGoal,
  getLiveGo
} from '../controllers/liveController.js';

const router = express.Router();

// Live creation routes
router.get('/create', authMiddleware, getLiveCreate);
router.post('/create', authMiddleware, postLiveCreate);

// Live editing routes
router.get('/edit/:liveId', authMiddleware, getLiveEdit);
router.delete('/delete/:id', authMiddleware, deleteLive);

// Live filter routes
router.get('/filter', authMiddleware, getLiveFilter);
router.post('/filter', authMiddleware, postLiveFilter);

// Live tipmenu editing
router.put('/edit/tipmenu', authMiddleware, putLiveEditTipmenu);

// Live goal management
router.post('/goal', authMiddleware, postLiveGoal);

// Live go (join live stream)
router.get('/go/:liveId', authMiddleware, getLiveGo);

export default router;
