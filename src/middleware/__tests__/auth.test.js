import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// Mock database
jest.unstable_mockModule('../../config/database.js', () => ({
    default: {
        user: {
            findUnique: jest.fn(),
        },
    },
}));

// Import middleware after mocking
const { requireAuth, requireAdmin, optionalAuth } = await import('../auth.js');
const prisma = (await import('../../config/database.js')).default;

describe('Auth Middleware', () => {
    let req, res, next;
    const JWT_SECRET = 'fallback_secret_change_me';

    beforeEach(() => {
        req = {
            headers: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
        jest.clearAllMocks();
    });

    describe('requireAuth', () => {
        it('should return 401 if no authorization header', async () => {
            await requireAuth(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Authentication required. Please sign in with Google.',
            });
        });

        it('should return 401 if invalid token format', async () => {
            req.headers.authorization = 'InvalidToken';
            await requireAuth(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
        });

        it('should return 401 if token is expired', async () => {
            req.headers.authorization = 'Bearer expired-token';
            jest.spyOn(jwt, 'verify').mockImplementation(() => {
                const err = new Error('jwt expired');
                err.name = 'TokenExpiredError';
                throw err;
            });

            await requireAuth(req, res, next);
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Token expired. Please sign in again.' });
        });

        it('should attach user to req if token is valid and user exists', async () => {
            const mockUser = { id: 'user-123', email: 'test@example.com' };
            req.headers.authorization = 'Bearer valid-token';
            jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 'user-123' });
            prisma.user.findUnique.mockResolvedValue(mockUser);

            await requireAuth(req, res, next);

            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        it('should return 401 if user does not exist in DB', async () => {
            req.headers.authorization = 'Bearer valid-token';
            jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 'user-123' });
            prisma.user.findUnique.mockResolvedValue(null);

            await requireAuth(req, res, next);

            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'User not found. Please sign in again.' });
        });
    });

    describe('requireAdmin', () => {
        it('should call next if user is ADMIN', async () => {
            const adminUser = { id: 'admin-1', role: 'ADMIN' };
            req.headers.authorization = 'Bearer admin-token';
            jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 'admin-1' });
            prisma.user.findUnique.mockResolvedValue(adminUser);

            await requireAdmin(req, res, next);

            expect(next).toHaveBeenCalled();
        });

        it('should return 403 if user is not ADMIN', async () => {
            const regularUser = { id: 'user-1', role: 'USER' };
            req.headers.authorization = 'Bearer user-token';
            jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 'user-1' });
            prisma.user.findUnique.mockResolvedValue(regularUser);

            await requireAdmin(req, res, next);

            expect(res.status).toHaveBeenCalledWith(403);
            expect(res.json).toHaveBeenCalledWith({ error: 'Access denied. Admin privileges required.' });
        });
    });

    describe('optionalAuth', () => {
        it('should attach user if valid token is provided', async () => {
            const mockUser = { id: 'user-123' };
            req.headers.authorization = 'Bearer valid-token';
            jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 'user-123' });
            prisma.user.findUnique.mockResolvedValue(mockUser);

            await optionalAuth(req, res, next);

            expect(req.user).toEqual(mockUser);
            expect(next).toHaveBeenCalled();
        });

        it('should not attach user and call next if no token', async () => {
            await optionalAuth(req, res, next);
            expect(req.user).toBeUndefined();
            expect(next).toHaveBeenCalled();
        });
    });
});
