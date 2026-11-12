const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let server, port, dataDir;

function req(method, urlPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const r = http.request({
            host: '127.0.0.1', port, path: urlPath, method,
            headers: { Host: `localhost:${port}`, ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers }
        }, res => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        r.on('error', reject);
        if (payload) r.write(payload);
        r.end();
    });
}

beforeAll(done => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walks-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
    ({ server } = require('../server'));
    server.listen(0, '127.0.0.1', () => { port = server.address().port; done(); });
});
afterAll(done => { server.closeAllConnections(); server.close(() => done()); });

test('starts empty', async () => {
    expect(JSON.parse((await req('GET', '/api/walks')).body)).toEqual([]);
    expect(JSON.parse((await req('GET', '/api/settings')).body)).toEqual({});
});

test('create, update, list, delete walks with server-assigned ids', async () => {
    const a = JSON.parse((await req('POST', '/api/walks', { name: 'A', lat: 1, lng: 2 })).body);
    const b = JSON.parse((await req('POST', '/api/walks', { name: 'B' })).body);
    expect(b.id).toBe(a.id + 1);
    await req('PUT', `/api/walks/${a.id}`, { name: 'A2', id: 999 });
    const list = JSON.parse((await req('GET', '/api/walks')).body);
    expect(list.find(w => w.id === a.id).name).toBe('A2');
    expect(list.some(w => w.id === 999)).toBe(false);
    await req('DELETE', `/api/walks/${a.id}`);
    expect(JSON.parse((await req('GET', '/api/walks')).body).map(w => w.name)).toEqual(['B']);
    expect((await req('PUT', '/api/walks/12345', { name: 'x' })).status).toBe(404);
    await req('DELETE', '/api/walks');
    expect(JSON.parse((await req('GET', '/api/walks')).body)).toEqual([]);
});

test('settings round trip and persistence on disk', async () => {
    await req('PUT', '/api/settings', { tempMin: 50 });
    expect(JSON.parse((await req('GET', '/api/settings')).body)).toEqual({ tempMin: 50 });
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'data.json'), 'utf8')).settings.tempMin).toBe(50);
    await req('DELETE', '/api/settings');
    expect(JSON.parse((await req('GET', '/api/settings')).body)).toEqual({});
});

test('security: host, origin and content-type checks', async () => {
    expect((await req('GET', '/api/walks', undefined, { Host: 'evil.com' })).status).toBe(403);
    expect((await req('POST', '/api/walks', { name: 'x' }, { Origin: 'https://evil.com' })).status).toBe(403);
    expect((await req('POST', '/api/walks', { name: 'x' }, { Origin: `https://localhost:${port}` })).status).toBe(201);
    const r = await new Promise(resolve => {
        const q = http.request({ host: '127.0.0.1', port, path: '/api/walks', method: 'POST', headers: { Host: `localhost:${port}`, 'Content-Type': 'text/plain' } }, res => resolve(res.statusCode));
        q.end('{}');
    });
    expect(r).toBe(415);
});

test('serves only app files, and flags server storage in index.html', async () => {
    const page = await req('GET', '/');
    expect(page.status).toBe(200);
    expect(page.body).toContain('window.SERVER_STORAGE = true');
    expect((await req('GET', '/server.js')).status).toBe(404);
    expect((await req('GET', '/package.json')).status).toBe(404);
    expect((await req('GET', '/sw.js')).status).toBe(200);
});

describe('weather/tide cache', () => {
    let realFetch, upstream;
    const srv = () => require('../server');
    const addWalk = (lat, lng, isBeach = false) => req('POST', '/api/walks', { name: 'W', lat, lng, isBeach });
    beforeEach(async () => {
        realFetch = global.fetch;
        upstream = [];
        global.fetch = async (url) => {
            upstream.push(String(url));
            return { ok: true, status: 200, json: async () => ({ upstream: String(url), current: { temperature_2m: 70 } }) };
        };
        srv().resetForecastState();
        await req('DELETE', '/api/walks');
    });
    afterEach(() => { global.fetch = realFetch; });

    test('fetches once per location, then serves from cache', async () => {
        await addWalk(29.5123, -81.2);
        const a = await req('GET', '/api/weather?lat=29.51234567&lng=-81.2');
        const b = await req('GET', '/api/weather?lat=29.51231&lng=-81.20001');
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect(upstream.length).toBe(1);
        expect(upstream[0]).toContain('api.open-meteo.com/v1/forecast?latitude=29.5123&longitude=-81.2');
        expect(a.headers['x-fetched-at']).toBeTruthy();
        expect(JSON.parse(a.body).current.temperature_2m).toBe(70);
    });

    test('concurrent requests share one upstream call', async () => {
        await addWalk(30, -81, true);
        const [a, b] = await Promise.all([req('GET', '/api/tide?lat=30&lng=-81'), req('GET', '/api/tide?lat=30&lng=-81')]);
        expect([a.status, b.status]).toEqual([200, 200]);
        expect(upstream.filter(u => u.includes('marine-api')).length).toBe(1);
    });

    test('force refresh is ignored while data is fresh (protects Open-Meteo)', async () => {
        await addWalk(1, 2);
        await req('GET', '/api/weather?lat=1&lng=2');
        await req('GET', '/api/weather?lat=1&lng=2&refresh=1');
        expect(upstream.length).toBe(1);
    });

    test('only locations of saved walks are served (no arbitrary upstream requests)', async () => {
        await addWalk(1, 2);
        const before = upstream.length;
        for (let i = 0; i < 20; i++) expect((await req('GET', `/api/weather?lat=${40 + i}&lng=9`)).status).toBe(404);
        expect(upstream.length).toBe(before);
    });

    test('keeps serving the last good data when Open-Meteo fails, and does not hammer it', async () => {
        await addWalk(5, 6);
        await req('GET', '/api/weather?lat=5&lng=6');
        [...srv().forecastCache.values()][0].fetchedAt = 0; // pretend it expired
        let failing = 0;
        global.fetch = async () => { failing++; return { ok: false, status: 503, json: async () => ({}) }; };
        for (let i = 0; i < 10; i++) {
            const r = await req('GET', '/api/weather?lat=5&lng=6');
            expect(r.status).toBe(200);
            expect(JSON.parse(r.body).current.temperature_2m).toBe(70);
        }
        expect(failing).toBe(1); // one attempt, then backs off for a minute
    });

    test('with no data and Open-Meteo down: 502, and only one upstream attempt per backoff window', async () => {
        await addWalk(7, 8);
        let calls = 0;
        global.fetch = async () => { calls++; throw new Error('offline'); };
        for (let i = 0; i < 8; i++) expect((await req('GET', '/api/weather?lat=7&lng=8')).status).toBe(502);
        expect(calls).toBe(1);
        expect((await req('GET', '/api/weather?lat=abc&lng=8')).status).toBe(400);
        expect((await req('GET', '/api/weather?lat=95&lng=8')).status).toBe(400);
        expect((await req('POST', '/api/weather?lat=1&lng=2', {})).status).toBe(405);
    });

    test('HTTP 429 pauses all upstream calls', async () => {
        await addWalk(10, 11);
        await addWalk(12, 13);
        let calls = 0;
        global.fetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({}) }; };
        await req('GET', '/api/weather?lat=10&lng=11');
        await req('GET', '/api/weather?lat=12&lng=13');
        await req('GET', '/api/tide?lat=12&lng=13');
        expect(calls).toBe(1); // the other locations did not even try
    });

    test('hard hourly cap stops upstream calls', async () => {
        await addWalk(20, 21);
        const now = Date.now();
        for (let i = 0; i < 1000; i++) srv().upstreamLog.push(now - 1000);
        expect((await req('GET', '/api/weather?lat=20&lng=21')).status).toBe(502);
        expect(upstream.length).toBe(0);
    });

    test('background refresher warms the cache, and refreshes before the TTL expires', async () => {
        await addWalk(29.6, -81.2, true);
        await srv().refreshSavedWalks();
        expect(upstream.some(u => u.includes('latitude=29.6&longitude=-81.2') && u.includes('/forecast'))).toBe(true);
        expect(upstream.some(u => u.includes('latitude=29.6&longitude=-81.2') && u.includes('marine'))).toBe(true);
        const before = upstream.length;
        await req('GET', '/api/weather?lat=29.6&lng=-81.2');
        expect(upstream.length).toBe(before); // served from the warmed cache
        // 25 min later (inside the last 10 min before the 30-min TTL): the refresher refetches weather, not tide
        for (const e of srv().forecastCache.values()) e.fetchedAt -= 25 * 60 * 1000;
        await srv().refreshSavedWalks();
        expect(upstream.length - before).toBe(1);
        expect(upstream[upstream.length - 1]).toContain('/forecast');
    });
});
