// Small user-facing endpoints kept outside the legacy API router.
import { questView } from '../core/progress.mjs';
import { ok, readJson, requireUser } from './kit.mjs';

const COSMETICS = new Set(['frame_neon', 'nick_gradient', 'badge_pioneer']);

export async function handlePlayerExperienceRequest(req, res, ctx, store) {
	const url = new URL(req.url, 'http://localhost');
	if (req.method === 'GET' && url.pathname === '/api/quests') {
		const user = requireUser(ctx);
		return ok(res, { daily: questView(user) }), true;
	}
	if (req.method === 'GET' && url.pathname === '/api/me/preferences') {
		const user = requireUser(ctx);
		return ok(res, { preferences: user.preferences || {}, cosmetics: user.cosmetics || {} }), true;
	}
	if (req.method === 'PATCH' && url.pathname === '/api/me/preferences') {
		const user = requireUser(ctx), body = await readJson(req);
		user.preferences ||= {};
		if (body.hideSpawnZone !== undefined) user.preferences.hideSpawnZone = !!body.hideSpawnZone;
		store.schedule();
		return ok(res, { preferences: user.preferences }), true;
	}
	if (req.method === 'POST' && url.pathname === '/api/me/cosmetics') {
		const user = requireUser(ctx), body = await readJson(req), equipped = body.equipped || null;
		if (equipped !== null && (!COSMETICS.has(equipped) || !user.inventory?.items?.[equipped])) throw Object.assign(new Error('Предмет не куплен'), { status: 403 });
		user.cosmetics ||= {};
		user.cosmetics.equipped = equipped;
		store.schedule();
		return ok(res, { cosmetics: user.cosmetics }), true;
	}
	return false;
}
