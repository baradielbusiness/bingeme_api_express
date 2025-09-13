import express from 'express';
import * as creatorController from '../controllers/creatorController.js';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

// All creator routes require authentication
router.use(authMiddleware);

// Creator settings
router.get('/settings', setEdgeCacheHeaders, creatorController.getCreatorSettings);
router.post('/settings', creatorController.updateCreatorSettings);

// Blocked countries
router.get('/block-countries', setEdgeCacheHeaders, creatorController.getBlockedCountries);
router.post('/block-countries', creatorController.updateBlockedCountries);

// Subscription settings
router.get('/subscription-setting', setEdgeCacheHeaders,creatorController.getSubscriptionSettings);
router.post('/subscription-setting', creatorController.updateSubscriptionSettings);

// Creator agreement
router.get('/agreement', setEdgeCacheHeaders,creatorController.getCreatorAgreement);
router.post('/agreement', creatorController.postCreatorAgreement);
router.get('/agreement-pdf', setEdgeCacheHeaders, creatorController.downloadCreatorAgreementPdf);

// Uploads
router.get('/upload-url', creatorController.getUploadUrl);

// Dashboard
router.get('/dashboard', setEdgeCacheHeaders, creatorController.getDashboard);

// Payments
router.get('/payment-received', setEdgeCacheHeaders, creatorController.getPaymentsReceived);

// Withdrawals
router.get('/withdrawals', setEdgeCacheHeaders, creatorController.getWithdrawals);

export default router;
