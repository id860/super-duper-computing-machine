// Player-experience layer: sidebar, cosmetics, quests/events and spawn preference.
// The viewport chunk loader now lives in chunk-prefetch.js; this file must not
// override it again or the batched viewport loading would be lost.
//
// Everything here reacts to DOM changes made by main.js. The observer therefore
// has two hard rules: it must never run while we are editing the DOM ourselves
// (that used to feed itself and freeze the tab right after signing in), and
// every edit must be idempotent so a repeated pass changes nothing.
import { PixelEngine } from './engine.js';
import { CHUNK_FLASH_MS } from './chunk-prefetch.js';
import { api } from './api.js';
import { el, modal, toast } from './ui.js';

const FINE_CHUNK_SIZE = 86;
const SLOTS = ['frame', 'nick', 'badge', 'trail', 'cursor'];
const MARK_SLOTS = ['badge', 'trail', 'cursor'];
const SLOT_TITLES = { frame: 'Рамка', nick: 'Ник', badge: 'Значок', trail: 'След', cursor: 'Курсор' };

// ---------- Canvas: chunks appear with a soft pulse and fade away ----------
// No permanent grid is drawn any more: the player sees the area light up as it
// arrives, the glow fades within a second, and the canvas is left clean.
const SUBCHUNK_MIN_SCALE = 0.5; // Below this the 3×3 split is invisible anyway.

function easeOut(t) { return 1 - Math.pow(1 - t, 2); }

function drawChunkPulse(ctx, engine, key, age) {
	const split = key.indexOf(':');
	const cx = Number(key.slice(0, split)), cy = Number(key.slice(split + 1));
	if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
	const span = FINE_CHUNK_SIZE * engine.scale;
	const x = engine.offsetX + cx * span, y = engine.offsetY + cy * span;
	if (x > engine.viewW || y > engine.viewH || x + span < 0 || y + span < 0) return;
	// Fresh chunks start bright and settle to nothing.
	const fade = 1 - easeOut(Math.min(1, age / CHUNK_FLASH_MS));
	if (fade <= 0.01) return;
	const gradient = ctx.createLinearGradient(x, y, x, y + span);
	gradient.addColorStop(0, `rgba(96, 165, 250, ${0.20 * fade})`);
	gradient.addColorStop(1, `rgba(59, 130, 246, ${0.06 * fade})`);
	ctx.fillStyle = gradient;
	ctx.fillRect(x, y, span, span);
	ctx.strokeStyle = `rgba(59, 130, 246, ${0.45 * fade})`;
	ctx.lineWidth = 1;
	ctx.strokeRect(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.round(span), Math.round(span));
	// Close up the pulse shows the chunk splitting into nine blocks before the
	// pixel grid of the engine takes over.
	if (engine.scale < SUBCHUNK_MIN_SCALE) return;
	const third = span / 3;
	ctx.strokeStyle = `rgba(59, 130, 246, ${0.22 * fade})`;
	ctx.beginPath();
	for (let i = 1; i < 3; i++) {
		const gx = Math.floor(x + third * i) + 0.5, gy = Math.floor(y + third * i) + 0.5;
		ctx.moveTo(gx, y); ctx.lineTo(gx, y + span);
		ctx.moveTo(x, gy); ctx.lineTo(x + span, gy);
	}
	ctx.stroke();
}

const originalSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	originalSetWorld.apply(this, args); window.__pixelEngine = this; this.showSpawnZone = localStorage.getItem('pf.hideSpawnZone') !== '1';
	this.onOverlay = (ctx) => {
		const flash = this._chunkFlash;
		if (!flash || !flash.size) return;
		const stamp = Date.now();
		ctx.save();
		for (const [key, at] of flash) drawChunkPulse(ctx, this, key, stamp - at);
		ctx.restore();
	};
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
	try { const result = await api.get(`/api/cosmetics?nick=${encodeURIComponent(nick)}`); chatCosmetics.set(nick, result.cosmetics || {}); sync(); }
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
		setTimeout(sync, 0);
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
			if (data?.nick && !chatCosmetics.has(data.nick)) lookupCosmetics(data.nick); else setTimeout(sync, 0);
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
	sync();
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
// The observer is disconnected while we edit, and reconnected afterwards. Any
// change we make during a pass would otherwise retrigger the callback, which is
// exactly what locked up the page after registering.
let observer = null;
let syncing = false;
let queued = false;
let cosmeticsRequested = false;

function patchDom() {
	const chat = document.querySelector('#sidebar .tab[data-tab="chat"]'), toggle = document.getElementById('sidebarToggle'), tabs = document.querySelector('#sidebar .tabs');
	if (chat && toggle && tabs && toggle.nextElementSibling !== chat) tabs.insertBefore(toggle, chat);
	const me = document.querySelector('#userBox .me');
	if (me && !me.dataset.profilePatch) { me.dataset.profilePatch = '1'; me.onclick = openPlayerProfile; }
	if (api.state.me && !cosmeticsRequested) { cosmeticsRequested = true; loadMyCosmetics(); }
	if (!api.state.me) cosmeticsRequested = false; // Allow a reload after signing out.
	decorateHeader();
	decorateChat();
	enhanceEvents();
}

function sync() {
	if (syncing) return;
	syncing = true;
	observer?.disconnect();
	try { patchDom(); }
	catch (error) { console.error('experience patch failed:', error); }
	finally {
		observer?.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
		syncing = false;
	}
}

function scheduleSync() {
	if (syncing || queued) return;
	queued = true;
	const run = () => { queued = false; sync(); };
	if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
}

observer = new MutationObserver(scheduleSync);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
scheduleSync();
