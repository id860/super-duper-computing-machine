import { isVisible } from '../core/rules.mjs';
import { ok } from './kit.mjs';

const number = (value, fallback, min, max) => {
	const parsed = Math.trunc(Number(value));
	return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

export function selectTimelapse(history, { since = 0, until = Number.MAX_SAFE_INTEGER, limit = 1000, bounds = null } = {}) {
	const filtered = [];
	for (const event of history || []) {
		if (!Number.isInteger(event.x) || !Number.isInteger(event.y) || typeof event.color !== 'string') continue;
		if (event.at <= since || event.at > until) continue;
		if (bounds && (event.x < bounds.x1 || event.x > bounds.x2 || event.y < bounds.y1 || event.y > bounds.y2)) continue;
		filtered.push([event.x, event.y, event.color, event.at]);
	}
	filtered.sort((a, b) => a[3] - b[3]);
	const events = filtered.slice(0, limit);
	return { events, hasMore: filtered.length > events.length, nextSince: events.at(-1)?.[3] || since };
}

export async function handleTimelapseRequest(req, res, ctx, db) {
	if (req.method !== 'GET') return false;
	const url = new URL(req.url, 'http://localhost');
	const match = /^\/api\/worlds\/([^/]+)\/timelapse$/.exec(url.pathname);
	if (!match) return false;
	const world = db.worlds[decodeURIComponent(match[1])];
	if (!world) throw Object.assign(new Error('Мир не найден'), { status: 404 });
	if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });
	const since = number(url.searchParams.get('since'), 0, 0, Number.MAX_SAFE_INTEGER);
	const until = number(url.searchParams.get('until'), Number.MAX_SAFE_INTEGER, since, Number.MAX_SAFE_INTEGER);
	const limit = number(url.searchParams.get('limit'), 1000, 1, 5000);
	const hasBounds = ['x1', 'y1', 'x2', 'y2'].every((key) => url.searchParams.has(key));
	const bounds = hasBounds ? {
		x1: number(url.searchParams.get('x1'), 0, 0, 100000), y1: number(url.searchParams.get('y1'), 0, 0, 100000),
		x2: number(url.searchParams.get('x2'), 100000, 0, 100000), y2: number(url.searchParams.get('y2'), 100000, 0, 100000)
	} : null;
	const result = selectTimelapse(world.pixelHistory, { since, until, limit, bounds });
	ok(res, { worldId: world.id, since, until, ...result, snapshots: (world.snapshots || []).slice(-20).map(({ id, kind, at }) => ({ id, kind, at })) });
	return true;
}
