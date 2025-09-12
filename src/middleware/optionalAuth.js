import jwt from 'jsonwebtoken';
import { logInfo, logError } from '../utils/common.js';

/**
 * Optional JWT Authentication middleware
 * Validates JWT tokens if present but doesn't require them
 * Adds user info to request object if token is valid
 */
export const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    // If no authorization header, continue without user info
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.userId = null;
      return next();
    }
    
    // Extract token from header
    const token = authHeader.substring(7);
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    // Add user information to request object
    req.user = decoded;
    req.userId = decoded.userId;
    
    logInfo('Optional auth - token verified successfully:', { userId: decoded.userId });
    next();
    
  } catch (error) {
    // If token is invalid, continue without user info
    logError('Optional auth - invalid token:', error.message);
    req.user = null;
    req.userId = null;
    next();
  }
};
