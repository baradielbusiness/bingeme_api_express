import express from 'express';
import * as pagesController from '../controllers/pagesController.js';
import setEdgeCacheHeaders from '../middleware/edgeCacheHeaders.js';

const router = express.Router();

router.get('/pages/:slug', setEdgeCacheHeaders, pagesController.getPage);
router.get('/p/:slug', setEdgeCacheHeaders, pagesController.getPage);

export default router;
