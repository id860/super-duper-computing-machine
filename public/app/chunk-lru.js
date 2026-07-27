// Small dependency-free LRU used by the browser viewport chunk loader.
export function touchChunk(cache, key, stamp = Date.now(), limit = 81) {
	cache.set(key, stamp);
	if (cache.size <= limit) return [];
	const evicted = [...cache.entries()].sort((a, b) => a[1] - b[1]).slice(0, cache.size - limit).map(([chunk]) => chunk);
	for (const chunk of evicted) cache.delete(chunk);
	return evicted;
}

// Drops the pixel data of an evicted chunk so memory stays bounded while panning.
// Cells written recently (optimistic paint or live SSE) are kept: `freshBefore` is
// the timestamp below which a cell is considered safe to discard.
export function evictChunkPixels(pixels, key, size, freshBefore = 0) {
	if (!pixels || !size) return 0;
	const split = key.indexOf(':');
	const cx = Number(key.slice(0, split)), cy = Number(key.slice(split + 1));
	if (!Number.isFinite(cx) || !Number.isFinite(cy)) return 0;
	const minX = cx * size, minY = cy * size, maxX = minX + size, maxY = minY + size;
	let removed = 0;
	for (const [pixelKey, cell] of pixels) {
		const at = pixelKey.indexOf(':');
		const x = Number(pixelKey.slice(0, at)), y = Number(pixelKey.slice(at + 1));
		if (x < minX || x >= maxX || y < minY || y >= maxY) continue;
		if (cell && cell.at && cell.at > freshBefore) continue;
		pixels.delete(pixelKey);
		removed += 1;
	}
	return removed;
}
