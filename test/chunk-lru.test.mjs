import test from 'node:test';
import assert from 'node:assert/strict';
import { touchChunk } from '../public/app/chunk-lru.js';

test('chunk LRU retains recent chunks and evicts the least recently touched', () => {
	const cache = new Map();
	touchChunk(cache, '0:0', 1, 2);
	touchChunk(cache, '1:0', 2, 2);
	touchChunk(cache, '0:0', 3, 2);
	assert.deepEqual(touchChunk(cache, '2:0', 4, 2), ['1:0']);
	assert.deepEqual([...cache.keys()].sort(), ['0:0', '2:0']);
});
