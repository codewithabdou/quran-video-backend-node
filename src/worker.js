import { Worker } from 'bullmq';
import { VIDEO_QUEUE_NAME, redisConnection, setProgress, setJobResult } from './config/queue.js';
import { coreGenerationLogic } from './services/videoService.js';

/**
 * BullMQ Worker for video generation jobs
 * Processes one job at a time (concurrency: 1) since FFmpeg is CPU-heavy
 */
const worker = new Worker(
    VIDEO_QUEUE_NAME,
    async (job) => {
        const { requestData, requestId } = job.data;
        console.log(`[Worker] Processing job ${job.id} (requestId: ${requestId})`);

        const updateProgress = async (percentage, status) => {
            await setProgress(requestId, { status, percentage });
            // Also update BullMQ's built-in progress tracking
            await job.updateProgress(percentage);
        };

        try {
            await updateProgress(5, 'status_starting');

            const result = await coreGenerationLogic(requestData, requestId, updateProgress);

            // Store the result path for the download endpoint
            await setJobResult(requestId, result.path);
            await updateProgress(100, 'status_completed');

            console.log(`[Worker] Job ${job.id} completed. Output: ${result.path}`);
            return { path: result.path, status: 'completed' };
        } catch (error) {
            console.error(`[Worker] Job ${job.id} failed:`, error.message);
            await setProgress(requestId, { error: error.message, status: 'failed' });
            throw error; // BullMQ will mark the job as failed
        }
    },
    {
        connection: redisConnection,
        concurrency: 1, // Process one video at a time
        limiter: {
            max: 1,
            duration: 1000, // Max 1 job per second to prevent resource spikes
        },
    }
);

// Worker event handlers
worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
});

worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err);
});

console.log('[Worker] Video generation worker started');

export default worker;
