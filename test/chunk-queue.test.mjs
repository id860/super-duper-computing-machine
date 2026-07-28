import test from 'node:test';
import assert from 'node:assert/strict';
import { centerChunk, chunkKey, missingRadius, parseChunkKey, planRequests, rangeKeys, rangeSize, ringKeys, viewportChunkRange } from '../public/app/chunk-queue.js';
import { CACHE_TTL_MS, isFresh, recordKey } from '../public/app/chunk-store.js';

test('chunk coordinates support every direction around spawn', () => {
	const view = { offsetX: 860, offsetY: 860, scale: 1, viewW: 172, viewH: 172 };
	const center = centerChunk(view, 86);
	assert.ok(center.cx < 0 && center.cy < 0);
	assert.equal(chunkKey(-2, 3), '-2:3');
	assert.deepEqual(parseChunkKey('-7:9'), { x: -7, y: 9 });
	assert.equal(parseChunkKey('broken'), null);
	const ring = ringKeys(0, 0, 1);
	assert.equal(ring.length, 8);
	assert.ok(ring.some((key) => key.startsWith('-')));
});

test('progressive rings finish after all keys load', () => {
	const loaded = new Set();
	assert.equal(missingRadius(5, 5, loaded, 2), 0);
	for (let radius = 0; radius <= 2; radius++) for (const key of ringKeys(5, 5, radius)) loaded.add(key);
	assert.equal(missingRadius(5, 5, loaded, 2), -1);
});

test('viewport range is signed and covers its full area', () => {
	const range = viewportChunkRange({ offsetX: 172, offsetY: 86, scale: 1, viewW: 172, viewH: 86 }, 86, 0);
	assert.ok(range.x0 < 0 && range.y0 < 0);
	assert.equal(rangeKeys(range).length, rangeSize(range));
});

test('request planner covers signed ranges exactly once', () => {
	const range = { x0: -8, y0: -4, x1: 13, y1: 6 };
	const plans = planRequests(range, new Set(), { cx: -1, cy: 1 }, 3);
	const keys = plans.flatMap((plan) => plan.keys);
	assert.equal(new Set(keys).size, rangeSize(range));
	assert.equal(keys.length, rangeSize(range));
	assert.ok(keys.includes('-8:-4'));
	const loaded = new Set(rangeKeys(range));
	assert.deepEqual(planRequests(range, loaded, { cx: 0, cy: 0 }, 3), []);
});

test('cached chunks expire and malformed records are ignored', () => {
	const now = 1000000;
	assert.equal(recordKey('official', '-3:4'), 'official/-3:4');
	assert.equal(isFresh({ cells: [], at: now }, now), true);
	assert.equal(isFresh({ cells: [], at: now - CACHE_TTL_MS - 1 }, now), false);
	assert.equal(isFresh({ at: now }, now), false);
	assert.equal(isFresh(null, now), false);
});
