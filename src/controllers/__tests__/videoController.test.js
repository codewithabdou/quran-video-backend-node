import { jest } from '@jest/globals';

// Mock dependencies using unstable_mockModule for ESM
jest.unstable_mockModule('../../services/videoService.js', () => ({
    generateVideo: jest.fn(),
    getProgress: jest.fn(),
    subscribeToProgress: jest.fn()
}));

// Dynamic imports are required after unstable_mockModule
const { generateVideoEndpoint } = await import('../videoController.js');
const videoService = await import('../../services/videoService.js');

describe('Video Controller', () => {
    let req, res;

    beforeEach(() => {
        req = {
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

    test('should start generation and download file on success', async () => {
        const mockPath = '/tmp/video.mp4';
        videoService.generateVideo.mockResolvedValue({ path: mockPath, status: 'completed' });

        await generateVideoEndpoint(req, res);

        expect(videoService.generateVideo).toHaveBeenCalledWith(req.body, expect.any(String));
        expect(res.download).toHaveBeenCalledWith(mockPath, expect.any(Function));
    });

    test('should return 202 if already processing', async () => {
        videoService.generateVideo.mockResolvedValue({ status: 'already_processing' });

        await generateVideoEndpoint(req, res);

        expect(res.status).toHaveBeenCalledWith(202);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "Already processing" }));
    });

    test('should return 500 on error', async () => {
        const error = new Error("Test error");
        videoService.generateVideo.mockRejectedValue(error);

        await generateVideoEndpoint(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: "Test error" });
    });
});
