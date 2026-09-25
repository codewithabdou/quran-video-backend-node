import express from 'express';
import { searchVersesEndpoint, getVersesEndpoint, getSurahsEndpoint } from '../controllers/versesController.js';
import { validateSearchQuery, validateVersesQuery } from '../middleware/validation.js';

const router = express.Router();

/**
 * @swagger
 * /verses/search:
 *   get:
 *     summary: Search Quran verses by Arabic phrase, English phrase, or reference
 *     tags: [Verses]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         required: true
 *         description: Search keyword, phrase, or reference (e.g. "2:255")
 *       - in: query
 *         name: surah
 *         schema:
 *           type: integer
 *         description: Optional surah filter (1-114)
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
 *     responses:
 *       200:
 *         description: List of matched verses with character match spans
 */
router.get('/verses/search', validateSearchQuery, searchVersesEndpoint);

/**
 * @swagger
 * /verses/surahs:
 *   get:
 *     summary: Get all 114 Surahs with metadata
 *     tags: [Verses]
 *     responses:
 *       200:
 *         description: List of surahs
 */
router.get('/verses/surahs', getSurahsEndpoint);

/**
 * @swagger
 * /verses:
 *   get:
 *     summary: Retrieve an exact contiguous range of Ayahs within a Surah
 *     tags: [Verses]
 *     parameters:
 *       - in: query
 *         name: surah
 *         schema:
 *           type: integer
 *         required: true
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Ayah list with Arabic scripture and English translation
 */
router.get('/verses', validateVersesQuery, getVersesEndpoint);

export default router;
