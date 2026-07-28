import { toast } from './ui-base.js';
export class Tools {
	constructor(engine, api) {
		this.engine = engine; this.api = api; this.tool = 'pixel'; this.color = '#000000';
		this.world = null; this.buffer = []; this.anchor = null; this.preview = null;
		this.queue = []; this.sending = false; this.onReward = null; this.onEnergy = null;
		this._undoStack = []; this._toolContainer = null; this._batchTimer = null;
		this._wire(); this._bindHotkeys();
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
		const cells = [], half = Math.floor(n / 2);
		for (let dy = -half; dy < n - half; dy++) for (let dx = -half; dx < n - half; dx++) cells.push([x + dx, y + dy]);
		return cells;
	}
	_penSize() { return this.tool === 'brush3' ? 3 : this.tool === 'brush2' ? 2 : 1; }
	_addBuffer(cells) {
		const keys = new Set(this.buffer.map((c) => c[0] + ':' + c[1]));
		for (const c of cells) { const k = c[0] + ':' + c[1]; if (!keys.has(k) && this._inBounds(c)) { keys.add(k); this.buffer.push(c); } }
	}
	_applyImmediate(cells, color) {
		if (!cells.length) return;
		const filtered = cells.filter((c) => this._inBounds(c));
		if (!filtered.length) return;
		this.engine.applyPixels(filtered.map((c) => [c[0], c[1], color]));
	}
	_commit(tool, cells) {
		cells = cells.filter((c) => this._inBounds(c));
		if (!cells.length) return;
		const color = this.color;
		const undoEntry = cells.map((c) => ({ key: c[0] + ':' + c[1], prev: this.engine.colorAt(c[0], c[1]) })).filter((e) => e.prev !== color);
		if (undoEntry.length) { this._undoStack.push(undoEntry); if (this._undoStack.length > 50) this._undoStack.shift(); }
		this.engine.applyPixels(cells.map((c) => [c[0], c[1], color]));
		const max = Math.max(1, this._toolCfg(tool).maxSize || 1);
		for (let i = 0; i < cells.length; i += max) this.queue.push({ tool, cells: cells.slice(i, i + max), color });
		this._scheduleDrain();
	}
	_scheduleDrain() {
		if (this.sending) return;
		clearTimeout(this._batchTimer);
		this._batchTimer = setTimeout(() => { this._batchTimer = null; this._drain(); }, 16);
	}
	async _drain() {
		if (this.sending) return;
		this.sending = true;
		const MAX_CONCURRENT = 3;
		while (this.queue.length) {
			const batch = [];
			for (let i = 0; i < MAX_CONCURRENT && this.queue.length; i++) batch.push(this.queue.shift());
			try {
				const results = await Promise.all(batch.map((job) => this.api.ops(this.world.id, { tool: job.tool, color: job.color || this.color, cells: job.cells })));
				for (const res of results) {
					if (res.energy && this.onEnergy) this.onEnergy(res.energy);
					if (res.reward && this.onReward) this.onReward(res.reward);
				}
			} catch (err) {
				toast(err.message || 'Ошибка рисования', 'error');
				this.queue = [];
				try { const w = await this.api.world(this.world.id); this.engine.setWorld(w.world, w.pixels); } catch {}
				break;
			}
		}
		this.sending = false;
		if (this.queue.length) this._drain();
	}
}
