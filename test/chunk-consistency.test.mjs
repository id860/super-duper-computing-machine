import test from 'node:test';
import assert from 'node:assert/strict';
import { keepNewerCell, keysNeedingValidation } from '../public/app/chunk-consistency.js';

test('cached chunks remain scheduled until the server validates them', () => {
	const visible = ['1:1', '1:2', '2:1'];
	const paintedFromCache = new Set(visible);
	const validated = new Set(['1:1']);
	assert.deepEqual(keysNeedingValidation(visible, paintedFromCache), []);
	assert.deepEqual(keysNeedingValidation(visible, validated), ['1:2', '2:1']);
});

test('authoritative responses preserve only writes newer than the request', () => {
	assert.equal(keepNewerCell({ c: '#fff', at: 101 }, 100), true);
	assert.equal(keepNewerCell({ c: '#fff', at: 100 }, 100), false);
	assert.equal(keepNewerCell({ c: '#fff' }, 100), false);
	assert.equal(keepNewerCell(null, 100), false);
});
