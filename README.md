# BingeMe API Express.js

This is the Express.js version of the BingeMe API, converted from AWS Lambda functions. The conversion maintains all the original functionality while providing better development experience and easier deployment.

## 🚀 Features

- **Express.js Framework**: Modern Node.js web framework
- **JWT Authentication**: Secure token-based authentication
- **MySQL Database**: Primary database with connection pooling
- **DynamoDB Integration**: For specific tables (sessions, rate limits, OTP)
- **Redis Caching**: For session management and caching
- **Rate Limiting**: Built-in protection against abuse
- **Security Middleware**: Helmet, CORS, and other security measures
- **Comprehensive Logging**: Winston-based logging system
- **Email & WhatsApp**: OTP delivery via multiple channels
- **File Upload**: S3 integration for media files
- **Agora Integration**: Video calling functionality

## 📁 Project Structure

```
src/
├── app.js                 # Main Express application
├── server.js             # Server startup file
├── config/               # Configuration files
│   ├── database.js       # MySQL connection pool
│   └── redis.js          # Redis client configuration
├── controllers/          # Route controllers
│   ├── authController.js
│   ├── callController.js
│   ├── contactController.js
│   ├── creatorController.js
│   ├── dashboardController.js
│   └── docsController.js
├── middleware/           # Express middleware
│   ├── auth.js          # JWT authentication
│   ├── errorHandler.js  # Global error handling
│   └── logger.js        # Request logging
├── routes/              # API routes
│   ├── auth.js
│   ├── call.js
│   ├── contact.js
│   ├── creator.js
│   ├── dashboard.js
│   └── docs.js
├── utils/               # Utility functions
│   ├── common.js        # Core utilities
│   ├── common-extended.js
│   ├── mail.js          # Email utilities
│   ├── validations.js   # Input validation
│   └── whatsapp.js      # WhatsApp utilities
└── agora/               # Agora video calling
    ├── AccessToken2.js
    └── RtcTokenBuilder2.js
```

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```env
# Application Environment
APP_ENV=local  # or 'production'

# Server Configuration
PORT=4000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_USERNAME=your_username
DB_PASSWORD=your_password
DB_DATABASE=bingeme_db
DB_PORT=3306
DB_CONNECTION_LIMIT=10

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# JWT Configuration
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
JWT_ACCESS_EXPIRES=1h
JWT_REFRESH_EXPIRES=60d

# AWS Configuration
AWS_DEFAULT_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
ADMIN_EMAIL=admin@bingeme.com

# WhatsApp Configuration
WHATSAPP_API_URL=your_whatsapp_api_url
WHATSAPP_API_KEY=your_whatsapp_api_key

# Agora Configuration
AGORA_APP_ID=your_agora_app_id
AGORA_APP_CERTIFICATE=your_agora_certificate

# Security
ENCRYPT_SECRET_ID=your_32_character_secret
INVISIBLE_RECAPTCHA_SECRETKEY=your_recaptcha_secret

# CDN Configuration
CDN_ENV=bingeme
```

## 🚀 Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Set up Environment Variables**
   ```bash
   # Edit .env with your configuration
   # Make sure to set APP_ENV=local for development
   ```

3. **Set up Database**
   ```bash
   # Create MySQL database
   mysql -u root -p
   CREATE DATABASE bingeme_db;
   
   # Import schema
   mysql -u root -p bingeme_db < bingeme_schema.sql
   ```

4. **Set up DynamoDB Tables**
   ```bash
   # Create required DynamoDB tables
   # - sessions-{env}
   # - rate_limits-{env}
   # - otp-{env}
   # - fcm-token-{env}
   ```

5. **Start the Server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 📚 API Documentation

The API documentation is available at `/docs` when the server is running. It provides an interactive Swagger UI for testing all endpoints.

### Environment-Based URLs
- **Local Development**: `http://localhost:4000/docs` (when `APP_ENV=local`)
- **Production**: `https://api.bingeme.com/docs` (when `APP_ENV=production`)

### Available Endpoints

#### Authentication (`/auth`)
- `POST /signup` - User registration
- `POST /signup/verify` - OTP verification
- `POST /login` - User login
- `POST /login/verify` - Login OTP verification
- `POST /refresh` - Token refresh
- `POST /logout` - User logout
- `GET /validate` - Token validation
- `POST /forgot-password/otp` - Forgot password request
- `POST /forgot-password/verify` - Forgot password OTP verification
- `POST /reset-password` - Password reset
- `POST /google` - Google sign-in
- `POST /apple` - Apple sign-in
- `GET /init` - Anonymous user initialization
- `GET /suspended` - Suspended account info

#### Video Calls (`/call`)
- `GET /agora/details` - Get Agora configuration for video calls

#### Contact (`/contact`)
- `GET /` - Get contact form configuration
- `POST /` - Submit contact form

#### Creator (`/creator`)
- `GET /settings` - Get creator settings
- `POST /settings` - Update creator settings
- `GET /block-countries` - Get blocked countries
- `POST /block-countries` - Update blocked countries
- `GET /subscription-setting` - Get subscription settings
- `POST /subscription-setting` - Update subscription settings
- `GET /agreement` - Get creator agreement status
- `POST /agreement` - Accept creator agreement
- `GET /upload-url` - Get file upload URL
- `GET /agreement-pdf` - Download creator agreement PDF
- `GET /dashboard` - Get creator dashboard
- `GET /payment-received` - Get payments received
- `GET /withdrawals` - Get withdrawals

#### Dashboard (`/dashboard`)
- `GET /` - Get dashboard data
- `GET /posts-report` - Get posts report
- `GET /income-chart` - Get income chart data

#### Documentation (`/docs`)
- `GET /` - Swagger UI
- `GET /swagger` - Swagger JSON specification

## 🔄 Conversion Status

### ✅ All Handlers Converted
- [x] Authentication handlers
- [x] Call handlers
- [x] Contact handlers
- [x] Creator handlers
- [x] Dashboard handlers
- [x] Documentation handlers
- [x] Live handlers
- [x] Message handlers
- [x] Notification handlers
- [x] Pages handlers
- [x] Payout handlers
- [x] Posts handlers
- [x] Privacy handlers
- [x] Products handlers
- [x] Sales handlers
- [x] User handlers
- [x] Verification handlers
- [x] Media handlers

**🎉 Migration Complete!** All Lambda functions have been successfully converted to Express.js with 100% feature parity.

## 🔒 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Rate Limiting**: Protection against brute force attacks
- **Input Validation**: Comprehensive input sanitization
- **CORS Protection**: Configurable cross-origin resource sharing
- **Helmet Security**: Security headers and protection
- **SQL Injection Prevention**: Parameterized queries
- **XSS Protection**: Input sanitization and output encoding

## 📊 Monitoring & Logging

- **Winston Logging**: Structured logging with different levels
- **Request Logging**: All API requests are logged
- **Error Tracking**: Comprehensive error logging and handling
- **Performance Monitoring**: Request duration tracking

## 🚀 Deployment

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4000
CMD ["npm", "start"]
```

### PM2 Deployment
```bash
npm install -g pm2
pm2 start src/server.js --name "bingeme-api"
pm2 save
pm2 startup
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions, please contact the development team or create an issue in the repository.
