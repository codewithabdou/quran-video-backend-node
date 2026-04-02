import prisma from '../config/database.js';
import fs from 'fs';
import path from 'path';

/**
 * GET /history
 * Returns paginated list of the authenticated user's generation history
 */
export const getUserHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
        const skip = (page - 1) * limit;

        const [generations, total] = await Promise.all([
            prisma.generationHistory.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.generationHistory.count({ where: { userId } }),
        ]);

        // Enrich with availability and expiry info
        const enrichedGenerations = generations.map(gen => {
            const fileName = `video_${gen.id}.mp4`;
            const outputPath = path.resolve(process.cwd(), 'outputs', fileName);
            const exists = fs.existsSync(outputPath);
            
            // Calculate expiry (3 hours after creation)
            const createdTime = new Date(gen.createdAt).getTime();
            const now = Date.now();
            const threeHours = 3 * 60 * 60 * 1000;
            const buffer = 1 * 60 * 1000; // 1-minute grace period for clock drift
            
            const expiresAt = createdTime + threeHours;
            const isExpired = now > (expiresAt + buffer);

            // Logging for total visibility!
            console.log(`[History Check] ID: ${gen.id.substring(0, 8)} | Discovered on VPS: ${exists} | Expired: ${isExpired} | Now: ${new Date(now).toISOString()} | Created: ${new Date(createdTime).toISOString()}`);

            return {
                ...gen,
                isAvailable: exists && !isExpired,
                expiresAt: new Date(expiresAt).toISOString(),
                isExpired: isExpired || !exists
            };
        });

        res.json({
            generations: enrichedGenerations,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('[History] Error fetching history:', error);
        res.status(500).json({ error: 'Failed to fetch generation history.' });
    }
};
