import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSse } from '../src/http/sse.mjs';

function connection(lastEventId = '', write = null) {
	const req = new EventEmitter(); req.headers = lastEventId ? { 'last-event-id': lastEventId } : {};
	const writes = [], res = new EventEmitter();
	res.writeHead = () => {};
	res.write = (value) => { const text = String(value); writes.push(text); return write ? write(text, writes.length) : true; };
	res.end = () => { res.ended = true; };
	return { req, res, writes };
}

test('SSE assigns ids and replays events after Last-Event-ID', () => {
	const sse = createSse({ heartbeatMs: 999999, historyLimit: 10 });
	try {
		const first = connection(); sse.subscribe('official', first.req, first.res);
		const id1 = sse.broadcast('official', 'pixels', { pixels: [[1, 1, '#fff']] });
		const id2 = sse.broadcast('official', 'pixels', { pixels: [[2, 2, '#000']] });
		const resumed = connection(id1); sse.subscribe('official', resumed.req, resumed.res);
		const text = resumed.writes.join('');
		assert.ok(id1 && id2 && id1 !== id2); assert.match(text, new RegExp(`id: ${id2}`)); assert.match(text, /\[2,2,"#000"\]/); assert.doesNotMatch(text, /\[1,1,"#fff"\]/);
	} finally { sse.close(); }
});

test('SSE requests resync when replay history is unavailable', () => {
	const sse = createSse({ heartbeatMs: 999999, historyLimit: 1 });
	try { const c = connection('expired-id'); sse.subscribe('official', c.req, c.res); assert.match(c.writes.join(''), /event: resync/); } finally { sse.close(); }
});

test('slow clients are retained while queued events drain', () => {
	let blocked = true;
	const c = connection('', (text) => text.includes('event: pixels') && blocked ? (blocked = false) : true);
	const sse = createSse({ heartbeatMs: 999999, maxQueueBytes: 4096 });
	try {
		sse.subscribe('official', c.req, c.res);
		sse.broadcast('official', 'pixels', { n: 1 });
		sse.broadcast('official', 'pixels', { n: 2 });
		assert.equal(sse.online('official'), 1);
		assert.doesNotMatch(c.writes.join(''), /"n":2/);
		c.res.emit('drain');
		assert.match(c.writes.join(''), /"n":2/);
		assert.equal(c.res.ended, undefined);
	} finally { sse.close(); }
});

test('clients exceeding the bounded queue are disconnected', () => {
	const c = connection('', (text) => !text.includes('event: pixels'));
	const sse = createSse({ heartbeatMs: 999999, maxQueueBytes: 32 });
	try { sse.subscribe('official', c.req, c.res); sse.broadcast('official', 'pixels', { payload: 'x'.repeat(40) }); sse.broadcast('official', 'pixels', { payload: 'y'.repeat(40) }); assert.equal(sse.online('official'), 0); assert.equal(c.res.ended, true); } finally { sse.close(); }
});
