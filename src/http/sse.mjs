// Replayable Server-Sent Events with bounded queues and opt-in presence groups.
export function createSse({ heartbeatMs = 25000, maxPerWorld = 500, historyLimit = 1000, maxQueueBytes = 256 * 1024 } = {}) {
	const channels = new Map(), histories = new Map(), clients = new WeakMap();
	let sequence = 0;
	const eventId = () => `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
	const encode = (event, data, id = null) => `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	const cleanGroup = (value) => String(value || '').trim().replace(/[^\p{L}\p{N}_:-]/gu, '').slice(0, 32) || 'global';

	function stateFor(res) {
		let state = clients.get(res);
		if (!state) { state = { blocked: false, queue: [], bytes: 0, closed: false, group: 'global' }; clients.set(res, state); }
		return state;
	}
	function closeSlowClient(set, res, state) { state.closed = true; state.queue.length = 0; state.bytes = 0; set?.delete(res); try { res.end(); } catch {} return false; }
	function flush(set, res) {
		const state = stateFor(res); if (state.closed) return; state.blocked = false;
		while (state.queue.length) { const payload = state.queue.shift(); state.bytes -= Buffer.byteLength(payload); let writable = false; try { writable = res.write(payload); } catch { closeSlowClient(set, res, state); return; } if (!writable) { state.blocked = true; res.once?.('drain', () => flush(set, res)); return; } }
	}
	function send(set, res, payload) {
		const state = stateFor(res); if (state.closed) return false;
		if (state.blocked) { const bytes = Buffer.byteLength(payload); if (state.bytes + bytes > maxQueueBytes) return closeSlowClient(set, res, state); state.queue.push(payload); state.bytes += bytes; return true; }
		try { if (!res.write(payload)) { state.blocked = true; res.once?.('drain', () => flush(set, res)); } return true; } catch { return closeSlowClient(set, res, state); }
	}
	const timer = setInterval(() => { for (const set of channels.values()) for (const res of set) send(set, res, ': ping\n\n'); }, heartbeatMs); timer.unref?.();

	function subscribe(worldId, req, res) {
		res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write('retry: 3000\n\n');
		let set = channels.get(worldId); if (!set) channels.set(worldId, (set = new Set()));
		if (set.size >= maxPerWorld) { res.write('event: full\ndata: {}\n\n'); res.end(); return; }
		set.add(res); const state = stateFor(res);
		try { state.group = cleanGroup(new URL(req.url || '/', 'http://localhost').searchParams.get('group')); } catch { state.group = 'global'; }
		const lastId = String(req.headers?.['last-event-id'] || '').trim();
		if (lastId) { const history = histories.get(worldId) || [], index = history.findIndex((entry) => entry.id === lastId); if (index >= 0) for (const entry of history.slice(index + 1)) send(set, res, entry.payload); else send(set, res, encode('resync', { reason: 'history-miss' })); }
		broadcastPresence(worldId);
		let cleaned = false;
		const cleanup = () => { if (cleaned) return; cleaned = true; state.closed = true; set.delete(res); broadcastPresence(worldId); };
		req.on('close', cleanup); req.on('error', cleanup);
	}
	function groupCounts(worldId) {
		const counts = {};
		for (const res of channels.get(worldId) || []) { const state = stateFor(res); if (!state.closed) counts[state.group] = (counts[state.group] || 0) + 1; }
		return counts;
	}
	function broadcastPresence(worldId) { const set = channels.get(worldId); if (!set?.size) return; const payload = encode('presence', { online: online(worldId), groups: groupCounts(worldId) }); for (const res of [...set]) send(set, res, payload); }
	function broadcast(worldId, event, data) {
		const set = channels.get(worldId), id = event === 'presence' ? null : eventId(), payload = encode(event, data, id);
		if (id) { let history = histories.get(worldId); if (!history) histories.set(worldId, (history = [])); history.push({ id, event, data, payload }); if (history.length > historyLimit) history.splice(0, history.length - historyLimit); }
		if (set?.size) for (const res of [...set]) send(set, res, payload); return id;
	}
	function online(worldId) { return channels.get(worldId)?.size || 0; }
	function close() { clearInterval(timer); for (const set of channels.values()) for (const res of set) { const state = stateFor(res); state.closed = true; try { res.end(); } catch {} } channels.clear(); histories.clear(); }
	return { subscribe, broadcast, online, groupCounts, close };
}
