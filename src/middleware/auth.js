import jwt from 'jsonwebtoken';
import { logError, createErrorResponse, isEncryptedId, decryptId } from '../utils/common.js';

/**
 * JWT Authentication middleware
 * Validates JWT tokens and adds user info to request object
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Check if authorization header exists and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createErrorResponse(401, 'Access token required'));
    }
    
    // Extract token from header
    const token = authHeader.substring(7);
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Decode 24-char encoded id if present, else use numeric id
    let userId = decoded.id ?? decoded.userId;
    if (typeof userId === 'string' && isEncryptedId(userId)) {
      try {
        userId = decryptId(userId);
      } catch (e) {
        return res.status(401).json(createErrorResponse(401, 'Invalid token format'));
      }
    }

    // Add user information to request object
    req.user = decoded;
    req.userId = userId;
    
    next();
  } catch (error) {
    logError('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createErrorResponse(401, 'Token expired'));
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createErrorResponse(401, 'Invalid access token'));
    } else {
      return res.status(401).json(createErrorResponse(401, 'Authentication failed'));
    }
  }
};

/**
 * Optional authentication middleware
 * Validates JWT tokens if present but doesn't require them
 */
const optionalAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      let userId = decoded.id ?? decoded.userId;
      if (typeof userId === 'string' && isEncryptedId(userId)) {
        try { userId = decryptId(userId); } catch (e) { userId = null; }
      }
      req.user = decoded;
      req.userId = userId ?? null;
    }
    
    next();
  } catch (error) {
    // For optional auth, we don't fail on invalid tokens
    // Just continue without user info
    next();
  }
};

/**
 * Enforce anonymous-only access tokens (Lambda parity for signup/login flows)
 */
const anonymousOnlyMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createErrorResponse(401, 'Access token required'));
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Decrypt id if needed
    let userId = decoded.id ?? decoded.userId;
    if (typeof userId === 'string' && isEncryptedId(userId)) {
      try { userId = decryptId(userId); } catch (e) { return res.status(401).json(createErrorResponse(401, 'Invalid token format')); }
    }

    // Enforce anonymous-only
    if (!(decoded.isAnonymous === true || decoded.role === 'anonymous')) {
      return res.status(403).json(createErrorResponse(403, 'Only anonymous access token allowed'));
    }

    req.user = decoded;
    req.userId = userId;
    next();
  } catch (error) {
    logError('Anonymous-only auth error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createErrorResponse(401, 'Token expired'));
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createErrorResponse(401, 'Invalid access token'));
    }
    return res.status(401).json(createErrorResponse(401, 'Authentication failed'));
  }
};

/**
 * Enforce authenticated (non-anonymous) access tokens
 */
const authenticatedOnlyMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createErrorResponse(401, 'Access token required'));
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Decrypt id if needed
    let userId = decoded.id ?? decoded.userId;
    if (typeof userId === 'string' && isEncryptedId(userId)) {
      try { userId = decryptId(userId); } catch (e) { return res.status(401).json(createErrorResponse(401, 'Invalid token format')); }
    }

    // Enforce non-anonymous
    if (decoded.isAnonymous === true || decoded.role === 'anonymous') {
      return res.status(403).json(createErrorResponse(403, 'Authenticated user token required'));
    }

    req.user = decoded;
    req.userId = userId;
    next();
  } catch (error) {
    logError('Authenticated-only auth error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createErrorResponse(401, 'Token expired'));
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createErrorResponse(401, 'Invalid access token'));
    }
    return res.status(401).json(createErrorResponse(401, 'Authentication failed'));
  }
};

// Export all functions at the end
export {
  authMiddleware,
  optionalAuthMiddleware,
  anonymousOnlyMiddleware,
  authenticatedOnlyMiddleware
};