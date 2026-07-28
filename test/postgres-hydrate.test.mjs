import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateWorldRows } from '../src/core/postgres-mirror.mjs';

test('postgres world metadata and chunks become the startup source', () => {
	const db = { worlds: { official: { id: 'official', name: 'JSON copy', pixels: { '9:9': { c: '#old' } }, pixelHistory: [{ at: 1 }] } } };
	const count = hydrateWorldRows(db, [{ id: 'official', payload: { name: 'Postgres copy', background: '#fff' } }], [{ world_id: 'official', cells: { '1:2': { c: '#new' } } }]);
	assert.equal(count, 1);
	assert.equal(db.worlds.official.name, 'Postgres copy');
	assert.deepEqual(db.worlds.official.pixels, { '1:2': { c: '#new' } });
	assert.deepEqual(db.worlds.official.pixelHistory, [{ at: 1 }]);
});

test('empty postgres world list leaves JSON fallback unchanged', () => {
	const db = { worlds: { official: { pixels: { '1:1': { c: '#a' } } } } };
	assert.equal(hydrateWorldRows(db, [], []), 0);
	assert.equal(db.worlds.official.pixels['1:1'].c, '#a');
});
