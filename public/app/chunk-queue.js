// Pure helpers for the progressive chunk loader.
// The viewport centre is fetched first, then each surrounding ring, so the
// player sees their own surroundings immediately instead of waiting for one
// large square response.

export function chunkKey(cx, cy) {
	return cx + ':' + cy;
}

// Chunk that holds the centre of the current viewport.
export function centerChunk(view, size) {
	const { offsetX, offsetY, scale, viewW, viewH } = view;
	if (!scale || !size) return { cx: 0, cy: 0 };
	const wx = (viewW / 2 - offsetX) / scale;
	const wy = (viewH / 2 - offsetY) / scale;
	return { cx: Math.max(0, Math.floor(wx / size)), cy: Math.max(0, Math.floor(wy / size)) };
}

// Keys of the square ring at the given Chebyshev distance, clamped to the
// positive quadrant that the server addresses.
export function ringKeys(cx, cy, radius) {
	const keys = [];
	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
			const x = cx + dx, y = cy + dy;
			if (x < 0 || y < 0) continue;
			keys.push(chunkKey(x, y));
		}
	}
	return keys;
}

// Smallest radius that still has an unloaded chunk, or -1 when the whole
// prefetch window is already in memory.
export function missingRadius(cx, cy, loaded, maxRadius) {
	for (let radius = 0; radius <= maxRadius; radius++) {
		const keys = ringKeys(cx, cy, radius);
		if (keys.some((key) => !loaded.has(key))) return radius;
	}
	return -1;
}
