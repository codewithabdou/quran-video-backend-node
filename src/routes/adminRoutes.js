import express from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { getAdminJobsEndpoint, cancelAdminJobEndpoint } from '../controllers/videoController.js';
import { getUsers, updateUserRole, getStats, deleteUser } from '../controllers/adminController.js';

const router = express.Router();

// All admin routes require ADMIN role
router.use(requireAdmin);

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get system statistics (Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System statistics
 *       403:
 *         description: Admin access required
 */
router.get('/admin/stats', getStats);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List all users (Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated user list
 *       403:
 *         description: Admin access required
 */
router.get('/admin/users', getUsers);

/**
 * @swagger
 * /admin/users/{id}/role:
 *   patch:
 *     summary: Change user role (Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [USER, ADMIN]
 *     responses:
 *       200:
 *         description: Role updated
 *       403:
 *         description: Admin access required
 */
router.patch('/admin/users/:id/role', updateUserRole);

/**
 * @swagger
 * /admin/users/{id}:
 *   delete:
 *     summary: Delete a user (Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted
 *       403:
 *         description: Admin access required
 */
router.delete('/admin/users/:id', deleteUser);

/**
 * @swagger
 * /admin/jobs:
 *   get:
 *     summary: Get all jobs in queue (Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of jobs
 *       403:
 *         description: Admin access required
 */
router.get('/admin/jobs', getAdminJobsEndpoint);

/**
 * @swagger
 * /admin/jobs/{jobId}:
 *   delete:
 *     summary: Cancel a job by ID (Admin)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job cancelled
 *       403:
 *         description: Admin access required
 */
router.delete('/admin/jobs/:jobId', cancelAdminJobEndpoint);

export default router;
