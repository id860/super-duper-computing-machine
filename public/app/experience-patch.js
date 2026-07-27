// Player-experience layer: sidebar, fine chunks, cosmetics, quests/events and spawn preference.
import { PixelEngine } from './engine.js';
import { api } from './api.js';
import { el, modal, toast } from './ui.js';

const FINE_CHUNK_SIZE = 86;
const originalSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	originalSetWorld.apply(this, args); window.__pixelEngine = this; this.showSpawnZone = localStorage.getItem('pf.hideSpawnZone') !== '1';
	this.onOverlay = (ctx) => { if (this.scale > 1.5 || !this._loadedChunks) return; ctx.save(); ctx.strokeStyle = 'rgba(37,99,235,.16)'; ctx.lineWidth = 1; for (const key of this._loadedChunks) { const [cx, cy] = key.split(':').map(Number), size = FINE_CHUNK_SIZE * this.scale; ctx.strokeRect(this.offsetX + cx * size, this.offsetY + cy * size, size, size); } ctx.restore(); };
};
// Immediate single fine-chunk fetch avoids waiting for a 256×256 payload. Pending pans are coalesced.
PixelEngine.prototype._loadViewportChunks = async function () {
	if (!this.world?.infinite) return;
	if (this._chunkLoading) { this._chunkPending = true; return; }
	const cx = Math.max(0, Math.floor(((this.viewW / 2 - this.offsetX) / this.scale) / FINE_CHUNK_SIZE)), cy = Math.max(0, Math.floor(((this.viewH / 2 - this.offsetY) / this.scale) / FINE_CHUNK_SIZE)), key = `${cx}:${cy}`;
	if (this._loadedChunks?.has(key)) return;
	this._chunkLoading = true; const worldId = this._chunkWorldId;
	try { const response = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/chunks?cx=${cx}&cy=${cy}&radius=0`, { credentials: 'same-origin' }); if (!response.ok || worldId !== this._chunkWorldId) return; const data = await response.json(), cells = []; for (const chunk of data.chunks || []) { this._loadedChunks.add(`${chunk.x}:${chunk.y}`); cells.push(...(chunk.cells || [])); } if (cells.length) this.applyPixels(cells); }
	catch { this._chunkPending = true; }
	finally { this._chunkLoading = false; if (this._chunkPending) { this._chunkPending = false; setTimeout(() => this._loadViewportChunks(), 0); } }
};
PixelEngine.prototype._drawZone = function (ctx) { const sp = this._spawn(); if (!sp || !this.world?.infinite || this.showSpawnZone === false) return; const x = this.offsetX, y = this.offsetY, size = sp * this.scale; ctx.save(); ctx.fillStyle = 'rgba(37,99,235,.045)'; ctx.fillRect(x, y, size, size); ctx.fillStyle = 'rgba(37,99,235,.32)'; ctx.font = '600 11px system-ui'; const lx = Math.min(Math.max(x + 8, 8), this.viewW - 52), ly = Math.min(Math.max(y + 16, 16), this.viewH - 8); ctx.fillText(`${sp}×${sp}`, lx, ly); ctx.restore(); };

const cosmetics = [
	['frame_neon', 'Неоновая рамка', 'frame'], ['frame_aurora', 'Рамка «Аврора»', 'frame'], ['nick_gradient', 'Градиентный ник', 'nick'], ['nick_gold', 'Золотой ник', 'nick'], ['badge_pioneer', 'Значок пионера', 'badge'], ['badge_creator', 'Значок творца', 'badge'], ['trail_spark', 'Искристый след', 'trail'], ['cursor_comet', 'Курсор-комета', 'cursor']
];
function applyCosmetics(active = {}) { for (const slot of ['frame', 'nick', 'badge', 'trail', 'cursor']) document.body.dataset[`cosmetic${slot[0].toUpperCase()}${slot.slice(1)}`] = active[slot] || ''; decorateOwnChat(active); }
function decorateOwnChat(active = {}) { const nick = api.state.me?.nick; if (!nick) return; document.querySelectorAll('.chat-nick').forEach((node) => { if (!node.textContent.startsWith(nick + ':')) return; node.className = `chat-nick cosmetic-${active.nick || ''}`; if (active.badge) node.dataset.badge = active.badge; }); }
async function openPlayerProfile() {
	try { const [stats, inventory, pref] = await Promise.all([api.stats(), api.inventory(), api.get('/api/me/preferences')]); const active = pref.cosmetics?.equipped || {}; applyCosmetics(active);
		const body = el('div', { class: 'profile' }, el('h4', {}, 'Глобальная статистика'), el('div', { class: 'stat-grid' }, stat('Уровень', stats.global.level), stat('XP', stats.global.xp), stat('Монеты', stats.global.coins))); body.appendChild(el('h4', {}, 'Косметика — можно надеть по одной вещи каждого типа'));
		for (const [key, title, slot] of cosmetics) { const owned = !!inventory.items?.[key], worn = active[slot] === key; body.appendChild(el('div', { class: 'quest' }, el('div', {}, el('strong', {}, title), el('div', { class: 'muted small' }, owned ? (worn ? 'Надето' : `Слот: ${slot}`) : 'Не куплено')), el('button', { class: 'btn small', disabled: !owned, onclick: async (event) => { try { const r = await api.post('/api/me/cosmetics', { key, slot }); active[slot] = r.cosmetics.equipped[slot]; applyCosmetics(active); event.target.textContent = active[slot] === key ? 'Снять' : 'Надеть'; toast('Косметика обновлена', 'success'); } catch (err) { toast(err.message, 'error'); } } }, worn ? 'Снять' : 'Надеть'))); }
		const hide = el('input', { type: 'checkbox' }); hide.checked = !!pref.preferences?.hideSpawnZone; hide.addEventListener('change', async () => { localStorage.setItem('pf.hideSpawnZone', hide.checked ? '1' : '0'); if (window.__pixelEngine) { window.__pixelEngine.showSpawnZone = !hide.checked; window.__pixelEngine.draw(); } try { await api.patch('/api/me/preferences', { hideSpawnZone: hide.checked }); } catch {} }); body.appendChild(el('h4', {}, 'Холст')); body.appendChild(el('label', { class: 'profile-setting' }, hide, ' Скрыть метку зоны 1000×1000')); modal('Профиль', body, [{ label: 'Закрыть', primary: true, onClick: (close) => close() }]);
	} catch (err) { toast(err.message, 'error'); }
}
function stat(label, value) { return el('div', { class: 'stat' }, el('span', { class: 'stat-v' }, String(value || 0)), el('span', { class: 'stat-l' }, label)); }
function enhanceEvents() { const root = document.getElementById('panelBody'), events = api.state._events || []; if (!root || !events.length) return; root.querySelectorAll('.quest').forEach((node) => { if (node.dataset.eventReady) return; const event = events.find((item) => node.textContent.includes(item.title || item.key)); if (!event) return; node.dataset.eventReady = '1'; const details = el('div', { class: 'event-details muted small' }, `Цель: ${event.goalPerPlayer || 0} пикселей · Награда: ${event.reward?.coins || 0} монет, ${event.reward?.xp || 0} XP`); details.hidden = true; const button = el('button', { class: 'link-btn', onclick: () => { details.hidden = !details.hidden; button.textContent = details.hidden ? 'Подробнее' : 'Скрыть'; } }, 'Подробнее'); node.firstChild.appendChild(button); node.appendChild(details); }); }
const originalEvents = api.events; api.events = async () => { const result = await originalEvents(); api.state._events = result.active || []; return result; };
const observer = new MutationObserver(() => { const chat = document.querySelector('#sidebar .tab[data-tab="chat"]'), toggle = document.getElementById('sidebarToggle'), tabs = document.querySelector('#sidebar .tabs'); if (chat && toggle && tabs && toggle.previousElementSibling !== null) tabs.insertBefore(toggle, chat); const me = document.querySelector('#userBox .me'); if (me && !me.dataset.profilePatch) { me.dataset.profilePatch = '1'; me.onclick = openPlayerProfile; } decorateOwnChat(Object.fromEntries(['frame','nick','badge','trail','cursor'].map((slot) => [slot, document.body.dataset[`cosmetic${slot[0].toUpperCase()}${slot.slice(1)}`]]))); enhanceEvents(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
