// Persistent chunk cache. Revisiting an area paints from local storage on the
// first frame and the network response only corrects it, so navigation feels
// instant even on a slow connection. Every entry is best effort: when
// IndexedDB is unavailable (private mode, Node tests) the helpers degrade to
// no-ops instead of breaking drawing.

const DB_NAME = 'pixelfront';
const STORE = 'chunks';
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let connection = null;

export function recordKey(worldId, key) {
	return worldId + '/' + key;
}

export function isFresh(record, now = Date.now(), ttl = CACHE_TTL_MS) {
	if (!record || !Array.isArray(record.cells)) return false;
	if (!Number.isFinite(record.at)) return false;
	return now - record.at <= ttl;
}

function open() {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	if (connection) return connection;
	connection = new Promise((resolve) => {
		let request;
		try { request = indexedDB.open(DB_NAME, 1); } catch { resolve(null); return; }
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => resolve(null);
		request.onblocked = () => resolve(null);
	});
	return connection;
}

function request(store, key) {
	return new Promise((resolve) => {
		const op = store.get(key);
		op.onsuccess = () => resolve(op.result || null);
		op.onerror = () => resolve(null);
	});
}

// Returns chunks in the { x, y, cells } shape used by the HTTP API.
export async function readCachedChunks(worldId, keys) {
	const db = await open();
	if (!db || !keys.length) return [];
	try {
		const tx = db.transaction(STORE, 'readonly');
		const store = tx.objectStore(STORE);
		const now = Date.now();
		const found = [];
		for (const key of keys) {
			const record = await request(store, recordKey(worldId, key));
			if (!isFresh(record, now)) continue;
			const i = key.indexOf(':');
			found.push({ x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)), cells: record.cells });
		}
		return found;
	} catch { return []; }
}

export async function writeCachedChunks(worldId, chunks) {
	const db = await open();
	if (!db || !chunks.length) return 0;
	try {
		const tx = db.transaction(STORE, 'readwrite');
		const store = tx.objectStore(STORE);
		const at = Date.now();
		let written = 0;
		for (const chunk of chunks) {
			store.put({ cells: chunk.cells || [], at }, recordKey(worldId, chunk.x + ':' + chunk.y));
			written += 1;
		}
		return written;
	} catch { return 0; }
}
