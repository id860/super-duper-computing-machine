import test from 'node:test';
import assert from 'node:assert/strict';
import { centerChunk, chunkKey, missingRadius, parseChunkKey, planRequests, rangeKeys, rangeSize, ringKeys, viewportChunkRange } from '../public/app/chunk-queue.js';
import { CACHE_TTL_MS, isFresh, recordKey } from '../public/app/chunk-store.js';

test('centre chunk follows the viewport in every direction', () => {
	const view = { offsetX: 0, offsetY: 0, scale: 1, viewW: 172, viewH: 172 };
	assert.deepEqual(centerChunk(view, 86), { cx: 1, cy: 1 });
	assert.deepEqual(centerChunk({ ...view, offsetX: 860, offsetY: 860 }, 86), { cx: -9, cy: -9 });
	assert.deepEqual(centerChunk({ ...view, scale: 0 }, 86), { cx: 0, cy: 0 });
});

test('ring keys grow outwards across signed chunks', () => {
	assert.deepEqual(ringKeys(4, 4, 0), ['4:4']);
	assert.equal(ringKeys(4, 4, 1).length, 8);
	assert.equal(ringKeys(4, 4, 2).length, 16);
	assert.equal(ringKeys(0, 0, 1).length, 8);
	assert.ok(ringKeys(0, 0, 1).includes('-1:-1'));
	assert.equal(chunkKey(-2, 3), '-2:3');
	assert.deepEqual(parseChunkKey('-7:9'), { x: -7, y: 9 });
	assert.equal(parseChunkKey('broken'), null);
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

test('viewport range covers the whole visible signed area', () => {
	const zoomedOut = viewportChunkRange({ offsetX: 0, offsetY: 0, scale: 1, viewW: 1720, viewH: 860 }, 86, 0);
	assert.deepEqual(zoomedOut, { x0: 0, y0: 0, x1: 20, y1: 10 });
	assert.equal(rangeSize({ x0: 0, y0: 0, x1: 2, y1: 1 }), 6);
	assert.deepEqual(rangeKeys({ x0: 1, y0: 1, x1: 2, y1: 1 }), ['1:1', '2:1']);
	const corner = viewportChunkRange({ offsetX: 0, offsetY: 0, scale: 1, viewW: 86, viewH: 86 }, 86, 1);
	assert.equal(corner.x0, -1);
	assert.equal(corner.y0, -1);
});

test('request planner batches missing chunks nearest to the centre first', () => {
	const range = { x0: 0, y0: 0, x1: 13, y1: 6 }, loaded = new Set();
	const plans = planRequests(range, loaded, { cx: 10, cy: 3 }, 3);
	assert.ok(plans.length >= 2);
	assert.deepEqual(plans.map((plan) => plan.cx).sort((a, b) => a - b), [3, 10]);
	assert.equal(plans[0].cx, 10);
	assert.equal(plans[0].radius, 3);
	const covered = new Set(plans.flatMap((plan) => plan.keys));
	assert.equal(covered.size, rangeSize(range));
	for (const key of rangeKeys(range)) loaded.add(key);
	assert.deepEqual(planRequests(range, loaded, { cx: 10, cy: 3 }, 3), []);
});

test('request planner handles blocks left and above spawn', () => {
	const range = { x0: -8, y0: -4, x1: 1, y1: 2 };
	const plans = planRequests(range, new Set(), { cx: -3, cy: -1 }, 3);
	const covered = new Set(plans.flatMap((plan) => plan.keys));
	assert.equal(covered.size, rangeSize(range));
	assert.ok(covered.has('-8:-4'));
});

test('cached chunks expire and malformed records are ignored', () => {
	const now = 1000000;
	assert.equal(recordKey('official', '3:4'), 'official/3:4');
	assert.equal(isFresh({ cells: [], at: now }, now), true);
	assert.equal(isFresh({ cells: [], at: now - CACHE_TTL_MS - 1 }, now), false);
	assert.equal(isFresh({ at: now }, now), false);
	assert.equal(isFresh(null, now), false);
});
