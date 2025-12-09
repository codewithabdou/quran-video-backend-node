import express from 'express';
import { generateVideoEndpoint, progressStream } from '../services/videoGenerator.js';

const router = express.Router();

router.post('/generate-video', generateVideoEndpoint);
router.get('/progress/:requestId', progressStream);

export default router;
