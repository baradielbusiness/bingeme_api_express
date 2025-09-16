import jwt from 'jsonwebtoken';
import { logError, createExpressErrorResponse, isEncryptedId, decryptId } from '../utils/common.js';

/**
 * JWT Authentication middleware
 * Validates JWT tokens and adds user info to request object
 */
export const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    // Check if authorization header exists and starts with 'Bearer '
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createExpressErrorResponse('Access token required', 401));
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
        return res.status(401).json(createExpressErrorResponse('Invalid token format', 401));
      }
    }

    // Add user information to request object
    req.user = decoded;
    req.userId = userId;
    
    next();
  } catch (error) {
    logError('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createExpressErrorResponse('Token expired', 401));
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createExpressErrorResponse('Invalid access token', 401));
    } else {
      return res.status(401).json(createExpressErrorResponse('Authentication failed', 401));
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
export const anonymousOnlyMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createExpressErrorResponse('Access token required', 401));
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Decrypt id if needed
    let userId = decoded.id ?? decoded.userId;
    if (typeof userId === 'string' && isEncryptedId(userId)) {
      try { userId = decryptId(userId); } catch (e) { return res.status(401).json(createExpressErrorResponse('Invalid token format', 401)); }
    }

    // Enforce anonymous-only
    if (!(decoded.isAnonymous === true || decoded.role === 'anonymous')) {
      return res.status(403).json(createExpressErrorResponse('Only anonymous access token allowed', 403));
    }

    req.user = decoded;
    req.userId = userId;
    next();
  } catch (error) {
    logError('Anonymous-only auth error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createExpressErrorResponse('Token expired', 401));
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createExpressErrorResponse('Invalid access token', 401));
    }
    return res.status(401).json(createExpressErrorResponse('Authentication failed', 401));
  }
};

/**
 * Enforce authenticated (non-anonymous) access tokens
 */
export const authenticatedOnlyMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json(createExpressErrorResponse('Access token required', 401));
    }
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // Decrypt id if needed
    let userId = decoded.id ?? decoded.userId;
    if (typeof userId === 'string' && isEncryptedId(userId)) {
      try { userId = decryptId(userId); } catch (e) { return res.status(401).json(createExpressErrorResponse('Invalid token format', 401)); }
    }

    // Enforce non-anonymous
    if (decoded.isAnonymous === true || decoded.role === 'anonymous') {
      return res.status(403).json(createExpressErrorResponse('Authenticated user token required', 403));
    }

    req.user = decoded;
    req.userId = userId;
    next();
  } catch (error) {
    logError('Authenticated-only auth error:', error);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json(createExpressErrorResponse('Token expired', 401));
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json(createExpressErrorResponse('Invalid access token', 401));
    }
    return res.status(401).json(createExpressErrorResponse('Authentication failed', 401));
  }
};
