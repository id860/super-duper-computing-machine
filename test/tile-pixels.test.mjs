import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTilePixelIndex, syncTilePixelIndex } from '../public/app/tile-pixels.js';

test('pixel index groups cells by render tile including negative coordinates', () => {
	const pixels = new Map([['0:0', { c: 'a' }], ['63:63', { c: 'b' }], ['64:0', { c: 'c' }], ['-1:-1', { c: 'd' }]]);
	const index = buildTilePixelIndex(pixels);
	assert.equal(index.get('0:0').size, 2);
	assert.equal(index.get('1:0').size, 1);
	assert.equal(index.get('-1:-1').size, 1);
});

test('incremental sync updates and removes only touched tile buckets', () => {
	const pixels = new Map([['1:1', { c: 'a' }], ['70:1', { c: 'b' }]]);
	const index = buildTilePixelIndex(pixels);
	const untouched = index.get('1:0');
	pixels.set('1:1', { c: 'z' });
	assert.deepEqual([...syncTilePixelIndex(index, pixels, [[1, 1]])], ['0:0']);
	assert.equal(index.get('0:0').get('1:1').c, 'z');
	assert.equal(index.get('1:0'), untouched);
	pixels.delete('1:1');
	syncTilePixelIndex(index, pixels, [[1, 1]]);
	assert.equal(index.has('0:0'), false);
	assert.equal(index.get('1:0'), untouched);
});
