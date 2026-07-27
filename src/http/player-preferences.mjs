import { questView } from '../core/progress.mjs';
import { isVisible } from '../core/rules.mjs';
import { ok, readJson, requireUser } from './kit.mjs';

const SHOP = [
	{ key: 'frame_neon', title: 'Неоновая рамка профиля', price: 250, type: 'cosmetic', slot: 'frame' }, { key: 'frame_aurora', title: 'Рамка «Аврора»', price: 360, type: 'cosmetic', slot: 'frame' },
	{ key: 'nick_gradient', title: 'Градиентный ник', price: 400, type: 'cosmetic', slot: 'nick' }, { key: 'nick_gold', title: 'Золотой ник', price: 520, type: 'cosmetic', slot: 'nick' },
	{ key: 'badge_pioneer', title: 'Значок пионера', price: 150, type: 'cosmetic', slot: 'badge' }, { key: 'badge_creator', title: 'Значок творца', price: 300, type: 'cosmetic', slot: 'badge' },
	{ key: 'trail_spark', title: 'Искристый след', price: 280, type: 'cosmetic', slot: 'trail' }, { key: 'cursor_comet', title: 'Курсор-комета', price: 220, type: 'cosmetic', slot: 'cursor' },
	{ key: 'world_slot', title: 'Дополнительный слот мира', price: 900, type: 'utility' }, { key: 'energy_boost', title: 'Ускорение энергии на 1 час', price: 120, type: 'consumable' }
];
const byKey = new Map(SHOP.map((item) => [item.key, item]));
const SLOTS = ['frame', 'nick', 'badge', 'trail', 'cursor'];
function equipped(user) { const value = user?.cosmetics?.equipped; if (!value || typeof value === 'string') return {}; const out = {}; for (const slot of SLOTS) if (value[slot] && byKey.get(value[slot])?.slot === slot) out[slot] = value[slot]; return out; }
export { equipped as equippedCosmetics };
export async function handlePlayerExperienceRequest(req, res, ctx, store) {
	const url = new URL(req.url, 'http://localhost'), db = store.db;
	if (req.method === 'GET' && url.pathname === '/api/quests') { const user = requireUser(ctx); ok(res, { daily: questView(user) }); return true; }
	if (req.method === 'GET' && url.pathname === '/api/shop') { requireUser(ctx); ok(res, { offers: SHOP }); return true; }
	if (req.method === 'POST' && /^\/api\/shop\/[^/]+\/buy$/.test(url.pathname)) { const user = requireUser(ctx), key = decodeURIComponent(url.pathname.split('/')[3]), item = byKey.get(key); if (!item) throw Object.assign(new Error('Товар не найден'), { status: 404 }); user.inventory ||= { coins: 0, items: {} }; user.inventory.items ||= {}; if (item.type === 'cosmetic' && user.inventory.items[key]) throw Object.assign(new Error('Уже куплено'), { status: 409 }); if (Number(user.inventory.coins || 0) < item.price) throw Object.assign(new Error('Недостаточно монет'), { status: 402 }); user.inventory.coins -= item.price; user.inventory.items[key] = Number(user.inventory.items[key] || 0) + 1; if (key === 'world_slot') user.worldSlots = Number(user.worldSlots || 1) + 1; store.schedule(); ok(res, { bought: true, key, coins: user.inventory.coins, items: user.inventory.items }); return true; }
	if (req.method === 'GET' && url.pathname === '/api/me/preferences') { const user = requireUser(ctx); ok(res, { preferences: user.preferences || {}, cosmetics: { equipped: equipped(user) } }); return true; }
	if (req.method === 'PATCH' && url.pathname === '/api/me/preferences') { const user = requireUser(ctx), body = await readJson(req); user.preferences ||= {}; if (body.hideSpawnZone !== undefined) user.preferences.hideSpawnZone = !!body.hideSpawnZone; store.schedule(); ok(res, { preferences: user.preferences }); return true; }
	if (req.method === 'POST' && url.pathname === '/api/me/cosmetics') { const user = requireUser(ctx), body = await readJson(req), item = byKey.get(body.key), slot = body.slot; if (!item || item.type !== 'cosmetic' || item.slot !== slot || !user.inventory?.items?.[item.key]) throw Object.assign(new Error('Предмет не куплен'), { status: 403 }); user.cosmetics ||= {}; const active = equipped(user); user.cosmetics.equipped = { ...active, [slot]: active[slot] === item.key ? null : item.key }; store.schedule(); ok(res, { cosmetics: { equipped: equipped(user) } }); return true; }
	// Public cosmetics lookup so live chat can decorate any author, not just the current player.
	if (req.method === 'GET' && url.pathname === '/api/cosmetics') { const nick = (url.searchParams.get('nick') || '').trim().toLowerCase(); const user = nick ? Object.values(db.users || {}).find((candidate) => candidate.nick.toLowerCase() === nick) : null; ok(res, { nick: user?.nick || null, cosmetics: equipped(user) }); return true; }
	// Chat history carries each author's cosmetics so decorations survive reloads.
	if (req.method === 'GET' && /^\/api\/worlds\/[^/]+\/chat$/.test(url.pathname)) {
		const worldId = decodeURIComponent(url.pathname.split('/')[3]), world = db.worlds?.[worldId];
		if (!world) throw Object.assign(new Error('Мир не найден'), { status: 404 });
		if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });
		const list = (db.chats?.[worldId] || []).filter((message) => !message.deleted).slice(-80), cosmetics = {};
		for (const message of list) { const author = db.users?.[message.userId]; if (author) cosmetics[message.nick] = equipped(author); }
		ok(res, { messages: list.map((message) => ({ ...message, cosmetics: cosmetics[message.nick] || {} })), cosmetics });
		return true;
	}
	return false;
}
