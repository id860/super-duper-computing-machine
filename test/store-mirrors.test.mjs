import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/db.mjs';

test('store persists JSON before invoking an attached mirror', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'pixelfront-mirror-'));
	try {
		const store = new Store(dir); await store.load();
		const snapshots = []; store.addMirror({ write: async (db) => snapshots.push(db.worlds.official.id) });
		store.schedule(0); await store.flush();
		assert.deepEqual(snapshots, ['official']);
	} finally { await rm(dir, { recursive: true, force: true }); }
});
