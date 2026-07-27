// LRU bookkeeping for the viewport loader installed by interaction-patch.js.
import { PixelEngine } from './engine.js';

const MAX_TRACKED_CHUNKS = 81; // 9 × 9: enough for viewport, prefetch and one return trip.
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
	const stamp = Date.now();
	for (const key of this._loadedChunks) {
		if (!before.has(key) || !this._chunkAccess.has(key)) this._chunkAccess.set(key, stamp);
	}
	if (this._chunkAccess.size <= MAX_TRACKED_CHUNKS) return;
	const oldest = [...this._chunkAccess.entries()].sort((a, b) => a[1] - b[1]);
	for (const [key] of oldest.slice(0, this._chunkAccess.size - MAX_TRACKED_CHUNKS)) {
		this._chunkAccess.delete(key);
		this._loadedChunks.delete(key);
	}
};
