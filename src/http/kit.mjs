// HTTP-примитивы: валидация, сессии, CSRF, заголовки безопасности, статика.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { HttpError, now, safeEqual, token } from '../core/util.mjs';

const BODY_LIMIT = Number(process.env.BODY_LIMIT || 262144);
const SESSION_TTL = Number(process.env.SESSION_TTL || 7 * 86400000);

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json'
};

export function securityHeaders(res, { https } = {}) {
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Frame-Options', 'DENY');
	res.setHeader('Referrer-Policy', 'no-referrer');
	res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
	res.setHeader(
		'Content-Security-Policy',
		"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
	);
	if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function send(res, status, body, headers = {}) {
	const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': Buffer.isBuffer(body) ? headers['Content-Type'] || 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
		...headers
	});
	res.end(payload);
}

export const ok = (res, data, headers) => send(res, 200, data ?? { ok: true }, headers);
export const fail = (res, error) => {
	const status = error instanceof HttpError ? error.status : 500;
	if (status >= 500) console.error(error);
	send(res, status, { error: error.message || 'Ошибка сервера' });
};

export function readBody(req) {
	return new Promise((resolve2, reject) => {
		let size = 0;
		const chunks = [];
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > BODY_LIMIT) {
				reject(new HttpError(413, 'Слишком большой запрос'));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve2(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

// Защита от прототипного загрязнения при разборе JSON.
function sanitize(value, depth = 0) {
	if (depth > 12) throw new HttpError(400, 'Слишком глубокий JSON');
	if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
	if (value && typeof value === 'object') {
		const out = {};
		for (const [key, val] of Object.entries(value)) {
			if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
			out[key] = sanitize(val, depth + 1);
		}
		return out;
	}
	return value;
}

export async function readJson(req) {
	const raw = await readBody(req);
	if (!raw) return {};
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new HttpError(400, 'Некорректный JSON');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'Ожидается JSON-объект');
	return sanitize(parsed);
}

export function parseCookies(req) {
	const header = req.headers.cookie;
	const out = {};
	if (!header) return out;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx < 0) continue;
		out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
	}
	return out;
}

export function setCookie(res, name, value, { maxAge, https, httpOnly = true } = {}) {
	const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict'];
	if (httpOnly) parts.push('HttpOnly');
	if (https) parts.push('Secure');
	if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
	const prev = res.getHeader('Set-Cookie');
	const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
	list.push(parts.join('; '));
	res.setHeader('Set-Cookie', list);
}

export function isHttps(req) {
	return req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

// Сессии: sid в HttpOnly cookie + csrf-токен, читаемый клиентом.
export function createSession(db, userId, https) {
	const sid = token(32);
	db.sessions[sid] = { uid: userId, csrf: token(24), until: now() + SESSION_TTL, unlocked: [], createdAt: now() };
	return { sid, session: db.sessions[sid] };
}

export function getSession(db, req) {
	const { sid } = parseCookies(req);
	if (!sid) return null;
	const session = db.sessions[sid];
	if (!session) return null;
	if (session.until <= now()) {
		delete db.sessions[sid];
		return null;
	}
	return { sid, session, user: db.users[session.uid] || null };
}

export function destroySession(db, req) {
	const { sid } = parseCookies(req);
	if (sid) delete db.sessions[sid];
}

// Проверка CSRF для небезопасных методов: Origin + заголовок x-csrf-token.
export function checkCsrf(req, ctx, appOrigin) {
	const method = req.method.toUpperCase();
	if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
	const site = req.headers['sec-fetch-site'];
	if (site && !['same-origin', 'same-site', 'none'].includes(site)) throw new HttpError(403, 'Кросс-сайтовый запрос отклонён');
	const origin = req.headers.origin;
	if (origin) {
		const allowed = appOrigin ? [appOrigin] : ['http://' + req.headers.host, 'https://' + req.headers.host];
		if (!allowed.includes(origin)) throw new HttpError(403, 'Недопустимый Origin');
	}
	if (!ctx?.session) return;
	const provided = req.headers['x-csrf-token'];
	if (!provided || !safeEqual(provided, ctx.session.csrf)) throw new HttpError(403, 'Неверный CSRF-токен');
}

export function requireUser(ctx) {
	if (!ctx?.user) throw new HttpError(401, 'Требуется вход в аккаунт');
	if (ctx.user.ban && (!ctx.user.ban.until || ctx.user.ban.until > now())) throw new HttpError(403, `Аккаунт заблокирован: ${ctx.user.ban.reason || 'нарушение правил'}`);
	return ctx.user;
}

export function requireStaff(ctx, role = 'moderator') {
	const user = requireUser(ctx);
	if (user.role === 'admin') return user;
	if (role === 'moderator' && user.role === 'moderator') return user;
	throw new HttpError(403, 'Недостаточно прав');
}

// Статика с защитой от path traversal.
export async function serveStatic(req, res, publicDir) {
	const root = resolve(publicDir);
	let pathname;
	try {
		pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
	} catch {
		throw new HttpError(400, 'Некорректный путь');
	}
	if (pathname === '/' || pathname === '') pathname = '/index.html';
	const target = normalize(join(root, pathname));
	if (target !== root && !target.startsWith(root + sep)) throw new HttpError(403, 'Доступ запрещён');
	let info;
	try {
		info = await stat(target);
	} catch {
		// SPA-fallback на index.html
		return serveFile(res, join(root, 'index.html'));
	}
	if (info.isDirectory()) return serveFile(res, join(target, 'index.html'));
	return serveFile(res, target, info);
}

async function serveFile(res, file, info) {
	const stats = info || (await stat(file).catch(() => null));
	if (!stats) throw new HttpError(404, 'Не найдено');
	const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
	res.writeHead(200, {
		'Content-Type': type,
		'Content-Length': stats.size,
		'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600'
	});
	createReadStream(file).pipe(res);
}
