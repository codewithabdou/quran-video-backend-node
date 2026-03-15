import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

/**
 * Middleware: Verify JWT token from Authorization header
 * Attaches req.user with full user object from DB
 */
export const requireAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Authentication required. Please sign in with Google.',
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Fetch fresh user data from DB
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
        });

        if (!user) {
            return res.status(401).json({
                error: 'User not found. Please sign in again.',
            });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired. Please sign in again.' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token.' });
        }
        console.error('[Auth Middleware] Error:', error);
        return res.status(500).json({ error: 'Authentication error.' });
    }
};

/**
 * Middleware: Require ADMIN role
 * Must be used after requireAuth
 */
export const requireAdmin = async (req, res, next) => {
    // First run requireAuth
    await requireAuth(req, res, () => {
        if (!req.user || req.user.role !== 'ADMIN') {
            return res.status(403).json({
                error: 'Access denied. Admin privileges required.',
            });
        }
        next();
    });
};

/**
 * Optional auth middleware — attaches user if token is present, but doesn't block
 * Useful for endpoints that work for both authenticated and anonymous users
 */
export const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await prisma.user.findUnique({
                where: { id: decoded.userId },
            });
            if (user) {
                req.user = user;
            }
        }
    } catch (err) {
        // Silently ignore — user stays anonymous
    }
    next();
};
