import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import prisma from './database.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Configure Google OAuth 2.0 strategy for Passport.js
 * - On successful auth, find or create the user in DB
 * - First user ever → auto-promote to ADMIN
 */
const configurePassport = () => {
    passport.use(
        new GoogleStrategy(
            {
                clientID: process.env.GOOGLE_CLIENT_ID,
                clientSecret: process.env.GOOGLE_CLIENT_SECRET,
                callbackURL: '/api/v1/auth/google/callback',
                scope: ['profile', 'email'],
            },
            async (accessToken, refreshToken, profile, done) => {
                try {
                    const email = profile.emails?.[0]?.value;
                    const avatar = profile.photos?.[0]?.value;

                    if (!email) {
                        return done(new Error('No email found in Google profile'), null);
                    }

                    // Specific admin emails that are always promoted
                    const SUPER_ADMIN_EMAIL = 'kk_habouche@esi.dz';
                    const isSuperAdmin = email === SUPER_ADMIN_EMAIL;

                    // Find or create user
                    let user = await prisma.user.findUnique({
                        where: { googleId: profile.id },
                    });

                    if (user) {
                        // Update name/avatar on each login, and ensure super admin keeps role
                        user = await prisma.user.update({
                            where: { id: user.id },
                            data: {
                                name: profile.displayName,
                                avatar: avatar || user.avatar,
                                ...(isSuperAdmin ? { role: 'ADMIN' } : {}),
                            },
                        });
                    } else {
                        user = await prisma.user.create({
                            data: {
                                googleId: profile.id,
                                email,
                                name: profile.displayName,
                                avatar,
                                role: isSuperAdmin ? 'ADMIN' : 'USER',
                            },
                        });
                        console.log(`[Auth] New user created: ${user.email}${ isSuperAdmin ? ' (AUTO-ADMIN)' : ''}`);
                    }

                    return done(null, user);
                } catch (error) {
                    console.error('[Auth] Google strategy error:', error);
                    return done(error, null);
                }
            }
        )
    );

    // Serialize/deserialize for session (minimal — we primarily use JWT)
    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser(async (id, done) => {
        try {
            const user = await prisma.user.findUnique({ where: { id } });
            done(null, user);
        } catch (err) {
            done(err, null);
        }
    });
};

export default configurePassport;
