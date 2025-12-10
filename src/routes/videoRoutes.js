import express from 'express';
import { generateVideoEndpoint, getProgressStream, subscribe } from '../controllers/videoController.js';
import { videoGenerationLimiter } from '../middleware/rateLimiter.js';
import { validateVideoRequest, validateRequestId, validateSubscription } from '../middleware/validation.js';

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     VideoRequest:
 *       type: object
 *       required:
 *         - surah
 *         - ayah_start
 *         - ayah_end
 *         - reciter_id
 *         - translation_id
 *         - background_url
 *       properties:
 *         surah:
 *           type: integer
 *           description: Surah number (1-114)
 *           example: 1
 *         ayah_start:
 *           type: integer
 *           description: Starting Ayah number
 *           example: 1
 *         ayah_end:
 *           type: integer
 *           description: Ending Ayah number
 *           example: 7
 *         reciter_id:
 *           type: string
 *           description: AlQuran.cloud edition identifier for audio
 *           example: ar.alafasy
 *         translation_id:
 *           type: string
 *           description: AlQuran.cloud edition identifier for translation
 *           example: en.sahih
 *         background_url:
 *           type: string
 *           description: Direct URL to the background video file
 *           example: https://example.com/video.mp4
 *         resolution:
 *           type: integer
 *           description: Target width resolution (720 or 1080)
 *           default: 720
 *         platform:
 *           type: string
 *           description: Video format ('reel' for 9:16, 'youtube' for 16:9)
 *           enum: [reel, youtube]
 *           default: reel
 *           example: reel
 */

/**
 * @swagger
 * /generate-video:
 *   post:
 *     summary: Generate a Quran video
 *     tags: [Generator]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VideoRequest'
 *     responses:
 *       200:
 *         description: Video generated successfully (returns binary file)
 *         content:
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *       202:
 *         description: Request accepted and processing (if async/SSE used)
 *       500:
 *         description: Server error
 */
router.post('/generate-video', videoGenerationLimiter, validateVideoRequest, generateVideoEndpoint);

/**
 * @swagger
 * /progress/{requestId}:
 *   get:
 *     summary: Subscribe to generation progress (SSE)
 *     tags: [Generator]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         schema:
 *           type: string
 *         required: true
 *         description: GUID of the request
 *     responses:
 *       200:
 *         description: Event stream of progress updates
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 */
router.get('/progress/:requestId', validateRequestId, getProgressStream);

/**
 * @swagger
 * /subscribe:
 *   post:
 *     summary: Subscribe to push notifications for a request
 *     tags: [Notifications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - requestId
 *               - subscription
 *             properties:
 *               requestId:
 *                 type: string
 *               subscription:
 *                 type: object
 *                 description: valid PushSubscription object
 *     responses:
 *       201:
 *         description: Subscribed successfully
 */
router.post('/subscribe', validateSubscription, subscribe);

export default router;
