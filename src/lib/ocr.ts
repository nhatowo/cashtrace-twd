import { normalizeSerialNumber } from '@/types/banknote';

export interface OcrScanResult {
  serialNumber: string;
  rawText: string;
  confidence: number;
  previewDataUrl: string;
}

/**
 * Extracts best candidate Taiwan Dollar banknote serial number from OCR text.
 * Standard TWD serial format: 2 uppercase letters + 6 digits + 2 uppercase letters (e.g., AA123456BB)
 * Also supports partial or variations while letting the user edit mistakes.
 */
export function extractTwdSerialCandidate(rawText: string): string {
  const upper = rawText.toUpperCase();

  // Common OCR confusion corrections for TWD serial pattern (2 letters + 6 digits + 2 letters)
  const fixDigit = (ch: string): string => {
    const map: Record<string, string> = {
      O: '0',
      Q: '0',
      D: '0',
      I: '1',
      L: '1',
      Z: '2',
      S: '5',
      G: '6',
      B: '8',
    };
    return map[ch] || ch;
  };

  const fixLetter = (ch: string): string => {
    const map: Record<string, string> = {
      '0': 'O',
      '1': 'I',
      '2': 'Z',
      '5': 'S',
      '8': 'B',
    };
    return map[ch] || ch;
  };

  // Strip spaces between characters on each line to detect 10-char TWD serials
  const lines = upper
    .split(/[\r\n]+/)
    .map((line) => line.replace(/[^A-Z0-9]/g, ''))
    .filter((line) => line.length >= 4);

  // 1. Exact 2L + 6D + 2L match
  const exactRegex = /[A-Z]{2}\d{6}[A-Z]{2}/;
  for (const line of lines) {
    const match = line.match(exactRegex);
    if (match) return match[0];
  }

  // 2. Fuzzy 10-char window that looks like 2 letters + 6 digits + 2 letters
  for (const line of lines) {
    if (line.length >= 10) {
      for (let i = 0; i <= line.length - 10; i++) {
        const windowStr = line.slice(i, i + 10);
        const prefix = fixLetter(windowStr[0]) + fixLetter(windowStr[1]);
        const mid = windowStr
          .slice(2, 8)
          .split('')
          .map(fixDigit)
          .join('');
        const suffix = fixLetter(windowStr[8]) + fixLetter(windowStr[9]);

        if (/^[A-Z]{2}\d{6}[A-Z]{2}$/.test(prefix + mid + suffix)) {
          return prefix + mid + suffix;
        }
      }
    }
  }

  // 3. 2 letters + 6 digits (8-char prefix/standard serial)
  for (const line of lines) {
    const match8 = line.match(/[A-Z]{2}\d{6}/);
    if (match8) return match8[0];
  }

  // 4. Fallback: longest alphanumeric token >= 5 chars
  const tokens = upper.match(/[A-Z0-9]{5,14}/g);
  if (tokens && tokens.length > 0) {
    tokens.sort((a, b) => b.length - a.length);
    return normalizeSerialNumber(tokens[0]);
  }

  return normalizeSerialNumber(lines[0] || upper).slice(0, 12);
}

/**
 * Pre-processes a cropped canvas region to enhance dark/red/blue serial ink on banknote paper.
 */
export function preprocessSerialCanvas(
  sourceCanvas: HTMLCanvasElement
): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const scale = sourceCanvas.width < 600 ? 2 : 1;
  out.width = sourceCanvas.width * scale;
  out.height = sourceCanvas.height * scale;

  const ctx = out.getContext('2d');
  if (!ctx) return sourceCanvas;

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(sourceCanvas, 0, 0, out.width, out.height);

  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const data = imgData.data;

  // Compute average luminance for adaptive contrast stretch
  let lumSum = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lumSum += lum;
  }
  const avgLum = lumSum / Math.max(1, pixelCount);
  const threshold = avgLum * 0.82;

  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // High-contrast grayscale sharpening without destroying edge anti-aliasing
    const val = lum < threshold ? Math.max(0, (lum / threshold) * 70) : 255;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }

  ctx.putImageData(imgData, 0, 0);
  return out;
}

/**
 * Runs Tesseract.js OCR on a canvas or image element and returns the extracted serial number.
 */
export async function recognizeSerialFromCanvas(
  rawCanvas: HTMLCanvasElement,
  onProgress?: (progressPct: number) => void
): Promise<OcrScanResult> {
  const processedCanvas = preprocessSerialCanvas(rawCanvas);
  const previewDataUrl = rawCanvas.toDataURL('image/jpeg', 0.85);

  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round((m.progress || 0) * 100));
      }
    },
  });

  try {
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    });

    const { data } = await worker.recognize(processedCanvas);
    const candidate = extractTwdSerialCandidate(data.text || '');

    return {
      serialNumber: candidate,
      rawText: (data.text || '').trim(),
      confidence: Math.round(data.confidence || 0),
      previewDataUrl,
    };
  } finally {
    await worker.terminate();
  }
}
