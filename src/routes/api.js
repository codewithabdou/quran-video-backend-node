import express from 'express';
import backgroundsRouter from './backgrounds.js';
import videoRoutes from './videoRoutes.js';

const router = express.Router();

// Mount routes
router.use(backgroundsRouter);
router.use(videoRoutes);

export default router;
