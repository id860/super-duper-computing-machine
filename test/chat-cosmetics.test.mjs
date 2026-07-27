import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4300 + Math.floor(Math.random() * 300), BASE = `http://127.0.0.1:${PORT}`;
let child, dataDir; const client = { cookie: '', csrf: '' };
async function request(path, opts = {}) { const method = opts.method || 'GET', headers = { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(client.cookie ? { cookie: client.cookie } : {}), ...(opts.headers || {}) }; if (!['GET', 'HEAD'].includes(method)) { headers.origin = BASE; if (client.csrf) headers['x-csrf-token'] = client.csrf; } const res = await fetch(BASE + path, { method, headers, body: opts.body }), cookie = res.headers.get('set-cookie'), csrf = res.headers.get('x-csrf-token'); if (cookie) client.cookie = cookie.split(';')[0]; if (csrf) client.csrf = csrf; return { res, data: await res.json() }; }
async function ready() { for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/config')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 40)); } throw new Error('server not ready'); }

test.before(async () => { dataDir = await mkdtemp(join(tmpdir(), 'pixelfront-cosmetics-')); child = spawn(process.execPath, ['server-v3.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, AUTOMATION_INTERVAL_MS: '9999999' }, stdio: 'ignore' }); await ready(); });
test.after(async () => { child.kill('SIGTERM'); await once(child, 'exit'); await rm(dataDir, { recursive: true, force: true }); });

test('chat history and public lookup expose each author cosmetics', async () => {
	let r = await request('/api/auth/register', { method: 'POST', body: JSON.stringify({ nick: 'ChatPainter', password: 'safe-password-123' }) });
	assert.equal(r.res.status, 200);
	// The official world lets members write in chat, so join before posting.
	r = await request('/api/worlds/official/join', { method: 'POST', body: JSON.stringify({}) });
	assert.equal(r.res.status, 200);
	r = await request('/api/worlds/official/chat', { method: 'POST', body: JSON.stringify({ text: 'hello cosmetics' }) });
	assert.equal(r.res.status, 200);
	r = await request('/api/worlds/official/chat');
	assert.equal(r.res.status, 200);
	const message = r.data.messages.find((item) => item.text === 'hello cosmetics');
	assert.ok(message, 'message stored');
	assert.deepEqual(message.cosmetics, {});
	assert.deepEqual(r.data.cosmetics.ChatPainter, {});
	r = await request('/api/cosmetics?nick=ChatPainter');
	assert.equal(r.res.status, 200);
	assert.equal(r.data.nick, 'ChatPainter');
	assert.deepEqual(r.data.cosmetics, {});
	r = await request('/api/cosmetics?nick=NoSuchPlayer');
	assert.equal(r.res.status, 200);
	assert.equal(r.data.nick, null);
	assert.deepEqual(r.data.cosmetics, {});
});

test('preferences report equipped slots only for owned cosmetics', async () => {
	const r = await request('/api/me/preferences');
	assert.equal(r.res.status, 200);
	assert.deepEqual(r.data.cosmetics.equipped, {});
	const denied = await request('/api/me/cosmetics', { method: 'POST', body: JSON.stringify({ key: 'badge_pioneer', slot: 'badge' }) });
	assert.equal(denied.res.status, 403);
});
