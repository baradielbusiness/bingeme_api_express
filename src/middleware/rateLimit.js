// Express rate limit middleware with DynamoDB store
// Provides distributed rate limiting across instances using DynamoDB

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { logInfo, logError } from '../utils/common.js';

// Create DynamoDB client
const ddbClient = new DynamoDBClient({
  region: process.env.AWS_DEFAULT_REGION || 'eu-west-2'
});

const docClient = DynamoDBDocumentClient.from(ddbClient);

// DynamoDB-based rate limiting store
class DynamoDBRateLimitStore {
  constructor(options = {}) {
    this.tableName = options.tableName || `rate_limits-${process.env.NODE_ENV || 'dev'}`;
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes default
    this.maxRequests = options.maxRequests || 100;
    this.prefix = options.prefix || 'rl';
  }

  async increment(key, cb) {
    try {
      const identifier = `${this.prefix}:${key}`;
      const now = Date.now();
      const windowStart = now - this.windowMs;

      // Try to get existing record
      const getResult = await docClient.send(new GetCommand({
        TableName: this.tableName,
        Key: { identifier }
      }));

      if (getResult.Item) {
        const record = getResult.Item;
        const requestCount = record.count || 0;
        const lastRequestTime = record.timestamp || 0;

        // If within the same window, check count
        if (lastRequestTime >= windowStart) {
          if (requestCount >= this.maxRequests) {
            return cb(null, requestCount, new Date(lastRequestTime + this.windowMs), false);
          }

          // Increment count
          await docClient.send(new UpdateCommand({
            TableName: this.tableName,
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

          return cb(null, requestCount + 1, new Date(lastRequestTime + this.windowMs), false);
        } else {
          // New window, reset count
          await docClient.send(new PutCommand({
            TableName: this.tableName,
            Item: {
              identifier,
              count: 1,
              timestamp: now,
              expires_at: Math.floor((now + this.windowMs) / 1000) // TTL in seconds
            }
          }));

          return cb(null, 1, new Date(now + this.windowMs), false);
        }
      } else {
        // First request, create record
        await docClient.send(new PutCommand({
          TableName: this.tableName,
          Item: {
            identifier,
            count: 1,
            timestamp: now,
            expires_at: Math.floor((now + this.windowMs) / 1000) // TTL in seconds
          }
        }));

        return cb(null, 1, new Date(now + this.windowMs), false);
      }
    } catch (error) {
      logError('DynamoDB rate limit error:', error);
      return cb(error, 0, new Date(), false);
    }
  }

  async decrement(key) {
    // DynamoDB rate limiting doesn't need decrement for sliding window
    // TTL will handle cleanup
  }

  async resetKey(key) {
    try {
      const identifier = `${this.prefix}:${key}`;
      await docClient.send(new PutCommand({
        TableName: this.tableName,
        Item: {
          identifier,
          count: 0,
          timestamp: Date.now(),
          expires_at: Math.floor((Date.now() + this.windowMs) / 1000)
        }
      }));
    } catch (error) {
      logError('DynamoDB rate limit reset error:', error);
    }
  }
}

// General API limiter
const apiLimiter = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  store: new DynamoDBRateLimitStore({
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
    prefix: 'rl'
  })
};

// Sensitive endpoints tighter limiter (e.g., auth, OTP)
const sensitiveLimiter = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please slow down.' },
  store: new DynamoDBRateLimitStore({
    windowMs: 10 * 60 * 1000,
    maxRequests: 50,
    prefix: 'rls'
  })
};

export {
  apiLimiter,
  sensitiveLimiter,
  DynamoDBRateLimitStore
};


