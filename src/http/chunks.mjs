import { isVisible } from '../core/rules.mjs'; import { ok } from './kit.mjs';
export const CHUNK_SIZE = 86; const MAX_RADIUS = 3;
export const chunkReadMode = () => process.env.CHUNK_READ_MODE || 'auto';
export const usePostgresChunks = (postgres) => !!postgres && chunkReadMode() !== 'json';
const toInt = (value, fallback, min, max) => { const n = Math.trunc(Number(value)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }; const pixelKey = (x, y) => `${x}:${y}`; const chunkKey = (x, y) => `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}`;
export class ChunkIndex {
	constructor(db) { this.db = db; this.worlds = new Map(); this.worldRevisions = new Map(); }
	ensure(world) {
		let chunks = this.worlds.get(world.id); if (chunks) return chunks;
		chunks = new Map(); let revision = 0;
		for (const [key, cell] of Object.entries(world.pixels)) { const split = key.indexOf(':'); const x = Number(key.slice(0, split)), y = Number(key.slice(split + 1)), ck = chunkKey(x, y); let bucket = chunks.get(ck); if (!bucket) chunks.set(ck, (bucket = new Map())); bucket.set(key, { x, y, c: cell.c }); revision = Math.max(revision, Number(cell.at || 0)); }
		this.worlds.set(world.id, chunks); this.worldRevisions.set(world.id, revision); return chunks;
	}
	applyPixels(worldId, pixels) {
		const world = this.db.worlds[worldId]; if (!world || !Array.isArray(pixels) || !this.worlds.has(worldId)) return;
		const chunks = this.worlds.get(worldId);
		for (const [x, y, color] of pixels) { if (!Number.isInteger(x) || !Number.isInteger(y)) continue; const ck = chunkKey(x, y); let bucket = chunks.get(ck); if (!bucket) chunks.set(ck, (bucket = new Map())); const key = pixelKey(x, y); if (color === world.background) { bucket.delete(key); if (!bucket.size) chunks.delete(ck); } else bucket.set(key, { x, y, c: color }); }
		this.worldRevisions.set(worldId, Math.max(Date.now(), (this.worldRevisions.get(worldId) || 0) + 1));
	}
	revision(worldId) { return this.worldRevisions.get(worldId) || 0; }
	invalidate(worldId) { this.worlds.delete(worldId); this.worldRevisions.delete(worldId); }
}
export async function handleChunkRequest(req, res, ctx, db, index, postgres = null) {
	if (req.method !== 'GET') return false; const url = new URL(req.url, 'http://localhost'); const match = /^\/api\/worlds\/([^/]+)\/chunks$/.exec(url.pathname); if (!match) return false;
	const world = db.worlds[decodeURIComponent(match[1])]; if (!world) throw Object.assign(new Error('Мир не найден'), { status: 404 }); if (!isVisible(world, ctx.user, ctx.session)) throw Object.assign(new Error('Мир недоступен'), { status: 403 });
	const maxX = Math.ceil((world.infinite ? 100000 : world.width) / CHUNK_SIZE) - 1, maxY = Math.ceil((world.infinite ? 100000 : world.height) / CHUNK_SIZE) - 1, cx = toInt(url.searchParams.get('cx'), 0, 0, maxX), cy = toInt(url.searchParams.get('cy'), 0, 0, maxY), radius = toInt(url.searchParams.get('radius'), 0, 0, MAX_RADIUS), minX = Math.max(0, cx - radius), minY = Math.max(0, cy - radius), toX = Math.min(maxX, cx + radius), toY = Math.min(maxY, cy + radius);
	let pg = null; if (usePostgresChunks(postgres)) { try { pg = await postgres.readChunks(world.id, minX, toX, minY, toY); } catch (error) { console.error('PostgreSQL chunk read fallback:', error.message); } }
	const chunks = index.ensure(world), list = []; for (let y = minY; y <= toY; y++) for (let x = minX; x <= toX; x++) { const key = `${x}:${y}`, bucket = chunks.get(key); list.push({ x, y, cells: pg?.has(key) ? pg.get(key) : bucket ? [...bucket.values()].map((p) => [p.x, p.y, p.c]) : [] }); }
	ok(res, { chunkSize: CHUNK_SIZE, center: { x: cx, y: cy }, radius, revision: index.revision(world.id), storage: pg ? 'postgres' : 'json', chunks: list, at: Date.now() }); return true;
}
