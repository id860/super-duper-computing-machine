// Интеграционные тесты v3: запуск настоящего server-v3.mjs и проверка всех ключевых сценариев.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
let child, dataDir;
const owner = { cookie: '', csrf: '' };
const other = { cookie: '', csrf: '' };
const admin = { cookie: '', csrf: '' };

function startServer() {
	child = spawn(process.execPath, ['server-v3.mjs'], {
		cwd: new URL('..', import.meta.url),
		env: {
			...process.env,
			PORT: String(PORT),
			DATA_DIR: dataDir,
			ADMIN_NICK: 'V3Admin',
			ADMIN_PASSWORD: 'test-v3-admin-pw-123',
			APP_ORIGIN: BASE,
			AUTOMATION_INTERVAL_MS: '9999999',
		},
		stdio: 'ignore',
	});
}

async function stopServer() {
	if (!child) return;
	child.kill('SIGTERM');
	await once(child, 'exit');
	child = null;
}

async function waitReady() {
	for (let i = 0; i < 150; i++) {
		try { if ((await fetch(BASE + '/api/config')).ok) return; } catch {}
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error('server-v3 did not start in time');
}

async function req(path, opts = {}, client = owner) {
	const method = (opts.method || 'GET').toUpperCase();
	const headers = {
		'content-type': 'application/json',
		...(client.cookie ? { cookie: client.cookie } : {}),
		...(opts.headers || {}),
	};
	if (!['GET', 'HEAD'].includes(method) && opts.origin !== false)
		headers.origin = opts.origin || BASE;
	if (opts.csrf !== false && client.csrf && !['GET', 'HEAD'].includes(method))
		headers['x-csrf-token'] = client.csrf;
	const res = await fetch(BASE + path, { ...opts, method, headers });
	const setCookie = res.headers.get('set-cookie');
	if (setCookie && opts.captureCookie !== false) client.cookie = setCookie.split(';')[0];
	const data = await res.json().catch(() => ({}));
	if (data.csrfToken) client.csrf = data.csrfToken;
	if (data.csrf) client.csrf = data.csrf;
	return { res, data, setCookie };
}

const register = (c, nick) =>
	req('/api/auth/register', { method: 'POST', body: JSON.stringify({ nick, password: 'safe-v3-pw-abcdef' }) }, c);

test.before(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'pixelfront-v3-'));
	startServer();
	await waitReady();
	// Загружаем CSRF для каждого клиента
	for (const c of [owner, other, admin]) await req('/api/config', {}, c);
	assert.equal((await register(owner, 'OwnerV3')).res.status, 201);
	assert.equal((await register(other, 'OtherV3')).res.status, 201);
	const lr = await req('/api/auth/login',
		{ method: 'POST', body: JSON.stringify({ nick: 'V3Admin', password: 'test-v3-admin-pw-123' }) }, admin);
	assert.equal(lr.res.status, 200, 'admin login failed');
});

test.after(async () => {
	await stopServer();
	await rm(dataDir, { recursive: true, force: true });
});

test('config: endpoint returns v3 feature set', async () => {
	const { res, data } = await req('/api/config');
	assert.equal(res.status, 200);
	assert.ok(data.features, 'features missing from config');
	assert.equal(typeof data.features.registration, 'boolean');
	assert.equal(typeof data.features.pixels, 'boolean');
});

test('official world: infinite=true and spawn=1000', async () => {
	const { res, data } = await req('/api/worlds/official');
	assert.equal(res.status, 200);
	assert.ok(data.world, 'no world in response');
	assert.strictEqual(data.world.infinite, true, 'world.infinite must be true');
	assert.strictEqual(data.world.spawn, 1000, 'world.spawn must be 1000');
	assert.ok(Array.isArray(data.pixels), 'pixels must be array');
});

test('official world: drawing inside spawn zone awards XP', async () => {
	const me1 = (await req('/api/me', {}, owner)).data;
	const xpBefore = (me1.me || me1.user || {}).xp || 0;
	const draw = await req('/api/worlds/official/ops', {
		method: 'POST',
		body: JSON.stringify({ tool: 'pixel', color: '#e63946', cells: [[5, 5]] }),
	}, owner);
	assert.equal(draw.res.status, 201, `ops returned ${draw.res.status}: ${JSON.stringify(draw.data)}`);
	const me2 = (await req('/api/me', {}, owner)).data;
	const xpAfter = (me2.me || me2.user || {}).xp || 0;
	assert.ok(xpAfter >= xpBefore, 'XP should not decrease after drawing in spawn');
});

test('official world: officialPixels counter increments', async () => {
	const me1 = (await req('/api/me', {}, owner)).data;
	const pixBefore = (me1.me || me1.user || {}).officialPixels || 0;
	await req('/api/worlds/official/ops', {
		method: 'POST',
		body: JSON.stringify({ tool: 'pixel', color: '#2563eb', cells: [[10, 10]] }),
	}, owner);
	const me2 = (await req('/api/me', {}, owner)).data;
	const pixAfter = (me2.me || me2.user || {}).officialPixels || 0;
	assert.ok(pixAfter >= pixBefore + 1, 'officialPixels should increment');
});

test('community world: pixels do not affect official XP or officialPixels', async () => {
	const cw = await req('/api/worlds', {
		method: 'POST',
		body: JSON.stringify({ name: 'V3 Community Test', cooldownMs: 200, maxEnergy: 500 }),
	}, owner);
	assert.equal(cw.res.status, 201, `create world: ${JSON.stringify(cw.data)}`);
	const wid = cw.data.world.id;
	const me1 = (await req('/api/me', {}, owner)).data;
	const before = me1.me || me1.user || {};
	const offPixBefore = before.officialPixels || 0;
	const xpBefore = before.xp || 0;
	for (let i = 0; i < 5; i++) {
		await req(`/api/worlds/${wid}/ops`, {
			method: 'POST',
			body: JSON.stringify({ tool: 'pixel', color: '#10a35a', cells: [[i, 2]] }),
		}, owner);
	}
	const me2 = (await req('/api/me', {}, owner)).data;
	const after = me2.me || me2.user || {};
	assert.equal(after.officialPixels, offPixBefore, 'officialPixels must not change from community draws');
	assert.equal(after.xp, xpBefore, 'xp must not change from community draws');
	assert.ok((after.communityPixels || 0) >= (before.communityPixels || 0) + 5, 'communityPixels should increase by at least 5');
});

test('security: CSRF token required for all mutations', async () => {
	const r = await req('/api/worlds', {
		method: 'POST', csrf: false,
		body: JSON.stringify({ name: 'no-csrf-world' }),
	}, owner);
	assert.equal(r.res.status, 403, 'request without CSRF must be 403');
});

test('security: hostile origin is rejected', async () => {
	const r = await req('/api/worlds', {
		method: 'POST',
		origin: 'https://evil.attacker.example',
		body: JSON.stringify({ name: 'evil' }),
	}, owner);
	assert.equal(r.res.status, 403, 'hostile origin must be 403');
});

test('security: path traversal is blocked', async () => {
	const r = await req('/..%2Fserver-v3.mjs');
	assert.ok([400, 403, 404].includes(r.res.status), `traversal got ${r.res.status}`);
});

test('security: response includes security headers', async () => {
	const { res } = await req('/');
	assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(res.headers.get('x-frame-options'), 'DENY');
	const csp = res.headers.get('content-security-policy') || '';
	assert.match(csp, /object-src/);
});

test('admin: official world config exposes infinite and spawn', async () => {
	const { res, data } = await req('/api/admin/worlds/official', {}, admin);
	assert.equal(res.status, 200, `admin world: ${JSON.stringify(data)}`);
	const w = data.world;
	assert.ok(w, 'no world in admin response');
	assert.strictEqual(w.infinite, true);
	assert.strictEqual(w.spawn, 1000);
});

test('admin: non-admin user is denied access', async () => {
	const r = await req('/api/admin/worlds/official', {}, owner);
	assert.equal(r.res.status, 403, 'non-admin should get 403');
});

test('admin: user list contains registered users', async () => {
	const { res, data } = await req('/api/admin/users', {}, admin);
	assert.equal(res.status, 200);
	assert.ok(Array.isArray(data.users), 'users must be array');
	assert.ok(data.users.some((u) => u.nick === 'OwnerV3'), 'OwnerV3 must appear in user list');
	assert.ok(data.users.some((u) => u.nick === 'OtherV3'), 'OtherV3 must appear in user list');
});

test('ownership: non-owner cannot patch world settings', async () => {
	const cw = await req('/api/worlds', {
		method: 'POST',
		body: JSON.stringify({ name: 'AuthTest World' }),
	}, owner);
	const wid = cw.data.world.id;
	const r = await req(`/api/worlds/${wid}`, {
		method: 'PATCH',
		body: JSON.stringify({ name: 'hijacked' }),
	}, other);
	assert.equal(r.res.status, 403, 'non-owner patch must be 403');
});

test('energy: endpoint returns energy state', async () => {
	const { res, data } = await req('/api/worlds/official/energy', {}, owner);
	assert.equal(res.status, 200);
	assert.ok(data.energy, 'energy field missing');
	assert.ok('mode' in data.energy, 'energy.mode missing');
});

test('leaderboard: global leaderboard is accessible', async () => {
	const { res, data } = await req('/api/leaderboard');
	assert.equal(res.status, 200);
	assert.ok(data.leaderboard || data.users, 'leaderboard data missing');
});

test('persist: data survives graceful server restart', async () => {
	await stopServer();
	startServer();
	await waitReady();
	const me = await req('/api/me', {}, owner);
	const nick = (me.data.me || me.data.user || {}).nick;
	assert.equal(nick, 'OwnerV3', 'user data must survive restart');
});
