import express from 'express';
import * as liveController from '../controllers/liveController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// Live filter endpoints
router.get('/filter', authMiddleware, setEdgeCacheHeaders, liveController.getLiveFilter);
router.post('/filter', authMiddleware, liveController.postLiveFilter);

// Live creation endpoints
router.get('/create', authMiddleware, setEdgeCacheHeaders, liveController.getLiveCreate);
router.post('/create', authMiddleware, liveController.postLiveCreate);

// Live management endpoints
router.get('/go/:liveId', authMiddleware, setEdgeCacheHeaders, liveController.getLiveGo);
router.get('/edit/:liveId', authMiddleware, setEdgeCacheHeaders, liveController.getLiveEdit);
router.delete('/delete/:id', authMiddleware, liveController.deleteLive);

// Live settings endpoints
router.put('/edit/tipmenu', authMiddleware, liveController.putLiveEditTipmenu);
router.post('/goal', authMiddleware, liveController.postLiveGoal);

export default router;
