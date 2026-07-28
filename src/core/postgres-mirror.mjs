import { CHUNK_SIZE } from '../http/chunks.mjs';
const keyFor = (x, y) => `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}`;

export function groupPixelsByChunk(pixels) {
	const groups = new Map();
	for (const entry of pixels || []) {
		const x = Number(entry?.[0]), y = Number(entry?.[1]);
		if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
		const key = keyFor(x, y);
		let group = groups.get(key);
		if (!group) groups.set(key, (group = []));
		group.push([x, y, entry[2]]);
	}
	return groups;
}

export function applyChunkPixels(cells, pixels, background) {
	const next = { ...(cells || {}) };
	for (const [x, y, color] of pixels || []) {
		const key = `${x}:${y}`;
		if (color === background) delete next[key];
		else next[key] = { c: color };
	}
	return next;
}

export async function createPostgresMirror(connectionString) {
	if (!connectionString) return null;
	const { Pool } = await import('pg');
	const pool = new Pool({ connectionString, max: Number(process.env.POSTGRES_POOL_SIZE || 4) });
	await pool.query('SELECT 1');
	let chain = Promise.resolve(), bootstrapped = false;
	const enqueue = (task) => { chain = chain.then(task, task); return chain; };

	async function bootstrap(db) {
		return enqueue(async () => {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				for (const world of Object.values(db.worlds || {})) {
					const payload = { ...world, pixels: undefined, pixelHistory: undefined };
					await client.query('INSERT INTO worlds (id, payload, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()', [world.id, JSON.stringify(payload)]);
					const buckets = new Map();
					for (const [cellKey, cell] of Object.entries(world.pixels || {})) {
						const i = cellKey.indexOf(':'), x = Number(cellKey.slice(0, i)), y = Number(cellKey.slice(i + 1)), key = keyFor(x, y);
						let cells = buckets.get(key); if (!cells) buckets.set(key, (cells = {})); cells[cellKey] = cell;
					}
					await client.query('DELETE FROM world_chunks WHERE world_id = $1', [world.id]);
					for (const [key, cells] of buckets) {
						const [x, y] = key.split(':').map(Number);
						await client.query('INSERT INTO world_chunks (world_id, chunk_x, chunk_y, cells, revision) VALUES ($1, $2, $3, $4::jsonb, $5)', [world.id, x, y, JSON.stringify(cells), Date.now()]);
					}
				}
				await client.query('COMMIT'); bootstrapped = true;
			} catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
			finally { client.release(); }
		});
	}

	async function write(db) {
		if (!bootstrapped) return bootstrap(db);
		return enqueue(async () => {
			for (const world of Object.values(db.worlds || {})) {
				const payload = { ...world, pixels: undefined, pixelHistory: undefined };
				await pool.query('INSERT INTO worlds (id, payload, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()', [world.id, JSON.stringify(payload)]);
			}
		});
	}

	async function writePixels(worldId, pixels, background) {
		const groups = groupPixelsByChunk(pixels);
		if (!groups.size) return;
		return enqueue(async () => {
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				for (const [key, changes] of groups) {
					const [chunkX, chunkY] = key.split(':').map(Number);
					const { rows } = await client.query('SELECT cells FROM world_chunks WHERE world_id = $1 AND chunk_x = $2 AND chunk_y = $3 FOR UPDATE', [worldId, chunkX, chunkY]);
					const cells = applyChunkPixels(rows[0]?.cells, changes, background);
					if (!Object.keys(cells).length) await client.query('DELETE FROM world_chunks WHERE world_id = $1 AND chunk_x = $2 AND chunk_y = $3', [worldId, chunkX, chunkY]);
					else await client.query('INSERT INTO world_chunks (world_id, chunk_x, chunk_y, cells, revision) VALUES ($1, $2, $3, $4::jsonb, 1) ON CONFLICT (world_id, chunk_x, chunk_y) DO UPDATE SET cells = EXCLUDED.cells, revision = world_chunks.revision + 1', [worldId, chunkX, chunkY, JSON.stringify(cells)]);
				}
				await client.query('COMMIT');
			} catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
			finally { client.release(); }
		});
	}

	async function readChunks(worldId, minX, maxX, minY, maxY) {
		const { rows } = await pool.query('SELECT chunk_x, chunk_y, cells FROM world_chunks WHERE world_id = $1 AND chunk_x BETWEEN $2 AND $3 AND chunk_y BETWEEN $4 AND $5', [worldId, minX, maxX, minY, maxY]);
		const out = new Map();
		for (const row of rows) out.set(`${row.chunk_x}:${row.chunk_y}`, Object.entries(row.cells || {}).map(([key, cell]) => { const i = key.indexOf(':'); return [Number(key.slice(0, i)), Number(key.slice(i + 1)), cell.c]; }));
		return out;
	}

	return { bootstrap, write, writePixels, readChunks, async close() { await chain.catch(() => {}); await pool.end(); } };
}
