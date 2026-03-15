import { jest } from '@jest/globals';

// Mock BullMQ to prevent real worker/connection initialization
jest.unstable_mockModule('bullmq', () => ({
    Worker: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn().mockResolvedValue(true),
    })),
}));

// Mock dependencies
jest.unstable_mockModule('../config/database.js', () => ({
    default: {
        generationHistory: {
            create: jest.fn(),
        },
    },
}));

jest.unstable_mockModule('../config/queue.js', () => ({
    VIDEO_QUEUE_NAME: 'video-generation',
    redisConnection: {},
    setProgress: jest.fn(),
    setJobResult: jest.fn(),
    clearActiveJob: jest.fn(),
    isCancelled: jest.fn().mockResolvedValue(false),
}));

jest.unstable_mockModule('../services/videoService.js', () => ({
    coreGenerationLogic: jest.fn().mockResolvedValue({ path: 'output.mp4', status: 'completed' }),
    sendCompletionNotification: jest.fn(),
}));

// Import after mocking
// Use dynamic import for the worker's internal logic if possible, 
// or test the processor function if we can export it.
// Since the worker is initialized on import, we test it by mocking the Worker class.
describe('Worker', () => {
    let worker;

    beforeAll(async () => {
        worker = (await import('../worker.js')).default;
    });

    afterAll(async () => {
        if (worker) {
            await worker.close();
        }
    });

    it('should exist', async () => {
        expect(worker).toBeDefined();
    });
});
