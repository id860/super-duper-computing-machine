import test from 'node:test';
import assert from 'node:assert/strict';
import { evictChunkPixels, touchChunk } from '../public/app/chunk-lru.js';

test('chunk LRU retains recent chunks and evicts the least recently touched', () => {
	const cache = new Map();
	touchChunk(cache, '0:0', 1, 2);
	touchChunk(cache, '1:0', 2, 2);
	touchChunk(cache, '0:0', 3, 2);
	assert.deepEqual(touchChunk(cache, '2:0', 4, 2), ['1:0']);
	assert.deepEqual([...cache.keys()].sort(), ['0:0', '2:0']);
});

test('evicted chunks drop their pixels but keep fresh writes and other chunks', () => {
	const pixels = new Map([
		['5:5', { c: '#000000' }],
		['10:10', { c: '#111111', at: 500 }],
		['20:20', { c: '#222222', at: 5000 }],
		['100:5', { c: '#333333' }]
	]);
	const removed = evictChunkPixels(pixels, '0:0', 86, 1000);
	assert.equal(removed, 2);
	assert.deepEqual([...pixels.keys()].sort(), ['100:5', '20:20']);
	assert.equal(evictChunkPixels(pixels, '1:0', 86, 1000), 1);
	assert.deepEqual([...pixels.keys()], ['20:20']);
	assert.equal(evictChunkPixels(pixels, 'bad', 86, 1000), 0);
});
