/**
 * @file mail.js
 * @description Email OTP sending utility for Bingeme API Express.js
 */

import nodemailer from 'nodemailer';
import { logInfo, logError } from './common.js';

// Create email transporter
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

/**
 * Send OTP via email
 * @param {string} email - Email address
 * @param {string} otp - OTP to send
 * @param {string} type - Type of OTP (signup, login, forgot_password, 2fa)
 * @returns {Promise<boolean>} True if sent successfully
 */
export const sendEmailOTP = async (email, otp, type = 'signup') => {
  try {
    const transporter = createTransporter();
    
    const subject = getEmailSubject(type);
    const html = getEmailTemplate(otp, type);
    
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: email,
      subject: subject,
      html: html
    };
    
    await transporter.sendMail(mailOptions);
    logInfo('Email OTP sent', { email, type });
    
    return true;
  } catch (error) {
    logError('Email OTP sending failed', error);
    return false;
  }
};

/**
 * Get email subject based on type
 * @param {string} type - Type of OTP
 * @returns {string} Email subject
 */
const getEmailSubject = (type) => {
  const subjects = {
    signup: 'Verify your BingeMe account',
    login: 'Your BingeMe login code',
    forgot_password: 'Reset your BingeMe password',
    '2fa': 'Your BingeMe 2FA code'
  };
  
  return subjects[type] || 'Your BingeMe verification code';
};

/**
 * Get email template based on type
 * @param {string} otp - OTP code
 * @param {string} type - Type of OTP
 * @returns {string} HTML email template
 */
const getEmailTemplate = (otp, type) => {
  const messages = {
    signup: 'Welcome to BingeMe! Please verify your account with the code below:',
    login: 'Here is your login verification code:',
    forgot_password: 'Use the code below to reset your password:',
    '2fa': 'Here is your two-factor authentication code:'
  };
  
  const message = messages[type] || 'Here is your verification code:';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>BingeMe Verification</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #007bff; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f8f9fa; }
        .otp-code { font-size: 32px; font-weight: bold; color: #007bff; text-align: center; padding: 20px; background-color: white; border-radius: 8px; margin: 20px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>BingeMe</h1>
        </div>
        <div class="content">
          <h2>Verification Code</h2>
          <p>${message}</p>
          <div class="otp-code">${otp}</div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
        <div class="footer">
          <p>© 2024 BingeMe. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Send contact message email to admin
 * @param {object} contactData - Contact form data
 * @returns {Promise<boolean>} True if sent successfully
 */
export const sendContactMessageEmail = async (contactData) => {
  try {
    const transporter = createTransporter();
    
    const { full_name, email, subject, message, user_info } = contactData;
    
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
    const emailSubject = `Contact Form: ${subject}`;
    
    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Contact Form Message</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #007bff; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f8f9fa; }
          .message-box { background-color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>New Contact Form Message</h1>
          </div>
          <div class="content">
            <h2>Contact Details</h2>
            <p><strong>Name:</strong> ${full_name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            ${user_info ? `<p><strong>User Info:</strong> ${user_info}</p>` : ''}
            
            <div class="message-box">
              <h3>Message:</h3>
              <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
            
            <p><em>This message was sent from the BingeMe contact form.</em></p>
          </div>
          <div class="footer">
            <p>© 2024 BingeMe. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
    
    const mailOptions = {
      from: process.env.SMTP_USER,
      to: adminEmail,
      subject: emailSubject,
      html: emailHtml,
      replyTo: email
    };
    
    await transporter.sendMail(mailOptions);
    logInfo('Contact message email sent', { to: adminEmail, from: email });
    
    return true;
  } catch (error) {
    logError('Contact message email sending failed', error);
    return false;
  }
};
