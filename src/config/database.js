import mysql from 'mysql2/promise';
import { logInfo, logError } from '../utils/common.js';

let connectionPool = null;

/**
 * Create database connection pool
 * Manages MySQL connections efficiently
 */
const createConnectionPool = () => {
  if (connectionPool) {
    return connectionPool;
  }

  try {
    connectionPool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      port: process.env.DB_PORT || 3306,
      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
      queueLimit: 0,
      connectTimeout: 60000,
      charset: 'utf8mb4',
      timezone: '+00:00'
    });

    logInfo('Database connection pool created');
    return connectionPool;
  } catch (error) {
    logError('Failed to create database connection pool:', error);
    throw error;
  }
};

/**
 * Connect to database
 * Establishes initial database connection
 */
const connectDB = async () => {
  const allowStartWithoutDb = (process.env.ALLOW_START_WITHOUT_DB === 'true') || (process.env.NODE_ENV === 'development');
  try {
    const pool = createConnectionPool();
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    logInfo('Database connected successfully');
    return pool;
  } catch (error) {
    logError('Database connection failed:', error);
    if (allowStartWithoutDb) {
      logError('Continuing without active DB connection (development mode)');
      return null;
    }
    throw error;
  }
};

/**
 * Get database connection pool
 * Returns the existing connection pool
 */
const getDB = () => {
  if (!connectionPool) {
    // Lazily create the pool if not initialized yet
    connectionPool = createConnectionPool();
  }
  return connectionPool;
};

// Lightweight proxy to maintain compatibility with modules importing { pool }
// Uses lazy getDB() under the hood to avoid premature initialization
const pool = {
  query: (...args) => getDB().query(...args),
  execute: (...args) => getDB().execute(...args),
  getConnection: (...args) => getDB().getConnection(...args)
};

/**
 * Close database connections
 * Gracefully closes all database connections
 */
const closeDB = async () => {
  if (connectionPool) {
    await connectionPool.end();
    connectionPool = null;
    logInfo('Database connections closed');
  }
};

// Export all functions at the end
export {
  createConnectionPool,
  connectDB,
  getDB,
  pool,
  closeDB
};