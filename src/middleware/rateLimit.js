// Express rate limit middleware with Redis store
// Provides distributed rate limiting across instances.

const rateLimit = require('express-rate-limit');
const { createClient } = require('redis');
const RedisStore = require('rate-limit-redis');

// Create a shared Redis client for rate limiting
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379)
  },
  password: process.env.REDIS_PASSWORD || undefined
});

// Connect on server boot; export a ready promise for app.js to await if needed
const redisReady = (async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    // If Redis is unavailable, fallback to in-memory limiting to avoid downtime
    // eslint-disable-next-line no-console
    console.warn('[rateLimit] Redis connection failed, falling back to memory store:', error.message);
  }
})();

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  store: redisClient.isOpen
    ? new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix: 'rl:'
      })
    : undefined // fallback to memory store when Redis is not connected
});

// Sensitive endpoints tighter limiter (e.g., auth, OTP)
const sensitiveLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please slow down.' },
  store: redisClient.isOpen
    ? new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix: 'rls:'
      })
    : undefined
});

module.exports = {
  apiLimiter,
  sensitiveLimiter,
  redisClient,
  redisReady
};


