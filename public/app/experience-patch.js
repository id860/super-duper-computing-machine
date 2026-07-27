// Player-experience layer: concise sidebar control, cosmetics, quests/events and spawn preference.
import { PixelEngine } from './engine.js';
import { api } from './api.js';
import { el, modal, toast } from './ui.js';

const originalSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	originalSetWorld.apply(this, args);
	window.__pixelEngine = this;
	this.showSpawnZone = localStorage.getItem('pf.hideSpawnZone') !== '1';
	this.onOverlay = (ctx) => {
		if (this.scale > 1.5 || !this._loadedChunks) return;
		ctx.save(); ctx.strokeStyle = 'rgba(37,99,235,.16)'; ctx.lineWidth = 1;
		for (const key of this._loadedChunks) {
			const [cx, cy] = key.split(':').map(Number), size = 256 * this.scale;
			ctx.strokeRect(this.offsetX + cx * size, this.offsetY + cy * size, size, size);
		}
		ctx.restore();
	};
};
PixelEngine.prototype._drawZone = function (ctx) {
	const sp = this._spawn();
	if (!sp || !this.world?.infinite || this.showSpawnZone === false) return;
	const x = this.offsetX, y = this.offsetY, size = sp * this.scale;
	ctx.save();
	ctx.fillStyle = 'rgba(37,99,235,.045)'; ctx.fillRect(x, y, size, size);
	ctx.fillStyle = 'rgba(37,99,235,.32)'; ctx.font = '600 11px system-ui';
	const label = `${sp}×${sp}`;
	const lx = Math.min(Math.max(x + 8, 8), this.viewW - 52), ly = Math.min(Math.max(y + 16, 16), this.viewH - 8);
	ctx.fillText(label, lx, ly); ctx.restore();
};

const cosmetics = [['frame_neon', 'Неоновая рамка'], ['nick_gradient', 'Градиентный ник'], ['badge_pioneer', 'Значок пионера']];
function applyCosmetic(key) { document.body.dataset.cosmetic = key || ''; }
async function openPlayerProfile() {
	try {
		const [stats, inventory, pref] = await Promise.all([api.stats(), api.inventory(), api.get('/api/me/preferences')]);
		const equipped = pref.cosmetics?.equipped || null; applyCosmetic(equipped);
		const body = el('div', { class: 'profile' }, el('h4', {}, 'Глобальная статистика'), el('div', { class: 'stat-grid' }, stat('Уровень', stats.global.level), stat('XP', stats.global.xp), stat('Монеты', stats.global.coins)));
		body.appendChild(el('h4', {}, 'Косметика'));
		for (const [key, title] of cosmetics) {
			const owned = !!inventory.items?.[key], active = equipped === key;
			body.appendChild(el('div', { class: 'quest' }, el('div', {}, el('strong', {}, title), el('div', { class: 'muted small' }, owned ? (active ? 'Надето' : 'Куплено') : 'Не куплено')), el('button', { class: 'btn small', disabled: !owned, onclick: async (e) => { try { const r = await api.post('/api/me/cosmetics', { equipped: active ? null : key }); applyCosmetic(r.cosmetics.equipped); e.target.textContent = active ? 'Надеть' : 'Надето'; toast('Косметика обновлена', 'success'); } catch (err) { toast(err.message, 'error'); } } }, active ? 'Снять' : 'Надеть')));
		}
		const hide = el('input', { type: 'checkbox' }); hide.checked = !!pref.preferences?.hideSpawnZone;
		hide.addEventListener('change', async () => { localStorage.setItem('pf.hideSpawnZone', hide.checked ? '1' : '0'); if (window.__pixelEngine) { window.__pixelEngine.showSpawnZone = !hide.checked; window.__pixelEngine.draw(); } try { await api.patch('/api/me/preferences', { hideSpawnZone: hide.checked }); } catch {} });
		body.appendChild(el('h4', {}, 'Холст'));
		body.appendChild(el('label', { class: 'profile-setting' }, hide, ' Скрыть метку зоны 1000×1000'));
		modal('Профиль', body, [{ label: 'Закрыть', primary: true, onClick: (close) => close() }]);
	} catch (err) { toast(err.message, 'error'); }
}
function stat(label, value) { return el('div', { class: 'stat' }, el('span', { class: 'stat-v' }, String(value || 0)), el('span', { class: 'stat-l' }, label)); }
function enhanceEvents() {
	const root = document.getElementById('panelBody'); if (!root) return;
	const events = api.state._events || [];
	if (!events.length) return;
	root.querySelectorAll('.quest').forEach((node) => {
		if (node.dataset.eventReady) return;
		const event = events.find((item) => node.textContent.includes(item.title || item.key));
		if (!event) return;
		node.dataset.eventReady = '1'; const details = el('div', { class: 'event-details muted small' }, `Цель: ${event.goalPerPlayer || 0} пикселей · Награда: ${event.reward?.coins || 0} монет, ${event.reward?.xp || 0} XP`); details.hidden = true;
		const button = el('button', { class: 'link-btn', onclick: () => { details.hidden = !details.hidden; button.textContent = details.hidden ? 'Подробнее' : 'Скрыть'; } }, 'Подробнее');
		node.firstChild.appendChild(button); node.appendChild(details);
	});
}
const originalEvents = api.events; api.events = async () => { const result = await originalEvents(); api.state._events = result.active || []; return result; };
const observer = new MutationObserver(() => {
	const chat = document.querySelector('#sidebar .tab[data-tab="chat"]'), toggle = document.getElementById('sidebarToggle');
	if (chat && toggle && toggle.previousElementSibling !== chat) chat.insertAdjacentElement('afterend', toggle);
	const me = document.querySelector('#userBox .me'); if (me && !me.dataset.profilePatch) { me.dataset.profilePatch = '1'; me.onclick = openPlayerProfile; }
	enhanceEvents();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
