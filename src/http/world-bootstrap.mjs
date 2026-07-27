// Lightweight initial response for infinite worlds. Pixel data arrives via chunks.
import { isVisible, worldRole } from '../core/rules.mjs';
import { ok } from './kit.mjs';

function view(world, user, db, sse) {
	return {
		id: world.id, name: world.name, description: world.description, icon: world.icon,
		type: world.type, preset: world.preset, language: world.language, tags: world.tags,
		ageRating: world.ageRating, ownerId: world.ownerId, ownerNick: db.users[world.ownerId]?.nick || null,
		width: world.width, height: world.height, infinite: true, spawn: world.spawn,
		background: world.background, grid: world.grid, zoomMin: world.zoomMin, zoomMax: world.zoomMax,
		palette: world.palette, access: { mode: world.access.mode, hasPassword: !!world.access.passwordHash },
		energy: world.energy, tools: world.tools, protection: world.protection,
		chat: { ...world.chat, bannedWords: undefined }, battle: world.battle, lifecycle: world.lifecycle,
		catalog: { ...world.catalog, ratings: undefined },
		stats: { pixels: world.stats.pixels, players: Object.keys(world.stats.players).length },
		allowDownload: world.allowDownload, maxOnline: world.maxOnline,
		role: worldRole(user, world), online: sse.online(world.id), createdAt: world.createdAt
	};
}

export async function handleWorldBootstrapRequest(req, res, ctx, db, sse) {
	if (req.method !== 'GET') return false;
	const url = new URL(req.url, 'http://localhost');
	if (url.searchParams.get('viewport') !== '1') return false;
	const match = /^\/api\/worlds\/([^/]+)$/.exec(url.pathname);
	if (!match) return false;
	const world = db.worlds[decodeURIComponent(match[1])];
	if (!world?.infinite) return false;
	if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });
	ok(res, { world: view(world, ctx.user, db, sse), pixels: [], arts: Object.values(world.arts), viewport: true });
	return true;
}
