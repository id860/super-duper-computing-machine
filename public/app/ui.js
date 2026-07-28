// UI-слой PixelFront: инструменты, палитра, панели, модалки.
// + Горячие клавиши: E/1=пиксель, B/2=кисть 2x2, 3=кисть 3x3, L=линия, R=прям.оуг, F=заливка, P=пипетка, Ctrl+Z=отмена.
// + Локальная отмена: _undoStack, undo() — восстанавливает пиксели локально + шлёт на сервер.
// + Оптимистичный рендер: пиксели применяются локально сразу, отправка без лишних пауз.
// + Preview: линии/прямоугольники/кисть видны во время движения мыши.
// + Заливка: волновая анимация по кольцам от точки клика.
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
	ctx.fillStyle = active ? '#ffffff' : '#4b5563';
	for (const [x, y] of (ICON_BITS[tool] || ICON_BITS.pixel)) ctx.fillRect(pad + x * px, pad + y * px, px, px);
	return cv;
}

const TOOL_META = {
	pixel: { label: 'Пиксель', key: 'E' },
	brush2: { label: 'Кисть 2×2', key: 'B' },
	brush3: { label: 'Кисть 3×3', key: '3' },
	line: { label: 'Линия', key: 'L' },
	rect: { label: 'Прямоугольник', key: 'R' },
	fill: { label: 'Заливка', key: 'F' },
	picker: { label: 'Пипетка', key: 'P' },
	move: { label: 'Перенос' },
	copy: { label: 'Копия' },
	stamp: { label: 'Штамп' },
	template: { label: 'Шаблон' },
	protect: { label: 'Защита' },
	restore: { label: 'Восстановить' }
};

const KEY_MAP = { 'e': 'pixel', '1': 'pixel', 'b': 'brush2', '2': 'brush2', '3': 'brush3', 'l': 'line', 'r': 'rect', 'f': 'fill', 'p': 'picker' };

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
		this._undoStack = [];
		this._toolContainer = null;
		this._batchTimer = null;
		this._wire();
		this._bindHotkeys();
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

	_bindHotkeys() {
		window.addEventListener('keydown', (e) => {
			const tag = document.activeElement ? document.activeElement.tagName : '';
			if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
			if (e.ctrlKey || e.metaKey) {
				if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); this.undo(); }
				return;
			}
			if (!this.world) return;
			const toolName = KEY_MAP[e.key.toLowerCase()];
			if (!toolName) return;
			const enabled = toolName === 'picker' || (this.world.tools[toolName] && this.world.tools[toolName].enabled);
			if (!enabled) return;
			this.tool = toolName;
			if (this._toolContainer) this.renderTools(this._toolContainer);
		});
	}

	undo() {
		const entry = this._undoStack.pop();
		if (!entry || !entry.length) { toast('Нечего отменять', 'info'); return; }
		const byColor = new Map();
		for (const { key, prev } of entry) {
			const [x, y] = key.split(':').map(Number);
			const color = prev || (this.world ? this.world.background : '#ffffff');
			this.engine.applyPixels([[x, y, color]]);
			if (!byColor.has(color)) byColor.set(color, []);
			byColor.get(color).push([x, y]);
		}
		for (const [color, cells] of byColor) {
			const max = 256;
			for (let i = 0; i < cells.length; i += max) this.queue.push({ tool: 'pixel', cells: cells.slice(i, i + max), color });
		}
		if (this.queue.length) this._drain();
		toast('Отмена', 'info');
	}

	_wire() {
		const e = this.engine;
		e.onCellDown = (x, y) => {
			if (!this.world) return;
			if (this.tool === 'picker') { this.color = e.colorAt(x, y); this._syncPalette(); return; }
			if (this.tool === 'line' || this.tool === 'rect') { this.anchor = { x, y }; return; }
			this.buffer = [];
			