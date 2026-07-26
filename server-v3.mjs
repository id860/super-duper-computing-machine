// PixelFront Worlds — точка входа v3.
// Автономная платформа пиксельных миров: один официальный мир + миры сообщества.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Store } from './src/core/db.mjs';
import { createUser, officialWorld } from './src/core/model.mjs';
import { hashPassword, now } from './src/core/util.mjs';
import { runAutomation } from './src/core/automation.mjs';
import { createSse } from './src/http/sse.mjs';
import { createApi } from './src/http/api.mjs';
import {
	checkCsrf,
	fail,
	getSession,
	isHttps,
	securityHeaders,
	serveStatic
} from './src/http/kit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data');
const PUBLIC_DIR = join(__dirname, 'public');
const APP_ORIGIN = process.env.APP_ORIGIN || '';
const AUTOMATION_INTERVAL_MS = Number(process.env.AUTOMATION_INTERVAL_MS || 60000);

async function bootstrap() {
	const store = new Store(DATA_DIR);
	await store.load();
	const db = store.db;

	// Гарантируем официальный мир.
	if (!db.worlds.official) {
		db.worlds.official = officialWorld();
		db.chats.official = db.chats.official || [];
		store.schedule(0);
	}

	// Бутстрап администратора из окружения.
	const adminNick = process.env.ADMIN_NICK;
	const adminPassword = process.env.ADMIN_PASSWORD;
	if (adminNick && adminPassword) {
		if (adminPassword.length < 12 || adminPassword.length > 128) {
			console.warn('ADMIN_PASSWORD должен быть 12..128 символов, админ не создан.');
		} else {
			let admin = Object.values(db.users).find((u) => u.nick.toLowerCase() === adminNick.toLowerCase());
			if (!admin) {
				admin = createUser({ nick: adminNick, password: hashPassword(adminPassword), role: 'admin', verified: true });
				db.users[admin.id] = admin;
				console.log(`Создан администратор: ${adminNick}`);
			} else {
				admin.role = 'admin';
				admin.password = hashPassword(adminPassword);
			}
			store.schedule(0);
		}
	}

	const sse = createSse();
	const notify = (userId, message) => {
		const user = db.users[userId];
		if (!user) return;
		(user.notifications ||= []).push({ id: `ntf_${now()}`, message, at: now(), read: false });
		if (user.notifications.length > 50) user.notifications.splice(0, user.notifications.length - 50);
	};
	const api = createApi({ store, sse, notify });

	// Фоновая автоматизация: события, сезоны, жизненный цикл, античит, очистка.
	const tick = () => {
		try {
			const result = runAutomation(db, {
				emit: (worldId, event, data) => sse.broadcast(worldId, event, data),
				notify
			});
			if (result?.changed) store.schedule(0);
		} catch (error) {
			console.error('automation tick failed:', error);
		}
	};
	tick();
	const automationTimer = setInterval(tick, AUTOMATION_INTERVAL_MS);
	automationTimer.unref?.();

	const server = createServer(async (req, res) => {
		const https = isHttps(req);
		securityHeaders(res, { https });
		try {
			if (req.url.startsWith('/api/')) {
				const sessionInfo = getSession(db, req);
				const ctx = {
					req,
					https,
					ip: (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'local').trim(),
					sid: sessionInfo?.sid || null,
					session: sessionInfo?.session || null,
					user: sessionInfo?.user || null
				};
				checkCsrf(req, ctx, APP_ORIGIN);
				const handled = await api.dispatch(req, res, ctx);
				if (!handled) fail(res, Object.assign(new Error('Метод не найден'), { status: 404 }));
				return;
			}
			if (req.method !== 'GET' && req.method !== 'HEAD') {
				fail(res, Object.assign(new Error('Метод не поддерживается'), { status: 405 }));
				return;
			}
			await serveStatic(req, res, PUBLIC_DIR);
		} catch (error) {
			fail(res, error);
		}
	});

	server.listen(PORT, () => console.log(`PixelFront Worlds v3 → http://localhost:${PORT}`));

	const shutdown = async (signal) => {
		console.log(`\n${signal}: завершение...`);
		clearInterval(automationTimer);
		sse.close();
		server.close();
		try {
			await store.flush();
		} catch (error) {
			console.error(error);
		}
		process.exit(0);
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
	console.error('Фатальная ошибка запуска:', error);
	process.exit(1);
});
