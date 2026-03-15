import express from 'express';
import { getUserHistory } from '../controllers/historyController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * @swagger
 * /history:
 *   get:
 *     summary: Get generation history
 *     description: Returns paginated list of the authenticated user's video generation history. Only metadata is stored (surah, ayah range, reciter, status, etc.) — not the video itself.
 *     tags: [History]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Paginated generation history
 *       401:
 *         description: Not authenticated
 */
router.get('/history', requireAuth, getUserHistory);

export default router;
