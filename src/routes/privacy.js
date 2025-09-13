import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';
import {
  getPrivacySecurity,
  updatePrivacySecurity,
  getAccountDeletionStatus,
  deleteAccount,
  deleteAccountWithOtp,
  clearSessions,
  getAccountRetrieve,
  retrieveAccount
} from '../controllers/privacyController.js';

const router = express.Router();

// Privacy & Security Settings
router.get('/security', setEdgeCacheHeaders, authMiddleware, getPrivacySecurity);
router.post('/security', authMiddleware, updatePrivacySecurity);
router.post('/security/clear-sessions', authMiddleware, clearSessions);

// Account Deletion
router.get('/account/delete', setEdgeCacheHeaders, authMiddleware, getAccountDeletionStatus);
router.post('/account/delete', authMiddleware, deleteAccount);
router.post('/account/delete/otp', authMiddleware, deleteAccountWithOtp);

// Account Retrieval
router.get('/account/retrieve', setEdgeCacheHeaders, authMiddleware, getAccountRetrieve);
router.post('/account/retrieve', authMiddleware, retrieveAccount);

export default router;
