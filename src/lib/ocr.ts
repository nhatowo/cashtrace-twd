import { normalizeSerialNumber } from '@/types/banknote';

export interface OcrScanResult {
  serialNumber: string;
  rawText: string;
  confidence: number;
  previewDataUrl: string;
  isExactTwdFormat: boolean;
}

const TWD_EXACT_REGEX = /^[A-Z]{2}\d{6}[A-Z]{2}$/;

/**
 * Corrects common OCR character confusions specifically for the 10-character
 * Taiwan Dollar serial number format: 2 Letters + 6 Digits + 2 Letters (e.g., TY328954HR)
 */
export function fixTwd10CharCandidate(token10: string): {
  serial: string;
  score: number;
} | null {
  if (token10.length !== 10) return null;

  const digitFixMap: Record<string, string> = {
    O: '0',
    Q: '0',
    D: '0',
    U: '0',
    I: '1',
    L: '1',
    Z: '2',
    S: '5',
    G: '6',
    B: '8',
    A: '4',
    T: '7',
  };

  const letterFixMap: Record<string, string> = {
    '0': 'O',
    '1': 'I',
    '2': 'Z',
    '4': 'A',
    '5': 'S',
    '6': 'G',
    '7': 'T',
    '8': 'B',
  };

  let penalty = 0;
  const chars = token10.toUpperCase().split('');

  // Positions 0, 1, 8, 9 MUST be letters A-Z
  for (const idx of [0, 1, 8, 9]) {
    const ch = chars[idx];
    if (/[A-Z]/.test(ch)) continue;
    if (letterFixMap[ch]) {
      chars[idx] = letterFixMap[ch];
      penalty += 1;
    } else {
      return null;
    }
  }

  // Positions 2..7 MUST be digits 0-9
  for (let idx = 2; idx <= 7; idx++) {
    const ch = chars[idx];
    if (/\d/.test(ch)) continue;
    if (digitFixMap[ch]) {
      chars[idx] = digitFixMap[ch];
      penalty += 1;
    } else {
      return null;
    }
  }

  const candidate = chars.join('');
  if (!TWD_EXACT_REGEX.test(candidate)) return null;
  if (penalty > 2) return null; // Reject if too many coerced characters

  return {
    serial: candidate,
    score: 100 - penalty * 15,
  };
}

/**
 * Extracts the best Taiwan Dollar banknote serial number from OCR raw text.
 */
export function extractTwdSerialCandidate(rawText: string): {
  serial: string;
  isExact: boolean;
} {
  const upper = rawText.toUpperCase();

  // Split into lines and strip non-alphanumeric chars (since TWD bills print spaces between chars: "TY 328954 HR")
  const rawLines = upper.split(/[\r\n]+/);

  let bestExact: { serial: string; score: number } | null = null;

  for (const rawLine of rawLines) {
    // Also check contiguous alphanumeric tokens and sliding 10-char windows
    const cleaned = rawLine.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 6) continue;

    if (cleaned.length >= 10) {
      for (let i = 0; i <= cleaned.length - 10; i++) {
        const win = cleaned.slice(i, i + 10);
        const fixed = fixTwd10CharCandidate(win);
        if (fixed && (!bestExact || fixed.score > bestExact.score)) {
          bestExact = fixed;
        }
      }
    }
  }

  // Also test entire stripped string if newlines broke the serial
  const allCleaned = upper.replace(/[^A-Z0-9]/g, '');
  if (!bestExact && allCleaned.length >= 10) {
    for (let i = 0; i <= allCleaned.length - 10; i++) {
      const win = allCleaned.slice(i, i + 10);
      const fixed = fixTwd10CharCandidate(win);
      if (fixed && (!bestExact || fixed.score > bestExact.score)) {
        bestExact = fixed;
      }
    }
  }

  if (bestExact) {
    return { serial: bestExact.serial, isExact: true };
  }

  // Fallback: look for 2 letters + 6 digits (8 chars)
  const match8 = allCleaned.match(/[A-Z]{2}\d{6}/);
  if (match8) {
    return { serial: match8[0], isExact: false };
  }

  // Fallback: look for token with both letters and digits
  const mixedTokens = upper
    .split(/[\r\n]+/)
    .map((l) => l.replace(/[^A-Z0-9]/g, ''))
    .filter((l) => /[A-Z]/.test(l) && /\d/.test(l) && l.length >= 5);

  if (mixedTokens.length > 0) {
    mixedTokens.sort((a, b) => b.length - a.length);
    return { serial: mixedTokens[0].slice(0, 12), isExact: false };
  }

  return {
    serial: normalizeSerialNumber(allCleaned).slice(0, 12),
    isExact: false,
  };
}

/**
 * Computes a sharpness / focus score using horizontal & vertical gradient energy
 * inside the serial number region. Higher = sharper edges.
 */
export function computeCanvasSharpness(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;

  const w = canvas.width;
  const h = canvas.height;
  if (w < 16 || h < 16) return 0;

  const imgData = ctx.getImageData(0, 0, w, h).data;
  let edgeEnergy = 0;
  let samples = 0;

  // Sample central 70% width x 60% height where the serial characters sit
  const startX = Math.floor(w * 0.15);
  const endX = Math.floor(w * 0.85);
  const startY = Math.floor(h * 0.2);
  const endY = Math.floor(h * 0.8);

  for (let y = startY; y < endY - 2; y += 2) {
    for (let x = startX; x < endX - 2; x += 2) {
      const idx = (y * w + x) * 4;
      const idxRight = (y * w + (x + 2)) * 4;
      const idxDown = ((y + 2) * w + x) * 4;

      // Use green channel (absorbs both red ink and black/blue ink strongly)
      const g = imgData[idx + 1];
      const gRight = imgData[idxRight + 1];
      const gDown = imgData[idxDown + 1];

      const dx = g - gRight;
      const dy = g - gDown;
      edgeEnergy += dx * dx + dy * dy;
      samples++;
    }
  }

  return samples > 0 ? Math.sqrt(edgeEnergy / samples) : 0;
}

/**
 * Pre-processes a cropped serial number canvas specifically for Taiwan Dollar banknotes:
 * - Uses minimum of Green & Blue channels (`min(G, B)`) so RED serial ink (like on 100/1000 TWD)
 *   and DARK/BLUE serial ink become maximally dark against the lighter watermark paper.
 * - Uses local adaptive thresholding (integral image mean in a window) so uneven lighting,
 *   shadows, or background watermark patterns are cleanly separated from crisp character strokes.
 * - Adds a clean white margin around the strip so Tesseract's line segmenter never clips characters.
 */
export function preprocessSerialCanvas(
  sourceCanvas: HTMLCanvasElement,
  mode: 'adaptive' | 'contrast' = 'adaptive'
): HTMLCanvasElement {
  // Target height ~120px for optimal Tesseract character stroke width
  const targetH = 110;
  const scale = Math.max(1, Math.min(2.5, targetH / Math.max(1, sourceCanvas.height)));
  const innerW = Math.round(sourceCanvas.width * scale);
  const innerH = Math.round(sourceCanvas.height * scale);
  const pad = 18;

  const out = document.createElement('canvas');
  out.width = innerW + pad * 2;
  out.height = innerH + pad * 2;

  const ctx = out.getContext('2d');
  if (!ctx) return sourceCanvas;

  // Fill white border padding
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, out.width, out.height);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sourceCanvas, pad, pad, innerW, innerH);

  const imgData = ctx.getImageData(pad, pad, innerW, innerH);
  const data = imgData.data;
  const gray = new Float32Array(innerW * innerH);

  let minVal = 255;
  let maxVal = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Red ink has high R and low G, B. Black/Blue ink has low R, G.
    // Taking min(G, B) minus a fraction of (R - G) makes red ink AND dark ink stand out sharply!
    const redBoost = Math.max(0, r - g) * 0.45;
    const inkChannel = Math.max(0, Math.min(g, b) - redBoost);

    gray[p] = inkChannel;
    if (inkChannel < minVal) minVal = inkChannel;
    if (inkChannel > maxVal) maxVal = inkChannel;
  }

  const range = Math.max(1, maxVal - minVal);
  for (let p = 0; p < gray.length; p++) {
    gray[p] = ((gray[p] - minVal) / range) * 255;
  }

  if (mode === 'contrast') {
    // Smooth high-contrast stretch (great when background is already clean)
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      // Gamma curve to darken ink (< 135) and whiten paper (> 155)
      const v = gray[p];
      let outVal: number;
      if (v < 115) {
        outVal = Math.max(0, (v / 115) * 45);
      } else if (v > 160) {
        outVal = 255;
      } else {
        outVal = 45 + ((v - 115) / 45) * 210;
      }
      data[i] = outVal;
      data[i + 1] = outVal;
      data[i + 2] = outVal;
    }
  } else {
    // Bradley-Roth integral image local adaptive thresholding
    const integral = new Float64Array(innerW * innerH);
    for (let y = 0; y < innerH; y++) {
      let rowSum = 0;
      for (let x = 0; x < innerW; x++) {
        rowSum += gray[y * innerW + x];
        integral[y * innerW + x] =
          (y > 0 ? integral[(y - 1) * innerW + x] : 0) + rowSum;
      }
    }

    const winRadius = Math.max(12, Math.round(innerH * 0.28));
    const sensitivity = 0.82; // Pixel must be 18% darker than local neighborhood to be ink

    for (let y = 0; y < innerH; y++) {
      const y1 = Math.max(0, y - winRadius);
      const y2 = Math.min(innerH - 1, y + winRadius);
      for (let x = 0; x < innerW; x++) {
        const x1 = Math.max(0, x - winRadius);
        const x2 = Math.min(innerW - 1, x + winRadius);

        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
          integral[y2 * innerW + x2] -
          (y1 > 0 ? integral[(y1 - 1) * innerW + x2] : 0) -
          (x1 > 0 ? integral[y2 * innerW + (x1 - 1)] : 0) +
          (y1 > 0 && x1 > 0 ? integral[(y1 - 1) * innerW + (x1 - 1)] : 0);

        const localMean = sum / count;
        const p = y * innerW + x;
        const isInk = gray[p] < localMean * sensitivity && gray[p] < 165;
        const val = isInk ? 0 : 255;
        const idx = p * 4;
        data[idx] = val;
        data[idx + 1] = val;
        data[idx + 2] = val;
      }
    }
  }

  ctx.putImageData(imgData, pad, pad);
  return out;
}

// Singleton persistent Tesseract worker so live auto-scan runs in ~150ms without reloading WASM
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedWorkerPromise: Promise<any> | null = null;
let workerBusy = false;

async function getSharedTesseractWorker() {
  if (!sharedWorkerPromise) {
    sharedWorkerPromise = (async () => {
      const Tesseract = await import('tesseract.js');
      const worker = await Tesseract.createWorker('eng', 1);
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
        // PSM 7 = Treat the image as a single text line (ideal for serial number strip!)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tessedit_pageseg_mode: '7' as any,
      });
      return worker;
    })().catch((err) => {
      sharedWorkerPromise = null;
      throw err;
    });
  }
  return sharedWorkerPromise;
}

/**
 * Pre-warms the Tesseract worker as soon as the camera opens.
 */
export function prewarmOcrWorker(): void {
  if (typeof window !== 'undefined') {
    getSharedTesseractWorker().catch(() => {});
  }
}

/**
 * Runs Tesseract.js OCR on a cropped serial number canvas.
 * Tries both contrast-enhanced and adaptive-thresholded passes to guarantee high accuracy on red & dark TWD serials.
 */
export async function recognizeSerialFromCanvas(
  rawCanvas: HTMLCanvasElement,
  onProgress?: (progressPct: number) => void
): Promise<OcrScanResult> {
  if (workerBusy) {
    throw new Error('BUSY');
  }
  workerBusy = true;

  try {
    if (onProgress) onProgress(20);
    const previewDataUrl = rawCanvas.toDataURL('image/jpeg', 0.88);
    const worker = await getSharedTesseractWorker();

    if (onProgress) onProgress(50);

    // Pass 1: Adaptive thresholding (best for red ink over watermark patterns like TY328954HR)
    const adaptiveCanvas = preprocessSerialCanvas(rawCanvas, 'adaptive');
    const res1 = await worker.recognize(adaptiveCanvas);
    const cand1 = extractTwdSerialCandidate(res1.data.text || '');
    const conf1 = Math.round(res1.data.confidence || 0);

    if (cand1.isExact && conf1 >= 55) {
      if (onProgress) onProgress(100);
      return {
        serialNumber: cand1.serial,
        rawText: (res1.data.text || '').trim(),
        confidence: Math.max(conf1, 85),
        previewDataUrl,
        isExactTwdFormat: true,
      };
    }

    if (onProgress) onProgress(78);

    // Pass 2: Smooth red-boosted contrast stretch
    const contrastCanvas = preprocessSerialCanvas(rawCanvas, 'contrast');
    const res2 = await worker.recognize(contrastCanvas);
    const cand2 = extractTwdSerialCandidate(res2.data.text || '');
    const conf2 = Math.round(res2.data.confidence || 0);

    if (onProgress) onProgress(100);

    // Prefer whichever pass matched the exact 10-character TWD format (2L + 6D + 2L)
    if (cand2.isExact && !cand1.isExact) {
      return {
        serialNumber: cand2.serial,
        rawText: (res2.data.text || '').trim(),
        confidence: Math.max(conf2, 85),
        previewDataUrl,
        isExactTwdFormat: true,
      };
    }

    if (cand1.isExact) {
      return {
        serialNumber: cand1.serial,
        rawText: (res1.data.text || '').trim(),
        confidence: Math.max(conf1, 82),
        previewDataUrl,
        isExactTwdFormat: true,
      };
    }

    // Otherwise pick higher confidence or longer candidate
    const useSecond =
      cand2.serial.length > cand1.serial.length ||
      (cand2.serial.length === cand1.serial.length && conf2 > conf1);

    return {
      serialNumber: useSecond ? cand2.serial : cand1.serial,
      rawText: ((useSecond ? res2.data.text : res1.data.text) || '').trim(),
      confidence: Math.max(conf1, conf2),
      previewDataUrl,
      isExactTwdFormat: false,
    };
  } finally {
    workerBusy = false;
  }
}
