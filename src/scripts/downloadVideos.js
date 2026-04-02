import fs from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
import { createClient } from 'pexels';

// Load environment variables locally
dotenv.config();

// Ensure the directory is correct based on where it's executed
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const FALLBACK_DIR = path.join(process.cwd(), 'fallback video');

// Setup HTTPS agent for downloading large files smoothly
const agent = new https.Agent({ keepAlive: true });

// Fixed video IDs (same as in backgroundsController.js)
const VIDEO_IDS = [
    6527132,
    4600287,
    4778336,
    5006168,
    6889380,
    11025478
];

async function ensureDirs() {
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
}

async function downloadPexelsVideos() {
    console.log('[1/1] Fetching Pexels Background Videos...');
    
    const apiKey = process.env.PEXELS_API_KEY;
    if (!apiKey) {
        console.error('❌ Error: PEXELS_API_KEY is not defined in your .env file!');
        process.exit(1);
    }
    
    const pexelsClient = createClient(apiKey);
    let downloadedCount = 0;
    
    for (const videoId of VIDEO_IDS) {
        const filePath = path.join(UPLOADS_DIR, `pexels_${videoId}.mp4`);
        const fallbackPath = path.join(FALLBACK_DIR, `pexels_${videoId}.mp4`);
        
        console.log(`\n      ▶️ Fetching metadata for Video ID: ${videoId}...`);
        
        let retries = 3;
        let success = false;
        
        while (retries > 0 && !success) {
            try {
                const videoData = await pexelsClient.videos.show({ id: videoId });
                
                if (!videoData || !videoData.video_files || videoData.video_files.length === 0) {
                    console.error(`      ❌ Error: Video ID ${videoId} returned no video files. It might be deleted or unavailable.`);
                    break;
                }
                
                let fileCount = 0;
                for (const file of videoData.video_files) {
                    // Unique name for each quality
                    const qualityFileName = `pexels_${videoId}_${file.quality}_${file.width}x${file.height}.mp4`;
                    const qualityFilePath = path.join(UPLOADS_DIR, qualityFileName);
                    
                    if (!fs.existsSync(qualityFilePath)) {
                        console.log(`      ⬇️ Downloading ${videoId} (Quality: ${file.quality}, ${file.width}x${file.height})...`);
                        
                        const response = await axios({
                            method: 'GET',
                            url: file.link,
                            responseType: 'stream',
                            httpsAgent: agent
                        });

                        const writer = fs.createWriteStream(qualityFilePath);
                        response.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });
                        console.log(`      ✅ Successfully downloaded ${qualityFileName}!`);
                        fileCount++;
                    } else {
                         console.log(`      ✅ ${qualityFileName} already exists. Skipping...`);
                    }
                    
                    // Maintain the primary default file for the existing backend /check-background cache
                    // Prefer setting HD as the default if it's currently processing it, or if the default doesn't exist yet
                    if ((file.quality === 'hd' && !fs.existsSync(filePath)) || (!fs.existsSync(filePath))) {
                        fs.copyFileSync(qualityFilePath, filePath);
                        console.log(`      ✅ Set ${qualityFileName} as the primary default backgrond (pexels_${videoId}.mp4).`);
                    }
                }
                
                downloadedCount += fileCount;
                success = true;
                
            } catch (e) {
                retries--;
                if (retries === 0) {
                    console.error(`      ❌ Failed to download Video ID ${videoId}: ${e.message}`);
                } else {
                    console.log(`      ⚠️ Error fetching ${videoId}. Retrying in 2 seconds... (${retries} retries left). Error: ${e.message}`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
    }
    
    console.log(`\n🎉 Completed! Downloaded ${downloadedCount} new video(s).`);
}

async function main() {
    console.log('--- Quran Video Backgrounds Ingestion Script ---\n');
    await ensureDirs();
    await downloadPexelsVideos();
    console.log('\n✅ All video backgrounds processed successfully!');
}

main().catch(console.error);
