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
import { videoQueue, getProgressData, setProgress, deleteProgress, getJobResult, getQueuePosition } from '../config/queue.js';

dotenv.config();

// Configure web-push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        process.env.VAPID_EMAIL,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Subscription store (kept in-memory — only used for push notifications)
const subscriptionStore = new Map();

export const subscribeToProgress = (requestId, subscription) => {
    subscriptionStore.set(requestId, subscription);
};

/**
 * Get progress via SSE — reads from Redis instead of in-memory Map
 */
export const getProgress = (requestId, callback, req) => {
    const interval = setInterval(async () => {
        try {
            const data = await getProgressData(requestId);
            if (data) {
                // Fetch queue position if still waiting
                if (data.status === 'status_queued' || data.status === 'queued') {
                    const pos = await getQueuePosition(requestId);
                    if (pos > 0) {
                        data.queuePosition = pos;
                    }
                }

                callback(data, data.status === 'status_completed' || data.status === 'completed' || data.error);
                if (data.status === 'status_completed' || data.status === 'completed' || data.error) {
                    clearInterval(interval);
                }
            }
        } catch (err) {
            console.error('Error reading progress from Redis:', err.message);
        }
    }, 500);

    if (req) {
        req.on('close', () => {
            clearInterval(interval);
        });
    }
};

/**
 * Add a video generation job to the queue (non-blocking)
 * Returns the job ID immediately
 */
export const enqueueVideoGeneration = async (requestData, requestId) => {
    // Check if this request is already being processed
    const existingProgress = await getProgressData(requestId);
    if (existingProgress && existingProgress.status !== 'status_completed' && existingProgress.status !== 'completed' && !existingProgress.error) {
        return { status: 'already_processing', jobId: requestId };
    }

    // Set initial progress
    await setProgress(requestId, { status: 'status_queued', percentage: 0 });

    // Add job to BullMQ queue
    const job = await videoQueue.add(
        'generate-video',
        { requestData, requestId },
        { jobId: requestId }
    );

    console.log(`[Queue] Job ${job.id} added to queue for requestId: ${requestId}`);
    return { status: 'queued', jobId: requestId };
};

/**
 * Check if a job result is ready for download
 */
export const checkJobResult = async (requestId) => {
    return await getJobResult(requestId);
};

/**
 * Send push notification on completion (called by the worker's updateProgress)
 */
export const sendCompletionNotification = (requestId) => {
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
};

/**
 * Core video generation logic — exported for the worker to import
 * This is the heavy FFmpeg work that runs inside the BullMQ worker
 */
export const coreGenerationLogic = async (data, requestId, updateProgress) => {
    const { surah, ayah_start, ayah_end, reciter_id, translation_id, background_url, resolution = 720, platform = 'reel' } = data;

    const tempDir = path.join(process.cwd(), 'temp', requestId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    try {
        // 1. Fetch Quran Data
        await updateProgress(10, 'status_fetching');
        const quranUrl = `http://api.alquran.cloud/v1/surah/${surah}/editions/${reciter_id},${translation_id}`;
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
        await updateProgress(20, 'status_downloading');
        const bgPath = path.join(tempDir, 'background.mp4');
        const fallbackBgPath = path.join(process.cwd(), 'fallback video', 'default_background.mp4');

        if (background_url === 'default' || !background_url) {
            if (fs.existsSync(fallbackBgPath)) {
                fs.copyFileSync(fallbackBgPath, bgPath);
            } else {
                throw new Error('Fallback video not found');
            }
        } else if (background_url.startsWith('http://') || background_url.startsWith('https://')) {
            // It's an external URL, attempt standard download
            const bgDownloaded = await downloadFile(background_url, bgPath);
            if (!bgDownloaded || !fs.existsSync(bgPath)) {
                if (fs.existsSync(fallbackBgPath)) {
                    fs.copyFileSync(fallbackBgPath, bgPath);
                } else {
                    throw new Error('Background download failed and fallback video not found');
                }
            }
        } else {
            // It's a local file path (e.g., from the /upload-background endpoint / cache)
            if (fs.existsSync(background_url)) {
                // Copy the cached file to the temp directory where the composition happens
                fs.copyFileSync(background_url, bgPath);
                // We deliberately do NOT delete the original `background_url` here anymore so it persists as a cache
            } else {
                if (fs.existsSync(fallbackBgPath)) {
                    fs.copyFileSync(fallbackBgPath, bgPath);
                } else {
                    throw new Error('Local background file not found and fallback video not found');
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

        await updateProgress(30, 'status_processing_audio');

        // Parallelize downloads, duration extraction, and subtitle generation
        await Promise.all(ayahs.map(async (ayah) => {
            const audioFilename = `audio_${ayah.number}.mp3`;
            const audioPath = path.join(tempDir, audioFilename);
            const dlSuccess = await downloadFile(ayah.audio, audioPath);
            if (!dlSuccess) throw new Error(`Failed to download audio for ayah ${ayah.number}`);
            ayah.audioPath = audioPath;

            ayah.duration = await getMediaDuration(audioPath);

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
            ayah.subPath = subPath;
        }));

        // Compute sequential timings
        for (const ayah of ayahs) {
            ayah.startTime = totalDuration;
            totalDuration += ayah.duration;

            audioPaths.push(ayah.audioPath);
            subtitleImages.push({ path: ayah.subPath, start: ayah.startTime, end: ayah.startTime + ayah.duration });
        }

        // 3. Composition
        await updateProgress(50, 'status_rendering');
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
                    '-threads', '2',
                    '-shortest'
                ])
                .output(outputPath)
                .on('progress', async (progress) => {
                    const p = progress.percent ? Math.min(99, 50 + (progress.percent / 2)) : 75;
                    await updateProgress(Math.floor(p), 'status_rendering');
                })
                .on('end', () => {
                    setTimeout(async () => {
                        await cleanupTempDir(tempDir);
                        try { fs.rmdirSync(tempDir); } catch (e) {
                            console.error("Failed to remove temp dir:", e.message);
                        }

                        // Send push notification
                        sendCompletionNotification(requestId);

                        resolve({ path: outputPath, status: 'completed' });
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
