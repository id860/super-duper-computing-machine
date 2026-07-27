import test from 'node:test';
import assert from 'node:assert/strict';
import { centerChunk, chunkKey, missingRadius, ringKeys } from '../public/app/chunk-queue.js';
import { CACHE_TTL_MS, isFresh, recordKey } from '../public/app/chunk-store.js';

test('centre chunk follows the viewport and never leaves the served quadrant', () => {
	const view = { offsetX: 0, offsetY: 0, scale: 1, viewW: 172, viewH: 172 };
	assert.deepEqual(centerChunk(view, 86), { cx: 1, cy: 1 });
	assert.deepEqual(centerChunk({ ...view, offsetX: 860, offsetY: 860 }, 86), { cx: 0, cy: 0 });
	assert.deepEqual(centerChunk({ ...view, scale: 0 }, 86), { cx: 0, cy: 0 });
});

test('ring keys grow outwards and skip negative chunks', () => {
	assert.deepEqual(ringKeys(4, 4, 0), ['4:4']);
	assert.equal(ringKeys(4, 4, 1).length, 8);
	assert.equal(ringKeys(4, 4, 2).length, 16);
	assert.deepEqual(ringKeys(0, 0, 1), ['1:0', '0:1', '1:1']);
	assert.ok(!ringKeys(0, 0, 2).some((key) => key.includes('-')));
	assert.equal(chunkKey(2, 3), '2:3');
});

test('progressive loader asks for the closest incomplete ring only', () => {
	const loaded = new Set();
	assert.equal(missingRadius(5, 5, loaded, 2), 0);
	for (const key of ringKeys(5, 5, 0)) loaded.add(key);
	assert.equal(missingRadius(5, 5, loaded, 2), 1);
	for (const key of ringKeys(5, 5, 1)) loaded.add(key);
	assert.equal(missingRadius(5, 5, loaded, 2), 2);
	for (const key of ringKeys(5, 5, 2)) loaded.add(key);
	assert.equal(missingRadius(5, 5, loaded, 2), -1);
});

test('cached chunks expire and malformed records are ignored', () => {
	const now = 1000000;
	assert.equal(recordKey('official', '3:4'), 'official/3:4');
	assert.equal(isFresh({ cells: [], at: now }, now), true);
	assert.equal(isFresh({ cells: [], at: now - CACHE_TTL_MS - 1 }, now), false);
	assert.equal(isFresh({ at: now }, now), false);
	assert.equal(isFresh(null, now), false);
});
