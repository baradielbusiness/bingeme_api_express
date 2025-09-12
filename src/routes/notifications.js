import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getNotifications,
  getNotificationSettings,
  updateNotificationSettings,
  deleteNotificationById,
  deleteAllNotifications
} from '../controllers/notificationController.js';

const router = express.Router();

// Notification routes
router.get('/', authMiddleware, getNotifications);
router.get('/settings', authMiddleware, getNotificationSettings);
router.post('/settings', authMiddleware, updateNotificationSettings);
router.delete('/delete/:id', authMiddleware, deleteNotificationById);
router.delete('/delete-all', authMiddleware, deleteAllNotifications);

export default router;
