import { jest } from '@jest/globals';
import path from 'path';

// Mock Dependencies
jest.unstable_mockModule('pexels', () => ({
    createClient: jest.fn()
}));

jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn(),
        readFileSync: jest.fn(),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn()
    },
    existsSync: jest.fn(), // ESM named export mapping often tricky, mocking both default and named helps
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    mkdirSync: jest.fn()
}));

// Dynamic imports
const { createClient } = await import('pexels');
const fs = await import('fs');
const { getBackgroundVideos } = await import('../backgroundsController.js');

describe('Backgrounds Controller', () => {
    let req, res;
    const mockVideos = [{ id: 1, url: 'http://test.com/video.mp4' }];
    const CACHE_PATH = path.normalize('src/constants/pexels_videos_cache.json'); // Match partial path

    beforeEach(() => {
        req = {};
        res = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
        process.env.PEXELS_API_KEY = 'test_key';
        jest.clearAllMocks();
    });

    test('should return cached videos if cache exists', async () => {
        // Setup cache hit
        fs.default.existsSync.mockReturnValue(true);
        fs.default.readFileSync.mockReturnValue(JSON.stringify({ videos: mockVideos }));

        await getBackgroundVideos(req, res);

        expect(fs.default.readFileSync).toHaveBeenCalled();
        expect(createClient).not.toHaveBeenCalled(); // Should not hit API
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            source: 'cache',
            videos: mockVideos
        }));
    });

    test('should fetch from API if cache missing', async () => {
        // Setup cache miss then API success
        fs.default.existsSync.mockReturnValue(false); // Cache check returns false

        const mockClient = {
            videos: {
                show: jest.fn().mockResolvedValue({ id: 123, url: 'http://api.com/vid.mp4' })
            }
        };
        createClient.mockReturnValue(mockClient);

        await getBackgroundVideos(req, res);

        expect(createClient).toHaveBeenCalledWith('test_key');
        expect(mockClient.videos.show).toHaveBeenCalled();
        expect(fs.default.writeFileSync).toHaveBeenCalled(); // Should save to cache
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            source: 'api',
            count: 6 // based on VIDEO_IDS length in controller
        }));
    });

    test('should fallback to default if no API key', async () => {
        delete process.env.PEXELS_API_KEY;
        fs.default.existsSync.mockReturnValue(false);

        await getBackgroundVideos(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            videos: [],
            message: expect.stringContaining('not configured')
        }));
    });

    test('should handle API errors gracefully', async () => {
        fs.default.existsSync.mockReturnValue(false);

        const mockClient = { videos: { show: jest.fn().mockRejectedValue(new Error('API Error')) } };
        createClient.mockReturnValue(mockClient);

        await getBackgroundVideos(req, res);

        // Should return empty list source api (all failed) or fallback behavior
        // The controller logic: if validVideos is empty (all failed), it returns source 'api' with empty list
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            videos: [],
            source: 'api'
        }));
    });
});
