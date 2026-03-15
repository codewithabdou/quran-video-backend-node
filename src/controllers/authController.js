import passport from 'passport';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Generate JWT token for a user
 */
const generateToken = (user) => {
    return jwt.sign(
        {
            userId: user.id,
            email: user.email,
            role: user.role,
        },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
};

/**
 * GET /auth/google
 * Initiates Google OAuth flow — redirects to Google
 */
export const googleLogin = passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
});

/**
 * GET /auth/google/callback
 * Handles Google OAuth callback — creates JWT and redirects to frontend
 */
export const googleCallback = (req, res, next) => {
    passport.authenticate('google', { session: false }, (err, user) => {
        if (err || !user) {
            console.error('[Auth] Google callback error:', err);
            return res.redirect(`${FRONTEND_URL}/auth/callback?error=auth_failed`);
        }

        const token = generateToken(user);
        
        // Redirect to frontend with token in URL params
        const redirectUrl = `${FRONTEND_URL}/auth/callback?token=${token}`;
        res.redirect(redirectUrl);
    })(req, res, next);
};

/**
 * GET /auth/me
 * Returns the currently authenticated user's info
 */
export const getCurrentUser = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
                role: true,
                createdAt: true,
                _count: {
                    select: { generations: true },
                },
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        res.json({
            user: {
                ...user,
                totalGenerations: user._count.generations,
            },
        });
    } catch (error) {
        console.error('[Auth] Get current user error:', error);
        res.status(500).json({ error: 'Failed to fetch user data.' });
    }
};
