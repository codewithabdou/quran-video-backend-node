import fs from 'fs';
import path from 'path';
import axios from 'axios';
import https from 'https';

const DATA_DIR = path.join(process.cwd(), 'data');
const TEXT_DIR = path.join(DATA_DIR, 'text');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');

// Setup HTTPS agent for downloading large files smoothly
const agent = new https.Agent({ keepAlive: true });

// Supported platforms configurations mapping to backend definitions
const DEFAULT_TRANSLATION = 'en.sahih';
const SUPPORTED_RECITERS = [
    "ar.alafasy",
    "ar.abdulbasitmurattal",
    "ar.abdullahbasfar",
    "ar.abdurrahmaansudais",
    "ar.abdulsamad",
    "ar.shaatree",
    "ar.ahmedajamy",
    "ar.hanirifai",
    "ar.husary",
    "ar.husarymujawwad",
    "ar.hudhaify",
    "ar.ibrahimakhbar",
    "ar.mahermuaiqly",
    "ar.muhammadayyoub",
    "ar.muhammadjibreel",
    "ar.saoodshuraym",
    "ar.parhizgar",
    "ar.aymanswoaid"
];

async function ensureDirs() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    if (!fs.existsSync(TEXT_DIR)) fs.mkdirSync(TEXT_DIR);
    if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
}

async function fetchText() {
    console.log('[1/2] Fetching Quran text...');
    
    // Fetch Arabic Text
    const arabicPath = path.join(TEXT_DIR, 'quran-arabic.json');
    if (!fs.existsSync(arabicPath)) {
        console.log('      Downloading Arabic text (quran-simple)...');
        const res = await axios.get('http://api.alquran.cloud/v1/quran/quran-simple');
        fs.writeFileSync(arabicPath, JSON.stringify(res.data.data, null, 2));
    } else {
        console.log('      Arabic text already exists.');
    }

    // Fetch English Translation
    const englishPath = path.join(TEXT_DIR, 'quran-en.json');
    if (!fs.existsSync(englishPath)) {
        console.log('      Downloading English translation (en.sahih)...');
        const res = await axios.get(`http://api.alquran.cloud/v1/quran/${DEFAULT_TRANSLATION}`);
        fs.writeFileSync(englishPath, JSON.stringify(res.data.data, null, 2));
    } else {
        console.log('      English translation already exists.');
    }
}

async function fetchAudioForReciter(reciterId) {
    const reciterDir = path.join(AUDIO_DIR, reciterId);
    if (!fs.existsSync(reciterDir)) fs.mkdirSync(reciterDir);

    console.log(`\n[2/2] Fetching Audio for reciter: ${reciterId}`);
    
    // To get standard formatting, we download directly from EveryAyah which holds the structure:
    // https://everyayah.com/data/ar.alafasy_128kbps/001001.mp3
    // We'll use the API first to get exact URLs, but fallback to direct URL generation.

    const res = await axios.get(`http://api.alquran.cloud/v1/quran/${reciterId}`);
    const surahs = res.data.data.surahs;

    let totalAyahs = 0;
    let downloadedCount = 0;
    
    surahs.forEach(s => totalAyahs += s.ayahs.length);
    console.log(`      Total Ayahs to check: ${totalAyahs}`);

    for (const surah of surahs) {
        for (const ayah of surah.ayahs) {
            const numInSurah = ayah.numberInSurah;
            const filename = `${String(surah.number).padStart(3, '0')}${String(numInSurah).padStart(3, '0')}.mp3`;
            const filePath = path.join(reciterDir, filename);

            if (fs.existsSync(filePath)) {
                // File exists, skip
                continue;
            }

            // Retry logic
            let retries = 3;
            while (retries > 0) {
                try {
                    const audioUrl = ayah.audio || `https://everyayah.com/data/${reciterId}/${filename}`;
                    const response = await axios({
                        method: 'GET',
                        url: audioUrl,
                        responseType: 'stream',
                        httpsAgent: agent
                    });

                    const writer = fs.createWriteStream(filePath);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    downloadedCount++;
                    if (downloadedCount % 100 === 0) {
                        console.log(`      Progress: ${downloadedCount} / ${totalAyahs}`);
                    }
                    break; // Success
                } catch (e) {
                    retries--;
                    if (retries === 0) {
                        console.error(`      Failed to download ${filename}: ${e.message}`);
                    } else {
                        await new Promise(r => setTimeout(r, 1000)); // wait 1s before retry
                    }
                }
            }
        }
    }
    console.log(`      Completed ${reciterId}. Downloaded ${downloadedCount} new files.`);
}

async function main() {
    console.log('--- Quran Assets Ingestion Script ---');
    await ensureDirs();
    await fetchText();
    
    for (const reciter of SUPPORTED_RECITERS) {
        await fetchAudioForReciter(reciter);
    }
    
    console.log('\n✅ All assets downloaded successfully!');
}

main().catch(console.error);
