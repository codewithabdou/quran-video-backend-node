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
import { buildRenderPlan, distributeAudioDurations, renderScreenToBuffer } from './renderPlan.js';
import quranRepository from './quranRepository.js';
import { getEveryAyahReciterFolder } from '../constants/reciters.js';
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
 * Ensures Quran text data exists locally. Downloads if missing.
 */
const ensureQuranData = async () => {
    const dataDir = path.join(process.cwd(), 'data');
    const textDir = path.join(dataDir, 'text');
    
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(textDir)) fs.mkdirSync(textDir, { recursive: true });

    const arabicPath = path.join(textDir, 'quran-arabic.json');
    const englishPath = path.join(textDir, 'quran-en.json');

    if (!fs.existsSync(arabicPath)) {
        console.log('[VideoService] Cache Miss: Arabic text missing. Downloading from AlQuran.cloud...');
        const res = await axios.get('http://api.alquran.cloud/v1/quran/quran-simple');
        fs.writeFileSync(arabicPath, JSON.stringify(res.data.data, null, 2));
        console.log('[VideoService] Arabic text downloaded successfully.');
    }

    if (!fs.existsSync(englishPath)) {
        console.log('[VideoService] Cache Miss: English text missing. Downloading en.sahih from AlQuran.cloud...');
        const res = await axios.get('http://api.alquran.cloud/v1/quran/en.sahih');
        fs.writeFileSync(englishPath, JSON.stringify(res.data.data, null, 2));
        console.log('[VideoService] English text downloaded successfully.');
    }

    return { arabicPath, englishPath };
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
        // 1. Build and verify Render Plan
        await updateProgress(10, 'status_fetching');
        const plan = buildRenderPlan({
            surah: parseInt(surah, 10),
            ayahStart: parseInt(ayah_start, 10),
            ayahEnd: parseInt(ayah_end, 10),
            platform,
            resolution: parseInt(resolution, 10) || 720,
            textMode: data.text_mode || 'bilingual',
            reciterId: reciter_id,
            timingOverrides: data.timing_overrides || {},
        });

        const dataDir = path.join(process.cwd(), 'data');
        const rawAyahs = quranRepository.getAyahRange(surah, ayah_start, ayah_end);
        const reciterFolder = getEveryAyahReciterFolder(reciter_id);
        const ayahs = rawAyahs.map(a => {
            const num = a.numberInSurah;
            const audioFilename = `${String(surah).padStart(3, '0')}${String(num).padStart(3, '0')}.mp3`;
            const audioLocalPath = path.join(dataDir, 'audio', reciter_id, audioFilename);
            const audioFallbackUrl = `https://everyayah.com/data/${reciterFolder}/${audioFilename}`;
            const secondaryFallbackUrl = `https://cdn.islamic.network/quran/audio/128/${reciter_id}/${a.number}.mp3`;
            return {
                number: num,
                globalNumber: a.number,
                arabic: a.arabic,
                english: a.english,
                audioPath: audioLocalPath,
                audioFallbackUrl,
                secondaryFallbackUrl,
            };
        });

        console.log(`[VideoService] Preparing background: ${background_url || 'default'}`);
        // 2. Prepare Background
        const bgPath = path.join(tempDir, 'background.mp4');
        const uploadDir = path.join(process.cwd(), 'uploads');

        const useSmartFallback = () => {
            if (fs.existsSync(uploadDir)) {
                const files = fs.readdirSync(uploadDir).filter(f => f.endsWith('.mp4'));
                if (files.length > 0) {
                    const randomFile = files[Math.floor(Math.random() * files.length)];
                    const fallbackPath = path.join(uploadDir, randomFile);
                    console.log(`[Smart Fallback] Using random cached video as fallback: ${randomFile}`);
                    fs.copyFileSync(fallbackPath, bgPath);
                    return true;
                }
            }
            return false;
        };

        if (background_url === 'default' || !background_url) {
            if (!useSmartFallback()) {
                throw new Error('No background videos available in cache for fallback.');
            }
        } else if (background_url.startsWith('http://') || background_url.startsWith('https://')) {
            // It's an external URL, attempt standard download
            const bgDownloaded = await downloadFile(background_url, bgPath);
            if (!bgDownloaded || !fs.existsSync(bgPath)) {
                if (!useSmartFallback()) {
                    throw new Error('Background download failed and no local cache available for fallback.');
                }
            }
        } else {
            // It's a local file path (e.g., from the /upload-background endpoint / cache)
            if (fs.existsSync(background_url)) {
                fs.copyFileSync(background_url, bgPath);
            } else {
                console.warn(`[VideoService] Local background ${background_url} not found. Triggering smart fallback...`);
                if (!useSmartFallback()) {
                    throw new Error(`Requested background not found and no local cache available for fallback.`);
                }
            }
        }

        const audioPaths = [];
        const ayahDurations = {};
        let totalDuration = 0;
        console.log(`[VideoService] Processing ${ayahs.length} ayahs...`);

        const requestedRes = parseInt(resolution, 10) || 720;
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
                console.log(`[VideoService] Local audio missing for Ayah ${surah}:${ayah.number}. Downloading...`);
                
                const targetDir = path.dirname(ayah.audioPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                let dlSuccess = false;
                try {
                    dlSuccess = await downloadFile(ayah.audioFallbackUrl, ayah.audioPath);
                } catch (dlErr) {
                    console.warn(`[VideoService] EveryAyah download failed for Ayah ${ayah.number}: ${dlErr.message}. Trying CDN...`);
                }

                if (!dlSuccess || !fs.existsSync(ayah.audioPath)) {
                    if (ayah.secondaryFallbackUrl) {
                        try {
                            console.log(`[VideoService] Downloading from CDN fallback: ${ayah.secondaryFallbackUrl}`);
                            dlSuccess = await downloadFile(ayah.secondaryFallbackUrl, ayah.audioPath);
                        } catch (cdnErr) {
                            console.error(`[VideoService] CDN fallback also failed: ${cdnErr.message}`);
                        }
                    }
                }

                if (!dlSuccess || !fs.existsSync(ayah.audioPath)) {
                    // Try AlQuran cloud API as last resort
                    try {
                        const ayahRes = await axios.get(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah.number}/${reciter_id}`);
                        const officialAudioUrl = ayahRes.data?.data?.audio;
                        if (officialAudioUrl) {
                            dlSuccess = await downloadFile(officialAudioUrl, ayah.audioPath);
                        }
                    } catch (_) {}
                }

                if (!dlSuccess || !fs.existsSync(ayah.audioPath)) {
                    throw new Error(`Could not fetch audio for Ayah ${surah}:${ayah.number}. Please check your connection or reciter ID.`);
                }
            }

            ayah.duration = await getMediaDuration(ayah.audioPath);
            console.log(`[VideoService] Ayah ${ayah.number} duration: ${ayah.duration}s`);
            ayah.startTime = totalDuration;
            ayahDurations[ayah.number] = ayah.duration;
            totalDuration += ayah.duration;
            audioPaths.push(ayah.audioPath);

            if (totalDuration > MAX_DURATION) {
                throw new Error(`error_duration_limit|${Math.floor(totalDuration)}`);
            }
        }

        // Distribute audio durations across planned screens
        const timedPlan = distributeAudioDurations(plan, ayahDurations, data.timing_overrides || {});

        // Strict Plan Hash Verification (if provided by client)
        // Accepts either the initial layout planHash or the finalized timedPlan planHash
        if (data.plan_hash && data.plan_hash !== plan.planHash && data.plan_hash !== timedPlan.planHash) {
            console.warn(`[VideoService] Plan hash mismatch: client provided ${data.plan_hash}, expected initial ${plan.planHash} or timed ${timedPlan.planHash}`);
            const err = new Error('Plan changed or expired. Please refresh preview.');
            err.code = 'PLAN_CHANGED';
            err.status = 409;
            throw err;
        }

        const subtitleImages = [];

        await updateProgress(40, 'status_subtitles');
        for (const screen of timedPlan.screens) {
            const subFilename = `sub_${screen.id.replace(/:/g, '_')}.png`;
            const subPath = path.join(tempDir, subFilename);

            const subBuffer = await renderScreenToBuffer(screen, {
                width,
                height,
                platform,
                resolution: requestedRes,
            });
            fs.writeFileSync(subPath, subBuffer);

            subtitleImages.push({
                path: subPath,
                start: screen.startMs / 1000,
                end: screen.endMs / 1000,
            });
        }


        // 2.5 Generate Outro Assets
        // Use local outro audio: Surah Muzammil (73), Ayah 4 (global ayah #5479)
        const localOutroAudioPath = path.join(dataDir, 'audio', reciter_id, '073004.mp3');
        let hasOutroAudio = false;
        let outroDuration = 5;

        if (!fs.existsSync(localOutroAudioPath)) {
             console.log(`[Cache Miss] Local outro audio missing (Surah 73:4). Fetching official URL...`);
             try {
                const outroRes = await axios.get(`http://api.alquran.cloud/v1/ayah/73:4/${reciter_id}`);
                const officialOutroUrl = outroRes.data?.data?.audio;
                
                if (officialOutroUrl) {
                    const targetDir = path.dirname(localOutroAudioPath);
                    if (!fs.existsSync(targetDir)) {
                        fs.mkdirSync(targetDir, { recursive: true });
                    }
                    console.log(`[VideoService] Downloading outro audio from: ${officialOutroUrl}`);
                    await downloadFile(officialOutroUrl, localOutroAudioPath);
                }
             } catch (error) {
                // Secondary fallback: cdn.islamic.network
                const OUTRO_AYAH_GLOBAL = 5479;
                const fallbackUrl = `https://cdn.islamic.network/quran/audio/128/${reciter_id}/${OUTRO_AYAH_GLOBAL}.mp3`;
                try {
                    const targetDir = path.dirname(localOutroAudioPath);
                    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
                    await downloadFile(fallbackUrl, localOutroAudioPath);
                    console.log(`[Outro] Successfully downloaded outro audio from CDN fallback`);
                } catch (outroDownloadErr) {
                    console.warn(`[VideoService] Outro audio fallback failed: ${error.message}. Proceeding without outro audio.`);
                    if (fs.existsSync(localOutroAudioPath)) {
                        try { fs.unlinkSync(localOutroAudioPath); } catch (_) {}
                    }
                }
             }
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

        console.log(`[VideoService] Starting FFmpeg rendering for ${requestId}...`);
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
            filter.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1,fps=30,trim=duration=${totalDuration},drawtext=fontfile='${fontFileStr}':text='${urlTextEscaped}':fontcolor=white@0.7:fontsize=${Math.floor(width * 0.035)}:x=w-tw-20:y=h-th-20,fade=t=out:st=${fadeOutStart}:d=0.5:color=black[bg]`);

            let currentVideoLabel = '[bg]';
            subtitleImages.forEach((img, i) => {
                const nextLabel = `[v${i}]`;
                filter.push(`${currentVideoLabel}[${imageInputsStart + i}:v]overlay=0:0:enable='between(t,${img.start},${img.end})'${i === subtitleImages.length - 1 ? '[mainv]' : nextLabel}`);
                if (i !== subtitleImages.length - 1) currentVideoLabel = nextLabel;
            });
            if (subtitleImages.length === 0) filter.push(`${currentVideoLabel}[mainv]`);

            // Outro Logic
            filter.push(`color=c=black:s=${width}x${height}:d=${outroDuration},fps=30[black_bg]`);
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
                    '-preset', 'veryfast',
                    '-crf', '22',
                    '-r', '30',
                    '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-ar', '44100',
                    '-threads', '2'
                ])
                .output(outputPath)
                .on('stderr', (line) => {
                    if (line.includes('frame=')) {
                        console.log(`FFmpeg Progress: ${line.trim()}`);
                    }
                })
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

export const getMediaDuration = (path) => {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`ffprobe timeout for ${path}`));
        }, 20000); // 20 second timeout

        ffmpeg.ffprobe(path, (err, metadata) => {
            clearTimeout(timeout);
            if (err) reject(err);
            else resolve(metadata.format.duration);
        });
    });
};

