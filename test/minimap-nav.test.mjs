import test from 'node:test';
import assert from 'node:assert/strict';
import { minimapPointToWorld } from '../public/app/minimap-nav.js';

test('minimap points map back to world cells inside the rendered bounds', () => {
	const box = { scale: 0.1, ox: 10, oy: 5, bx0: 0, by0: 0 };
	assert.deepEqual(minimapPointToWorld({ mx: 10, my: 5 }, box), { x: 0, y: 0 });
	assert.deepEqual(minimapPointToWorld({ mx: 60, my: 55 }, box), { x: 500, y: 500 });
});

test('minimap navigation honours shifted bounds and rejects an empty buffer', () => {
	const shifted = { scale: 0.05, ox: 0, oy: 0, bx0: 200, by0: 400 };
	assert.deepEqual(minimapPointToWorld({ mx: 10, my: 10 }, shifted), { x: 400, y: 600 });
	assert.equal(minimapPointToWorld({ mx: 1, my: 1 }, { scale: 0 }), null);
	assert.equal(minimapPointToWorld({ mx: 1, my: 1 }, null), null);
});
