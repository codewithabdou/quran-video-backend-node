import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter
 * Limits: 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: {
            message: 'Too many requests from this IP, please try again later.',
            retryAfter: '15 minutes',
        },
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    // Skip rate limiting for certain IPs (optional)
    skip: (req) => {
        const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
        return trustedIPs.includes(req.ip);
    },
});

/**
 * Strict rate limiter for video generation endpoint
 * Limits: 5 requests per hour per IP
 */
export const videoGenerationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 video generations per hour
    message: {
        error: {
            message: 'Too many video generation requests. Please try again later.',
            retryAfter: '1 hour',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const trustedIPs = process.env.TRUSTED_IPS?.split(',') || [];
        return trustedIPs.includes(req.ip);
    },
});

/**
 * Auth rate limiter (for future authentication endpoints)
 * Limits: 5 failed attempts per 15 minutes
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts
    message: {
        error: {
            message: 'Too many authentication attempts, please try again later.',
            retryAfter: '15 minutes',
        },
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
});
