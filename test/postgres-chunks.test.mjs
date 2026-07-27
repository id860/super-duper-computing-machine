import test from 'node:test';
import assert from 'node:assert/strict';
import { handleChunkRequest, ChunkIndex } from '../src/http/chunks.mjs';

function response() { return { status: 0, body: null, writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } }; }
function world() { return { id: 'official', infinite: true, width: 1000, height: 1000, background: '#fff', access: { mode: 'public' }, members: {}, pixels: { '1:2': { c: '#e50000' } } }; }
test('Postgres chunk reader is used in postgres mode', async () => {
	const previous = process.env.CHUNK_READ_MODE; process.env.CHUNK_READ_MODE = 'postgres';
	try { const w = world(), db = { worlds: { official: w } }, res = response(); const mirror = { readChunks: async () => new Map([['0:0', [[1, 2, '#0083c7']]]]) };
		await handleChunkRequest({ method: 'GET', url: '/api/worlds/official/chunks?cx=0&cy=0' }, res, { user: null, session: null }, db, new ChunkIndex(db), mirror);
		assert.equal(res.status, 200); assert.equal(res.body.storage, 'postgres'); assert.deepEqual(res.body.chunks[0].cells, [[1, 2, '#0083c7']]);
	} finally { if (previous === undefined) delete process.env.CHUNK_READ_MODE; else process.env.CHUNK_READ_MODE = previous; }
});
test('failed Postgres reader safely falls back to JSON index', async () => {
	const previous = process.env.CHUNK_READ_MODE; process.env.CHUNK_READ_MODE = 'postgres';
	try { const w = world(), db = { worlds: { official: w } }, res = response(); await handleChunkRequest({ method: 'GET', url: '/api/worlds/official/chunks?cx=0&cy=0' }, res, { user: null, session: null }, db, new ChunkIndex(db), { readChunks: async () => { throw new Error('offline'); } }); assert.equal(res.body.storage, 'json'); assert.deepEqual(res.body.chunks[0].cells, [[1, 2, '#e50000']]);
	} finally { if (previous === undefined) delete process.env.CHUNK_READ_MODE; else process.env.CHUNK_READ_MODE = previous; }
});
