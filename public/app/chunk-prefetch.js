// Progressive viewport loader. It replaces the single radius request installed
// by interaction-patch.js, which also used a stale chunk size and therefore
// asked the server for the wrong coordinates. The loader now:
//   * uses the runtime chunk size (86) that src/http/chunks.mjs serves,
//   * fetches the centre chunk first and only then the surrounding rings,
//   * paints locally cached chunks before the network answers,
//   * keeps the in-memory pixel map bounded through the shared chunk LRU.
import { PixelEngine } from './engine.js';
import { evictChunkPixels, touchChunk } from './chunk-lru.js';
import { centerChunk, chunkKey, missingRadius, ringKeys } from './chunk-queue.js';
import { readCachedChunks, writeCachedChunks } from './chunk-store.js';

const CHUNK_SIZE = 86; // Mirrors the runtime value in src/http/chunks.mjs.
const MAX_RADIUS = 2; // Server clamp for a single request.
const MAX_TRACKED_CHUNKS = 81;
const FRESH_WINDOW_MS = 60000;
const DEBOUNCE_MS = 50;

PixelEngine.prototype._scheduleChunkLoad = function () {
	if (!this.world || !this.world.infinite) return;
	if (this._chunkTimer) return; // Coalesce a burst of pan or zoom events.
	this._chunkTimer = setTimeout(() => {
		this._chunkTimer = null;
		this._loadViewportChunks();
	}, DEBOUNCE_MS);
};

PixelEngine.prototype._absorbChunks = function (chunks, track) {
	if (!this._loadedChunks) this._loadedChunks = new Set();
	if (!this._chunkAccess) this._chunkAccess = new Map();
	const stamp = Date.now(), freshBefore = stamp - FRESH_WINDOW_MS;
	const cells = [];
	let dropped = 0;
	for (const chunk of chunks || []) {
		for (const cell of chunk.cells || []) cells.push(cell);
		if (!track) continue;
		const key = chunkKey(chunk.x, chunk.y);
		this._loadedChunks.add(key);
		for (const stale of touchChunk(this._chunkAccess, key, stamp, MAX_TRACKED_CHUNKS)) {
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

PixelEngine.prototype._loadViewportChunks = async function () {
	if (!this.world || !this.world.infinite || this._chunkLoading) return;
	if (!this._loadedChunks) this._loadedChunks = new Set();
	const view = { offsetX: this.offsetX, offsetY: this.offsetY, scale: this.scale, viewW: this.viewW, viewH: this.viewH };
	const { cx, cy } = centerChunk(view, CHUNK_SIZE);
	const radius = missingRadius(cx, cy, this._loadedChunks, MAX_RADIUS);
	if (radius < 0) return;
	const worldId = this._chunkWorldId || this.world.id;
	this._chunkLoading = true;
	try {
		const wanted = ringKeys(cx, cy, radius).filter((key) => !this._loadedChunks.has(key));
		const cached = await readCachedChunks(worldId, wanted);
		if (cached.length && worldId === (this._chunkWorldId || worldId)) this._absorbChunks(cached, false);
		const url = `/api/worlds/${encodeURIComponent(worldId)}/chunks?cx=${cx}&cy=${cy}&radius=${radius}`;
		const response = await fetch(url, { credentials: 'same-origin' });
		if (!response.ok || worldId !== (this._chunkWorldId || worldId)) return;
		const data = await response.json();
		const chunks = data.chunks || [];
		this._absorbChunks(chunks, true);
		writeCachedChunks(worldId, chunks).catch(() => { /* Cache writes are optional. */ });
	} catch { /* Network errors retry after the next viewport change. */ }
	finally { this._chunkLoading = false; }
	// Keep widening the prefetch window while the player stays in place.
	if (radius < MAX_RADIUS) this._scheduleChunkLoad();
};
