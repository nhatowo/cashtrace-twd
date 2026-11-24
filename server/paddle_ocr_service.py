#!/usr/bin/env python3
import base64
import io
import json
import os
import re
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

# Download official PaddleOCR English/Alphanumeric recognition model (95 ASCII chars only -> 4x faster & zero Chinese char noise)
MODEL_DIR = '/opt/cashtrace/server/models'
os.makedirs(MODEL_DIR, exist_ok=True)
EN_REC_MODEL_PATH = os.path.join(MODEL_DIR, 'en_PP-OCRv3_rec_infer.onnx')
EN_REC_URL = 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv3/en_PP-OCRv3_rec_infer.onnx'

if not os.path.exists(EN_REC_MODEL_PATH) or os.path.getsize(EN_REC_MODEL_PATH) < 100000:
    try:
        print('Downloading en_PP-OCRv3_rec_infer.onnx for ultra-fast alphanumeric OCR...')
        urllib.request.urlretrieve(EN_REC_URL, EN_REC_MODEL_PATH)
        print('Downloaded en_PP-OCRv3_rec_infer.onnx:', os.path.getsize(EN_REC_MODEL_PATH))
    except Exception as e:
        print('Fallback to default rec model:', e)
        EN_REC_MODEL_PATH = None

# Fast detector + alphanumeric recognizer (det_limit_side_len=480 for cropped strips)
if EN_REC_MODEL_PATH and os.path.exists(EN_REC_MODEL_PATH):
    ocr_engine = RapidOCR(
        rec_model_path=EN_REC_MODEL_PATH,
        det_limit_side_len=480,
        det_limit_type='max',
        use_angle_cls=False,
    )
else:
    ocr_engine = RapidOCR(
        det_limit_side_len=480,
        det_limit_type='max',
        use_angle_cls=False,
    )

TWD_EXACT_REGEX = re.compile(r'^[A-Z]{2}\d{6}[A-Z]{2}$')

# Comprehensive OCR lookalike mapping for TWD serial font
DIGIT_FIX = {
    'O': '0', 'Q': '0', 'D': '0', 'U': '0', 'C': '0',
    'I': '1', 'L': '1', 'J': '1',
    'Z': '2',
    'E': '3',
    'A': '4', 'H': '4',
    'S': '5',
    'G': '6', 'b': '6',
    'T': '7', 'Y': '7',
    'B': '8',
    'P': '9', 'q': '9',
}

LETTER_FIX = {
    '0': 'O',
    '1': 'I',
    '2': 'Z',
    '3': 'E',
    '4': 'A',
    '5': 'S',
    '6': 'G',
    '7': 'T',
    '8': 'B',
    '9': 'P',
}


def fix_twd_10char(token10: str):
    if len(token10) != 10:
        return None
    chars = list(token10.upper())
    penalty = 0

    # Positions 0, 1, 8, 9 MUST be uppercase letters A-Z
    for idx in (0, 1, 8, 9):
        ch = chars[idx]
        if 'A' <= ch <= 'Z':
            continue
        if ch in LETTER_FIX:
            chars[idx] = LETTER_FIX[ch]
            penalty += 1
        else:
            return None

    # Positions 2..7 MUST be digits 0-9
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
    if not TWD_EXACT_REGEX.match(candidate) or penalty > 3:
        return None
    return candidate, 100 - penalty * 10


def extract_best_twd_serial_from_boxes(raw_result, img_h: int):
    """
    Groups detected text boxes that lie on the same horizontal serial line,
    ignoring stray watermark boxes above or below.
    """
    if not raw_result:
        return '', False, 0, ''

    boxes_info = []
    for box, text, score in raw_result:
        xs = [pt[0] for pt in box]
        ys = [pt[1] for pt in box]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        cy = (min_y + max_y) / 2.0
        bh = max(1.0, max_y - min_y)
        cleaned = re.sub(r'[^A-Za-z0-9]', '', str(text)).upper()
        if not cleaned:
            continue
        boxes_info.append({
            'min_x': min_x,
            'cy': cy,
            'bh': bh,
            'text': cleaned,
            'score': float(score),
        })

    if not boxes_info:
        return '', False, 0, ''

    best_exact = None
    best_exact_score = -1.0

    # 1. Check each individual box first
    for b in boxes_info:
        txt = b['text']
        if len(txt) >= 10:
            for i in range(len(txt) - 9):
                res = fix_twd_10char(txt[i:i + 10])
                if res:
                    cand, p_score = res
                    # Favor boxes near the vertical center of the reticle
                    center_bonus = 10.0 * (1.0 - abs(b['cy'] - img_h / 2.0) / max(1.0, img_h / 2.0))
                    total = p_score * 0.5 + (b['score'] * 100.0) * 0.4 + center_bonus
                    if total > best_exact_score:
                        best_exact = cand
                        best_exact_score = total

    # 2. Group boxes that belong to the same horizontal line (within 0.65 * box height vertically)
    for anchor in boxes_info:
        line_group = [
            other for other in boxes_info
            if abs(other['cy'] - anchor['cy']) <= max(anchor['bh'], other['bh']) * 0.7
        ]
        line_group.sort(key=lambda item: item['min_x'])
        joined_text = ''.join(item['text'] for item in line_group)
        avg_conf = sum(item['score'] for item in line_group) / len(line_group)

        if len(joined_text) >= 10:
            for i in range(len(joined_text) - 9):
                res = fix_twd_10char(joined_text[i:i + 10])
                if res:
                    cand, p_score = res
                    center_bonus = 10.0 * (1.0 - abs(anchor['cy'] - img_h / 2.0) / max(1.0, img_h / 2.0))
                    total = p_score * 0.5 + (avg_conf * 100.0) * 0.4 + center_bonus
                    if total > best_exact_score:
                        best_exact = cand
                        best_exact_score = total

    raw_display = ' '.join(b['text'] for b in sorted(boxes_info, key=lambda x: x['min_x']))

    if best_exact:
        return best_exact, True, int(min(99, max(86, round(best_exact_score)))), raw_display

    # Fallback: 2 letters + 6 digits
    all_joined = re.sub(r'[^A-Z0-9]', '', raw_display)
    m8 = re.search(r'[A-Z]{2}\d{6}', all_joined)
    if m8:
        return m8.group(0), False, 74, raw_display

    # Fallback: best box closest to vertical center
    boxes_info.sort(key=lambda b: (len(b['text']), -abs(b['cy'] - img_h / 2.0)), reverse=True)
    top = boxes_info[0]
    return top['text'][:12], False, int(round(top['score'] * 100)), raw_display


def enhance_red_and_dark_ink(rgb_arr: np.ndarray) -> np.ndarray:
    """Isolates red, blue, or black serial ink and suppresses light watermark background."""
    r = rgb_arr[:, :, 0].astype(np.float32)
    g = rgb_arr[:, :, 1].astype(np.float32)
    b = rgb_arr[:, :, 2].astype(np.float32)
    red_boost = np.maximum(0.0, r - g) * 0.55
    ink = np.clip(np.minimum(g, b) - red_boost, 0, 255)
    lo, hi = np.percentile(ink, (2, 92))
    norm = np.clip((ink - lo) / max(1.0, (hi - lo)) * 255.0, 0, 255).astype(np.uint8)
    return np.stack([norm, norm, norm], axis=-1)


def run_paddle_ocr(img_bytes: bytes):
    t0 = time.time()
    pil_img = Image.open(io.BytesIO(img_bytes)).convert('RGB')

    # Keep strip width <= 520px for ~65ms inference speed
    if pil_img.width > 520:
        new_h = max(36, int(round(pil_img.height * (520 / pil_img.width))))
        pil_img = pil_img.resize((520, new_h), Image.Resampling.BILINEAR)

    rgb_arr = np.array(pil_img)
    img_h = rgb_arr.shape[0]

    # Pass 1: Direct RGB image through PaddleOCR
    result1, _ = ocr_engine(rgb_arr)
    serial1, is_exact1, conf1, raw1 = extract_best_twd_serial_from_boxes(result1, img_h)

    if is_exact1:
        ms = int(round((time.time() - t0) * 1000))
        return {
            'serialNumber': serial1,
            'rawText': raw1,
            'confidence': conf1,
            'isExactTwdFormat': True,
            'engine': f'PaddleOCR-EN ({ms}ms)',
        }

    # Pass 2: Red/Dark ink isolated channel (only runs if Pass 1 didn't lock onto a 10-char TWD serial)
    enh_arr = enhance_red_and_dark_ink(rgb_arr)
    result2, _ = ocr_engine(enh_arr)
    serial2, is_exact2, conf2, raw2 = extract_best_twd_serial_from_boxes(result2, img_h)
    ms = int(round((time.time() - t0) * 1000))

    if is_exact2 or len(serial2) > len(serial1):
        return {
            'serialNumber': serial2,
            'rawText': raw2,
            'confidence': conf2,
            'isExactTwdFormat': is_exact2,
            'engine': f'PaddleOCR-EN ({ms}ms)',
        }

    return {
        'serialNumber': serial1,
        'rawText': raw1,
        'confidence': conf1,
        'isExactTwdFormat': False,
        'engine': f'PaddleOCR-EN ({ms}ms)',
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
    server = ThreadingHTTPServer(('127.0.0.1', 3001), OcrHandler)
    print('PaddleOCR English Alphanumeric service listening on http://127.0.0.1:3001')
    server.serve_forever()
