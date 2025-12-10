import { generateVideo, getProgress, subscribeToProgress } from '../services/videoService.js';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export const generateVideoEndpoint = async (req, res) => {
    const requestData = req.body;
    const requestId = requestData.request_id || uuidv4();

    // Check if request is already in progress (handled in service or controller? preferably service state check, but controller can do it too)
    // For now, delegating check to service or keeping logic here? 
    // The original logic checked `progressStore`. We should expose a way to check status.

    // Actually, good practice: Controller handles HTTP, Service handles Business Logic. 
    // Checking "is this ID already running" is somewhat business logic.
    // Let's call startGeneration(data, requestId) on service.

    try {
        const result = await generateVideo(requestData, requestId);

        // If result is 'already_processing', return 202
        if (result.status === 'already_processing') {
            return res.status(202).json({ message: "Already processing", requestId });
        }

        // If we await completion (original behavior):
        const videoPath = result.path;

        res.download(videoPath, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            // Cleanup
            try {
                if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
                console.log(`Deleted output file: ${videoPath}`);
            } catch (cleanupErr) {
                console.error("Failed to delete output file:", cleanupErr);
            }
        });

    } catch (error) {
        console.error("Generation Failed:", error);
        res.status(500).json({ error: error.message });
    }
};

export const getProgressStream = (req, res) => {
    const { requestId } = req.params;

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    getProgress(requestId, (data, isComplete) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (isComplete) {
            res.end();
        }
    }, req); // Pass req to handle close event inside? Or handle close here?

    // Better: getProgress returns an event emitter or we pass a callback?
    // Let's adapt the original logic: it used setInterval.
    // We'll keep the interval logic in the controller for now or move it to service helper.
    // Ideally, service provides a way to "listen".
    // For simplicity of refactor, let's keep SSE logic here but query service for state.

    // ... Revised getProgressStream below ...
};

export const subscribe = (req, res) => {
    const { requestId, subscription } = req.body;
    subscribeToProgress(requestId, subscription);
    res.status(201).json({ message: "Subscribed successfully" });
};
