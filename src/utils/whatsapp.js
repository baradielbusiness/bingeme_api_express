/**
 * @file whatsapp.js
 * @description WhatsApp utilities for Bingeme API Express.js. Handles sending OTP via WhatsApp using external API.
 */

import axios from 'axios';
import { logInfo, logError, sendTelegramNotification } from './common.js';
import { getDB } from '../config/database.js';

/**
 * Fetches the most recent WhatsApp access token from the database
 * @returns {Promise<string|null>} The access token or null if not found
 */
const getWhatsAppAccessToken = async () => {
  try {
    const pool = getDB();
    const queryPromise = pool.query(
      'SELECT token FROM wb_access_tokens ORDER BY created_at DESC LIMIT 1'
    );
    
    const [rows] = await queryPromise;
    
    if (rows.length === 0) {
      logError('No WhatsApp access token found in database');
      return null;
    }
    
    return rows[0].token;
  } catch (error) {
    logError('Error fetching WhatsApp access token:', error);
    return null;
  }
};

/**
 * Send OTP via WhatsApp
 * @param {string} phone - Phone number without country code
 * @param {string} countryCode - Country code (e.g., +91)
 * @param {string} otp - OTP to send
 * @returns {Promise<boolean>} True if sent successfully
 */
export const sendWhatsAppOTP = async (phone, countryCode, otp) => {
  logInfo('sendWhatsAppOTP called', { phone, countryCode, otp });
  const recipient = countryCode + phone;
  const startTime = Date.now();
  
  try {
    logInfo('Validating WhatsApp OTP input parameters', { phone, countryCode, otp });
    // Validate input parameters
    if (!phone || !countryCode || !otp) {
      const error = new Error('Missing required parameters for WhatsApp OTP');
      logError('WhatsApp OTP validation error:', { phone, countryCode, otp});
      await sendTelegramNotification(`WhatsApp OTP Error: Missing parameters\nPhone: ${phone}\nCountry: ${countryCode}\nOTP: ${otp}`);
      return false;
    }

    // Get access token from database
    logInfo('Fetching WhatsApp access token');
    const accessToken = await getWhatsAppAccessToken();
    
    if (!accessToken) {
      const error = new Error('No WhatsApp access token available');
      logError('WhatsApp OTP token error:', error);
      await sendTelegramNotification(`WhatsApp OTP Error: No access token available\nPhone: ${recipient}`);
      return false;
    }
    
    const url = process.env.WHATSAPP_API_URL;
    const template = process.env.WHATSAPP_TEMPLATE;
    logInfo('Validating WhatsApp configuration', { url, template });

    // Validate configuration
    if (!url || !template) {
      const error = new Error('Missing WhatsApp configuration');
      logError('WhatsApp OTP config error:', { url: !!url, template: !!template });
      await sendTelegramNotification(`WhatsApp OTP Error: Missing configuration\nURL: ${!!url}\nTemplate: ${!!template}\nPhone: ${recipient}`);
      return false;
    }

    const requestPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: template,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: otp,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: otp,
              },
            ],
          },
        ],
      },
    };

    const requestConfig = {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    };
    logInfo('Sending WhatsApp OTP request', { 
      phone: recipient,
      template,
      url
    });

    const response = await axios.post(url, requestPayload, requestConfig);
    
    const duration = Date.now() - startTime;
    
    // Check for successful response
    if (response.status === 200 && response.data) {
      logInfo('WhatsApp OTP sent successfully', { 
        phone: recipient,
        status: response.status,
        duration: `${duration}ms`,
        messageId: response.data.messages?.[0]?.id
      });
    return true;
    } else {
      const error = new Error(`Unexpected response status: ${response.status}`);
      logError('WhatsApp OTP unexpected response:', { 
        status: response.status, 
        data: response.data,
        phone: recipient 
      });
      await sendTelegramNotification(`WhatsApp OTP Error: Unexpected response\nStatus: ${response.status}\nPhone: ${recipient}\nDuration: ${duration}ms`);
      return false;
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    logError('WhatsApp OTP error caught in catch block', { error, duration });
    let errorType = 'Unknown';
    let errorDetails = {};

    // Handle different types of errors
    if (error.response) {
      // WhatsApp API error response
      errorType = 'WhatsApp API Error';
      const status = error.response.status;
      const data = error.response.data;
      
      errorDetails = {
        status,
        data,
        phone: recipient,
        duration: `${duration}ms`
      };

      // Check for specific WhatsApp API error codes in response body
      if (data && data.error) {
        const error = data.error;
        
        // Handle specific error code 131000 (Meta server down)
        if (error.code === 131000) {
          errorDetails.message = 'WhatsApp API Error 131000: Meta server down';
          logError('WhatsApp API Error 131000: Meta server down');
          await sendTelegramNotification(`WhatsApp OTP Error: Meta Server Down (131000)\nPhone: ${recipient}\nStatus: ${status}\nDuration: ${duration}ms`);
        } else {
          // Log other WhatsApp API errors
          logError('WhatsApp API Error:', JSON.stringify(error));
          errorDetails.message = `WhatsApp API Error: ${error.message || 'Unknown error'}`;
          await sendTelegramNotification(`WhatsApp OTP Error: API Error\nPhone: ${recipient}\nStatus: ${status}\nCode: ${error.code || 'Unknown'}\nDuration: ${duration}ms`);
        }
      } else {
        // Handle HTTP status codes
        if (status === 401) {
          errorDetails.message = 'Invalid access token - token may be expired';
          await sendTelegramNotification(`WhatsApp OTP Error: Invalid/Expired Token\nPhone: ${recipient}\nStatus: ${status}\nDuration: ${duration}ms`);
        } else if (status === 400) {
          errorDetails.message = 'Invalid request parameters';
          await sendTelegramNotification(`WhatsApp OTP Error: Invalid Parameters\nPhone: ${recipient}\nStatus: ${status}\nDuration: ${duration}ms`);
        } else if (status === 429) {
          errorDetails.message = 'Rate limit exceeded';
          await sendTelegramNotification(`WhatsApp OTP Error: Rate Limit Exceeded\nPhone: ${recipient}\nStatus: ${status}\nDuration: ${duration}ms`);
        } else if (status >= 500) {
          errorDetails.message = 'WhatsApp API server error';
          await sendTelegramNotification(`WhatsApp OTP Error: Server Error\nPhone: ${recipient}\nStatus: ${status}\nDuration: ${duration}ms`);
        } else {
          await sendTelegramNotification(`WhatsApp OTP Error: API Error\nPhone: ${recipient}\nStatus: ${status}\nDuration: ${duration}ms`);
        }
      }

    } else if (error.request) {
      // Network error (no response received)
      errorType = 'Network Error';
      errorDetails = {
        message: 'No response received from WhatsApp API',
        phone: recipient,
        duration: `${duration}ms`
      };
      await sendTelegramNotification(`WhatsApp OTP Error: Network Error\nPhone: ${recipient}\nDuration: ${duration}ms\nError: ${error.message}`);

    } else if (error.code === 'ECONNABORTED') {
      // Timeout error
      errorType = 'Timeout Error';
      errorDetails = {
        message: 'Request timeout',
        phone: recipient,
        duration: `${duration}ms`
      };
      await sendTelegramNotification(`WhatsApp OTP Error: Timeout\nPhone: ${recipient}\nDuration: ${duration}ms`);

    } else {
      // Other errors (configuration, validation, etc.)
      errorType = 'Configuration Error';
      errorDetails = {
        message: error.message,
        phone: recipient,
        duration: `${duration}ms`
      };
      await sendTelegramNotification(`WhatsApp OTP Error: Configuration\nPhone: ${recipient}\nError: ${error.message}\nDuration: ${duration}ms`);
    }

    // Log the error with detailed information
    logError(`WhatsApp OTP ${errorType}:`, {
      ...errorDetails,
      error: error.message,
      stack: error.stack
    });

    return false;
  }
};
