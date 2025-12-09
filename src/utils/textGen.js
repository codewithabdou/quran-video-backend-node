import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

// Helper to wrap text
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    let lines = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

export const createSubtitleImage = async (arabicText, englishText, outputPath, settings) => {
    const {
        width,
        height,
        arabicFontPath,
        englishFontPath,
        arabicFontSize,
        englishFontSize,
        arabicColor = 'white',
        englishColor = 'white'
    } = settings;

    // Register fonts (ensure paths are correct)
    console.log(`Registering Arabic Font from: ${arabicFontPath}`);
    if (fs.existsSync(arabicFontPath)) {
        registerFont(arabicFontPath, { family: 'Amiri' });
    } else {
        console.warn(`Arabic font not found at ${arabicFontPath}`);
    }

    console.log(`Registering English Font from: ${englishFontPath}`);
    if (fs.existsSync(englishFontPath)) {
        registerFont(englishFontPath, { family: 'Arial' });
    } else {
        console.warn(`English font not found at ${englishFontPath}`);
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Clear background (transparent)
    ctx.clearRect(0, 0, width, height);

    const margin = width * 0.05;
    const maxTextWidth = width - (2 * margin);
    const center = height / 2;

    // --- Arabic Text ---
    ctx.font = `${arabicFontSize}px "Amiri"`;
    ctx.fillStyle = arabicColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 4;

    // Wrap Arabic text
    const arabicLines = wrapText(ctx, arabicText, maxTextWidth);

    // --- English Text ---
    ctx.font = `${englishFontSize}px "Arial"`;
    ctx.fillStyle = englishColor;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;

    const englishLines = wrapText(ctx, englishText, maxTextWidth);

    // --- Calculate Layout ---
    const arabicLineHeight = arabicFontSize * 1.5;
    const englishLineHeight = englishFontSize * 1.2;
    const gap = height * 0.05; // 5% of height gap

    const totalArabicHeight = arabicLines.length * arabicLineHeight;
    const totalEnglishHeight = englishLines.length * englishLineHeight;
    const totalContentHeight = totalArabicHeight + gap + totalEnglishHeight;

    let startY = (height - totalContentHeight) / 2;

    // --- Render Arabic ---
    // Reset font for proper rendering
    ctx.font = `${arabicFontSize}px "Amiri"`;
    ctx.fillStyle = arabicColor;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 4;

    let currentY = startY + (arabicLineHeight / 2); // Start at middle of first line

    arabicLines.forEach((line) => {
        ctx.strokeText(line, width / 2, currentY);
        ctx.fillText(line, width / 2, currentY);
        currentY += arabicLineHeight;
    });

    // --- Render English ---
    currentY += gap - (arabicLineHeight / 2) + (englishLineHeight / 2); // Add gap and adjust baseline

    ctx.font = `${englishFontSize}px "Arial"`;
    ctx.fillStyle = englishColor;
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;

    englishLines.forEach((line) => {
        ctx.strokeText(line, width / 2, currentY);
        ctx.fillText(line, width / 2, currentY);
        currentY += englishLineHeight;
    });

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
};
