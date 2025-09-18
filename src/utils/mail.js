/**
 * @file mail.js
 * @description Email OTP sending utility for Bingeme API Express.js
 */

import nodemailer from 'nodemailer';
import { logInfo, logError } from './common.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Handlebars from 'handlebars';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create email transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port: process.env.MAIL_PORT || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD
    }
  });
};

/**
 * Simple encryption for email (you can replace this with a more secure method)
 * @param {string} email - The email to encrypt
 * @returns {string} Encrypted email
 */
const encryptEmail = (email) => {
  // Simple base64 encoding for now - replace with proper encryption
  return Buffer.from(email).toString('base64');
};

/**
 * Send OTP via email
 * @param {string} email - Email address
 * @param {string} otp - OTP to send
 * @param {string} type - Type of OTP (signup, login, forgot_password, 2fa)
 * @returns {Promise<boolean>} True if sent successfully
 */
const sendEmailOTP = async (email, otp, type = 'signup') => {
  try {
    logInfo('sendEmailOTP called', { email, otp, type });
    
    const transporter = createTransporter();
    if (!transporter) {
      logError('Email transporter not configured');
      return false;
    }
    
    logInfo('Preparing email content', { email, type });
    const fromName = process.env.MAIL_FROM_NAME;
    const fromEmail = process.env.MAIL_FROM_ADDRESS;
    
    // Define email content based on type
    let subject;
    switch (type) {
      case 'login':
        subject = 'Your BingeMe Login OTP';
        break;
      case 'forgot_password':
        subject = 'Your BingeMe Password Reset OTP';
        break;
      case 'account_deletion':
        subject = 'Your BingeMe Account Deletion OTP';
        break;
      case 'signup':
      default:
        subject = 'Your BingeMe Signup OTP';
        break;
    }
    
    logInfo('Reading and compiling email template', { templateType: type });
    // Read and compile template
    const templatePath = path.join(__dirname, '../templates/otp_template.html');
    const templateContent = fs.readFileSync(templatePath, 'utf8');
    const template = Handlebars.compile(templateContent);
    
    // Prepare template data
    const encryptedMail = encryptEmail(email);
    const templateData = {
      confirmation_code: otp,
      encrypted_mail: encryptedMail
    };
    
    // Generate HTML content
    const htmlContent = template(templateData);
    
    // Log the email parameters before sending (excluding password)
    logInfo('Prepared email parameters', {
      from: `${fromName} <${fromEmail}>`,
      to: email,
      subject,
      text: `Your OTP for BingeMe ${type.replace('_', ' ')} is: ${otp}. This code will expire in 10 minutes.`
    });
    
    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: email,
      subject: subject,
      text: `Your OTP for BingeMe ${type.replace('_', ' ')} is: ${otp}. This code will expire in 10 minutes.`,
      html: htmlContent
    };
    
    logInfo('Sending email via transporter', { to: email });
    const info = await transporter.sendMail(mailOptions);
    logInfo('Email OTP sent successfully:', { email, info });
    
    return true;
  } catch (error) {
    logError('Error sending email OTP:', error);
    return false;
  }
};


/**
 * Send contact message email to admin
 * @param {object} contactData - Contact form data
 * @returns {Promise<boolean>} True if sent successfully
 */
const sendContactMessageEmail = async (contactData) => {
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

// Export all functions at the end
export {
  sendEmailOTP,
  sendContactMessageEmail
};