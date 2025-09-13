import jwt from 'jsonwebtoken';
import { logInfo, logError } from '../utils/common.js';

/**
 * Optional JWT Authentication middleware
 * Validates JWT tokens if present but doesn't require them
 * Adds user info to request object if token is valid
 */
const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      req.userId = null;
      return next();
    }
    
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = decoded;
    req.userId = decoded.userId;
    logInfo('Optional auth - token verified successfully:', { userId: decoded.userId });
    next();
    
  } catch (error) {
    logError('Optional auth - invalid token:', error.message);
    req.user = null;
    req.userId = null;
    next();
  }
};

export default optionalAuthMiddleware;
