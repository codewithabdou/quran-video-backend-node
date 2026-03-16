import express from 'express';
import backgroundsRouter from './backgrounds.js';
import videoRoutes from './videoRoutes.js';
import authRoutes from './authRoutes.js';
import historyRoutes from './historyRoutes.js';
import adminRoutes from './adminRoutes.js';
import { getPublicStats } from '../controllers/publicController.js';

const router = express.Router();

// Public routes (no authentication required) — must be before adminRoutes
/**
 * @swagger
 * /public/stats:
 *   get:
 *     summary: Get public platform statistics
 *     description: Returns aggregate platform stats (total generations, active users) for display on the landing page. No authentication required.
 *     tags: [Public]
 *     responses:
 *       200:
 *         description: Public statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activeUsers:
 *                   type: integer
 *                 totalGenerations:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/public/stats', getPublicStats);

// Mount routes
router.use(authRoutes);
router.use(backgroundsRouter);
router.use(videoRoutes);
router.use(historyRoutes);
router.use(adminRoutes);

export default router;
