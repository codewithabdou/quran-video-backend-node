import fs from 'fs';
import axios from 'axios';
import path from 'path';

export const downloadFile = async (url, destination) => {
    const writer = fs.createWriteStream(destination);

    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                writer.close(); // Ensure it's closed
                writer.destroy(); // Destroy stream to release resources
                resolve(true);
            });
            writer.on('error', (err) => {
                writer.close();
                writer.destroy();
                fs.unlink(destination, () => { }); // Async unlink to avoid blocking
                reject(err);
            });
        });
    } catch (error) {
        writer.close();
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
        console.error(`Error downloading file from ${url}:`, error.message);
        return false;
    }
};

export const cleanupTempDir = async (dir) => {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);

    // Helper to delete with retry
    const deleteWithRetry = async (filePath, retries = 5, delay = 1000) => {
        for (let i = 0; i < retries; i++) {
            try {
                if (fs.existsSync(filePath)) {
                    await fs.promises.unlink(filePath);
                }
                return true;
            } catch (err) {
                if (err.code === 'EBUSY' || err.code === 'EPERM') {
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`Failed to delete ${filePath}:`, err.message);
                    return false;
                }
            }
        }
        console.error(`Gave up deleting ${filePath} after ${retries} retries`);
        return false;
    };

    const deletePromises = files.map(file => {
        const curPath = path.join(dir, file);
        if (fs.statSync(curPath).isFile()) {
            return deleteWithRetry(curPath);
        }
        return Promise.resolve();
    });

    await Promise.all(deletePromises);
};
