import express from 'express';
import { generateVideoEndpoint, getProgressStream, subscribe, downloadVideoEndpoint, uploadBackground, checkBackground, cancelVideoEndpoint, getAdminJobsEndpoint, cancelAdminJobEndpoint } from '../controllers/videoController.js';
import { videoGenerationLimiter } from '../middleware/rateLimiter.js';
import { validateVideoRequest, validateRequestId, validateSubscription } from '../middleware/validation.js';
import { upload } from '../middleware/upload.js';
import { concurrencyLimiter } from '../middleware/concurrencyLimiter.js';

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
 *     summary: Queue a Quran video generation job
 *     description: Adds a video generation job to the queue and returns immediately with a jobId. Use the progress endpoint to track status and the download endpoint to retrieve the result. Only one concurrent job per IP is allowed.
 *     tags: [Generator]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VideoRequest'
 *     responses:
 *       202:
 *         description: Video generation queued successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [queued, already_processing]
 *       429:
 *         description: A video is already being generated for this IP
 *       500:
 *         description: Server error
 */
router.post('/generate-video', videoGenerationLimiter, concurrencyLimiter, validateVideoRequest, generateVideoEndpoint);

/**
 * @swagger
 * /generate-video/cancel:
 *   delete:
 *     summary: Cancel the active video generation job for the requesting IP
 *     description: Clears the rate limit lock, deletes progress data, and attempts to remove the job from the queue if it hasn't started.
 *     tags: [Generator]
 *     responses:
 *       200:
 *         description: Active job cancelled successfully
 *       404:
 *         description: No active job found for this IP
 *       500:
 *         description: Server error
 */
router.delete('/generate-video/cancel', cancelVideoEndpoint);

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
 *         description: Job ID returned from generate-video
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
 * /download/{jobId}:
 *   get:
 *     summary: Download a completed video
 *     description: Downloads the generated video file. Available for 30 minutes after completion.
 *     tags: [Generator]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         schema:
 *           type: string
 *         required: true
 *         description: Job ID returned from generate-video
 *     responses:
 *       200:
 *         description: Video file download
 *         content:
 *           video/mp4:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Video not found or still processing
 *       410:
 *         description: Video file has expired
 */
router.get('/download/:jobId', downloadVideoEndpoint);

/**
 * @swagger
 * /check-background:
 *   post:
 *     summary: Verify if a background video is already cached on the server
 *     tags: [Generator]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Check status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *                 filePath:
 *                   type: string
 *                   format: nullable
 */
router.post('/check-background', checkBackground);

/**
 * @swagger
 * /upload-background:
 *   post:
 *     summary: Upload a background video for a generation job
 *     tags: [Generator]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Video file uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 filePath:
 *                   type: string
 */
router.post('/upload-background', upload.single('file'), uploadBackground);

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

/**
 * @swagger
 * /admin/jobs:
 *   get:
 *     summary: Get all jobs in queue (Admin)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: List of jobs
 */
router.get('/admin/jobs', getAdminJobsEndpoint);

/**
 * @swagger
 * /admin/jobs/{jobId}:
 *   delete:
 *     summary: Cancel a job by ID (Admin)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job Cancelled
 */
router.delete('/admin/jobs/:jobId', cancelAdminJobEndpoint);

export default router;
