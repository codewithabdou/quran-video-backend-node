import { describe, it, expect } from '@jest/globals';

// Simple utility tests that don't require complex mocking
describe('textGen module', () => {
    it('should export createSubtitleImage function', async () => {
        const textGen = await import('../textGen.js');
        expect(textGen.createSubtitleImage).toBeDefined();
        expect(typeof textGen.createSubtitleImage).toBe('function');
    });
});

describe('text wrapping logic', () => {
    // Helper function to wrap text (simplified version for testing)
    function wrapText(text, maxChars) {
        const words = text.split(' ');
        let lines = [];
        let currentLine = words[0] || '';

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            if ((currentLine + ' ' + word).length <= maxChars) {
                currentLine += ' ' + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines;
    }

    it('should wrap text correctly when it exceeds max length', () => {
        const text = 'This is a long text that should be wrapped';
        const maxChars = 15;

        const result = wrapText(text, maxChars);

        expect(result.length).toBeGreaterThan(1);
        expect(result[0]).toBe('This is a long');
    });

    it('should not wrap short text', () => {
        const text = 'Short text';
        const maxChars = 50;

        const result = wrapText(text, maxChars);

        expect(result.length).toBe(1);
        expect(result[0]).toBe('Short text');
    });

    it('should handle single word', () => {
        const text = 'Word';
        const maxChars = 10;

        const result = wrapText(text, maxChars);

        expect(result.length).toBe(1);
        expect(result[0]).toBe('Word');
    });
});

