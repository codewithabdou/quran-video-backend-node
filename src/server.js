import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import fs from 'fs';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerOptions from './config/swagger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { securityHeaders, configureCORS } from './middleware/security.js';
import { apiLimiter } from './middleware/rateLimiter.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security middleware (must be early in the chain)
app.use(securityHeaders());

// CORS with proper configuration
app.use(cors(configureCORS()));

// Body parsing
app.use(express.json({ limit: '10mb' })); // Limit payload size
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Create temp directories if they don't exist
const tempDir = path.join(process.cwd(), 'temp');
const outputDir = path.join(process.cwd(), 'outputs');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

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

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
