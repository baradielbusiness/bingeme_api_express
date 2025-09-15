import express from 'express';
import * as notificationsController from '../controllers/notificationController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.use(authMiddleware);

// Notification endpoints
router.get('/', setEdgeCacheHeaders, notificationsController.getNotifications);
router.get('/settings', setEdgeCacheHeaders, notificationsController.getNotificationSettings);
router.post('/settings', notificationsController.updateNotificationSettings);

// Notification management endpoints
router.delete('/delete/:id', notificationsController.deleteNotificationById);
router.delete('/delete-all', notificationsController.deleteAllNotifications);

export default router;
