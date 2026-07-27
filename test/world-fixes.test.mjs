import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorldToolSettings } from '../src/core/world-fixes.mjs';

test('normalizes brush limits to their actual affected cell counts', () => {
	const db = { worlds: { old: { tools: { brush2: { maxSize: 2 }, brush3: { maxSize: 3 } } } } };
	assert.equal(normalizeWorldToolSettings(db), true);
	assert.equal(db.worlds.old.tools.brush2.maxSize, 4);
	assert.equal(db.worlds.old.tools.brush3.maxSize, 9);
	assert.equal(normalizeWorldToolSettings(db), false);
});
