import { describe, it, expect } from '@jest/globals';
import { downloadFile, cleanupTempDir } from '../fileOps.js';
import path from 'path';

describe('fileOps utilities', () => {
    describe('module exports', () => {
        it('should export downloadFile function', () => {
            expect(downloadFile).toBeDefined();
            expect(typeof downloadFile).toBe('function');
        });

        it('should export cleanupTempDir function', () => {
            expect(cleanupTempDir).toBeDefined();
            expect(typeof cleanupTempDir).toBe('function');
        });
    });

    describe('cleanupTempDir', () => {
        it('should handle non-existent directory gracefully', async () => {
            const nonExistentDir = path.join(process.cwd(), 'non-existent-test-dir-' + Date.now());

            await expect(cleanupTempDir(nonExistentDir)).resolves.not.toThrow();
        });
    });
});
