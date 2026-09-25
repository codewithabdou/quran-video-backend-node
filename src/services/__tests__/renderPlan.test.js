import { describe, it, expect } from '@jest/globals';
import {
    buildRenderPlan,
    distributeAudioDurations,
    renderScreenToBuffer,
    getCanvasDimensions,
    wrapText,
} from '../renderPlan.js';
import { createCanvas } from 'canvas';

describe('renderPlan Service', () => {
    describe('Canvas Dimensions & Safe Zones', () => {
        it('should calculate 9:16 reel dimensions', () => {
            const dims720 = getCanvasDimensions('reel', 720);
            expect(dims720.width).toBe(720);
            expect(dims720.height).toBe(1280);
            expect(dims720.safeArea.width).toBeLessThan(720);
            expect(dims720.safeArea.height).toBeLessThan(1280);

            const dims1080 = getCanvasDimensions('reel', 1080);
            expect(dims1080.width).toBe(1080);
            expect(dims1080.height).toBe(1920);
        });

        it('should calculate 16:9 YouTube dimensions', () => {
            const dims720 = getCanvasDimensions('youtube', 720);
            expect(dims720.height).toBe(720);
            expect(dims720.width).toBe(1280);

            const dims1080 = getCanvasDimensions('youtube', 1080);
            expect(dims1080.height).toBe(1080);
            expect(dims1080.width).toBe(1920);
        });
    });

    describe('wrapText', () => {
        it('should wrap lines without breaking words', () => {
            const ctx = createCanvas(500, 500).getContext('2d');
            ctx.font = '24px Arial';
            const text = 'In the name of Allah the Entirely Merciful the Especially Merciful';
            const lines = wrapText(ctx, text, 150);

            expect(lines.length).toBeGreaterThan(1);
            // Reconstructed text should match original words
            expect(lines.join(' ')).toBe(text);
        });
    });

    describe('buildRenderPlan', () => {
        it('should build a plan for a short single ayah (1:1)', () => {
            const plan = buildRenderPlan({
                surah: 1,
                ayahStart: 1,
                ayahEnd: 1,
                platform: 'reel',
                resolution: 720,
                textMode: 'bilingual',
            });

            expect(plan.planVersion).toBe(1);
            expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
            expect(plan.selection.surah).toBe(1);
            expect(plan.selection.totalAyahs).toBe(1);
            expect(plan.screens).toHaveLength(1);
            expect(plan.screens[0].page).toBe(1);
            expect(plan.screens[0].pageCount).toBe(1);
            expect(plan.screens[0].layout.fits).toBe(true);
            expect(plan.warnings).toHaveLength(0);
        });

        it('should paginate long ayah 2:282 into multiple screens', () => {
            const plan = buildRenderPlan({
                surah: 2,
                ayahStart: 282,
                ayahEnd: 282,
                platform: 'reel',
                resolution: 720,
                textMode: 'bilingual',
            });

            expect(plan.screens.length).toBeGreaterThan(1);
            expect(plan.warnings.some(w => w.type === 'multi_screen_ayah')).toBe(true);

            // Assert complete text coverage across screens
            const concatenatedArabic = plan.screens.map(s => s.arabicText).join(' ');
            const originalAyah = plan.ayahs[0].arabic;
            // All words from original ayah must be present
            const origWords = originalAyah.trim().split(/\s+/);
            const concatWords = concatenatedArabic.trim().split(/\s+/);
            expect(concatWords).toHaveLength(origWords.length);
        });

        it('should produce identical plan hash for identical inputs', () => {
            const planA = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 3, platform: 'reel' });
            const planB = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 3, platform: 'reel' });
            expect(planA.planHash).toBe(planB.planHash);
        });

        it('should produce different plan hash when settings change', () => {
            const planReel = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 3, platform: 'reel' });
            const planYt = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 3, platform: 'youtube' });
            expect(planReel.planHash).not.toBe(planYt.planHash);
        });

        it('should support arabic_only textMode with no English text', () => {
            const plan = buildRenderPlan({
                surah: 1,
                ayahStart: 1,
                ayahEnd: 2,
                textMode: 'arabic_only',
            });

            expect(plan.settings.textMode).toBe('arabic_only');
            expect(plan.screens.every(s => s.englishText === null)).toBe(true);
        });
    });

    describe('distributeAudioDurations', () => {
        it('should allocate whole ayah duration to single-screen ayah', () => {
            const plan = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 1 });
            const timedPlan = distributeAudioDurations(plan, { 1: 5.5 });

            expect(timedPlan.duration.status).toBe('prepared');
            expect(timedPlan.duration.recitationMs).toBe(5500);
            expect(timedPlan.screens[0].startMs).toBe(0);
            expect(timedPlan.screens[0].endMs).toBe(5500);
            expect(timedPlan.screens[0].durationMs).toBe(5500);
        });

        it('should distribute duration across multi-screen ayah monotonically', () => {
            const plan = buildRenderPlan({ surah: 2, ayahStart: 282, ayahEnd: 282 });
            const timedPlan = distributeAudioDurations(plan, { 282: 90 });

            expect(timedPlan.screens.length).toBeGreaterThan(1);
            let prevEnd = 0;
            for (const screen of timedPlan.screens) {
                expect(screen.startMs).toBe(prevEnd);
                expect(screen.endMs).toBeGreaterThan(screen.startMs);
                expect(screen.durationMs).toBeGreaterThanOrEqual(2000); // minimum dwell
                prevEnd = screen.endMs;
            }
            expect(prevEnd).toBe(90000);
        });

        it('should flag duration_limit_exceeded when recitation exceeds 180s', () => {
            const plan = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 1 });
            const timedPlan = distributeAudioDurations(plan, { 1: 190 });

            expect(timedPlan.duration.status).toBe('limit-exceeded');
            expect(timedPlan.warnings.some(w => w.type === 'duration_limit_exceeded')).toBe(true);
        });
    });

    describe('renderScreenToBuffer', () => {
        it('should render a transparent PNG buffer for a planned screen', async () => {
            const plan = buildRenderPlan({ surah: 1, ayahStart: 1, ayahEnd: 1, platform: 'reel', resolution: 720 });
            const buffer = await renderScreenToBuffer(plan.screens[0], { width: 720, height: 1280 });

            expect(Buffer.isBuffer(buffer)).toBe(true);
            expect(buffer.length).toBeGreaterThan(1000);
            // Verify PNG magic bytes [0x89, 'P', 'N', 'G']
            expect(buffer[0]).toBe(0x89);
            expect(buffer[1]).toBe(0x50);
            expect(buffer[2]).toBe(0x4e);
            expect(buffer[3]).toBe(0x47);
        });
    });
});
