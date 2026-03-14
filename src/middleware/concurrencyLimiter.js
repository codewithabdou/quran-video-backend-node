import { getActiveJob, getProgressData, clearActiveJob } from '../config/queue.js';

// Jobs not updated for longer than this are considered stale/hung
const STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Middleware: Limits each IP to ONE concurrent video generation job.
 * If the IP already has a job that is waiting or processing, reject with 429.
 * Jobs that haven't reported progress in 5 minutes are treated as stale.
 */
export const concurrencyLimiter = async (req, res, next) => {
    try {
        const clientIp = req.ip;
        const existingJobId = await getActiveJob(clientIp);

        if (existingJobId) {
            // Double-check the job is actually still active (not a stale key)
            const progress = await getProgressData(existingJobId);
            const isTerminal = !progress
                || progress.status === 'status_completed'
                || progress.status === 'completed'
                || progress.error;

            if (!isTerminal) {
                // Check if the job is stale (no progress update for 5 minutes)
                const isStale = progress.updatedAt
                    && (Date.now() - progress.updatedAt) > STALE_JOB_THRESHOLD_MS;

                if (!isStale) {
                    return res.status(429).json({
                        error: {
                            message: 'errorTooManyRequests',
                            existingJobId,
                            retryAfter: 'After current job completes',
                        },
                    });
                }

                console.log(`[ConcurrencyLimiter] Job ${existingJobId} for IP ${clientIp} is stale (no update for 5+ min). Allowing new request.`);
            }

            // Terminal or stale — clear the lock proactively
            await clearActiveJob(clientIp);
        }

        next();
    } catch (err) {
        console.error('[ConcurrencyLimiter] Error checking active job:', err.message);
        // On Redis errors, allow the request through (fail-open) to avoid blocking users
        next();
    }
};
