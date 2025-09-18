// DynamoDB-based rate limiting middleware for Express
// Provides distributed rate limiting across instances using DynamoDB

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logInfo, logError } from '../utils/common.js';

// Create DynamoDB client
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'eu-west-2'
});

const docClient = DynamoDBDocumentClient.from(ddbClient);

// DynamoDB-based rate limiting middleware
const createDynamoDBRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    maxRequests = 100,
    prefix = 'rl',
    tableName = `rate_limits-${process.env.NODE_ENV || 'dev'}`,
    message = 'Too many requests, please try again later.',
    standardHeaders = true,
    legacyHeaders = false,
    skipSuccessfulRequests = false,
    skipFailedRequests = false
  } = options;

  return async (req, res, next) => {
    try {
      // Get client IP
      const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '0.0.0.0';
      const key = `${prefix}:${ip}`;
      
      const identifier = key;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Try to get existing record
      const getResult = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { identifier }
      }));

      let requestCount = 0;
      let resetTime = new Date(now + windowMs);

      if (getResult.Item) {
        const record = getResult.Item;
        requestCount = record.count || 0;
        const lastRequestTime = record.timestamp || 0;

        // If within the same window, check count
        if (lastRequestTime >= windowStart) {
          if (requestCount >= maxRequests) {
            // Rate limit exceeded
            const remainingTime = Math.ceil((lastRequestTime + windowMs - now) / 1000);
            
            if (standardHeaders) {
              res.set({
                'X-RateLimit-Limit': maxRequests,
                'X-RateLimit-Remaining': 0,
                'X-RateLimit-Reset': new Date(lastRequestTime + windowMs).toISOString()
              });
            }

            if (legacyHeaders) {
              res.set({
                'X-RateLimit-Limit': maxRequests,
                'X-RateLimit-Remaining': 0,
                'X-RateLimit-Reset': Math.ceil((lastRequestTime + windowMs) / 1000)
              });
            }

            return res.status(429).json({ 
              error: message,
              retryAfter: remainingTime
            });
          }

          // Increment count
          await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { identifier },
            UpdateExpression: 'SET #count = #count + :inc, #timestamp = :timestamp',
            ExpressionAttributeNames: {
              '#count': 'count',
              '#timestamp': 'timestamp'
            },
            ExpressionAttributeValues: {
              ':inc': 1,
              ':timestamp': now
            }
          }));

          requestCount = requestCount + 1;
          resetTime = new Date(lastRequestTime + windowMs);
        } else {
          // New window, reset count
          await docClient.send(new PutCommand({
            TableName: tableName,
            Item: {
              identifier,
              count: 1,
              timestamp: now,
              expires_at: Math.floor((now + windowMs) / 1000) // TTL in seconds
            }
          }));

          requestCount = 1;
          resetTime = new Date(now + windowMs);
        }
      } else {
        // First request, create record
        await docClient.send(new PutCommand({
          TableName: tableName,
          Item: {
            identifier,
            count: 1,
            timestamp: now,
            expires_at: Math.floor((now + windowMs) / 1000) // TTL in seconds
          }
        }));

        requestCount = 1;
        resetTime = new Date(now + windowMs);
      }

      // Set rate limit headers
      if (standardHeaders) {
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': Math.max(0, maxRequests - requestCount),
          'X-RateLimit-Reset': resetTime.toISOString()
        });
      }

      if (legacyHeaders) {
        res.set({
          'X-RateLimit-Limit': maxRequests,
          'X-RateLimit-Remaining': Math.max(0, maxRequests - requestCount),
          'X-RateLimit-Reset': Math.ceil(resetTime.getTime() / 1000)
        });
      }

      next();
    } catch (error) {
      logError('DynamoDB rate limit middleware error:', error);
      // On error, allow the request to proceed (fail open)
      next();
    }
  };
};

// Pre-configured limiters
const apiLimiter = createDynamoDBRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  prefix: 'rl',
  message: 'Too many requests, please try again later.'
});

const sensitiveLimiter = createDynamoDBRateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxRequests: 50,
  prefix: 'rls',
  message: 'Too many attempts, please slow down.'
});

const authLimiter = createDynamoDBRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 20,
  prefix: 'auth',
  message: 'Too many authentication attempts, please try again later.'
});

// Export all functions at the end
export {
  createDynamoDBRateLimit,
  apiLimiter,
  sensitiveLimiter,
  authLimiter
};