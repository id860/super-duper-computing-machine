// Health and metrics endpoints. Both are read-only and unauthenticated so a
// load balancer or a scrape job can use them, and neither exposes personal
// data: only counters and the enabled storage modes.
import { ok } from './kit.mjs';

// Pixel storage moved between shapes across versions, so counting stays
// defensive instead of assuming one layout.
function countPixels(db, world) {
	if (world && world.pixels && typeof world.pixels === 'object') return Object.keys(world.pixels).length;
	const stored = db?.pixels?.[world?.id];
	if (Array.isArray(stored)) return stored.length;
	if (stored && typeof stored === 'object') return Object.keys(stored).length;
	return Number(world?.stats?.pixels || 0) || 0;
}

export function collectMetrics(db, runtime = {}) {
	const worlds = Object.values(db?.worlds || {});
	let pixels = 0;
	for (const world of worlds) pixels += countPixels(db, world);
	let chatMessages = 0;
	for (const list of Object.values(db?.chats || {})) if (Array.isArray(list)) chatMessages += list.length;
	return {
		status: 'ok',
		at: Date.now(),
		uptimeSec: Math.round(Number(runtime.uptimeSec) || 0),
		worlds: worlds.length,
		activeWorlds: worlds.filter((world) => (world?.lifecycle?.state || 'active') === 'active').length,
		users: Object.keys(db?.users || {}).length,
		sessions: Object.keys(db?.sessions || {}).length,
		pixels,
		chatMessages,
		auditEntries: Array.isArray(db?.audit) ? db.audit.length : 0,
		sseClients: Number(runtime.sseClients) || 0,
		memoryMb: Number.isFinite(runtime.memoryMb) ? Math.round(runtime.memoryMb) : null,
		storage: {
			chunkRead: runtime.chunkRead || 'json',
			postgres: !!runtime.postgres,
			redis: !!runtime.redis
		},
		automation: runtime.automation || 'inline'
	};
}

export function handleMetricsRequest(req, res, ctx, db, runtime) {
	if (req.method !== 'GET' && req.method !== 'HEAD') return false;
	const url = new URL(req.url, 'http://localhost');
	if (url.pathname !== '/api/health' && url.pathname !== '/api/metrics') return false;
	const info = typeof runtime === 'function' ? runtime() : (runtime || {});
	if (url.pathname === '/api/health') {
		ok(res, { status: 'ok', at: Date.now(), uptimeSec: Math.round(Number(info.uptimeSec) || 0) });
		return true;
	}
	ok(res, collectMetrics(db, info));
	return true;
}
