import express from 'express';
import * as notificationsController from '../controllers/notificationController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/', setEdgeCacheHeaders, notificationsController.getNotifications);
router.get('/settings', setEdgeCacheHeaders, notificationsController.getNotificationSettings);

export default router;
