import { describe, it, expect } from '@jest/globals';
import quranRepository, {
    normalizeArabic,
    normalizeArabicWithMap,
    normalizeEnglish,
    validateRange,
    getAyahRange,
    getSurah,
    getAllSurahs,
    getAyah,
    searchVerses,
} from '../quranRepository.js';

describe('quranRepository Service', () => {
    describe('Initialization & Structure', () => {
        it('should load all 114 surahs', () => {
            const surahs = getAllSurahs();
            expect(surahs).toHaveLength(114);
            expect(surahs[0].number).toBe(1);
            expect(surahs[0].englishName).toBe('Al-Faatiha');
            expect(surahs[113].number).toBe(114);
            expect(surahs[113].englishName).toBe('An-Naas');
        });

        it('should retrieve a specific Surah by number', () => {
            const surah = getSurah(2);
            expect(surah).toBeDefined();
            expect(surah.number).toBe(2);
            expect(surah.englishName).toBe('Al-Baqara');
            expect(surah.ayahCount).toBe(286);
        });

        it('should return null for non-existent Surah', () => {
            expect(getSurah(0)).toBeNull();
            expect(getSurah(115)).toBeNull();
            expect(getSurah('invalid')).toBeNull();
        });

        it('should retrieve a specific Ayah by surah and number in surah', () => {
            const ayah = getAyah(1, 1);
            expect(ayah).toBeDefined();
            expect(ayah.surah).toBe(1);
            expect(ayah.numberInSurah).toBe(1);
            expect(ayah.arabic).toContain('بِسْمِ اللَّهِ');
            expect(ayah.english).toContain('In the name of Allah');
        });
    });

    describe('Arabic Normalization', () => {
        it('should strip harakat (fatha, damma, kasra, shadda, sukun, tanween)', () => {
            const text = 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ';
            const normalized = normalizeArabic(text);
            expect(normalized).toBe('بسم الله الرحمن الرحيم');
        });

        it('should normalize alef variants and alef maqsura', () => {
            const text = 'إِنَّ أَنزَلْنَاهُ فِي لَيْلَةِ الْقَدْرِ';
            const normalized = normalizeArabic(text);
            expect(normalized).toBe('ان انزلناه في ليله القدر');
        });

        it('should generate accurate character maps for match span reconstruction', () => {
            const text = 'الرَّحْمَٰنِ الرَّحِيمِ';
            const { normalized, charMap } = normalizeArabicWithMap(text);
            expect(normalized).toBe('الرحمن الرحيم');
            expect(charMap.length).toBe(normalized.length);
            // Verify that first character maps to 'ا'
            expect(text[charMap[0]]).toBe('ا');
        });
    });

    describe('English Normalization', () => {
        it('should lowercase and strip punctuation', () => {
            const text = 'In the name of Allah, the Entirely Merciful!';
            const normalized = normalizeEnglish(text);
            expect(normalized).toBe('in the name of allah the entirely merciful');
        });
    });

    describe('Range Validation', () => {
        it('should validate a correct ayah range', () => {
            const val = validateRange(1, 1, 7);
            expect(val.valid).toBe(true);
            expect(val.maxAyahs).toBe(7);
        });

        it('should reject startAyah > endAyah', () => {
            const val = validateRange(1, 5, 2);
            expect(val.valid).toBe(false);
            expect(val.error).toContain('greater than or equal');
        });

        it('should reject ayah numbers exceeding surah length', () => {
            const val = validateRange(1, 1, 8); // Al-Fatiha only has 7 ayahs
            expect(val.valid).toBe(false);
            expect(val.error).toContain('between 1 and 7');
        });

        it('should reject invalid surah number', () => {
            const val = validateRange(115, 1, 5);
            expect(val.valid).toBe(false);
        });
    });

    describe('getAyahRange', () => {
        it('should return exact contiguous slice of Ayahs', () => {
            const ayahs = getAyahRange(2, 255, 257);
            expect(ayahs).toHaveLength(3);
            expect(ayahs[0].numberInSurah).toBe(255);
            expect(ayahs[1].numberInSurah).toBe(256);
            expect(ayahs[2].numberInSurah).toBe(257);
        });

        it('should throw on invalid range', () => {
            expect(() => getAyahRange(1, 5, 10)).toThrow();
        });
    });

    describe('Verse Search', () => {
        it('should resolve direct reference query (e.g. 2:255)', () => {
            const res = searchVerses({ query: '2:255' });
            expect(res.total).toBe(1);
            expect(res.results[0].surah).toBe(2);
            expect(res.results[0].numberInSurah).toBe(255);
            expect(res.results[0].matchType).toBe('reference');
        });

        it('should search by Arabic phrase ignoring diacritics', () => {
            const res = searchVerses({ query: 'الحمد لله رب العالمين' });
            expect(res.total).toBeGreaterThanOrEqual(1);
            expect(res.results[0].surah).toBe(1);
            expect(res.results[0].numberInSurah).toBe(2);
            expect(res.results[0].matchSpans.length).toBeGreaterThan(0);
        });

        it('should search by English phrase', () => {
            const res = searchVerses({ query: 'light upon light' });
            expect(res.total).toBeGreaterThanOrEqual(1);
            expect(res.results[0].surah).toBe(24); // Surah An-Nur
            expect(res.results[0].numberInSurah).toBe(35);
        });

        it('should respect surah filter', () => {
            const res = searchVerses({ query: 'الله', surah: 112 }); // Al-Ikhlas
            expect(res.results.every(r => r.surah === 112)).toBe(true);
        });

        it('should paginate results', () => {
            const res1 = searchVerses({ query: 'الله', page: 1, limit: 5 });
            expect(res1.results).toHaveLength(5);
            expect(res1.page).toBe(1);
            expect(res1.limit).toBe(5);
            expect(res1.totalPages).toBeGreaterThan(1);
        });

        it('should return empty results for empty query', () => {
            const res = searchVerses({ query: '   ' });
            expect(res.total).toBe(0);
            expect(res.results).toEqual([]);
        });
    });
});
