import express from 'express';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

// Controllers needed to mirror serverless.yml paths
import * as authController from '../controllers/authController.js';
import * as userController from '../controllers/userController.js';
import * as productsController from '../controllers/productsController.js';
import * as postsController from '../controllers/postsController.js';
import * as messagesController from '../controllers/messageController.js';
import * as salesController from '../controllers/salesController.js';
import * as creatorController from '../controllers/creatorController.js';
import * as dashboardController from '../controllers/dashboardController.js';
import * as notificationsController from '../controllers/notificationController.js';
import * as payoutController from '../controllers/payoutController.js';
import * as verificationController from '../controllers/verificationController.js';
import * as contactController from '../controllers/contactController.js';
import * as callController from '../controllers/callController.js';
import * as pagesController from '../controllers/pagesController.js';

const router = express.Router();

// Map key serverless.yml paths to existing route/controller handlers

// Products
router.get('/products', setEdgeCacheHeaders, authMiddleware, productsController.getProducts);
router.get('/products/create', authMiddleware, productsController.getProductCreateData);
router.get('/product/edit/:id', authMiddleware, productsController.getProductById);
router.put('/product/edit/:id', authMiddleware, productsController.updateProduct);
router.delete('/product/delete/:id', authMiddleware, productsController.deleteProduct);
router.get('/product/upload-url', authMiddleware, productsController.getProductUploadUrl);

// Posts
router.get('/posts/create', authMiddleware, postsController.getPostCreateData);
router.post('/posts/create', authMiddleware, postsController.createPost);
router.get('/posts/upload-url', authMiddleware, postsController.getPostUploadUrl);
router.get('/posts/:username/:id', optionalAuthMiddleware, postsController.getPostByUsernameAndId);

// Messages
router.get('/messages/conversation', authMiddleware, messagesController.getConversation);
router.get('/messages/conversation/search', authMiddleware, messagesController.getConversationSearch);
router.get('/messages/:id', authMiddleware, messagesController.getMessagesInbox);
router.get('/messages/:id/:username', authMiddleware, messagesController.getMessagesInbox);
router.get('/messages/by-id/:messageId', authMiddleware, messagesController.getMessageById);
router.delete('/messages/delete', authMiddleware, messagesController.deleteMessage);
router.delete('/messages/conversation/delete/:id', authMiddleware, messagesController.deleteConversation);
router.get('/messages/upload-url', authMiddleware, messagesController.getMessageUploadUrl);
router.post('/messages/send', authMiddleware, messagesController.sendMessage);
router.post('/messages/send-massive', authMiddleware, messagesController.sendMassiveMessage);

// User consolidated
router.get('/creator/subscribers', authMiddleware, userController.getSubscribers);
router.get('/posts', setEdgeCacheHeaders, authMiddleware, userController.getMyPosts);
router.get('/updates', setEdgeCacheHeaders, authMiddleware, userController.getUpdates);
router.put('/posts/edit', authMiddleware, userController.editUpdate);
router.delete('/posts/delete/:id', authMiddleware, userController.deleteUpdate);
router.get('/comments/:id', setEdgeCacheHeaders, authMiddleware, userController.getComments);
router.post('/user/send-otp', authMiddleware, userController.sendOtp);
router.post('/user/profile/verify-otp', authMiddleware, userController.verifyOtp);
router.get('/user/profile', setEdgeCacheHeaders, authMiddleware, userController.getSettings);
router.post('/user/profile', authMiddleware, userController.postSettings);
router.get('/user/info', authMiddleware, userController.getUserInfo);
router.get('/user/search', authMiddleware, userController.searchUsers);
router.post('/user/mode/:mode', authMiddleware, userController.darkMode);
router.post('/user/change-password', authMiddleware, userController.changePassword);
router.get('/user/cover/upload-url', authMiddleware, userController.getUserCoverUploadUrl);
router.post('/user/cover', authMiddleware, userController.createUserCover);
router.get('/user/avatar/upload-url', authMiddleware, userController.getUserAvatarUploadUrl);
router.post('/user/avatar', authMiddleware, userController.createUserAvatar);
router.post('/user/block/:id', authMiddleware, userController.blockUser);
router.post('/restrict/:id', authMiddleware, userController.restrictUser);
router.delete('/restrict/:id', authMiddleware, userController.unrestrictUser);
router.get('/restrict/user', authMiddleware, userController.getRestrictions);
router.get('/:slug', optionalAuthMiddleware, userController.getProfile);

// Sales
router.get('/sales', authMiddleware, salesController.getSales);
router.post('/sales/delivered-product/:id', authMiddleware, salesController.deliveredProduct);
router.post('/sales/reject-order/:id', authMiddleware, salesController.rejectOrder);

// Creator
router.get('/creator/settings', authMiddleware, creatorController.getCreatorSettings);
router.post('/creator/settings', authMiddleware, creatorController.updateCreatorSettings);
router.get('/creator/block-countries', authMiddleware, creatorController.getBlockedCountries);
router.post('/creator/block-countries', authMiddleware, creatorController.updateBlockedCountries);
router.get('/creator/subscription-setting', authMiddleware, creatorController.getSubscriptionSettings);
router.post('/creator/subscription-setting', authMiddleware, creatorController.updateSubscriptionSettings);
router.get('/creator/agreement', authMiddleware, creatorController.getCreatorAgreement);
router.post('/creator/agreement', authMiddleware, creatorController.postCreatorAgreement);
router.get('/creator/agreement-pdf', authMiddleware, creatorController.downloadCreatorAgreementPdf);
router.get('/creator/upload-url', authMiddleware, creatorController.getUploadUrl);
router.get('/creator/payment-received', authMiddleware, creatorController.getPaymentsReceived);
router.get('/creator/withdrawals', authMiddleware, creatorController.getWithdrawals);

// Dashboard
router.get('/dashboard', authMiddleware, dashboardController.getDashboard);
router.get('/dashboard/posts-report', authMiddleware, dashboardController.getPostsReport);
router.get('/dashboard/income-chart', authMiddleware, dashboardController.getIncomeChart);

// Notifications
router.get('/notifications', authMiddleware, notificationsController.getNotifications);
router.get('/notification/settings', authMiddleware, notificationsController.getNotificationSettings);
router.post('/notification/settings', authMiddleware, notificationsController.updateNotificationSettings);
router.delete('/notifications/delete/:id', authMiddleware, notificationsController.deleteNotificationById);
router.delete('/notifications/delete-all', authMiddleware, notificationsController.deleteAllNotifications);

// Payout
router.get('/payout', authMiddleware, payoutController.getPayoutMethod);
router.post('/payout/create', authMiddleware, payoutController.createPayoutMethod);
router.delete('/payout/delete', authMiddleware, payoutController.deletePayoutMethod);
router.get('/payout/conversations', authMiddleware, payoutController.getPayoutConversations);
router.post('/payout/conversations/store', authMiddleware, payoutController.storePayoutConversation);
router.get('/payout/upload-url', authMiddleware, payoutController.getPayoutUploadUrl);

// Verification
router.get('/verification/upload-url', authMiddleware, verificationController.getVerificationUploadUrl);
router.get('/verification/account', authMiddleware, verificationController.getVerificationAccount);
router.post('/verification/account', authMiddleware, verificationController.verifyAccountSend);
router.get('/verification/conversations', authMiddleware, verificationController.getVerificationConversations);
router.post('/verification/conversations', authMiddleware, verificationController.storeVerificationConversation);

// Contact
router.get('/contact', optionalAuthMiddleware, contactController.getContactInfo);
router.post('/contact', optionalAuthMiddleware, contactController.submitContactForm);

// Call
router.get('/vc/agora/details', authMiddleware, callController.getAgoraDetails);

// Pages
router.get('/p/:slug', optionalAuthMiddleware, pagesController.getPage);

export default router;


