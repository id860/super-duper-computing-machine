import { tileKeyFor } from './tile-grid.js';

export function buildTilePixelIndex(pixels) {
	const index = new Map();
	for (const [pixelKey, cell] of pixels || []) {
		const i = pixelKey.indexOf(':');
		const x = Number(pixelKey.slice(0, i)), y = Number(pixelKey.slice(i + 1));
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		const tileKey = tileKeyFor(x, y);
		let bucket = index.get(tileKey);
		if (!bucket) index.set(tileKey, (bucket = new Map()));
		bucket.set(pixelKey, cell);
	}
	return index;
}

// Synchronise only coordinates touched by an operation after the engine has
// updated its canonical pixel map. Empty buckets are removed immediately.
export function syncTilePixelIndex(index, pixels, list) {
	const touched = new Set();
	for (const entry of list || []) {
		const x = Number(entry?.[0]), y = Number(entry?.[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		const pixelKey = `${x}:${y}`, tileKey = tileKeyFor(x, y);
		let bucket = index.get(tileKey);
		const cell = pixels.get(pixelKey);
		if (cell) {
			if (!bucket) index.set(tileKey, (bucket = new Map()));
			bucket.set(pixelKey, cell);
		} else if (bucket) {
			bucket.delete(pixelKey);
			if (!bucket.size) index.delete(tileKey);
		}
		touched.add(tileKey);
	}
	return touched;
}
