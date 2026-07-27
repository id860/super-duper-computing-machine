// Viewport chunk loader.
//
// Previous behaviour: one request per frame for a Chebyshev ring around the
// centre chunk, radius clamped to 2. Zoomed out the viewport spans far more
// than 5×5 chunks, so most of the screen never received data and the rings
// serialised one round trip after another. The loader now asks for exactly the
// chunks the viewport covers, in parallel batches, nearest to the centre of the
// screen first, and paints anything already sitting in the local cache before
// the network answers.
import { PixelEngine } from './engine.js';
import { evictChunkPixels, touchChunk } from './chunk-lru.js';
import { chunkKey, planRequests, rangeKeys, rangeSize, viewportChunkRange } from './chunk-queue.js';
import { readCachedChunks, writeCachedChunks } from './chunk-store.js';

const CHUNK_SIZE = 86; // Mirrors the runtime value in src/http/chunks.mjs.
const REQUEST_RADIUS = 3; // 7×7 chunks per request, matching the server clamp.
const CONCURRENCY = 4; // Parallel requests; browsers keep six per origin.
const MIN_TRACKED_CHUNKS = 96;
const FRESH_WINDOW_MS = 60000;
const DEBOUNCE_MS = 40;
const MAX_REQUESTS_PER_PASS = 12; // Guard against pathological zoom-outs.

PixelEngine.prototype._scheduleChunkLoad = function () {
	if (!this.world || !this.world.infinite) return;
	if (this._chunkTimer) return; // Coalesce a burst of pan or zoom events.
	this._chunkTimer = setTimeout(() => {
		this._chunkTimer = null;
		this._loadViewportChunks();
	}, DEBOUNCE_MS);
};

PixelEngine.prototype._absorbChunks = function (chunks, track, limit) {
	if (!this._loadedChunks) this._loadedChunks = new Set();
	if (!this._chunkAccess) this._chunkAccess = new Map();
	const cap = Math.max(MIN_TRACKED_CHUNKS, limit || 0);
	const stamp = Date.now(), freshBefore = stamp - FRESH_WINDOW_MS;
	const cells = [];
	let dropped = 0;
	for (const chunk of chunks || []) {
		for (const cell of chunk.cells || []) cells.push(cell);
		if (!track) continue;
		const key = chunkKey(chunk.x, chunk.y);
		this._loadedChunks.add(key);
		for (const stale of touchChunk(this._chunkAccess, key, stamp, cap)) {
			this._loadedChunks.delete(stale);
			dropped += evictChunkPixels(this.pixels, stale, CHUNK_SIZE, freshBefore);
		}
	}
	if (cells.length) this.applyPixels(cells);
	if (dropped) {
		if (this.invalidateAllTiles) this.invalidateAllTiles();
		this._miniDirty = true;
		this.draw();
	}
	return cells.length;
};

// Runs the planned requests with a small worker pool so the centre of the
// screen is filled first without waiting for the outer batches.
PixelEngine.prototype._runChunkPlans = async function (worldId, plans, generation, limit) {
	let next = 0;
	const worker = async () => {
		while (next < plans.length) {
			if (generation !== this._chunkGeneration) return;
			const plan = plans[next++];
			try {
				const url = `/api/worlds/${encodeURIComponent(worldId)}/chunks?cx=${plan.cx}&cy=${plan.cy}&radius=${plan.radius}`;
				const response = await fetch(url, { credentials: 'same-origin' });
				if (!response.ok) continue;
				const data = await response.json();
				if (generation !== this._chunkGeneration) return;
				const chunks = data.chunks || [];
				this._absorbChunks(chunks, true, limit);
				writeCachedChunks(worldId, chunks).catch(() => { /* Cache writes are optional. */ });
			} catch { /* Network errors retry after the next viewport change. */ }
		}
	};
	const pool = [];
	for (let i = 0; i < Math.min(CONCURRENCY, plans.length); i++) pool.push(worker());
	await Promise.all(pool);
};

PixelEngine.prototype._loadViewportChunks = async function () {
	if (!this.world || !this.world.infinite || this._chunkLoading) return;
	if (!this._loadedChunks) this._loadedChunks = new Set();
	const view = { offsetX: this.offsetX, offsetY: this.offsetY, scale: this.scale, viewW: this.viewW, viewH: this.viewH };
	const range = viewportChunkRange(view, CHUNK_SIZE);
	const visible = rangeSize(range);
	if (!visible) return;
	// Keep every visible chunk resident plus a ring of margin for panning.
	const limit = Math.max(MIN_TRACKED_CHUNKS, visible * 2);
	const worldId = this._chunkWorldId || this.world.id;
	const generation = (this._chunkGeneration = (this._chunkGeneration || 0) + 1);
	const missing = rangeKeys(range).filter((key) => !this._loadedChunks.has(key));
	if (!missing.length) return;
	this._chunkLoading = true;
	try {
		// Cache-first pass: paint what the browser already stores, then let the
		// planner ask the server only for what is genuinely absent.
		const cached = await readCachedChunks(worldId, missing);
		if (generation !== this._chunkGeneration) return;
		if (cached.length) this._absorbChunks(cached, true, limit);
		const center = {
			cx: Math.floor((range.x0 + range.x1) / 2),
			cy: Math.floor((range.y0 + range.y1) / 2)
		};
		const plans = planRequests(range, this._loadedChunks, center, REQUEST_RADIUS).slice(0, MAX_REQUESTS_PER_PASS);
		if (!plans.length) return;
		await this._runChunkPlans(worldId, plans, generation, limit);
	} finally { this._chunkLoading = false; }
	// A wide zoom-out can exceed the per-pass budget; continue with the rest.
	if (generation === this._chunkGeneration) this._scheduleChunkLoad();
};
