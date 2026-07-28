import { atLeast, isVisible, worldRole } from '../core/rules.mjs';
import { clean, now } from '../core/util.mjs';
import { ok, readJson, requireUser } from './kit.mjs';

const clamp = (v, min, max, fallback = min) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; };
const publicTemplate = (t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, width: t.width, height: t.height, pixels: t.pixels, authorId: t.authorId, updatedAt: t.updatedAt });

export function matchingRegionSubscribers(world, pixels, actorId = null) {
	const ids = new Set();
	for (const sub of world.regionSubscriptions || []) {
		if (sub.userId === actorId) continue;
		if ((pixels || []).some(([x, y]) => x >= sub.x1 && x <= sub.x2 && y >= sub.y1 && y <= sub.y2)) ids.add(sub.userId);
	}
	return [...ids];
}

export async function handleCollaborationRequest(req, res, ctx, store) {
	const url = new URL(req.url, 'http://localhost');
	const match = /^\/api\/worlds\/([^/]+)\/(templates|subscriptions)$/.exec(url.pathname);
	if (!match) return false;
	const world = store.db.worlds[decodeURIComponent(match[1])];
	if (!world) throw Object.assign(new Error('Мир не найден'), { status: 404 });
	if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });
	world.templates ||= {}; world.regionSubscriptions ||= [];
	if (req.method === 'GET') {
		if (match[2] === 'templates') ok(res, { templates: Object.values(world.templates).map(publicTemplate) });
		else ok(res, { subscriptions: ctx.user ? world.regionSubscriptions.filter((s) => s.userId === ctx.user.id) : [] });
		return true;
	}
	if (req.method !== 'POST') return false;
	const user = requireUser(ctx), body = await readJson(req);
	if (match[2] === 'templates') {
		if (!atLeast(worldRole(user, world), 'artist')) throw Object.assign(new Error('Нужна роль художника'), { status: 403 });
		const width = clamp(body.width, 1, 256, 1), height = clamp(body.height, 1, 256, 1);
		const pixels = Array.isArray(body.pixels) ? body.pixels.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && typeof p[2] === 'string' && p[0] >= 0 && p[1] >= 0 && p[0] < width && p[1] < height).slice(0, 10000) : [];
		const id = clean(body.id, 60) || `tpl_${now()}_${Math.random().toString(36).slice(2, 8)}`;
		const previous = world.templates[id];
		if (previous && previous.authorId !== user.id && !atLeast(worldRole(user, world), 'moderator')) throw Object.assign(new Error('Шаблон принадлежит другому автору'), { status: 403 });
		const template = { id, name: clean(body.name, 48) || 'Шаблон', x: clamp(body.x, 0, 100000, 0), y: clamp(body.y, 0, 100000, 0), width, height, pixels, authorId: previous?.authorId || user.id, updatedAt: now() };
		world.templates[id] = template; store.schedule(0); ok(res, { template: publicTemplate(template) }); return true;
	}
	const x1 = clamp(body.x1, 0, 100000, 0), y1 = clamp(body.y1, 0, 100000, 0), x2 = clamp(body.x2, x1, 100000, x1), y2 = clamp(body.y2, y1, 100000, y1);
	if ((x2 - x1 + 1) * (y2 - y1 + 1) > 4_000_000) throw Object.assign(new Error('Область подписки слишком большая'), { status: 400 });
	world.regionSubscriptions = world.regionSubscriptions.filter((s) => s.userId !== user.id || s.id !== body.id);
	if (body.enabled !== false) {
		if (world.regionSubscriptions.filter((s) => s.userId === user.id).length >= 20) throw Object.assign(new Error('Лимит подписок достигнут'), { status: 409 });
		world.regionSubscriptions.push({ id: clean(body.id, 60) || `sub_${now()}`, userId: user.id, x1, y1, x2, y2, createdAt: now() });
	}
	store.schedule(0); ok(res, { subscriptions: world.regionSubscriptions.filter((s) => s.userId === user.id) }); return true;
}
