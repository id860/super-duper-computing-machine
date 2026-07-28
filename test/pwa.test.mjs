import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const src = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('PWA manifest and registration are wired into the shell', async () => {
	const [html, manifest, register] = await Promise.all([src('public/index.html'), src('public/manifest.webmanifest'), src('public/app/pwa.js')]);
	assert.match(html, /rel="manifest"/);
	assert.match(html, /app\/pwa\.js/);
	assert.equal(JSON.parse(manifest).display, 'standalone');
	assert.match(register, /serviceWorker\.register/);
});

test('service worker never intercepts API requests', async () => {
	const worker = await src('public/sw.js');
	assert.match(worker, /pathname\.startsWith\('\/api\/'\)/);
	assert.match(worker, /request\.method !== 'GET'/);
	assert.match(worker, /request\.mode === 'navigate'/);
});
