// UI-слой PixelFront: инструменты, палитра, панели, модалки.
import { bresenham, rectCells } from './engine.js';

export const el = (tag, attrs = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'class') node.className = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat()) { if (c == null) continue; node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
	return node;
};

export function toast(msg, kind = 'info') {
	let wrap = document.getElementById('toasts');
	if (!wrap) { wrap = el('div', { id: 'toasts' }); document.body.appendChild(wrap); }
	const t = el('div', { class: 'toast toast-' + kind }, msg);
	wrap.appendChild(t);
	requestAnimationFrame(() => t.classList.add('show'));
	setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3400);
}

export function modal(title, body, actions = []) {
	const back = el('div', { class: 'modal-back' });
	const close = () => back.remove();
	const foot = el('div', { class: 'modal-foot' }, ...actions.map((a) => el('button', { class: 'btn ' + (a.primary ? 'btn-primary' : ''), onclick: () => a.onClick(close) }, a.label)));
	const box = el('div', { class: 'modal' },
		el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'icon-btn', onclick: close }, '✕')),
		el('div', { class: 'modal-body' }, body),
		actions.length ? foot : null
	);
	back.appendChild(box);
	back.addEventListener('click', (e) => { if (e.target === back) close(); });
	document.body.appendChild(back);
	return close;
}

// Пиксельные иконки инструментов: битовые карты 9×9, рисуются на canvas
// вместо юникод-символов.
const ICON_BITS = {
	pixel: [[3,3],[4,3],[5,3],[3,4],[4,4],[5,4],[3,5],[4,5],[5,5]],
	brush2: [[2,2],[3,2],[2,3],[3,3],[6,2],[7,2],[6,3],[7,3],[2,6],[3,6],[2,7],[3,7],[6,6],[7,6],[6,7],[7,7]],
	brush3: [[1,1],[4,1],[7,1],[1,4],[4,4],[7,4],[1,7],[4,7],[7,7]],
	line: [[1,7],[2,6],[3,5],[4,4],[5,3],[6,2],[7,1]],
	rect: [[2,2],[3,2],[4,2],[5,2],[6,2],[2,6],[3,6],[4,6],[5,6],[6,6],[2,3],[2,4],[2,5],[6,3],[6,4],[6,5]],
	fill: [[3,1],[2,2],[4,2],[2,3],[3,3],[4,3],[5,3],[3,4],[4,4],[5,4],[6,4],[4,5],[5,5],[6,5],[7,6],[7,7]],
	picker: [[4,1],[4,2],[1,4],[2,4],[4,4],[6,4],[7,4],[4,6],[4,7]],
	move: [[4,0],[3,1],[4,1],[5,1],[4,2],[4,3],[4,4],[4,5],[4,6],[4,7],[4,8],[3,7],[5,7],[0,4],[1,3],[1,4],[1,5],[2,4],[3,4],[5,4],[6,4],[7,4],[8,4],[7,3],[7,5]],
	copy: [[1,1],[2,1],[3,1],[4,1],[1,2],[1,3],[1,4],[4,2],[4,3],[4,4],[2,4],[3,4],[5,4],[6,4],[7,4],[5,5],[5,6],[5,7],[7,5],[7,6],[7,7],[6,7]],
	stamp: [[2,2],[3,2],[4,2],[5,2],[6,2],[2,6],[3,6],[4,6],[5,6],[6,6],[2,3],[2,4],[2,5],[6,3],[6,4],[6,5],[4,4]],
	template: [[2,2],[4,2],[6,2],[2,4],[4,4],[6,4],[2,6],[4,6],[6,6]],
	protect: [[3,1],[4,1],[5,1],[2,2],[6,2],[2,3],[6,3],[2,4],[6,4],[3,5],[5,5],[4,6],[4,3],[4,4]],
	restore: [[3,1],[4,1],[5,1],[2,2],[6,2],[6,3],[4,3],[5,3],[2,4],[3,5],[4,6],[5,6]]
};

export function toolIcon(tool, active) {
	const grid = 9, px = 3, pad = 3;
	const size = grid * px + pad * 2;
	const cv = document.createElement('canvas');
	cv.width = size; cv.height = size;
	cv.className = 'tool-ico';
	const ctx = cv.getContext('2d');
	ctx.imageSmoothingEnabled = false;
	ctx.clearRect(0, 0, size, size);
	ctx.fillStyle = active ? '#0d0f14' : '#cfd6e4';
	for (const [x, y] of (ICON_BITS[tool] || ICON_BITS.pixel)) ctx.fillRect(pad + x * px, pad + y * px, px, px);
	return cv;
}

const TOOL_META = {
	pixel: { label: 'Пиксель' },
	brush2: { label: 'Кисть 2×2' },
	brush3: { label: 'Кисть 3×3' },
	line: { label: 'Линия' },
	rect: { label: 'Прямоугольник' },
	fill: { label: 'Заливка' },
	picker: { label: 'Пипетка' },
	move: { label: 'Перенос' },
	copy: { label: 'Копия' },
	stamp: { label: 'Штамп' },
	template: { label: 'Шаблон' },
	protect: { label: 'Защита' },
	restore: { label: 'Восстановить' }
};

export class Tools {
	constructor(engine, api) {
		this.engine = engine;
		this.api = api;
		this.tool = 'pixel';
		this.color = '#000000';
		this.world = null;
		this.buffer = [];
		this.anchor = null;
		this.preview = null;
		this.queue = [];
		this.sending = false;
		this.onReward = null;
		this.onEnergy = null;
		this._wire();
	}

	setWorld(world) {
		this.world = world;
		if (!world.palette.includes(this.color)) this.color = world.palette[0] || '#000000';
		if (world.tools[this.tool] && !world.tools[this.tool].enabled) this.tool = 'pixel';
	}

	_toolCfg(tool) { return (this.world && this.world.tools[tool]) || { maxSize: 1, enabled: true }; }
	_inBounds(c) {
		const lim = this.world.infinite ? 100000 : null;
		if (lim) return c[0] >= 0 && c[1] >= 0 && c[0] < lim && c[1] < lim;
		return c[0] >= 0 && c[1] >= 0 && c[0] < this.world.width && c[1] < this.world.height;
	}

	_brushCells(x, y, n) {
		if (n <= 1) return [[x, y]];
		const cells = [];
		const half = Math.floor(n / 2);
		for (let dy = -half; dy < n - half; dy++) for (let dx = -half; dx < n - half; dx++) cells.push([x + dx, y + dy]);
		return cells;
	}

	_penSize() { return this.tool === 'brush3' ? 3 : this.tool === 'brush2' ? 2 : 1; }

	_addBuffer(cells) {
		const keys = new Set(this.buffer.map((c) => c[0] + ':' + c[1]));
		for (const c of cells) { const k = c[0] + ':' + c[1]; if (!keys.has(k) && this._inBounds(c)) { keys.add(k); this.buffer.push(c); } }
	}

	_wire() {
		const e = this.engine;
		e.onCellDown = (x, y) => {
			if (!this.world) return;
			if (this.tool === 'picker') { this.color = e.colorAt(x, y); this._syncPalette(); return; }
			if (this.tool === 'line' || this.tool === 'rect') { this.anchor = { x, y }; return; }
			this.buffer = [];
			this._addBuffer(this._brushCells(x, y, this._penSize()));
			this.preview = this.buffer.slice();
			e.draw();
		};
		e.onCellDrag = (x, y) => {
			if (!this.world) return;
			if (this.tool === 'picker') return;
			if (this.tool === 'line') { this.preview = bresenham(this.anchor.x, this.anchor.y, x, y); e.draw(); return; }
			if (this.tool === 'rect') { this.preview = rectCells(this.anchor.x, this.anchor.y, x, y, false); e.draw(); return; }
			this._addBuffer(this._brushCells(x, y, this._penSize()));
			this.preview = this.buffer.slice();
			e.draw();
		};
		e.onCellUp = (x, y) => {
			if (!this.world) return;
			if (this.tool === 'picker') return;
			if (this.tool === 'line') { this._commit('line', bresenham(this.anchor.x, this.anchor.y, x, y)); this.anchor = null; this.preview = null; e.draw(); return; }
			if (this.tool === 'rect') { this._commit('rect', rectCells(this.anchor.x, this.anchor.y, x, y, false)); this.anchor = null; this.preview = null; e.draw(); return; }
			if (this.tool === 'fill') { this._commit('fill', this._flood(x, y)); this.buffer = []; this.preview = null; return; }
			const tool = this._penSize() === 3 ? 'brush3' : this._penSize() === 2 ? 'brush2' : 'pixel';
			this._commit(tool, this.buffer.slice());
			this.buffer = [];
			this.preview = null;
		};
		e.onOverlay = (ctx) => {
			if (!this.preview || !this.preview.length) return;
			ctx.globalAlpha = 0.55;
			ctx.fillStyle = this.color;
			for (const [x, y] of this.preview) ctx.fillRect(e.offsetX + x * e.scale, e.offsetY + y * e.scale, e.scale, e.scale);
			ctx.globalAlpha = 1;
		};
	}

	_flood(x, y) {
		const target = this.engine.colorAt(x, y);
		if (target === this.color) return [];
		const w = this.world.infinite ? 100000 : this.world.width, h = this.world.infinite ? 100000 : this.world.height;
		const out = [], seen = new Set(), stack = [[x, y]];
		while (stack.length && out.length < 4096) {
			const [cx, cy] = stack.pop();
			const key = cx + ':' + cy;
			if (seen.has(key)) continue;
			seen.add(key);
			if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
			if (this.engine.colorAt(cx, cy) !== target) continue;
			out.push([cx, cy]);
			stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
		}
		return out;
	}

	_commit(tool, cells) {
		cells = cells.filter((c) => this._inBounds(c));
		if (!cells.length) return;
		const color = this.color;
		this.engine.applyPixels(cells.map((c) => [c[0], c[1], color]));
		const max = Math.max(1, this._toolCfg(tool).maxSize || 1);
		for (let i = 0; i < cells.length; i += max) this.queue.push({ tool, cells: cells.slice(i, i + max) });
		this._drain();
	}

	async _drain() {
		if (this.sending) return;
		this.sending = true;
		while (this.queue.length) {
			const job = this.queue.shift();
			try {
				const res = await this.api.ops(this.world.id, { tool: job.tool, color: this.color, cells: job.cells });
				if (res.energy && this.onEnergy) this.onEnergy(res.energy);
				if (res.reward && this.onReward) this.onReward(res.reward);
			} catch (err) {
				toast(err.message || 'Ошибка рисования', 'error');
				this.queue = [];
				try { const w = await this.api.world(this.world.id); this.engine.setWorld(w.world, w.pixels); } catch {}
				break;
			}
			await new Promise((r) => setTimeout(r, 45));
		}
		this.sending = false;
	}

	_syncPalette() {
		document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.color === this.color));
	}

	renderTools(container) {
		container.innerHTML = '';
		const avail = Object.keys(TOOL_META).filter((t) => t === 'picker' || (this.world.tools[t] && this.world.tools[t].enabled));
		for (const t of avail) {
			const meta = TOOL_META[t];
			const b = el('button', { class: 'tool' + (t === this.tool ? ' active' : ''), title: meta.label, 'data-tool': t, onclick: () => { this.tool = t; this.renderTools(container); } });
			b.appendChild(toolIcon(t, t === this.tool));
			container.appendChild(b);
		}
	}

	renderPalette(container) {
		container.innerHTML = '';
		for (const c of this.world.palette) {
			const s = el('button', { class: 'swatch' + (c === this.color ? ' active' : ''), style: 'background:' + c, 'data-color': c, title: c, onclick: () => { this.color = c; this._syncPalette(); } });
			container.appendChild(s);
		}
	}
}

export function openWizard(api, config, onCreated) {
	const presets = config.presets || {};
	const state = { captchaToken: null };
	const presetSel = el('select', { class: 'input' }, ...Object.entries(presets).map(([k, v]) => el('option', { value: k }, v.title || k)));
	const name = el('input', { class: 'input', placeholder: 'Название мира', maxlength: '48' });
	const desc = el('input', { class: 'input', placeholder: 'Короткое описание', maxlength: '240' });
	const width = el('input', { class: 'input', type: 'number', value: '128', min: '32', max: '512' });
	const height = el('input', { class: 'input', type: 'number', value: '96', min: '32', max: '512' });
	const access = el('select', { class: 'input' }, ...(config.accessModes || ['public']).map((m) => el('option', { value: m }, m)));
	const captchaQ = el('span', { class: 'captcha-q' }, '…');
	const captchaA = el('input', { class: 'input', placeholder: 'Ответ', style: 'max-width:120px' });
	const refreshCaptcha = async () => { const c = await api.captcha(); state.captchaToken = c.captchaToken; captchaQ.textContent = c.question; };
	refreshCaptcha();
	const body = el('div', { class: 'form' },
		el('label', {}, 'Пресет', presetSel),
		el('label', {}, 'Название', name),
		el('label', {}, 'Описание', desc),
		el('div', { class: 'row' }, el('label', {}, 'Ширина', width), el('label', {}, 'Высота', height)),
		el('label', {}, 'Доступ', access),
		el('label', {}, 'Проверка: реши пример', el('div', { class: 'row' }, captchaQ, captchaA, el('button', { class: 'icon-btn', type: 'button', onclick: refreshCaptcha }, '↻'))),
		el('p', { class: 'muted small' }, 'Мир создаётся в песочнице сообщества. Активность в мирах сообщества не влияет на глобальный рейтинг, достижения и экономику.')
	);
	modal('Создание мира', body, [
		{ label: 'Отмена', onClick: (close) => close() },
		{ label: 'Создать', primary: true, onClick: async (close) => {
			try {
				const world = await api.createWorld({
					preset: presetSel.value, name: name.value, description: desc.value,
					width: +width.value, height: +height.value,
					access: { mode: access.value },
					captchaToken: state.captchaToken, captcha: captchaA.value
				});
				toast('Мир создан', 'success');
				close();
				onCreated(world.world);
			} catch (err) { toast(err.message, 'error'); refreshCaptcha(); }
		} }
	]);
}

export function authModal(api, onAuth) {
	let mode = 'login';
	const nick = el('input', { class: 'input', placeholder: 'Ник', maxlength: '24' });
	const pass = el('input', { class: 'input', type: 'password', placeholder: 'Пароль' });
	const hint = el('p', { class: 'muted small' }, 'Один аккаунт — две статистики: глобальная (официальный мир) и локальная (миры сообщества).');
	const title = el('h3', {}, 'Вход');
	const submit = el('button', { class: 'btn btn-primary', onclick: async () => {
		try {
			const r = mode === 'login' ? await api.login(nick.value.trim(), pass.value) : await api.register(nick.value.trim(), pass.value);
			toast(mode === 'login' ? 'С возвращением!' : 'Аккаунт создан', 'success');
			back.remove();
			onAuth(r.me);
		} catch (err) { toast(err.message, 'error'); }
	} }, 'Войти');
	const toggle = el('button', { class: 'link-btn', onclick: () => {
		mode = mode === 'login' ? 'register' : 'login';
		title.textContent = mode === 'login' ? 'Вход' : 'Регистрация';
		submit.textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
		toggle.textContent = mode === 'login' ? 'Нет аккаунта? Создать' : 'Уже есть аккаунт? Войти';
	} }, 'Нет аккаунта? Создать');
	const back = el('div', { class: 'modal-back' });
	const box = el('div', { class: 'modal' },
		el('div', { class: 'modal-head' }, title, el('button', { class: 'icon-btn', onclick: () => back.remove() }, '✕')),
		el('div', { class: 'modal-body' }, el('div', { class: 'form' }, nick, pass, submit, toggle, hint))
	);
	back.appendChild(box);
	back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
	document.body.appendChild(back);
}
