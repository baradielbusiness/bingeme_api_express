/**
 * @file pagesController.js
 * @description Pages controller for Bingeme API Express.js
 * Handles page retrieval with access control and locale support
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

/**
 * Get page by slug with access control
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getPage = async (req, res) => {
  try {
    const { slug } = req.params;
    
    if (!slug) {
      return res.status(400).json(createExpressErrorResponse('Page slug is required', 400));
    }
    
    // Get user ID if authenticated
    const userId = req.userId; // This will be null if not authenticated
    
    // Get page from database
    const page = await getPageBySlug(slug);
    
    if (!page) {
      return res.status(404).json(createExpressErrorResponse(`The requested page '${slug}' could not be found`, 404));
    }
    
    // Check access permissions
    if (page.access === 'creators') {
      if (!userId) {
        return res.status(403).json(createExpressErrorResponse('This page is only accessible to verified creators. Please login with a creator account.', 403));
      }
      
      // Check if user is a verified creator
      logInfo('Checking if user is verified creator:', { userId, userIdType: typeof userId });
      const verifiedUser = await getVerifiedUserById(userId);
      logInfo('Verified user result:', { userId, verifiedUser: !!verifiedUser, verifiedUserDetails: verifiedUser });
      if (!verifiedUser) {
        return res.status(403).json(createErrorResponse(403, 'Access denied', 
          'This page is only accessible to verified creators'));
      }
    } else if (page.access === 'members' && !userId) {
      return res.status(403).json(createExpressErrorResponse('This page is only accessible to authenticated members', 403));
    }
    
    // Return page data
    return res.json(createExpressSuccessResponse('Page retrieved successfully', {
      title: page.title,
      description: page.description,
      keywords: page.keywords,
      content: page.content
    }));
    
  } catch (error) {
    logError('Error in pages handler:', error);
    return res.status(500).json(createExpressErrorResponse('An error occurred while processing your request', 500));
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