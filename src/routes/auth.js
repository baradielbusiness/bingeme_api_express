import express from 'express';
import * as authController from '../controllers/authController.js';
import { authMiddleware, optionalAuthMiddleware, anonymousOnlyMiddleware, authenticatedOnlyMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Routes requiring anonymous tokens (Lambda-style anonymous-required)
router.post('/signup', anonymousOnlyMiddleware, authController.register);
router.post('/signup/verify', anonymousOnlyMiddleware, authController.verifyOtp);
router.post('/login', anonymousOnlyMiddleware, authController.login);
router.post('/login/verify', anonymousOnlyMiddleware, authController.loginVerify);

// Public forgot-password routes (Lambda allows without token)
router.post('/forgot-password/otp', authController.forgotPasswordRequest);
router.post('/forgot-password/verify', authController.forgotPasswordVerify);
router.post('/reset-password', authController.forgotPasswordReset);

// Public routes
router.post('/google', authController.googleSignin);
router.post('/apple', authController.appleSignin);
router.post('/init', authController.init);

// Protected routes (authenticated user token required)
router.post('/refresh', authController.refresh);
router.post('/logout', authenticatedOnlyMiddleware, authController.logout);
router.get('/validate', authenticatedOnlyMiddleware, authController.validate);
router.get('/suspended', authenticatedOnlyMiddleware, authController.suspended);

export default router;
