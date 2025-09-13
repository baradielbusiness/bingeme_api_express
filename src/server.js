import dotenv from 'dotenv';
import app from './app.js';
import { createClient } from 'redis';
import { connectDB } from './config/database.js';
import { logInfo, logError } from './utils/common.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import https from 'https';

// Load environment variables from api.env file
dotenv.config({ path: path.join(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine host and port based on NODE_ENV
const NODE_ENV = process.env.NODE_ENV || 'development';
const PORT = process.env.PORT || (NODE_ENV === 'development' ? 4000 : 3000);
const HOST = NODE_ENV === 'development' ? 'localhost:4000' : 'api.bingeme.com';
const PROTOCOL = NODE_ENV === 'development' ? 'https' : 'https';
// Update swagger.json with dynamic host (only if changed)
const swaggerPath = path.join(__dirname, '..', 'swagger.json');
const swaggerData = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));

// Update swagger configuration
const newHost = HOST;
const newSchemes = NODE_ENV === 'development' ? ['https'] : ['https'];

// Only write if content has actually changed to prevent nodemon restart loop
if (swaggerData.host !== newHost || JSON.stringify(swaggerData.schemes) !== JSON.stringify(newSchemes)) {
  swaggerData.host = newHost;
  swaggerData.schemes = newSchemes;
  fs.writeFileSync(swaggerPath, JSON.stringify(swaggerData, null, 2));
  logInfo('Updated swagger.json with new host configuration');
} else {
  logInfo('Swagger.json host configuration unchanged, skipping update');
}

// Serve swagger documentation
app.get('/swagger', (req, res) => {
  res.sendFile(swaggerPath);
});

// Serve swagger UI
app.get('/docs', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bingeme API Express - Swagger UI</title>
      <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@3.25.0/swagger-ui.css" />
    </head>
    <body>
      <div id="swagger-ui"></div>
      <script src="https://unpkg.com/swagger-ui-dist@3.25.0/swagger-ui-bundle.js"></script>
      <script>
        SwaggerUIBundle({
          url: '/swagger',
          dom_id: '#swagger-ui',
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIBundle.presets.standalone
          ]
        });
      </script>
    </body>
    </html>
  `);
});

// Initialize Redis connection
const redisClient = createClient({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});

redisClient.on('error', (err) => {
  logError('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  logInfo('Redis Client Connected');
});

// Connect to database
const startServer = async () => {
  try {
    // Connect to MySQL database
    await connectDB();
    logInfo('Database connected successfully');

    // Connect to Redis
    await redisClient.connect();
    logInfo('Redis connected successfully');

    // Start Express server with HTTPS
    if (NODE_ENV === 'development') {
      // Load SSL certificates for development
      const sslOptions = {
        key: fs.readFileSync(path.join(__dirname, '..', 'ssl', 'key.pem')),
        cert: fs.readFileSync(path.join(__dirname, '..', 'ssl', 'cert.pem'))
      };
      
      https.createServer(sslOptions, app).listen(PORT, () => {
        logInfo(`🚀 Bingeme API Express server running on port ${PORT} (HTTPS)`);
        logInfo(`🌍 Environment: ${NODE_ENV}`);
        logInfo(`🔗 API Base URL: ${PROTOCOL}://${HOST}`);
        logInfo(`📚 Swagger UI available at: ${PROTOCOL}://${HOST}/docs`);
        logInfo(`📋 Swagger JSON available at: ${PROTOCOL}://${HOST}/swagger`);
        logInfo(`🏥 Health check available at: ${PROTOCOL}://${HOST}/health`);
        logInfo(`🔒 SSL Certificate: Self-signed (development only)`);
      });
    } else {
      // Production server (can be HTTP or HTTPS depending on deployment)
      app.listen(PORT, () => {
        logInfo(`🚀 Bingeme API Express server running on port ${PORT}`);
        logInfo(`🌍 Environment: ${NODE_ENV}`);
        logInfo(`🔗 API Base URL: ${PROTOCOL}://${HOST}`);
        logInfo(`📚 Swagger UI available at: ${PROTOCOL}://${HOST}/docs`);
        logInfo(`📋 Swagger JSON available at: ${PROTOCOL}://${HOST}/swagger`);
        logInfo(`🏥 Health check available at: ${PROTOCOL}://${HOST}/health`);
      });
    }
  } catch (error) {
    logError('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logInfo('SIGTERM received, shutting down gracefully');
  await redisClient.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logInfo('SIGINT received, shutting down gracefully');
  await redisClient.quit();
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logError('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logError('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();
