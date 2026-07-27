import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE_SIZE, parseTileKey, selectStaleTiles, tileKeyFor, tileOffset, visibleTileKeys } from '../public/app/tile-grid.js';

test('tile keys and offsets stay stable across the origin', () => {
	assert.equal(TILE_SIZE, 64);
	assert.equal(tileKeyFor(0, 0), '0:0');
	assert.equal(tileKeyFor(63, 64), '0:1');
	assert.equal(tileKeyFor(-1, -65), '-1:-2');
	assert.equal(tileOffset(0), 0);
	assert.equal(tileOffset(65), 1);
	assert.equal(tileOffset(-1), 63);
	assert.deepEqual(parseTileKey('-2:3'), { tx: -2, ty: 3 });
	assert.equal(parseTileKey('broken'), null);
});

test('visible tiles cover the viewport and start at its centre', () => {
	const view = { offsetX: 0, offsetY: 0, scale: 1, viewW: TILE_SIZE * 3, viewH: TILE_SIZE * 3 };
	const keys = visibleTileKeys(view);
	assert.equal(keys.length, 16); // 4 × 4: three full tiles plus the trailing edge.
	assert.equal(keys[0], '1:1'); // Centre first, so the player sees detail immediately.
	assert.ok(keys.includes('0:0') && keys.includes('3:3'));
	const panned = visibleTileKeys({ ...view, offsetX: TILE_SIZE * 2, offsetY: TILE_SIZE * 2 });
	assert.ok(panned.includes('-2:-2'), 'negative tiles are reachable in an infinite world');
	assert.deepEqual(visibleTileKeys({ offsetX: 0, offsetY: 0, scale: 0, viewW: 10, viewH: 10 }), []);
});

test('tile cache keeps visible tiles and drops the least recently drawn ones', () => {
	const stamps = new Map([['0:0', 10], ['1:0', 20], ['2:0', 30], ['3:0', 40]]);
	assert.deepEqual(selectStaleTiles(stamps, new Set(['3:0']), 4), []);
	assert.deepEqual(selectStaleTiles(stamps, new Set(['3:0']), 2), ['0:0', '1:0']);
	assert.deepEqual(selectStaleTiles(stamps, new Set(['0:0', '1:0', '2:0', '3:0']), 1), []);
});
