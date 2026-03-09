import { enqueueVideoGeneration, getProgress, subscribeToProgress, checkJobResult } from '../services/videoService.js';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * POST /generate-video
 * Enqueues a video generation job and returns immediately with jobId
 */
export const generateVideoEndpoint = async (req, res) => {
    const requestData = req.body;
    const requestId = requestData.request_id || uuidv4();

    try {
        const result = await enqueueVideoGeneration(requestData, requestId);

        if (result.status === 'already_processing') {
            return res.status(202).json({
                message: "Already processing",
                jobId: result.jobId,
                status: 'already_processing'
            });
        }

        // Return 202 Accepted with the job ID
        return res.status(202).json({
            message: "Video generation queued",
            jobId: result.jobId,
            status: 'queued'
        });

    } catch (error) {
        console.error("Failed to enqueue generation:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /progress/:requestId
 * SSE endpoint for real-time progress updates
 */
export const getProgressStream = (req, res) => {
    const { requestId } = req.params;

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    getProgress(requestId, (data, isComplete) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (isComplete) {
            res.end();
        }
    }, req);
};

/**
 * GET /download/:jobId
 * Downloads the completed video file
 */
export const downloadVideoEndpoint = async (req, res) => {
    const { jobId } = req.params;

    try {
        const result = await checkJobResult(jobId);

        if (!result) {
            return res.status(404).json({
                error: 'Video not found or still processing. Check progress endpoint.'
            });
        }

        const videoPath = result.path;

        if (!fs.existsSync(videoPath)) {
            return res.status(410).json({
                error: 'Video file has expired. Please generate a new one.'
            });
        }

        res.download(videoPath, `quran_video_${jobId}.mp4`, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            // Cleanup immediately after download completes
            try {
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                console.log(`Deleted output file: ${videoPath}`);
            } catch (cleanupErr) {
                console.error("Failed to delete output file:", cleanupErr);
            }
        });

    } catch (error) {
        console.error("Download failed:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /subscribe
 * Subscribe to push notifications for a specific request
 */
export const subscribe = (req, res) => {
    const { requestId, subscription } = req.body;
    subscribeToProgress(requestId, subscription);
    res.status(201).json({ message: "Subscribed successfully" });
};

/**
 * POST /upload-background
 * Handle the foreground upload of background videos bypassing external rate limits
 */
export const uploadBackground = (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file provided" });
        }

        // Return the absolute path on the disk to the frontend so it can pass it to generate-video
        res.status(200).json({ filePath: req.file.path });
    } catch (error) {
        console.error("Upload failed:", error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /check-background
 * Verify if a specific background video is already cached on the server
 */
export const checkBackground = (req, res) => {
    try {
        const { id } = req.body;
        if (!id) {
            return res.status(400).json({ error: "Background ID is required" });
        }

        const expectedPath = path.join(process.cwd(), 'uploads', `pexels_${id}.mp4`);
        if (fs.existsSync(expectedPath)) {
            // It's cached! Return the local path
            return res.status(200).json({ exists: true, filePath: expectedPath });
        } else {
            // Not cached, frontend must download and upload it
            return res.status(200).json({ exists: false, filePath: null });
        }
    } catch (error) {
        console.error("Check background failed:", error);
        res.status(500).json({ error: error.message });
    }
};
