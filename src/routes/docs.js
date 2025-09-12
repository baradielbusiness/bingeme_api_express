import express from 'express';
import * as docsController from '../controllers/docsController.js';

const router = express.Router();

// Docs routes (no authentication required)
router.get('/', docsController.getSwaggerUI);
router.get('/swagger.json', docsController.getSwaggerJSON);

export default router;
