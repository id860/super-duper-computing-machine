import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ChunkIndex, handleChunkRequest } from '../src/http/chunks.mjs';
const response = () => ({ status: 0, body: null, writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } });
const makeWorld = () => { const pixels = {}; for (let n = 0; n < 4000; n++) pixels[`${n % 1000}:${Math.floor(n / 1000)}`] = { c: '#000000' }; return { id: 'official', type: 'official', infinite: true, width: 1000, height: 1000, background: '#fff', access: { mode: 'public' }, lifecycle: { state: 'active' }, members: {}, pixels }; };
test('concurrent viewport chunk requests are bounded and indexed', async () => { const world = makeWorld(), db = { worlds: { official: world } }, index = new ChunkIndex(db), started = performance.now(); const results = await Promise.all(Array.from({ length: 80 }, async (_, i) => { const res = response(); await handleChunkRequest({ method: 'GET', url: `/api/worlds/official/chunks?cx=${i % 8}&cy=${Math.floor(i / 8)}&radius=1` }, res, { user: null, session: null }, db, index); return res; })); const elapsed = performance.now() - started; assert.equal(results.length, 80); assert.ok(results.every((r) => r.status === 200 && r.body.chunks.length <= 9)); assert.ok(elapsed < 1500, `indexed chunk load took ${elapsed}ms`); });
