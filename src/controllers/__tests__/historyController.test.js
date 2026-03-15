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

// Import controller after mocking
const { getUserHistory } = await import('../historyController.js');
const prisma = (await import('../../config/database.js')).default;

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
            const mockGenerations = [
                { id: 'gen-1', surah: 1, status: 'completed' },
                { id: 'gen-2', surah: 2, status: 'failed' },
            ];
            prisma.generationHistory.findMany.mockResolvedValue(mockGenerations);
            prisma.generationHistory.count.mockResolvedValue(2);

            await getUserHistory(req, res);

            expect(res.json).toHaveBeenCalledWith({
                generations: mockGenerations,
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
