import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';

// Only set static paths if we're not inside Docker where system ffmpeg is preferred
if (!process.env.DOCKER_ENV) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath.path);
}

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { downloadFile, cleanupTempDir } from '../utils/fileOps.js';
import { createSubtitleImage, createOutroImage } from '../utils/textGen.js';
import webPush from 'web-push';
import dotenv from 'dotenv';
import { videoQueue, getProgressData, setProgress, deleteProgress, getJobResult, getQueuePosition, setActiveJob } from '../config/queue.js';

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
export const enqueueVideoGeneration = async (requestData, requestId, clientIp) => {
    // Check if this request is already being processed
    const existingProgress = await getProgressData(requestId);
    if (existingProgress
        && existingProgress.status !== 'status_completed'
        && existingProgress.status !== 'completed'
        && !existingProgress.error) {
        // Allow through if the job is stale (no update for 5+ minutes)
        const isStale = existingProgress.updatedAt
            && (Date.now() - existingProgress.updatedAt) > 5 * 60 * 1000;
        if (!isStale) {
            return { status: 'already_processing', jobId: requestId };
        }
        console.log(`[Queue] Job ${requestId} is stale. Allowing re-enqueue.`);
    }

    // Set initial progress
    await setProgress(requestId, { status: 'status_queued', percentage: 0 });

    // Add job to BullMQ queue (include clientIp so the worker can clear the lock)
    const job = await videoQueue.add(
        'generate-video',
        { requestData, requestId, clientIp },
        { jobId: requestId }
    );

    // Register the IP-to-job mapping for concurrency limiting
    if (clientIp) {
        await setActiveJob(clientIp, requestId);
    }

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
export const coreGenerationLogic = async (data, requestId, updateProgress, abortSignal) => {
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
                arabicFontPath: path.join(process.cwd(), 'fonts/Nabi.ttf'),
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

        // 2.5 Generate Outro Assets
        const outroAudioPath = path.join(tempDir, 'outro_audio.mp3');
        // Use the user's requested reciter for the outro audio instead of defaulting to ar.alafasy
        const outroAudioUrl = `http://api.alquran.cloud/v1/ayah/73:4/${reciter_id}`;
        let hasOutroAudio = false;
        try {
            const outroRes = await axios.get(outroAudioUrl);
            const outroMp3 = outroRes.data.data.audio;
            hasOutroAudio = await downloadFile(outroMp3, outroAudioPath);
        } catch (e) {
            console.error("Failed to fetch outro audio:", e.message);
        }

        let outroDuration = 5;
        if (hasOutroAudio && fs.existsSync(outroAudioPath)) {
            outroDuration = await getMediaDuration(outroAudioPath);
        } else {
            hasOutroAudio = false;
        }

        const outroSubPath = path.join(tempDir, 'outro_sub.png');
        // Clean, centralized marketing text encouraging generating and sharing
        // Add a line break for vertical videos (Reels/TikTok) to balance the layout
        const isVertical = height > width;
        const arabicOutroText = isVertical
            ? "أنشئ وشارك فيديوهات القرآن\nالخاصة بك بسهولة"
            : "أنشئ وشارك فيديوهات القرآن الخاصة بك بسهولة";
        const englishOutroText = isVertical
            ? "Create and share your own Quran\nvideos with ease"
            : "Create and share your own Quran videos with ease";
        const urlText = "quran-video-generator.netlify.app";

        await createOutroImage(arabicOutroText, englishOutroText, urlText, outroSubPath, {
            width: width,
            height: height,
            arabicFontPath: path.join(process.cwd(), 'fonts/Nabi.ttf'),
            englishFontPath: path.join(process.cwd(), 'fonts/arial.ttf')
        });

        // 3. Composition
        await updateProgress(50, 'status_rendering');
        const outputPath = path.join(process.cwd(), 'outputs', `video_${requestId}.mp4`);

        // Check if cancelled before starting FFmpeg (the expensive part)
        if (abortSignal && abortSignal.aborted) {
            await cleanupTempDir(tempDir);
            const cancelErr = new Error('Generation cancelled');
            cancelErr.name = 'AbortError';
            throw cancelErr;
        }

        return new Promise((resolve, reject) => {
            let settled = false;
            const command = ffmpeg();
            command.input(bgPath).inputOptions(['-stream_loop', '-1']);

            let audioInputsStart = 1;
            audioPaths.forEach(ap => command.input(ap));
            let imageInputsStart = audioInputsStart + audioPaths.length;
            subtitleImages.forEach(img => command.input(img.path));

            // Outro Inputs
            let outroImageIndex = imageInputsStart + subtitleImages.length;
            command.input(outroSubPath);

            let outroAudioIndex = -1;
            if (hasOutroAudio) {
                outroAudioIndex = outroImageIndex + 1;
                command.input(outroAudioPath);
            }

            // Listen for abort signal to kill FFmpeg
            if (abortSignal) {
                const onAbort = () => {
                    console.log(`[VideoService] Abort signal received for ${requestId}. Killing FFmpeg...`);
                    command.kill('SIGKILL');
                };
                if (abortSignal.aborted) {
                    // Already aborted before we started
                    cleanupTempDir(tempDir);
                    const cancelErr = new Error('Generation cancelled');
                    cancelErr.name = 'AbortError';
                    return reject(cancelErr);
                }
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }

            const filter = [];
            const audioLabels = audioPaths.map((_, i) => `[${audioInputsStart + i}:a]`).join('');
            filter.push(`${audioLabels}concat=n=${audioPaths.length}:v=0:a=1[maina]`);

            const fontFileStr = path.join(process.cwd(), 'fonts', 'arial.ttf').replace(/\\/g, '/').replace(/:/g, '\\\\:');
            // FFmpeg requires colons in the text parameter to be double-escaped if inside single quotes, or escaped otherwise. Let's strictly escape the colon.
            const urlTextEscaped = 'https\\://quran-video-generator.netlify.app';
            // Add fade-out to the main video sequence
            const fadeOutStart = Math.max(0, totalDuration - 0.5); // Start fade 0.5s before end
            filter.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},trim=duration=${totalDuration},drawtext=fontfile='${fontFileStr}':text='${urlTextEscaped}':fontcolor=white@0.7:fontsize=${Math.floor(width * 0.035)}:x=w-tw-20:y=h-th-20,fade=t=out:st=${fadeOutStart}:d=0.5:color=black[bg]`);

            let currentVideoLabel = '[bg]';
            subtitleImages.forEach((img, i) => {
                const nextLabel = `[v${i}]`;
                filter.push(`${currentVideoLabel}[${imageInputsStart + i}:v]overlay=0:0:enable='between(t,${img.start},${img.end})'${i === subtitleImages.length - 1 ? '[mainv]' : nextLabel}`);
                if (i !== subtitleImages.length - 1) currentVideoLabel = nextLabel;
            });
            if (subtitleImages.length === 0) filter.push(`${currentVideoLabel}[mainv]`);

            // Outro Logic
            filter.push(`color=c=black:s=${width}x${height}:d=${outroDuration}[black_bg]`);
            filter.push(`[black_bg][${outroImageIndex}:v]overlay=(W-w)/2:(H-h)/2:eval=init,fade=t=in:st=0:d=0.5:color=black[outrov]`);

            if (hasOutroAudio) {
                filter.push(`[mainv][maina][outrov][${outroAudioIndex}:a]concat=n=2:v=1:a=1[finalv][finala]`);
            } else {
                filter.push(`aevalsrc=0:d=${outroDuration}[silence]`);
                filter.push(`[mainv][maina][outrov][silence]concat=n=2:v=1:a=1[finalv][finala]`);
            }

            command
                .complexFilter(filter)
                .outputOptions([
                    '-map', '[finalv]',
                    '-map', '[finala]',
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-pix_fmt', 'yuv420p',
                    '-threads', '2'
                ])
                .output(outputPath)
                .on('progress', async (progress) => {
                    const p = progress.percent ? Math.min(99, 50 + (progress.percent / 2)) : 75;
                    await updateProgress(Math.floor(p), 'status_rendering');
                })
                .on('end', () => {
                    if (settled) return;
                    settled = true;
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
                    if (settled) return;
                    settled = true;
                    cleanupTempDir(tempDir);
                    // If aborted, wrap in a recognizable error
                    if (abortSignal && abortSignal.aborted) {
                        const cancelErr = new Error('Generation cancelled');
                        cancelErr.name = 'AbortError';
                        reject(cancelErr);
                    } else {
                        reject(err);
                    }
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
