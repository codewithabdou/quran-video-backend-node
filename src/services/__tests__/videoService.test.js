import { jest } from '@jest/globals';

// Mock dependencies
jest.unstable_mockModule('web-push', () => ({
    default: {
        setVapidDetails: jest.fn(),
        sendNotification: jest.fn().mockResolvedValue({ statusCode: 201 }),
    },
}));

jest.unstable_mockModule('../../config/queue.js', () => ({
    videoQueue: { add: jest.fn() },
    getProgressData: jest.fn(),
    setProgress: jest.fn(),
    deleteProgress: jest.fn(),
    getJobResult: jest.fn(),
    getQueuePosition: jest.fn(),
    setActiveJob: jest.fn(),
    getActiveJob: jest.fn(),
    checkUserRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
    incrementUserGenerationCount: jest.fn(),
}));

// Set environment variables before importing service to ensure vapidConfigured is true
process.env.VAPID_PUBLIC_KEY = 'test_public_key';
process.env.VAPID_PRIVATE_KEY = 'test_private_key';

// Import after mocking
const { sendCompletionNotification } = await import('../videoService.js');
const webPush = (await import('web-push')).default;

describe('Video Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('sendCompletionNotification', () => {
        const requestId = 'job-123';
        const subscription = {
            endpoint: 'https://fcm.googleapis.com/fcm/send/test',
            keys: { p256dh: 'key1', auth: 'auth1' }
        };

        it('should send notification if subscription is valid', async () => {
            await sendCompletionNotification(requestId, subscription);
            expect(webPush.sendNotification).toHaveBeenCalled();
        });

        it('should skip if no subscription provided', async () => {
            await sendCompletionNotification(requestId, null);
            expect(webPush.sendNotification).not.toHaveBeenCalled();
        });
    });
});
