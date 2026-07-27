// Точка входа PixelFront Worlds: загрузка, маршрутизация, панели, SSE.
import { api } from './api.js';
import { PixelEngine } from './engine.js';
import { Tools, toast, modal, el, openWizard, authModal } from './ui.js';

const NOTICE = 'Активность в мирах сообщества не влияет на глобальный рейтинг, достижения и экономику.';

const app = {
	engine: null,
	tools: null,
	world: null,
	stream: null,
	energyTimer: null
};

const $ = (id) => document.getElementById(id);

function fmt(n) { return new Intl.NumberFormat('ru-RU').format(n || 0); }

function updateEnergy(energy) {
	if (!energy) return;
	const pct = energy.mode === 'infinite' || energy.mode === 'off' ? 100 : Math.round((energy.value / Math.max(1, energy.max)) * 100);
	$('energyFill').style.width = pct + '%';
	$('energyText').textContent = energy.mode === 'infinite' ? '∞' : energy.mode === 'off' ? '—' : energy.value + '/' + energy.max;
}

function renderMe() {
	const me = api.state.me;
	const box = $('userBox');
	box.innerHTML = '';
	if (!me) {
		box.appendChild(el('button', { class: 'btn btn-primary', onclick: () => authModal(api, () => { renderMe(); reloadWorld(); }) }, 'Войти'));
		return;
	}
	box.appendChild(el('div', { class: 'me', onclick: openProfile },
		el('span', { class: 'me-nick' }, me.nick),
		el('span', { class: 'chip' }, 'ur ' + me.level),
		el('span', { class: 'chip coins' }, fmt(me.coins) + ' ◉')
	));
	if (me.role === 'admin' || me.role === 'moderator') $('tabAdmin').style.display = '';
}

async function openProfile() {
	try {
		const s = await api.stats();
		const g = s.global, c = s.community;
		const body = el('div', { class: 'profile' },
			el('h4', {}, 'Глобальная статистика (официальный мир)'),
			el('div', { class: 'stat-grid' },
				stat('Уровень', g.level), stat('XP', fmt(g.xp)),
				stat('Пиксели', fmt(g.officialPixels)), stat('Монеты', fmt(g.coins)),
				stat('Достижения', (g.achievements || []).length), stat('Квесты', g.questsCompleted || 0)
			),
			el('h4', {}, 'Локальная статистика (миры сообщества)'),
			el('div', { class: 'stat-grid' },
				stat('Пиксели', fmt(c.communityPixels)), stat('Миров создано', c.worldsCreated || 0)
			),
			el('p', { class: 'notice small' }, NOTICE)
		);
		modal('Профиль: ' + api.state.me.nick, body, [
			{ label: 'Выйти', onClick: async (close) => { await api.logout(); close(); renderMe(); location.reload(); } },
			{ label: 'Закрыть', primary: true, onClick: (close) => close() }
		]);
	} catch (err) { toast(err.message, 'error'); }
}

function stat(label, value) { return el('div', { class: 'stat' }, el('span', { class: 'stat-v' }, String(value)), el('span', { class: 'stat-l' }, label)); }

// ---------- Панели ----------
const panels = {};

panels.chat = async (root) => {
	root.innerHTML = '';
	if (!app.world) { root.appendChild(el('p', { class: 'muted small' }, 'Мир не загружен.')); return; }
	const list = el('div', { class: 'chat-list', id: 'chatList' });
	const input = el('input', { class: 'input', placeholder: 'Сообщение…', maxlength: '240' });
	const send = async () => { const t = input.value.trim(); if (!t) return; input.value = ''; try { await api.chatPost(app.world.id, t); } catch (err) { toast(err.message, 'error'); } };
	input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
	root.appendChild(list);
	root.appendChild(el('div', { class: 'chat-input' }, input, el('button', { class: 'btn btn-primary', onclick: send }, '↵')));
	try {
		const r = await api.chatGet(app.world.id);
		for (const m of r.messages) appendChat(m);
	} catch (err) { list.appendChild(el('p', { class: 'muted small' }, 'Чат недоступен')); }
};

function appendChat(m) {
	const list = $('chatList');
	if (!list) return;
	list.appendChild(el('div', { class: 'chat-msg' }, el('span', { class: 'chat-nick' }, m.nick + ': '), el('span', {}, m.text)));
	list.scrollTop = list.scrollHeight;
}

panels.catalog = async (root) => {
	root.innerHTML = '';
	const cats = [['popular', 'Популярные'], ['new', 'Новые'], ['growing', 'Растущие'], ['drawing', 'Рисование'], ['faction', 'Фракции'], ['games', 'Игры'], ['events', 'События'], ['protected', 'Защищённые']];
	const grid = el('div', { class: 'cards' });
	const tabs = el('div', { class: 'subtabs' });
	let active = 'popular';
	const load = async () => {
		grid.innerHTML = '<p class="muted small">Загрузка…</p>';
		try {
			const r = await api.catalog(active);
			grid.innerHTML = '';
			if (!r.worlds.length) grid.appendChild(el('p', { class: 'muted small' }, 'Пока пусто'));
			for (const w of r.worlds) {
				grid.appendChild(el('div', { class: 'card', onclick: () => location.hash = 'world/' + w.id },
					el('div', { class: 'card-icon' }, w.icon || '🎨'),
					el('div', { class: 'card-body' },
						el('div', { class: 'card-title' }, w.name),
						el('div', { class: 'card-meta' }, w.size + ' · ' + w.preset + ' · ' + (w.subscribers || 0) + ' ❤'),
						el('div', { class: 'muted small' }, w.description || '')
					)
				));
			}
		} catch (err) { grid.innerHTML = ''; grid.appendChild(el('p', { class: 'muted small' }, err.message)); }
	};
	for (const [k, label] of cats) tabs.appendChild(el('button', { class: 'subtab' + (k === active ? ' active' : ''), onclick: (e) => { active = k; tabs.querySelectorAll('.subtab').forEach((b) => b.classList.remove('active')); e.target.classList.add('active'); load(); } }, label));
	root.appendChild(el('button', { class: 'btn btn-primary full', onclick: () => { if (!api.state.me) return authModal(api, renderMe); openWizard(api, api.state.config, (w) => location.hash = 'world/' + w.id); } }, '+ Создать мир'));
	root.appendChild(tabs);
	root.appendChild(grid);
	load();
};

panels.rank = async (root) => {
	root.innerHTML = '<p class="muted small">Загрузка…</p>';
	if (!app.world) { root.innerHTML = ''; root.appendChild(el('p', { class: 'muted small' }, 'Мир не загружен.')); return; }
	try {
		const [g, l] = await Promise.all([api.leaderboard(), api.localLeaderboard(app.world.id).catch(() => ({ local: [] }))]);
		root.innerHTML = '';
		root.appendChild(el('h4', {}, 'Глобальный рейтинг'));
		root.appendChild(rankList(g.leaderboard, 'xp'));
		root.appendChild(el('h4', {}, 'Локальный рейтинг мира'));
		root.appendChild(rankList(l.local, 'pixels'));
		if (app.world.type === 'community') root.appendChild(el('p', { class: 'notice small' }, NOTICE));
	} catch (err) { root.innerHTML = ''; root.appendChild(el('p', { class: 'muted small' }, err.message)); }
};

function rankList(rows, field) {
	const list = el('ol', { class: 'rank' });
	if (!rows || !rows.length) { list.appendChild(el('li', { class: 'muted small' }, 'Нет данных')); return list; }
	rows.slice(0, 20).forEach((r) => list.appendChild(el('li', {}, el('span', {}, r.nick || r.userId || '—'), el('span', { class: 'chip' }, fmt(r[field] != null ? r[field] : (r.xp || r.pixels || 0))))));
	return list;
}

panels.quests = async (root) => {
	root.innerHTML = '<p class="muted small">Загрузка…</p>';
	if (!api.state.me) { root.innerHTML = ''; root.appendChild(el('p', { class: 'muted small' }, 'Войдите, чтобы видеть задания и магазин.')); return; }
	try {
		const [quests, shop, events] = await Promise.all([api.quests(), api.shop(), api.events()]);
		root.innerHTML = '';
		root.appendChild(el('h4', {}, 'Ежедневные задания'));
		const ql = el('div', { class: 'quests' });
		for (const q of quests.daily.quests || []) {
			const done = q.progress >= q.target;
			ql.appendChild(el('div', { class: 'quest' },
				el('div', {}, el('div', {}, q.title), el('div', { class: 'bar' }, el('div', { class: 'bar-fill', style: 'width:' + Math.min(100, Math.round((q.progress / q.target) * 100)) + '%' }))),
				q.claimed ? el('span', { class: 'chip' }, '✓') : el('button', { class: 'btn small', disabled: !done, onclick: async () => { try { await api.claim(q.id); toast('Награда получена', 'success'); await api.me(); renderMe(); panels.quests(root); } catch (err) { toast(err.message, 'error'); } } }, 'Забрать')
			));
		}
		root.appendChild(ql);
		root.appendChild(el('h4', {}, 'Магазин'));
		const sl = el('div', { class: 'quests' });
		for (const it of shop.offers || []) sl.appendChild(el('div', { class: 'quest' }, el('div', {}, el('div', {}, it.title), el('div', { class: 'muted small' }, it.type)), el('button', { class: 'btn small', onclick: async () => { try { await api.buy(it.key); toast('Куплено', 'success'); await api.me(); renderMe(); } catch (err) { toast(err.message, 'error'); } } }, fmt(it.price) + ' ◉')));
		root.appendChild(sl);
		if (events.active && events.active.length) {
			root.appendChild(el('h4', {}, 'Активные события'));
			for (const ev of events.active) root.appendChild(el('div', { class: 'quest' }, el('div', {}, ev.title || ev.key)));
		}
	} catch (err) { root.innerHTML = ''; root.appendChild(el('p', { class: 'muted small' }, err.message)); }
};

panels.admin = async (root) => {
	root.innerHTML = '';
	let sub = 'world';
	const tabs = el('div', { class: 'subtabs' });
	const view = el('div', { class: 'admin-view' });
	const items = [['world', 'Мир'], ['players', 'Игроки'], ['mod', 'Модерация']];
	const renderSub = () => {
		tabs.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
		if (sub === 'world') adminWorld(view);
		else if (sub === 'players') adminPlayers(view);
		else adminModeration(view);
	};
	for (const [k, label] of items) tabs.appendChild(el('button', { class: 'subtab', 'data-sub': k, onclick: () => { sub = k; renderSub(); } }, label));
	root.appendChild(tabs);
	root.appendChild(view);
	renderSub();
};

async function adminWorld(view) {
	view.innerHTML = '<p class="muted small">Загрузка настроек мира…</p>';
	try {
		const worldId = (app.world && app.world.type === 'official') ? app.world.id : 'official';
		const r = await api.adminWorld(worldId);
		const w = r.world;
		view.innerHTML = '';
		const form = el('div', { class: 'form admin-form' });
		const patch = {};
		const field = (label, node) => form.appendChild(el('label', { class: 'admin-field' }, el('span', { class: 'admin-lbl' }, label), node));
		const text = (key, val, attrs = {}) => { const i = el('input', { class: 'input', value: val == null ? '' : val, ...attrs }); i.addEventListener('input', () => patch[key] = i.type === 'number' ? +i.value : i.value); return i; };
		const num = (key, val, min, max) => text(key, val, { type: 'number', min: String(min), max: String(max) });
		const check = (key, val) => { const i = el('input', { type: 'checkbox' }); i.checked = !!val; i.addEventListener('change', () => patch[key] = i.checked); return el('span', { class: 'admin-check' }, i); };
		const select = (key, val, opts) => { const s = el('select', { class: 'input' }, ...opts.map((o) => el('option', { value: o, selected: o === val ? true : undefined }, o))); s.addEventListener('change', () => patch[key] = s.value); return s; };

		form.appendChild(el('h4', {}, 'Основные'));
		field('Название', text('name', w.name));
		field('Описание', text('description', w.description));
		field('Иконка', text('icon', w.icon, { maxlength: '8' }));
		field('Фон (#hex)', text('background', w.background));
		field('Сетка', check('grid', w.grid));
		field('Разрешить скачивание', check('allowDownload', w.allowDownload));
		field('В каталоге', check('listed', w.listed));

		form.appendChild(el('h4', {}, 'Холст'));
		field('Зона спавна', num('spawn', w.spawn, 100, 100000));
		field('Мин. зум', text('zoomMin', w.zoomMin, { type: 'number', step: '0.1', min: '0.1', max: '5' }));
		field('Макс. зум', num('zoomMax', w.zoomMax, 5, 200));
		field('Размер', el('span', { class: 'muted small' }, (w.infinite ? 'бесконечный · ' : '') + w.width + '×' + w.height));

		form.appendChild(el('h4', {}, 'Доступ'));
		field('Режим доступа', select('__accessMode', w.access.mode, (api.state.config && api.state.config.accessModes) || ['public']));

		form.appendChild(el('h4', {}, 'Энергия'));
		const e = w.energy || {};
		const ePatch = {};
		const eNum = (k, v, min, max) => { const i = el('input', { class: 'input', type: 'number', value: v == null ? 0 : v, min: String(min), max: String(max) }); i.addEventListener('input', () => ePatch[k] = +i.value); return i; };
		field('Режим', (() => { const s = el('select', { class: 'input' }, ...['cooldown', 'stock', 'infinite', 'off'].map((o) => el('option', { value: o, selected: o === e.mode ? true : undefined }, o))); s.addEventListener('change', () => ePatch.mode = s.value); return s; })());
		field('Кулдаун (мс)', eNum('cooldownMs', e.cooldownMs, 200, 600000));
		field('Макс. энергия', eNum('maxEnergy', e.maxEnergy, 1, 1000));
		field('Дневной лимит', eNum('dailyLimit', e.dailyLimit, 0, 1000000));

		form.appendChild(el('h4', {}, 'Чат'));
		const c = w.chat || {};
		const cPatch = {};
		field('Чат включён', (() => { const i = el('input', { type: 'checkbox' }); i.checked = c.enabled !== false; i.addEventListener('change', () => cPatch.enabled = i.checked); return el('span', { class: 'admin-check' }, i); })());
		field('Slow-mode (мс)', (() => { const i = el('input', { class: 'input', type: 'number', value: c.slowModeMs == null ? 0 : c.slowModeMs, min: '0', max: '600000' }); i.addEventListener('input', () => cPatch.slowModeMs = +i.value); return i; })());
		field('Ссылки разрешены', (() => { const i = el('input', { type: 'checkbox' }); i.checked = !!c.allowLinks; i.addEventListener('change', () => cPatch.allowLinks = i.checked); return el('span', { class: 'admin-check' }, i); })());

		form.appendChild(el('h4', {}, 'Инструменты'));
		const toolsPatch = {};
		for (const [tool, cfg] of Object.entries(w.tools || {})) {
			const tp = {};
			toolsPatch[tool] = tp;
			const en = el('input', { type: 'checkbox' }); en.checked = cfg.enabled !== false; en.addEventListener('change', () => tp.enabled = en.checked);
			const sz = el('input', { class: 'input mini', type: 'number', value: cfg.maxSize == null ? 1 : cfg.maxSize, min: '1', max: '65536' }); sz.addEventListener('input', () => tp.maxSize = +sz.value);
			form.appendChild(el('div', { class: 'admin-tool' }, el('span', { class: 'admin-lbl' }, tool), el('span', { class: 'admin-check' }, en), el('span', { class: 'muted small' }, 'размер'), sz));
		}

		const save = el('button', { class: 'btn btn-primary', onclick: async () => {
			const payload = { ...patch };
			if (patch.__accessMode) { payload.access = { mode: patch.__accessMode }; delete payload.__accessMode; }
			if (Object.keys(ePatch).length) payload.energy = ePatch;
			if (Object.keys(cPatch).length) payload.chat = cPatch;
			const tp = {}; for (const [t, v] of Object.entries(toolsPatch)) if (Object.keys(v).length) tp[t] = v;
			if (Object.keys(tp).length) payload.tools = tp;
			try { await api.patchWorld(w.id, payload); toast('Мир обновлён', 'success'); if (app.world && app.world.id === w.id) reloadWorld(); } catch (err) { toast(err.message, 'error'); }
		} }, 'Сохранить настройки мира');
		form.appendChild(el('div', { class: 'admin-actions' }, save));
		view.appendChild(form);
	} catch (err) { view.innerHTML = ''; view.appendChild(el('p', { class: 'muted small' }, err.message)); }
}

async function adminPlayers(view) {
	view.innerHTML = '';
	const search = el('input', { class: 'input', placeholder: 'Поиск игрока по нику…' });
	const listBox = el('div', { class: 'admin-users' });
	const load = async () => {
		listBox.innerHTML = '<p class="muted small">Загрузка…</p>';
		try {
			const r = await api.adminUsers(search.value.trim());
			listBox.innerHTML = '';
			if (!r.users.length) listBox.appendChild(el('p', { class: 'muted small' }, 'Никого не найдено'));
			for (const u of r.users) listBox.appendChild(userRow(u, load));
		} catch (err) { listBox.innerHTML = ''; listBox.appendChild(el('p', { class: 'muted small' }, err.message)); }
	};
	let t = null; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 300); });
	view.appendChild(el('div', { class: 'admin-search' }, search, el('button', { class: 'btn small', onclick: load }, 'Обновить')));
	view.appendChild(listBox);
	load();
}

function userRow(u, reload) {
	const head = el('div', { class: 'admin-user-head' },
		el('span', { class: 'me-nick' }, u.nick),
		el('span', { class: 'chip' }, u.role),
		el('span', { class: 'chip' }, 'ur ' + u.level),
		u.banned ? el('span', { class: 'chip danger' }, 'BAN') : null
	);
	const details = el('div', { class: 'admin-user-edit' });
	let open = false;
	const patch = {};
	const numf = (label, key, val) => { const i = el('input', { class: 'input mini', type: 'number', value: val == null ? 0 : val }); i.addEventListener('input', () => patch[key] = +i.value); return el('label', { class: 'admin-field' }, el('span', { class: 'admin-lbl' }, label), i); };
	const build = () => {
		details.innerHTML = '';
		details.appendChild(el('label', { class: 'admin-field' }, el('span', { class: 'admin-lbl' }, 'Роль'), (() => { const s = el('select', { class: 'input' }, ...['user', 'moderator', 'admin'].map((o) => el('option', { value: o, selected: o === u.role ? true : undefined }, o))); s.addEventListener('change', () => patch.role = s.value); return s; })()));
		details.appendChild(numf('Уровень', 'level', u.level));
		details.appendChild(numf('XP', 'xp', u.xp));
		details.appendChild(numf('Пиксели (офиц.)', 'officialPixels', u.officialPixels));
		details.appendChild(numf('Пиксели (сообщ.)', 'communityPixels', u.communityPixels));
		details.appendChild(numf('Монеты', 'coins', u.coins));
		details.appendChild(numf('Слоты миров', 'worldSlots', u.worldSlots));
		const verified = el('input', { type: 'checkbox' }); verified.checked = !!u.verified; verified.addEventListener('change', () => patch.verified = verified.checked);
		details.appendChild(el('label', { class: 'admin-field' }, el('span', { class: 'admin-lbl' }, 'Верифицирован'), el('span', { class: 'admin-check' }, verified)));
		const banBtn = el('button', { class: 'btn small ' + (u.banned ? '' : 'danger'), onclick: async () => {
			try {
				if (u.banned) await api.patchUser(u.id, { ban: null });
				else { const reason = prompt('Причина бана?') || 'Нарушение правил'; await api.patchUser(u.id, { ban: { reason } }); }
				toast('Готово', 'success'); reload();
			} catch (err) { toast(err.message, 'error'); }
		} }, u.banned ? 'Снять бан' : 'Забанить');
		const save = el('button', { class: 'btn btn-primary small', onclick: async () => {
			try { await api.patchUser(u.id, patch); toast('Игрок обновлён', 'success'); reload(); } catch (err) { toast(err.message, 'error'); }
		} }, 'Сохранить');
		details.appendChild(el('div', { class: 'admin-actions' }, save, banBtn));
	};
	head.addEventListener('click', () => { open = !open; details.style.display = open ? '' : 'none'; if (open && !details.childNodes.length) build(); });
	details.style.display = 'none';
	return el('div', { class: 'admin-user' }, head, details);
}

async function adminModeration(view) {
	view.innerHTML = '<p class="muted small">Загрузка…</p>';
	try {
		const q = await api.adminQueue();
		view.innerHTML = '';
		view.appendChild(el('h4', {}, 'Очередь модерации (' + q.queue.length + ')'));
		if (!q.queue.length) view.appendChild(el('p', { class: 'muted small' }, 'Пусто — автоматика справляется.'));
		for (const item of q.queue.slice(0, 40)) {
			view.appendChild(el('div', { class: 'quest' },
				el('div', {}, el('div', {}, (item.type || '?') + ' · ' + (item.priority || 'normal')), el('div', { class: 'muted small' }, JSON.stringify(item.details || {}).slice(0, 90))),
				el('button', { class: 'btn small', onclick: async () => { try { await api.resolveQueue(item.id, 'ok'); toast('Закрыто', 'success'); adminModeration(view); } catch (err) { toast(err.message, 'error'); } } }, '✓')
			));
		}
	} catch (err) { view.innerHTML = ''; view.appendChild(el('p', { class: 'muted small' }, err.message)); }
}

function switchTab(name) {
	document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
	const root = $('panelBody');
	if (panels[name]) panels[name](root);
}

// ---------- Мир ----------
async function openWorld(id) {
	try {
		const r = await api.world(id);
		app.world = r.world;
		app.engine.setWorld(r.world, r.pixels);
		app.tools.setWorld(r.world);
		app.tools.renderTools($('tools'));
		app.tools.renderPalette($('palette'));
		$('worldName').textContent = r.world.name;
		$('worldType').textContent = r.world.type === 'official' ? 'ОФИЦИАЛЬНЫЙ' : 'СООБЩЕСТВО';
		$('worldType').className = 'badge ' + (r.world.type === 'official' ? 'badge-official' : 'badge-community');
		$('notice').style.display = r.world.type === 'community' ? '' : 'none';
		$('notice').textContent = NOTICE;
		updateEnergy(r.world.__energy || null);
		connectStream(id);
		startEnergyPoll();
		if (api.state.me) api.energy(id).then((e) => updateEnergy(e.energy)).catch(() => {});
		const activeTab = document.querySelector('.tab.active');
		switchTab(activeTab ? activeTab.dataset.tab : 'chat');
	} catch (err) {
		toast(err.message || 'Мир недоступен', 'error');
		// Без загруженного мира панели обращаются к app.world.id и падают
		// (Cannot read properties of null). Откатываемся на официальный мир.
		if (!app.world && id !== 'official') await openWorld('official');
	}
}

function reloadWorld() { if (app.world) openWorld(app.world.id); }

function connectStream(worldId) {
	if (app.stream) app.stream.close();
	app.stream = api.stream(worldId, {
		pixels: (d) => { if (d.pixels) app.engine.applyPixels(d.pixels); },
		chat: (d) => appendChat(d),
		lifecycle: () => reloadWorld(),
		reload: () => reloadWorld()
	});
}

function startEnergyPoll() {
	if (app.energyTimer) clearInterval(app.energyTimer);
	if (!api.state.me) return;
	app.energyTimer = setInterval(async () => { if (!app.world) return; try { const e = await api.energy(app.world.id); updateEnergy(e.energy); } catch {} }, 5000);
}

function parseHash() {
	const h = location.hash.replace(/^#/, '');
	if (!h.startsWith('world/')) return null;
	const parts = h.split('/');
	const id = (parts[1] || '').trim();
	if (!id) return null;
	return { id, x: +parts[2], y: +parts[3], z: +parts[4] };
}

let hashTimer = null;
function writeHash() {
	if (!app.world) return;
	clearTimeout(hashTimer);
	hashTimer = setTimeout(() => {
		const e = app.engine;
		const cx = Math.round((e.viewW / 2 - e.offsetX) / e.scale);
		const cy = Math.round((e.viewH / 2 - e.offsetY) / e.scale);
		history.replaceState(null, '', '#world/' + app.world.id + '/' + cx + '/' + cy + '/' + e.scale.toFixed(1));
	}, 400);
}

async function boot() {
	await api.loadConfig();
	app.engine = new PixelEngine($('canvas'), $('minimap'));
	app.tools = new Tools(app.engine, api);
	app.tools.onEnergy = updateEnergy;
	app.tools.onReward = (r) => {
		if (r.levelUp) toast('Новый уровень!', 'success');
		if (r.achievements && r.achievements.length) toast('Достижение: ' + r.achievements.join(', '), 'success');
		if (api.state.me) { api.state.me.coins = (api.state.me.coins || 0) + (r.coins || 0); if (r.scope === 'official') { api.state.me.xp = (api.state.me.xp || 0) + (r.xp || 0); } renderMe(); }
	};
	app.engine.onView = (v) => { $('coords').textContent = v.x + ', ' + v.y + '  ×' + v.scale.toFixed(1); writeHash(); };
	app.engine.onHover = () => {};

	$('zoomIn').onclick = () => app.engine.zoomButton(1.25);
	$('zoomOut').onclick = () => app.engine.zoomButton(1 / 1.25);
	$('zoomFit').onclick = () => app.engine.fit();
	document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

	renderMe();
	window.addEventListener('hashchange', () => { const h = parseHash(); if (h && (!app.world || h.id !== app.world.id)) openWorld(h.id); else if (h && !Number.isNaN(h.x)) app.engine.center(h.x, h.y, h.z); });

	const h = parseHash();
	await openWorld(h ? h.id : 'official');
	if (h && !Number.isNaN(h.x)) app.engine.center(h.x, h.y, h.z);
}

boot().catch((err) => { console.error(err); toast('Ошибка загрузки: ' + err.message, 'error'); });
