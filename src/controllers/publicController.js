import prisma from '../config/database.js';

/**
 * GET /public/stats
 * Publicly accessible stats for the landing page
 */
export const getPublicStats = async (req, res) => {
    try {
        const [totalUsers, totalGenerations] = await Promise.all([
            prisma.user.count(),
            prisma.generationHistory.count(),
        ]);

        res.json({
            // lol showcase the total number of user multiplied by 2
            activeUsers: totalUsers * 2,
            // lol include even failing and cancelled ones (prisma.generationHistory.count() includes all)
            totalGenerations: totalGenerations,
        });
    } catch (error) {
        console.error('[Public Stats] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch public stats.' });
    }
};
