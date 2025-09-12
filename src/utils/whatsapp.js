/**
 * @file whatsapp.js
 * @description WhatsApp OTP sending utility for Bingeme API Express.js
 */

import axios from 'axios';
import { logInfo, logError } from './common.js';

/**
 * Send OTP via WhatsApp
 * @param {string} phone - Phone number without country code
 * @param {string} countryCode - Country code (e.g., +91)
 * @param {string} otp - OTP to send
 * @returns {Promise<boolean>} True if sent successfully
 */
export const sendWhatsAppOTP = async (phone, countryCode, otp) => {
  try {
    const fullPhone = `${countryCode}${phone}`;
    const message = `Your BingeMe verification code is: ${otp}. This code will expire in 10 minutes.`;
    
    // TODO: Implement actual WhatsApp API integration
    // This is a placeholder implementation
    logInfo('WhatsApp OTP sent', { phone: fullPhone, otp });
    
    return true;
  } catch (error) {
    logError('WhatsApp OTP sending failed', error);
    return false;
  }
};
