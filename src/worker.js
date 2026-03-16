import { Worker } from 'bullmq';
import { VIDEO_QUEUE_NAME, redisConnection, setProgress, setJobResult, clearActiveJob, isCancelled } from './config/queue.js';
import { coreGenerationLogic } from './services/videoService.js';
import prisma from './config/database.js';
import fs from 'fs';
import path from 'path';

/**
 * Map of active job AbortControllers so the cancel endpoint can signal them.
 * Key: jobId (requestId), Value: AbortController
 */
const activeControllers = new Map();

/**
 * Abort a running job by its requestId.
 * Called from the cancel endpoint.
 */
export const abortJob = (jobId) => {
    const controller = activeControllers.get(jobId);
    if (controller) {
        controller.abort();
        console.log(`[Worker] Abort signal sent for job ${jobId}`);
        return true;
    }
    return false;
};

/**
 * Save generation history to database
 * Only saves if the job was initiated by an authenticated user
 */
const saveGenerationHistory = async (requestData, userId, status, startTime) => {
    if (!userId) return; // Anonymous user — skip

    try {
        const duration = (Date.now() - startTime) / 1000; // seconds
        await prisma.generationHistory.create({
            data: {
                userId,
                surah: parseInt(requestData.surah),
                ayahStart: parseInt(requestData.ayah_start),
                ayahEnd: parseInt(requestData.ayah_end),
                reciterId: requestData.reciter_id,
                translationId: requestData.translation_id,
                resolution: parseInt(requestData.resolution) || 720,
                platform: requestData.platform || 'reel',
                status,
                duration: status === 'completed' ? duration : null,
            },
        });
        console.log(`[Worker] Generation history saved for user ${userId} (status: ${status})`);
    } catch (error) {
        console.error('[Worker] Failed to save generation history:', error.message);
        // Don't throw — history save failure shouldn't break the job
    }
};

/**
 * BullMQ Worker for video generation jobs
 * Processes one job at a time (concurrency: 1) since FFmpeg is CPU-heavy
 */
const worker = new Worker(
    VIDEO_QUEUE_NAME,
    async (job) => {
        const { requestData, requestId, clientIp, userId, subscription, language } = job.data;
        const startTime = Date.now();
        console.log(`[Worker] Processing job ${job.id} (requestId: ${requestId})`);
        console.log(`[Worker] Request Data:`, JSON.stringify(requestData, null, 2));
        console.log(`[Worker] Push subscription status: ${subscription ? 'Present' : 'Missing'}`);

        // Check if this job was cancelled while waiting in queue
        if (await isCancelled(requestId)) {
            console.log(`[Worker] Job ${requestId} was cancelled before processing started. Skipping.`);
            if (clientIp) await clearActiveJob(clientIp);
            await saveGenerationHistory(requestData, userId, 'cancelled', startTime);
            return { status: 'cancelled' };
        }

        // Create an AbortController for this job
        const controller = new AbortController();
        activeControllers.set(requestId, controller);

        const updateProgress = async (percentage, status) => {
            // Don't update progress if the job has been cancelled
            if (controller.signal.aborted) return;
            await setProgress(requestId, { status, percentage });
            // Also update BullMQ's built-in progress tracking
            await job.updateProgress(percentage);
        };

        try {
            await updateProgress(5, 'status_starting');

            const result = await coreGenerationLogic(requestData, requestId, updateProgress, controller.signal, subscription, language);

            // After generation completes, double-check cancellation before storing result
            if (controller.signal.aborted || await isCancelled(requestId)) {
                console.log(`[Worker] Job ${requestId} was cancelled during processing. Discarding result.`);
                // Clean up the output file
                if (result && result.path && fs.existsSync(result.path)) {
                    try {
                        fs.unlinkSync(result.path);
                        console.log(`[Worker] Deleted cancelled output file: ${result.path}`);
                    } catch (e) {
                        console.error(`[Worker] Failed to delete cancelled output:`, e.message);
                    }
                }
                if (clientIp) await clearActiveJob(clientIp);
                activeControllers.delete(requestId);
                await saveGenerationHistory(requestData, userId, 'cancelled', startTime);
                return { status: 'cancelled' };
            }

            // Store the result path for the download endpoint
            await setJobResult(requestId, result.path);
            await updateProgress(100, 'status_completed');

            // Release the IP concurrency lock
            if (clientIp) {
                await clearActiveJob(clientIp);
                console.log(`[Worker] Released concurrency lock for IP: ${clientIp}`);
            }

            activeControllers.delete(requestId);
            console.log(`[Worker] Job ${job.id} completed. Output: ${result.path}`);

            // Save successful generation to history
            await saveGenerationHistory(requestData, userId, 'completed', startTime);

            return { path: result.path, status: 'completed' };
        } catch (error) {
            activeControllers.delete(requestId);

            // If this was a cancellation, handle it gracefully
            if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
                console.log(`[Worker] Job ${requestId} was aborted.`);
                // Clean up any partial output
                const outputPath = path.join(process.cwd(), 'outputs', `video_${requestId}.mp4`);
                if (fs.existsSync(outputPath)) {
                    try {
                        fs.unlinkSync(outputPath);
                        console.log(`[Worker] Deleted partial output: ${outputPath}`);
                    } catch (e) {
                        console.error(`[Worker] Failed to delete partial output:`, e.message);
                    }
                }
                if (clientIp) {
                    await clearActiveJob(clientIp);
                    console.log(`[Worker] Released concurrency lock for IP (cancelled): ${clientIp}`);
                }
                await saveGenerationHistory(requestData, userId, 'cancelled', startTime);
                // Return gracefully instead of throwing so BullMQ doesn't mark as "failed"
                return { status: 'cancelled' };
            }

            console.error(`[Worker] Job ${job.id} failed:`, error.message);
            await setProgress(requestId, { error: error.message, status: 'failed' });

            // Release the IP concurrency lock even on failure
            if (clientIp) {
                await clearActiveJob(clientIp);
                console.log(`[Worker] Released concurrency lock for IP (failed): ${clientIp}`);
            }

            // Save failed generation to history
            await saveGenerationHistory(requestData, userId, 'failed', startTime);

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
