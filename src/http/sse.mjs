// Server-Sent Events with bounded replay and explicit resynchronisation.
export function createSse({ heartbeatMs = 25000, maxPerWorld = 500, historyLimit = 1000 } = {}) {
	const channels = new Map();
	const histories = new Map();
	let sequence = 0;

	const timer = setInterval(() => {
		for (const set of channels.values()) for (const res of set) {
			try { res.write(': ping\n\n'); } catch { set.delete(res); }
		}
	}, heartbeatMs);
	timer.unref?.();

	const eventId = () => `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
	const encode = (event, data, id = null) => `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

	function send(res, payload) {
		try { return res.write(payload); } catch { return false; }
	}

	function subscribe(worldId, req, res) {
		res.writeHead(200, {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		});
		res.write('retry: 3000\n\n');
		let set = channels.get(worldId);
		if (!set) channels.set(worldId, (set = new Set()));
		if (set.size >= maxPerWorld) {
			res.write('event: full\ndata: {}\n\n');
			res.end();
			return;
		}
		set.add(res);

		const lastId = String(req.headers?.['last-event-id'] || '').trim();
		if (lastId) {
			const history = histories.get(worldId) || [];
			const index = history.findIndex((entry) => entry.id === lastId);
			if (index >= 0) {
				for (const entry of history.slice(index + 1)) send(res, entry.payload);
			} else {
				// The process restarted or the client fell behind the bounded log.
				send(res, encode('resync', { reason: 'history-miss' }));
			}
		}
		broadcastPresence(worldId);
		let cleaned = false;
		const cleanup = () => {
			if (cleaned) return;
			cleaned = true;
			set.delete(res);
			broadcastPresence(worldId);
		};
		req.on('close', cleanup);
		req.on('error', cleanup);
	}

	function broadcastPresence(worldId) {
		const set = channels.get(worldId);
		if (!set?.size) return;
		const payload = encode('presence', { online: online(worldId) });
		for (const res of set) if (!send(res, payload)) set.delete(res);
	}

	function broadcast(worldId, event, data) {
		const set = channels.get(worldId);
		const id = event === 'presence' ? null : eventId();
		const payload = encode(event, data, id);
		if (id) {
			let history = histories.get(worldId);
			if (!history) histories.set(worldId, (history = []));
			history.push({ id, event, data, payload });
			if (history.length > historyLimit) history.splice(0, history.length - historyLimit);
		}
		if (set?.size) for (const res of set) if (!send(res, payload)) set.delete(res);
		return id;
	}

	function online(worldId) { return channels.get(worldId)?.size || 0; }
	function close() {
		clearInterval(timer);
		for (const set of channels.values()) for (const res of set) { try { res.end(); } catch {} }
		channels.clear(); histories.clear();
	}
	return { subscribe, broadcast, online, close };
}
