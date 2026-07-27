import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let child, dataDir;
const client = { cookie: '', csrf: '' };

async function request(path, opts = {}) {
	const method = opts.method || 'GET';
	const headers = { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(client.cookie ? { cookie: client.cookie } : {}), ...(opts.headers || {}) };
	if (!['GET', 'HEAD'].includes(method)) { headers.origin = BASE; if (client.csrf) headers['x-csrf-token'] = client.csrf; }
	const res = await fetch(BASE + path, { method, headers, body: opts.body });
	const cookie = res.headers.get('set-cookie'), csrf = res.headers.get('x-csrf-token');
	if (cookie) client.cookie = cookie.split(';')[0]; if (csrf) client.csrf = csrf;
	return { res, data: await res.json() };
}
async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/config')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 40)); } throw new Error('server not ready'); }
async function pixelEventStream() {
	const controller = new AbortController();
	const res = await fetch(BASE + '/api/stream?world=official', { headers: { cookie: client.cookie }, signal: controller.signal });
	assert.equal(res.status, 200);
	const reader = res.body.getReader(), decoder = new TextDecoder();
	const event = (async () => {
		let text = '';
		while (true) {
			const { value, done } = await reader.read(); if (done) throw new Error('SSE ended before pixel event');
			text += decoder.decode(value, { stream: true });
			const match = /event: pixels\ndata: (.+)\n\n/.exec(text);
			if (match) return JSON.parse(match[1]);
		}
	})();
	return { event, close: () => controller.abort() };
}

test.before(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'pixelfront-chunks-'));
	child = spawn(process.execPath, ['server-v3.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, AUTOMATION_INTERVAL_MS: '9999999' }, stdio: 'ignore' });
	await ready();
});
test.after(async () => { child.kill('SIGTERM'); await once(child, 'exit'); await rm(dataDir, { recursive: true, force: true }); });

test('infinite bootstrap omits full pixels and chunks return only requested cells', async () => {
	let r = await request('/api/config'); assert.equal(r.res.status, 200);
	r = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ nick: 'ChunkArtist', password: 'safe-password-123' }) });
	assert.equal(r.res.status, 200); assert.ok(client.cookie); assert.ok(client.csrf);
	r = await request('/api/worlds/official?viewport=1');
	assert.equal(r.res.status, 200); assert.equal(r.data.viewport, true); assert.deepEqual(r.data.pixels, []);
	r = await request('/api/worlds/official/ops', { method: 'POST', body: JSON.stringify({ tool: 'pixel', color: '#e50000', cells: [[7, 9]] }) });
	assert.equal(r.res.status, 200); assert.equal(r.data.applied, 1);
	r = await request('/api/worlds/official/chunks?cx=0&cy=0&radius=0');
	assert.equal(r.res.status, 200); assert.equal(r.data.chunkSize, 256);
	assert.ok(r.data.chunks[0].cells.some(([x, y, c]) => x === 7 && y === 9 && c === '#e50000'));
});

test('SSE broadcasts authored pixels after the chunk index is warm', async () => {
	const stream = await pixelEventStream();
	try {
		const r = await request('/api/worlds/official/ops', { method: 'POST', body: JSON.stringify({ tool: 'pixel', color: '#0083c7', cells: [[11, 13]] }) });
		assert.equal(r.res.status, 200);
		const event = await Promise.race([stream.event, new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 3000))]);
		assert.equal(event.by, 'ChunkArtist');
		assert.deepEqual(event.pixels, [[11, 13, '#0083c7']]);
	} finally { stream.close(); }
});

test('mutating requests still require CSRF', async () => {
	const saved = client.csrf; client.csrf = '';
	const r = await request('/api/worlds/official/ops', { method: 'POST', body: JSON.stringify({ tool: 'pixel', color: '#e50000', cells: [[8, 9]] }) });
	client.csrf = saved;
	assert.equal(r.res.status, 403);
});
