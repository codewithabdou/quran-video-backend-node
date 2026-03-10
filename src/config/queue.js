import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Shared Redis connection options
export const redisConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // Required by BullMQ
});

// Queue name constant
export const VIDEO_QUEUE_NAME = 'video-generation';

// Create the queue
export const videoQueue = new Queue(VIDEO_QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
        removeOnComplete: {
            age: 1800, // 30 minutes in seconds
        },
        removeOnFail: {
            age: 3600, // 1 hour
        },
        attempts: 1, // No automatic retries for video generation (it's expensive)
    },
});

/**
 * Store progress data in Redis for SSE polling
 */
export const setProgress = async (requestId, data) => {
    // If the job is already marked as cancelled, don't overwrite its progress status
    // unless we are explicitly setting it to cancelled. This prevents race conditions
    // where the worker tries to update progress right as the cancel endpoint executes.
    if (data.status !== 'cancelled') {
        const isAlreadyCancelled = await isCancelled(requestId);
        if (isAlreadyCancelled) return;
    }

    const client = redisConnection;
    await client.set(
        `progress:${requestId}`,
        JSON.stringify({ ...data, updatedAt: Date.now() }),
        'EX',
        3600 // 1 hour TTL
    );
};

/**
 * Get progress data from Redis
 */
export const getProgressData = async (requestId) => {
    const client = redisConnection;
    const data = await client.get(`progress:${requestId}`);
    return data ? JSON.parse(data) : null;
};

/**
 * Get a job's position in the waiting queue
 * Returns 0 if it's currently processing or next in line
 */
export const getQueuePosition = async (jobId) => {
    try {
        const job = await videoQueue.getJob(jobId);
        if (!job) return 0;

        const state = await job.getState();
        if (state === 'waiting') {
            // Waiting jobs count includes delayed jobs sometimes depending on configuration, 
            // but we'll get index of the specific job to be exact.
            // BullMQ's getJobs array does NOT guarantee FIFO order. We must sort by timestamp.
            const waitingJobs = await videoQueue.getJobs(['waiting']);
            waitingJobs.sort((a, b) => a.timestamp - b.timestamp);

            const index = waitingJobs.findIndex(j => j.id === jobId);
            return index >= 0 ? index + 1 : 0; // +1 because index 0 means position 1
        }
        return 0; // It's either active, completed, or failed
    } catch (err) {
        console.error('Error getting queue position:', err);
        return 0;
    }
};

/**
 * Delete progress data from Redis
 */
export const deleteProgress = async (requestId) => {
    const client = redisConnection;
    await client.del(`progress:${requestId}`);
};

/**
 * Store the output path for a completed job
 */
export const setJobResult = async (requestId, outputPath) => {
    const client = redisConnection;
    await client.set(
        `result:${requestId}`,
        JSON.stringify({ path: outputPath, completedAt: Date.now() }),
        'EX',
        1800 // 30 minutes TTL
    );
};

/**
 * Get the output path for a completed job
 */
export const getJobResult = async (requestId) => {
    const client = redisConnection;
    const data = await client.get(`result:${requestId}`);
    return data ? JSON.parse(data) : null;
};

/**
 * Store active job for a given IP (concurrency limiter)
 * Only one active job per IP is allowed at a time.
 */
export const setActiveJob = async (ip, jobId) => {
    const client = redisConnection;
    await client.set(
        `active-job:${ip}`,
        jobId,
        'EX',
        900 // 15 minutes TTL (safety net — cleared on job completion/failure)
    );
};

/**
 * Get the active job for a given IP
 * Returns the jobId string or null
 */
export const getActiveJob = async (ip) => {
    const client = redisConnection;
    return await client.get(`active-job:${ip}`);
};

/**
 * Clear the active job for a given IP (called when job completes or fails)
 */
export const clearActiveJob = async (ip) => {
    const client = redisConnection;
    await client.del(`active-job:${ip}`);
};

/**
 * Mark a job as cancelled in Redis
 */
export const setCancelled = async (requestId) => {
    const client = redisConnection;
    await client.set(
        `cancelled:${requestId}`,
        '1',
        'EX',
        900 // 15 minutes TTL
    );
};

/**
 * Check if a job has been cancelled
 */
export const isCancelled = async (requestId) => {
    const client = redisConnection;
    const val = await client.get(`cancelled:${requestId}`);
    return val === '1';
};

/**
 * Gracefully close connections
 */
export const closeConnections = async () => {
    await videoQueue.close();
    await redisConnection.quit();
};
