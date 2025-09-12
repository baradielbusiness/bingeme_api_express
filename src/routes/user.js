import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import {
  getSubscribers,
  getMyPosts,
  getUpdates,
  editUpdate,
  deleteUpdate,
  getComments,
  getSettings,
  postSettings,
  sendOtp,
  verifyOtp,
  getUserInfo,
  searchUsers,
  changePassword,
  getUserCoverUploadUrl,
  createUserCover,
  getUserAvatarUploadUrl,
  createUserAvatar,
  createPasswordOtp,
  verifyPasswordOtp,
  blockUser,
  restrictUser,
  unrestrictUser,
  getRestrictions,
  getProfile
} from '../controllers/userController.js';

const router = express.Router();

// Subscribers
router.get('/creator/subscribers', authMiddleware, getSubscribers);

// Posts
router.get('/posts', authMiddleware, getMyPosts);
router.put('/posts/edit', authMiddleware, editUpdate);
router.delete('/posts/delete/:id', authMiddleware, deleteUpdate);

// Updates
router.get('/updates', authMiddleware, getUpdates);

// Comments
router.get('/comments/:id', authMiddleware, getComments);

// User settings and profile
router.get('/profile', authMiddleware, getSettings);
router.post('/profile', authMiddleware, postSettings);
router.get('/info', authMiddleware, getUserInfo);
router.get('/search', authMiddleware, searchUsers);

// Password management
router.post('/change-password', authMiddleware, changePassword);
router.post('/create/password', authMiddleware, createPasswordOtp);
router.post('/create/password/verify', authMiddleware, verifyPasswordOtp);

// OTP management
router.post('/send-otp', authMiddleware, sendOtp);
router.post('/profile/verify-otp', authMiddleware, verifyOtp);

// Dark mode
router.post('/mode/:mode', authMiddleware, darkMode);

// Profile images
router.get('/cover/upload-url', authMiddleware, getUserCoverUploadUrl);
router.post('/cover', authMiddleware, createUserCover);
router.get('/avatar/upload-url', authMiddleware, getUserAvatarUploadUrl);
router.post('/avatar', authMiddleware, createUserAvatar);

// User blocking
router.post('/block/:id', authMiddleware, blockUser);

// User restrictions
router.post('/restrict/:id', authMiddleware, restrictUser);
router.delete('/restrict/:id', authMiddleware, unrestrictUser);
router.get('/restrictions', authMiddleware, getRestrictions);

// Profile by slug (public route)
router.get('/:slug', optionalAuthMiddleware, getProfile);

export default router;
