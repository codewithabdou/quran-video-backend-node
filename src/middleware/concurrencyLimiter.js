import { getActiveJob, getProgressData } from '../config/queue.js';

/**
 * Middleware: Limits each IP to ONE concurrent video generation job.
 * If the IP already has a job that is waiting or processing, reject with 429.
 */
export const concurrencyLimiter = async (req, res, next) => {
    try {
        const clientIp = req.ip;
        const existingJobId = await getActiveJob(clientIp);

        if (existingJobId) {
            // Double-check the job is actually still active (not a stale key)
            const progress = await getProgressData(existingJobId);
            const isStillActive = progress
                && progress.status !== 'status_completed'
                && progress.status !== 'completed'
                && !progress.error;

            if (isStillActive) {
                return res.status(429).json({
                    error: {
                        message: 'You already have a video being generated. Please wait for it to finish before starting a new one.',
                        existingJobId,
                        retryAfter: 'After current job completes',
                    },
                });
            }
            // If the key exists but the job is done/failed, it's stale — allow through
            // (clearActiveJob will clean it up, but we handle the race condition here)
        }

        next();
    } catch (err) {
        console.error('[ConcurrencyLimiter] Error checking active job:', err.message);
        // On Redis errors, allow the request through (fail-open) to avoid blocking users
        next();
    }
};
