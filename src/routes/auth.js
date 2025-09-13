import express from 'express';
import * as authController from '../controllers/authController.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Public routes (no authentication required)
router.post('/signup', authController.register);
router.post('/signup/verify', authController.verifyOtp);
router.post('/login', authController.login);
router.post('/login/verify', authController.loginVerify);
router.post('/forgot-password/otp', authController.forgotPasswordRequest);
router.post('/forgot-password/verify', authController.forgotPasswordVerify);
router.post('/reset-password', authController.forgotPasswordReset);
router.post('/google', authController.googleSignin);
router.post('/apple', authController.appleSignin);
router.post('/init', authController.init);
router.get('/suspended', authController.suspended);

// Protected routes (authentication required)
router.post('/refresh', authController.refresh);
router.post('/logout', authMiddleware, authController.logout);
router.get('/validate', authMiddleware, authController.validate);

export default router;
