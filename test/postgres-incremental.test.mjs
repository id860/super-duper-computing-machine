import test from 'node:test';
import assert from 'node:assert/strict';
import { applyChunkPixels, groupPixelsByChunk } from '../src/core/postgres-mirror.mjs';

test('incremental postgres writes group only affected chunks', () => {
	const groups = groupPixelsByChunk([[0, 0, '#a'], [85, 85, '#b'], [86, 0, '#c'], [-1, -1, '#d']]);
	assert.equal(groups.get('0:0').length, 2);
	assert.equal(groups.get('1:0').length, 1);
	assert.equal(groups.get('-1:-1').length, 1);
});

test('incremental chunk merge upserts colors and removes background cells', () => {
	const before = { '1:1': { c: '#a', at: 1 }, '2:2': { c: '#b' } };
	const after = applyChunkPixels(before, [[1, 1, '#fff'], [3, 3, '#c']], '#fff');
	assert.equal(after['1:1'], undefined);
	assert.deepEqual(after['2:2'], { c: '#b' });
	assert.deepEqual(after['3:3'], { c: '#c' });
	assert.equal(before['1:1'].c, '#a');
});
