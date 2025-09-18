/**
 * @file docsController.js
 * @description Documentation controller for Bingeme API Express.js
 * Handles Swagger API documentation serving
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logError, createExpressErrorResponse } from '../utils/common.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GET Swagger UI
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getSwaggerUI = async (req, res) => {
  try {
    logInfo('Serving Swagger UI');
    
    // Serve Swagger UI with enhanced testing capabilities
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Bingeme API Documentation" />
        <title>Bingeme API Documentation</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui.css" />
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          }
          #swagger-ui {
            max-width: 1460px;
            margin: 0 auto;
            padding: 20px;
          }
          .swagger-ui .info {
            margin: 20px 0;
          }
          .swagger-ui .scheme-container {
            margin: 20px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 4px;
          }
          .swagger-ui .try-out__btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          }
          .swagger-ui .try-out__btn:hover {
            background: #0056b3;
          }
          .swagger-ui .execute-wrapper {
            margin: 20px 0;
          }
          .swagger-ui .responses-wrapper {
            margin: 20px 0;
          }
        </style>
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
        <script>
          // Use current protocol and host for swagger.json
          const currentProtocol = window.location.protocol;
          const currentHost = window.location.host;
          const swaggerUrl = currentProtocol + '//' + currentHost + '/docs/swagger.json';
          window.onload = function() {
            const ui = SwaggerUIBundle({
              url: swaggerUrl,
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "BaseLayout",
              docExpansion: "list",
              defaultModelsExpandDepth: 3,
              defaultModelExpandDepth: 3,
              displayRequestDuration: true,
              filter: true,
              showExtensions: true,
              showCommonExtensions: true,
              syntaxHighlight: {
                activate: true,
                theme: "monokai"
              },
              initOAuth: {
                clientId: "cle"
              },
              tryItOutEnabled: true,
              requestInterceptor: function(request) {
                console.log('Making request:', request);
                // Ensure API key is properly set
                if (request.headers && !request.headers['x-api-key']) {
                  request.headers['x-api-key'] = 'cle';
                }
                return request;
              },
              responseInterceptor: function(response) {
                console.log('Received response:', response);
                return response;
              },
              onComplete: function() {
                console.log('Swagger UI loaded successfully');
                // Enable "Try it out" buttons by default
                const tryOutButtons = document.querySelectorAll('.try-out__btn');
                tryOutButtons.forEach(button => {
                  if (button.textContent.includes('Try it out')) {
                    button.click();
                  }
                });
              }
            });
            window.ui = ui;
          };
        </script>
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    logError('Error serving Swagger UI:', error);
    res.status(500).json(createExpressErrorResponse('Error serving API documentation', 500, { details: error.message }));
  }
};

/**
 * GET Swagger JSON
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
export const getSwaggerJSON = async (req, res) => {
  try {
    logInfo('Serving Swagger JSON');
    
    // Read Swagger JSON file from the root directory
    const swaggerPath = path.join(process.cwd(), 'swagger.json');
    
    let swaggerJson;
    try {
      const swaggerContent = fs.readFileSync(swaggerPath, 'utf8');
      swaggerJson = JSON.parse(swaggerContent);
    } catch (error) {
      logError('Error reading swagger.json:', error);
      return res.status(500).json(createErrorResponse(500, 'Error reading API documentation'));
    }

    res.setHeader('Content-Type', 'application/json');
    res.json(swaggerJson);
  } catch (error) {
    logError('Error serving Swagger JSON:', error);
    res.status(500).json(createExpressErrorResponse('Error serving API documentation', 500, { details: error.message }));
  }
};
