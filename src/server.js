import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Create temp directories if they don't exist
const tempDir = path.join(process.cwd(), 'temp');
const outputDir = path.join(process.cwd(), 'outputs');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

app.use('/api/v1', apiRoutes);

app.get('/', (req, res) => {
    res.json({ message: "Welcome to Quran Video Generator API (Node.js). Use POST /api/v1/generate-video" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
