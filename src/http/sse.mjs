// Server-Sent Events: подписки по мирам, трансляция событий, подсчёт онлайна.
export function createSse({ heartbeatMs = 25000, maxPerWorld = 500 } = {}) {
	const channels = new Map(); // worldId -> Set<res>

	const timer = setInterval(() => {
		for (const set of channels.values()) {
			for (const res of set) {
				try {
					res.write(': ping\n\n');
				} catch {
					set.delete(res);
				}
			}
		}
	}, heartbeatMs);
	if (timer.unref) timer.unref();

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
		broadcast(worldId, 'presence', { online: online(worldId) });
		const cleanup = () => {
			set.delete(res);
			broadcast(worldId, 'presence', { online: online(worldId) });
		};
		req.on('close', cleanup);
		req.on('error', cleanup);
	}

	function broadcast(worldId, event, data) {
		const set = channels.get(worldId);
		if (!set || !set.size) return;
		const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
		for (const res of set) {
			try {
				res.write(payload);
			} catch {
				set.delete(res);
			}
		}
	}

	function online(worldId) {
		return channels.get(worldId)?.size || 0;
	}

	function close() {
		clearInterval(timer);
		for (const set of channels.values()) {
			for (const res of set) {
				try {
					res.end();
				} catch {}
			}
		}
		channels.clear();
	}

	return { subscribe, broadcast, online, close };
}
