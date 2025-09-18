/**
 * @file pagesController.js
 * @description Optimized controller for pages API endpoint - similar to templar_influencer PagesController
 */
import { 
  logInfo, 
  logError, 
  createErrorResponse, 
  createSuccessResponse, 
  createExpressSuccessResponse,
  createExpressErrorResponse,
  getAuthenticatedUserId, 
  getVerifiedUserById 
} from '../utils/common.js';
import { getDB } from '../config/database.js';

// Common response headers
const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Credentials': true
};

// Response helper functions
const createResponse = (statusCode, body) => ({
  statusCode,
  headers: COMMON_HEADERS,
  body: JSON.stringify(body)
});

const createErrorResponse = (statusCode, error, message) => 
  createResponse(statusCode, { error, message });

const createSuccessResponse = (data) => 
  createResponse(200, { success: true, data });

/**
 * Handler for pages API endpoint
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getPage = async (req, res) => {
  try {
    // TODO: Convert event.httpMethod, event.pathParameters, event.headers to req.method, req.params, req.headers
    const { method: httpMethod, params: pathParameters, headers } = req;
    
    // Get page slug from path parameters
    // TODO: Convert pathParameters?.slug to pathParameters?.slug
    const pageSlug = pathParameters?.slug;
    if (!pageSlug) {
      // TODO: Convert createErrorResponse(400, 'Bad request', 'Page slug is required') to res.status(400).json({ error: 'Bad request', message: 'Page slug is required' })
      return res.status(400).json({ error: 'Bad request', message: 'Page slug is required' });
    }
    
    // Step 2: Handle user authentication (required for profile routes)
    // TODO: Convert getAuthenticatedUserId(event, { action: 'page access' }) to getAuthenticatedUserId(req, { action: 'page access' })
    const authResult = getAuthenticatedUserId(req, { action: 'page access' });
    if (authResult.errorResponse) {
      // TODO: Convert return authResult.errorResponse to return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body)
      return res.status(authResult.errorResponse.statusCode).json(authResult.errorResponse.body);
    }
    
    const userId = authResult.userId;
    
    // Get page from database
    const page = await getPageBySlug(pageSlug);
    
    if (!page) {
      // TODO: Convert createErrorResponse(404, 'Page not found', `The requested page '${pageSlug}' could not be found`) to res.status(404).json({ error: 'Page not found', message: `The requested page '${pageSlug}' could not be found` })
      return res.status(404).json({ error: 'Page not found', message: `The requested page '${pageSlug}' could not be found` });
    }
    
    // Check access permissions
    if (page.access === 'creators') {
      if (!userId) {
        // TODO: Convert createErrorResponse(403, 'Access denied', 'This page is only accessible to verified creators. Please login with a creator account.') to res.status(403).json({ error: 'Access denied', message: 'This page is only accessible to verified creators. Please login with a creator account.' })
        return res.status(403).json({ error: 'Access denied', message: 'This page is only accessible to verified creators. Please login with a creator account.' });
      }
      
      // Check if user is a verified creator
      logInfo('Checking if user is verified creator:', { userId, userIdType: typeof userId });
      const verifiedUser = await getVerifiedUserById(userId);
      logInfo('Verified user result:', { userId, verifiedUser: !!verifiedUser, verifiedUserDetails: verifiedUser });
      if (!verifiedUser) {
        // TODO: Convert createErrorResponse(403, 'Access denied', 'This page is only accessible to verified creators') to res.status(403).json({ error: 'Access denied', message: 'This page is only accessible to verified creators' })
        return res.status(403).json({ error: 'Access denied', message: 'This page is only accessible to verified creators' });
      }
    } else if (page.access === 'members' && !userId) {
      // TODO: Convert createErrorResponse(403, 'Access denied', 'This page is only accessible to authenticated members') to res.status(403).json({ error: 'Access denied', message: 'This page is only accessible to authenticated members' })
      return res.status(403).json({ error: 'Access denied', message: 'This page is only accessible to authenticated members' });
    }
    
    // Return page data
    // TODO: Convert createSuccessResponse({ title: page.title, description: page.description, keywords: page.keywords, content: page.content }) to res.json({ success: true, data: { title: page.title, description: page.description, keywords: page.keywords, content: page.content } })
    return res.json({
      success: true,
      data: {
        title: page.title,
        description: page.description,
        keywords: page.keywords,
        content: page.content
      }
    });
    
  } catch (error) {
    logError('Error in pages handler:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error', 'An error occurred while processing your request') to res.status(500).json({ error: 'Internal server error', message: 'An error occurred while processing your request' })
    return res.status(500).json({ error: 'Internal server error', message: 'An error occurred while processing your request' });
  }
};

/**
 * Get page by slug from database with locale fallback
 * @param {string} pageSlug - The slug of the page to retrieve
 * @returns {Promise<Object|null>} Page data or null if not found
 */
const getPageBySlug = async (pageSlug) => {
  try {
    logInfo('Getting page by slug:', { pageSlug });
    
    // First try to get page in current locale (default to 'es' based on schema)
    const currentLocale = process.env.DEFAULT_LOCALE || 'es';
    
    let page = await getPageFromDatabase(pageSlug, currentLocale);
    
    // If not found in current locale, try default locale
    if (!page && currentLocale !== 'es') {
      logInfo('Page not found in current locale, trying default locale:', { pageSlug, currentLocale, fallback: 'es' });
      page = await getPageFromDatabase(pageSlug, 'es');
    }
    
    if (!page) {
      logInfo('Page not found in any locale:', { pageSlug });
      return null;
    }
    
    logInfo('Page retrieved successfully:', { pageSlug, title: page.title, access: page.access });
    return page;
    
  } catch (error) {
    logError('Error getting page by slug:', { pageSlug, error: error.message });
    throw error;
  }
};

/**
 * Retrieve page data from database
 * @param {string} pageSlug - The slug of the page
 * @param {string} locale - The language locale
 * @returns {Promise<Object|null>} Page data or null if not found
 */
const getPageFromDatabase = async (pageSlug, locale) => {
  try {
    const pool = getDB();
    const query = `
      SELECT 
        id,
        title,
        slug,
        content,
        description,
        keywords,
        lang,
        access
      FROM pages 
      WHERE slug = ? AND lang = ?
      LIMIT 1
    `;
    
    const [rows] = await pool.execute(query, [pageSlug, locale]);
    
    if (rows.length === 0) {
      return null;
    }
    
    return rows[0];
    
  } catch (error) {
    logError('Database error getting page:', { pageSlug, locale, error: error.message });
    throw error;
  }
};