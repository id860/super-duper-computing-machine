import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE, ChunkIndex } from '../src/http/chunks.mjs';

const cell = (color) => ({ c: color, u: 'user', at: 1 });

test('chunk index builds buckets and applies live pixel updates', () => {
	const world = {
		id: 'world', background: '#ffffff', infinite: true,
		pixels: { '1:2': cell('#e50000'), [`${CHUNK_SIZE + 3}:2`]: cell('#0083c7') }
	};
	const index = new ChunkIndex({ worlds: { world } });
	const chunks = index.ensure(world);
	assert.equal(chunks.size, 2);
	assert.equal(chunks.get('0:0').get('1:2').c, '#e50000');
	assert.equal(chunks.get('1:0').get(`${CHUNK_SIZE + 3}:2`).c, '#0083c7');

	index.applyPixels('world', [[1, 2, '#02be01'], [512, 5, '#000000']]);
	assert.equal(chunks.get('0:0').get('1:2').c, '#02be01');
	assert.equal(chunks.get('2:0').get('512:5').c, '#000000');

	index.applyPixels('world', [[1, 2, '#ffffff']]);
	assert.equal(chunks.get('0:0').has('1:2'), false);
});
