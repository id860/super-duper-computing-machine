// Small dependency-free LRU used by the browser viewport chunk loader.
export function touchChunk(cache, key, stamp = Date.now(), limit = 81) {
	cache.set(key, stamp);
	if (cache.size <= limit) return [];
	const evicted = [...cache.entries()].sort((a, b) => a[1] - b[1]).slice(0, cache.size - limit).map(([chunk]) => chunk);
	for (const chunk of evicted) cache.delete(chunk);
	return evicted;
}
