// Viewport chunk loader, built along the same lines as a tile map engine
// (Leaflet/OSM): request only the tiles the viewport covers, nearest to the
// centre of the screen first, in parallel batches, drop requests that scroll
// out of view, and hand the renderer enough state to reveal each tile
// gracefully instead of popping it in.
//
// Two invariants keep this loop safe:
//   * every requested chunk is marked as visited, even when the server sends
//     nothing back for it (empty areas carry no cells). Without this the
//     "missing" list never shrank and the loader re-requested the same square
//     every 40 ms forever, which froze the tab as soon as a player entered a
//     world;
//   * a follow-up pass only runs when the previous one actually made progress.
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
const REVEAL_STAGGER_MS = 26; // Tiles of one batch reveal in a short cascade.
const MAX_STAGGER_MS = 180;

// How long a tile takes to develop once its pixels are in.
export const CHUNK_FADE_MS = 380;

function planKeys(plan) {
	const keys = [];
	for (let y = plan.cy - plan.radius; y <= plan.cy + plan.radius; y++) {
		for (let x = plan.cx - plan.radius; x <= plan.cx + plan.radius; x++) keys.push(chunkKey(x, y));
	}
	return keys;
}

PixelEngine.prototype._chunkState = function () {
	if (!this._loadedChunks) this._loadedChunks = new Set();
	if (!this._chunkAccess) this._chunkAccess = new Map();
	if (!this._chunkFade) this._chunkFade = new Map();
	if (!this._chunkPending) this._chunkPending = new Set();
	return this._loadedChunks;
};

PixelEngine.prototype._scheduleChunkLoad = function () {
	if (!this.world || !this.world.infinite) return;
	if (this._chunkTimer) return; // Coalesce a burst of pan or zoom events.
	this._chunkTimer = setTimeout(() => {
		this._chunkTimer = null;
		this._loadViewportChunks();
	}, DEBOUNCE_MS);
};

// Keeps the canvas animating while something is still loading or developing,
// then stops so an idle canvas costs nothing.
PixelEngine.prototype._runChunkAnimation = function () {
	if (this._chunkAnimFrame || typeof requestAnimationFrame !== 'function') return;
	const step = () => {
		this._chunkAnimFrame = null;
		const stamp = Date.now();
		for (const [key, at] of this._chunkFade) if (stamp - at > CHUNK_FADE_MS) this._chunkFade.delete(key);
		this.draw();
		if (this._chunkFade.size || this._chunkPending.size) this._chunkAnimFrame = requestAnimationFrame(step);
	};
	this._chunkAnimFrame = requestAnimationFrame(step);
};

// Marks chunks as visited so they are never requested again, whether or not
// they carried any pixels.
PixelEngine.prototype._markChunks = function (keys, stamp, limit) {
	this._chunkState();
	const cap = Math.max(MIN_TRACKED_CHUNKS, limit || 0);
	const freshBefore = stamp - FRESH_WINDOW_MS;
	let dropped = 0;
	for (const key of keys) {
		this._loadedChunks.add(key);
		this._chunkPending.delete(key);
		for (const stale of touchChunk(this._chunkAccess, key, stamp, cap)) {
			this._loadedChunks.delete(stale);
			this._chunkFade.delete(stale);
			dropped += evictChunkPixels(this.pixels, stale, CHUNK_SIZE, freshBefore);
		}
	}
	return dropped;
};

PixelEngine.prototype._absorbChunks = function (chunks, track, limit) {
	this._chunkState();
	const stamp = Date.now();
	const cells = [];
	const keys = [];
	let dropped = 0, revealed = 0;
	for (const chunk of chunks || []) {
		const count = chunk.cells?.length || 0;
		for (const cell of chunk.cells || []) cells.push(cell);
		if (!track) continue;
		const key = chunkKey(chunk.x, chunk.y);
		// Only chunks that actually bring content develop: blank areas must not
		// blink as empty squares all over the canvas. A small stagger makes a
		// batch arrive as a soft cascade rather than one hard flash.
		if (count && !this._loadedChunks.has(key)) {
			this._chunkFade.set(key, stamp + Math.min(MAX_STAGGER_MS, revealed * REVEAL_STAGGER_MS));
			revealed += 1;
		}
		keys.push(key);
	}
	if (keys.length) dropped = this._markChunks(keys, stamp, limit);
	if (cells.length) this.applyPixels(cells);
	if (dropped) {
		if (this.invalidateAllTiles) this.invalidateAllTiles();
		this._miniDirty = true;
	}
	if (revealed || dropped) this._runChunkAnimation();
	return cells.length;
};

// Runs the planned requests with a small worker pool so the centre of the
// screen is filled first without waiting for the outer batches.
PixelEngine.prototype._runChunkPlans = async function (worldId, plans, generation, limit, signal) {
	let next = 0;
	const worker = async () => {
		while (next < plans.length) {
			if (generation !== this._chunkGeneration) return;
			const plan = plans[next++];
			try {
				const url = `/api/worlds/${encodeURIComponent(worldId)}/chunks?cx=${plan.cx}&cy=${plan.cy}&radius=${plan.radius}`;
				const response = await fetch(url, { credentials: 'same-origin', signal });
				if (!response.ok) continue;
				const data = await response.json();
				if (generation !== this._chunkGeneration) return;
				const chunks = data.chunks || [];
				this._absorbChunks(chunks, true, limit);
				// The response only lists chunks that hold pixels; the rest of the
				// requested square is empty and must be remembered as visited.
				this._markChunks(planKeys(plan), Date.now(), limit);
				this.draw();
				writeCachedChunks(worldId, chunks).catch(() => { /* Cache writes are optional. */ });
			} catch (error) {
				// Aborted requests are the normal outcome of panning away.
				if (error?.name === 'AbortError') return;
			}
		}
	};
	const pool = [];
	for (let i = 0; i < Math.min(CONCURRENCY, plans.length); i++) pool.push(worker());
	await Promise.all(pool);
};

PixelEngine.prototype._loadViewportChunks = async function () {
	if (!this.world || !this.world.infinite || this._chunkLoading) return;
	this._chunkState();
	const view = { offsetX: this.offsetX, offsetY: this.offsetY, scale: this.scale, viewW: this.viewW, viewH: this.viewH };
	const range = viewportChunkRange(view, CHUNK_SIZE);
	const visible = rangeSize(range);
	if (!visible) return;
	// Keep every visible chunk resident plus a ring of margin for panning.
	const limit = Math.max(MIN_TRACKED_CHUNKS, visible * 2);
	const worldId = this._chunkWorldId || this.world.id;
	const generation = (this._chunkGeneration = (this._chunkGeneration || 0) + 1);
	const missing = rangeKeys(range).filter((key) => !this._loadedChunks.has(key));
	if (!missing.length) { this._chunkPending.clear(); return; }
	// Tiles that left the screen are no longer worth waiting for: drop their
	// requests so the connection pool serves what the player is looking at.
	this._chunkAbort?.abort();
	const controller = typeof AbortController === 'function' ? new AbortController() : null;
	this._chunkAbort = controller;
	this._chunkPending = new Set(missing);
	this._runChunkAnimation();
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
		await this._runChunkPlans(worldId, plans, generation, limit, controller?.signal);
	} finally {
		this._chunkLoading = false;
		if (generation === this._chunkGeneration) { this._chunkPending.clear(); this._chunkAbort = null; }
	}
	if (generation !== this._chunkGeneration) return;
	// Continue only while passes keep shrinking the backlog: a wide zoom-out
	// exceeds the per-pass budget, but a stalled pass must never respawn itself.
	const left = rangeKeys(range).filter((key) => !this._loadedChunks.has(key)).length;
	if (left && left < missing.length) this._scheduleChunkLoad();
};
