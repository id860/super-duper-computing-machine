// Общие утилиты платформы PixelFront Worlds.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export class HttpError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

export const now = () => Date.now();
export const id = (prefix) => `${prefix}_${randomBytes(10).toString('hex')}`;
export const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
export const today = (ts = now()) => new Date(ts).toISOString().slice(0, 10);
export const month = (ts = now()) => new Date(ts).toISOString().slice(0, 7);

export const clean = (value, max = 120) =>
	String(value ?? '')
		.replace(/[<>\u0000-\u001f\u007f]/g, '')
		.trim()
		.slice(0, max);

export const clamp = (value, min, max, fallback = min) => {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
};

export const int = (value, min, max, fallback = min) => Math.round(clamp(value, min, max, fallback));

export const bool = (value, fallback = false) => (typeof value === 'boolean' ? value : fallback);

export const pick = (list, value, fallback) => (list.includes(value) ? value : fallback);

export const uniq = (list) => [...new Set(list)];

export const hashPassword = (password, salt = randomBytes(16).toString('hex')) =>
	`${salt}:${scryptSync(password, salt, 64).toString('hex')}`;

export function verifyPassword(password, stored) {
	try {
		const [salt, digest] = String(stored).split(':');
		const a = Buffer.from(digest, 'hex');
		const b = scryptSync(password, salt, 64);
		return a.length === b.length && timingSafeEqual(a, b);
	} catch {
		return false;
	}
}

export function safeEqual(a, b) {
	const x = Buffer.from(String(a || ''));
	const y = Buffer.from(String(b || ''));
	return x.length === y.length && timingSafeEqual(x, y);
}

export const token = (bytes = 32) => randomBytes(bytes).toString('hex');

// Простейший in-memory rate limiter (для продакшена заменить на Redis).
const buckets = new Map();
export function limited(key, windowMs, max) {
	// Рисование — основная интерактивная нагрузка: разрешаем больше вызовов.
	if (key.startsWith('ops:')) max = Math.max(max, 120);
	const t = now();
	let bucket = buckets.get(key);
	if (!bucket || bucket.until <= t) bucket = { hits: 0, until: t + windowMs };
	bucket.hits += 1;
	buckets.set(key, bucket);
	if (buckets.size > 20000) for (const [k, v] of buckets) if (v.until <= t) buckets.delete(k);
	return bucket.hits > max;
}

export function resetLimits() {
	buckets.clear();
}

export const dedupeKey = (...parts) => parts.join(':');

export function hoursToMs(hours) {
	return Math.round(hours * 3600000);
}

export function percent(part, total) {
	return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}
