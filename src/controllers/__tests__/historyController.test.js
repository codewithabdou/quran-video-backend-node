import { jest } from '@jest/globals';

// Mock database
jest.unstable_mockModule('../../config/database.js', () => ({
    default: {
        generationHistory: {
            findMany: jest.fn(),
            count: jest.fn(),
        },
    },
}));

// Mock filesystem
jest.unstable_mockModule('fs', () => ({
    default: {
        existsSync: jest.fn(() => true),
    },
}));

// Import controller after mocking
const { getUserHistory } = await import('../historyController.js');
const prisma = (await import('../../config/database.js')).default;
const fs = (await import('fs')).default;

describe('History Controller', () => {
    let req, res;

    beforeEach(() => {
        req = {
            user: { id: 'user-123' },
            query: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        jest.clearAllMocks();
    });

    describe('getUserHistory', () => {
        it('should return paginated history', async () => {
            const now = 1712066400000; // Fixed timestamp for testing
            jest.spyOn(Date, 'now').mockReturnValue(now);
            
            const createdAt = new Date(now - 3600000).toISOString(); // 1 hour ago
            const mockGenerations = [
                { id: 'gen-1', surah: 1, status: 'completed', createdAt },
                { id: 'gen-2', surah: 2, status: 'failed', createdAt },
            ];
            prisma.generationHistory.findMany.mockResolvedValue(mockGenerations);
            prisma.generationHistory.count.mockResolvedValue(2);
            fs.existsSync.mockReturnValue(true);

            await getUserHistory(req, res);

            const expectedEnriched = mockGenerations.map(gen => ({
                ...gen,
                isAvailable: true,
                expiresAt: new Date(new Date(gen.createdAt).getTime() + 10800000).toISOString(),
                isExpired: false
            }));

            expect(res.json).toHaveBeenCalledWith({
                generations: expectedEnriched,
                pagination: {
                    page: 1,
                    limit: 10,
                    total: 2,
                    totalPages: 1,
                },
            });
            expect(prisma.generationHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { userId: 'user-123' },
                skip: 0,
                take: 10,
            }));
        });

        it('should respect custom pagination params', async () => {
            req.query = { page: '2', limit: '5' };
            prisma.generationHistory.findMany.mockResolvedValue([]);
            prisma.generationHistory.count.mockResolvedValue(10);

            await getUserHistory(req, res);

            expect(prisma.generationHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
                skip: 5,
                take: 5,
            }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pagination: expect.objectContaining({
                    page: 2,
                    limit: 5,
                }),
            }));
        });

        it('should return 500 on database error', async () => {
            prisma.generationHistory.findMany.mockRejectedValue(new Error('DB Error'));

            await getUserHistory(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch generation history.' });
        });
    });
});
