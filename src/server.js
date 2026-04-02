import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

import passport from 'passport';
import session from 'express-session';
import apiRoutes from './routes/api.js';
import fs from 'fs';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerOptions from './config/swagger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { securityHeaders, configureCORS } from './middleware/security.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { closeConnections } from './config/queue.js';
import configurePassport from './config/passport.js';
import prisma from './config/database.js';

// Import worker (starts it as a side-effect)
import worker from './worker.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware (must be early in the chain)
app.use(securityHeaders());

// CORS with proper configuration
app.use(cors(configureCORS()));

// Body parsing
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Session (needed for Passport OAuth flow)
app.use(session({
    secret: process.env.JWT_SECRET || 'session_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' },
}));

// Passport initialization
configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Create temp directories if they don't exist
// Create and clean temp directories
const tempDir = path.join(process.cwd(), 'temp');
const outputDir = path.join(process.cwd(), 'outputs');
const uploadsDir = path.join(process.cwd(), 'uploads');

// Ensure directories exist
[tempDir, outputDir, uploadsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Clean orphaned temp files on startup
console.log('Cleaning orphaned temp files...');
try {
    const orphanedFiles = fs.readdirSync(tempDir);
    for (const file of orphanedFiles) {
        const fullPath = path.join(tempDir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(fullPath);
        }
    }
    console.log(`Cleaned ${orphanedFiles.length} items from temp directory.`);
} catch (e) {
    console.error('Error during startup temp cleanup:', e.message);
}

// Background cleanup for outputs (Retention: 3 hours)
const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
setInterval(() => {
    console.log('[Cleanup] Running periodic output cleanup...');
    try {
        const files = fs.readdirSync(outputDir);
        let cleanedCount = 0;
        const now = Date.now();

        for (const file of files) {
            if (!file.endsWith('.mp4')) continue;
            const filePath = path.join(outputDir, file);
            const stats = fs.statSync(filePath);
            const age = now - stats.mtimeMs;

            if (age > THREE_HOURS_MS) {
                fs.unlinkSync(filePath);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            console.log(`[Cleanup] Successfully removed ${cleanedCount} expired videos.`);
        }
    } catch (error) {
        console.error('[Cleanup] Error during periodic cleanup:', error.message);
    }
}, 15 * 60 * 1000); // Run every 15 minutes

// Apply rate limiting to all API routes
app.use('/api/v1', apiLimiter);
app.use('/api/v1', apiRoutes);

// Swagger docs (no rate limiting)
const specs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
console.log(`Swagger Docs available at http://localhost:${PORT}/api-docs`);

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        message: "Welcome to Quran Video Generator API (Node.js). Use POST /api/v1/generate-video",
        status: 'healthy',
        timestamp: new Date().toISOString(),
    });
});

// Error handling middleware (must be after all routes)
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Redis URL: ${process.env.REDIS_URL || 'redis://localhost:6379'}`);
    console.log(`Database: ${process.env.DATABASE_URL ? 'Connected' : 'Not configured'}`);
});

// Graceful shutdown
const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // Close the HTTP server
    server.close(() => {
        console.log('HTTP server closed');
    });

    // Close the BullMQ worker
    try {
        await worker.close();
        console.log('Worker closed');
    } catch (err) {
        console.error('Error closing worker:', err);
    }

    // Close Redis connections
    try {
        await closeConnections();
        console.log('Redis connections closed');
    } catch (err) {
        console.error('Error closing Redis:', err);
    }

    // Disconnect Prisma
    try {
        await prisma.$disconnect();
        console.log('Database connection closed');
    } catch (err) {
        console.error('Error disconnecting Prisma:', err);
    }

    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
