import { enqueueVideoGeneration, getProgress, subscribeToProgress, checkJobResult } from '../services/videoService.js';
import { getActiveJob, clearActiveJob, deleteProgress, videoQueue, setCancelled, setProgress } from '../config/queue.js';
import { abortJob } from '../worker.js';
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
        const { subscription, ...requestData } = req.body;
        const result = await enqueueVideoGeneration(requestData, requestId, req.ip, req.user?.id || null, subscription);

        if (result.status === 'already_processing') {
            return res.status(202).json({
                message: "Already processing",
                jobId: result.jobId,
                status: 'already_processing'
            });
        }

        if (result.status === 'rate_limit_exceeded') {
            return res.status(429).json({
                error: { message: result.message }
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
 * Internal function to handle the cancellation of an active job by its ID
 * Optionally provide clientIp to explicitly clear the rate limit lock.
 * If clientIp is omitted, it attempts to read it from the job data.
 */
const cancelJobById = async (activeJobId, explicitClientIp = null) => {
    if (!activeJobId) {
        return null; // Nothing to cancel
    }

    let clientIp = explicitClientIp;

    console.log(`[Cancel API/Internal] Cancelling job ${activeJobId}`);

    // Attempt to extract the IP from the queue job data if not provided
    try {
        const job = await videoQueue.getJob(activeJobId);
        if (job) {
            clientIp = job.data.clientIp || explicitClientIp;
        }
    } catch (e) {
        console.error(`[Cancel API/Internal] Error reading job data for IP recovery:`, e.message);
    }

    // 1. Set the cancellation flag in Redis (so worker knows to discard results)
    await setCancelled(activeJobId);

    // 2. Clear the IP rate limit lock so user can start a new one (if we found an IP)
    if (clientIp) {
        await clearActiveJob(clientIp);
    }

    // 3. Set progress to 'cancelled' so the SSE stream notifies the frontend
    await setProgress(activeJobId, { status: 'cancelled', percentage: 0 });

    // 4. Send the abort signal to kill the running FFmpeg process
    const aborted = abortJob(activeJobId);
    if (aborted) {
        console.log(`[Cancel API/Internal] Abort signal sent successfully for job ${activeJobId}.`);
    }

    // 5. Attempt to remove the job from the BullMQ queue (if still waiting)
    try {
        const job = await videoQueue.getJob(activeJobId);
        if (job) {
            const state = await job.getState();
            if (state === 'waiting' || state === 'delayed') {
                await job.remove();
                console.log(`[Cancel API/Internal] Removed job ${activeJobId} from BullMQ queue.`);
            } else if (state === 'active') {
                console.log(`[Cancel API/Internal] Job ${activeJobId} is active — FFmpeg kill signal sent.`);
            }
        }
    } catch (queueErr) {
        console.error(`[Cancel API/Internal] Error removing job from queue:`, queueErr.message);
    }
    
    return activeJobId;
};

/**
 * Internal helper backward compatibility
 */
const cancelJobByIp = async (clientIp) => {
    const activeJobId = await getActiveJob(clientIp);
    return cancelJobById(activeJobId, clientIp);
};

/**
 * GET /admin/jobs
 * List all jobs in the queue for the experimental admin dashboard
 */
export const getAdminJobsEndpoint = async (req, res) => {
    try {
        // BullMQ returns jobs lazily. We will fetch them by status.
        const statuses = ['active', 'waiting', 'delayed', 'completed', 'failed'];
        const jobs = await videoQueue.getJobs(statuses);
        
        // Map to a cleaner dashboard format
        const sortedJobs = jobs.map(job => ({
            id: job.id,
            name: job.name,
            data: job.data.requestData,
            clientIp: job.data.clientIp,
            timestamp: job.timestamp,
            processedOn: job.processedOn,
            finishedOn: job.finishedOn,
            failedReason: job.failedReason,
            status: job._workerName || statuses.find(s => statuses.indexOf(s) > -1), // Approximated
        })).sort((a, b) => b.timestamp - a.timestamp);

        // Fetch precise states
        for (let j of sortedJobs) {
            const rawJob = jobs.find(x => x.id === j.id);
            if (rawJob) {
                 j.status = await rawJob.getState();
            }
        }

        res.status(200).json({ total: sortedJobs.length, jobs: sortedJobs });
    } catch (err) {
        console.error("[Admin API] Failed to list jobs:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /admin/jobs/:jobId
 * Force cancel a specific job by its ID
 */
export const cancelAdminJobEndpoint = async (req, res) => {
    try {
        const { jobId } = req.params;
        const cancelledJobId = await cancelJobById(jobId);

        if (!cancelledJobId) {
            return res.status(404).json({ message: 'No job found or could not cancel.' });
        }

        res.status(200).json({ message: `Job ${jobId} cancelled successfully.` });
    } catch (err) {
        console.error("[Admin API] Failed to cancel job:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /progress/:requestId
 * SSE endpoint for real-time progress updates
 */
export const getProgressStream = (req, res) => {
    const { requestId } = req.params;
    const clientIp = req.ip;

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let isFinished = false;

    getProgress(requestId, (data, isComplete) => {
        if (!isFinished) {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
        if (isComplete) {
            isFinished = true;
            res.end();
        }
    }, req);

    // Automatically cancel the job if the client closes the connection (e.g., closes tab, refresh)
    // before the video has finished rendering.
    req.on('close', async () => {
        if (!isFinished) {
            console.log(`[SSE] Connection closed prematurely by IP ${clientIp}. Auto-cancelling job ${requestId}...`);
            isFinished = true;
            try {
                await cancelJobByIp(clientIp);
            } catch (err) {
                console.error(`[SSE/Cancel] Failed to auto-cancel job on disconnect:`, err);
            }
        }
    });
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

/**
 * Cancel the active video generation job for the user's IP
 */
export const cancelVideoEndpoint = async (req, res, next) => {
    try {
        const clientIp = req.ip;
        const cancelledJobId = await cancelJobByIp(clientIp);

        if (!cancelledJobId) {
            return res.status(404).json({ message: 'No active job found to cancel.' });
        }

        res.status(200).json({ message: 'Active job cancelled successfully.' });
    } catch (err) {
        console.error('[Cancel API] Error cancelling job:', err);
        next(err);
    }
};
