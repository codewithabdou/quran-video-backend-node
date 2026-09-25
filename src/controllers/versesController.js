import quranRepository from '../services/quranRepository.js';

/**
 * GET /api/v1/verses/search?q=&surah=&page=&limit=
 * Search verses across Arabic and English Quran texts
 */
export const searchVersesEndpoint = async (req, res, next) => {
    try {
        const { q, surah, page = 1, limit = 20 } = req.query;

        const results = quranRepository.searchVerses({
            query: q,
            surah: surah ? parseInt(surah, 10) : null,
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 20,
        });

        res.json({
            status: 'success',
            data: results,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/v1/verses?surah=&start=&end=
 * Get exact selected ayahs with Arabic text and English translation
 */
export const getVersesEndpoint = async (req, res, next) => {
    try {
        const { surah, start = 1, end } = req.query;
        const surahNum = parseInt(surah, 10);
        const startAyah = parseInt(start, 10) || 1;
        const endAyah = end ? parseInt(end, 10) : startAyah;

        const surahInfo = quranRepository.getSurah(surahNum);
        if (!surahInfo) {
            return res.status(404).json({ error: `Surah ${surahNum} not found` });
        }

        const ayahs = quranRepository.getAyahRange(surahNum, startAyah, endAyah);

        res.json({
            status: 'success',
            data: {
                surah: surahInfo,
                ayahs,
                count: ayahs.length,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/v1/verses/surahs
 * Get list of all 114 surahs
 */
export const getSurahsEndpoint = async (req, res, next) => {
    try {
        const surahs = quranRepository.getAllSurahs();
        res.json({
            status: 'success',
            data: { surahs },
        });
    } catch (error) {
        next(error);
    }
};

export default {
    searchVersesEndpoint,
    getVersesEndpoint,
    getSurahsEndpoint,
};
