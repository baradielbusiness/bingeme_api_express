import { pool } from '../config/database.js';
import { logInfo, logError } from './common.js';

/**
 * Save message media
 */
const saveMessageMedia = async (messageId, mediaData) => {
  try {
    const { media_path, media_type, media_size } = mediaData;
    
    const query = `
      INSERT INTO media_messages (message_id, media_path, media_type, media_size, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [messageId, media_path, media_type, media_size]);
    logInfo(`Saved message media: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error saving message media:', error);
    throw error;
  }
};

/**
 * Save message
 */
const saveMessage = async (messageData) => {
  try {
    const { 
      from_user_id, 
      to_user_id, 
      message, 
      conversations_id, 
      status = 'sent',
      tip = 0 
    } = messageData;
    
    const query = `
      INSERT INTO messages (from_user_id, to_user_id, message, conversations_id, status, tip, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;
    
    const [result] = await pool.query(query, [
      from_user_id, 
      to_user_id, 
      message, 
      conversations_id, 
      status, 
      tip
    ]);
    
    logInfo(`Saved message: ${result.insertId}`);
    return result.insertId;
  } catch (error) {
    logError('Error saving message:', error);
    throw error;
  }
};

/**
 * Delete message
 */
const deleteMessage = async (messageId) => {
  try {
    const query = `UPDATE messages SET deleted = 1 WHERE id = ?`;
    await pool.query(query, [messageId]);
    logInfo(`Deleted message: ${messageId}`);
  } catch (error) {
    logError('Error deleting message:', error);
    throw error;
  }
};

// Export all functions at the end
export {
  saveMessageMedia,
  saveMessage,
  deleteMessage
};