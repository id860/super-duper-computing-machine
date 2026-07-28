// Player-experience layer: sidebar, cosmetics, quests/events and spawn preference.
// The viewport chunk loader lives in chunk-prefetch.js; this file must not
// override it again or the batched viewport loading would be lost.
//
// This layer reacts to markup produced by main.js. It used to do so through a
// MutationObserver, but the callback edits the DOM itself, so every pass woke
// the observer again and the tab locked up right after signing in. Now the DOM
// is reconciled on a slow timer with strictly idempotent edits: a pass that
// changes nothing costs a handful of comparisons and can never feed itself.
import { PixelEngine } from './engine.js';
import { CHUNK_FADE_MS } from './chunk-prefetch.js';
import { api } from './api.js';
import { el, modal, toast } from './ui.js';

const SYNC_INTERVAL_MS = 300;
const FINE_CHUNK_SIZE = 86;
const SLOTS = ['frame', 'nick', 'badge', 'trail', 'cursor'];
const MARK_SLOTS = ['badge', 'trail', 'cursor'];
const SLOT_TITLES = { frame: 'Рамка', nick: 'Ник', badge: 'Значок', trail: 'След', cursor: 'Курсор' };

// ---------- Canvas: chunk loading, modelled on Our World of Pixels ----------
// OWOP (OurSources/owop-client, canvas_renderer.js) does something deceptively
// simple: while any chunk of the view is still missing it paints one repeating
// "unloaded" pattern across the canvas, offset by the camera position so the
// texture is glued to the world and slides with it. Loaded chunks are then
// drawn on top, so the pattern only ever shows through the holes. There are no
// per-chunk overlays, no borders and no blinking: the canvas reads as one
// continuous surface that is gradually being filled in.
//
// We keep that model and add two touches from tile map engines:
//   * the coarse overview the minimap already holds is stretched over a chunk
//     that has not arrived yet, so the art shows up blurred before it is sharp;
//   * arriving pixels develop out of the placeholder over a short fade instead
//     of popping in.
const UNLOADED_TILE = 24; // Pattern period in world-aligned screen pixels.
const PREVIEW_ALPHA = 0.5;

let unloadedPattern = null;

// Built once, like OWOP's unloaded.png: a calm diagonal hatch, light enough to
// read as "nothing here yet" rather than as content.
function unloadedFill(ctx) {
	if (unloadedPattern) return unloadedPattern;
	const tile = document.createElement('canvas');
	tile.width = tile.height = UNLOADED_TILE;
	const tctx = tile.getContext('2d');
	tctx.fillStyle = '#eef1f6';
	tctx.fillRect(0, 0, UNLOADED_TILE, UNLOADED_TILE);
	tctx.strokeStyle = '#e1e7f0';
	tctx.lineWidth = 6;
	tctx.beginPath();
	tctx.moveTo(-UNLOADED_TILE, UNLOADED_TILE);
	tctx.lineTo(UNLOADED_TILE, -UNLOADED_TILE);
	tctx.moveTo(0, UNLOADED_TILE * 2);
	tctx.lineTo(UNLOADED_TILE * 2, 0);
	tctx.stroke();
	unloadedPattern = ctx.createPattern(tile, 'repeat');
	return unloadedPattern;
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function chunkRect(engine, key) {
	const split = key.indexOf(':');
	const cx = Number(key.slice(0, split)), cy = Number(key.slice(split + 1));
	if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
	const span = FINE_CHUNK_SIZE * engine.scale;
	const x = engine.offsetX + cx * span, y = engine.offsetY + cy * span;
	if (x > engine.viewW || y > engine.viewH || x + span < 0 || y + span < 0) return null;
	return { x, y, span, cx, cy };
}

// Stretches the matching piece of the minimap buffer over a chunk that has not
// arrived yet — the "parent tile" placeholder of map engines.
function drawPreview(ctx, engine, rect) {
	const mini = engine._mini;
	const scale = engine._miniScale;
	if (!mini || !scale) return false;
	const sx = engine._miniOx + (rect.cx * FINE_CHUNK_SIZE - engine._mbx0) * scale;
	const sy = engine._miniOy + (rect.cy * FINE_CHUNK_SIZE - engine._mby0) * scale;
	const size = FINE_CHUNK_SIZE * scale;
	if (size < 0.6) return false;
	if (sx + size <= 0 || sy + size <= 0 || sx >= mini.width || sy >= mini.height) return false;
	try {
		ctx.imageSmoothingEnabled = true; // Blur it on purpose: it is a preview.
		ctx.globalAlpha = PREVIEW_ALPHA;
		ctx.drawImage(mini, sx, sy, size, size, rect.x, rect.y, rect.span, rect.span);
		ctx.globalAlpha = 1;
		ctx.imageSmoothingEnabled = false;
		return true;
	} catch { return false; }
}

// Paints the OWOP pattern over the given rectangles in one pass. The pattern
// origin is shifted by the camera offset, so the hatch belongs to the world and
// pans with it instead of crawling across the screen.
function fillUnloaded(ctx, engine, rects) {
	const fill = unloadedFill(ctx);
	if (!fill) return;
	const ox = engine.offsetX % UNLOADED_TILE, oy = engine.offsetY % UNLOADED_TILE;
	ctx.save();
	ctx.translate(ox, oy);
	ctx.fillStyle = fill;
	for (const rect of rects) ctx.fillRect(rect.x - ox, rect.y - oy, rect.span, rect.span);
	ctx.restore();
}

function drawChunkLoading(ctx, engine) {
	const pending = engine._chunkPending, fading = engine._chunkFade;
	const waiting = pending && pending.size, developing = fading && fading.size;
	if (!waiting && !developing) return;
	const stamp = Date.now();
	ctx.save();
	if (waiting) {
		// A chunk still on the wire shows either the blurred overview or, when
		// there is none, the world-anchored unloaded pattern.
		const bare = [];
		for (const key of pending) {
			const rect = chunkRect(engine, key);
			if (!rect) continue;
			if (!drawPreview(ctx, engine, rect)) bare.push(rect);
		}
		if (bare.length) fillUnloaded(ctx, engine, bare);
	}
	// Arrived content develops out of its placeholder: the veil is painted in
	// the world background so pixels emerge instead of popping in.
	if (developing) {
		const veil = engine.world?.background || '#ffffff';
		for (const [key, at] of fading) {
			const rect = chunkRect(engine, key);
			if (!rect) continue;
			const age = stamp - at;
			if (age < 0) continue; // Staggered start: this chunk has not begun yet.
			const alpha = 1 - easeOut(Math.min(1, age / CHUNK_FADE_MS));
			if (alpha <= 0.01) continue;
			ctx.globalAlpha = alpha;
			ctx.fillStyle = veil;
			ctx.fillRect(rect.x, rect.y, rect.span, rect.span);
			// The blurred preview lingers underneath for a moment, so the crisp
			// pixels appear to sharpen rather than replace the placeholder.
			if (alpha > 0.15) { ctx.globalAlpha = alpha * 0.6; drawPreview(ctx, engine, rect); }
		}
		ctx.globalAlpha = 1;
	}
	ctx.restore();
}

const originalSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	originalSetWorld.apply(this, args); window.__pixelEngine = this; this.showSpawnZone = localStorage.getItem('pf.hideSpawnZone') !== '1';
	this.onOverlay = (ctx) => drawChunkLoading(ctx, this);
};
PixelEngine.prototype._drawZone = function (ctx) { const sp = this._spawn(); if (!sp || !this.world?.infinite || this.showSpawnZone === false) return; const x = this.offsetX, y = this.offsetY, size = sp * this.scale; ctx.save(); ctx.fillStyle = 'rgba(37,99,235,.045)'; ctx.fillRect(x, y, size, size); ctx.fillStyle = 'rgba(37,99,235,.32)'; ctx.font = '600 11px system-ui'; const lx = Math.min(Math.max(x + 8, 8), this.viewW - 52), ly = Math.min(Math.max(y + 16, 16), this.viewH - 8); ctx.fillText(`${sp}×${sp}`, lx, ly); ctx.restore(); };

// Fallback catalogue used when the server wardrobe is unavailable.
const cosmetics = [
	['frame_neon', 'Неоновая рамка', 'frame'], ['frame_aurora', 'Рамка «Аврора»', 'frame'], ['frame_forest', 'Рамка «Чаща»', 'frame'], ['frame_crimson', 'Рамка «Багрянец»', 'frame'],
	['nick_gradient', 'Градиентный ник', 'nick'], ['nick_gold', 'Золотой ник', 'nick'], ['nick_ice', 'Ледяной ник', 'nick'], ['nick_mint', 'Мятный ник', 'nick'],
	['badge_pioneer', 'Значок пионера', 'badge'], ['badge_creator', 'Значок творца', 'badge'], ['badge_architect', 'Значок архитектора', 'badge'], ['badge_guardian', 'Значок хранителя', 'badge'],
	['trail_spark', 'Искристый след', 'trail'], ['trail_rainbow', 'Радужный след', 'trail'], ['trail_ember', 'Углистый след', 'trail'],
	['cursor_comet', 'Курсор-комета', 'cursor'], ['cursor_pixel', 'Курсор-пиксель', 'cursor'], ['cursor_halo', 'Курсор-ореол', 'cursor']
];

// ---------- Cosmetics in chat (every author, not only the current player) ----------
const chatCosmetics = new Map(); // nick -> equipped slots
const pendingLookups = new Set();
let myCosmetics = {};

function markSignature(active) { return MARK_SLOTS.map((slot) => active[slot] || '').join('|'); }

// Badges, trails and cursors are rendered as separate marks in front of the
// nickname instead of CSS pseudo-elements: several slots can be worn at once
// (::before could only ever show one) and the icons no longer collide with the
// message text. The colon after the nick is dropped as well, so a mark is
// always followed by clean spacing.
function decorateNode(node, active, nick) {
	const className = 'chat-nick' + (active.nick ? ` cosmetic-${active.nick}` : '');
	if (node.textContent !== nick) node.textContent = nick;
	if (node.className !== className) node.className = className;
	const host = node.parentNode;
	if (!host) return;
	const signature = markSignature(active);
	if (node.dataset.marks === signature) return; // Nothing to redo on later passes.
	node.dataset.marks = signature;
	host.querySelectorAll(':scope > .chat-mark').forEach((mark) => mark.remove());
	for (const slot of MARK_SLOTS) {
		if (!active[slot]) continue;
		const mark = el('span', { class: 'chat-mark' });
		mark.dataset.mark = active[slot];
		host.insertBefore(mark, node);
	}
}

function decorateChat() {
	document.querySelectorAll('.chat-msg').forEach((row) => {
		const node = row.querySelector('.chat-nick');
		if (!node) return;
		const nick = (node.dataset.nick || node.textContent).replace(/:\s*$/, '').trim();
		if (!nick) return;
		if (node.dataset.nick !== nick) node.dataset.nick = nick;
		// Strip the colon straight away so the nickname never flickers between
		// "nick:" and the decorated form while cosmetics are being fetched.
		if (node.textContent !== nick) node.textContent = nick;
		const active = chatCosmetics.get(nick);
		if (!active) { if (!pendingLookups.has(nick)) lookupCosmetics(nick); return; }
		decorateNode(node, active, nick);
		const frame = active.frame || '';
		if (row.dataset.cosmeticFrame !== frame) row.dataset.cosmeticFrame = frame;
	});
}

// The header badge must reflect the equipped items right after a reload, not
// only once the profile modal has been opened.
function decorateHeader() {
	const box = document.querySelector('#userBox .me');
	const node = box?.querySelector('.me-nick') || box?.querySelector('.chat-nick');
	const nick = api.state.me?.nick;
	if (!box || !node || !nick) return;
	if (node.dataset.nick !== nick) node.dataset.nick = nick;
	if (node.textContent !== nick) node.textContent = nick;
	const className = 'me-nick chat-nick' + (myCosmetics.nick ? ` cosmetic-${myCosmetics.nick}` : '');
	if (node.className !== className) node.className = className;
	const signature = markSignature(myCosmetics);
	if (node.dataset.marks !== signature) {
		node.dataset.marks = signature;
		box.querySelectorAll(':scope > .chat-mark').forEach((mark) => mark.remove());
		for (const slot of MARK_SLOTS) {
			if (!myCosmetics[slot]) continue;
			const mark = el('span', { class: 'chat-mark' });
			mark.dataset.mark = myCosmetics[slot];
			box.insertBefore(mark, node);
		}
	}
	const frame = myCosmetics.frame || '';
	if (box.dataset.cosmeticFrame !== frame) box.dataset.cosmeticFrame = frame;
}

async function lookupCosmetics(nick) {
	pendingLookups.add(nick);
	try { const result = await api.get(`/api/cosmetics?nick=${encodeURIComponent(nick)}`); chatCosmetics.set(nick, result.cosmetics || {}); }
	catch { chatCosmetics.set(nick, {}); }
	finally { pendingLookups.delete(nick); }
}

// Chat history now carries each author's cosmetics; cache them before rendering.
if (typeof api.chatGet === 'function') {
	const originalChatGet = api.chatGet.bind(api);
	api.chatGet = async (worldId) => {
		const result = await originalChatGet(worldId);
		if (result.cosmetics) for (const [nick, slots] of Object.entries(result.cosmetics)) chatCosmetics.set(nick, slots || {});
		for (const message of result.messages || []) if (message.cosmetics) chatCosmetics.set(message.nick, message.cosmetics);
		return result;
	};
}

// Live SSE messages carry no cosmetics, so unknown authors are resolved on demand.
if (typeof api.stream === 'function') {
	const originalStream = api.stream.bind(api);
	api.stream = (worldId, handlers = {}) => {
		const chat = handlers.chat;
		if (chat) handlers.chat = (data) => {
			if (data?.cosmetics) chatCosmetics.set(data.nick, data.cosmetics);
			chat(data);
			if (data?.nick && !chatCosmetics.has(data.nick) && !pendingLookups.has(data.nick)) lookupCosmetics(data.nick);
		};
		return originalStream(worldId, handlers);
	};
}

// Completing a daily quest now notifies the player the same way achievements do.
if (typeof api.ops === 'function') {
	const originalOps = api.ops.bind(api);
	api.ops = async (worldId, payload) => {
		const result = await originalOps(worldId, payload);
		for (const quest of result?.reward?.quests || []) {
			const reward = quest.reward ? ` · ${quest.reward.coins || 0} ◉, ${quest.reward.xp || 0} XP` : '';
			toast(`Задание выполнено: ${quest.title || quest.id}${reward}`, 'success');
		}
		return result;
	};
}

function applyCosmetics(active = {}) {
	myCosmetics = { ...active };
	for (const slot of SLOTS) document.body.dataset[`cosmetic${slot[0].toUpperCase()}${slot.slice(1)}`] = active[slot] || '';
	const nick = api.state.me?.nick;
	if (nick) chatCosmetics.set(nick, { ...active });
}

// Load the equipped set as soon as the player is known, so a page refresh shows
// the cosmetics immediately instead of waiting for the profile to be opened.
async function loadMyCosmetics() {
	if (!api.state.me) return;
	try { const pref = await api.get('/api/me/preferences'); applyCosmetics(pref.cosmetics?.equipped || {}); }
	catch { /* Cosmetics are decorative; ignore transport errors. */ }
}

// Visual preview of a cosmetic item, reusing the chat decoration classes so the
// wardrobe shows exactly what other players will see.
function cosmeticPreview(key, slot, nick) {
	const wrap = el('div', { class: 'wardrobe-preview' });
	if (MARK_SLOTS.includes(slot)) { const mark = el('span', { class: 'chat-mark' }); mark.dataset.mark = key; wrap.appendChild(mark); }
	wrap.appendChild(el('span', { class: 'chat-nick' + (slot === 'nick' ? ` cosmetic-${key}` : '') }, nick || 'Игрок'));
	if (slot === 'frame') wrap.dataset.cosmeticFrame = key;
	return wrap;
}

function wardrobeList(pref, inventory) {
	const owned = pref.cosmetics?.owned;
	if (Array.isArray(owned) && owned.length) return owned.map((item) => [item.key, item.title, item.slot]);
	return cosmetics.filter(([key]) => inventory.items?.[key]);
}

async function openPlayerProfile() {
	try { const [stats, inventory, pref] = await Promise.all([api.stats(), api.inventory(), api.get('/api/me/preferences')]); const active = pref.cosmetics?.equipped || {}; applyCosmetics(active);
		const body = el('div', { class: 'profile' }, el('h4', {}, 'Глобальная статистика'), el('div', { class: 'stat-grid' }, stat('Уровень', stats.global.level), stat('XP', stats.global.xp), stat('Монеты', stats.global.coins)));
		const wearable = wardrobeList(pref, inventory);
		body.appendChild(el('h4', {}, 'Гардероб — по одной вещи каждого типа'));
		if (!wearable.length) body.appendChild(el('div', { class: 'muted small' }, 'Пока нет купленных предметов — заглядывайте в магазин.'));
		else {
			const grid = el('div', { class: 'wardrobe' });
			for (const [key, title, slot] of wearable) {
				const card = el('button', { class: 'wardrobe-item', type: 'button' }, el('span', { class: 'wardrobe-slot' }, SLOT_TITLES[slot] || slot), cosmeticPreview(key, slot, api.state.me?.nick), el('span', { class: 'small' }, title));
				card.dataset.slot = slot;
				card.dataset.key = key;
				card.dataset.active = String(active[slot] === key);
				card.onclick = async () => {
					try {
						const r = await api.post('/api/me/cosmetics', { key, slot });
						active[slot] = r.cosmetics.equipped[slot];
						applyCosmetics(active);
						// Only the cards of this slot change state; items worn in other
						// slots must stay highlighted.
						grid.querySelectorAll(`.wardrobe-item[data-slot="${slot}"]`).forEach((node) => {
							node.dataset.active = String(active[slot] === node.dataset.key);
						});
						toast(active[slot] === key ? 'Предмет надет' : 'Предмет снят', 'success');
					} catch (err) { toast(err.message, 'error'); }
				};
				grid.appendChild(card);
			}
			body.appendChild(grid);
		}
		const hide = el('input', { type: 'checkbox' }); hide.checked = !!pref.preferences?.hideSpawnZone; hide.addEventListener('change', async () => { localStorage.setItem('pf.hideSpawnZone', hide.checked ? '1' : '0'); if (window.__pixelEngine) { window.__pixelEngine.showSpawnZone = !hide.checked; window.__pixelEngine.draw(); } try { await api.patch('/api/me/preferences', { hideSpawnZone: hide.checked }); } catch {} }); body.appendChild(el('h4', {}, 'Холст')); body.appendChild(el('label', { class: 'profile-setting' }, hide, ' Скрыть метку зоны 1000×1000')); modal('Профиль', body, [{ label: 'Закрыть', primary: true, onClick: (close) => close() }]);
	} catch (err) { toast(err.message, 'error'); }
}
function stat(label, value) { return el('div', { class: 'stat' }, el('span', { class: 'stat-v' }, String(value || 0)), el('span', { class: 'stat-l' }, label)); }

function remainingLabel(event) {
	const until = Number(event.until ?? event.endsAt ?? event.finishAt);
	if (!Number.isFinite(until)) return null;
	const left = until - Date.now();
	if (left <= 0) return 'Завершается';
	const hours = Math.floor(left / 3600000), minutes = Math.floor((left % 3600000) / 60000);
	return hours ? `Осталось ${hours} ч ${minutes} мин` : `Осталось ${minutes} мин`;
}

// Event cards can be expanded to show the goal, personal progress, reward and
// remaining time, so players understand what to do without leaving the panel.
function enhanceEvents() {
	const root = document.getElementById('panelBody'), events = api.state._events || [];
	if (!root || !events.length) return;
	root.querySelectorAll('.quest').forEach((node) => {
		if (node.dataset.eventReady) return;
		const event = events.find((item) => node.textContent.includes(item.title || item.key));
		if (!event) return;
		node.dataset.eventReady = '1';
		const goal = Number(event.goalPerPlayer || 0), mine = Number(event.myProgress ?? event.progress ?? 0);
		const lines = [
			`Цель: ${goal} пикселей`,
			`Ваш прогресс: ${mine}${goal ? ` из ${goal} (${Math.min(100, Math.round((mine / goal) * 100))}%)` : ''}`,
			`Награда: ${event.reward?.coins || 0} монет, ${event.reward?.xp || 0} XP`
		];
		const left = remainingLabel(event);
		if (left) lines.push(left);
		if (event.description) lines.push(event.description);
		const details = el('div', { class: 'event-details muted small' });
		for (const line of lines) details.appendChild(el('div', {}, line));
		details.hidden = true;
		const button = el('button', { class: 'link-btn', onclick: () => { details.hidden = !details.hidden; button.textContent = details.hidden ? 'Подробнее' : 'Скрыть'; } }, 'Подробнее');
		node.firstChild.appendChild(button);
		node.appendChild(details);
	});
}

if (typeof api.events === 'function') {
	const originalEvents = api.events.bind(api);
	api.events = async () => { const result = await originalEvents(); api.state._events = result.active || []; return result; };
}

// ---------- DOM synchronisation ----------
// A single reentrancy-guarded pass on a timer. Every edit below checks the
// current value first, so a steady-state pass performs no DOM writes at all and
// cannot trigger further work.
let syncing = false;
let cosmeticsRequested = false;

function sync() {
	if (syncing) return;
	syncing = true;
	try {
		const chat = document.querySelector('#sidebar .tab[data-tab="chat"]'), toggle = document.getElementById('sidebarToggle'), tabs = document.querySelector('#sidebar .tabs');
		if (chat && toggle && tabs && toggle.nextElementSibling !== chat) tabs.insertBefore(toggle, chat);
		const me = document.querySelector('#userBox .me');
		if (me && !me.dataset.profilePatch) { me.dataset.profilePatch = '1'; me.onclick = openPlayerProfile; }
		if (api.state.me && !cosmeticsRequested) { cosmeticsRequested = true; loadMyCosmetics(); }
		if (!api.state.me) cosmeticsRequested = false; // Allow a reload after signing out.
		decorateHeader();
		decorateChat();
		enhanceEvents();
	} catch (error) { console.error('experience patch failed:', error); }
	finally { syncing = false; }
}

setInterval(sync, SYNC_INTERVAL_MS);
sync();
