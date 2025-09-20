import express from 'express';
import * as userController from '../controllers/userController.js';
import { authMiddleware } from '../middleware/auth.js';
import optionalAuthMiddleware from '../middleware/optionalAuth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// Public routes (no authentication required)
// Note: /:slug route moved to aliases.js to avoid conflict with specific routes like /user/info

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
// Note: /info route moved to aliases.js as /user/info to avoid conflict with profile slug routes
router.get('/search', setEdgeCacheHeaders, userController.searchUsers);
router.post('/mode/:mode', userController.darkMode);
router.post('/change-password', userController.changePassword);

// OTP and verification
router.post('/send-otp', userController.sendOtp);
router.post('/profile/verify-otp', userController.verifyOtp);
router.post('/create/password', userController.createPasswordOtp);
router.post('/create/password/verify', userController.verifyPasswordOtp);

// Profile images
router.get('/cover/upload-url', userController.getUserCoverUploadUrl);
router.post('/cover', userController.createUserCover);
router.get('/avatar/upload-url', userController.getUserAvatarUploadUrl);
router.post('/avatar', userController.createUserAvatar);

// User management
router.post('/block/:id', userController.blockUser);
router.post('/restrict/:id', userController.restrictUser);
router.get('/restrict/user', setEdgeCacheHeaders, userController.getRestrictions);

// Creator subscribers
router.get('/creator/subscribers', setEdgeCacheHeaders, userController.getSubscribers);

export default router;
