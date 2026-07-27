// Export the active JSON database into the PostgreSQL world_chunks schema.
// Usage: DATA_FILE=./data/db.json node scripts/export-postgres.mjs > import.sql
// The chunk size mirrors the runtime fine-chunk size so exported rows line up with live reads.
import { readFile } from 'node:fs/promises';

export const CHUNK_SIZE = Number(process.env.EXPORT_CHUNK_SIZE || 86);
const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const chunkKey = (x, y) => `${Math.floor(x / CHUNK_SIZE)}:${Math.floor(y / CHUNK_SIZE)}`;

export function worldChunkRows(db) {
	const rows = [];
	for (const world of Object.values(db.worlds || {})) {
		const chunks = new Map();
		for (const [key, cell] of Object.entries(world.pixels || {})) {
			const split = key.indexOf(':');
			const x = Number(key.slice(0, split)), y = Number(key.slice(split + 1));
			if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
			const ck = chunkKey(x, y); if (!chunks.has(ck)) chunks.set(ck, {});
			chunks.get(ck)[key] = cell;
		}
		const { pixels, ...payload } = world;
		rows.push({ kind: 'world', id: world.id, payload });
		for (const [key, cells] of chunks) {
			const [chunkX, chunkY] = key.split(':').map(Number);
			rows.push({ kind: 'chunk', worldId: world.id, chunkX, chunkY, cells });
		}
	}
	return rows;
}

export function toSql(db) {
	const lines = ['BEGIN;'];
	for (const row of worldChunkRows(db)) {
		if (row.kind === 'world') lines.push(`INSERT INTO worlds (id, payload) VALUES (${quote(row.id)}, ${quote(JSON.stringify(row.payload))}::jsonb) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();`);
		else lines.push(`INSERT INTO world_chunks (world_id, chunk_x, chunk_y, cells) VALUES (${quote(row.worldId)}, ${row.chunkX}, ${row.chunkY}, ${quote(JSON.stringify(row.cells))}::jsonb) ON CONFLICT (world_id, chunk_x, chunk_y) DO UPDATE SET cells = EXCLUDED.cells, revision = world_chunks.revision + 1, updated_at = now();`);
	}
	lines.push('COMMIT;');
	return lines.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const file = process.env.DATA_FILE || './data/db.json';
	const db = JSON.parse(await readFile(file, 'utf8'));
	process.stdout.write(toSql(db));
}
