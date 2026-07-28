import { bresenham, rectCells } from './engine.js';
import { el, toolIcon, TOOL_META, KEY_MAP } from './ui-base.js';
import { Tools } from './tools-core.js';
Tools.prototype._bindHotkeys = function () {
	window.addEventListener('keydown', (e) => {
		const tag = document.activeElement ? document.activeElement.tagName : '';
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (e.ctrlKey || e.metaKey) { if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); this.undo(); } return; }
		if (!this.world) return;
		const toolName = KEY_MAP[e.key.toLowerCase()];
		if (!toolName) return;
		const enabled = toolName === 'picker' || (this.world.tools[toolName] && this.world.tools[toolName].enabled);
		if (!enabled) return;
		this.tool = toolName;
		if (this._toolContainer) this.renderTools(this._toolContainer);
	});
};
Tools.prototype.undo = function () {
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
	for (const [color, cells] of byColor) { const max = 256; for (let i = 0; i < cells.length; i += max) this.queue.push({ tool: 'pixel', cells: cells.slice(i, i + max), color }); }
	if (this.queue.length) this._drain();
	toast('Отмена', 'info');
};
Tools.prototype._wire = function () {
	const e = this.engine;
	e.onCellDown = (x, y) => {
		if (!this.world) return;
		if (this.tool === 'picker') { this.color = e.colorAt(x, y); this._syncPalette(); return; }
		if (this.tool === 'line' || this.tool === 'rect') { this.anchor = { x, y }; return; }
		this.buffer = [];
		this._addBuffer(this._brushCells(x, y, this._penSize()));
		this.preview = this.buffer.slice();
		this._applyImmediate(this.buffer.slice(), this.color);
		e.draw();
	};
	e.onCellDrag = (x, y) => {
		if (!this.world) return;
		if (this.tool === 'picker') return;
		if (this.tool === 'line') { this.preview = bresenham(this.anchor.x, this.anchor.y, x, y); e.draw(); return; }
		if (this.tool === 'rect') { this.preview = rectCells(this.anchor.x, this.anchor.y, x, y, false); e.draw(); return; }
		this._addBuffer(this._brushCells(x, y, this._penSize()));
		const fresh = this.buffer.slice(-this._penSize() * this._penSize());
		if (fresh.length) this._applyImmediate(fresh, this.color);
		this.preview = this.buffer.slice();
		e.draw();
	};
	e.onCellUp = (x, y) => {
		if (!this.world) return;
		if (this.tool === 'picker') return;
		if (this.tool === 'line') { this._commit('line', bresenham(this.anchor.x, this.anchor.y, x, y)); this.anchor = null; this.preview = null; e.draw(); return; }
		if (this.tool === 'rect') { this._commit('rect', rectCells(this.anchor.x, this.anchor.y, x, y, false)); this.anchor = null; this.preview = null; e.draw(); return; }
		if (this.tool === 'fill') { this._commitFill(this._flood(x, y)); return; }
		const tool = this._penSize() === 3 ? 'brush3' : this._penSize() === 2 ? 'brush2' : 'pixel';
		this._commit(tool, this.buffer.slice());
		this.buffer = []; this.preview = null;
	};
	e.onOverlay = (ctx) => this._drawOverlay(ctx, e);
};
Tools.prototype._flood = function (x, y) {
	const target = this.engine.colorAt(x, y);
	if (target === this.color) return { cells: [], rings: 0, dist: new Map() };
	const w = this.world.infinite ? 100000 : this.world.width, h = this.world.infinite ? 100000 : this.world.height;
	const out = [], seen = new Set(), stack = [[x, y]], dist = new Map(); dist.set(x + ':' + y, 0);
	let maxDist = 0;
	while (stack.length && out.length < 4096) {
		const [cx, cy] = stack.pop();
		const key = cx + ':' + cy;
		if (seen.has(key)) continue;
		seen.add(key);
		if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
		if (this.engine.colorAt(cx, cy) !== target) continue;
		out.push([cx, cy]);
		const d = dist.get(key) + 1;
		[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]].forEach(([nx,ny]) => {
			const nkey = nx + ':' + ny;
			if (!dist.has(nkey)) { dist.set(nkey, d); stack.push([nx, ny]); }
		});
		if (d > maxDist) maxDist = d;
	}
	return { cells: out, rings: maxDist, dist };
};
Tools.prototype._drawOverlay = function (ctx, e) {
	if (!this.preview || !this.preview.length) return;
	const s = e.scale, ox = e.offsetX, oy = e.offsetY, n = this._penSize();
	ctx.save();
	if (this.tool === 'line' || this.tool === 'rect') {
		ctx.globalAlpha = 0.75; ctx.fillStyle = this.color;
		for (const [x, y] of this.preview) ctx.fillRect(ox + x * s, oy + y * s, s, s);
		ctx.strokeStyle = 'rgba(20,22,28,0.6)'; ctx.lineWidth = Math.max(1, s / 8);
		ctx.strokeRect(ox + this.preview[0][0] * s, oy + this.preview[0][1] * s, s, s);
	} else {
		ctx.globalAlpha = 0.6; ctx.fillStyle = this.color;
		for (const [x, y] of this.preview) ctx.fillRect(ox + x * s, oy + y * s, s, s);
		if (this.world && e.hover) {
			const half = Math.floor(n / 2);
			ctx.strokeStyle = 'rgba(20,22,28,0.5)'; ctx.lineWidth = Math.max(1, s / 10);
			ctx.strokeRect(ox + (e.hover.x - half) * s, oy + (e.hover.y - half) * s, n * s, n * s);
		}
	}
	ctx.restore();
};
Tools.prototype._commitFill = function (flood) {
	const cells = flood.cells || [];
	if (!cells.length) return;
	const color = this.color;
	const undoEntry = cells.map((c) => ({ key: c[0] + ':' + c[1], prev: this.engine.colorAt(c[0], c[1]) })).filter((e) => e.prev !== color);
	if (undoEntry.length) { this._undoStack.push(undoEntry); if (this._undoStack.length > 50) this._undoStack.shift(); }
	const maxRing = flood.rings || 0;
	const delay = maxRing > 40 ? 8 : 16;
	let sent = false;
	const applyRing = (ring) => {
		const ringCells = cells.filter((c) => (flood.dist.get(c[0] + ':' + c[1]) || 0) === ring);
		if (ringCells.length) this.engine.applyPixels(ringCells.map((c) => [c[0], c[1], color]));
		if (ring < maxRing) setTimeout(() => applyRing(ring + 1), delay);
		else if (!sent) { sent = true; this.queue.push({ tool: 'fill', cells, color }); this._scheduleDrain(); }
	};
	applyRing(0);
};
Tools.prototype._syncPalette = function () { document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s.dataset.color === this.color)); };
Tools.prototype.renderTools = function (container) {
	this._toolContainer = container; container.innerHTML = '';
	const avail = Object.keys(TOOL_META).filter((t) => t === 'picker' || (this.world.tools[t] && this.world.tools[t].enabled));
	for (const t of avail) {
		const meta = TOOL_META[t];
		const b = el('button', { class: 'tool' + (t === this.tool ? ' active' : ''), title: meta.label + (meta.key ? ' [' + meta.key + ']' : ''), 'data-tool': t, onclick: () => { this.tool = t; this.renderTools(container); } });
		b.appendChild(toolIcon(t, t === this.tool));
		if (meta.key) b.appendChild(el('span', { class: 'hotkey-hint' }, meta.key));
		container.appendChild(b);
	}
};
Tools.prototype.renderPalette = function (container) {
	container.innerHTML = '';
	for (const c of this.world.palette) {
		const s = el('button', { class: 'swatch' + (c === this.color ? ' active' : ''), style: 'background:' + c, 'data-color': c, title: c, onclick: () => { this.color = c; this._syncPalette(); } });
		container.appendChild(s);
	}
};
export { Tools };
