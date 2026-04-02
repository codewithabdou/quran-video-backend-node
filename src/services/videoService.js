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
import { videoQueue, getProgressData, setProgress, deleteProgress, getJobResult, getQueuePosition, setActiveJob, getActiveJob, checkUserRateLimit, incrementUserGenerationCount } from '../config/queue.js';

dotenv.config();

// Configure web-push
let vapidConfigured = false;
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
        webPush.setVapidDetails(
            process.env.VAPID_EMAIL || 'mailto:example@example.com',
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
        vapidConfigured = true;
    } catch (err) {
        console.warn('[Push] VAPID configuration failed:', err.message);
    }
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
                
                // Flush the response if the compression middleware is used
                if (req && req.res && typeof req.res.flush === 'function') {
                    req.res.flush();
                }
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
export const enqueueVideoGeneration = async (requestData, requestId, clientIp, userId = null, subscription = null) => {
    // 1. Check if this specific request is already being processed
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

    // 1.5 Check for ANY active jobs by User ID (preferred) or IP (concurrency check)
    const lockKey = userId || clientIp;
    if (lockKey) {
        const activeJobId = await getActiveJob(lockKey);
        if (activeJobId && activeJobId !== requestId) {
            const job = await videoQueue.getJob(activeJobId);
            if (job) {
                const state = await job.getState();
                if (state === 'active' || state === 'waiting' || state === 'delayed') {
                    return { status: 'already_processing', jobId: activeJobId };
                }
            }
        }
    }

    // 2. Check Hourly Rate Limit (Volume check: 10 per hour per user)
    if (userId) {
        const rateLimit = await checkUserRateLimit(userId);
        if (!rateLimit.allowed) {
            return { 
                status: 'rate_limit_exceeded', 
                message: `error_rate_limit|${rateLimit.limit}` 
            };
        }
    }

    // Set initial progress
    await setProgress(requestId, { status: 'status_queued', percentage: 0 });

    // Add job to BullMQ queue (include clientIp so the worker can clear the lock)
    const job = await videoQueue.add(
        'generate-video',
        { requestData, requestId, clientIp, userId, subscription, language: requestData.language || 'en' },
        { jobId: requestId }
    );

    // Register the locking mechanism for concurrency
    if (lockKey) {
        await setActiveJob(lockKey, requestId);
    }

    // Increment the hourly count for volume limiting
    if (userId) {
        await incrementUserGenerationCount(userId);
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
export const sendCompletionNotification = (requestId, providedSubscription = null, language = 'en') => {
    const subscription = providedSubscription || subscriptionStore.get(requestId);
    if (subscription && subscription.endpoint && vapidConfigured) {
        const notifications = {
            en: {
                title: 'Video Generation Complete!',
                body: `Your Quran video is ready.`,
            },
            fr: {
                title: 'Génération Vidéo Terminée !',
                body: `Votre vidéo du Coran est prête.`,
            },
            ar: {
                title: 'تم إنشاء الفيديو بنجاح!',
                body: `مقطع الفيديو القرآني الخاص بك جاهز.`,
            }
        };

        const notification = notifications[language] || notifications.en;

        const payload = JSON.stringify({
            title: notification.title,
            body: notification.body,
            icon: '/logo.png'
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
export const coreGenerationLogic = async (data, requestId, updateProgress, abortSignal, subscription = null, language = 'en') => {
    const { surah, ayah_start, ayah_end, reciter_id, translation_id, background_url, resolution = 720, platform = 'reel' } = data;

    const tempDir = path.join(process.cwd(), 'temp', requestId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    try {
        // 1. Fetch Quran Data (Local)
        await updateProgress(10, 'status_fetching');
        const dataDir = path.join(process.cwd(), 'data');
        const arabicPath = path.join(dataDir, 'text', 'quran-arabic.json');
        const englishPath = path.join(dataDir, 'text', 'quran-en.json');

        if (!fs.existsSync(arabicPath) || !fs.existsSync(englishPath)) {
            throw new Error(`Local text data missing. Please run the download scripts.`);
        }

        const arabicData = JSON.parse(fs.readFileSync(arabicPath, 'utf8'));
        const englishData = JSON.parse(fs.readFileSync(englishPath, 'utf8'));

        const arabicSurah = arabicData.surahs.find(s => s.number === parseInt(surah));
        const englishSurah = englishData.surahs.find(s => s.number === parseInt(surah));

        if (!arabicSurah || !englishSurah) {
            throw new Error("Surah not found in local data");
        }

        const ayahs = [];
        for (let i = 0; i < arabicSurah.ayahs.length; i++) {
            const num = arabicSurah.ayahs[i].numberInSurah;
            if (num >= ayah_start && num <= ayah_end) {
                // Compute local audio path: data/audio/[reciter_id]/[surah][ayah].mp3
                const audioFilename = `${String(surah).padStart(3, '0')}${String(num).padStart(3, '0')}.mp3`;
                const audioLocalPath = path.join(dataDir, 'audio', reciter_id, audioFilename);
                const audioFallbackUrl = `https://everyayah.com/data/${reciter_id}/${audioFilename}`;
                
                ayahs.push({
                    number: num,
                    arabic: arabicSurah.ayahs[i].text,
                    english: englishSurah.ayahs[i].text,
                    audioPath: audioLocalPath,
                    audioFallbackUrl: audioFallbackUrl
                });
            }
        }

        // 2. Prepare Background
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
                fs.copyFileSync(background_url, bgPath);
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

        const requestedRes = parseInt(resolution);
        let width, height;
        
        if (platform === 'reel') {
            width = requestedRes;
            height = Math.floor(width * (16 / 9));
        } else {
            height = requestedRes;
            width = Math.floor(height * (16 / 9));
        }

        width = width - (width % 2);
        height = height - (height % 2);

        await updateProgress(30, 'status_processing_audio');

        const MAX_DURATION = 180; // 3 minutes
        for (const ayah of ayahs) {
            if (!fs.existsSync(ayah.audioPath)) {
                // Cache miss - fallback to downloading and storing it in the persistent data volume permanently
                console.log(`[Cache Miss] Local audio missing for Ayah ${ayah.number}. Downloading...`);
                
                // Ensure the directory exists first
                const targetDir = path.dirname(ayah.audioPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                const dlSuccess = await downloadFile(ayah.audioFallbackUrl, ayah.audioPath);
                if (!dlSuccess || !fs.existsSync(ayah.audioPath)) {
                    throw new Error(`Failed to fallback download audio for Ayah ${ayah.number}. Path: ${ayah.audioPath}`);
                }
            }

            ayah.duration = await getMediaDuration(ayah.audioPath);
            
            ayah.startTime = totalDuration;
            totalDuration += ayah.duration;

            if (totalDuration > MAX_DURATION) {
                throw new Error(`error_duration_limit|${Math.floor(totalDuration)}`);
            }

            const subFilename = `sub_${ayah.number}.png`;
            const subPath = path.join(tempDir, subFilename);
            const baseSize = Math.min(width, height);
            
            await createSubtitleImage(ayah.arabic, ayah.english, subPath, {
                width: width,
                height: height,
                arabicFontPath: path.join(process.cwd(), 'fonts/Nabi.ttf'),
                englishFontPath: path.join(process.cwd(), 'fonts/arial.ttf'),
                arabicFontSize: baseSize * 0.08,
                englishFontSize: baseSize * 0.045
            });
            ayah.subPath = subPath;

            audioPaths.push(ayah.audioPath);
            subtitleImages.push({ path: ayah.subPath, start: ayah.startTime, end: ayah.startTime + ayah.duration });
        }

        // 2.5 Generate Outro Assets
        // Use local outro audio: Surah Muzammil (73), Ayah 4
        const localOutroAudioPath = path.join(dataDir, 'audio', reciter_id, '073004.mp3');
        let hasOutroAudio = false;
        let outroDuration = 5;

        if (!fs.existsSync(localOutroAudioPath)) {
             console.log(`[Cache Miss] Local outro audio missing. Downloading...`);
             const targetDir = path.dirname(localOutroAudioPath);
             if (!fs.existsSync(targetDir)) {
                 fs.mkdirSync(targetDir, { recursive: true });
             }
             const fallbackUrl = `https://everyayah.com/data/${reciter_id}/073004.mp3`;
             await downloadFile(fallbackUrl, localOutroAudioPath);
        }

        if (fs.existsSync(localOutroAudioPath)) {
            hasOutroAudio = true;
            outroDuration = await getMediaDuration(localOutroAudioPath);
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
            // 2.7 FFmpeg Assembly
            const command = ffmpeg();
            
            // Loop the background video infinitely if it's shorter than the audio
            // Added -an to strictly discard any background audio stream, preventing FFmpeg buffer deadlocks on loop!
            command.input(bgPath).inputOptions(['-stream_loop', '-1', '-an']);

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
                command.input(localOutroAudioPath);
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
            // Use Lanczos for high-quality scaling and setsar=1 to ensure proper aspect ratio
            filter.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,trim=duration=${totalDuration},drawtext=fontfile='${fontFileStr}':text='${urlTextEscaped}':fontcolor=white@0.7:fontsize=${Math.floor(width * 0.035)}:x=w-tw-20:y=h-th-20,fade=t=out:st=${fadeOutStart}:d=0.5:color=black[bg]`);

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
                    '-preset', 'medium',
                    '-crf', '18',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-s', `${width}x${height}`,
                    '-threads', '4'
                ])
                .output(outputPath)
                .on('progress', async (progress) => {
                    // Manual time-based progress calculation: 50% + (current_time / total_duration * 50%)
                    let p = 75;
                    if (progress.timemark && totalDuration > 0) {
                        const parts = progress.timemark.split(':');
                        const seconds = (+parts[0]) * 60 * 60 + (+parts[1]) * 60 + (+parts[2]);
                        p = 50 + Math.min(49, (seconds / (totalDuration + outroDuration)) * 50);
                    }
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
                        sendCompletionNotification(requestId, subscription, language);

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
