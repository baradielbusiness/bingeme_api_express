import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import {
  getPostCreateData,
  createPost,
  getPostUploadUrl,
  getPostByUsernameAndId,
  addComment,
  deleteComment,
  toggleLike,
  pinPost,
  unpinPost
} from '../controllers/postsController.js';

const router = express.Router();

// Post routes
router.get('/create', authMiddleware, getPostCreateData);
router.post('/create', authMiddleware, createPost);
router.get('/upload-url', authMiddleware, getPostUploadUrl);
router.get('/:username/:id', optionalAuthMiddleware, getPostByUsernameAndId);

// Comment routes
router.post('/comment', authMiddleware, addComment);
router.delete('/comment/:id', authMiddleware, deleteComment);

// Like routes
router.post('/like', authMiddleware, toggleLike);

// Pin routes
router.post('/pin', authMiddleware, pinPost);
router.delete('/pin', authMiddleware, unpinPost);

export default router;
