import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { downloadFile, cleanupTempDir } from '../utils/fileOps.js';
import { createSubtitleImage } from '../utils/textGen.js';

// In-memory store for progress (Production should use Redis)
const progressStore = new Map();

export const progressStream = (req, res) => {
    const { requestId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendUpdate = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Check store periodically
    const interval = setInterval(() => {
        const data = progressStore.get(requestId);
        if (data) {
            sendUpdate(data);
            if (data.status === 'completed' || data.error) {
                clearInterval(interval);
                progressStore.delete(requestId);
                res.end();
            }
        }
    }, 500);

    req.on('close', () => {
        clearInterval(interval);
    });
};

export const generateVideoEndpoint = async (req, res) => {
    const requestData = req.body;
    const requestId = requestData.request_id || uuidv4();

    // Initial response to acknowledge start
    if (progressStore.has(requestId)) {
        const current = progressStore.get(requestId);
        if (current.status !== 'completed' && !current.error) {
            console.log(`Request ${requestId} already in progress. Ignoring duplicate.`);
            return res.status(202).json({ message: "Already processing", requestId });
        }
    }

    progressStore.set(requestId, { status: "starting", percentage: 0 });

    // Start processing (awaited below)

    // If client provided ID, they listen to SSE. If not, we could wait, but SSE is preferred pattern here.
    // For compatibility with Python API which returns file directly, we might need to wait?
    // Python API: "waits for completion" OR "returns file".
    // Actually the python endpoint `await loop.run_in_executor` connects it synchronously-ish.
    // BUT the python code returns `FileResponse`.

    // To match Python API behavior exactly:
    // We must await generation and return the file. 
    // AND update progress for SSE side-channel.

    try {
        const videoPath = await generateVideo(requestData, requestId);
        res.download(videoPath, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            // Cleanup output file after sending
            try {
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                console.log(`Deleted output file: ${videoPath}`);
            } catch (cleanupErr) {
                console.error("Failed to delete output file:", cleanupErr);
            }
        });
    } catch (error) {
        console.error("Generation Failed:", error);
        progressStore.set(requestId, { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

const generateVideo = async (data, requestId) => {
    const { surah, ayah_start, ayah_end, reciter_id, translation_id, background_url, resolution = 720, platform = 'reel' } = data;
    const updateProgress = (p, msg) => progressStore.set(requestId, { status: msg, percentage: p });

    updateProgress(5, 'status_starting');

    const tempDir = path.join(process.cwd(), 'temp', requestId);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    try {
        // 1. Fetch Quran Data
        updateProgress(10, 'status_fetching');
        const quranUrl = `http://api.alquran.cloud/v1/surah/${surah}/editions/${reciter_id},${translation_id}`;
        console.log(`Fetching Quran Data from: ${quranUrl}`);
        console.log(`Looking for Reciter: ${reciter_id}, Translation: ${translation_id}`);

        const response = await axios.get(quranUrl);
        const editions = response.data.data;

        // Locate editions
        const arabicEdition = editions.find(e => e.edition.identifier === reciter_id);
        const englishEdition = editions.find(e => e.edition.identifier === translation_id);

        if (!arabicEdition || !englishEdition) {
            console.error("Editions not found in response.");
            console.error("Requested Reciter:", reciter_id);
            console.error("Requested Translation:", translation_id);
            console.error("Available Editions:", editions.map(e => e.edition.identifier));
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
        await downloadFile(background_url, bgPath);

        const audioPaths = [];
        const subtitleImages = [];
        let totalDuration = 0;

        // Settings for Canvas
        const targetWidth = resolution;
        const targetHeight = platform === 'reel' ? Math.floor(resolution * (16 / 9)) : Math.floor(resolution * (9 / 16));
        // Ensure even dimensions
        const width = targetWidth - (targetWidth % 2);
        const height = targetHeight - (targetHeight % 2);

        // Download Audio & Generate Subs
        updateProgress(30, 'status_processing_audio');

        // We need audio duration to time subtitles. fluent-ffmpeg requires probing or we assume download is MP3.
        // We will probe each audio file.

        for (const ayah of ayahs) {
            const audioFilename = `audio_${ayah.number}.mp3`;
            const audioPath = path.join(tempDir, audioFilename);
            const dlSuccess = await downloadFile(ayah.audio, audioPath);
            if (!dlSuccess) throw new Error(`Failed to download audio for ayah ${ayah.number}`);
            audioPaths.push(audioPath);

            // Probe duration
            const duration = await getMediaDuration(audioPath);
            console.log(`Audio ${audioFilename} duration: ${duration}`);
            ayah.duration = duration;
            ayah.startTime = totalDuration;
            totalDuration += duration;

            // Generate Subtitle Image
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

        // 3. Composition with FFmpeg
        updateProgress(50, 'status_rendering');
        const outputPath = path.join(process.cwd(), 'outputs', `video_${requestId}.mp4`);

        return new Promise((resolve, reject) => {
            const command = ffmpeg();

            // Input 0: Background (looped)
            command.input(bgPath).inputOptions(['-stream_loop', '-1']);

            // Input 1..N: Audio files (we will concat them using complex filter)
            // Strategy: Create a concat file list for audio to avoid complex filter limit?
            // Or just append inputs. For handful of ayahs, appending inputs is fine.

            // Actually, simpler to use the 'concat' protocol or just inputs
            // Let's use inputs for audio and mixing
            // Problem: -stream_loop applies to input before it.

            // Let's build the command carefully.

            // Input 0: Background
            // Input 1...N: Audio clips

            // We can pre-concat audio using ffmpeg to simplify the main pass if getting complex.
            // But let's try one pass.

            // 1. Concat all audio inputs into one stream [outa]
            // 2. Loop video input [0:v] and trim to duration of [outa]
            // 3. Overlay subtitle images at correct times.

            // Inputs
            // 0: bg
            // 1..N: audios
            // N+1..M: images

            let audioInputsStart = 1;
            audioPaths.forEach(ap => command.input(ap));

            let imageInputsStart = audioInputsStart + audioPaths.length;
            subtitleImages.forEach(img => command.input(img.path));

            // Complex Filter
            const filter = [];

            // Audio Concat
            const audioLabels = audioPaths.map((_, i) => `[${audioInputsStart + i}:a]`).join('');
            filter.push(`${audioLabels}concat=n=${audioPaths.length}:v=0:a=1[maina]`);

            // Video Loop & Scale & Crop
            // Scale and crop background to fit target
            // We'll just assume scale for now to keep it robust
            filter.push(`[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},trim=duration=${totalDuration}[bg]`);

            // Overlays
            // We can chain overlays: [bg][img1]overlay...[v1]; [v1][img2]overlay...
            let currentVideoLabel = '[bg]';

            subtitleImages.forEach((img, i) => {
                const nextLabel = `[v${i}]`;
                // enable='between(t,START,END)' to show image only during specific time
                filter.push(`${currentVideoLabel}[${imageInputsStart + i}:v]overlay=0:0:enable='between(t,${img.start},${img.end})'${i === subtitleImages.length - 1 ? '[outv]' : nextLabel}`);
                if (i !== subtitleImages.length - 1) currentVideoLabel = nextLabel;
            });

            if (subtitleImages.length === 0) {
                // No subtitles case (shouldnt happen)
                filter.push(`${currentVideoLabel}[outv]`);
            }

            command
                .complexFilter(filter)
                .outputOptions([
                    '-map', '[outv]',
                    '-map', '[maina]',
                    '-c:v', 'libx264',
                    '-c:a', 'aac',
                    '-pix_fmt', 'yuv420p', // Important for compatibility
                    '-shortest' // Stop when shortest stream ends (audio)
                ])
                .output(outputPath)
                .on('start', (cmd) => console.log('FFmpeg Command:', cmd))
                .on('progress', (progress) => {
                    // progress.percent is not always reliable with complex filters, but we try
                    const p = progress.percent ? Math.min(99, 50 + (progress.percent / 2)) : 75;
                    updateProgress(Math.floor(p), 'status_rendering');
                })
                .on('end', () => {
                    updateProgress(100, 'status_completed');
                    console.log("FFmpeg finished. Waiting before cleanup...");
                    setTimeout(async () => {
                        await cleanupTempDir(tempDir);
                        try { fs.rmdirSync(tempDir); } catch (e) {
                            console.error("Failed to remove temp dir:", e.message);
                        }
                        resolve(outputPath);
                    }, 1000); // Wait 1s and then retry loop starts
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
