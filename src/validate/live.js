/**
 * @file live.js
 * @description Live stream validation utilities for Bingeme API Express.js
 * Provides validation functions for live stream data including creation, editing, and management
 */

/**
 * Validates live stream data for creation or editing
 * @param {object} data - Live stream data to validate
 * @param {object} adminSettings - Admin settings for price validation
 * @returns {object} Validation result with valid flag, data, and errors
 */
const validateLiveStreamData = (data, adminSettings) => {
  const errors = [];
  const validatedData = {};

  try {
    // Validate title
    if (!data.title || typeof data.title !== 'string') {
      errors.push('Title is required and must be a string');
    } else if (data.title.trim().length < 3) {
      errors.push('Title must be at least 3 characters long');
    } else if (data.title.length > 100) {
      errors.push('Title must not exceed 100 characters');
    } else {
      validatedData.title = data.title.trim();
    }

    // Validate description (optional)
    if (data.description !== undefined) {
      if (typeof data.description !== 'string') {
        errors.push('Description must be a string');
      } else if (data.description.length > 500) {
        errors.push('Description must not exceed 500 characters');
      } else {
        validatedData.description = data.description.trim();
      }
    }

    // Validate scheduled time
    if (data.scheduled_time) {
      const scheduledTime = new Date(data.scheduled_time);
      if (isNaN(scheduledTime.getTime())) {
        errors.push('Scheduled time must be a valid date');
      } else {
        const now = new Date();
        if (scheduledTime <= now) {
          errors.push('Scheduled time must be in the future');
        } else {
          validatedData.scheduled_time = scheduledTime.toISOString();
        }
      }
    }

    // Validate price (if provided)
    if (data.price !== undefined) {
      const price = parseFloat(data.price);
      if (isNaN(price) || price < 0) {
        errors.push('Price must be a valid positive number');
      } else {
        // Check against admin settings for minimum price
        const minPrice = adminSettings?.min_live_price || 0;
        if (price < minPrice) {
          errors.push(`Price must be at least ${minPrice}`);
        } else {
          validatedData.price = price;
        }
      }
    }

    // Validate duration (if provided)
    if (data.duration !== undefined) {
      const duration = parseInt(data.duration);
      if (isNaN(duration) || duration <= 0) {
        errors.push('Duration must be a valid positive number');
      } else {
        const maxDuration = adminSettings?.max_live_duration || 1440; // 24 hours in minutes
        if (duration > maxDuration) {
          errors.push(`Duration must not exceed ${maxDuration} minutes`);
        } else {
          validatedData.duration = duration;
        }
      }
    }

    // Validate category (if provided)
    if (data.category !== undefined) {
      if (typeof data.category !== 'string') {
        errors.push('Category must be a string');
      } else {
        const validCategories = ['entertainment', 'education', 'gaming', 'music', 'sports', 'other'];
        if (!validCategories.includes(data.category.toLowerCase())) {
          errors.push(`Category must be one of: ${validCategories.join(', ')}`);
        } else {
          validatedData.category = data.category.toLowerCase();
        }
      }
    }

    // Validate tags (if provided)
    if (data.tags !== undefined) {
      if (!Array.isArray(data.tags)) {
        errors.push('Tags must be an array');
      } else if (data.tags.length > 10) {
        errors.push('Maximum 10 tags allowed');
      } else {
        const validTags = data.tags.every(tag => 
          typeof tag === 'string' && tag.trim().length > 0 && tag.length <= 20
        );
        if (!validTags) {
          errors.push('All tags must be non-empty strings with maximum 20 characters');
        } else {
          validatedData.tags = data.tags.map(tag => tag.trim());
        }
      }
    }

    // Validate is_private flag
    if (data.is_private !== undefined) {
      if (typeof data.is_private !== 'boolean') {
        errors.push('is_private must be a boolean value');
      } else {
        validatedData.is_private = data.is_private;
      }
    }

    // Validate allow_comments flag
    if (data.allow_comments !== undefined) {
      if (typeof data.allow_comments !== 'boolean') {
        errors.push('allow_comments must be a boolean value');
      } else {
        validatedData.allow_comments = data.allow_comments;
      }
    }

    // Validate allow_tips flag
    if (data.allow_tips !== undefined) {
      if (typeof data.allow_tips !== 'boolean') {
        errors.push('allow_tips must be a boolean value');
      } else {
        validatedData.allow_tips = data.allow_tips;
      }
    }

    // Validate tipping menu data (if provided)
    if (data.tipping_menu !== undefined) {
      if (!Array.isArray(data.tipping_menu)) {
        errors.push('Tipping menu must be an array');
      } else {
        const validTippingMenu = data.tipping_menu.every(item => 
          typeof item === 'object' && 
          typeof item.name === 'string' && 
          typeof item.amount === 'number' &&
          item.name.trim().length > 0 &&
          item.amount > 0
        );
        if (!validTippingMenu) {
          errors.push('Tipping menu items must have valid name and amount');
        } else {
          validatedData.tipping_menu = data.tipping_menu;
        }
      }
    }

    // Validate goals data (if provided)
    if (data.goals !== undefined) {
      if (!Array.isArray(data.goals)) {
        errors.push('Goals must be an array');
      } else {
        const validGoals = data.goals.every(goal => 
          typeof goal === 'object' && 
          typeof goal.goal_name === 'string' && 
          typeof goal.coins === 'number' &&
          goal.goal_name.trim().length > 0 &&
          goal.coins > 0
        );
        if (!validGoals) {
          errors.push('Goals must have valid goal_name and coins');
        } else {
          validatedData.goals = data.goals;
        }
      }
    }

    return {
      valid: errors.length === 0,
      data: validatedData,
      errors: errors
    };

  } catch (error) {
    return {
      valid: false,
      data: {},
      errors: ['Invalid data format']
    };
  }
};

/**
 * Validates live stream ID format
 * @param {string} liveId - Live stream ID to validate
 * @returns {boolean} True if valid, false otherwise
 */
const validateLiveId = (liveId) => {
  if (!liveId || typeof liveId !== 'string') {
    return false;
  }
  
  // Check if it's a valid encrypted ID format (24 characters)
  return /^[a-zA-Z0-9]{24}$/.test(liveId);
};

/**
 * Validates live stream filter parameters
 * @param {object} filters - Filter parameters to validate
 * @returns {object} Validation result with valid flag and errors
 */
const validateLiveFilters = (filters) => {
  const errors = [];
  const validatedFilters = {};

  // Validate category filter
  if (filters.category) {
    const validCategories = ['entertainment', 'education', 'gaming', 'music', 'sports', 'other'];
    if (!validCategories.includes(filters.category.toLowerCase())) {
      errors.push(`Invalid category filter. Must be one of: ${validCategories.join(', ')}`);
    } else {
      validatedFilters.category = filters.category.toLowerCase();
    }
  }

  // Validate price range
  if (filters.min_price !== undefined) {
    const minPrice = parseFloat(filters.min_price);
    if (isNaN(minPrice) || minPrice < 0) {
      errors.push('Minimum price must be a valid positive number');
    } else {
      validatedFilters.min_price = minPrice;
    }
  }

  if (filters.max_price !== undefined) {
    const maxPrice = parseFloat(filters.max_price);
    if (isNaN(maxPrice) || maxPrice < 0) {
      errors.push('Maximum price must be a valid positive number');
    } else {
      validatedFilters.max_price = maxPrice;
    }
  }

  // Validate date range
  if (filters.start_date) {
    const startDate = new Date(filters.start_date);
    if (isNaN(startDate.getTime())) {
      errors.push('Start date must be a valid date');
    } else {
      validatedFilters.start_date = startDate.toISOString();
    }
  }

  if (filters.end_date) {
    const endDate = new Date(filters.end_date);
    if (isNaN(endDate.getTime())) {
      errors.push('End date must be a valid date');
    } else {
      validatedFilters.end_date = endDate.toISOString();
    }
  }

  // Validate pagination
  if (filters.limit !== undefined) {
    const limit = parseInt(filters.limit);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      errors.push('Limit must be between 1 and 100');
    } else {
      validatedFilters.limit = limit;
    }
  }

  if (filters.skip !== undefined) {
    const skip = parseInt(filters.skip);
    if (isNaN(skip) || skip < 0) {
      errors.push('Skip must be a non-negative number');
    } else {
      validatedFilters.skip = skip;
    }
  }

  return {
    valid: errors.length === 0,
    filters: validatedFilters,
    errors: errors
  };
};

// Export all functions at the end
export {
  validateLiveStreamData,
  validateLiveId,
  validateLiveFilters
};