import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'cashtrace.json');
const STATIC_DIR = path.join(__dirname, '..', 'out');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = { users: [], sessions: {}, banknotes: [] };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
      return initial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: [], sessions: {}, banknotes: [] };
  }
}

function saveDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function normalizeSerial(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const VALID_DENOMS = new Set([100, 500, 1000, 2000]);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function getAuthUser(req, db) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    // Default shared workspace user if not logged in so sync works out-of-the-box!
    return { id: 'default_shared_wallet', email: 'Ví chung trên Server 18.142.115.74' };
  }
  const userId = db.sessions[token];
  if (!userId) {
    return { id: 'default_shared_wallet', email: 'Ví chung trên Server 18.142.115.74' };
  }
  const user = db.users.find((u) => u.id === userId);
  return user || { id: 'default_shared_wallet', email: 'Ví chung trên Server 18.142.115.74' };
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ipa': 'application/octet-stream',
  '.plist': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  try {
    // --- API ROUTES ---
    if (pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, server: 'CashTrace Ubuntu Server 18.142.115.74' });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!email || password.length < 6) {
        return sendJson(res, 400, { error: 'Email hoặc mật khẩu không hợp lệ (tối thiểu 6 ký tự).' });
      }
      const db = loadDb();
      if (db.users.some((u) => u.email === email)) {
        return sendJson(res, 409, { error: 'Email này đã được đăng ký.' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      const user = {
        id: crypto.randomUUID(),
        email,
        salt,
        passwordHash: hashPassword(password, salt),
        created_at: new Date().toISOString(),
      };
      db.users.push(user);
      const token = crypto.randomBytes(32).toString('hex');
      db.sessions[token] = user.id;
      saveDb(db);
      return sendJson(res, 200, {
        token,
        user: { id: user.id, email: user.email },
      });
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await parseBody(req);
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const db = loadDb();
      const user = db.users.find((u) => u.email === email);
      if (!user || hashPassword(password, user.salt) !== user.passwordHash) {
        return sendJson(res, 401, { error: 'Email hoặc mật khẩu không chính xác.' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      db.sessions[token] = user.id;
      saveDb(db);
      return sendJson(res, 200, {
        token,
        user: { id: user.id, email: user.email },
      });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const db = loadDb();
      const user = getAuthUser(req, db);
      return sendJson(res, 200, { user: { id: user.id, email: user.email } });
    }

    if (pathname === '/api/banknotes' && req.method === 'GET') {
      const db = loadDb();
      const user = getAuthUser(req, db);
      const notes = db.banknotes
        .filter((b) => b.user_id === user.id)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return sendJson(res, 200, { banknotes: notes, user: { id: user.id, email: user.email } });
    }

    if (pathname === '/api/banknotes' && req.method === 'POST') {
      const body = await parseBody(req);
      const db = loadDb();
      const user = getAuthUser(req, db);

      const serial = normalizeSerial(body.serial_number);
      const denom = Number(body.denomination);
      const status = body.status === 'SPENT' ? 'SPENT' : 'HELD';

      if (serial.length < 4) {
        return sendJson(res, 400, { error: 'Số seri phải có ít nhất 4 ký tự.' });
      }
      if (!VALID_DENOMS.has(denom)) {
        return sendJson(res, 400, { error: 'Mệnh giá chỉ hỗ trợ 100, 500, 1000, 2000 TWD.' });
      }

      const duplicate = db.banknotes.find(
        (b) => b.user_id === user.id && normalizeSerial(b.serial_number) === serial
      );
      if (duplicate) {
        return sendJson(res, 409, {
          error: `Số seri "${serial}" đã tồn tại trên hệ thống!`,
          code: '23505',
        });
      }

      const now = new Date().toISOString();
      const note = {
        id: crypto.randomUUID(),
        user_id: user.id,
        serial_number: serial,
        denomination: denom,
        status,
        created_at: now,
        updated_at: now,
      };
      db.banknotes.unshift(note);
      saveDb(db);
      return sendJson(res, 201, { banknote: note });
    }

    if (pathname.startsWith('/api/banknotes/') && req.method === 'PATCH') {
      const id = pathname.replace('/api/banknotes/', '').trim();
      const body = await parseBody(req);
      const db = loadDb();
      const user = getAuthUser(req, db);

      const idx = db.banknotes.findIndex((b) => b.id === id && b.user_id === user.id);
      if (idx === -1) {
        return sendJson(res, 404, { error: 'Không tìm thấy tờ tiền.' });
      }

      if (body.status === 'HELD' || body.status === 'SPENT') {
        db.banknotes[idx].status = body.status;
        db.banknotes[idx].updated_at = new Date().toISOString();
      }
      saveDb(db);
      return sendJson(res, 200, { banknote: db.banknotes[idx] });
    }

    // --- STATIC & IPA FILES ---
    let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      filePath = path.join(STATIC_DIR, 'index.html');
    }

    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);
      const headers = {
        'Content-Type': mime,
        'Content-Length': stat.size,
      };
      if (ext === '.ipa') {
        headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
      }
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : 'Internal Server Error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CashTrace Server running on http://0.0.0.0:${PORT}`);
});
