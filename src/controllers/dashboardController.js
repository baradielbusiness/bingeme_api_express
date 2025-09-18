/**
 * @file dashboardController.js
 * @description Dashboard controller for Bingeme API Express.js
 * Handles dashboard data, reports, and analytics
 */

import { getDB } from '../config/database.js';
import { 
  logInfo, 
  logError, 
  getAuthenticatedUserId, 
  getUserById,
  createExpressSuccessResponse,
  createExpressErrorResponse,
  createSuccessResponse,
  createErrorResponse
} from '../utils/common.js';
import { getSocialUrls, getCreatorEarningsData, getEarningsOverview } from '../utils/dashboard/dashboard_overview.js';
import { getPostsReportData } from './posts_report.js';
import { getIncomeChartData } from './income_chart.js';

/**
 * GET /dashboard - Main dashboard handler for authenticated users.
 * Exact implementation matching Lambda getDashboardHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Standardized API response with dashboard data
 */
export const getDashboard = async (req, res) => {
  try {
    logInfo('Dashboard request received');
    
    // Authenticate user and extract info from token
    // TODO: Convert getAuthenticatedUserId(event, { action: 'dashboard handler' }) to getAuthenticatedUserId(req, { action: 'dashboard handler' })
    const { userId, decoded, errorResponse } = getAuthenticatedUserId(req, { action: 'dashboard handler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }
    
    const { email, role, username } = decoded;
    logInfo('Access token verified successfully:', { userId, email, role });
    
    // Extract period from query parameters
    // Handle case where queryStringParameters might be null or undefined
    // TODO: Convert event.queryStringParameters to req.query
    const queryStringParameters = req.query || {};
    
    // Check if any query parameters are present
    const hasQueryParams = Object.keys(queryStringParameters).length > 0;
    
    // Set period based on whether parameters were provided
    let period;
    if (hasQueryParams && queryStringParameters.period) {
      // User explicitly provided a period parameter
      period = queryStringParameters.period;
    } else {
      // No parameters provided, use 'year' as default for earnings_overview
      period = 'year';
    }
    
    // Validate period parameter
    if (!['year', 'month', 'week'].includes(period)) {
      // TODO: Convert createErrorResponse(400, 'Invalid period parameter. Must be one of: year, month, week') to res.status(400).json({ error: 'Invalid period parameter. Must be one of: year, month, week' })
      return res.status(400).json(createErrorResponse(400, 'Invalid period parameter. Must be one of: year, month, week'));
    }
    
    logInfo('Processing dashboard request:', { userId, role, period, hasQueryParams });
    
    // Fetch comprehensive dashboard data
    // Note: creator_earnings always shows today/week/month regardless of period
    // Only earnings_overview is filtered by the period parameter
    const [
      creatorEarnings,
      socialUrls,
      earningsOverview
    ] = await Promise.all([
      getCreatorEarningsData(userId, role), // Remove period parameter
      getSocialUrls(userId, username),
      getEarningsOverview(userId, role, period) // Keep period parameter for earnings overview
    ]);

    // Compose base dashboard response
    const dashboardData = {
      period: period,
      creator_earnings: creatorEarnings,
      social_urls: socialUrls,
      earnings_overview: earningsOverview
    };

    // When no query parameters are passed, include post_report and income_report
    if (!hasQueryParams) {
      logInfo('No query parameters detected, including post_report and income_report');
      
      try {
        // Fetch posts report data (default to yearly)
        const postsReportData = await getPostsReportData(userId, 'year');
        dashboardData.post_report = postsReportData;
        
        // Fetch income chart data (default to yearly, current year)
        const incomeChartData = await getIncomeChartData(userId, 'year', null);
        dashboardData.income_report = incomeChartData;
        
        logInfo('Additional data fetched successfully:', { 
          postsTotal: postsReportData.total_posts,
          incomeTotal: incomeChartData.total_earned
        });
      } catch (error) {
        logError('Error fetching additional dashboard data:', error);
        // Continue without additional data rather than failing the entire request
      }
    }

    logInfo('Dashboard data generated successfully:', { 
      userId, 
      role, 
      period,
      hasQueryParams,
      earningsToday: creatorEarnings.today,
      netEarnings: earningsOverview.net_earnings,
      activeSubs: earningsOverview.active_subs,
      additionalDataIncluded: !hasQueryParams
    });

    // TODO: Convert createSuccessResponse('Dashboard data retrieved successfully', dashboardData) to res.status(200).json(createSuccessResponse('Dashboard data retrieved successfully', dashboardData))
    return res.status(200).json(createSuccessResponse('Dashboard data retrieved successfully', dashboardData));
  } catch (error) {
    logError('Dashboard error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /dashboard/posts-report - Main posts report handler for authenticated users.
 * Exact implementation matching Lambda getPostsReportHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Standardized API response with posts report data
 */
export const getPostsReport = async (req, res) => {
  try {
    logInfo('Posts report request received');
    
    // Authenticate user and extract info from token
    // TODO: Convert getAuthenticatedUserId(event, { action: 'posts report handler' }) to getAuthenticatedUserId(req, { action: 'posts report handler' })
    const { userId, decoded, errorResponse } = getAuthenticatedUserId(req, { action: 'posts report handler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }
    
    const { email, role } = decoded;
    logInfo('Access token verified successfully:', { userId, email, role });

    // Extract time period filter from query parameters
    // TODO: Convert event.queryStringParameters to req.query
    const { queryStringParameters = {} } = req;
    const { period = 'year' } = queryStringParameters;
    
    logInfo('Processing posts report request:', { userId, role, period });

    // Fetch posts report data based on selected period
    const postsReportData = await getPostsReportData(userId, period);

    logInfo('Posts report data generated successfully:', { 
      userId, 
      role, 
      period,
      totalPosts: postsReportData.total_posts,
      year: postsReportData.year,
      dataLength: postsReportData.data.length
    });

    // TODO: Convert createSuccessResponse('Posts report data retrieved successfully', postsReportData) to res.status(200).json(createSuccessResponse('Posts report data retrieved successfully', postsReportData))
    return res.status(200).json(createSuccessResponse('Posts report data retrieved successfully', postsReportData));
  } catch (error) {
    logError('Posts report error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};

/**
 * GET /dashboard/income-chart - Main income chart handler for authenticated users.
 * Exact implementation matching Lambda getIncomeChartHandler
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @returns {Promise<object>} Standardized API response with income chart data
 */
export const getIncomeChart = async (req, res) => {
  try {
    logInfo('Income chart request received');
    
    // Authenticate user and extract info from token
    // TODO: Convert getAuthenticatedUserId(event, { action: 'income chart handler' }) to getAuthenticatedUserId(req, { action: 'income chart handler' })
    const { userId, decoded, errorResponse } = getAuthenticatedUserId(req, { action: 'income chart handler' });
    if (errorResponse) {
      // TODO: Convert return errorResponse to return res.status(errorResponse.statusCode).json(errorResponse.body)
      return res.status(errorResponse.statusCode).json(createErrorResponse(errorResponse.statusCode, errorResponse.body.message || errorResponse.body.error));
    }
    
    const { email, role } = decoded;
    logInfo('Access token verified successfully:', { userId, email, role });

    // Extract period and year filters from query parameters
    // TODO: Convert event.queryStringParameters to req.query
    const { queryStringParameters = {} } = req;
    let period = 'year'; // default
    let targetYear = null; // default to current year
    
    if (queryStringParameters.period) {
      period = queryStringParameters.period;
    } else if (queryStringParameters.year) {
      // If year is provided without period, treat it as year period
      period = 'year';
    }
    
    // Extract year parameter if provided
    if (queryStringParameters.year) {
      targetYear = parseInt(queryStringParameters.year);
      if (isNaN(targetYear)) {
        targetYear = new Date().getFullYear(); // fallback to current year if invalid
      }
    }
    
    logInfo('Processing income chart request:', { userId, role, period, targetYear });

    // Fetch income chart data for the specified period and year
    const incomeChartData = await getIncomeChartData(userId, period, targetYear);

    logInfo('Income chart data generated successfully:', { 
      userId, 
      role, 
      period,
      targetYear,
      totalEarned: incomeChartData.total_earned,
      categoriesCount: incomeChartData.data.length
    });

    // TODO: Convert createSuccessResponse('Income chart data retrieved successfully', incomeChartData) to res.status(200).json(createSuccessResponse('Income chart data retrieved successfully', incomeChartData))
    return res.status(200).json(createSuccessResponse('Income chart data retrieved successfully', incomeChartData));
  } catch (error) {
    logError('Income chart error:', error);
    // TODO: Convert createErrorResponse(500, 'Internal server error') to res.status(500).json({ error: 'Internal server error' })
    return res.status(500).json(createErrorResponse(500, 'Internal server error'));
  }
};
