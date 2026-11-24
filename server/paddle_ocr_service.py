#!/usr/bin/env python3
import base64
import io
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

# Pre-load PaddleOCR PP-OCRv4 ONNX models into memory once on startup
ocr_engine = RapidOCR()

TWD_EXACT_REGEX = re.compile(r'^[A-Z]{2}\d{6}[A-Z]{2}$')

DIGIT_FIX = {
    'O': '0', 'Q': '0', 'D': '0', 'U': '0',
    'I': '1', 'L': '1', 'Z': '2', 'S': '5',
    'G': '6', 'B': '8', 'A': '4', 'T': '7',
}

LETTER_FIX = {
    '0': 'O', '1': 'I', '2': 'Z', '4': 'A',
    '5': 'S', '6': 'G', '7': 'T', '8': 'B',
}


def fix_twd_10char(token10: str):
    if len(token10) != 10:
        return None
    chars = list(token10.upper())
    penalty = 0

    for idx in (0, 1, 8, 9):
        ch = chars[idx]
        if 'A' <= ch <= 'Z':
            continue
        if ch in LETTER_FIX:
            chars[idx] = LETTER_FIX[ch]
            penalty += 1
        else:
            return None

    for idx in range(2, 8):
        ch = chars[idx]
        if '0' <= ch <= '9':
            continue
        if ch in DIGIT_FIX:
            chars[idx] = DIGIT_FIX[ch]
            penalty += 1
        else:
            return None

    candidate = ''.join(chars)
    if not TWD_EXACT_REGEX.match(candidate) or penalty > 2:
        return None
    return candidate, 100 - penalty * 12


def extract_best_twd_serial(texts_with_scores):
    best_exact = None
    best_exact_score = -1.0
    all_raw = []

    for text, conf in texts_with_scores:
        all_raw.append(text)
        cleaned = re.sub(r'[^A-Za-z0-9]', '', text).upper()
        if len(cleaned) >= 10:
            for i in range(len(cleaned) - 9):
                win = cleaned[i:i + 10]
                res = fix_twd_10char(win)
                if res:
                    cand, pattern_score = res
                    total_score = pattern_score * 0.5 + (conf * 100.0) * 0.5
                    if total_score > best_exact_score:
                        best_exact = cand
                        best_exact_score = total_score

    # Also test concatenated text across boxes on the same line
    joined_cleaned = re.sub(r'[^A-Za-z0-9]', '', ''.join(all_raw)).upper()
    if not best_exact and len(joined_cleaned) >= 10:
        for i in range(len(joined_cleaned) - 9):
            win = joined_cleaned[i:i + 10]
            res = fix_twd_10char(win)
            if res:
                cand, pattern_score = res
                if pattern_score > best_exact_score:
                    best_exact = cand
                    best_exact_score = pattern_score

    if best_exact:
        return best_exact, True, int(min(99, max(85, round(best_exact_score))))

    # Fallback: 2 letters + 6 digits
    m8 = re.search(r'[A-Z]{2}\d{6}', joined_cleaned)
    if m8:
        return m8.group(0), False, 70

    # Fallback: longest alphanumeric token containing both letters and digits
    best_fallback = ''
    best_conf = 0
    for text, conf in texts_with_scores:
        c = re.sub(r'[^A-Za-z0-9]', '', text).upper()
        if len(c) > len(best_fallback):
            best_fallback = c
            best_conf = int(round(conf * 100))

    return best_fallback[:12], False, best_conf


def enhance_red_ink_array(rgb_arr: np.ndarray) -> np.ndarray:
    """Enhances red/dark serial ink against watermark background for a secondary pass."""
    r = rgb_arr[:, :, 0].astype(np.float32)
    g = rgb_arr[:, :, 1].astype(np.float32)
    b = rgb_arr[:, :, 2].astype(np.float32)
    red_boost = np.maximum(0.0, r - g) * 0.5
    ink = np.clip(np.minimum(g, b) - red_boost, 0, 255)
    lo, hi = np.percentile(ink, (3, 95))
    norm = np.clip((ink - lo) / max(1.0, (hi - lo)) * 255.0, 0, 255).astype(np.uint8)
    return np.stack([norm, norm, norm], axis=-1)


def run_paddle_ocr(img_bytes: bytes):
    pil_img = Image.open(io.BytesIO(img_bytes)).convert('RGB')
    rgb_arr = np.array(pil_img)

    # Pass 1: Direct RGB image through PaddleOCR PP-OCRv4 (DBNet + SVTR)
    result1, _ = ocr_engine(rgb_arr)
    items1 = []
    if result1:
        # Sort boxes left-to-right
        result1.sort(key=lambda item: item[0][0][0])
        for box, text, score in result1:
            items1.append((str(text), float(score)))

    serial1, is_exact1, conf1 = extract_best_twd_serial(items1)
    if is_exact1:
        return {
            'serialNumber': serial1,
            'rawText': ' '.join(t for t, _ in items1),
            'confidence': conf1,
            'isExactTwdFormat': True,
            'engine': 'PaddleOCR-v4',
        }

    # Pass 2: Red-ink enhanced channel image
    enh_arr = enhance_red_ink_array(rgb_arr)
    result2, _ = ocr_engine(enh_arr)
    items2 = []
    if result2:
        result2.sort(key=lambda item: item[0][0][0])
        for box, text, score in result2:
            items2.append((str(text), float(score)))

    serial2, is_exact2, conf2 = extract_best_twd_serial(items2)
    if is_exact2 or len(serial2) > len(serial1):
        return {
            'serialNumber': serial2,
            'rawText': ' '.join(t for t, _ in items2),
            'confidence': conf2,
            'isExactTwdFormat': is_exact2,
            'engine': 'PaddleOCR-v4',
        }

    return {
        'serialNumber': serial1,
        'rawText': ' '.join(t for t, _ in items1),
        'confidence': conf1,
        'isExactTwdFormat': False,
        'engine': 'PaddleOCR-v4',
    }


class OcrHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def do_POST(self):
        if self.path != '/ocr':
            self.send_response(404)
            self.end_headers()
            return

        try:
            length = int(self.headers.get('Content-Length', '0'))
            body = self.rfile.read(length)
            payload = json.loads(body.decode('utf-8'))
            data_url = payload.get('image', '')
            if ',' in data_url:
                data_url = data_url.split(',', 1)[1]
            img_bytes = base64.b64decode(data_url)

            res = run_paddle_ocr(img_bytes)
            out = json.dumps(res).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except Exception as e:
            err = json.dumps({'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(err)))
            self.end_headers()
            self.wfile.write(err)


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 3001), OcrHandler)
    print('PaddleOCR v4 service listening on http://127.0.0.1:3001')
    server.serve_forever()
