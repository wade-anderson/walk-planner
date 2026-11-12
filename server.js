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

// ---- Weather / tide cache ----
// Clients ask the server instead of Open-Meteo. The server fetches once per location, caches the
// result, and refreshes it in the background for every saved walk, so phones get an instant
// answer and Open-Meteo sees one request per location per interval instead of one per device.
const WEATHER_TTL_MS = (parseInt(process.env.WEATHER_TTL_MIN, 10) || 30) * 60 * 1000; // current conditions update every 15 min
const TIDE_TTL_MS = (parseInt(process.env.TIDE_TTL_MIN, 10) || 360) * 60 * 1000;      // tide predictions barely change
const FORCE_MIN_AGE_MS = 5 * 60 * 1000;   // an explicit "Update" refetches only if data is older than this
const REFRESH_CHECK_MS = 10 * 60 * 1000;  // how often the background refresher looks for stale entries
const UNUSED_EXPIRY_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const UPSTREAM_TIMEOUT_MS = 10000;

const FORECAST_KINDS = {
    weather: {
        ttl: WEATHER_TTL_MS,
        url: (lat, lng) => `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
            '&current=temperature_2m,apparent_temperature,wind_speed_10m,weather_code' +
            '&hourly=apparent_temperature,wind_speed_10m,weather_code,is_day' +
            '&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph'
    },
    tide: {
        ttl: TIDE_TTL_MS,
        url: (lat, lng) => `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}` +
            '&hourly=sea_level_height_msl&timezone=auto'
    }
};

// key "kind|lat|lng" -> { kind, lat, lng, data, fetchedAt, lastUsed, inflight }
const forecastCache = new Map();

function roundCoord(v) {
    return Math.round(v * 10000) / 10000; // ~11 m: same spot -> same cache entry
}

function parseCoords(searchParams) {
    const lat = Number(searchParams.get('lat'));
    const lng = Number(searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

async function fetchUpstream(kind, lat, lng) {
    const res = await fetch(FORECAST_KINDS[kind].url(lat, lng), { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Open-Meteo ${kind} HTTP ${res.status}`);
    return res.json();
}

// Returns the cache entry, fetching when missing/stale. Concurrent callers share one upstream request.
// If a refresh fails but older data exists, the older data is kept and returned.
async function getForecast(kind, lat, lng, { force = false } = {}) {
    const key = `${kind}|${lat}|${lng}`;
    let entry = forecastCache.get(key);
    if (!entry) {
        if (forecastCache.size >= MAX_CACHE_ENTRIES) pruneForecastCache(true);
        entry = { kind, lat, lng, data: null, fetchedAt: 0, lastUsed: Date.now(), inflight: null };
        forecastCache.set(key, entry);
    }
    const age = Date.now() - entry.fetchedAt;
    const stale = !entry.data || age >= FORECAST_KINDS[kind].ttl || (force && age >= FORCE_MIN_AGE_MS);
    if (stale) {
        if (!entry.inflight) {
            entry.inflight = fetchUpstream(kind, lat, lng)
                .then(data => { entry.data = data; entry.fetchedAt = Date.now(); })
                .catch(err => { console.error(`[Forecast] ${err.message} (${lat},${lng})`); if (!entry.data) throw err; })
                .finally(() => { entry.inflight = null; });
        }
        await entry.inflight;
    }
    return entry;
}

function pruneForecastCache(makeRoom = false) {
    const now = Date.now();
    for (const [key, e] of forecastCache) {
        if (!e.inflight && now - e.lastUsed > UNUSED_EXPIRY_MS) forecastCache.delete(key);
    }
    if (makeRoom && forecastCache.size >= MAX_CACHE_ENTRIES) {
        const oldest = [...forecastCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (oldest) forecastCache.delete(oldest[0]);
    }
}

// Keep every saved walk's forecast warm so clients never wait on Open-Meteo.
async function refreshSavedWalks() {
    let walks = [];
    try { walks = loadData().walks; } catch (e) { return; }
    for (const w of walks) {
        const lat = Number(w.lat), lng = Number(w.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const kinds = w.isBeach ? ['weather', 'tide'] : ['weather'];
        for (const kind of kinds) {
            // refresh a little before expiry so a client request rarely finds stale data
            const key = `${kind}|${roundCoord(lat)}|${roundCoord(lng)}`;
            const e = forecastCache.get(key);
            if (e && e.data && Date.now() - e.fetchedAt < FORECAST_KINDS[kind].ttl - REFRESH_CHECK_MS) continue;
            try { await getForecast(kind, roundCoord(lat), roundCoord(lng)); } catch (err) { /* logged */ }
        }
    }
    pruneForecastCache();
}

function handleForecast(req, res, kind, searchParams) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
    const c = parseCoords(searchParams);
    if (!c) return sendJson(res, 400, { error: 'lat and lng must be valid coordinates' });
    getForecast(kind, c.lat, c.lng, { force: searchParams.get('refresh') === '1' })
        .then(entry => {
            entry.lastUsed = Date.now();
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
                'X-Fetched-At': new Date(entry.fetchedAt).toISOString()
            });
            res.end(JSON.stringify(entry.data));
        })
        .catch(() => sendJson(res, 502, { error: `${kind} data unavailable` }));
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
    if (pathname === '/api/weather' || pathname === '/api/tide') {
        return handleForecast(req, res, pathname.slice(5), new URL(req.url, 'http://localhost').searchParams);
    }
    if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
    serveStatic(req, res, pathname);
});

if (require.main === module) {
    refreshSavedWalks();
    setInterval(refreshSavedWalks, REFRESH_CHECK_MS).unref();
    server.listen(PORT, HOST, () => {
        console.log(`Walk Planner running at http://localhost:${PORT} (listening on ${HOST}); data in ${DATA_DIR}`);
    });
}

module.exports = { server, refreshSavedWalks, forecastCache };
