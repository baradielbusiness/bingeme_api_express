import jwt from 'jsonwebtoken';
import { logError } from '../utils/common.js';

/**
 * JWT Authentication middleware
 * Validates JWT tokens and adds user info to request object
 */
export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Check if authorization header exists and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Access token required',
        message: 'Please provide a valid authorization token'
      });
    }
    
    // Extract token from header
    const token = authHeader.substring(7);
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    // Add user information to request object
    req.user = decoded;
    req.userId = decoded.userId;
    
    next();
  } catch (error) {
    logError('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Please refresh your token'
      });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        message: 'Please provide a valid token'
      });
    } else {
      return res.status(401).json({ 
        error: 'Authentication failed',
        message: 'Unable to authenticate request'
      });
    }
  }
};

/**
 * Optional authentication middleware
 * Validates JWT tokens if present but doesn't require them
 */
export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      req.user = decoded;
      req.userId = decoded.userId;
    }
    
    next();
  } catch (error) {
    // For optional auth, we don't fail on invalid tokens
    // Just continue without user info
    next();
  }
};
