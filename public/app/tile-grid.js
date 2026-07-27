// Pure geometry helpers for the offscreen tile renderer.
// A tile is a square block of world cells that is rasterised once into its own
// canvas and then blitted per frame, so panning and zooming no longer walk the
// whole pixel map on every frame.

export const TILE_SIZE = 64;

export function tileKeyFor(x, y, size = TILE_SIZE) {
	return Math.floor(x / size) + ':' + Math.floor(y / size);
}

// Offset of a world cell inside its own tile. Works for negative coordinates.
export function tileOffset(value, size = TILE_SIZE) {
	return ((value % size) + size) % size;
}

// Tiles touched by the current viewport, ordered from the centre outwards so
// that the first rasterised tiles are the ones the player is looking at.
export function visibleTileKeys(view, size = TILE_SIZE) {
	const { offsetX, offsetY, scale, viewW, viewH } = view;
	if (!scale || !viewW || !viewH) return [];
	const span = size * scale;
	const tx0 = Math.floor(-offsetX / span);
	const ty0 = Math.floor(-offsetY / span);
	const tx1 = Math.floor((viewW - offsetX) / span);
	const ty1 = Math.floor((viewH - offsetY) / span);
	const cx = (tx0 + tx1) / 2, cy = (ty0 + ty1) / 2;
	const keys = [];
	for (let ty = ty0; ty <= ty1; ty++) {
		for (let tx = tx0; tx <= tx1; tx++) keys.push({ key: tx + ':' + ty, d: Math.abs(tx - cx) + Math.abs(ty - cy) });
	}
	return keys.sort((a, b) => a.d - b.d).map((entry) => entry.key);
}

export function parseTileKey(key) {
	const i = String(key).indexOf(':');
	if (i < 0) return null;
	const tx = Number(key.slice(0, i)), ty = Number(key.slice(i + 1));
	if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
	return { tx, ty };
}

// Least recently drawn tiles above the cache limit, never dropping tiles that
// are still on screen.
export function selectStaleTiles(stamps, keep, limit) {
	if (stamps.size <= limit) return [];
	const candidates = [...stamps.entries()]
		.filter(([key]) => !keep.has(key))
		.sort((a, b) => a[1] - b[1]);
	const dropped = [];
	let excess = stamps.size - limit;
	for (const [key] of candidates) {
		if (excess <= 0) break;
		dropped.push(key);
		excess -= 1;
	}
	return dropped;
}
