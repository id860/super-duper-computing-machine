// Pure helpers for the viewport chunk loader.
//
// The old loader walked Chebyshev rings around the centre chunk with a hard
// radius of 2, which covered only 5×5 chunks (430×430 cells). Zoomed out, the
// player sees far more than that, so most of the screen stayed empty and every
// ring cost another round trip. The helpers below describe exactly which
// chunks the viewport touches and group the missing ones into as few requests
// as the server allows, ordered from the centre of the screen outwards.

export function chunkKey(cx, cy) {
	return cx + ':' + cy;
}

export function parseChunkKey(key) {
	const i = String(key).indexOf(':');
	if (i < 0) return null;
	const x = Number(String(key).slice(0, i)), y = Number(String(key).slice(i + 1));
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x, y };
}

// Chunk that holds the centre of the current viewport.
export function centerChunk(view, size) {
	const { offsetX, offsetY, scale, viewW, viewH } = view;
	if (!scale || !size) return { cx: 0, cy: 0 };
	const wx = (viewW / 2 - offsetX) / scale;
	const wy = (viewH / 2 - offsetY) / scale;
	return { cx: Math.max(0, Math.floor(wx / size)), cy: Math.max(0, Math.floor(wy / size)) };
}

// Inclusive chunk rectangle covered by the viewport, plus an optional margin of
// extra chunks so a small pan does not immediately expose empty space.
export function viewportChunkRange(view, size, margin = 1) {
	const { offsetX, offsetY, scale, viewW, viewH } = view;
	if (!scale || !size || !viewW || !viewH) return { x0: 0, y0: 0, x1: 0, y1: 0 };
	const span = size * scale;
	const x0 = Math.floor(-offsetX / span) - margin;
	const y0 = Math.floor(-offsetY / span) - margin;
	const x1 = Math.floor((viewW - offsetX) / span) + margin;
	const y1 = Math.floor((viewH - offsetY) / span) + margin;
	return { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.max(0, x1), y1: Math.max(0, y1) };
}

export function rangeKeys(range) {
	const keys = [];
	for (let y = range.y0; y <= range.y1; y++) for (let x = range.x0; x <= range.x1; x++) keys.push(chunkKey(x, y));
	return keys;
}

export function rangeSize(range) {
	return Math.max(0, range.x1 - range.x0 + 1) * Math.max(0, range.y1 - range.y0 + 1);
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

// Groups the chunks the viewport needs into server requests of at most
// (2 * maxRadius + 1)² chunks. Blocks are aligned to a fixed grid so panning
// reuses the same request centres, and they are returned nearest-first so the
// area under the cursor is filled before the edges of the screen.
export function planRequests(range, loaded, center, maxRadius = 2) {
	const radius = Math.max(0, Math.trunc(maxRadius));
	const step = radius * 2 + 1;
	const has = (key) => !!(loaded && loaded.has && loaded.has(key));
	const plans = [];
	const bx0 = Math.floor(range.x0 / step), bx1 = Math.floor(range.x1 / step);
	const by0 = Math.floor(range.y0 / step), by1 = Math.floor(range.y1 / step);
	for (let by = by0; by <= by1; by++) {
		for (let bx = bx0; bx <= bx1; bx++) {
			const cx = bx * step + radius, cy = by * step + radius;
			const missing = [];
			for (let y = Math.max(range.y0, cy - radius); y <= Math.min(range.y1, cy + radius); y++) {
				for (let x = Math.max(range.x0, cx - radius); x <= Math.min(range.x1, cx + radius); x++) {
					const key = chunkKey(x, y);
					if (!has(key)) missing.push(key);
				}
			}
			if (!missing.length) continue;
			const dx = cx - (center?.cx ?? cx), dy = cy - (center?.cy ?? cy);
			plans.push({ cx, cy, radius, keys: missing, distance: Math.max(Math.abs(dx), Math.abs(dy)) });
		}
	}
	return plans.sort((a, b) => a.distance - b.distance);
}
