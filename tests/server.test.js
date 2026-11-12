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
