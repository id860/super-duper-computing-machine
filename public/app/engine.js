// Canvas-движок PixelFront: рендер холста, зум к курсору, панорамирование, миникарта.
export class PixelEngine {
	constructor(canvas, minimap) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d', { alpha: false });
		this.minimap = minimap || null;
		this.mctx = minimap ? minimap.getContext('2d') : null;
		this.world = null;
		this.pixels = new Map();
		this.scale = 8;
		this.offsetX = 0;
		this.offsetY = 0;
		this.minScale = 0.5;
		this.maxScale = 40;
		this.showGrid = true;
		this.dpr = Math.max(1, window.devicePixelRatio || 1);
		this.hover = null;
		this.panning = false;
		this.spaceDown = false;
		this.painting = false;
		this.last = null;
		this.onCellDown = null;
		this.onCellDrag = null;
		this.onCellUp = null;
		this.onHover = null;
		this.onView = null;
		this.onOverlay = null;
		this._pointers = new Map();
		this._pinch = null;
		this._bind();
		this.resize();
	}

	setWorld(world, pixels) {
		this.world = world;
		this.minScale = world.zoomMin || 0.5;
		this.maxScale = world.zoomMax || 40;
		this.showGrid = world.grid !== false;
		this.pixels.clear();
		for (const p of pixels || []) this.pixels.set(p[0] + ':' + p[1], p[2]);
		this.fit();
	}

	applyPixels(list) {
		if (!this.world) return;
		for (const p of list) {
			if (p[2] === this.world.background) this.pixels.delete(p[0] + ':' + p[1]);
			else this.pixels.set(p[0] + ':' + p[1], p[2]);
		}
		this.draw();
	}

	colorAt(x, y) {
		return this.pixels.get(x + ':' + y) || (this.world ? this.world.background : '#ffffff');
	}

	resize() {
		const rect = this.canvas.getBoundingClientRect();
		this.viewW = Math.max(1, rect.width);
		this.viewH = Math.max(1, rect.height);
		this.canvas.width = Math.floor(this.viewW * this.dpr);
		this.canvas.height = Math.floor(this.viewH * this.dpr);
		this.draw();
	}

	fit() {
		if (!this.world) return;
		const sx = this.viewW / this.world.width;
		const sy = this.viewH / this.world.height;
		this.scale = Math.max(this.minScale, Math.min(this.maxScale, Math.min(sx, sy) * 0.9));
		this.offsetX = (this.viewW - this.world.width * this.scale) / 2;
		this.offsetY = (this.viewH - this.world.height * this.scale) / 2;
		this.draw();
		this._emitView();
	}

	center(x, y, scale) {
		if (scale) this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
		this.offsetX = this.viewW / 2 - (x + 0.5) * this.scale;
		this.offsetY = this.viewH / 2 - (y + 0.5) * this.scale;
		this.draw();
		this._emitView();
	}

	screenToWorld(sx, sy) {
		return { x: Math.floor((sx - this.offsetX) / this.scale), y: Math.floor((sy - this.offsetY) / this.scale) };
	}

	worldToScreen(x, y) {
		return { x: this.offsetX + x * this.scale, y: this.offsetY + y * this.scale };
	}

	zoomAt(factor, sx, sy) {
		const wx = (sx - this.offsetX) / this.scale;
		const wy = (sy - this.offsetY) / this.scale;
		this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
		this.offsetX = sx - wx * this.scale;
		this.offsetY = sy - wy * this.scale;
		this.draw();
		this._emitView();
	}

	zoomButton(factor) {
		this.zoomAt(factor, this.viewW / 2, this.viewH / 2);
	}

	draw() {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#0d0f14';
		ctx.fillRect(0, 0, this.viewW, this.viewH);
		if (!this.world) return;
		const w = this.world.width, h = this.world.height;
		ctx.fillStyle = this.world.background || '#ffffff';
		ctx.fillRect(this.offsetX, this.offsetY, w * this.scale, h * this.scale);
		const minX = Math.max(0, Math.floor((0 - this.offsetX) / this.scale));
		const minY = Math.max(0, Math.floor((0 - this.offsetY) / this.scale));
		const maxX = Math.min(w - 1, Math.ceil((this.viewW - this.offsetX) / this.scale));
		const maxY = Math.min(h - 1, Math.ceil((this.viewH - this.offsetY) / this.scale));
		const s = this.scale;
		for (let y = minY; y <= maxY; y++) {
			for (let x = minX; x <= maxX; x++) {
				const c = this.pixels.get(x + ':' + y);
				if (!c) continue;
				ctx.fillStyle = c;
				ctx.fillRect(Math.floor(this.offsetX + x * s), Math.floor(this.offsetY + y * s), Math.ceil(s), Math.ceil(s));
			}
		}
		if (this.showGrid && s >= 8) {
			ctx.strokeStyle = 'rgba(0,0,0,0.16)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let x = minX; x <= maxX + 1; x++) {
				const px = Math.floor(this.offsetX + x * s) + 0.5;
				ctx.moveTo(px, this.offsetY + minY * s);
				ctx.lineTo(px, this.offsetY + (maxY + 1) * s);
			}
			for (let y = minY; y <= maxY + 1; y++) {
				const py = Math.floor(this.offsetY + y * s) + 0.5;
				ctx.moveTo(this.offsetX + minX * s, py);
				ctx.lineTo(this.offsetX + (maxX + 1) * s, py);
			}
			ctx.stroke();
		}
		if (this.onOverlay) this.onOverlay(ctx);
		if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < w && this.hover.y < h) {
			ctx.strokeStyle = 'rgba(255,255,255,0.9)';
			ctx.lineWidth = Math.max(1, Math.min(3, s / 6));
			ctx.strokeRect(this.offsetX + this.hover.x * s, this.offsetY + this.hover.y * s, s, s);
		}
		this._drawMinimap(minX, minY, maxX, maxY);
	}

	_drawMinimap(minX, minY, maxX, maxY) {
		if (!this.mctx) return;
		const mc = this.mctx, mw = this.minimap.width, mh = this.minimap.height;
		mc.clearRect(0, 0, mw, mh);
		const w = this.world.width, h = this.world.height;
		const s = Math.min(mw / w, mh / h);
		const ox = (mw - w * s) / 2, oy = (mh - h * s) / 2;
		mc.fillStyle = this.world.background || '#fff';
		mc.fillRect(ox, oy, w * s, h * s);
		for (const [key, c] of this.pixels) {
			const i = key.indexOf(':');
			const x = +key.slice(0, i), y = +key.slice(i + 1);
			mc.fillStyle = c;
			mc.fillRect(ox + x * s, oy + y * s, Math.max(1, s), Math.max(1, s));
		}
		mc.strokeStyle = '#4ea1ff';
		mc.lineWidth = 1;
		mc.strokeRect(ox + minX * s, oy + minY * s, (maxX - minX + 1) * s, (maxY - minY + 1) * s);
	}

	_emitView() {
		if (this.onView) this.onView({ scale: this.scale, x: this.hover ? this.hover.x : 0, y: this.hover ? this.hover.y : 0 });
	}

	_bind() {
		const c = this.canvas;
		c.addEventListener('contextmenu', (e) => e.preventDefault());
		c.addEventListener('wheel', (e) => {
			e.preventDefault();
			const r = c.getBoundingClientRect();
			const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
			this.zoomAt(factor, e.clientX - r.left, e.clientY - r.top);
		}, { passive: false });
		c.addEventListener('pointerdown', (e) => {
			c.setPointerCapture(e.pointerId);
			this._pointers.set(e.pointerId, e);
			const r = c.getBoundingClientRect();
			const sx = e.clientX - r.left, sy = e.clientY - r.top;
			if (this._pointers.size === 2) { this._startPinch(); return; }
			const pan = e.button === 1 || e.button === 2 || this.spaceDown;
			if (pan) { this.panning = true; this.last = { sx, sy }; c.style.cursor = 'grabbing'; }
			else { this.painting = true; const p = this.screenToWorld(sx, sy); this.last = p; if (this.onCellDown) this.onCellDown(p.x, p.y, e); }
		});
		c.addEventListener('pointermove', (e) => {
			const r = c.getBoundingClientRect();
			const sx = e.clientX - r.left, sy = e.clientY - r.top;
			if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, e);
			if (this._pointers.size === 2 && this._pinch) { this._movePinch(); return; }
			const p = this.screenToWorld(sx, sy);
			this.hover = p;
			if (this.onHover) this.onHover(p);
			if (this.panning && this.last) {
				this.offsetX += sx - this.last.sx;
				this.offsetY += sy - this.last.sy;
				this.last = { sx, sy };
				this.draw();
			} else if (this.painting) {
				if (!this.last || p.x !== this.last.x || p.y !== this.last.y) { this.last = p; if (this.onCellDrag) this.onCellDrag(p.x, p.y, e); }
			} else {
				this.draw();
			}
			this._emitView();
		});
		const up = (e) => {
			this._pointers.delete(e.pointerId);
			if (this._pointers.size < 2) this._pinch = null;
			if (this.painting) {
				const r = c.getBoundingClientRect();
				const p = this.screenToWorld(e.clientX - r.left, e.clientY - r.top);
				if (this.onCellUp) this.onCellUp(p.x, p.y, e);
			}
			this.painting = false;
			this.panning = false;
			this.last = null;
			c.style.cursor = this.spaceDown ? 'grab' : '';
		};
		c.addEventListener('pointerup', up);
		c.addEventListener('pointercancel', up);
		window.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); this.spaceDown = true; c.style.cursor = 'grab'; } });
		window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; c.style.cursor = ''; } });
		window.addEventListener('resize', () => this.resize());
	}

	_startPinch() {
		const pts = [...this._pointers.values()];
		const r = this.canvas.getBoundingClientRect();
		const a = { x: pts[0].clientX - r.left, y: pts[0].clientY - r.top };
		const b = { x: pts[1].clientX - r.left, y: pts[1].clientY - r.top };
		this._pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
		this.painting = false;
	}

	_movePinch() {
		const pts = [...this._pointers.values()];
		const r = this.canvas.getBoundingClientRect();
		const a = { x: pts[0].clientX - r.left, y: pts[0].clientY - r.top };
		const b = { x: pts[1].clientX - r.left, y: pts[1].clientY - r.top };
		const dist = Math.hypot(a.x - b.x, a.y - b.y);
		const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
		if (this._pinch.dist) this.zoomAt(dist / this._pinch.dist, cx, cy);
		this.offsetX += cx - this._pinch.cx;
		this.offsetY += cy - this._pinch.cy;
		this._pinch = { dist, cx, cy };
		this.draw();
	}
}

export function bresenham(x0, y0, x1, y1) {
	const cells = [];
	let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	while (true) {
		cells.push([x0, y0]);
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * err;
		if (e2 >= dy) { err += dy; x0 += sx; }
		if (e2 <= dx) { err += dx; y0 += sy; }
		if (cells.length > 8192) break;
	}
	return cells;
}

export function rectCells(x0, y0, x1, y1, filled) {
	const cells = [];
	const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
	const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			if (filled || x === minX || x === maxX || y === minY || y === maxY) cells.push([x, y]);
			if (cells.length > 8192) return cells;
		}
	}
	return cells;
}
