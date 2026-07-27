// LRU bookkeeping for the viewport loader installed by interaction-patch.js.
// Evicted chunks lose both their tracking entry and their pixel data, so long
// panning sessions cannot grow the in-memory pixel map without bound.
import { PixelEngine } from './engine.js';
import { evictChunkPixels, touchChunk } from './chunk-lru.js';

const MAX_TRACKED_CHUNKS = 81; // 9 × 9: viewport, prefetch and one return trip.
const FINE_CHUNK_SIZE = 86;
const FRESH_WINDOW_MS = 60000; // Keep very recent writes even outside the viewport.
const previousSetWorld = PixelEngine.prototype.setWorld;
const previousLoad = PixelEngine.prototype._loadViewportChunks;

PixelEngine.prototype.setWorld = function (...args) {
	previousSetWorld.apply(this, args);
	this._chunkAccess = new Map();
};

PixelEngine.prototype._loadViewportChunks = async function () {
	const before = new Set(this._loadedChunks || []);
	await previousLoad.call(this);
	if (!this._chunkAccess || !this._loadedChunks) return;
	const stamp = Date.now(), freshBefore = stamp - FRESH_WINDOW_MS;
	let dropped = 0;
	for (const key of this._loadedChunks) {
		if (before.has(key) && this._chunkAccess.has(key)) continue;
		for (const oldKey of touchChunk(this._chunkAccess, key, stamp, MAX_TRACKED_CHUNKS)) {
			this._loadedChunks.delete(oldKey);
			dropped += evictChunkPixels(this.pixels, oldKey, FINE_CHUNK_SIZE, freshBefore);
		}
	}
	// Cached render tiles still hold the evicted pixels, so drop them as well.
	if (dropped) {
		if (this.invalidateAllTiles) this.invalidateAllTiles();
		this._miniDirty = true;
		this.draw();
	}
};
