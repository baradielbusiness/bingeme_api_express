import { createClient } from 'redis';
import { logInfo, logError } from '../utils/common.js';

let redisClient = null;

/**
 * Create Redis client
 * Establishes connection to Redis server
 */
const createRedisClient = () => {
  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logError('Redis server connection refused');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          logError('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          logError('Redis max retry attempts reached');
          return undefined;
        }
        return Math.min(options.attempt * 100, 3000);
      }
    });

    // Event handlers
    redisClient.on('error', (err) => {
      logError('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      logInfo('Redis Client Connected');
    });

    redisClient.on('ready', () => {
      logInfo('Redis Client Ready');
    });

    redisClient.on('end', () => {
      logInfo('Redis Client Disconnected');
    });

    return redisClient;
  } catch (error) {
    logError('Failed to create Redis client:', error);
    throw error;
  }
};

/**
 * Connect to Redis
 * Establishes connection to Redis server
 */
const connectRedis = async () => {
  try {
    const client = createRedisClient();
    
    // Add timeout to Redis connection
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
    );
    
    await Promise.race([connectPromise, timeoutPromise]);
    logInfo('Redis connected successfully');
    return client;
  } catch (error) {
    logError('Redis connection failed:', error);
    // In development mode, continue without Redis
    if (process.env.NODE_ENV === 'development') {
      logInfo('Continuing without Redis connection (development mode)');
      return null;
    }
    throw error;
  }
};

/**
 * Get Redis client
 * Returns the existing Redis client
 */
const getRedis = () => {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call connectRedis() first.');
  }
  return redisClient;
};

/**
 * Close Redis connection
 * Gracefully closes Redis connection
 */
const closeRedis = async () => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logInfo('Redis connection closed');
  }
};

// Export all functions at the end
export {
  createRedisClient,
  connectRedis,
  getRedis,
  closeRedis
};