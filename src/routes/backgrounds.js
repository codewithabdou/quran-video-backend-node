import express from 'express';
import { getBackgroundVideos } from '../controllers/backgroundsController.js';

const router = express.Router();

/**
 * @swagger
 * /backgrounds:
 *   get:
 *     summary: Get background videos from Pexels
 *     tags: [Backgrounds]
 *     responses:
 *       200:
 *         description: List of background videos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 videos:
 *                   type: array
 *                   items:
 *                     type: object
 *                 count:
 *                   type: integer
 *       500:
 *         description: Server error
 */
router.get('/backgrounds', getBackgroundVideos);

export default router;
