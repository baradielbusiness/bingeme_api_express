import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { deleteMediaFile } from '../controllers/mediaController.js';

const router = express.Router();

// Delete media file from S3
router.delete('/delete', authMiddleware, deleteMediaFile);

export default router;
