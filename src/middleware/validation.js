import { body, param, query, validationResult } from 'express-validator';
import { ValidationError } from '../utils/errors.js';
import quranRepository from '../services/quranRepository.js';

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
            const surah = req.body.surah;
            const start = req.body.ayah_start;
            const end = value;
            if (surah && start) {
                const rangeVal = quranRepository.validateRange(surah, start, end);
                if (!rangeVal.valid) {
                    throw new Error(rangeVal.error);
                }
            } else if (value < req.body.ayah_start) {
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
        .trim()
        .custom((value) => {
            if (value && value !== 'en.sahih') {
                throw new Error('Only "en.sahih" translation edition is currently supported.');
            }
            return true;
        }),

    body('text_mode')
        .optional()
        .isIn(['bilingual', 'arabic_only'])
        .withMessage('Text mode must be either "bilingual" or "arabic_only"'),

    body('plan_hash')
        .optional()
        .isString()
        .trim(),

    body('timing_overrides')
        .optional()
        .isObject()
        .withMessage('timing_overrides must be an object'),

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
            // Allow absolute local paths for uploaded files (Linux/Docker starts with '/' and Windows starts with drive letter)
            if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
                return true;
            }
            // Otherwise must be a valid URL
            const urlPattern = /^https?:\/\/.+/;
            if (!urlPattern.test(value)) {
                throw new Error('Background URL must be a valid HTTP URL, a local file path, or "default"');
            }
            return true;
        })
        .withMessage('Background URL must be a valid HTTP URL, a local file path, or "default"'),

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

/**
 * Verse search query validation
 */
export const validateSearchQuery = [
    query('q')
        .isString()
        .trim()
        .notEmpty()
        .withMessage('Search query "q" is required and cannot be empty'),

    query('surah')
        .optional()
        .isInt({ min: 1, max: 114 })
        .withMessage('Surah must be between 1 and 114'),

    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),

    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage('Limit must be between 1 and 50'),

    validate,
];

/**
 * Verse range review query validation
 */
export const validateVersesQuery = [
    query('surah')
        .isInt({ min: 1, max: 114 })
        .withMessage('Surah must be between 1 and 114'),

    query('start')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Start Ayah must be at least 1'),

    query('end')
        .optional()
        .isInt({ min: 1 })
        .withMessage('End Ayah must be at least 1')
        .custom((value, { req }) => {
            const surah = req.query.surah;
            const start = req.query.start || 1;
            const end = value || start;
            const rangeVal = quranRepository.validateRange(surah, start, end);
            if (!rangeVal.valid) {
                throw new Error(rangeVal.error);
            }
            return true;
        }),

    validate,
];

/**
 * Render plan request validation
 */
export const validatePlanRequest = [
    body('surah')
        .isInt({ min: 1, max: 114 })
        .withMessage('Surah must be between 1 and 114'),

    body('ayah_start')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Start Ayah must be at least 1'),

    body('ayahStart')
        .optional()
        .isInt({ min: 1 }),

    body('ayah_end')
        .optional()
        .isInt({ min: 1 })
        .withMessage('End Ayah must be at least 1'),

    body('ayahEnd')
        .optional()
        .isInt({ min: 1 }),

    body().custom((body) => {
        const surah = body.surah;
        const start = body.ayah_start || body.ayahStart || 1;
        const end = body.ayah_end || body.ayahEnd || start;
        const rangeVal = quranRepository.validateRange(surah, start, end);
        if (!rangeVal.valid) {
            throw new Error(rangeVal.error);
        }
        return true;
    }),

    body('platform')
        .optional()
        .isIn(['reel', 'youtube'])
        .withMessage('Platform must be either "reel" or "youtube"'),

    body('resolution')
        .optional()
        .isInt({ min: 360, max: 1080 })
        .withMessage('Resolution must be between 360 and 1080'),

    body('text_mode')
        .optional()
        .isIn(['bilingual', 'arabic_only'])
        .withMessage('Text mode must be either "bilingual" or "arabic_only"'),

    body('textMode')
        .optional()
        .isIn(['bilingual', 'arabic_only']),

    validate,
];
