import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTimelapseRequest, selectTimelapse } from '../src/http/timelapse.mjs';

const world = () => ({ id: 'official', type: 'official', access: { mode: 'public' }, lifecycle: { state: 'active' }, members: {}, pixelHistory: [
	{ x: 3, y: 3, color: '#c', actorId: 'private', at: 30 },
	{ x: 1, y: 1, color: '#a', actorId: 'private', at: 10 },
	{ x: 2, y: 2, color: '#b', actorId: 'private', at: 20 },
	{ key: 'restore', restore: true, at: 40 }
], snapshots: [{ id: 'snap1', kind: 'auto', at: 5, pixels: { secret: true } }] });

function response() { return { status: 0, body: null, writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } }; }

test('timelapse selection is chronological, bounded and paginated', () => {
	const result = selectTimelapse(world().pixelHistory, { since: 5, limit: 1, bounds: { x1: 0, y1: 0, x2: 2, y2: 2 } });
	assert.deepEqual(result.events, [[1, 1, '#a', 10]]);
	assert.equal(result.hasMore, true);
	assert.equal(result.nextSince, 10);
});

test('public timelapse omits actor identities and snapshot pixels', async () => {
	const res = response();
	await handleTimelapseRequest({ method: 'GET', url: '/api/worlds/official/timelapse?limit=2' }, res, { user: null, session: null }, { worlds: { official: world() } });
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.events, [[1, 1, '#a', 10], [2, 2, '#b', 20]]);
	assert.equal(JSON.stringify(res.body).includes('private'), false);
	assert.deepEqual(res.body.snapshots, [{ id: 'snap1', kind: 'auto', at: 5 }]);
});
