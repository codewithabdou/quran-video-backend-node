import { jest } from '@jest/globals';

// Mock dependencies using unstable_mockModule for ESM
jest.unstable_mockModule('../../services/videoService.js', () => ({
    enqueueVideoGeneration: jest.fn(),
    getProgress: jest.fn(),
    subscribeToProgress: jest.fn(),
    checkJobResult: jest.fn()
}));

// Dynamic imports are required after unstable_mockModule
const { generateVideoEndpoint, downloadVideoEndpoint } = await import('../videoController.js');
const videoService = await import('../../services/videoService.js');

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
            }
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

            expect(videoService.enqueueVideoGeneration).toHaveBeenCalledWith(req.body, expect.any(String), '127.0.0.1');
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
});
