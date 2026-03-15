import express from 'express';
import backgroundsRouter from './backgrounds.js';
import videoRoutes from './videoRoutes.js';
import authRoutes from './authRoutes.js';
import historyRoutes from './historyRoutes.js';
import adminRoutes from './adminRoutes.js';

const router = express.Router();

// Mount routes
router.use(authRoutes);
router.use(backgroundsRouter);
router.use(videoRoutes);
router.use(historyRoutes);
router.use(adminRoutes);

export default router;
