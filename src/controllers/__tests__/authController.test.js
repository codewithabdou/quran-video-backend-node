import { jest } from '@jest/globals';
import passport from 'passport';

// Mock database
jest.unstable_mockModule('../../config/database.js', () => ({
    default: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));

// Import controller after mocking
const { getCurrentUser, googleCallback } = await import('../authController.js');
const prisma = (await import('../../config/database.js')).default;

describe('Auth Controller', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            user: { id: 'user-123' },
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
            redirect: jest.fn(),
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('getCurrentUser', () => {
        it('should return user data if user exists', async () => {
            const mockDbUser = {
                id: 'user-123',
                email: 'test@example.com',
                name: 'Test User',
                avatar: 'avatar.jpg',
                role: 'USER',
                createdAt: new Date(),
                _count: { generations: 5 },
            };
            prisma.user.findUnique.mockResolvedValue(mockDbUser);

            await getCurrentUser(req, res);

            expect(res.json).toHaveBeenCalledWith({
                user: expect.objectContaining({
                    id: 'user-123',
                    totalGenerations: 5,
                }),
            });
        });

        it('should return 404 if user not found in DB', async () => {
            prisma.user.findUnique.mockResolvedValue(null);

            await getCurrentUser(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'User not found.' });
        });

        it('should return 500 on database error', async () => {
            prisma.user.findUnique.mockRejectedValue(new Error('DB Error'));

            await getCurrentUser(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({ error: 'Failed to fetch user data.' });
        });
    });

    describe('googleCallback', () => {
        it('should redirect to frontend with token on successful auth', () => {
            const mockUser = { id: 'user-123', email: 'test@example.com', role: 'USER' };
            
            // Mock passport.authenticate to call the callback with our mock user
            jest.spyOn(passport, 'authenticate').mockImplementation((strategy, options, callback) => {
                return (req, res, next) => {
                    callback(null, mockUser);
                };
            });

            googleCallback(req, res, next);

            expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('token='));
        });

        it('should redirect to frontend with error on failed auth', () => {
            jest.spyOn(passport, 'authenticate').mockImplementation((strategy, options, callback) => {
                return (req, res, next) => {
                    callback(new Error('Auth failed'), null);
                };
            });

            googleCallback(req, res, next);

            expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('error=auth_failed'));
        });
    });
});
