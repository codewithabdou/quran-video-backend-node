import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

// Track registered fonts
const registeredFonts = new Set();

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');
    for (const p of paragraphs) {
        if (!p) {
            lines.push('');
            continue;
        }
        const words = p.split(' ');
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
    }
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
    if (!registeredFonts.has(arabicFontPath)) {
        console.log(`Registering Arabic Font from: ${arabicFontPath}`);
        if (fs.existsSync(arabicFontPath)) {
            registerFont(arabicFontPath, { family: 'Nabi' });
            registeredFonts.add(arabicFontPath);
        } else {
            console.warn(`Arabic font not found at ${arabicFontPath}`);
        }
    }

    if (!registeredFonts.has(englishFontPath)) {
        console.log(`Registering English Font from: ${englishFontPath}`);
        if (fs.existsSync(englishFontPath)) {
            registerFont(englishFontPath, { family: 'Arial' });
            registeredFonts.add(englishFontPath);
        } else {
            console.warn(`English font not found at ${englishFontPath}`);
        }
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Clear background (transparent)
    ctx.clearRect(0, 0, width, height);

    const margin = width * 0.05;
    const maxTextWidth = width - (2 * margin);
    const center = height / 2;

    // --- Arabic Text ---
    ctx.font = `${arabicFontSize}px "Nabi"`;
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
    const arabicLineHeight = arabicFontSize * 1.8;
    const englishLineHeight = englishFontSize * 1.2;
    const gap = height * 0.05; // 5% of height gap

    const totalArabicHeight = arabicLines.length * arabicLineHeight;
    const totalEnglishHeight = englishLines.length * englishLineHeight;
    const totalContentHeight = totalArabicHeight + gap + totalEnglishHeight;

    let startY = (height - totalContentHeight) / 2;

    // --- Render Arabic ---
    // Reset font for proper rendering
    ctx.font = `${arabicFontSize}px "Nabi"`;
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

// Helper to draw a rounded rectangle
function drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawSearchIcon(ctx, x, y, size, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Glass
    ctx.arc(x + size * 0.4, y + size * 0.4, size * 0.3, 0, 2 * Math.PI);
    ctx.stroke();
    // Handle
    ctx.beginPath();
    ctx.moveTo(x + size * 0.65, y + size * 0.65);
    ctx.lineTo(x + size, y + size);
    ctx.stroke();
}

export const createOutroImage = async (arabicText, englishText, urlText, outputPath, settings) => {
    const { width, height, arabicFontPath, englishFontPath } = settings;

    // Register fonts
    if (!registeredFonts.has(arabicFontPath)) {
        if (fs.existsSync(arabicFontPath)) {
            registerFont(arabicFontPath, { family: 'Nabi' });
            registeredFonts.add(arabicFontPath);
        }
    }

    if (!registeredFonts.has(englishFontPath)) {
        if (fs.existsSync(englishFontPath)) {
            registerFont(englishFontPath, { family: 'Arial' });
            registeredFonts.add(englishFontPath);
        }
    }

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Premium Dark Gradient Background
    const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
    bgGradient.addColorStop(0, '#0f172a'); // slate-900
    bgGradient.addColorStop(1, '#020617'); // slate-950
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Subtle decorative rings centered globally
    ctx.strokeStyle = '#1e293b'; // slate-800
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width * 0.45, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.strokeStyle = '#0f172a'; // slate-900
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, width * 0.35, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Layout configuration
    const centerY = height / 2;
    let arabicY = centerY - (height * 0.12);
    let englishY = centerY - (height * 0.01);
    const urlY = centerY + (height * 0.12);

    const arabicLines = arabicText.split('\n');
    if (arabicLines.length > 1) arabicY -= (height * 0.02); // nudge up if multiline

    // Render Smaller Arabic Title
    ctx.font = `${Math.floor(width * 0.06)}px "Arial"`;
    ctx.fillStyle = '#f8fafc'; // clean white-ish
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 15;

    arabicLines.forEach(line => {
        ctx.fillText(line, width / 2, arabicY);
        arabicY += Math.floor(width * 0.09); // Add Line Spread
    });

    const englishLines = englishText.split('\n');
    if (englishLines.length > 1) englishY += (height * 0.01); // nudge down if multiline

    // Render English Subtitle
    ctx.font = `${Math.floor(width * 0.04)}px "Arial"`;
    ctx.fillStyle = '#94a3b8'; // subtle slate
    ctx.shadowBlur = 4;

    englishLines.forEach(line => {
        ctx.fillText(line, width / 2, englishY);
        englishY += Math.floor(width * 0.06); // Add Line Spread
    });

    // URL Gradient Config & Measurements
    ctx.font = `bold ${Math.floor(width * 0.04)}px "Arial"`;
    const textWidth = ctx.measureText(urlText).width;
    const iconSize = Math.floor(width * 0.035);
    const innerSpacing = width * 0.02;
    const contentWidth = iconSize + innerSpacing + textWidth;

    const urlGradient = ctx.createLinearGradient((width / 2) - (contentWidth / 2), 0, (width / 2) + (contentWidth / 2), 0);
    urlGradient.addColorStop(0, '#fbbf24'); // gold
    urlGradient.addColorStop(1, '#f59e0b');

    // Render URL Pill Background
    const paddingX = width * 0.08;
    const paddingY = height * 0.025;

    ctx.shadowColor = 'rgba(245, 158, 11, 0.3)';
    ctx.shadowBlur = 20;

    const rectX = (width / 2) - (contentWidth / 2) - paddingX;
    const rectY = urlY - paddingY - (height * 0.005);
    const rectW = contentWidth + (paddingX * 2);
    const rectH = (height * 0.01) + (paddingY * 2);

    drawRoundRect(ctx, rectX, rectY, rectW, rectH, rectH / 2);

    // Fill the button
    ctx.fillStyle = 'rgba(245, 158, 11, 0.1)';
    ctx.fill();
    // Stroke the button border
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Turn off shadow for crisp text and icons inside glowing box
    ctx.shadowBlur = 0;

    const iconX = (width / 2) - (contentWidth / 2);
    const iconY = urlY - (iconSize / 2);
    drawSearchIcon(ctx, iconX, iconY, iconSize, '#fbbf24');

    ctx.fillStyle = urlGradient;
    ctx.textAlign = 'left';
    ctx.fillText(urlText, iconX + iconSize + innerSpacing, urlY);

    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
};
