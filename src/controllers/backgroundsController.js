import { createClient } from 'pexels';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fixed video IDs - using only 6 to minimize API calls
const VIDEO_IDS = [
    6527132,
    4600287,
    4778336,
    5006168,
    6889380,
    11025478
];

// Cache file path
const CACHE_FILE = path.join(__dirname, '../constants/pexels_videos_cache.json');

/**
 * Load videos from cache file
 */
const loadFromCache = () => {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = fs.readFileSync(CACHE_FILE, 'utf-8');
            const cache = JSON.parse(data);
            console.log('Loaded Pexels videos from cache');
            return cache.videos;
        }
    } catch (err) {
        console.error('Error loading cache:', err.message);
    }
    return null;
};

/**
 * Save videos to cache file
 */
const saveToCache = (videos) => {
    try {
        const cacheDir = path.dirname(CACHE_FILE);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }

        const cache = {
            videos,
            cachedAt: new Date().toISOString(),
            count: videos.length
        };

        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        console.log('Saved Pexels videos to cache');
    } catch (err) {
        console.error('Error saving cache:', err.message);
    }
};

/**
 * Get background videos from Pexels
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
export const getBackgroundVideos = async (req, res) => {
    try {
        // Try to load from cache first
        const cachedVideos = loadFromCache();
        if (cachedVideos && cachedVideos.length > 0) {
            return res.json({
                videos: cachedVideos,
                count: cachedVideos.length,
                source: 'cache'
            });
        }

        // If no cache, fetch from API
        const apiKey = process.env.PEXELS_API_KEY;

        if (!apiKey) {
            return res.status(200).json({
                videos: [],
                count: 0,
                message: 'Pexels API key not configured. Using default backgrounds.'
            });
        }

        const client = createClient(apiKey);

        // Fetch videos by ID (minimal API calls)
        const promises = VIDEO_IDS.map(async (id) => {
            try {
                const video = await client.videos.show({ id });
                return video;
            } catch (err) {
                console.error(`Error fetching Pexels video ${id}:`, err.message);
                return null;
            }
        });

        const results = await Promise.all(promises);
        const validVideos = results.filter(v => v !== null);

        // Save to cache if we got videos
        if (validVideos.length > 0) {
            saveToCache(validVideos);
        }

        res.json({
            videos: validVideos,
            count: validVideos.length,
            source: 'api',
            message: validVideos.length === 0 ? 'No videos available. Using default backgrounds.' : undefined
        });

    } catch (error) {
        console.error('Error fetching background videos:', error);

        // Try cache as fallback on error
        const cachedVideos = loadFromCache();
        if (cachedVideos && cachedVideos.length > 0) {
            return res.json({
                videos: cachedVideos,
                count: cachedVideos.length,
                source: 'cache-fallback'
            });
        }

        res.status(200).json({
            videos: [],
            count: 0,
            message: 'Failed to load backgrounds. Using default backgrounds.'
        });
    }
};
