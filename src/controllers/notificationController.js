/**
 * @file notificationController.js
 * @description Express.js Notification Controllers
 * 
 * This module provides notification functionality including:
 * - Notification retrieval with filtering and pagination
 * - Notification settings management
 * - Notification deletion (single and bulk)
 * 
 * Database Tables: notifications, users
 */

import { 
  getAuthenticatedUserId, 
  createErrorResponse, 
  createSuccessResponse, 
  logInfo, 
  logError, 
  safeDecryptId,
  formatTimeAgo,
  getFile,
  encryptId
} from '../utils/common.js';
import { pool } from '../config/database.js';

// ============================================================================
// CONSTANTS AND CONFIGURATION
// ============================================================================

const PAGINATION_LIMITS = {
  MIN: 1,
  MAX: 50,
  DEFAULT: 10
};

const DEFAULT_SORT = 'all';

// Define allowed notification setting fields
const allowedFields = [
  'notify_new_subscriber',
  'notify_liked_post',
  'notify_commented_post',
  'notify_new_tip',
  'notify_new_ppv',
  'notify_liked_comment',
  'notify_missed_vc_email',
  'notify_missed_vc_wa'
];

// ============================================================================
// NOTIFICATION HELPER FUNCTIONS
// ============================================================================

/**
 * Get notification destination description based on type and data
 */
const getNotificationDestination = (notification) => {
  try {
    const { type } = notification;
    const typeStr = String(type);

    const linkTextGroups = {
      'Profile': ['1'],
      'View Post': ['2', '3', '4', '7', '8', '9', '16', '25'],
      'Payments Received': ['5', '12'],
      'View Message': ['6', '10'],
      'View Referrals': ['11'],
      'Subscribe Now': ['13'],
      'Watch Live': ['14', '34', '35'],
      'View Sales': ['15'],
      'View Wallet': ['17', '18'],
      'Live Bookings': ['19'],
      'Payment History': ['20'],
      'View Ticket': ['21'],
      'View Tickets': ['22'],
      'View Verification': ['23'],
      'View Payouts': ['24'],
      'View Order': ['26', '27'],
      'View Products': ['28'],
      'View Orders': ['29', '30', '31', '32'],
      'View Messages': ['33']
    };

    const linkTextMap = {};
    Object.entries(linkTextGroups).forEach(([linkText, typeIds]) => {
      typeIds.forEach(typeId => {
        linkTextMap[typeId] = linkText;
      });
    });

    return linkTextMap[typeStr] || 'View Notification';
  } catch (error) {
    return 'View Notification';
  }
};

/**
 * Truncate text to specified length with ellipsis
 */
const truncateText = (text, limit = 20) => {
  if (!text) return '';
  return text.length > limit ? `${text.substring(0, limit)}...` : text;
};

/**
 * Get display name from user data with fallback logic
 */
const getDisplayName = (name, username) => {
  return truncateText(name || username, 20);
};

/**
 * Generate notification message based on type and data
 */
const generateNotificationMessage = (notification) => {
  try {
    const { 
      type, 
      username, 
      name, 
      description, 
      message, 
      productName, 
      live_stream_name, 
      live_stream_datetime 
    } = notification;

    const displayName = getDisplayName(name, username);
    const typeStr = String(type);

    const messageTemplates = {
      '1': () => `${displayName} has subscribed to your content`,
      '2': () => `${displayName} likes your post ${truncateText(description, 50)}`,
      '3': () => `${displayName} commented on your post ${truncateText(description, 50)}`,
      '4': () => `${displayName} liked your comment in ${truncateText(description, 50)}`,
      '5': () => `${displayName} he sent you a tip`,
      '6': () => `${displayName} has bought your message ${truncateText(message, 50)}`,
      '7': () => `${displayName} has bought your post ${truncateText(description, 50)}`,
      '8': () => `Your post has been approved ${truncateText(description, 50)}`,
      '9': () => `Your video has been processed successfully (Post) ${truncateText(description, 50)}`,
      '10': () => `Your video has been processed successfully (Message) ${truncateText(message, 50)}`,
      '11': () => `One of your referrals has made a transaction`,
      '12': () => `Payment received for subscription renewal from ${displayName}`,
      '13': () => `${displayName} has changed your subscription to paid. Subscribe now!`,
      '14': () => `${displayName} is streaming live`,
      '15': () => `${displayName} has bought your item ${truncateText(productName, 50)}`,
      '16': () => `${displayName} has mentioned you in ${truncateText(description, 50)}`,
      '17': () => `Your deposit has processed successfully`,
      '18': () => `Your deposit has failed`,
      '19': () => `${displayName} has pre-booked your live event`,
      '20': () => `Live pre-book for ${username} has been refunded successfully`,
      '21': () => `${displayName} sent a new ticket`,
      '22': () => `${displayName} created a new ticket`,
      '23': () => `${displayName} sent a verification request`,
      '24': () => `${displayName} sent a payout conversation`,
      '25': () => `Your content has been disabled due to ${truncateText(description, 50)}. View post`,
      '26': () => `Your purchase of ${productName || 'product'} has been rejected by the creator and amount refunded. Payment history`,
      '27': () => `Order placed by ${displayName} has been cancelled and amount refunded successfully. View order`,
      '28': () => `Order placed by ${displayName} has been delivered and amount credited successfully. View order`,
      '29': () => `${displayName} has placed an order`,
      '30': () => `Error response while creating order in Shiprocket. Check error logs`,
      '31': () => `Error response while cancelling Shiprocket shipment. Check error logs`,
      '32': () => `Error response while cancelling Shiprocket order. Check error logs`,
      '33': () => `Missed call from ${displayName}`,
      '34': () => `${displayName} has rescheduled the live stream`,
      '35': () => `${displayName} is going live: ${live_stream_name || 'Live Stream'} @ ${live_stream_datetime}`
    };

    return messageTemplates[typeStr]?.() || `New notification from ${displayName}`;
  } catch (error) {
    return 'New notification received';
  }
};

/**
 * Get notification filter types for different categories
 */
const getFilterTypes = () => {
  const filterTypes = {
    'subscription': ['1', '13'],
    'comment': ['3', '4'],
    'brought_message': ['6'],
    'brought_content': ['7'],
    'brought_item': ['15'],
    'live_bookings': ['19'],
    'calls': ['33'],
  };

  return filterTypes;
};

/**
 * Parse pagination parameters from query string
 */
const parsePaginationParams = (queryParams) => {
  try {
    const { 
      skip: skipRaw = 0, 
      limit: limitRaw = PAGINATION_LIMITS.DEFAULT, 
      sort: sortRaw = DEFAULT_SORT, 
      next 
    } = queryParams || {};

    if (next) {
      const params = new URLSearchParams(next);
      return {
        skip: parseInt(params.get('skip')) || 0,
        limit: parseInt(params.get('limit')) || PAGINATION_LIMITS.DEFAULT,
        sort: params.get('sort') || DEFAULT_SORT
      };
    }

    return {
      skip: parseInt(skipRaw) || 0,
      limit: parseInt(limitRaw) || PAGINATION_LIMITS.DEFAULT,
      sort: sortRaw
    };
  } catch (error) {
    return {
      skip: 0,
      limit: PAGINATION_LIMITS.DEFAULT,
      sort: DEFAULT_SORT
    };
  }
};

/**
 * Validate pagination parameters
 */
const validatePaginationParams = (limit) => {
  if (limit < PAGINATION_LIMITS.MIN || limit > PAGINATION_LIMITS.MAX) {
    return `Limit must be between ${PAGINATION_LIMITS.MIN} and ${PAGINATION_LIMITS.MAX}`;
  }
  return null;
};

/**
 * Build next pagination URL
 */
const buildNextUrl = (skip, limit, total, sort) => {
  if ((skip + limit) >= total) {
    return '';
  }

  let nextUrl = `skip=${skip + limit}&limit=${limit}`;
  
  if (sort && sort !== DEFAULT_SORT) {
    nextUrl += `&sort=${sort}`;
  }

  return nextUrl;
};

/**
 * Format notifications data for API response
 */
const formatNotifications = (rows) => {
  try {
    return rows.map(row => {
      const { 
        id_noty, 
        type, 
        created_at, 
        userId, 
        username, 
        name, 
        avatar 
      } = row;

      const desc = generateNotificationMessage(row);
      const link = getNotificationDestination(row);
      const time = formatTimeAgo(created_at);
      
      return {
        id: encryptId(id_noty),
        time,
        userId: encryptId(userId),
        username,
        name,
        avatar: avatar ? getFile(`avatar/${avatar}`) : '',
        desc,
        link
      };
    });
  } catch (error) {
    return [];
  }
};

/**
 * Fetch notifications from database
 */
const fetchNotifications = async (userId, limit, skip, activeFilterTypes) => {
  try {
    let query = `
      SELECT 
        n.id as id_noty,
        n.type,
        n.created_at,
        u.id as userId,
        u.username,
        u.name,
        u.avatar
      FROM notifications n
      LEFT JOIN users u ON n.user_id = u.id
      WHERE n.destination = ?
      ORDER BY n.created_at DESC
      LIMIT ? OFFSET ?
    `;

    let params = [userId, limit, skip];

    if (activeFilterTypes?.length) {
      const filterPlaceholders = activeFilterTypes.map(() => '?').join(',');
      query = query.replace('WHERE n.destination = ?', `WHERE n.destination = ? AND n.type IN (${filterPlaceholders})`);
      params = [userId, ...activeFilterTypes, limit, skip];
    }

    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    logError('Error fetching notifications:', error);
    throw error;
  }
};

/**
 * Count notifications for pagination
 */
const countNotifications = async (userId, activeFilterTypes) => {
  try {
    let query = 'SELECT COUNT(*) as total FROM notifications WHERE destination = ?';
    let params = [userId];

    if (activeFilterTypes?.length) {
      const filterPlaceholders = activeFilterTypes.map(() => '?').join(',');
      query += ` AND type IN (${filterPlaceholders})`;
      params = [userId, ...activeFilterTypes];
    }

    const [rows] = await pool.query(query, params);
    return rows[0].total;
  } catch (error) {
    logError('Error counting notifications:', error);
    throw error;
  }
};

/**
 * Mark notifications as seen
 */
const markNotificationsAsSeen = async (userId) => {
  try {
    await pool.query(
      'UPDATE notifications SET seen = 1 WHERE destination = ? AND seen = 0',
      [userId]
    );
  } catch (error) {
    logError('Error marking notifications as seen:', error);
    throw error;
  }
};

// ============================================================================
// CONTROLLER FUNCTIONS
// ============================================================================

/**
 * Handler to get notifications (GET /notifications)
 */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    const { skip, limit, sort } = parsePaginationParams(req.query);
    
    const validationError = validatePaginationParams(limit);
    if (validationError) {
      return res.status(400).json(createErrorResponse(400, validationError));
    }

    const filterTypes = getFilterTypes();
    const activeFilterTypes = (sort && sort !== 'all' && filterTypes[sort]) 
      ? filterTypes[sort] 
      : [];

    logInfo('Executing notifications query:', { 
      userId, 
      skip, 
      limit, 
      sort, 
      activeFilterTypes 
    });

    try {
      const [totalNotifications, rows] = await Promise.all([
        countNotifications(userId, activeFilterTypes),
        fetchNotifications(userId, limit, skip, activeFilterTypes)
      ]);

      const notifications = formatNotifications(rows);
      
      if (notifications.length > 0) {
        await markNotificationsAsSeen(userId);
      }

      const nextUrl = buildNextUrl(skip, limit, totalNotifications, sort);
      
      logInfo('Notifications retrieved successfully:', { 
        userId, 
        totalNotifications,
        returnedCount: notifications.length
      });

      return res.status(200).json(createSuccessResponse('Notifications retrieved successfully', {
        notifications,
        pagination: {
          total: totalNotifications,
          next: nextUrl
        }
      }));

    } catch (dbError) {
      logError('Database error while fetching notifications:', dbError);
      return res.status(500).json(createErrorResponse(500, 'Failed to fetch notifications'));
    }

  } catch (error) {
    logError('getNotifications error:', error);
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * Handler to get notification settings (GET /notifications/settings)
 */
export const getNotificationSettings = async (req, res) => {
  try {
    const userId = req.userId;
    
    logInfo('Fetching notification settings for user:', { userId });
    
    const query = `SELECT ${allowedFields.join(', ')} FROM users WHERE id = ?`;
    const [rows] = await pool.query(query, [userId]);
    
    if (rows.length === 0) {
      logError('User not found:', { userId });
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    
    const userSettings = rows[0];
    
    const currentValues = allowedFields.reduce((acc, field) => {
      acc[field] = userSettings[field] === 'yes' ? '1' : '0';
      return acc;
    }, {});

    const fieldConfigs = [
      {
        field_id: "new_subscriber",
        field_type: "toggle",
        field_label: "Someone has subscribed to my content",
        field_key: "notify_new_subscriber",
        field_default_value: true,
        channel: "web"
      },
      {
        field_id: "liked_post",
        field_type: "toggle",
        field_label: "Someone liked my post",
        field_key: "notify_liked_post",
        field_default_value: true,
        channel: "web"
      },
      {
        field_id: "commented_post",
        field_type: "toggle",
        field_label: "Someone commented my post",
        field_key: "notify_commented_post",
        field_default_value: true,
        channel: "web"
      },
      {
        field_id: "new_tip",
        field_type: "toggle",
        field_label: "Someone sent me a tip",
        field_key: "notify_new_tip",
        field_default_value: true,
        channel: "web"
      },
      {
        field_id: "bought_content",
        field_type: "toggle",
        field_label: "Someone has bought my content (Post, Message)",
        field_key: "notify_new_ppv",
        field_default_value: true,
        channel: "web"
      },
      {
        field_id: "liked_comment",
        field_type: "toggle",
        field_label: "Someone liked your comment",
        field_key: "notify_liked_comment",
        field_default_value: true,
        channel: "web"
      },
      {
        field_id: "missed_video_call_email",
        field_type: "toggle",
        field_label: "Missed Video Call Notification (Email)",
        field_key: "notify_missed_vc_email",
        field_default_value: false,
        channel: "email"
      },
      {
        field_id: "missed_video_call_whatsapp",
        field_type: "toggle",
        field_label: "Missed Video Call Notification (Whatsapp)",
        field_key: "notify_missed_vc_wa",
        field_default_value: false,
        channel: "whatsapp"
      }
    ];

    const responseData = {
      settings_config: [
        {
          section_id: "notifications",
          section_title: "Notification settings",
          section_description: "Decide which notifications you'd want to see",
          section_enabled: true,
          fields: fieldConfigs
        }
      ],
      channels: {
        web: {
          name: "Web",
          enabled: true
        },
        email: {
          name: "Email", 
          enabled: true
        },
        whatsapp: {
          name: "WhatsApp",
          enabled: true
        }
      },
      current_values: currentValues
    };
    
    logInfo('Notification settings retrieved successfully:', { userId });
    return res.status(200).json(createSuccessResponse('Notification settings configuration retrieved successfully', responseData));
  } catch (error) {
    logError('getNotificationSettings error:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to fetch notification settings'));
  }
};

/**
 * Handler to update notification settings (POST /notifications/settings)
 */
export const updateNotificationSettings = async (req, res) => {
  try {
    const userId = req.userId;
    const requestBody = req.body;
    
    logInfo('Updating notification settings for user:', { userId });

    const updateFields = {};
    const updateValues = [];
    let updateQuery = 'UPDATE users SET ';

    for (const field of allowedFields) {
      if (requestBody.hasOwnProperty(field)) {
        const value = requestBody[field];
        
        if (value !== '1' && value !== '0') {
          logError('Invalid value for notification setting:', { field, value });
          return res.status(400).json(createErrorResponse(400, `Invalid value for ${field}. Must be '1' or '0'`));
        }

        const dbValue = value === '1' ? 'yes' : 'no';
        updateFields[field] = value;
        updateValues.push(dbValue);
        updateQuery += `${field} = ?, `;
      }
    }

    updateQuery = updateQuery.slice(0, -2);
    updateQuery += ' WHERE id = ?';
    updateValues.push(userId);

    if (Object.keys(updateFields).length === 0) {
      logInfo('No valid fields to update:', { userId });
      return res.status(200).json(createSuccessResponse('Notification settings updated successfully', {}));
    }

    logInfo('Updating notification settings:', { userId, updateFields });

    const [result] = await pool.query(updateQuery, updateValues);

    if (result.affectedRows === 0) {
      logError('No rows affected during update:', { userId });
      return res.status(404).json(createErrorResponse(404, 'User not found'));
    }
    
    logInfo('Notification settings updated successfully:', { userId, updatedFields: Object.keys(updateFields), affectedRows: result.affectedRows });
    
    // Fetch and return the updated notification settings
    const query = `SELECT ${allowedFields.join(', ')} FROM users WHERE id = ?`;
    const [rows] = await pool.query(query, [userId]);
    const userSettings = rows[0];
    
    const currentValues = allowedFields.reduce((acc, field) => {
      acc[field] = userSettings[field] === 'yes' ? '1' : '0';
      return acc;
    }, {});

    return res.status(200).json(createSuccessResponse('Notification settings updated successfully', {
      current_values: currentValues
    }));
  } catch (error) {
    logError('updateNotificationSettings error:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to update notification settings'));
  }
};

/**
 * Handler to delete notification by ID (DELETE /notifications/delete/:id)
 */
export const deleteNotificationById = async (req, res) => {
  try {
    const userId = req.userId;
    const { id: notificationId } = req.params;

    if (!notificationId) {
      return res.status(400).json(createErrorResponse(400, 'Notification ID is required in path'));
    }

    let parsedNotificationId;
    try {
      parsedNotificationId = safeDecryptId(notificationId);
      logInfo('Decoded notification ID:', { originalId: notificationId, decodedId: parsedNotificationId });
    } catch (error) {
      logError('Error decrypting notification ID:', { notificationId, error: error.message });
      return res.status(400).json(createErrorResponse(400, 'Invalid notification ID format'));
    }

    const [notificationRows] = await pool.query(
      'SELECT id, destination FROM notifications WHERE id = ? AND destination = ?',
      [parsedNotificationId, userId]
    );

    if (notificationRows.length === 0) {
      return res.status(404).json(createErrorResponse(404, 'Notification not found'));
    }

    const notification = notificationRows[0];

    const [deleteResult] = await pool.query(
      'DELETE FROM notifications WHERE id = ? AND destination = ?',
      [parsedNotificationId, userId]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json(createErrorResponse(404, 'Notification not found or not deleted'));
    }

    logInfo('Notification deleted successfully:', { 
      userId, 
      notificationId: parsedNotificationId 
    });

    return res.status(200).json(createSuccessResponse('Notification deleted successfully', {
      notification: [
        {
          id: notification.id
        }
      ]
    }));

  } catch (error) {
    logError('deleteNotificationById error:', error);
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal server error'));
  }
};

/**
 * Handler to delete all notifications (DELETE /notifications/delete-all)
 */
export const deleteAllNotifications = async (req, res) => {
  try {
    const userId = req.userId;

    const [countRows] = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE destination = ?',
      [userId]
    );

    const notificationCount = countRows[0].count;

    const [deleteResult] = await pool.query(
      'DELETE FROM notifications WHERE destination = ?',
      [userId]
    );

    logInfo('All notifications deleted successfully:', { 
      userId, 
      deletedCount: deleteResult.affectedRows,
      totalNotifications: notificationCount
    });

    return res.status(200).json(createSuccessResponse('All Notifications deleted successfully'));

  } catch (error) {
    logError('deleteAllNotifications error:', error);
    return res.status(500).json(createErrorResponse(500, error.message || 'Internal server error'));
  }
};
