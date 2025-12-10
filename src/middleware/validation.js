import { body, param, validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors.js';

/**
 * Validation middleware wrapper
 * Checks validation results and throws ValidationError if invalid
 */
export const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorDetails = errors.array().map(err => ({
            field: err.path,
            message: err.msg,
            value: err.value,
        }));

        throw new ValidationError('Validation failed', errorDetails);
    }
    next();
};

/**
 * Video generation request validation
 */
export const validateVideoRequest = [
    body('surah')
        .isInt({ min: 1, max: 114 })
        .withMessage('Surah must be between 1 and 114'),

    body('ayah_start')
        .isInt({ min: 1 })
        .withMessage('Start Ayah must be at least 1'),

    body('ayah_end')
        .isInt({ min: 1 })
        .withMessage('End Ayah must be at least 1')
        .custom((value, { req }) => {
            if (value < req.body.ayah_start) {
                throw new Error('End Ayah must be greater than or equal to Start Ayah');
            }
            return true;
        }),

    body('reciter_id')
        .isString()
        .trim()
        .notEmpty()
        .withMessage('Reciter ID is required'),

    body('translation_id')
        .optional()
        .isString()
        .trim(),

    body('platform')
        .optional()
        .isIn(['reel', 'youtube'])
        .withMessage('Platform must be either "reel" or "youtube"'),

    body('resolution')
        .optional()
        .isInt({ min: 360, max: 1080 })
        .withMessage('Resolution must be between 360 and 1080'),

    body('background_url')
        .optional()
        .custom((value) => {
            // Allow "default" as a special value for fallback video
            if (value === 'default') {
                return true;
            }
            // Otherwise must be a valid URL
            const urlPattern = /^https?:\/\/.+/;
            if (!urlPattern.test(value)) {
                throw new Error('Background URL must be a valid URL or "default"');
            }
            return true;
        })
        .withMessage('Background URL must be a valid URL or "default"'),

    validate,
];

/**
 * Request ID validation (for progress/subscription endpoints)
 */
export const validateRequestId = [
    param('requestId')
        .isUUID()
        .withMessage('Request ID must be a valid UUID'),

    validate,
];

/**
 * Subscription validation
 */
export const validateSubscription = [
    body('requestId')
        .isUUID()
        .withMessage('Request ID must be a valid UUID'),

    body('subscription')
        .isObject()
        .withMessage('Subscription must be an object'),

    body('subscription.endpoint')
        .isURL()
        .withMessage('Subscription endpoint must be a valid URL'),

    body('subscription.keys')
        .isObject()
        .withMessage('Subscription keys must be an object'),

    body('subscription.keys.p256dh')
        .isString()
        .notEmpty()
        .withMessage('p256dh key is required'),

    body('subscription.keys.auth')
        .isString()
        .notEmpty()
        .withMessage('auth key is required'),

    validate,
];
