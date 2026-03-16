import prisma from '../config/database.js';
import { videoQueue } from '../config/queue.js';

/**
 * GET /admin/users
 * List all users (paginated)
 */
export const getUsers = async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const where = search
            ? {
                OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            }
            : {};

        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
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
            }),
            prisma.user.count({ where }),
        ]);

        res.json({
            users: users.map(u => ({
                ...u,
                totalGenerations: u._count.generations,
            })),
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('[Admin] Error fetching users:', error);
        res.status(500).json({ error: 'Failed to fetch users.' });
    }
};

/**
 * PATCH /admin/users/:id/role
 * Change a user's role (USER ↔ ADMIN)
 */
export const updateUserRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        if (!['USER', 'ADMIN'].includes(role)) {
            return res.status(400).json({ error: 'Role must be USER or ADMIN.' });
        }

        const userToUpdate = await prisma.user.findUnique({ where: { id } });
        if (!userToUpdate) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const SUPER_ADMIN_EMAIL = 'kk_habouche@esi.dz';

        // Prevent demoting the super admin or self
        if (role !== 'ADMIN') {
            if (userToUpdate.email === SUPER_ADMIN_EMAIL) {
                return res.status(400).json({ error: 'The super admin cannot be demoted.' });
            }
            if (id === req.user.id) {
                return res.status(400).json({ error: 'You cannot demote yourself.' });
            }
        }

        const user = await prisma.user.update({
            where: { id },
            data: { role },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
            },
        });

        console.log(`[Admin] User ${user.email} role changed to ${role} by ${req.user.email}`);
        res.json({ message: `User role updated to ${role}.`, user });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'User not found.' });
        }
        console.error('[Admin] Error updating user role:', error);
        res.status(500).json({ error: 'Failed to update user role.' });
    }
};

/**
 * GET /admin/stats
 * System overview stats
 */
export const getStats = async (req, res) => {
    try {
        const [totalUsers, totalGenerations, recentGenerations] = await Promise.all([
            prisma.user.count(),
            prisma.generationHistory.count(),
            prisma.generationHistory.count({
                where: {
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24h
                    },
                },
            }),
        ]);

        // Get queue stats from BullMQ
        const [activeCount, waitingCount, completedCount, failedCount] = await Promise.all([
            videoQueue.getActiveCount(),
            videoQueue.getWaitingCount(),
            videoQueue.getCompletedCount(),
            videoQueue.getFailedCount(),
        ]);

        res.json({
            users: {
                total: totalUsers,
            },
            generations: {
                total: totalGenerations,
                last24h: recentGenerations,
            },
            queue: {
                active: activeCount,
                waiting: waitingCount,
                completed: completedCount,
                failed: failedCount,
            },
        });
    } catch (error) {
        console.error('[Admin] Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats.' });
    }
};

/**
 * DELETE /admin/users/:id
 * Delete a user and all their history
 */
export const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        const userToDelete = await prisma.user.findUnique({ where: { id } });
        if (!userToDelete) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const SUPER_ADMIN_EMAIL = 'kk_habouche@esi.dz';

        // Prevent deleting the super admin or self
        if (userToDelete.email === SUPER_ADMIN_EMAIL) {
            return res.status(400).json({ error: 'The super admin cannot be deleted.' });
        }
        if (id === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete yourself.' });
        }

        const user = await prisma.user.delete({
            where: { id },
        });

        console.log(`[Admin] User ${user.email} deleted by ${req.user.email}`);
        res.json({ message: `User ${user.email} deleted successfully.` });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ error: 'User not found.' });
        }
        console.error('[Admin] Error deleting user:', error);
        res.status(500).json({ error: 'Failed to delete user.' });
    }
};
