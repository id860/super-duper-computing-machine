// Offscreen tile renderer. The engine used to iterate the whole pixel map on
// every frame, which made panning and zoom-out stutter once a world held tens
// of thousands of pixels. Tiles are rasterised once at one canvas pixel per
// world cell and then blitted, so a frame costs one drawImage per visible tile.
import { PixelEngine } from './engine.js';
import { TILE_SIZE, parseTileKey, selectStaleTiles, tileKeyFor, tileOffset, visibleTileKeys } from './tile-grid.js';

const MAX_TILES = 320; // Roughly a 4k screen at minimum zoom plus a pan margin.

function tileState(engine) {
	if (!engine._tiles) {
		engine._tiles = new Map();
		engine._tileStamps = new Map();
		engine._tileDirty = new Set();
		engine._tilesAllDirty = true;
	}
	return engine._tiles;
}

PixelEngine.prototype.invalidateAllTiles = function () {
	tileState(this);
	this._tilesAllDirty = true;
};

const previousSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	this._tiles = null;
	previousSetWorld.apply(this, args);
	tileState(this);
	this.invalidateAllTiles();
};

const previousApplyPixels = PixelEngine.prototype.applyPixels;
PixelEngine.prototype.applyPixels = function (list, nick, at) {
	tileState(this);
	for (const cell of list || []) this._tileDirty.add(tileKeyFor(cell[0], cell[1]));
	previousApplyPixels.call(this, list, nick, at);
};

// Rasterises the requested tiles in a single pass over the pixel map, so a
// batch of new chunks costs one walk instead of one walk per tile.
PixelEngine.prototype._buildTiles = function (keys) {
	const tiles = tileState(this);
	const targets = new Map();
	for (const key of keys) {
		const coords = parseTileKey(key);
		if (!coords) continue;
		let canvas = tiles.get(key);
		if (!canvas) {
			canvas = document.createElement('canvas');
			canvas.width = TILE_SIZE;
			canvas.height = TILE_SIZE;
			tiles.set(key, canvas);
		}
		const ctx = canvas.getContext('2d');
		ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
		targets.set(key, ctx);
	}
	if (!targets.size) return;
	for (const [pixelKey, cell] of this.pixels) {
		const i = pixelKey.indexOf(':');
		const x = +pixelKey.slice(0, i), y = +pixelKey.slice(i + 1);
		const ctx = targets.get(tileKeyFor(x, y));
		if (!ctx) continue;
		ctx.fillStyle = cell.c;
		ctx.fillRect(tileOffset(x), tileOffset(y), 1, 1);
	}
};

PixelEngine.prototype._drawTiles = function (ctx) {
	const tiles = tileState(this);
	if (this._tilesAllDirty) {
		tiles.clear();
		this._tileStamps.clear();
		this._tileDirty.clear();
		this._tilesAllDirty = false;
	}
	const visible = visibleTileKeys({
		offsetX: this.offsetX, offsetY: this.offsetY, scale: this.scale, viewW: this.viewW, viewH: this.viewH
	});
	const pending = visible.filter((key) => !tiles.has(key) || this._tileDirty.has(key));
	this._buildTiles(pending);
	for (const key of pending) this._tileDirty.delete(key);
	const span = TILE_SIZE * this.scale;
	const stamp = Date.now();
	for (const key of visible) {
		const canvas = tiles.get(key), coords = parseTileKey(key);
		if (!canvas || !coords) continue;
		this._tileStamps.set(key, stamp);
		ctx.drawImage(canvas, this.offsetX + coords.tx * span, this.offsetY + coords.ty * span, span, span);
	}
	const keep = new Set(visible);
	for (const key of selectStaleTiles(this._tileStamps, keep, MAX_TILES)) {
		tiles.delete(key);
		this._tileStamps.delete(key);
	}
};

PixelEngine.prototype._render = function () {
	const ctx = this.ctx;
	if (!ctx) return;
	ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
	ctx.imageSmoothingEnabled = false;
	ctx.fillStyle = '#e9eaee';
	ctx.fillRect(0, 0, this.viewW, this.viewH);
	if (!this.world) return;
	const s = this.scale, infinite = !!this.world.infinite;
	ctx.fillStyle = this.world.background || '#ffffff';
	if (infinite) ctx.fillRect(0, 0, this.viewW, this.viewH);
	else ctx.fillRect(this.offsetX, this.offsetY, this.world.width * s, this.world.height * s);

	this._drawTiles(ctx);

	const limX = this._limX(), limY = this._limY();
	if (this.showGrid && s >= 8) {
		const minX = Math.max(0, Math.floor(-this.offsetX / s));
		const minY = Math.max(0, Math.floor(-this.offsetY / s));
		const maxX = Math.min(limX - 1, Math.ceil((this.viewW - this.offsetX) / s));
		const maxY = Math.min(limY - 1, Math.ceil((this.viewH - this.offsetY) / s));
		ctx.strokeStyle = 'rgba(0,0,0,0.10)';
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

	this._drawZone(ctx);
	if (this.onOverlay) this.onOverlay(ctx);
	if (this.hover && this.hover.x >= 0 && this.hover.y >= 0 && this.hover.x < limX && this.hover.y < limY) {
		ctx.strokeStyle = 'rgba(20,22,28,0.85)';
		ctx.lineWidth = Math.max(1, Math.min(3, s / 6));
		ctx.strokeRect(this.offsetX + this.hover.x * s, this.offsetY + this.hover.y * s, s, s);
	}
	this._drawMinimap();
};
