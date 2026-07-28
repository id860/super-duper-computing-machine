import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingRegionSubscribers } from '../src/http/collaboration.mjs';

test('region alerts deduplicate subscribers and ignore the actor', () => {
	const world = { regionSubscriptions: [
		{ userId: 'a', x1: 0, y1: 0, x2: 10, y2: 10 },
		{ userId: 'a', x1: 5, y1: 5, x2: 20, y2: 20 },
		{ userId: 'b', x1: 100, y1: 100, x2: 110, y2: 110 },
		{ userId: 'actor', x1: 0, y1: 0, x2: 10, y2: 10 }
	] };
	assert.deepEqual(matchingRegionSubscribers(world, [[7, 7, '#fff']], 'actor'), ['a']);
});
