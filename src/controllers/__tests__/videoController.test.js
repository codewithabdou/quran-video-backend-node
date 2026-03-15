import { jest } from '@jest/globals';

// Mock dependencies using unstable_mockModule for ESM
jest.unstable_mockModule('../../services/videoService.js', () => ({
    enqueueVideoGeneration: jest.fn(),
    getProgress: jest.fn(),
    subscribeToProgress: jest.fn(),
    checkJobResult: jest.fn(),
    coreGenerationLogic: jest.fn(),
}));

jest.unstable_mockModule('../../config/queue.js', () => ({
    getActiveJob: jest.fn(),
    clearActiveJob: jest.fn(),
    deleteProgress: jest.fn(),
    videoQueue: { 
        getJob: jest.fn(),
        getJobs: jest.fn()
    },
    setCancelled: jest.fn(),
    setProgress: jest.fn(),
    setActiveJob: jest.fn(),
}));

jest.unstable_mockModule('../../worker.js', () => ({
    abortJob: jest.fn(),
    default: {},
}));

// Dynamic imports are required after unstable_mockModule
const { 
    generateVideoEndpoint, 
    downloadVideoEndpoint, 
    subscribe: subscribeEndpoint, 
    cancelVideoEndpoint,
    getAdminJobsEndpoint,
    cancelAdminJobEndpoint
} = await import('../videoController.js');
const videoService = await import('../../services/videoService.js');
const { getActiveJob, videoQueue } = await import('../../config/queue.js');

describe('Video Controller', () => {
    let req, res;

    beforeEach(() => {
        req = {
            ip: '127.0.0.1',
            body: {
                surah: 1,
                ayah_start: 1,
                ayah_end: 7,
                reciter_id: 'ar.alafasy',
                translation_id: 'en.sahih'
            },
            user: undefined
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            download: jest.fn()
        };
        jest.clearAllMocks();
    });

    describe('generateVideoEndpoint', () => {
        test('should queue generation and return 202 with jobId', async () => {
            videoService.enqueueVideoGeneration.mockResolvedValue({
                status: 'queued',
                jobId: 'test-job-id'
            });

            await generateVideoEndpoint(req, res);

            expect(videoService.enqueueVideoGeneration).toHaveBeenCalledWith(
                req.body, expect.any(String), '127.0.0.1', null, undefined
            );
            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                jobId: 'test-job-id',
                status: 'queued'
            }));
        });

        test('should return 202 if already processing', async () => {
            videoService.enqueueVideoGeneration.mockResolvedValue({
                status: 'already_processing',
                jobId: 'test-job-id'
            });

            await generateVideoEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(202);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                status: 'already_processing'
            }));
        });

        test('should return 500 on error', async () => {
            const error = new Error("Test error");
            videoService.enqueueVideoGeneration.mockRejectedValue(error);

            await generateVideoEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: "Test error" });
        });
    });

    describe('downloadVideoEndpoint', () => {
        test('should return 404 if job not found', async () => {
            req.params = { jobId: 'non-existent' };
            videoService.checkJobResult.mockResolvedValue(null);

            await downloadVideoEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('subscribe', () => {
        test('should call subscribeToProgress and return 201', async () => {
            req.body = { requestId: 'uuid', subscription: { endpoint: 'url' } };
            
            await subscribeEndpoint(req, res);

            expect(videoService.subscribeToProgress).toHaveBeenCalledWith('uuid', { endpoint: 'url' });
            expect(res.status).toHaveBeenCalledWith(201);
        });
    });

    describe('cancelVideoEndpoint', () => {
        test('should return 200 if job is cancelled', async () => {
            req.ip = '127.0.0.1';
            const { getActiveJob } = await import('../../config/queue.js');
            getActiveJob.mockResolvedValue('test-job-id');

            await cancelVideoEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith({ message: 'Active job cancelled successfully.' });
        });

        test('should return 404 if no active job', async () => {
            req.ip = '127.0.0.1';
            const { getActiveJob } = await import('../../config/queue.js');
            getActiveJob.mockResolvedValue(null);

            await cancelVideoEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('Admin Job Endpoints', () => {
        test('getAdminJobsEndpoint should return job list', async () => {
            const { videoQueue } = await import('../../config/queue.js');
            const mockJob = { 
                id: '1', 
                name: 'test', 
                data: { requestData: {} },
                timestamp: Date.now(),
                getState: jest.fn().mockResolvedValue('active')
            };
            videoQueue.getJobs.mockResolvedValue([mockJob]);

            await getAdminJobsEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1 }));
        });

        test('cancelAdminJobEndpoint should cancel specific job', async () => {
            req.params = { jobId: 'job-123' };
            const { videoQueue } = await import('../../config/queue.js');
            const mockJob = { 
                data: { clientIp: '1.1.1.1' },
                getState: jest.fn().mockResolvedValue('active'),
                remove: jest.fn().mockResolvedValue(true)
            };
            videoQueue.getJob.mockResolvedValue(mockJob);

            await cancelAdminJobEndpoint(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
        });
    });
});
