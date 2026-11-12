// Walk Planner server: serves the app and stores walks and settings on the server.
// Zero dependencies. Env: PORT (8080), HOST (127.0.0.1), DATA_DIR (./data),
// ALLOWED_HOSTS (extra hostnames/IPs the app is browsed at, comma-separated).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const DATA_PREV_FILE = path.join(DATA_DIR, 'data.prev.json');
const ROOT_DIR = __dirname;
const MAX_BODY = 1024 * 1024;

const ALLOWED_HOSTNAMES = new Set([
    'localhost', '127.0.0.1', '[::1]',
    ...(process.env.ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
]);

// Only the app's own files are served.
const STATIC_FILES = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
    '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8' },
    '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
    '/manifest.json': { file: 'manifest.json', type: 'application/manifest+json' },
    '/icon.png': { file: 'icon.png', type: 'image/png' }
};

function getHostname(hostHeader) {
    if (!hostHeader) return '';
    const h = hostHeader.trim().toLowerCase();
    if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
    return h.split(':')[0];
}

// Host must be allowed (defeats DNS rebinding); a browser-sent Origin must be this same host
// over http or https (the app sits behind an HTTPS reverse proxy).
function isTrustedRequest(req) {
    const host = req.headers.host || '';
    if (!ALLOWED_HOSTNAMES.has(getHostname(host))) return false;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) return false;
    return true;
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

// ---- data store: { nextId, walks: [...], settings: {...} } in one JSON file ----
function loadData() {
    try {
        const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
            nextId: Number.isInteger(d.nextId) ? d.nextId : 1,
            walks: Array.isArray(d.walks) ? d.walks : [],
            settings: d.settings && typeof d.settings === 'object' ? d.settings : {}
        };
    } catch (e) {
        if (e.code === 'ENOENT') return { nextId: 1, walks: [], settings: {} };
        throw e;
    }
}

function saveData(data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try { fs.copyFileSync(DATA_FILE, DATA_PREV_FILE); } catch (e) { /* first save */ }
    const tmp = DATA_FILE + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);   // atomic replace
}

function readJsonBody(req, res, cb) {
    const ct = (req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
    if (ct !== 'application/json') return sendJson(res, 415, { error: 'Content-Type must be application/json' });
    const chunks = [];
    let size = 0, aborted = false;
    req.on('data', c => {
        if (aborted) return;
        size += c.length;
        if (size > MAX_BODY) { aborted = true; sendJson(res, 413, { error: 'Payload too large' }); req.destroy(); return; }
        chunks.push(c);
    });
    req.on('end', () => {
        if (aborted) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
            return sendJson(res, 400, { error: 'Invalid JSON' });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'Body must be a JSON object' });
        cb(body);
    });
}

function handleApi(req, res, pathname) {
    const m = pathname.match(/^\/api\/(walks|settings)(?:\/(\d+))?$/);
    if (!m) return sendJson(res, 404, { error: 'Not found' });
    const [, resource, idStr] = m;
    let data;
    try { data = loadData(); } catch (e) {
        console.error('[Data] read error:', e.message);
        return sendJson(res, 500, { error: 'Could not read stored data' });
    }
    const persist = (fn) => {
        try { fn(); saveData(data); return true; } catch (e) {
            console.error('[Data] write error:', e.message);
            sendJson(res, 500, { error: 'Could not store data' });
            return false;
        }
    };

    if (resource === 'settings' && !idStr) {
        if (req.method === 'GET') return sendJson(res, 200, data.settings);
        if (req.method === 'DELETE') { if (persist(() => { data.settings = {}; })) sendJson(res, 200, {}); return; }
        if (req.method === 'PUT') return readJsonBody(req, res, body => {
            if (persist(() => { data.settings = body; })) sendJson(res, 200, data.settings);
        });
        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    if (resource === 'walks') {
        const id = idStr ? parseInt(idStr, 10) : null;
        if (id === null) {
            if (req.method === 'GET') return sendJson(res, 200, data.walks);
            if (req.method === 'DELETE') { if (persist(() => { data.walks = []; })) sendJson(res, 200, { success: true }); return; }
            if (req.method === 'POST') return readJsonBody(req, res, body => {
                let newId;
                if (persist(() => { newId = data.nextId++; data.walks.push({ ...body, id: newId }); })) sendJson(res, 201, { id: newId });
            });
            return sendJson(res, 405, { error: 'Method not allowed' });
        }
        const idx = data.walks.findIndex(w => w.id === id);
        if (idx === -1) return sendJson(res, 404, { error: 'Walk not found' });
        if (req.method === 'GET') return sendJson(res, 200, data.walks[idx]);
        if (req.method === 'DELETE') { if (persist(() => { data.walks.splice(idx, 1); })) sendJson(res, 200, { success: true }); return; }
        if (req.method === 'PUT') return readJsonBody(req, res, body => {
            if (persist(() => { data.walks[idx] = { ...body, id }; })) sendJson(res, 200, { id });
        });
        return sendJson(res, 405, { error: 'Method not allowed' });
    }
    sendJson(res, 405, { error: 'Method not allowed' });
}

function serveStatic(req, res, pathname) {
    const entry = STATIC_FILES[pathname];
    if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('404 Not Found');
    }
    const filePath = path.join(ROOT_DIR, entry.file);
    const headers = { 'Content-Type': entry.type, 'X-Content-Type-Options': 'nosniff' };
    if (entry.file === 'sw.js' || entry.file === 'index.html') headers['Cache-Control'] = 'no-cache';
    fs.readFile(filePath, (err, buf) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 Not Found'); }
        if (entry.file === 'index.html') {
            // Tell the page it is served by this server, so it stores its data here.
            buf = Buffer.from(buf.toString('utf8').replace('<script src="app.js"></script>',
                '<script>window.SERVER_STORAGE = true;</script>\n    <script src="app.js"></script>'), 'utf8');
        }
        headers['Content-Length'] = buf.length;
        res.writeHead(200, headers);
        res.end(req.method === 'HEAD' ? undefined : buf);
    });
}

const server = http.createServer((req, res) => {
    if (!isTrustedRequest(req)) return sendJson(res, 403, { error: 'Forbidden' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    serveStatic(req, res, pathname);
});

if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`Walk Planner running at http://localhost:${PORT} (listening on ${HOST}); data in ${DATA_DIR}`);
    });
}

module.exports = { server };
