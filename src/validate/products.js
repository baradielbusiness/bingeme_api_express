/**
 * Validate product input
 */
const validateProductInput = (input, options = {}) => {
  const errors = [];
  const { isUpdate = false } = options;
  
  if (!input || typeof input !== 'object') {
    errors.push('Input must be an object');
    return errors;
  }
  
  const { name, price, delivery_time, tags, description, type } = input;
  
  // Validate name
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Product name is required');
  } else if (name.length > 100) {
    errors.push('Product name must be less than 100 characters');
  }
  
  // Validate price
  if (price === undefined || price === null) {
    errors.push('Price is required');
  } else if (typeof price !== 'number' || price < 0) {
    errors.push('Price must be a positive number');
  }
  
  // Validate delivery time
  if (delivery_time !== undefined && (typeof delivery_time !== 'number' || delivery_time < 0)) {
    errors.push('Delivery time must be a positive number');
  }
  
  // Validate tags
  if (tags !== undefined) {
    if (!Array.isArray(tags)) {
      errors.push('Tags must be an array');
    } else if (tags.length > 10) {
      errors.push('Maximum 10 tags allowed');
    }
  }
  
  // Validate description
  if (description !== undefined && (typeof description !== 'string' || description.length > 1000)) {
    errors.push('Description must be less than 1000 characters');
  }
  
  // Validate type
  if (type !== undefined) {
    const validTypes = ['physical', 'digital', 'service'];
    if (!validTypes.includes(type)) {
      errors.push('Type must be one of: physical, digital, service');
    }
  }
  
  return errors;
};

/**
 * Validate product ID
 */
const validateProductId = (productId) => {
  const errors = [];
  
  if (!productId) {
    errors.push('Product ID is required');
  } else if (typeof productId !== 'string' && typeof productId !== 'number') {
    errors.push('Product ID must be a string or number');
  } else if (isNaN(parseInt(productId))) {
    errors.push('Product ID must be a valid number');
  }
  
  return errors;
};

// Export all functions at the end
export {
  validateProductInput,
  validateProductId
};