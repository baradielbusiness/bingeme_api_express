import express from 'express';
import * as creatorController from '../controllers/creatorController.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// All creator routes require authentication
router.use(authMiddleware);

// Creator settings
router.get('/settings', creatorController.getCreatorSettings);
router.post('/settings', creatorController.updateCreatorSettings);

// Blocked countries
router.get('/block-countries', creatorController.getBlockedCountries);
router.post('/block-countries', creatorController.updateBlockedCountries);

// Subscription settings
router.get('/subscription-setting', creatorController.getSubscriptionSettings);
router.post('/subscription-setting', creatorController.updateSubscriptionSettings);

// Creator agreement
router.get('/agreement', creatorController.getCreatorAgreement);
router.post('/agreement', creatorController.postCreatorAgreement);
router.get('/agreement-pdf', creatorController.downloadCreatorAgreementPdf);

// Uploads
router.get('/upload-url', creatorController.getUploadUrl);

// Dashboard
router.get('/dashboard', creatorController.getDashboard);

// Payments
router.get('/payment-received', creatorController.getPaymentsReceived);

// Withdrawals
router.get('/withdrawals', creatorController.getWithdrawals);

export default router;
