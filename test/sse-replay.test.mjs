import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSse } from '../src/http/sse.mjs';

function connection(lastEventId = '') {
	const req = new EventEmitter(); req.headers = lastEventId ? { 'last-event-id': lastEventId } : {};
	const writes = [];
	const res = { writeHead() {}, write(value) { writes.push(String(value)); return true; }, end() {} };
	return { req, res, writes };
}

test('SSE assigns ids and replays events after Last-Event-ID', () => {
	const sse = createSse({ heartbeatMs: 999999, historyLimit: 10 });
	try {
		const first = connection(); sse.subscribe('official', first.req, first.res);
		const id1 = sse.broadcast('official', 'pixels', { pixels: [[1, 1, '#fff']] });
		const id2 = sse.broadcast('official', 'pixels', { pixels: [[2, 2, '#000']] });
		assert.ok(id1 && id2 && id1 !== id2);
		const resumed = connection(id1); sse.subscribe('official', resumed.req, resumed.res);
		const text = resumed.writes.join('');
		assert.match(text, new RegExp(`id: ${id2}`));
		assert.match(text, /\[2,2,"#000"\]/);
		assert.doesNotMatch(text, /\[1,1,"#fff"\]/);
	} finally { sse.close(); }
});

test('SSE requests resync when replay history is unavailable', () => {
	const sse = createSse({ heartbeatMs: 999999, historyLimit: 1 });
	try {
		const c = connection('expired-id'); sse.subscribe('official', c.req, c.res);
		assert.match(c.writes.join(''), /event: resync/);
		assert.match(c.writes.join(''), /history-miss/);
	} finally { sse.close(); }
});
