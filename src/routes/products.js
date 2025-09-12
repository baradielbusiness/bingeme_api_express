import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getProducts,
  getProductCreateData,
  createProduct,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductUploadUrl
} from '../controllers/productsController.js';

const router = express.Router();

// Get all products for the authenticated user
router.get('/', authMiddleware, getProducts);

// Get product creation form data (tags, pricing, etc.)
router.get('/create', authMiddleware, getProductCreateData);

// Create a new product
router.post('/create', authMiddleware, createProduct);

// Get pre-signed S3 URL for product media uploads
router.get('/upload-url', authMiddleware, getProductUploadUrl);

// Get a specific product by ID for editing
router.get('/edit/:id', authMiddleware, getProductById);

// Update a specific product by ID
router.put('/edit/:id', authMiddleware, updateProduct);

// Delete a specific product by ID
router.delete('/delete/:id', authMiddleware, deleteProduct);

export default router;
