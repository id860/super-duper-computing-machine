// Read-only viewport/chunk endpoint for large worlds.
import { isVisible } from '../core/rules.mjs';
import { ok } from './kit.mjs';

export const CHUNK_SIZE = 256;
const MAX_RADIUS = 2;

const toInt = (value, fallback, min, max) => {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * Handles GET /api/worlds/:id/chunks?cx=&cy=&radius=.
 * A response always has a fixed logical grid, while only non-empty chunk
 * payloads contain cells. This lets clients cache empty chunks too.
 */
export async function handleChunkRequest(req, res, ctx, db) {
	if (req.method !== 'GET') return false;
	const url = new URL(req.url, 'http://localhost');
	const match = /^\/api\/worlds\/([^/]+)\/chunks$/.exec(url.pathname);
	if (!match) return false;
	const world = db.worlds[decodeURIComponent(match[1])];
	if (!world) throw Object.assign(new Error('Мир не найден'), { status: 404 });
	if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });

	const maxChunkX = Math.ceil((world.infinite ? 100000 : world.width) / CHUNK_SIZE) - 1;
	const maxChunkY = Math.ceil((world.infinite ? 100000 : world.height) / CHUNK_SIZE) - 1;
	const cx = toInt(url.searchParams.get('cx'), 0, 0, maxChunkX);
	const cy = toInt(url.searchParams.get('cy'), 0, 0, maxChunkY);
	const radius = toInt(url.searchParams.get('radius'), 1, 0, MAX_RADIUS);
	const fromX = Math.max(0, cx - radius), toX = Math.min(maxChunkX, cx + radius);
	const fromY = Math.max(0, cy - radius), toY = Math.min(maxChunkY, cy + radius);
	const buckets = new Map();
	for (let y = fromY; y <= toY; y++) for (let x = fromX; x <= toX; x++) buckets.set(`${x}:${y}`, []);
	for (const [key, cell] of Object.entries(world.pixels)) {
		const split = key.indexOf(':');
		const x = Number(key.slice(0, split)), y = Number(key.slice(split + 1));
		const chunkKey = `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}`;
		const bucket = buckets.get(chunkKey);
		if (bucket) bucket.push([x, y, cell.c]);
	}
	const chunks = [];
	for (const [key, cells] of buckets) {
		const [x, y] = key.split(':').map(Number);
		chunks.push({ x, y, cells });
	}
	ok(res, { chunkSize: CHUNK_SIZE, center: { x: cx, y: cy }, radius, chunks, at: Date.now() });
	return true;
}
