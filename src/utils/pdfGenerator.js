/**
 * @file pdfGenerator.js
 * @description PDF generation utilities using Puppeteer
 * @author Bingeme API Team
 */

import puppeteer from 'puppeteer';
import { logInfo, logError } from './common.js';

/**
 * Generate PDF from HTML template for creator agreement
 * @param {Object} data - Agreement data
 * @param {string} data.creatorName - Creator's name
 * @param {string} data.creator_name - Creator's name (secondary)
 * @param {string} data.email - Creator's email
 * @param {string} data.mobile - Creator's mobile number
 * @param {string} data.address - Creator's address
 * @param {string} data.signatureData - Base64 signature image
 * @returns {Promise<Buffer>} PDF buffer
 */
const generateCreatorAgreementPDF = async (data) => {
  let browser;
  
  try {
    // Launch browser with optimized settings
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport for consistent rendering
    await page.setViewport({ width: 1200, height: 1600 });
    
    // Generate HTML content for the agreement
    const htmlContent = generateAgreementHTML(data);
    
    // Set content and wait for images to load
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Generate PDF with specific options
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    });
    
    logInfo('Creator agreement PDF generated successfully', {
      size: pdfBuffer.length,
      creatorName: data.creatorName || data.creator_name
    });
    
    return pdfBuffer;
    
  } catch (error) {
    logError('Error generating creator agreement PDF', error);
    throw new Error(`PDF generation failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

/**
 * Generate HTML content for creator agreement
 * @param {Object} data - Agreement data
 * @returns {string} HTML content
 */
const generateAgreementHTML = (data) => {
  const {
    creatorName,
    creator_name,
    email,
    mobile,
    address,
    signatureData
  } = data;
  
  const name = creatorName || creator_name || 'N/A';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Creator Agreement</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 20px;
          color: #333;
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #007bff;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .header h1 {
          color: #007bff;
          margin: 0;
          font-size: 28px;
        }
        .content {
          margin-bottom: 30px;
        }
        .section {
          margin-bottom: 25px;
        }
        .section h2 {
          color: #007bff;
          font-size: 18px;
          margin-bottom: 10px;
          border-bottom: 1px solid #eee;
          padding-bottom: 5px;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .info-table td {
          padding: 8px;
          border: 1px solid #ddd;
        }
        .info-table td:first-child {
          background-color: #f8f9fa;
          font-weight: bold;
          width: 30%;
        }
        .signature-section {
          margin-top: 40px;
          text-align: center;
        }
        .signature-box {
          border: 2px solid #333;
          height: 100px;
          margin: 20px 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .signature-image {
          max-width: 100%;
          max-height: 100%;
        }
        .footer {
          margin-top: 50px;
          text-align: center;
          font-size: 12px;
          color: #666;
        }
        .terms {
          font-size: 14px;
          line-height: 1.8;
        }
        .terms ol {
          padding-left: 20px;
        }
        .terms li {
          margin-bottom: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Creator Agreement</h1>
        <p>Bingeme Platform</p>
      </div>
      
      <div class="content">
        <div class="section">
          <h2>Creator Information</h2>
          <table class="info-table">
            <tr>
              <td>Name:</td>
              <td>${name}</td>
            </tr>
            <tr>
              <td>Email:</td>
              <td>${email || 'N/A'}</td>
            </tr>
            <tr>
              <td>Mobile:</td>
              <td>${mobile || 'N/A'}</td>
            </tr>
            <tr>
              <td>Address:</td>
              <td>${address || 'N/A'}</td>
            </tr>
            <tr>
              <td>Date:</td>
              <td>${new Date().toLocaleDateString()}</td>
            </tr>
          </table>
        </div>
        
        <div class="section">
          <h2>Agreement Terms</h2>
          <div class="terms">
            <p>This Creator Agreement ("Agreement") is entered into between ${name} ("Creator") and Bingeme Platform ("Platform") on ${new Date().toLocaleDateString()}.</p>
            
            <ol>
              <li><strong>Content Creation:</strong> Creator agrees to create original, high-quality content that complies with platform guidelines and community standards.</li>
              
              <li><strong>Intellectual Property:</strong> Creator retains ownership of their original content while granting the platform a license to display, distribute, and promote such content.</li>
              
              <li><strong>Monetization:</strong> Creator may monetize their content through various methods including subscriptions, tips, and paid interactions, subject to platform terms.</li>
              
              <li><strong>Compliance:</strong> Creator agrees to comply with all applicable laws, regulations, and platform policies including but not limited to content guidelines, age verification, and payment processing requirements.</li>
              
              <li><strong>Privacy and Safety:</strong> Creator agrees to respect user privacy, maintain appropriate boundaries, and report any inappropriate behavior or content.</li>
              
              <li><strong>Revenue Sharing:</strong> Revenue sharing terms will be as specified in the platform's current monetization policy, which may be updated from time to time.</li>
              
              <li><strong>Termination:</strong> Either party may terminate this agreement with appropriate notice as specified in the platform terms of service.</li>
              
              <li><strong>Dispute Resolution:</strong> Any disputes arising from this agreement will be resolved through the platform's dispute resolution process.</li>
            </ol>
          </div>
        </div>
        
        <div class="signature-section">
          <h2>Digital Signature</h2>
          <p>By signing below, Creator acknowledges that they have read, understood, and agree to be bound by the terms of this agreement.</p>
          
          <div class="signature-box">
            ${signatureData ? 
              `<img src="data:image/png;base64,${signatureData}" alt="Digital Signature" class="signature-image" />` : 
              '<p>Digital Signature Required</p>'
            }
          </div>
          
          <p><strong>Creator Name:</strong> ${name}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
      </div>
      
      <div class="footer">
        <p>This agreement is electronically generated and legally binding.</p>
        <p>Generated on ${new Date().toISOString()}</p>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate PDF from custom HTML content
 * @param {string} htmlContent - HTML content to convert to PDF
 * @param {Object} options - PDF generation options
 * @returns {Promise<Buffer>} PDF buffer
 */
const generatePDFFromHTML = async (htmlContent, options = {}) => {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport
    await page.setViewport({ 
      width: options.width || 1200, 
      height: options.height || 800 
    });
    
    // Set content
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: options.printBackground !== false,
      margin: options.margin || {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    });
    
    logInfo('PDF generated from HTML successfully', {
      size: pdfBuffer.length
    });
    
    return pdfBuffer;
    
  } catch (error) {
    logError('Error generating PDF from HTML', error);
    throw new Error(`PDF generation failed: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

export {
  generateCreatorAgreementPDF,
  generateAgreementHTML,
  generatePDFFromHTML
};
