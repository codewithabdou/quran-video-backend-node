import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { downloadFile, cleanupTempDir } from '../utils/fileOps.js';
import { createSubtitleImage } from '../utils/textGen.js';
import webPush from 'web-push';
import dotenv from 'dotenv';
dotenv.config();

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        process.env.VAPID_EMAIL,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Stores
const subscriptionStore = new Map();
const progressStore = new Map();

export const subscribeToProgress = (requestId, subscription) => {
    subscriptionStore.set(requestId, subscription);
};

export const getProgress = (requestId, callback, req) => {
    // Check store periodically
    const interval = setInterval(() => {
        const data = progressStore.get(requestId);
        if (data) {
            // Check if callback wants to handle writing
            const shouldStop = callback(data, data.status === 'completed' || data.error);
            if (data.status === 'completed' || data.error) {
                clearInterval(interval);
                progressStore.delete(requestId);
            }
        }
    }, 500);

    if (req) {
        req.on('close', () => {
            clearInterval(interval);
        });
    }
};

export const generateVideo = async (data, requestId) => {
    // Check duplicate
    if (progressStore.has(requestId)) {
        const current = progressStore.get(requestId);
        if (current.status !== 'completed' && !current.error) {
            return { status: 'already_processing' };
        }
    }

    progressStore.set(requestId, { status: "starting", percentage: 0 });

    const updateProgress = (p, msg) => {
        progressStore.set(requestId, { status: msg, percentage: p });
        if (msg === 'status_completed') {
            // Notification logic
            const subscription = subscriptionStore.get(requestId);
            if (subscription) {
                const payload = JSON.stringify({
                    title: 'Video Generation Complete!',
                    body: `Your Quran video is ready.`,
                    icon: '/icon.png'
                });
                webPush.sendNotification(subscription, payload)
                    .catch(err => console.error("Error sending notification:", err))
                    .finally(() => subscriptionStore.delete(requestId));
            }
        }
    };

    updateProgress(5, 'status_starting');

    // ... (Core Logic adapted from original) ...
    // Note: I will need to copy the FULL logic here, ensuring imports like 'utils' are correct relative to this file.
    // Since this file is in 'src/services/', imports like '../utils/fileOps.js' are correct.

    // COPYING CORE LOGIC
    // ...
    // Returning promise that resolves to path
    return coreGenerationLogic(data, requestId, updateProgress);
};

const coreGenerationLogic = async (data, requestId, updateProgress) => {
    const { surah, ayah_start, ayah_end, reciter_id, translation_id, background_url, resolution = 720, platform = 'reel' } = data;

    const tempDir = path.join(process.cwd(), 'temp', requestId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    try {
        // 1. Fetch Quran Data
        updateProgress(10, 'status_fetching');
        const quranUrl = `http://api.alquran.cloud/v1/surah/${surah}/editions/${reciter_id},${translation_id}`;
        // ... (truncated for brevity in this thought trace, but will write full content) ...
        const response = await axios.get(quranUrl);
        const editions = response.data.data;

        // Locate editions
        const arabicEdition = editions.find(e => e.edition.identifier === reciter_id);
        const englishEdition = editions.find(e => e.edition.identifier === translation_id);

        if (!arabicEdition || !englishEdition) {
            throw new Error("Editions not found");
        }

        const ayahs = [];
        for (let i = 0; i < arabicEdition.ayahs.length; i++) {
            const num = arabicEdition.ayahs[i].numberInSurah;
            if (num >= ayah_start && num <= ayah_end) {
                ayahs.push({
                    number: num,
                    arabic: arabicEdition.ayahs[i].text,
                    english: englishEdition.ayahs[i].text,
                    audio: arabicEdition.ayahs[i].audio || `https://everyayah.com/data/${reciter_id}/${String(surah).padStart(3, '0')}${String(num).padStart(3, '0')}.mp3`
                });
            }
        }

        // 2. Download Assets
        updateProgress(20, 'status_downloading');
        const bgPath = path.join(tempDir, 'background.mp4');
        const fallbackBgPath = path.join(process.cwd(), 'fallback video', 'default_background.mp4');

        if (background_url === 'default' || !background_url) {
            if (fs.existsSync(fallbackBgPath)) {
                fs.copyFileSync(fallbackBgPath, bgPath);
            } else {
                throw new Error('Fallback video not found');
            }
        } else {
            const bgDownloaded = await downloadFile(background_url, bgPath);
            if (!bgDownloaded || !fs.existsSync(bgPath)) {
                if (fs.existsSync(fallbackBgPath)) {
                    fs.copyFileSync(fallbackBgPath, bgPath);
                } else {
                    throw new Error('Background download failed and fallback video not found');
                }
            }
        }

        const audioPaths = [];
        const subtitleImages = [];
        let totalDuration = 0;

        const targetWidth = resolution;
        const targetHeight = platform === 'reel' ? Math.floor(resolution * (16 / 9)) : Math.floor(resolution * (9 / 16));
        const width = targetWidth - (targetWidth % 2);
        const height = targetHeight - (targetHeight % 2);

        updateProgress(30, 'status_processing_audio');

        for (const ayah of ayahs) {
            const audioFilename = `audio_${ayah.number}.mp3`;
            const audioPath = path.join(tempDir, audioFilename);
            const dlSuccess = await downloadFile(ayah.audio, audioPath);
            if (!dlSuccess) throw new Error(`Failed to download audio for ayah ${ayah.number}`);
            audioPaths.push(audioPath);

            const duration = await getMediaDuration(audioPath);
            ayah.duration = duration;
            ayah.startTime = totalDuration;
            totalDuration += duration;

            const subFilename = `sub_${ayah.number}.png`;
            const subPath = path.join(tempDir, subFilename);
            await createSubtitleImage(ayah.arabic, ayah.english, subPath, {
                width: width,
                height: height,
                arabicFontPath: path.join(process.cwd(), 'fonts/Amiri-Regular.ttf'),
                englishFontPath: path.join(process.cwd(), 'fonts/arial.ttf'),
                arabicFontSize: width * 0.06,
                englishFontSize: width * 0.04
            });
            subtitleImages.push({ path: subPath, start: ayah.startTime, end: ayah.startTime + duration });
        }

        // 3. Composition
        updateProgress(50, 'status_rendering');
        const outputPath = path.join(process.cwd(), 'outputs', `video_${requestId}.mp4`);

        return new Promise((resolve, reject) => {
            const command = ffmpeg();
            command.input(bgPath).inputOptions(['-stream_loop', '-1']);

            let audioInputsStart = 1;
            audioPaths.forEach(ap => command.input(ap));
            let imageInputsStart = audioInputsStart + audioPaths.length;
            subtitleImages.forEach(img => command.input(img.path));

            const filter = [];
            const audioLabels = audioPaths.map((_, i) => `[${audioInputsStart + i}:a]`).join('');
            filter.push(`${audioLabels}concat=n=${audioPaths.length}:v=0:a=1[maina]`);
            filter.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},trim=duration=${totalDuration}[bg]`);

            let currentVideoLabel = '[bg]';
            subtitleImages.forEach((img, i) => {
                const nextLabel = `[v${i}]`;
                filter.push(`${currentVideoLabel}[${imageInputsStart + i}:v]overlay=0:0:enable='between(t,${img.start},${img.end})'${i === subtitleImages.length - 1 ? '[outv]' : nextLabel}`);
                if (i !== subtitleImages.length - 1) currentVideoLabel = nextLabel;
            });
            if (subtitleImages.length === 0) filter.push(`${currentVideoLabel}[outv]`);

            command
                .complexFilter(filter)
                .outputOptions([
                    '-map', '[outv]',
                    '-map', '[maina]',
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-pix_fmt', 'yuv420p',
                    '-shortest'
                ])
                .output(outputPath)
                .on('progress', (progress) => {
                    const p = progress.percent ? Math.min(99, 50 + (progress.percent / 2)) : 75;
                    updateProgress(Math.floor(p), 'status_rendering');
                })
                .on('end', () => {
                    updateProgress(100, 'status_completed');
                    setTimeout(async () => {
                        await cleanupTempDir(tempDir);
                        try { fs.rmdirSync(tempDir); } catch (e) {
                            console.error("Failed to remove temp dir:", e.message);
                        }
                        resolve({ path: outputPath, status: 'completed' }); // Return object
                    }, 1000);
                })
                .on('error', (err) => {
                    cleanupTempDir(tempDir);
                    reject(err);
                })
                .run();
        });

    } catch (e) {
        cleanupTempDir(tempDir);
        progressStore.set(requestId, { error: e.message }); // Ensure error is set
        throw e;
    }
};

const getMediaDuration = (path) => {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(path, (err, metadata) => {
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });
};
