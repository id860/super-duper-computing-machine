// Атомарная JSON-персистентность с опциональными dual-write mirrors.
//
// Структура хранилища (data/):
//   sections/users.json     — аккаунты и прогресс
//   sections/worlds.json    — миры вместе с пикселями
//   sections/sessions.json  — сессии
//   sections/audit.json     — журнал действий
//   sections/<остальные разделы модели>.json
//   db.legacy.json          — старый единый дамп после миграции (только резерв)
//
// В памяти база остаётся единым объектом, поэтому остальной код не меняется,
// но на диске каждый раздел лежит отдельно и перезаписывается только при изменении.
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { freshDb, migrate } from './model.mjs';
import { id, now } from './util.mjs';

export const SECTIONS_DIR = 'sections';
export const LEGACY_FILE = 'db.json';
export const LEGACY_BACKUP = 'db.legacy.json';

const IGNORABLE_SYNC = new Set(['EPERM', 'EINVAL', 'ENOTSUP', 'EISDIR', 'EACCES', 'ENOSYS']);
async function syncQuietly(handle) { try { await handle.sync(); } catch (error) { if (!IGNORABLE_SYNC.has(error.code)) throw error; } }

// Собирает базу из отдельных файлов-разделов.
export async function readSections(dir) {
	if (!existsSync(dir)) return null;
	const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
	if (!files.length) return null;
	const raw = {};
	for (const file of files) {
		const name = file.slice(0, -5);
		try { raw[name] = JSON.parse(await readFile(join(dir, file), 'utf8')); }
		catch (error) { throw new Error(`Не удалось прочитать раздел базы «${name}» (отказ от перезаписи): ${error.message}`); }
	}
	return raw;
}

export class Store {
	constructor(dir = './data') {
		this.dir = resolve(dir);
		this.sectionsDir = join(this.dir, SECTIONS_DIR);
		this.file = join(this.dir, LEGACY_FILE);
		this.db = freshDb();
		this.dirty = false;
		this.timer = null;
		this.chain = Promise.resolve();
		this.auditLimit = Math.max(1000, Number(process.env.AUDIT_LIMIT || 20000));
		this.mirrors = [];
		// Последнее записанное содержимое разделов — чтобы не трогать неизменённые файлы.
		this.written = new Map();
	}

	sectionFile(name) { return join(this.sectionsDir, `${name}.json`); }

	async load() {
		await mkdir(this.sectionsDir, { recursive: true });
		const sections = await readSections(this.sectionsDir);
		if (sections) {
			this.db = migrate(sections);
			this.remember();
			return this.db;
		}
		if (existsSync(this.file)) {
			// Миграция со старого единого дампа: раскладываем по разделам и оставляем резерв.
			try { this.db = migrate(JSON.parse(await readFile(this.file, 'utf8'))); }
			catch (error) { throw new Error(`Не удалось прочитать базу (отказ от перезаписи): ${error.message}`); }
			await this.writeSections(true);
			await rename(this.file, join(this.dir, LEGACY_BACKUP)).catch(() => {});
			return this.db;
		}
		this.db = freshDb();
		await this.writeSections(true);
		return this.db;
	}

	addMirror(mirror) { if (mirror) this.mirrors.push(mirror); }

	remember() { this.written.clear(); for (const [name, value] of Object.entries(this.db)) this.written.set(name, JSON.stringify(value)); }

	schedule(delay = 60) {
		this.dirty = true;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.flush().catch((error) => console.error('DB write failed:', error)), delay);
		this.timer.unref?.();
	}

	async flush() {
		clearTimeout(this.timer);
		this.timer = null;
		if (!this.dirty) return this.chain;
		this.dirty = false;
		this.chain = this.chain.then(async () => {
			await this.writeSections();
			for (const mirror of this.mirrors) await mirror.write(this.db);
		});
		await this.chain;
		if (this.dirty) return this.flush();
		return this.chain;
	}

	// Пишет только те разделы, что изменились: журнал аудита больше не тянет
	// за собой перезапись всех пикселей мира и наоборот.
	async writeSections(force = false) {
		await mkdir(this.sectionsDir, { recursive: true });
		for (const [name, value] of Object.entries(this.db)) {
			const data = JSON.stringify(value);
			if (!force && this.written.get(name) === data) continue;
			await this.write(this.sectionFile(name), data);
			this.written.set(name, data);
		}
		for (const name of [...this.written.keys()]) {
			if (name in this.db) continue;
			await unlink(this.sectionFile(name)).catch(() => {});
			this.written.delete(name);
		}
	}

	// Снимок всей базы одним файлом — для экспорта и резервных копий.
	async exportSnapshot(target = join(this.dir, 'snapshot.json')) {
		await this.write(target, JSON.stringify(this.db));
		return target;
	}

	async write(target, data) {
		const dir = target.slice(0, target.lastIndexOf('/')) || this.dir;
		await mkdir(dir, { recursive: true });
		const tmp = join(dir, `.db-${process.pid}-${randomBytes(6).toString('hex')}.tmp`);
		let handle;
		try {
			handle = await open(tmp, 'wx', 0o600);
			await handle.writeFile(data, 'utf8');
			await syncQuietly(handle);
			await handle.close();
			handle = null;
			await rename(tmp, target);
			try { const dirHandle = await open(dir, 'r'); try { await syncQuietly(dirHandle); } finally { await dirHandle.close(); } }
			catch (error) { if (!IGNORABLE_SYNC.has(error.code)) throw error; }
		} catch (error) {
			if (handle) await handle.close().catch(() => {});
			await unlink(tmp).catch(() => {});
			throw error;
		}
	}

	audit(actor, action, entityType, entityId, metadata = {}) {
		this.db.audit.push({ id: id('aud'), actorId: actor?.id || null, actorNick: actor?.nick || 'system', action, entityType, entityId, metadata, at: now() });
		if (this.db.audit.length > this.auditLimit) this.db.audit.splice(0, this.db.audit.length - this.auditLimit);
		this.schedule();
	}
}
