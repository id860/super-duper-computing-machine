import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/core/model.mjs';
import { handleWorldBootstrapRequest } from '../src/http/world-bootstrap.mjs';

function response() {
	return { status: null, body: null, writeHead(status) { this.status = status; }, end(payload) { this.body = JSON.parse(payload); } };
}

test('infinite world bootstrap returns metadata without all pixels', async () => {
	const world = createWorld({ id: 'official', type: 'official', infinite: true });
	world.pixels = { '1:1': { c: '#e50000', u: 'nobody', at: 1 } };
	const res = response();
	const handled = await handleWorldBootstrapRequest(
		{ method: 'GET', url: '/api/worlds/official?viewport=1' }, res,
		{ user: null, session: null }, { worlds: { official: world }, users: {} }, { online: () => 0 }
	);
	assert.equal(handled, true);
	assert.equal(res.status, 200);
	assert.equal(res.body.viewport, true);
	assert.deepEqual(res.body.pixels, []);
	assert.equal(res.body.world.infinite, true);
});

test('finite world keeps the established full-world route', async () => {
	const world = createWorld({ id: 'finite', infinite: false });
	const handled = await handleWorldBootstrapRequest(
		{ method: 'GET', url: '/api/worlds/finite?viewport=1' }, response(),
		{ user: null, session: null }, { worlds: { finite: world }, users: {} }, { online: () => 0 }
	);
	assert.equal(handled, false);
});
