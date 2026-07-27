import test from 'node:test';
import assert from 'node:assert/strict';
import { collectMetrics } from '../src/http/metrics.mjs';

test('metrics count worlds, players, pixels and chat volume', () => {
	const db = {
		worlds: {
			official: { id: 'official', lifecycle: { state: 'active' }, pixels: { '1:1': 3, '2:2': 4 } },
			sandbox: { id: 'sandbox', lifecycle: { state: 'archived' }, stats: { pixels: 5 } }
		},
		users: { u1: {}, u2: {} },
		sessions: { s1: {} },
		chats: { official: [{}, {}, {}], sandbox: [] },
		audit: [{}, {}]
	};
	const metrics = collectMetrics(db, { uptimeSec: 12.6, sseClients: 4, memoryMb: 91.4 });
	assert.equal(metrics.status, 'ok');
	assert.equal(metrics.worlds, 2);
	assert.equal(metrics.activeWorlds, 1);
	assert.equal(metrics.users, 2);
	assert.equal(metrics.sessions, 1);
	assert.equal(metrics.pixels, 7);
	assert.equal(metrics.chatMessages, 3);
	assert.equal(metrics.auditEntries, 2);
	assert.equal(metrics.sseClients, 4);
	assert.equal(metrics.uptimeSec, 13);
	assert.equal(metrics.memoryMb, 91);
});

test('metrics report storage modes and survive an empty database', () => {
	const empty = collectMetrics({}, {});
	assert.equal(empty.worlds, 0);
	assert.equal(empty.pixels, 0);
	assert.equal(empty.memoryMb, null);
	assert.deepEqual(empty.storage, { chunkRead: 'json', postgres: false, redis: false });
	assert.equal(empty.automation, 'inline');
	const scaled = collectMetrics({}, { chunkRead: 'postgres', postgres: true, redis: true, automation: 'worker' });
	assert.deepEqual(scaled.storage, { chunkRead: 'postgres', postgres: true, redis: true });
	assert.equal(scaled.automation, 'worker');
});
