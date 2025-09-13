import express from 'express';
import * as userController from '../controllers/userController.js';
import { authMiddleware } from '../middleware/auth.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// Public routes (no authentication required)
router.get('/:slug', setEdgeCacheHeaders, optionalAuthMiddleware, userController.getProfile);

// Protected routes (authentication required)
router.use(authMiddleware);

// Posts and updates
router.get('/posts', setEdgeCacheHeaders, userController.getMyPosts);
router.get('/updates', setEdgeCacheHeaders, userController.getUpdates);
router.put('/posts/edit', userController.editUpdate);
router.delete('/posts/delete/:id', userController.deleteUpdate);
router.get('/comments/:id', setEdgeCacheHeaders, userController.getComments);

// User profile and settings
router.get('/profile', setEdgeCacheHeaders, userController.getSettings);
router.post('/profile', userController.postSettings);
router.get('/user/info', setEdgeCacheHeaders, userController.getUserInfo);
router.get('/user/search', setEdgeCacheHeaders, userController.searchUsers);
router.post('/user/mode/:mode', userController.darkMode);
router.post('/user/change-password', userController.changePassword);

// OTP and verification
router.post('/user/send-otp', userController.sendOtp);
router.post('/user/profile/verify-otp', userController.verifyOtp);
router.post('/create/password', userController.createPasswordOtp);
router.post('/create/password/verify', userController.verifyPasswordOtp);

// Profile images
router.get('/user/cover/upload-url', userController.getUserCoverUploadUrl);
router.post('/user/cover', userController.createUserCover);
router.get('/user/avatar/upload-url', userController.getUserAvatarUploadUrl);
router.post('/user/avatar', userController.createUserAvatar);

// User management
router.post('/user/block/:id', userController.blockUser);
router.post('/restrict/:id', userController.restrictUser);
router.delete('/restrict/:id', userController.unrestrictUser);
router.get('/restrict/user', setEdgeCacheHeaders, userController.getRestrictions);

// Creator subscribers
router.get('/creator/subscribers', setEdgeCacheHeaders, userController.getSubscribers);

export default router;
