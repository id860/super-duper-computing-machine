// Canvas-движок PixelFront: рендер холста, зум к курсору, панорамирование, миникарта.
// Оптимизировано: рендер только установленных пикселей (разрежённо, с отсечением по
// вьюпорту), rAF-коалесинг кадров и офскрин-буфер миникарты. Бесконечный холст с
// центральной зоной спавна.
// pixels Map теперь хранит {c, nick, at} — для тултипа автора и истории.
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
		this._raf = 0;
		this._needsDraw = false;
		this._mini = null;
		this._miniDirty = true;
		this._miniScale = 1;
		this._miniOx = 0;
		this._miniOy = 0;
		this._mbx0 = 0; this._mby0 = 0; this._mbx1 = 1000; this._mby1 = 1000;
		this._bind();
		this.resize();
	}

	// Повторная загрузка того же мира не должна швырять игрока на спавн.
	// Мир пере-синхронизируется после неудачной операции (например, «недостаточно
	// энергии»), после lifecycle-события и после входа в аккаунт; раньше в каждом
	// из этих случаев вызывался fit(), и камера улетала в центр зоны спавна.
	// Теперь fit() выполняется только при первом открытии или при переходе в
	// другой мир, а при пере-синхронизации сохраняются масштаб и смещение.
	setWorld(world, pixels) {
		const sameWorld = !!(this.world && world && this.world.id === world.id);
		const cam = sameWorld ? { scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY } : null;
		this.world = world;
		this.minScale = world.zoomMin || 0.5;
		this.maxScale = world.zoomMax || 40;
		this.showGrid = world.grid !== false;
		this.pixels.clear();
		// Начальная загрузка: [x, y, color] — без автора (ник не известен)
		for (const p of pixels || []) this.pixels.set(p[0] + ':' + p[1], { c: p[2] });
		// Пиксели сброшены, значит и карта загруженных чанков больше не верна:
		// без её очистки загрузчик считал бы вьюпорт уже прогруженным и холст
		// остался бы пустым до первого панорамирования.
		this._loadedChunks?.clear();
		this._chunkAccess?.clear();
		this._chunkFade?.clear();
		this._chunkPending?.clear();
		this._chunkGeneration = (this._chunkGeneration || 0) + 1;
		this._miniDirty = true;
		if (cam) {
			this.scale = Math.max(this.minScale, Math.min(this.maxScale, cam.scale));
			this.offsetX = cam.offsetX;
			this.offsetY = cam.offsetY;
			this.draw();
			this._emitView();
		} else this.fit();
		this._scheduleChunkLoad?.();
	}

	// nick и at — опциональны; передаются из SSE-события (там есть `by`)
	applyPixels(list, nick, at) {
		if (!this.world) return;
		const ts = at || null;
		for (const p of list) {
			const key = p[0] + ':' + p[1];
			if (p[2] === this.world.background) this.pixels.delete(key);
			else this.pixels.set(key, { c: p[2], nick: nick || null, at: ts });
		}
		this._miniDirty = true;
		this.draw();
	}

	colorAt(x, y) {
		const cell = this.pixels.get(x + ':' + y);
		return (cell ? cell.c : null) || (this.world ? this.world.background : '#ffffff');
	}

	// Возвращает полный объект пикселя {c, nick, at} или null
	pixelInfoAt(x, y) {
		return this.pixels.get(x + ':' + y) || null;
	}

	resize() {
		const rect = this.canvas.getBoundingClientRect();
		this.viewW = Math.max(1, rect.width);
		this.viewH = Math.max(1, rect.height);
		this.canvas.width = Math.floor(this.viewW * this.dpr);
		this.canvas.height = Math.floor(this.viewH * this.dpr);
		this.draw();
	}

	// Зона спавна для бесконечных миров (spawn×spawn), иначе фактический размер.
	_spawn() { return this.world ? (this.world.spawn || this.world.width) : 0; }
	_limX() { return this.world && this.world.infinite ? 100000 : (this.world ? this.world.width : 0); }
	_limY() { return this.world && this.world.infinite ? 100000 : (this.world ? this.world.height : 0); }

	fit() {
		if (!this.world) return;
		const inf = !!this.world.infinite;
		const w = inf ? this._spawn() : this.world.width;
		const h = inf ? this._spawn() : this.world.height;
		const sx = this.viewW / w;
		const sy = this.viewH / h;
		this.scale = Math.max(this.minScale, Math.min(this.maxScale, Math.min(sx, sy) * 0.9));
		this.offsetX = (this.viewW - w * this.scale) / 2;
		this.offsetY = (this.viewH - h * this.scale) / 2;
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

	// Планирует кадр через requestAnimationFrame — множественные вызовы за кадр
	// схлопываются в одну отрисовку. Это убирает лаги при панорамировании.
	draw() {
		this._needsDraw = true;
		if (this._raf) return;
		this._raf = requestAnimationFrame(() => {
			this._raf = 0;
			if (this._needsDraw) { this._needsDraw = false; this._render(); }
		});
	}

	_render() {
		const ctx = this.ctx;
		if (!ctx) return;
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#e9eaee';
		ctx.fillRect(0, 0, this.viewW, this.viewH);
		if (!this.world) return;
		const inf = !!this.world.infinite;
		const w = this.world.width, h = this.world.height;
		const s = this.scale;
		ctx.fillStyle = this.world.background || '#ffffff';
		if (inf) ctx.fillRect(0, 0, this.viewW, this.viewH);
		else ctx.fillRect(this.offsetX, this.offsetY, w * s, h * s);

		const limX = this._limX(), limY = this._limY();
		const cMinX = Math.max(0, Math.floor((0 - this.offsetX) / s));
		const cMinY = Math.max(0, Math.floor((0 - this.offsetY) / s));
		const cMaxX = Math.min(limX - 1, Math.ceil((this.viewW - this.offsetX) / s));
		const cMaxY = Math.min(limY - 1, Math.ceil((this.viewH - this.offsetY) / s));

		// Рендерим только реально установленные пиксели с отсечением по вьюпорту.
		// O(число пикселей), а не O(площадь) — на порядки быстрее при отдалении.
		const cell = Math.ceil(s);
		let lastColor = null;
		for (const [key, px] of this.pixels) {
			const c = px.c;
			const i = key.indexOf(':');
			const x = +key.slice(0, i);
			const y = +key.slice(i + 1);
			if (x < cMinX || x > cMaxX || y < cMinY || y > cMaxY) continue;
			if (c !== lastColor) { ctx.fillStyle = c; lastColor = c; }
			ctx.fillRect(Math.floor(this.offsetX + x * s), Math.floor(this.offsetY + y * s), cell, cell);
		}

		if (this.showGrid && s >= 8) {
			ctx.strokeStyle = 'rgba(0,0,0,0.10)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			for (let x = cMinX; x <= cMaxX + 1; x++) {
				const px = Math.floor(this.offsetX + x * s) + 0.5;
				ctx.moveTo(px, this.offsetY + cMinY * s);
				ctx.lineTo(px, this.offsetY + (cMaxY + 1) * s);
			}
			for (let y = cMinY; y <= cMaxY + 1; y++) {
				const py = Math.floor(this.offsetY + y * s) + 0.5;
				ctx.moveTo(this.offsetX + cMinX * s, py);
				ctx.lineTo(this.offsetX + (cMaxX + 1) * s, py);
			}
			ctx.stroke();
		}

		this._drawZone(ctx);
		if (this.onOverlay) this.onOverlay(ctx);

		if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < limX && this.hover.y < limY) {
			ctx.strokeStyle = 'rgba(20,22,28,0.85)';
			ctx.lineWidth = Math.max(1, Math.min(3, s / 6));
			ctx.strokeRect(this.offsetX + this.hover.x * s, this.offsetY + this.hover.y * s, s, s);
		}

		// Миникарта рисуется отдельно через _drawMinimap()
		this._drawMinimap();
	}

	_drawZone(ctx) {
		const sp = this._spawn();
		if (!sp || !this.world.infinite) return;
		const s = this.scale;
		const x0 = this.offsetX, y0 = this.offsetY, size = sp * s;
		ctx.save();
		ctx.strokeStyle = 'rgba(37,99,235,0.9)';
		ctx.lineWidth = 2;
		ctx.setLineDash([6, 4]);
		ctx.strokeRect(x0, y0, size, size);
		ctx.setLineDash([]);
		const label = sp + '\u00d7' + sp;
		ctx.font = '600 12px system-ui, -apple-system, sans-serif';
		const tw = Math.ceil(ctx.measureText(label).width);
		const lx = Math.min(Math.max(x0 + 6, 6), this.viewW - tw - 12);
		const ly = Math.min(Math.max(y0 + 18, 18), this.viewH - 8);
		ctx.fillStyle = 'rgba(37,99,235,0.92)';
		ctx.fillRect(lx - 5, ly - 13, tw + 10, 18);
		ctx.fillStyle = '#ffffff';
		ctx.textBaseline = 'alphabetic';
		ctx.fillText(label, lx, ly);
		ctx.restore();
	}

	// Офскрин-буфер миникарты. Область отображения = объединение зоны спавна +
	// всех пикселей + текущего вьюпорта. Перестраивается только при изменении
	// пикселей или при выходе вьюпорта за текущие границы.
	_rebuildMinimap(vx0, vy0, vx1, vy1) {
		if (!this.mctx || !this.world) return;
		const mw = this.minimap.width, mh = this.minimap.height;
		const sp = this._spawn();
		// Вычисляем границы: зона спавна + все пиксели + вьюпорт
		let bx0 = 0, by0 = 0, bx1 = sp || 1, by1 = sp || 1;
		for (const [key] of this.pixels) {
			const ci = key.indexOf(':');
			const px = +key.slice(0, ci), py = +key.slice(ci + 1);
			if (px < bx0) bx0 = px;
			if (py < by0) by0 = py;
			if (px + 1 > bx1) bx1 = px + 1;
			if (py + 1 > by1) by1 = py + 1;
		}
		if (vx0 !== undefined) {
			bx0 = Math.min(bx0, vx0); by0 = Math.min(by0, vy0);
			bx1 = Math.max(bx1, vx1); by1 = Math.max(by1, vy1);
		}
		// Паддинг 6% + 8 пикселей с каждой стороны
		const pw = (bx1 - bx0) * 0.06 + 8, ph = (by1 - by0) * 0.06 + 8;
		bx0 = Math.max(0, Math.floor(bx0 - pw));
		by0 = Math.max(0, Math.floor(by0 - ph));
		bx1 = Math.ceil(bx1 + pw);
		by1 = Math.ceil(by1 + ph);
		this._mbx0 = bx0; this._mby0 = by0; this._mbx1 = bx1; this._mby1 = by1;
		const s = Math.min(mw / (bx1 - bx0), mh / (by1 - by0));
		this._miniScale = s;
		this._miniOx = (mw - (bx1 - bx0) * s) / 2;
		this._miniOy = (mh - (by1 - by0) * s) / 2;
		if (!this._mini) this._mini = document.createElement('canvas');
		this._mini.width = mw; this._mini.height = mh;
		const b = this._mini.getContext('2d');
		b.clearRect(0, 0, mw, mh);
		// Фон зоны спавна
		if (sp) {
			const sx0 = this._miniOx + (0 - bx0) * s;
			const sy0 = this._miniOy + (0 - by0) * s;
			b.fillStyle = this.world.background || '#ffffff';
			b.fillRect(sx0, sy0, sp * s, sp * s);
			if (this.world.infinite) {
				b.strokeStyle = 'rgba(37,99,235,0.30)';
				b.lineWidth = 1;
				b.strokeRect(sx0, sy0, sp * s, sp * s);
			}
		}
		// Рисуем все пиксели (используем .c из объекта)
		for (const [key, pxcell] of this.pixels) {
			const ci = key.indexOf(':');
			const px = +key.slice(0, ci), py = +key.slice(ci + 1);
			b.fillStyle = pxcell.c;
			b.fillRect(
				this._miniOx + (px - bx0) * s,
				this._miniOy + (py - by0) * s,
				Math.max(1, s), Math.max(1, s)
			);
		}
		this._miniDirty = false;
	}

	// Рисует миникарту каждый кадр. Индикатор вьюпорта считается
	// напрямую из offsetX/offsetY/scale без отсечения — это
	// устраняет искажение прямоугольника при панорамировании.
	_drawMinimap() {
		if (!this.mctx || !this.world) return;
		// Точные мировые координаты вьюпорта (без клампинга!)
		const vx0 = (0 - this.offsetX) / this.scale;
		const vy0 = (0 - this.offsetY) / this.scale;
		const vx1 = (this.viewW - this.offsetX) / this.scale;
		const vy1 = (this.viewH - this.offsetY) / this.scale;
		// Перестраиваем если: данные изменились ИЛИ вьюпорт вышел за текущие границы
		const outside = !this._mini || this._miniDirty
			|| vx0 < this._mbx0 || vy0 < this._mby0
			|| vx1 > this._mbx1 || vy1 > this._mby1;
		if (outside) this._rebuildMinimap(vx0, vy0, vx1, vy1);
		const mc = this.mctx, mw = this.minimap.width, mh = this.minimap.height;
		mc.clearRect(0, 0, mw, mh);
		mc.drawImage(this._mini, 0, 0);
		// Индикатор вьюпорта — рисуется каждый кадр без кэша, без clamp
		const s = this._miniScale, ox = this._miniOx, oy = this._miniOy;
		const bx0 = this._mbx0, by0 = this._mby0;
		const rx = ox + (vx0 - bx0) * s;
		const ry = oy + (vy0 - by0) * s;
		const rw = Math.max(2, (vx1 - vx0) * s);
		const rh = Math.max(2, (vy1 - vy0) * s);
		mc.strokeStyle = '#2563eb';
		mc.lineWidth = 1.5;
		mc.strokeRect(Math.round(rx), Math.round(ry), Math.round(rw), Math.round(rh));
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
			if (this.onHover) this.onHover(p, e);
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
