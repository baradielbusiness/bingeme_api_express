import mysql from 'mysql2/promise';
import { logInfo, logError } from '../utils/common.js';

let connectionPool = null;

/**
 * Create database connection pool
 * Manages MySQL connections efficiently
 */
export const createConnectionPool = () => {
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
      acquireTimeout: 60000,
      timeout: 60000,
      reconnect: true,
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
export const connectDB = async () => {
  try {
    const pool = createConnectionPool();
    
    // Test the connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    logInfo('Database connected successfully');
    return pool;
  } catch (error) {
    logError('Database connection failed:', error);
    throw error;
  }
};

/**
 * Get database connection pool
 * Returns the existing connection pool
 */
export const getDB = () => {
  if (!connectionPool) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return connectionPool;
};

/**
 * Close database connections
 * Gracefully closes all database connections
 */
export const closeDB = async () => {
  if (connectionPool) {
    await connectionPool.end();
    connectionPool = null;
    logInfo('Database connections closed');
  }
};
