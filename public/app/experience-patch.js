// Player-experience layer: sidebar, cosmetics, quests/events and spawn preference.
// The viewport chunk loader now lives in chunk-prefetch.js; this file must not
// override it again or the progressive centre-first loading would be lost.
import { PixelEngine } from './engine.js';
import { api } from './api.js';
import { el, modal, toast } from './ui.js';

const FINE_CHUNK_SIZE = 86;
const SLOTS = ['frame', 'nick', 'badge', 'trail', 'cursor'];
const SLOT_TITLES = { frame: 'Рамка', nick: 'Ник', badge: 'Значок', trail: 'След', cursor: 'Курсор' };
const originalSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	originalSetWorld.apply(this, args); window.__pixelEngine = this; this.showSpawnZone = localStorage.getItem('pf.hideSpawnZone') !== '1';
	this.onOverlay = (ctx) => { if (this.scale > 1.5 || !this._loadedChunks) return; ctx.save(); ctx.strokeStyle = 'rgba(37,99,235,.16)'; ctx.lineWidth = 1; for (const key of this._loadedChunks) { const [cx, cy] = key.split(':').map(Number), size = FINE_CHUNK_SIZE * this.scale; ctx.strokeRect(this.offsetX + cx * size, this.offsetY + cy * size, size, size); } ctx.restore(); };
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

function decorateChat() {
	document.querySelectorAll('.chat-msg').forEach((row) => {
		const node = row.querySelector('.chat-nick');
		if (!node) return;
		const nick = node.textContent.replace(/:\s*$/, '').trim();
		if (!nick) return;
		const active = chatCosmetics.get(nick);
		if (!active) { if (!pendingLookups.has(nick)) lookupCosmetics(nick); return; }
		node.className = 'chat-nick' + (active.nick ? ` cosmetic-${active.nick}` : '');
		for (const slot of SLOTS) {
			if (slot === 'nick') continue;
			if (active[slot]) node.dataset[slot] = active[slot];
			else delete node.dataset[slot];
		}
		row.dataset.cosmeticFrame = active.frame || '';
	});
}

async function lookupCosmetics(nick) {
	pendingLookups.add(nick);
	try { const result = await api.get(`/api/cosmetics?nick=${encodeURIComponent(nick)}`); chatCosmetics.set(nick, result.cosmetics || {}); decorateChat(); }
	catch { chatCosmetics.set(nick, {}); }
	finally { pendingLookups.delete(nick); }
}

// Chat history now carries each author's cosmetics; cache them before rendering.
const originalChatGet = api.chatGet.bind(api);
api.chatGet = async (worldId) => {
	const result = await originalChatGet(worldId);
	if (result.cosmetics) for (const [nick, slots] of Object.entries(result.cosmetics)) chatCosmetics.set(nick, slots || {});
	for (const message of result.messages || []) if (message.cosmetics) chatCosmetics.set(message.nick, message.cosmetics);
	setTimeout(decorateChat, 0);
	return result;
};

// Live SSE messages carry no cosmetics, so unknown authors are resolved on demand.
const originalStream = api.stream.bind(api);
api.stream = (worldId, handlers = {}) => {
	const chat = handlers.chat;
	if (chat) handlers.chat = (data) => {
		if (data?.cosmetics) chatCosmetics.set(data.nick, data.cosmetics);
		chat(data);
		if (data?.nick && !chatCosmetics.has(data.nick)) lookupCosmetics(data.nick); else setTimeout(decorateChat, 0);
	};
	return originalStream(worldId, handlers);
};

function applyCosmetics(active = {}) { for (const slot of SLOTS) document.body.dataset[`cosmetic${slot[0].toUpperCase()}${slot.slice(1)}`] = active[slot] || ''; const nick = api.state.me?.nick; if (nick) chatCosmetics.set(nick, { ...active }); decorateChat(); }

// Visual preview of a cosmetic item, reusing the chat decoration classes so the
// wardrobe shows exactly what other players will see.
function cosmeticPreview(key, slot, nick) {
	const sample = el('span', { class: 'chat-nick' + (slot === 'nick' ? ` cosmetic-${key}` : '') }, nick || 'Игрок');
	if (slot !== 'nick') sample.dataset[slot] = key;
	const wrap = el('div', { class: 'wardrobe-preview' }, sample);
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
				card.dataset.active = String(active[slot] === key);
				card.onclick = async () => {
					try { const r = await api.post('/api/me/cosmetics', { key, slot }); active[slot] = r.cosmetics.equipped[slot]; applyCosmetics(active); grid.querySelectorAll('.wardrobe-item').forEach((node) => { node.dataset.active = 'false'; }); card.dataset.active = String(active[slot] === key); toast(active[slot] === key ? 'Предмет надет' : 'Предмет снят', 'success'); }
					catch (err) { toast(err.message, 'error'); }
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
const originalEvents = api.events; api.events = async () => { const result = await originalEvents(); api.state._events = result.active || []; return result; };
const observer = new MutationObserver(() => { const chat = document.querySelector('#sidebar .tab[data-tab="chat"]'), toggle = document.getElementById('sidebarToggle'), tabs = document.querySelector('#sidebar .tabs'); if (chat && toggle && tabs && toggle.previousElementSibling !== null) tabs.insertBefore(toggle, chat); const me = document.querySelector('#userBox .me'); if (me && !me.dataset.profilePatch) { me.dataset.profilePatch = '1'; me.onclick = openPlayerProfile; } decorateChat(); enhanceEvents(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
