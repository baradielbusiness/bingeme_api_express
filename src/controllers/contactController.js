/**
 * @file contactController.js
 * @description Contact controller for Bingeme API Express.js
 * Handles contact form functionality including form info retrieval and submission
 */

import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  getAuthenticatedUserId, 
  getUserById, 
  getAdminSettings 
} from '../utils/common.js';
import { sendContactMessageEmail } from '../utils/mail.js';

/**
 * GET method - Retrieve authenticated user's name and email for contact form
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getContactInfo = async (req, res) => {
  try {
    // Get user ID if authenticated (allow anonymous for contact form)
    const authResult = getAuthenticatedUserId(req, { allowAnonymous: true, action: 'contact form access' });
    if (authResult.errorResponse) {
      return res.status(401).json(authResult.errorResponse);
    }
    const userId = authResult.userId;
    
    let userInfo = null;
    
    // If user is authenticated, get their info
    if (userId) {
      const user = await getUserById(userId);
      if (user) {
        userInfo = {
          full_name: user.name,
          email: user.email
        };
      }
    }
    
    // Get admin settings for contact form configuration
    const adminSettings = await getAdminSettings();
    
    const contactFormConfig = {
      user_info: userInfo,
      settings: {
        captcha_enabled: adminSettings.captcha_contact === 'on',
        terms_link: adminSettings.link_terms || '',
        privacy_link: adminSettings.link_privacy || '',
      }
    };
    
    logInfo('Contact form info retrieved successfully:', { userId: userId || 'anonymous' });
    
    return res.json({
      success: true,
      message: 'Contact form info retrieved successfully',
      data: contactFormConfig
    });
    
  } catch (error) {
    logError('Error getting contact form info:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to retrieve contact form information'
    });
  }
};

/**
 * POST method - Handle contact form submission
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const submitContactForm = async (req, res) => {
  try {
    const { 
      full_name, 
      email, 
      subject, 
      message, 
      agree_terms_privacy,
      'g-recaptcha-response': captcha_response 
    } = req.body;
    
    // Validate required fields
    if (!full_name || !email || !subject || !message) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'Full name, email, subject, and message are required'
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    
    // Get admin settings for validation
    const adminSettings = await getAdminSettings();
    
    // Check terms and privacy agreement if required
    if (adminSettings.link_terms && adminSettings.link_privacy) {
      if (agree_terms_privacy !== 'on') {
        return res.status(400).json({ 
          error: 'Terms and privacy agreement required',
          message: 'You must agree to the terms and conditions and privacy policy'
        });
      }
    }
    
    // Validate captcha if enabled
    if (adminSettings.captcha_contact === 'on') {
      if (!captcha_response) {
        return res.status(400).json({ error: 'Captcha verification required' });
      }
      
      const captchaValid = await validateCaptcha(captcha_response);
      if (!captchaValid) {
        return res.status(400).json({ error: 'Invalid captcha response' });
      }
    }
    
    // Get user info if authenticated
    const authResult = getAuthenticatedUserId(req, { allowAnonymous: true, action: 'contact form submission' });
    let userInfo = null;
    
    if (authResult.userId) {
      const user = await getUserById(authResult.userId);
      if (user) {
        userInfo = `User ID: ${authResult.userId}, Username: ${user.username || 'N/A'}`;
      }
    }
    
    // Send contact message email to admin
    try {
      const emailSent = await sendContactMessageEmail({
        full_name,
        email,
        subject,
        message,
        user_info: userInfo
      });
      
      if (!emailSent) {
        logError('Failed to send contact message email');
        return res.status(500).json({ 
          error: 'Failed to send message',
          message: 'Your message could not be sent. Please try again later.'
        });
      }
    } catch (emailError) {
      logError('Failed to send contact message email:', emailError);
      return res.status(500).json({ 
        error: 'Failed to send message',
        message: 'Your message could not be sent. Please try again later.'
      });
    }
    
    logInfo('Contact form submitted successfully:', { 
      email, 
      subject,
      userId: authResult.userId || 'anonymous',
      emailSent: true
    });
    
    return res.json({
      success: true,
      message: 'Contact message sent successfully',
      data: {
        success: true,
        message: 'Your message has been sent successfully. We will get back to you soon.'
      }
    });
    
  } catch (error) {
    logError('Error submitting contact form:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to submit contact form'
    });
  }
};

/**
 * Validate Google reCAPTCHA response
 * @param {string} captchaResponse - Captcha response from frontend
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
const validateCaptcha = async (captchaResponse) => {
  try {
    const secretKey = process.env.INVISIBLE_RECAPTCHA_SECRETKEY;
    if (!secretKey) {
      logError('RECAPTCHA secret key not configured');
      return false;
    }
    
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `secret=${secretKey}&response=${captchaResponse}`
    });
    
    const data = await response.json();
    return data.success === true;
    
  } catch (error) {
    logError('Error validating captcha:', error);
    return false;
  }
};
