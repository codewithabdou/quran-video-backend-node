import { jest } from '@jest/globals';

// Mock database
jest.unstable_mockModule('../../config/database.js', () => ({
    default: {
        user: {
            findMany: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            findUnique: jest.fn(),
        },
        generationHistory: {
            count: jest.fn(),
        },
    },
}));

// Mock queue
jest.unstable_mockModule('../../config/queue.js', () => ({
    videoQueue: {
        getActiveCount: jest.fn(),
        getWaitingCount: jest.fn(),
        getCompletedCount: jest.fn(),
        getFailedCount: jest.fn(),
    },
}));

// Import controller after mocking
const { getUsers, updateUserRole, getStats, deleteUser } = await import('../adminController.js');
const prisma = (await import('../../config/database.js')).default;
const { videoQueue } = await import('../../config/queue.js');

describe('Admin Controller', () => {
    let req, res;

    beforeEach(() => {
        req = {
            user: { id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' },
            query: {},
            params: {},
            body: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        jest.clearAllMocks();
    });

    describe('getUsers', () => {
        it('should return paginated users', async () => {
            const mockUsers = [
                { id: 'u1', email: 'u1@ex.com', role: 'USER', _count: { generations: 1 } },
            ];
            prisma.user.findMany.mockResolvedValue(mockUsers);
            prisma.user.count.mockResolvedValue(1);

            await getUsers(req, res);

            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                users: [expect.objectContaining({ id: 'u1', totalGenerations: 1 })],
                pagination: expect.any(Object),
            }));
        });

        it('should apply search filter', async () => {
            req.query.search = 'test';
            prisma.user.findMany.mockResolvedValue([]);
            prisma.user.count.mockResolvedValue(0);

            await getUsers(req, res);

            expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: {
                    OR: expect.arrayContaining([
                        { name: { contains: 'test', mode: 'insensitive' } },
                    ]),
                },
            }));
        });
    });

    describe('updateUserRole', () => {
        it('should update user role', async () => {
            req.params.id = 'user-1';
            req.body.role = 'ADMIN';
            prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'u1@ex.com', role: 'USER' });
            prisma.user.update.mockResolvedValue({ id: 'user-1', email: 'u1@ex.com', role: 'ADMIN' });

            await updateUserRole(req, res);

            expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'user-1' },
                data: { role: 'ADMIN' },
            }));
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                message: 'User role updated to ADMIN.',
            }));
        });

        it('should prevent self-demotion', async () => {
            req.params.id = 'admin-1';
            req.body.role = 'USER';
            prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });

            await updateUserRole(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'You cannot demote yourself.' });
        });
    });

    describe('getStats', () => {
        it('should return system stats', async () => {
            prisma.user.count.mockResolvedValue(10);
            prisma.generationHistory.count.mockResolvedValue(100);
            videoQueue.getActiveCount.mockResolvedValue(1);
            videoQueue.getWaitingCount.mockResolvedValue(2);
            videoQueue.getCompletedCount.mockResolvedValue(50);
            videoQueue.getFailedCount.mockResolvedValue(5);

            await getStats(req, res);

            expect(res.json).toHaveBeenCalledWith({
                users: { total: 10 },
                generations: { total: 100, last24h: 100 },
                queue: { active: 1, waiting: 2, completed: 50, failed: 5 },
            });
        });
    });

    describe('deleteUser', () => {
        it('should delete user', async () => {
            req.params.id = 'user-1';
            prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'deleted@ex.com', role: 'USER' });
            prisma.user.delete.mockResolvedValue({ email: 'deleted@ex.com' });

            await deleteUser(req, res);

            expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
            expect(res.json).toHaveBeenCalledWith({ message: 'User deleted@ex.com deleted successfully.' });
        });

        it('should prevent self-deletion', async () => {
            req.params.id = 'admin-1';
            prisma.user.findUnique.mockResolvedValue({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });

            await deleteUser(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'You cannot delete yourself.' });
        });
    });
});
