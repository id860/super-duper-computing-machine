// Read-only viewport/chunk endpoint with an in-memory spatial index.
import { isVisible } from '../core/rules.mjs';
import { ok } from './kit.mjs';

export const CHUNK_SIZE = 256;
const MAX_RADIUS = 2;
const toInt = (value, fallback, min, max) => {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};
const pixelKey = (x, y) => `${x}:${y}`;
const chunkKey = (x, y) => `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}`;

/** Keeps a per-world Map<chunk, Map<pixel, cell>> next to the JSON source. */
export class ChunkIndex {
	constructor(db) { this.db = db; this.worlds = new Map(); }
	ensure(world) {
		let chunks = this.worlds.get(world.id);
		if (chunks) return chunks;
		chunks = new Map();
		for (const [key, cell] of Object.entries(world.pixels)) {
			const split = key.indexOf(':'); const x = Number(key.slice(0, split)), y = Number(key.slice(split + 1));
			const ck = chunkKey(x, y); let bucket = chunks.get(ck);
			if (!bucket) chunks.set(ck, (bucket = new Map()));
			bucket.set(key, { x, y, c: cell.c });
		}
		this.worlds.set(world.id, chunks);
		return chunks;
	}
	applyPixels(worldId, pixels) {
		const world = this.db.worlds[worldId];
		if (!world || !Array.isArray(pixels) || !this.worlds.has(worldId)) return;
		const chunks = this.worlds.get(worldId);
		for (const [x, y, color] of pixels) {
			if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
			const ck = chunkKey(x, y); let bucket = chunks.get(ck);
			if (!bucket) chunks.set(ck, (bucket = new Map()));
			const key = pixelKey(x, y);
			if (color === world.background) { bucket.delete(key); if (!bucket.size) chunks.delete(ck); }
			else bucket.set(key, { x, y, c: color });
		}
	}
	invalidate(worldId) { this.worlds.delete(worldId); }
}

export async function handleChunkRequest(req, res, ctx, db, index) {
	if (req.method !== 'GET') return false;
	const url = new URL(req.url, 'http://localhost');
	const match = /^\/api\/worlds\/([^/]+)\/chunks$/.exec(url.pathname);
	if (!match) return false;
	const world = db.worlds[decodeURIComponent(match[1])];
	if (!world) throw Object.assign(new Error('Мир не найден'), { status: 404 });
	if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });
	const maxX = Math.ceil((world.infinite ? 100000 : world.width) / CHUNK_SIZE) - 1;
	const maxY = Math.ceil((world.infinite ? 100000 : world.height) / CHUNK_SIZE) - 1;
	const cx = toInt(url.searchParams.get('cx'), 0, 0, maxX), cy = toInt(url.searchParams.get('cy'), 0, 0, maxY);
	const radius = toInt(url.searchParams.get('radius'), 1, 0, MAX_RADIUS), chunks = index.ensure(world);
	const list = [];
	for (let y = Math.max(0, cy - radius); y <= Math.min(maxY, cy + radius); y++) {
		for (let x = Math.max(0, cx - radius); x <= Math.min(maxX, cx + radius); x++) {
			const bucket = chunks.get(`${x}:${y}`);
			list.push({ x, y, cells: bucket ? [...bucket.values()].map((p) => [p.x, p.y, p.c]) : [] });
		}
	}
	ok(res, { chunkSize: CHUNK_SIZE, center: { x: cx, y: cy }, radius, chunks: list, at: Date.now() });
	return true;
}
