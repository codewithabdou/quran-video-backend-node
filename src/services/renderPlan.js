import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { createCanvas, registerFont } from 'canvas';
import quranRepository from './quranRepository.js';

// Track registered fonts
const registeredFonts = new Set();

const ensureFontsRegistered = () => {
    const arabicFontPath = path.join(process.cwd(), 'fonts', 'Nabi.ttf');
    const englishFontPath = path.join(process.cwd(), 'fonts', 'arial.ttf');

    if (!registeredFonts.has(arabicFontPath) && fs.existsSync(arabicFontPath)) {
        try {
            registerFont(arabicFontPath, { family: 'Nabi' });
            registeredFonts.add(arabicFontPath);
        } catch (e) {
            console.warn('[Font] Failed to register Nabi font:', e.message);
        }
    }

    if (!registeredFonts.has(englishFontPath) && fs.existsSync(englishFontPath)) {
        try {
            registerFont(englishFontPath, { family: 'Arial' });
            registeredFonts.add(englishFontPath);
        } catch (e) {
            console.warn('[Font] Failed to register Arial font:', e.message);
        }
    }
};

/**
 * Text wrapping helper that measures width on a canvas context
 */
export const wrapText = (ctx, text, maxWidth) => {
    if (!text || typeof text !== 'string') return [];
    const paragraphs = text.split('\n');
    const lines = [];

    for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
            lines.push('');
            continue;
        }

        const words = paragraph.trim().split(/\s+/);
        let currentLine = words[0] || '';

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine + ' ' + word;
            if (ctx.measureText(testLine).width <= maxWidth) {
                currentLine = testLine;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) {
            lines.push(currentLine);
        }
    }

    return lines;
};

/**
 * Calculates canvas dimensions based on platform and resolution
 */
export const getCanvasDimensions = (platform = 'reel', resolution = 720) => {
    const res = parseInt(resolution, 10) || 720;
    const isReel = platform !== 'youtube';

    let width, height;
    if (isReel) {
        width = res;
        height = Math.round((width * 16) / 9);
        // Ensure even dimensions
        if (height % 2 !== 0) height++;
    } else {
        height = res;
        width = Math.round((height * 16) / 9);
        if (width % 2 !== 0) width++;
    }

    // Safe zone definitions
    const safeZone = isReel
        ? {
            topMargin: Math.round(height * 0.16),
            bottomMargin: Math.round(height * 0.22),
            leftMargin: Math.round(width * 0.08),
            rightMargin: Math.round(width * 0.08),
        }
        : {
            topMargin: Math.round(height * 0.14),
            bottomMargin: Math.round(height * 0.18),
            leftMargin: Math.round(width * 0.10),
            rightMargin: Math.round(width * 0.10),
        };

    const safeArea = {
        x: safeZone.leftMargin,
        y: safeZone.topMargin,
        width: width - safeZone.leftMargin - safeZone.rightMargin,
        height: height - safeZone.topMargin - safeZone.bottomMargin,
    };

    return { width, height, safeArea };
};

/**
 * Measures layout height for a given combination of Arabic and English text
 */
const measureLayoutHeight = (ctx, arText, enText, safeWidth, arFontSize, enFontSize, gap) => {
    ctx.font = `${arFontSize}px Nabi, Arial`;
    const arLines = wrapText(ctx, arText, safeWidth);
    const arLineHeight = arFontSize * 1.8;
    const arHeight = arLines.length * arLineHeight;

    let enLines = [];
    let enHeight = 0;
    if (enText) {
        ctx.font = `${enFontSize}px Arial`;
        enLines = wrapText(ctx, enText, safeWidth);
        const enLineHeight = enFontSize * 1.3;
        enHeight = enLines.length * enLineHeight;
    }

    const totalHeight = arHeight + (enText ? gap : 0) + enHeight;

    return {
        arLines,
        enLines,
        arHeight,
        enHeight,
        totalHeight,
    };
};

// Stop mark regex for finding natural pause points in Quranic Arabic
const QURAN_STOP_MARKS_REGEX = /[\u06D6-\u06ED]/;

/**
 * Splits text into N proportional segments, prioritizing natural punctuation/stop marks
 */
const splitTextIntoSegments = (text, numSegments, isArabic = false) => {
    if (!text || numSegments <= 1) {
        return [{ text, startOffset: 0, endOffset: text.length }];
    }

    const words = text.trim().split(/\s+/);
    if (words.length <= numSegments) {
        // Less words than segments, return 1 word per segment or single segment
        return [{ text, startOffset: 0, endOffset: text.length }];
    }

    const wordsPerSegment = Math.ceil(words.length / numSegments);
    const segments = [];
    let currentWordIndex = 0;
    let currentSearchOffset = 0;

    for (let seg = 0; seg < numSegments; seg++) {
        if (currentWordIndex >= words.length) break;

        const isLast = seg === numSegments - 1;
        let targetEndWord = isLast ? words.length : Math.min(words.length, currentWordIndex + wordsPerSegment);

        // For Arabic, if not the last segment, look for a nearby Quranic stop mark within +/- 2 words
        if (isArabic && !isLast) {
            for (let offset = 0; offset <= 2; offset++) {
                const checkIdx = targetEndWord + offset;
                if (checkIdx < words.length && QURAN_STOP_MARKS_REGEX.test(words[checkIdx - 1])) {
                    targetEndWord = checkIdx;
                    break;
                }
                const checkPrev = targetEndWord - offset;
                if (checkPrev > currentWordIndex + 1 && QURAN_STOP_MARKS_REGEX.test(words[checkPrev - 1])) {
                    targetEndWord = checkPrev;
                    break;
                }
            }
        }

        // For English, look for sentence/clause punctuation like '.', ',', ';', '—'
        if (!isArabic && !isLast) {
            for (let offset = 0; offset <= 2; offset++) {
                const checkIdx = targetEndWord + offset;
                if (checkIdx < words.length && /[.,;—]/.test(words[checkIdx - 1])) {
                    targetEndWord = checkIdx;
                    break;
                }
                const checkPrev = targetEndWord - offset;
                if (checkPrev > currentWordIndex + 1 && /[.,;—]/.test(words[checkPrev - 1])) {
                    targetEndWord = checkPrev;
                    break;
                }
            }
        }

        const segmentWords = words.slice(currentWordIndex, targetEndWord);
        const segmentText = segmentWords.join(' ');

        // Find character offsets in original text
        const startOffset = text.indexOf(segmentWords[0], currentSearchOffset);
        const lastWord = segmentWords[segmentWords.length - 1];
        const endOffset = text.indexOf(lastWord, startOffset) + lastWord.length;
        currentSearchOffset = endOffset;

        segments.push({
            text: segmentText,
            startOffset: Math.max(0, startOffset),
            endOffset: Math.min(text.length, endOffset),
        });

        currentWordIndex = targetEndWord;
    }

    return segments;
};

/**
 * Paginates an Ayah into 1 or more screens to guarantee it fits within the safe area
 */
const paginateAyah = (ctx, ayah, settings, canvasDimensions) => {
    const { safeArea, width, height } = canvasDimensions;
    const baseSize = Math.min(width, height);
    const isArabicOnly = settings.textMode === 'arabic_only';

    // Default font sizes
    const defaultArSize = Math.round(baseSize * (isArabicOnly ? 0.082 : 0.068));
    const defaultEnSize = isArabicOnly ? 0 : Math.round(baseSize * 0.038);
    const gap = isArabicOnly ? 0 : Math.round(baseSize * 0.035);

    // 1. Try single screen at default font size
    let measure = measureLayoutHeight(
        ctx,
        ayah.arabic,
        isArabicOnly ? null : ayah.english,
        safeArea.width,
        defaultArSize,
        defaultEnSize,
        gap
    );

    if (measure.totalHeight <= safeArea.height) {
        return [{
            arabicText: ayah.arabic,
            englishText: isArabicOnly ? null : ayah.english,
            arabicStartOffset: 0,
            arabicEndOffset: ayah.arabic.length,
            englishStartOffset: 0,
            englishEndOffset: isArabicOnly ? 0 : ayah.english.length,
            arabicLines: measure.arLines.length,
            englishLines: measure.enLines.length,
            arabicFontSize: defaultArSize,
            englishFontSize: defaultEnSize,
            gap,
            fits: true,
        }];
    }

    // 2. Try single screen with modest font size reduction (~15%)
    const reducedArSize = Math.round(defaultArSize * 0.85);
    const reducedEnSize = isArabicOnly ? 0 : Math.round(defaultEnSize * 0.85);
    measure = measureLayoutHeight(
        ctx,
        ayah.arabic,
        isArabicOnly ? null : ayah.english,
        safeArea.width,
        reducedArSize,
        reducedEnSize,
        gap
    );

    if (measure.totalHeight <= safeArea.height) {
        return [{
            arabicText: ayah.arabic,
            englishText: isArabicOnly ? null : ayah.english,
            arabicStartOffset: 0,
            arabicEndOffset: ayah.arabic.length,
            englishStartOffset: 0,
            englishEndOffset: isArabicOnly ? 0 : ayah.english.length,
            arabicLines: measure.arLines.length,
            englishLines: measure.enLines.length,
            arabicFontSize: reducedArSize,
            englishFontSize: reducedEnSize,
            gap,
            fits: true,
        }];
    }

    // 3. Multi-screen required: Calculate required number of screens
    // Start with 2 pages and increase until all pages fit cleanly
    let numScreens = 2;
    let paginatedScreens = [];
    const maxScreensLimit = 10; // Safety cap

    while (numScreens <= maxScreensLimit) {
        const arSegments = splitTextIntoSegments(ayah.arabic, numScreens, true);
        const enSegments = isArabicOnly ? [] : splitTextIntoSegments(ayah.english, numScreens, false);

        let allFit = true;
        const candidateScreens = [];

        for (let i = 0; i < numScreens; i++) {
            const arSeg = arSegments[i] || arSegments[arSegments.length - 1];
            const enSeg = isArabicOnly ? null : (enSegments[i] || enSegments[enSegments.length - 1]);

            const segMeasure = measureLayoutHeight(
                ctx,
                arSeg.text,
                enSeg ? enSeg.text : null,
                safeArea.width,
                defaultArSize,
                defaultEnSize,
                gap
            );

            if (segMeasure.totalHeight > safeArea.height) {
                allFit = false;
                break;
            }

            candidateScreens.push({
                arabicText: arSeg.text,
                englishText: enSeg ? enSeg.text : null,
                arabicStartOffset: arSeg.startOffset,
                arabicEndOffset: arSeg.endOffset,
                englishStartOffset: enSeg ? enSeg.startOffset : 0,
                englishEndOffset: enSeg ? enSeg.endOffset : 0,
                arabicLines: segMeasure.arLines.length,
                englishLines: segMeasure.enLines.length,
                arabicFontSize: defaultArSize,
                englishFontSize: defaultEnSize,
                gap,
                fits: true,
            });
        }

        if (allFit) {
            paginatedScreens = candidateScreens;
            break;
        }

        numScreens++;
    }

    // If still couldn't fit at default size with numScreens (extremely long single sentence),
    // scale down font sizes on the highest screen count
    if (!paginatedScreens.length) {
        const arSegments = splitTextIntoSegments(ayah.arabic, numScreens, true);
        const enSegments = isArabicOnly ? [] : splitTextIntoSegments(ayah.english, numScreens, false);

        for (let i = 0; i < numScreens; i++) {
            const arSeg = arSegments[i] || arSegments[arSegments.length - 1];
            const enSeg = isArabicOnly ? null : (enSegments[i] || enSegments[enSegments.length - 1]);
            const segMeasure = measureLayoutHeight(
                ctx,
                arSeg.text,
                enSeg ? enSeg.text : null,
                safeArea.width,
                reducedArSize,
                reducedEnSize,
                gap
            );

            paginatedScreens.push({
                arabicText: arSeg.text,
                englishText: enSeg ? enSeg.text : null,
                arabicStartOffset: arSeg.startOffset,
                arabicEndOffset: arSeg.endOffset,
                arabicLines: segMeasure.arLines.length,
                englishLines: segMeasure.enLines.length,
                arabicFontSize: reducedArSize,
                englishFontSize: reducedEnSize,
                gap,
                fits: segMeasure.totalHeight <= safeArea.height,
            });
        }
    }

    return paginatedScreens;
};

/**
 * Builds a deterministic render plan given verse selection and settings
 */
export const buildRenderPlan = ({
    surah,
    ayahStart,
    ayahEnd,
    platform = 'reel',
    resolution = 720,
    textMode = 'bilingual',
    reciterId = 'ar.alafasy',
    timingOverrides = {},
}) => {
    ensureFontsRegistered();

    // 1. Validate selection bounds
    const validation = quranRepository.validateRange(surah, ayahStart, ayahEnd);
    if (!validation.valid) {
        throw new Error(validation.error);
    }

    const surahInfo = validation.surah;
    const ayahs = quranRepository.getAyahRange(surah, ayahStart, ayahEnd);
    const canvasDimensions = getCanvasDimensions(platform, resolution);

    // 2. Measuring Canvas Context
    const measureCanvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
    const ctx = measureCanvas.getContext('2d');

    const screens = [];
    const warnings = [];

    const effectiveSettings = {
        platform: platform === 'youtube' ? 'youtube' : 'reel',
        resolution: parseInt(resolution, 10) || 720,
        textMode: textMode === 'arabic_only' ? 'arabic_only' : 'bilingual',
        reciterId: reciterId || 'ar.alafasy',
    };

    // 3. Paginate each ayah
    for (const ayah of ayahs) {
        const pages = paginateAyah(ctx, ayah, effectiveSettings, canvasDimensions);
        const pageCount = pages.length;

        if (pageCount > 1) {
            warnings.push({
                type: 'multi_screen_ayah',
                ayah: ayah.numberInSurah,
                message: `Ayah ${ayah.numberInSurah} divided across ${pageCount} screens for optimal readability.`,
            });
        }

        pages.forEach((page, idx) => {
            const screenId = `${surahInfo.number}:${ayah.numberInSurah}:${idx + 1}`;
            const override = timingOverrides[screenId];

            screens.push({
                id: screenId,
                surah: surahInfo.number,
                ayah: ayah.numberInSurah,
                page: idx + 1,
                pageCount,
                arabicText: page.arabicText,
                englishText: page.englishText,
                arabicStartOffset: page.arabicStartOffset,
                arabicEndOffset: page.arabicEndOffset,
                englishStartOffset: page.englishStartOffset,
                englishEndOffset: page.englishEndOffset,
                startMs: override?.startMs ?? null,
                endMs: override?.endMs ?? null,
                durationMs: override && override.endMs && override.startMs ? override.endMs - override.startMs : null,
                layout: {
                    arabicLines: page.arabicLines,
                    englishLines: page.englishLines,
                    arabicFontSize: page.arabicFontSize,
                    englishFontSize: page.englishFontSize,
                    gap: page.gap,
                    fits: page.fits,
                },
            });
        });
    }

    // 4. Compute deterministic plan hash
    // Canonical data string excludes presentation-only UI state
    const hashData = {
        planVersion: 1,
        source: { arabic: 'quran-arabic.json', translation: 'en.sahih', reciterId: effectiveSettings.reciterId },
        selection: { surah: surahInfo.number, startAyah: parseInt(ayahStart, 10), endAyah: parseInt(ayahEnd, 10) },
        settings: effectiveSettings,
        screens: screens.map(s => ({
            id: s.id,
            ayah: s.ayah,
            page: s.page,
            pageCount: s.pageCount,
            arabicText: s.arabicText,
            englishText: s.englishText,
            startMs: s.startMs,
            endMs: s.endMs,
        })),
    };

    const planHash = crypto.createHash('sha256').update(JSON.stringify(hashData)).digest('hex');

    return {
        planVersion: 1,
        planHash,
        source: {
            arabic: 'quran-arabic.json',
            translation: 'en.sahih',
            reciterId: effectiveSettings.reciterId,
        },
        selection: {
            surah: surahInfo.number,
            surahName: surahInfo.englishName,
            surahArabicName: surahInfo.name,
            startAyah: parseInt(ayahStart, 10),
            endAyah: parseInt(ayahEnd, 10),
            totalAyahs: ayahs.length,
        },
        canvas: {
            width: canvasDimensions.width,
            height: canvasDimensions.height,
            safeArea: canvasDimensions.safeArea,
        },
        settings: {
            ...effectiveSettings,
            layout: 'auto',
        },
        ayahs: ayahs.map(a => ({
            number: a.numberInSurah,
            arabic: a.arabic,
            english: a.english,
        })),
        screens,
        warnings,
        duration: {
            recitationMs: null,
            outroMs: null,
            totalMs: null,
            status: 'not-prepared',
        },
    };
};

/**
 * Distributes measured audio durations across planned screens
 */
export const distributeAudioDurations = (plan, ayahDurations = {}, timingOverrides = {}) => {
    const updatedScreens = [];
    let cumulativeMs = 0;
    const MAX_DURATION_MS = 180 * 1000; // 180 seconds recitation limit

    // Group screens by ayah
    const screensByAyah = new Map();
    for (const screen of plan.screens) {
        if (!screensByAyah.has(screen.ayah)) {
            screensByAyah.set(screen.ayah, []);
        }
        screensByAyah.get(screen.ayah).push(screen);
    }

    for (const [ayahNum, screens] of screensByAyah.entries()) {
        const ayahDurationSec = ayahDurations[ayahNum] || 5; // Default 5s fallback if missing
        const ayahDurationMs = Math.round(ayahDurationSec * 1000);

        if (screens.length === 1) {
            const screen = screens[0];
            const startMs = cumulativeMs;
            const endMs = cumulativeMs + ayahDurationMs;
            cumulativeMs = endMs;

            updatedScreens.push({
                ...screen,
                startMs,
                endMs,
                durationMs: endMs - startMs,
            });
        } else {
            // Multi-screen: allocate duration by Arabic word count weight
            const wordCounts = screens.map(s => s.arabicText.trim().split(/\s+/).length);
            const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);

            let screenStartMs = cumulativeMs;

            screens.forEach((screen, idx) => {
                const isLast = idx === screens.length - 1;
                const override = timingOverrides[screen.id];

                let screenDurationMs;
                if (override && override.durationMs) {
                    screenDurationMs = override.durationMs;
                } else if (isLast) {
                    screenDurationMs = (cumulativeMs + ayahDurationMs) - screenStartMs;
                } else {
                    const weight = totalWords > 0 ? wordCounts[idx] / totalWords : 1 / screens.length;
                    screenDurationMs = Math.max(2000, Math.round(ayahDurationMs * weight));
                }

                const screenEndMs = isLast ? cumulativeMs + ayahDurationMs : screenStartMs + screenDurationMs;

                updatedScreens.push({
                    ...screen,
                    startMs: screenStartMs,
                    endMs: screenEndMs,
                    durationMs: screenEndMs - screenStartMs,
                });

                screenStartMs = screenEndMs;
            });

            cumulativeMs += ayahDurationMs;
        }
    }

    const recitationMs = cumulativeMs;
    const outroMs = 5000; // Standard outro duration (5s)
    const totalMs = recitationMs + outroMs;

    const status = recitationMs > MAX_DURATION_MS ? 'limit-exceeded' : 'prepared';

    const warnings = [...plan.warnings];
    if (recitationMs > MAX_DURATION_MS) {
        warnings.push({
            type: 'duration_limit_exceeded',
            message: `Recitation duration (${Math.round(recitationMs / 1000)}s) exceeds the 180s limit. Please select fewer ayahs.`,
        });
    }

    // Recompute plan hash with updated timings
    const hashData = {
        planVersion: 1,
        source: plan.source,
        selection: plan.selection,
        settings: plan.settings,
        screens: updatedScreens.map(s => ({
            id: s.id,
            ayah: s.ayah,
            page: s.page,
            pageCount: s.pageCount,
            arabicText: s.arabicText,
            englishText: s.englishText,
            startMs: s.startMs,
            endMs: s.endMs,
        })),
    };
    const planHash = crypto.createHash('sha256').update(JSON.stringify(hashData)).digest('hex');

    return {
        ...plan,
        planHash,
        initialPlanHash: plan.planHash,
        screens: updatedScreens,
        warnings,
        duration: {
            recitationMs,
            outroMs,
            totalMs,
            status,
        },
    };
};

/**
 * Renders a planned screen to a transparent PNG buffer
 * Shared byte-for-byte by preview frame endpoint and FFmpeg subtitle renderer
 */
export const renderScreenToBuffer = async (screen, canvasSettings = {}) => {
    ensureFontsRegistered();

    const {
        width = 720,
        height = 1280,
        arabicColor = '#FFFFFF',
        englishColor = '#E2E8F0',
        strokeColor = '#000000',
        strokeWidthArabic = 5,
        strokeWidthEnglish = 3,
    } = canvasSettings;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Transparent background
    ctx.clearRect(0, 0, width, height);

    const safeDimensions = getCanvasDimensions(canvasSettings.platform || 'reel', canvasSettings.resolution || width);
    const safeArea = safeDimensions.safeArea;

    const arFontSize = screen.layout?.arabicFontSize || Math.round(Math.min(width, height) * 0.068);
    const enFontSize = screen.layout?.englishFontSize || Math.round(Math.min(width, height) * 0.038);
    const gap = screen.layout?.gap ?? Math.round(Math.min(width, height) * 0.035);

    // 1. Measure and wrap lines
    ctx.font = `${arFontSize}px Nabi, Arial`;
    const arLines = wrapText(ctx, screen.arabicText, safeArea.width);
    const arLineHeight = arFontSize * 1.8;
    const totalArHeight = arLines.length * arLineHeight;

    let enLines = [];
    let totalEnHeight = 0;
    const hasEnglish = Boolean(screen.englishText);

    if (hasEnglish) {
        ctx.font = `${enFontSize}px Arial`;
        enLines = wrapText(ctx, screen.englishText, safeArea.width);
        const enLineHeight = enFontSize * 1.3;
        totalEnHeight = enLines.length * enLineHeight;
    }

    const totalContentHeight = totalArHeight + (hasEnglish ? gap : 0) + totalEnHeight;

    // Center content vertically inside the safe area
    const startY = safeArea.y + Math.max(0, (safeArea.height - totalContentHeight) / 2);

    // 2. Draw Arabic Text
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${arFontSize}px Nabi, Arial`;
    ctx.fillStyle = arabicColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidthArabic;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    let currentY = startY + (arLineHeight / 2);
    for (const line of arLines) {
        ctx.strokeText(line, width / 2, currentY);
        ctx.fillText(line, width / 2, currentY);
        currentY += arLineHeight;
    }

    // 3. Draw English Text (if bilingual)
    if (hasEnglish) {
        currentY += gap - (arLineHeight / 2) + ((enFontSize * 1.3) / 2);
        ctx.font = `${enFontSize}px Arial`;
        ctx.fillStyle = englishColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidthEnglish;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;

        const enLineHeight = enFontSize * 1.3;
        for (const line of enLines) {
            ctx.strokeText(line, width / 2, currentY);
            ctx.fillText(line, width / 2, currentY);
            currentY += enLineHeight;
        }
    }

    return canvas.toBuffer('image/png');
};

export default {
    buildRenderPlan,
    distributeAudioDurations,
    renderScreenToBuffer,
    getCanvasDimensions,
    wrapText,
};
