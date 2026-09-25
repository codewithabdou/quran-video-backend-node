import fs from 'fs';
import path from 'path';

/**
 * In-memory state holding the Quran datasets and search indices
 */
let isInitialized = false;
const surahMap = new Map();
const ayahMap = new Map();
const surahList = [];
const searchIndex = [];

/**
 * Characters to strip in Arabic text:
 * - \uFEFF: Zero-width non-breaking space / Byte Order Mark
 * - \u0640: Tatweel (Kashida)
 * - \u064B-\u0652: Standard Arabic diacritics (Fathatan, Dammatan, Kasratan, Fatha, Damma, Kasra, Shadda, Sukun)
 * - \u0670: Superscript Alef (Dagger Alef)
 * - \u06D6-\u06ED: Quranic pause marks, sajdah signs, rub-el-hizb, etc.
 */
const ARABIC_DIACRITICS_REGEX = /[\u064B-\u0652\u0670\u06D6-\u06ED\uFEFF\u0640]/;

/**
 * Normalizes an Arabic string and produces a character index mapping
 * mapping[normIndex] -> originalIndex
 * This allows matching against the normalized text while identifying exact
 * slice boundaries in the original text (preserving tashkeel).
 */
export const normalizeArabicWithMap = (text) => {
    if (!text || typeof text !== 'string') {
        return { normalized: '', charMap: [] };
    }

    let normalized = '';
    const charMap = [];

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (ARABIC_DIACRITICS_REGEX.test(char)) {
            continue;
        }

        let normChar = char;
        if (/[آأإٱ]/.test(char)) {
            normChar = 'ا';
        } else if (char === 'ى') {
            normChar = 'ي';
        } else if (char === 'ة') {
            normChar = 'ه';
        } else if (/\s/.test(char)) {
            normChar = ' ';
        }

        normalized += normChar;
        charMap.push(i);
    }

    return { normalized, charMap };
};

/**
 * Fast Arabic normalizer without mapping (for search queries)
 */
export const normalizeArabic = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(new RegExp(ARABIC_DIACRITICS_REGEX, 'g'), '')
        .replace(/[آأإٱ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Normalizes English text and produces a character map
 */
export const normalizeEnglishWithMap = (text) => {
    if (!text || typeof text !== 'string') {
        return { normalized: '', charMap: [] };
    }

    const nfkd = text.normalize('NFKD');
    let normalized = '';
    const charMap = [];

    for (let i = 0; i < nfkd.length; i++) {
        const char = nfkd[i];
        const lower = char.toLowerCase();
        // Keep alphanumeric and space
        if (/[a-z0-9\s]/.test(lower)) {
            normalized += lower;
            charMap.push(i);
        }
    }

    return { normalized, charMap };
};

/**
 * Fast English normalizer (for search queries)
 */
export const normalizeEnglish = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

/**
 * Finds match spans in the original text given a match in the normalized text
 */
const computeMatchSpans = (originalText, charMap, normMatchStart, normMatchLength) => {
    if (normMatchStart < 0 || normMatchLength <= 0 || !charMap.length) {
        return null;
    }

    const origStart = charMap[normMatchStart];
    const lastNormIndex = normMatchStart + normMatchLength - 1;
    if (lastNormIndex >= charMap.length) return null;

    const lastOrigChar = charMap[lastNormIndex];
    let origEnd = lastOrigChar + 1;

    // Advance past any trailing diacritics belonging to the last matched letter
    while (origEnd < originalText.length && ARABIC_DIACRITICS_REGEX.test(originalText[origEnd])) {
        origEnd++;
    }

    return {
        start: origStart,
        end: origEnd,
        matchedText: originalText.slice(origStart, origEnd)
    };
};

/**
 * Initialize repository: loads and validates local JSON files
 */
export const initQuranRepository = (customDataDir = null) => {
    if (isInitialized) return;

    const dataDir = customDataDir || path.join(process.cwd(), 'data');
    const arabicPath = path.join(dataDir, 'text', 'quran-arabic.json');
    const englishPath = path.join(dataDir, 'text', 'quran-en.json');

    if (!fs.existsSync(arabicPath)) {
        throw new Error(`Quran Arabic text missing at ${arabicPath}`);
    }
    if (!fs.existsSync(englishPath)) {
        throw new Error(`Quran English text missing at ${englishPath}`);
    }

    const arabicData = JSON.parse(fs.readFileSync(arabicPath, 'utf8'));
    const englishData = JSON.parse(fs.readFileSync(englishPath, 'utf8'));

    if (!Array.isArray(arabicData.surahs) || arabicData.surahs.length !== 114) {
        throw new Error(`Invalid Arabic Quran dataset: expected 114 surahs, found ${arabicData.surahs?.length}`);
    }
    if (!Array.isArray(englishData.surahs) || englishData.surahs.length !== 114) {
        throw new Error(`Invalid English Quran dataset: expected 114 surahs, found ${englishData.surahs?.length}`);
    }

    surahMap.clear();
    ayahMap.clear();
    surahList.length = 0;
    searchIndex.length = 0;

    for (let s = 0; s < 114; s++) {
        const arSurah = arabicData.surahs[s];
        const enSurah = englishData.surahs[s];

        if (arSurah.number !== enSurah.number) {
            throw new Error(`Surah number mismatch at index ${s}: ${arSurah.number} vs ${enSurah.number}`);
        }
        if (arSurah.ayahs.length !== enSurah.ayahs.length) {
            throw new Error(`Ayah count mismatch for Surah ${arSurah.number}: ${arSurah.ayahs.length} vs ${enSurah.ayahs.length}`);
        }

        const surahRecord = Object.freeze({
            number: arSurah.number,
            name: arSurah.name,
            englishName: enSurah.englishName || arSurah.englishName,
            englishNameTranslation: enSurah.englishNameTranslation || arSurah.englishNameTranslation,
            revelationType: arSurah.revelationType,
            ayahCount: arSurah.ayahs.length,
        });

        surahMap.set(surahRecord.number, surahRecord);
        surahList.push(surahRecord);

        for (let a = 0; a < arSurah.ayahs.length; a++) {
            const arAyah = arSurah.ayahs[a];
            const enAyah = enSurah.ayahs[a];

            if (arAyah.numberInSurah !== enAyah.numberInSurah) {
                throw new Error(`Ayah numberInSurah mismatch in Surah ${arSurah.number}: ${arAyah.numberInSurah} vs ${enAyah.numberInSurah}`);
            }

            const ayahRecord = Object.freeze({
                surah: arSurah.number,
                numberInSurah: arAyah.numberInSurah,
                number: arAyah.number, // Global 1..6236 ayah number
                arabic: arAyah.text,
                english: enAyah.text,
                juz: arAyah.juz,
                page: arAyah.page,
                manzil: arAyah.manzil,
                ruku: arAyah.ruku,
                hizbQuarter: arAyah.hizbQuarter,
                sajda: arAyah.sajda || false,
            });

            const key = `${arSurah.number}:${arAyah.numberInSurah}`;
            ayahMap.set(key, ayahRecord);

            // Precompute normalized representations for search index
            const arNorm = normalizeArabicWithMap(arAyah.text);
            const enNorm = normalizeEnglishWithMap(enAyah.text);

            searchIndex.push({
                surahNumber: arSurah.number,
                numberInSurah: arAyah.numberInSurah,
                ayahRecord,
                arabicText: arAyah.text,
                arabicNormalized: arNorm.normalized,
                arabicCharMap: arNorm.charMap,
                englishText: enAyah.text,
                englishNormalized: enNorm.normalized,
                englishCharMap: enNorm.charMap,
            });
        }
    }

    isInitialized = true;
};

// Ensure initialization happens automatically upon module load
initQuranRepository();

/**
 * Returns a Surah summary by number (1..114)
 */
export const getSurah = (surahNumber) => {
    initQuranRepository();
    const num = parseInt(surahNumber, 10);
    return surahMap.get(num) || null;
};

/**
 * Returns all 114 surahs
 */
export const getAllSurahs = () => {
    initQuranRepository();
    return [...surahList];
};

/**
 * Returns a specific Ayah record by surah and number in surah
 */
export const getAyah = (surahNumber, numberInSurah) => {
    initQuranRepository();
    const s = parseInt(surahNumber, 10);
    const a = parseInt(numberInSurah, 10);
    return ayahMap.get(`${s}:${a}`) || null;
};

/**
 * Validates whether a surah and ayah range is structurally sound and within bounds
 */
export const validateRange = (surahNumber, startAyah, endAyah) => {
    initQuranRepository();
    const surahNum = parseInt(surahNumber, 10);
    const start = parseInt(startAyah, 10);
    const end = parseInt(endAyah, 10);

    if (isNaN(surahNum) || surahNum < 1 || surahNum > 114) {
        return { valid: false, error: 'Surah number must be between 1 and 114' };
    }

    const surah = surahMap.get(surahNum);
    if (!surah) {
        return { valid: false, error: `Surah ${surahNum} not found` };
    }

    const maxAyahs = surah.ayahCount;

    if (isNaN(start) || start < 1 || start > maxAyahs) {
        return { valid: false, error: `Start Ayah must be between 1 and ${maxAyahs}`, maxAyahs };
    }

    if (isNaN(end) || end < 1 || end > maxAyahs) {
        return { valid: false, error: `End Ayah must be between 1 and ${maxAyahs}`, maxAyahs };
    }

    if (start > end) {
        return { valid: false, error: 'End Ayah must be greater than or equal to Start Ayah', maxAyahs };
    }

    return { valid: true, surah, maxAyahs };
};

/**
 * Retrieves a contiguous array of Ayahs within a Surah
 */
export const getAyahRange = (surahNumber, startAyah, endAyah) => {
    const validation = validateRange(surahNumber, startAyah, endAyah);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const surahNum = parseInt(surahNumber, 10);
    const start = parseInt(startAyah, 10);
    const end = parseInt(endAyah, 10);

    const result = [];
    for (let i = start; i <= end; i++) {
        const ayah = ayahMap.get(`${surahNum}:${i}`);
        if (ayah) {
            result.push(ayah);
        }
    }
    return result;
};

/**
 * Detects if a query is a direct reference like "2:255", "2 255", "2/255"
 */
const parseReferenceQuery = (query) => {
    if (!query || typeof query !== 'string') return null;
    const trimmed = query.trim();

    // Match "2:255", "2 255", "2/255", "2,255"
    const refMatch = trimmed.match(/^(\d{1,3})\s*[:\s/,]\s*(\d{1,3})$/);
    if (refMatch) {
        const s = parseInt(refMatch[1], 10);
        const a = parseInt(refMatch[2], 10);
        return { surah: s, ayah: a };
    }

    // Match "surah 2 ayah 255" or "s2 a255"
    const verboseMatch = trimmed.match(/^(?:surah|s)\s*(\d{1,3})\s*(?:ayah|verse|a|v)\s*(\d{1,3})$/i);
    if (verboseMatch) {
        const s = parseInt(verboseMatch[1], 10);
        const a = parseInt(verboseMatch[2], 10);
        return { surah: s, ayah: a };
    }

    return null;
};

/**
 * Search verses across Arabic and English datasets
 * Supports:
 * 1. Reference queries (e.g., "2:255")
 * 2. Arabic phrase & word searches (with diacritic insensitivity)
 * 3. English phrase & word searches
 * 4. Surah filtering
 * 5. Pagination
 */
export const searchVerses = ({ query, surah = null, page = 1, limit = 20 }) => {
    initQuranRepository();

    const cleanQuery = typeof query === 'string' ? query.trim() : '';
    if (!cleanQuery) {
        return { results: [], total: 0, page: 1, limit, totalPages: 0 };
    }

    const surahFilter = surah ? parseInt(surah, 10) : null;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));

    // 1. Check for reference query first (e.g., "2:255")
    const ref = parseReferenceQuery(cleanQuery);
    if (ref && (!surahFilter || surahFilter === ref.surah)) {
        const ayah = getAyah(ref.surah, ref.ayah);
        if (ayah) {
            const surahInfo = surahMap.get(ref.surah);
            const resultItem = {
                surah: ref.surah,
                surahName: surahInfo.englishName,
                surahArabicName: surahInfo.name,
                numberInSurah: ref.ayah,
                globalNumber: ayah.number,
                arabic: ayah.arabic,
                english: ayah.english,
                matchType: 'reference',
                score: 1000,
                matchSpans: [],
            };
            return {
                results: [resultItem],
                total: 1,
                page: 1,
                limit: limitNum,
                totalPages: 1,
            };
        }
    }

    // 2. Normalize query
    const normArabicQuery = normalizeArabic(cleanQuery);
    const normEnglishQuery = normalizeEnglish(cleanQuery);

    const arabicWords = normArabicQuery ? normArabicQuery.split(' ').filter(Boolean) : [];
    const englishWords = normEnglishQuery ? normEnglishQuery.split(' ').filter(Boolean) : [];

    const matches = [];

    // 3. Match against Surah names (e.g. "الفاتحة", "البقرة", "fatiha", "baqara", "al-kahf", "cave")
    if (!surahFilter) {
        for (const s of surahList) {
            const sArNorm = normalizeArabic(s.name);
            const sEnNorm = normalizeEnglish(s.englishName);
            const sTransNorm = normalizeEnglish(s.englishNameTranslation || '');

            const sArClean = sArNorm.replace(/^سوره\s+|^سورة\s+/, '');
            const qArClean = normArabicQuery.replace(/^سوره\s+|^سورة\s+/, '');

            const arMatch = qArClean && (
                sArNorm.includes(qArClean) ||
                sArClean.includes(qArClean) ||
                sArClean.replace(/^ال/, '').includes(qArClean.replace(/^ال/, ''))
            );

            const enMatch = normEnglishQuery && (
                sEnNorm.includes(normEnglishQuery) ||
                sTransNorm.includes(normEnglishQuery) ||
                sEnNorm.replace(/^al\s+/, '').includes(normEnglishQuery) ||
                sEnNorm.replace(/([aeiou])\1+/g, '$1').includes(normEnglishQuery.replace(/([aeiou])\1+/g, '$1'))
            );

            if (arMatch || enMatch) {
                const firstAyah = getAyah(s.number, 1);
                if (firstAyah) {
                    matches.push({
                        surah: s.number,
                        surahName: s.englishName,
                        surahArabicName: s.name,
                        numberInSurah: 1,
                        globalNumber: firstAyah.number,
                        arabic: firstAyah.arabic,
                        english: firstAyah.english,
                        matchType: 'surah_name',
                        score: 800,
                        matchSpans: [],
                    });
                }
            }
        }
    }

    for (let i = 0; i < searchIndex.length; i++) {
        const item = searchIndex[i];
        if (surahFilter && item.surahNumber !== surahFilter) {
            continue;
        }

        let score = 0;
        let matchType = null;
        const matchSpans = [];

        // Check Arabic Exact Phrase Match
        if (normArabicQuery && item.arabicNormalized.includes(normArabicQuery)) {
            const idx = item.arabicNormalized.indexOf(normArabicQuery);
            const span = computeMatchSpans(item.arabicText, item.arabicCharMap, idx, normArabicQuery.length);
            if (span) {
                matchSpans.push({ language: 'arabic', ...span });
            }
            score += 100;
            matchType = matchType || 'arabic_phrase';
        }

        // Check English Exact Phrase Match
        if (normEnglishQuery && item.englishNormalized.includes(normEnglishQuery)) {
            const idx = item.englishNormalized.indexOf(normEnglishQuery);
            const span = computeMatchSpans(item.englishText, item.englishCharMap, idx, normEnglishQuery.length);
            if (span) {
                matchSpans.push({ language: 'english', ...span });
            }
            score += 90;
            matchType = matchType || 'english_phrase';
        }

        // Check Arabic All-Words Match (if not already exact phrase)
        if (!matchType && arabicWords.length > 1) {
            const allMatched = arabicWords.every(w => item.arabicNormalized.includes(w));
            if (allMatched) {
                score += 50;
                matchType = 'arabic_words';
                // Find span for each word
                for (const w of arabicWords) {
                    const idx = item.arabicNormalized.indexOf(w);
                    const span = computeMatchSpans(item.arabicText, item.arabicCharMap, idx, w.length);
                    if (span) matchSpans.push({ language: 'arabic', ...span });
                }
            }
        }

        // Check English All-Words Match (if not already matched)
        if (!matchType && englishWords.length > 1) {
            const allMatched = englishWords.every(w => item.englishNormalized.includes(w));
            if (allMatched) {
                score += 40;
                matchType = 'english_words';
                for (const w of englishWords) {
                    const idx = item.englishNormalized.indexOf(w);
                    const span = computeMatchSpans(item.englishText, item.englishCharMap, idx, w.length);
                    if (span) matchSpans.push({ language: 'english', ...span });
                }
            }
        }

        if (score > 0) {
            const surahInfo = surahMap.get(item.surahNumber);
            matches.push({
                surah: item.surahNumber,
                surahName: surahInfo.englishName,
                surahArabicName: surahInfo.name,
                numberInSurah: item.numberInSurah,
                globalNumber: item.ayahRecord.number,
                arabic: item.arabicText,
                english: item.englishText,
                matchType,
                score,
                matchSpans,
            });
        }
    }

    // Sort: highest score first, then surah number, then ayah number
    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.surah !== b.surah) return a.surah - b.surah;
        return a.numberInSurah - b.numberInSurah;
    });

    const total = matches.length;
    const totalPages = Math.ceil(total / limitNum);
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedResults = matches.slice(startIndex, startIndex + limitNum);

    return {
        results: paginatedResults,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages,
    };
};

export default {
    initQuranRepository,
    getSurah,
    getAllSurahs,
    getAyah,
    getAyahRange,
    validateRange,
    searchVerses,
    normalizeArabic,
    normalizeArabicWithMap,
    normalizeEnglish,
    normalizeEnglishWithMap,
};
