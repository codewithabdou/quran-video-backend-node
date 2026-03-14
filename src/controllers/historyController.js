import prisma from '../config/database.js';

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

        res.json({
            generations,
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
