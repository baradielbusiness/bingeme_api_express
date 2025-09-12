import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import dotenv from 'dotenv';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './middleware/logger.js';
import { authMiddleware } from './middleware/auth.js';

// Import routes
import authRoutes from './routes/auth.js';
import callRoutes from './routes/call.js';
import contactRoutes from './routes/contact.js';
import creatorRoutes from './routes/creator.js';
import dashboardRoutes from './routes/dashboard.js';
import docsRoutes from './routes/docs.js';
import liveRoutes from './routes/live.js';
import mediaRoutes from './routes/media.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';
import pagesRoutes from './routes/pages.js';
import payoutRoutes from './routes/payout.js';
import postsRoutes from './routes/posts.js';
import privacyRoutes from './routes/privacy.js';
import productsRoutes from './routes/products.js';
import referralsRoutes from './routes/referrals.js';
import salesRoutes from './routes/sales.js';
import userRoutes from './routes/user.js';
import verificationRoutes from './routes/verification.js';

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use(logger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// API routes (matching original Lambda API paths)
app.use('/auth', authRoutes);
app.use('/call', callRoutes);
app.use('/contact', contactRoutes);
app.use('/creator', creatorRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/docs', docsRoutes);
app.use('/live', liveRoutes);
app.use('/media', mediaRoutes);
app.use('/messages', messageRoutes);
app.use('/notifications', notificationRoutes);
app.use('/pages', pagesRoutes);
app.use('/payout', payoutRoutes);
app.use('/posts', postsRoutes);
app.use('/privacy', privacyRoutes);
app.use('/products', productsRoutes);
app.use('/referrals', referralsRoutes);
app.use('/sales', salesRoutes);
app.use('/user', userRoutes);
app.use('/verification', verificationRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

export default app;
