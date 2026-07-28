// Viewport chunk loader. Cached chunks are painted immediately for fast
// navigation, then always revalidated against the server before they become
// authoritative for the current session.
import { PixelEngine } from './engine.js';
import { evictChunkPixels, touchChunk } from './chunk-lru.js';
import { chunkKey, planRequests, rangeKeys, rangeSize, viewportChunkRange } from './chunk-queue.js';
import { keysNeedingValidation, keepNewerCell } from './chunk-consistency.js';
import { readCachedChunks, writeCachedChunks } from './chunk-store.js';

const CHUNK_SIZE = 86;
const REQUEST_RADIUS = 3;
const CONCURRENCY = 4;
const MIN_TRACKED_CHUNKS = 96;
const FRESH_WINDOW_MS = 60000;
const DEBOUNCE_MS = 40;
const MAX_REQUESTS_PER_PASS = 12;
const REVEAL_STAGGER_MS = 26;
const MAX_STAGGER_MS = 180;
export const CHUNK_FADE_MS = 380;

function planKeys(plan) {
	const keys = [];
	for (let y = plan.cy - plan.radius; y <= plan.cy + plan.radius; y++) {
		for (let x = plan.cx - plan.radius; x <= plan.cx + plan.radius; x++) {
			if (x >= 0 && y >= 0) keys.push(chunkKey(x, y));
		}
	}
	return keys;
}

function pixelChunkKey(key) {
	const i = key.indexOf(':');
	const x = Number(key.slice(0, i)), y = Number(key.slice(i + 1));
	return chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
}

const previousSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	this._validatedChunks?.clear();
	this._chunkAbort?.abort();
	previousSetWorld.apply(this, args);
};

PixelEngine.prototype._chunkState = function () {
	if (!this._loadedChunks) this._loadedChunks = new Set();
	if (!this._validatedChunks) this._validatedChunks = new Set();
	if (!this._chunkAccess) this._chunkAccess = new Map();
	if (!this._chunkFade) this._chunkFade = new Map();
	if (!this._chunkPending) this._chunkPending = new Set();
	return this._loadedChunks;
};

PixelEngine.prototype._scheduleChunkLoad = function () {
	if (!this.world || !this.world.infinite || this._chunkTimer) return;
	this._chunkTimer = setTimeout(() => {
		this._chunkTimer = null;
		this._loadViewportChunks();
	}, DEBOUNCE_MS);
};

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

PixelEngine.prototype._markChunks = function (keys, stamp, limit, validated = false) {
	this._chunkState();
	const cap = Math.max(MIN_TRACKED_CHUNKS, limit || 0);
	const freshBefore = stamp - FRESH_WINDOW_MS;
	let dropped = 0;
	for (const key of keys) {
		this._loadedChunks.add(key);
		if (validated) this._validatedChunks.add(key);
		this._chunkPending.delete(key);
		for (const stale of touchChunk(this._chunkAccess, key, stamp, cap)) {
			this._loadedChunks.delete(stale);
			this._validatedChunks.delete(stale);
			this._chunkFade.delete(stale);
			dropped += evictChunkPixels(this.pixels, stale, CHUNK_SIZE, freshBefore);
		}
	}
	return dropped;
};

PixelEngine.prototype._absorbChunks = function (chunks, track, limit, validated = false) {
	this._chunkState();
	const stamp = Date.now(), cells = [], keys = [];
	let dropped = 0, revealed = 0;
	for (const chunk of chunks || []) {
		const count = chunk.cells?.length || 0;
		for (const cell of chunk.cells || []) cells.push(cell);
		if (!track) continue;
		const key = chunkKey(chunk.x, chunk.y);
		if (count && !this._loadedChunks.has(key)) {
			this._chunkFade.set(key, stamp + Math.min(MAX_STAGGER_MS, revealed * REVEAL_STAGGER_MS));
			revealed += 1;
		}
		keys.push(key);
	}
	if (keys.length) dropped = this._markChunks(keys, stamp, limit, validated);
	if (cells.length) this.applyPixels(cells);
	if (dropped) {
		this.invalidateAllTiles?.();
		this._miniDirty = true;
	}
	if (revealed || dropped) this._runChunkAnimation();
	return cells.length;
};

// Replace complete server-returned chunks, including pixels that disappeared
// since the IndexedDB snapshot. Optimistic/SSE writes newer than the request
// are retained to avoid reverting an operation that raced with the response.
PixelEngine.prototype._replaceAuthoritativeChunks = function (chunks, requestedAt, limit) {
	const authoritative = new Set((chunks || []).map((chunk) => chunkKey(chunk.x, chunk.y)));
	let removed = 0;
	if (authoritative.size) {
		for (const [key, cell] of this.pixels) {
			if (!authoritative.has(pixelChunkKey(key)) || keepNewerCell(cell, requestedAt)) continue;
			this.pixels.delete(key);
			removed += 1;
		}
	}
	const absorbed = this._absorbChunks(chunks, true, limit, true);
	if (removed) {
		this.invalidateAllTiles?.();
		this._miniDirty = true;
		this.draw();
	}
	return absorbed;
};

PixelEngine.prototype._runChunkPlans = async function (worldId, plans, generation, limit, signal) {
	let next = 0;
	const worker = async () => {
		while (next < plans.length) {
			if (generation !== this._chunkGeneration) return;
			const plan = plans[next++], requestedAt = Date.now();
			try {
				const url = `/api/worlds/${encodeURIComponent(worldId)}/chunks?cx=${plan.cx}&cy=${plan.cy}&radius=${plan.radius}`;
				const response = await fetch(url, { credentials: 'same-origin', signal });
				if (!response.ok) continue;
				const data = await response.json();
				if (generation !== this._chunkGeneration) return;
				const chunks = data.chunks || [];
				this._replaceAuthoritativeChunks(chunks, requestedAt, limit);
				this._markChunks(planKeys(plan), Date.now(), limit, true);
				this.draw();
				writeCachedChunks(worldId, chunks).catch(() => {});
			} catch (error) {
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
	const range = viewportChunkRange(view, CHUNK_SIZE), visible = rangeSize(range);
	if (!visible) return;
	const limit = Math.max(MIN_TRACKED_CHUNKS, visible * 2);
	const worldId = this._chunkWorldId || this.world.id;
	const generation = (this._chunkGeneration = (this._chunkGeneration || 0) + 1);
	const visibleKeys = rangeKeys(range);
	const missing = keysNeedingValidation(visibleKeys, this._validatedChunks);
	if (!missing.length) { this._chunkPending.clear(); return; }
	this._chunkAbort?.abort();
	const controller = typeof AbortController === 'function' ? new AbortController() : null;
	this._chunkAbort = controller;
	this._chunkPending = new Set(missing);
	this._runChunkAnimation();
	this._chunkLoading = true;
	try {
		// Cache is provisional: paint it, but do not add it to validatedChunks.
		const uncached = missing.filter((key) => !this._loadedChunks.has(key));
		const cached = await readCachedChunks(worldId, uncached);
		if (generation !== this._chunkGeneration) return;
		if (cached.length) this._absorbChunks(cached, true, limit, false);
		const center = { cx: Math.floor((range.x0 + range.x1) / 2), cy: Math.floor((range.y0 + range.y1) / 2) };
		const plans = planRequests(range, this._validatedChunks, center, REQUEST_RADIUS).slice(0, MAX_REQUESTS_PER_PASS);
		if (!plans.length) return;
		await this._runChunkPlans(worldId, plans, generation, limit, controller?.signal);
	} finally {
		this._chunkLoading = false;
		if (generation === this._chunkGeneration) { this._chunkPending.clear(); this._chunkAbort = null; }
	}
	if (generation !== this._chunkGeneration) return;
	const left = keysNeedingValidation(visibleKeys, this._validatedChunks).length;
	if (left && left < missing.length) this._scheduleChunkLoad();
};
