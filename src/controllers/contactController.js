/**
 * @file contactController.js
 * @description Contact controller for Bingeme API Express.js
 * Handles contact form functionality including user info retrieval and form submission
 */

import { getAuthenticatedUserId, logInfo, logError, createSuccessResponse, createErrorResponse, getUserById, getAdminSettings } from '../utils/common.js';
import { sendContactMessageEmail } from '../utils/mail.js';

/**
 * GET method - Retrieve authenticated user's name and email for contact form
 * Exact implementation matching Lambda getContactUserInfoHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Response with user info and form settings
 */
export const getContactUserInfo = async (req, res) => {
  try {
    // Get user ID if authenticated (allow anonymous for contact form)
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: true, action: 'contact form access' }) to getAuthenticatedUserId(req, { allowAnonymous: true, action: 'contact form access' })
    const authResult = getAuthenticatedUserId(req, { allowAnonymous: true, action: 'contact form access' });
    if (authResult.errorResponse) {
      // TODO: Convert return authResult.errorResponse to return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body)
      return res.status(authResult.errorResponse.statusCode).json(createErrorResponse(authResult.errorResponse.statusCode, authResult.errorResponse.body.message || authResult.errorResponse.body.error));
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
    
    // TODO: Convert createSuccessResponse(contactFormConfig) to res.status(200).json(createSuccessResponse('Contact form info retrieved successfully', contactFormConfig))
    return res.status(200).json(createSuccessResponse('Contact form info retrieved successfully', contactFormConfig));
    
  } catch (error) {
    logError('Error getting contact form info:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to retrieve contact form information'));
  }
};

/**
 * POST method - Handle contact form submission
 * Exact implementation matching Lambda submitContactFormHandler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<Object>} Response indicating success or failure
 */
export const submitContactForm = async (req, res) => {
  try {
    // Parse request body
    // TODO: Convert JSON.parse(event.body || '{}') to req.body (already parsed by Express middleware)
    let requestBody;
    try {
      requestBody = req.body || {};
    } catch (error) {
      return res.status(400).json(createErrorResponse(400, 'Invalid JSON in request body'));
    }
    
    const { 
      full_name, 
      email, 
      subject, 
      message, 
      agree_terms_privacy,
      'g-recaptcha-response': captcha_response 
    } = requestBody;
    
    // Validate required fields
    if (!full_name || !email || !subject || !message) {
      return res.status(400).json(createErrorResponse(400, 'Full name, email, subject, and message are required'));
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json(createErrorResponse(400, 'Invalid email format'));
    }
    
    // Get admin settings for validation
    const adminSettings = await getAdminSettings();
    
    // Check terms and privacy agreement if required
    if (adminSettings.link_terms && adminSettings.link_privacy) {
      if (agree_terms_privacy !== 'on') {
        return res.status(400).json(createErrorResponse(400, 'You must agree to the terms and conditions and privacy policy'));
      }
    }
    
    // Validate captcha if enabled
    if (adminSettings.captcha_contact === 'on') {
      if (!captcha_response) {
        return res.status(400).json(createErrorResponse(400, 'Captcha verification required'));
      }
      
      const captchaValid = await validateCaptcha(captcha_response);
      if (!captchaValid) {
        return res.status(400).json(createErrorResponse(400, 'Invalid captcha response'));
      }
    }
    
    // Get user info if authenticated
    // TODO: Convert getAuthenticatedUserId(event, { allowAnonymous: true, action: 'contact form submission' }) to getAuthenticatedUserId(req, { allowAnonymous: true, action: 'contact form submission' })
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
        return res.status(500).json(createErrorResponse(500, 'Your message could not be sent. Please try again later.'));
      }
    } catch (emailError) {
      logError('Failed to send contact message email:', emailError);
      return res.status(500).json(createErrorResponse(500, 'Your message could not be sent. Please try again later.'));
    }
    
    logInfo('Contact form submitted successfully:', { 
      email, 
      subject,
      userId: authResult.userId || 'anonymous',
      emailSent: true
    });
    
    // TODO: Convert createSuccessResponse('Contact message sent successfully', {...}) to res.status(200).json(createSuccessResponse('Contact message sent successfully', {...}))
    return res.status(200).json(createSuccessResponse('Contact message sent successfully', {
      success: true,
      message: 'Your message has been sent successfully. We will get back to you soon.'
    }));
    
  } catch (error) {
    logError('Error submitting contact form:', error);
    return res.status(500).json(createErrorResponse(500, 'Failed to submit contact form'));
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