import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE, toSql, worldChunkRows } from '../scripts/export-postgres.mjs';

test('PostgreSQL exporter separates world metadata and 256-cell chunks', () => {
	const db = { worlds: { official: { id: 'official', name: 'World', pixels: { '1:2': { c: '#e50000' }, [`${CHUNK_SIZE}:3`]: { c: '#0083c7' } } } } };
	const rows = worldChunkRows(db);
	assert.equal(rows.filter((row) => row.kind === 'world').length, 1);
	assert.equal(rows.filter((row) => row.kind === 'chunk').length, 2);
	assert.equal(rows.find((row) => row.kind === 'world').payload.pixels, undefined);
	assert.ok(rows.some((row) => row.kind === 'chunk' && row.chunkX === 1 && row.cells[`${CHUNK_SIZE}:3`].c === '#0083c7'));
	const sql = toSql(db);
	assert.match(sql, /INSERT INTO worlds/);
	assert.match(sql, /INSERT INTO world_chunks/);
	assert.match(sql, /BEGIN;[\s\S]*COMMIT;/);
});
