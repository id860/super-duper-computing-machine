// Маршрутизатор API PixelFront Worlds.
import {
	PALETTE,
	TOOLS,
	PRESETS,
	ACCESS_MODES,
	createUser,
	createWorld
} from '../core/model.mjs';
import {
	HttpError,
	clamp,
	clean,
	hashPassword,
	int,
	limited,
	now,
	pick,
	safeEqual,
	sha,
	today,
	token,
	verifyPassword
} from '../core/util.mjs';
import {
	atLeast,
	bumpHeat,
	canManage,
	canModerate,
	checkProtection,
	ensureMember,
	assertProtectionLimits,
	energyState,
	heatMultiplier,
	isArchived,
	isFrozen,
	isOfficial,
	isVisible,
	moderateMessage,
	toolConfig,
	toolUsage,
	worldRole
} from '../core/rules.mjs';
import {
	awardPixels,
	buyItem,
	claimQuest,
	communityStats,
	dailyState,
	globalStats,
	leaderboard,
	localLeaderboard,
	trackQuest
} from '../core/progress.mjs';
import { makeSnapshot, prioritizeQueue, pushQueue, trackEventProgress } from '../core/automation.mjs';
import {
	checkCsrf,
	createSession,
	destroySession,
	fail,
	getSession,
	isHttps,
	ok,
	readJson,
	requireStaff,
	requireUser,
	setCookie
} from './kit.mjs';

const MIN_WORLD_LEVEL = Number(process.env.MIN_WORLD_LEVEL || 2);
const MIN_ACCOUNT_AGE_MS = Number(process.env.MIN_ACCOUNT_AGE_MS || 0);

export function createApi({ store, sse, notify }) {
	const db = store.db;
	const emit = (worldId, event, data) => sse.broadcast(worldId, event, data);

	function publicWorld(world, user) {
		return {
			id: world.id,
			name: world.name,
			description: world.description,
			icon: world.icon,
			type: world.type,
			preset: world.preset,
			language: world.language,
			tags: world.tags,
			ageRating: world.ageRating,
			ownerId: world.ownerId,
			ownerNick: db.users[world.ownerId]?.nick || null,
			width: world.width,
			height: world.height,
			background: world.background,
			grid: world.grid,
			zoomMin: world.zoomMin,
			zoomMax: world.zoomMax,
			palette: world.palette,
			access: { mode: world.access.mode, hasPassword: !!world.access.passwordHash },
			energy: world.energy,
			tools: world.tools,
			protection: world.protection,
			chat: { ...world.chat, bannedWords: undefined },
			battle: world.battle,
			lifecycle: world.lifecycle,
			catalog: { ...world.catalog, ratings: undefined },
			stats: { pixels: world.stats.pixels, players: Object.keys(world.stats.players).length },
			allowDownload: world.allowDownload,
			maxOnline: world.maxOnline,
			role: worldRole(user, world),
			online: sse.online(world.id),
			createdAt: world.createdAt
		};
	}

	function touchWorld(world) {
		world.lifecycle.lastActivityAt = now();
		if (world.lifecycle.state === 'frozen' && !isArchived(world)) world.lifecycle.state = 'active';
	}

	function pixelsPayload(world, since = 0) {
		const entries = Object.entries(world.pixels);
		const pixels = [];
		for (const [key, cell] of entries) {
			if (since && cell.at <= since) continue;
			const [x, y] = key.split(':').map(Number);
			pixels.push([x, y, cell.c]);
		}
		return pixels;
	}

	function recordPixel(world, x, y, color, actor) {
		const key = `${x}:${y}`;
		const before = world.pixels[key] || null;
		world.pixels[key] = { c: color, u: actor.id, at: now() };
		world.pixelHistory.push({ key, x, y, color, before: before ? { c: before.c, userId: before.u } : null, actorId: actor.id, at: now() });
		const limit = Number(process.env.PIXEL_HISTORY_LIMIT || 10000);
		if (world.pixelHistory.length > limit) world.pixelHistory.splice(0, world.pixelHistory.length - limit);
		bumpHeat(world, x, y, 1);
	}

	// ---------------- Обработчики ----------------

	const routes = [];
	const on = (method, pattern, handler) => routes.push({ method, pattern, keys: keysOf(pattern), regex: toRegex(pattern), handler });

	on('GET', '/api/config', async (req, res, ctx) => {
		ok(res, {
			name: 'PixelFront Worlds',
			version: '0.3.0',
			palette: PALETTE,
			tools: TOOLS,
			presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { title: v.title, description: v.description }])),
			accessModes: ACCESS_MODES,
			minWorldLevel: MIN_WORLD_LEVEL,
			features: { registration: process.env.FEATURE_REGISTRATION !== 'off', chat: process.env.FEATURE_CHAT !== 'off' },
			csrf: ctx.session?.csrf || null,
			me: ctx.user ? meView(ctx.user) : null
		});
	});

	on('GET', '/api/captcha', async (req, res) => ok(res, makeCaptcha()));

	// -------- Аутентификация --------
	on('POST', '/api/auth/register', async (req, res, ctx) => {
		if (process.env.FEATURE_REGISTRATION === 'off') throw new HttpError(403, 'Регистрация отключена');
		if (limited(`reg:${ctx.ip}`, 3600000, 8)) throw new HttpError(429, 'Слишком много регистраций, попробуйте позже');
		const body = await readJson(req);
		const nick = clean(body.nick, 24);
		const password = String(body.password ?? '');
		if (!/^[a-zA-Z0-9_\-а-яА-ЯёЁ]{3,24}$/.test(nick)) throw new HttpError(400, 'Ник: 3-24 символа, буквы/цифры/_/-');
		if (password.length < 8 || password.length > 128) throw new HttpError(400, 'Пароль: 8-128 символов');
		if (Object.values(db.users).some((u) => u.nick.toLowerCase() === nick.toLowerCase())) throw new HttpError(409, 'Ник уже занят');
		const user = createUser({ nick, password: hashPassword(password), verified: true });
		db.users[user.id] = user;
		store.audit(user, 'register', 'user', user.id);
		startSession(res, ctx, user);
		store.schedule(0);
		ok(res, { me: meView(user) });
	});

	on('POST', '/api/auth/login', async (req, res, ctx) => {
		if (limited(`login:${ctx.ip}`, 900000, 20)) throw new HttpError(429, 'Слишком много попыток входа');
		const body = await readJson(req);
		const nick = clean(body.nick, 24);
		const password = String(body.password ?? '');
		const user = Object.values(db.users).find((u) => u.nick.toLowerCase() === nick.toLowerCase());
		if (!user || !verifyPassword(password, user.password)) throw new HttpError(401, 'Неверный ник или пароль');
		if (user.ban && (!user.ban.until || user.ban.until > now())) throw new HttpError(403, `Аккаунт заблокирован: ${user.ban.reason || ''}`);
		startSession(res, ctx, user);
		store.schedule(0);
		ok(res, { me: meView(user) });
	});

	on('POST', '/api/auth/logout', async (req, res, ctx) => {
		destroySession(db, req);
		setCookie(res, 'sid', '', { maxAge: 0, https: ctx.https });
		store.schedule(0);
		ok(res, { ok: true });
	});

	on('GET', '/api/me', async (req, res, ctx) => {
		const user = requireUser(ctx);
		ok(res, { me: meView(user) });
	});

	on('GET', '/api/me/stats', async (req, res, ctx) => {
		const user = requireUser(ctx);
		ok(res, { global: globalStats(user), community: communityStats(user, db.worlds) });
	});

	// -------- Миры --------
	on('GET', '/api/worlds', async (req, res, ctx) => {
		const worlds = Object.values(db.worlds)
			.filter((w) => isVisible(w, ctx.user, ctx.session))
			.map((w) => publicWorld(w, ctx.user));
		ok(res, { worlds });
	});

	on('GET', '/api/catalog', async (req, res, ctx) => {
		const url = new URL(req.url, 'http://localhost');
		const category = url.searchParams.get('category') || 'popular';
		const search = clean(url.searchParams.get('q') || '', 40).toLowerCase();
		let worlds = Object.values(db.worlds).filter((w) => w.type === 'community' && w.catalog.listed && !isArchived(w) && isVisible(w, ctx.user, ctx.session));
		if (search) worlds = worlds.filter((w) => w.name.toLowerCase().includes(search) || w.tags.some((t) => t.includes(search)));
		worlds = filterCategory(worlds, category);
		ok(res, { category, worlds: worlds.slice(0, 60).map((w) => catalogCard(w)) });
	});

	on('POST', '/api/worlds', async (req, res, ctx) => {
		const user = requireUser(ctx);
		if (!user.verified) throw new HttpError(403, 'Сначала подтвердите аккаунт');
		if (user.level < MIN_WORLD_LEVEL) throw new HttpError(403, `Создавать миры можно с ${MIN_WORLD_LEVEL} уровня официального мира`);
		if (now() - user.createdAt < MIN_ACCOUNT_AGE_MS) throw new HttpError(403, 'Аккаунт слишком новый для создания мира');
		if (user.ban) throw new HttpError(403, 'Создание миров недоступно');
		if (limited(`world:${user.id}`, 3600000, 6)) throw new HttpError(429, 'Слишком частое создание миров');
		const body = await readJson(req);
		// CAPTCHA: клиент решает арифметику; сервер сверяет подписанный токен и ограничивает частоту.
		if (!verifyCaptcha(body.captchaToken, body.captcha)) throw new HttpError(400, 'Неверная CAPTCHA');
		const owned = Object.values(db.worlds).filter((w) => w.ownerId === user.id && w.type === 'community' && !isArchived(w)).length;
		if (owned >= (user.worldSlots || 1)) throw new HttpError(403, 'Достигнут лимит активных миров. Откройте слот за активность.');
		const world = createWorld({ ...body, type: 'community' }, user.id);
		if (world.access.mode === 'password' && body.password) world.access.passwordHash = hashPassword(String(body.password));
		ensureMember(world, user, 'owner');
		db.worlds[world.id] = world;
		db.chats[world.id] = [];
		user.worldsCreated += 1;
		store.audit(user, 'world.create', 'world', world.id, { preset: world.preset });
		store.schedule(0);
		ok(res, { world: publicWorld(world, user) });
	});

	on('GET', '/api/worlds/:id', async (req, res, ctx, params) => {
		const world = getWorld(params.id);
		if (!isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		if (ctx.user) {
			if (!ctx.user.visitedWorlds.includes(world.id)) {
				ctx.user.visitedWorlds = [...ctx.user.visitedWorlds, world.id].slice(-200);
				if (world.type === 'community') trackQuest(ctx.user, 'community_visits', 1);
			}
			if (world.access.mode === 'public' && world.type === 'community') ensureMember(world, ctx.user, 'member');
		}
		ok(res, { world: publicWorld(world, ctx.user), pixels: pixelsPayload(world), arts: Object.values(world.arts) });
	});

	on('POST', '/api/worlds/:id/join', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		const body = await readJson(req);
		if (world.access.mode === 'password') {
			if (!world.access.passwordHash || !verifyPassword(String(body.password || ''), world.access.passwordHash)) throw new HttpError(403, 'Неверный пароль мира');
			ctx.session.unlocked = [...new Set([...(ctx.session.unlocked || []), world.id])];
		} else if (world.access.mode === 'link') {
			if (!safeEqual(String(body.key || ''), world.access.linkKey || '')) throw new HttpError(403, 'Неверная ссылка');
			ctx.session.unlocked = [...new Set([...(ctx.session.unlocked || []), world.id])];
		} else if (world.access.mode === 'request') {
			if (!world.access.requests.includes(user.id)) world.access.requests.push(user.id);
			store.schedule();
			return ok(res, { requested: true });
		} else if (world.access.mode === 'invite' || world.access.mode === 'faction') {
			if (!world.members[user.id]) throw new HttpError(403, 'Только по приглашению');
		}
		ensureMember(world, user, 'member');
		store.schedule(0);
		ok(res, { joined: true, world: publicWorld(world, user) });
	});

	on('GET', '/api/worlds/:id/pixels', async (req, res, ctx, params) => {
		const world = getWorld(params.id);
		if (!isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		const since = int(new URL(req.url, 'http://localhost').searchParams.get('since'), 0, Number.MAX_SAFE_INTEGER, 0);
		ok(res, { pixels: pixelsPayload(world, since), at: now() });
	});

	// Пакетная установка пикселей (один или несколько — инструменты).
	on('POST', '/api/worlds/:id/ops', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (process.env.FEATURE_PIXELS === 'off') throw new HttpError(403, 'Рисование временно отключено');
		if (!isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		if (isFrozen(world)) throw new HttpError(409, 'Мир заморожен или в архиве');
		// Серверный лимит запросов в секунду даже при отключённом КД.
		if (limited(`ops:${user.id}:${world.id}`, 1000, 30)) throw new HttpError(429, 'Слишком быстро');
		const body = await readJson(req);
		const tool = pick(TOOLS, body.tool, 'pixel');
		const color = String(body.color || '');
		if (tool !== 'eraser' && !world.palette.includes(color)) throw new HttpError(400, 'Цвет не в палитре мира');
		const cells = normalizeCells(body.cells, world);
		if (!cells.length) throw new HttpError(400, 'Нет пикселей для установки');
		const config = toolConfig(world, tool);
		const role = worldRole(user, world);
		if (!atLeast(role, config.minRole)) throw new HttpError(403, 'Недостаточная роль для этого инструмента');
		if (cells.length > config.maxSize) throw new HttpError(400, `Инструмент ограничен ${config.maxSize} пикселями за раз`);
		if (world.energy.blockNegativeReputation && (world.members[user.id]?.reputation || 0) < 0) throw new HttpError(403, 'Отрицательная репутация: рисование запрещено');

		const usage = toolUsage(user, world, tool);
		if (config.dailyLimit && usage.count >= config.dailyLimit) throw new HttpError(429, 'Достигнут дневной лимит инструмента');
		if (config.cooldownMs && now() - usage.lastAt < config.cooldownMs) throw new HttpError(429, 'Инструмент перезаряжается');

		// Проверка защиты и тепловой карты.
		let warned = false;
		for (const [x, y] of cells) {
			const check = checkProtection(world, user, x, y, tool);
			if (!check.allowed) throw new HttpError(403, `Область защищена: ${check.art?.name || 'арт'}`);
			if (check.warn) warned = true;
		}
		const heat = tool === 'picker' ? 1 : heatMultiplier(world, cells[0][0], cells[0][1]);
		const energyCost = Math.ceil(config.cost * cells.length * heat);

		const state = energyState(user, world);
		if (world.energy.mode !== 'infinite' && world.energy.mode !== 'off') {
			if (state.value < energyCost) throw new HttpError(429, 'Недостаточно энергии, подождите восстановления');
			if (world.energy.dailyLimit && state.spentToday + energyCost > world.energy.dailyLimit) throw new HttpError(429, 'Достигнут дневной лимит энергии');
			state.value -= energyCost;
			state.spentToday += energyCost;
			state.at = state.at || now();
		}

		// Применяем пиксели.
		const applied = [];
		for (const [x, y] of cells) {
			const c = tool === 'eraser' ? world.background : color;
			recordPixel(world, x, y, c, user);
			applied.push([x, y, c]);
		}
		usage.count += cells.length;
		usage.lastAt = now();
		user.lastSeenAt = now();
		touchWorld(world);

		// Единый обработчик начислений.
		const reward = awardPixels(user, world, cells.length, { colors: [color], area: cells.length, event: isOfficial(world) });
		if (isOfficial(world)) trackEventProgress(db, user, cells.length);

		emit(world.id, 'pixels', { tool, pixels: applied, by: user.nick });
		store.schedule();
		ok(res, {
			applied: applied.length,
			warned,
			energy: publicEnergy(user, world),
			reward: { scope: reward.scope, xp: reward.xp, coins: reward.coins, levelUp: reward.levelUp, achievements: reward.achievements, local: reward.local }
		});
	});

	on('GET', '/api/worlds/:id/energy', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		ok(res, { energy: publicEnergy(user, world) });
	});

	on('PATCH', '/api/worlds/:id', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (isOfficial(world) && user.role !== 'admin') throw new HttpError(403, 'Настройки официального мира меняет только администрация');
		if (!canManage(user, world)) throw new HttpError(403, 'Недостаточно прав');
		const body = await readJson(req);
		applyWorldSettings(world, body, user);
		world.updatedAt = now();
		store.audit(user, 'world.update', 'world', world.id);
		store.schedule(0);
		ok(res, { world: publicWorld(world, user) });
	});

	on('POST', '/api/worlds/:id/end', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (isOfficial(world)) throw new HttpError(403, 'Официальный мир нельзя завершить');
		if (world.ownerId !== user.id && user.role !== 'admin') throw new HttpError(403, 'Только владелец может завершить мир');
		world.lifecycle.state = 'ended';
		world.lifecycle.archivedAt = now();
		world.catalog.listed = false;
		const snap = makeSnapshot(world, 'final');
		world.lifecycle.finalSnapshotId = snap.id;
		store.audit(user, 'world.end', 'world', world.id);
		emit(world.id, 'lifecycle', { state: 'ended', worldId: world.id });
		store.schedule(0);
		ok(res, { world: publicWorld(world, user), finalSnapshot: snap.id });
	});

	on('POST', '/api/worlds/:id/restore', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (world.ownerId !== user.id && user.role !== 'admin') throw new HttpError(403, 'Недостаточно прав');
		if (world.lifecycle.state !== 'archived' && world.lifecycle.state !== 'frozen') throw new HttpError(409, 'Мир не в архиве');
		world.lifecycle.state = 'active';
		world.lifecycle.lastActivityAt = now();
		world.catalog.listed = true;
		store.audit(user, 'world.restore', 'world', world.id);
		store.schedule(0);
		ok(res, { world: publicWorld(world, user) });
	});

	// -------- Чат --------
	on('GET', '/api/worlds/:id/chat', async (req, res, ctx, params) => {
		const world = getWorld(params.id);
		if (!isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		const list = (db.chats[world.id] || []).filter((m) => !m.deleted).slice(-80);
		ok(res, { messages: list });
	});

	on('POST', '/api/worlds/:id/chat', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (process.env.FEATURE_CHAT === 'off' || !world.chat.enabled) throw new HttpError(403, 'Чат отключён');
		if (!isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		const role = worldRole(user, world);
		if (!atLeast(role, world.chat.whoCanWrite)) throw new HttpError(403, 'Недостаточно прав для чата');
		const member = world.members[user.id];
		if (member?.mutedUntil > now()) throw new HttpError(403, 'Вы в муте в этом мире');
		if (user.mutedUntil > now()) throw new HttpError(403, 'Глобальный мут активен');
		if (now() - user.createdAt < world.chat.minAccountAgeMs) throw new HttpError(403, 'Аккаунт слишком новый для чата этого мира');
		if (limited(`chat:${user.id}:${world.id}`, world.chat.slowModeMs || 1, 1)) throw new HttpError(429, 'Медленный режим: подождите');
		const body = await readJson(req);
		const text = clean(body.text, world.chat.maxLength);
		if (!text) throw new HttpError(400, 'Пустое сообщение');
		const recent = (db.chats[world.id] || []).slice(-30);
		const verdict = moderateMessage({ text, world, user, recent });
		const message = { id: `msg_${now()}_${Math.random().toString(36).slice(2, 8)}`, userId: user.id, nick: user.nick, text, at: now(), role };
		if (verdict.action === 'delete' || verdict.action === 'escalate') {
			message.hidden = true;
			message.text = '[скрыто автомодерацией]';
		}
		const chat = (db.chats[world.id] ||= []);
		chat.push(message);
		if (chat.length > world.chat.historyLimit) chat.splice(0, chat.length - world.chat.historyLimit);
		trackQuest(user, 'chat_messages', 1);

		if (verdict.action === 'mute' || verdict.action === 'escalate') {
			if (member) member.mutedUntil = now() + 600000;
			pushQueue(db, { type: 'chat', priority: verdict.action === 'escalate' ? 'high' : 'normal', worldId: world.id, userId: user.id, details: { text, reasons: verdict.reasons, score: verdict.score } });
		}
		if (!message.hidden) emit(world.id, 'chat', message);
		store.schedule();
		ok(res, { message: message.hidden ? { ...message, moderated: verdict } : message });
	});

	// -------- Арты и защита --------
	on('POST', '/api/worlds/:id/arts', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		const role = worldRole(user, world);
		if (!atLeast(role, 'artist') && !isOwner2(user, world)) throw new HttpError(403, 'Регистрировать арты могут художники и выше');
		const body = await readJson(req);
		const art = {
			id: `art_${now()}_${Math.random().toString(36).slice(2, 8)}`,
			name: clean(body.name, 48) || 'Арт',
			description: clean(body.description, 200),
			x: int(body.x, 0, world.width - 1, 0),
			y: int(body.y, 0, world.height - 1, 0),
			width: int(body.width, 1, world.width, 1),
			height: int(body.height, 1, world.height, 1),
			ownerId: user.id,
			authors: [user.id, ...(Array.isArray(body.authors) ? body.authors.filter((a) => db.users[a]) : [])].slice(0, 12),
			level: pick(['none', 'soft', 'guests', 'authors', 'frozen', 'timed'], body.level, 'authors'),
			until: body.level === 'timed' ? now() + int(body.durationMs, 60000, 90 * 86400000, 7 * 86400000) : null,
			status: world.protection.requireApproval && !canModerate(user, world) ? 'pending' : 'approved',
			createdAt: now(),
			versions: []
		};
		if (art.x + art.width > world.width || art.y + art.height > world.height) throw new HttpError(400, 'Область выходит за границы карты');
		assertProtectionLimits(world, art);
		world.arts[art.id] = art;
		store.audit(user, 'art.create', 'art', art.id, { worldId: world.id, level: art.level });
		store.schedule(0);
		emit(world.id, 'art', { type: 'created', art });
		ok(res, { art });
	});

	on('POST', '/api/worlds/:id/arts/:artId/restore', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (!canModerate(user, world)) throw new HttpError(403, 'Только модератор мира');
		const art = world.arts[params.artId];
		if (!art) throw new HttpError(404, 'Арт не найден');
		const count = restoreArea(world, art.x, art.y, art.width, art.height, user);
		emit(world.id, 'pixels', { tool: 'restore', pixels: pixelsPayload(world).filter(([x, y]) => x >= art.x && x < art.x + art.width && y >= art.y && y < art.y + art.height) });
		store.audit(user, 'art.restore', 'art', art.id, { count });
		store.schedule(0);
		ok(res, { restored: count });
	});

	// -------- Восстановление / откат --------
	on('POST', '/api/worlds/:id/rollback', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (!canModerate(user, world)) throw new HttpError(403, 'Только модератор мира');
		const body = await readJson(req);
		let reverted = 0;
		if (body.userId && body.windowMs) {
			// Отменить все действия нарушителя за окно времени.
			const since = now() - int(body.windowMs, 60000, 86400000, 1800000);
			reverted = revertActor(world, body.userId, since, user);
			if (body.ban && (world.members[body.userId])) world.members[body.userId].banned = true;
			store.audit(user, 'rollback.actor', 'world', world.id, { userId: body.userId, reverted, ban: !!body.ban });
		} else if (body.at) {
			reverted = revertToTime(world, int(body.at, 0, Number.MAX_SAFE_INTEGER, now()), user);
			store.audit(user, 'rollback.time', 'world', world.id, { at: body.at, reverted });
		} else if (Number.isInteger(body.x) && Number.isInteger(body.y)) {
			reverted = revertPixel(world, body.x, body.y, user) ? 1 : 0;
		} else {
			throw new HttpError(400, 'Укажите userId+windowMs, at или x+y');
		}
		emit(world.id, 'reload', { worldId: world.id });
		store.schedule(0);
		ok(res, { reverted });
	});

	on('GET', '/api/worlds/:id/history', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (!canModerate(user, world)) throw new HttpError(403, 'Только модератор мира');
		ok(res, { history: world.pixelHistory.slice(-200), snapshots: world.snapshots.map((s) => ({ id: s.id, kind: s.kind, at: s.at, pixels: s.pixels })) });
	});

	// -------- Роли и модерация мира --------
	on('POST', '/api/worlds/:id/members/:userId', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const world = getWorld(params.id);
		if (!canManage(user, world)) throw new HttpError(403, 'Недостаточно прав');
		const target = db.users[params.userId];
		if (!target) throw new HttpError(404, 'Игрок не найден');
		const body = await readJson(req);
		const member = ensureMember(world, target, 'member');
		if (body.role) {
			const role = pick(['guest', 'member', 'trusted', 'artist', 'moderator', 'admin'], body.role, 'member');
			if (role === 'admin' && world.ownerId !== user.id) throw new HttpError(403, 'Назначать администраторов может только владелец');
			member.role = role;
		}
		// Локальные наказания — только в пределах этого мира.
		if (body.action === 'kick') member.banned = false, delete world.members[target.id];
		if (body.action === 'ban') member.banned = true;
		if (body.action === 'unban') member.banned = false;
		if (body.action === 'mute') member.mutedUntil = now() + int(body.durationMs, 60000, 604800000, 3600000);
		if (body.action === 'unmute') member.mutedUntil = 0;
		store.audit(user, `world.member.${body.action || 'role'}`, 'user', target.id, { worldId: world.id, role: member?.role });
		store.schedule(0);
		ok(res, { member: world.members[target.id] || null });
	});

	// -------- Локальный рейтинг --------
	on('GET', '/api/worlds/:id/leaderboard', async (req, res, ctx, params) => {
		const world = getWorld(params.id);
		if (!isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		ok(res, { local: localLeaderboard(world, db.users), notice: 'Локальный рейтинг не влияет на глобальный прогресс.' });
	});

	// -------- Глобальный рейтинг / экономика --------
	on('GET', '/api/leaderboard', async (req, res) => ok(res, { leaderboard: leaderboard(db.users), season: db.season }));
	on('GET', '/api/shop', async (req, res, ctx) => ok(res, { offers: db.shop.offers, coins: ctx.user?.inventory.coins ?? 0 }));
	on('POST', '/api/shop/:key/buy', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const result = buyItem(user, params.key);
		if (result.error) throw new HttpError(result.error, result.message);
		store.audit(user, 'shop.buy', 'item', params.key);
		store.schedule(0);
		ok(res, result);
	});
	on('GET', '/api/quests', async (req, res, ctx) => {
		const user = requireUser(ctx);
		ok(res, { daily: dailyState(user) });
	});
	on('POST', '/api/quests/:questId/claim', async (req, res, ctx, params) => {
		const user = requireUser(ctx);
		const result = claimQuest(user, params.questId);
		if (result.error) throw new HttpError(result.error, result.message);
		store.schedule(0);
		ok(res, result);
	});
	on('GET', '/api/events', async (req, res) => ok(res, { active: db.events.active, history: db.events.history.slice(-10) }));
	on('GET', '/api/inventory', async (req, res, ctx) => {
		const user = requireUser(ctx);
		ok(res, { coins: user.inventory.coins, items: user.inventory.items, titles: user.titles });
	});

	// -------- Жалобы --------
	on('POST', '/api/reports', async (req, res, ctx) => {
		const user = requireUser(ctx);
		if (limited(`report:${user.id}`, 60000, 5)) throw new HttpError(429, 'Слишком много жалоб');
		const body = await readJson(req);
		const report = {
			id: `rep_${now()}_${Math.random().toString(36).slice(2, 8)}`,
			reporterId: user.id,
			worldId: db.worlds[body.worldId] ? body.worldId : null,
			targetType: pick(['chat', 'art', 'world', 'user', 'appeal'], body.targetType, 'world'),
			targetId: clean(body.targetId, 60),
			reason: clean(body.reason, 300),
			status: 'open',
			createdAt: now()
		};
		db.reports.push(report);
		const priority = report.targetType === 'appeal' ? 'high' : 'normal';
		pushQueue(db, { type: `report:${report.targetType}`, priority, worldId: report.worldId || 'official', targetId: report.targetId, details: { reason: report.reason, reportId: report.id } });
		store.schedule(0);
		ok(res, { report });
	});

	// -------- Административная очередь --------
	on('GET', '/api/admin/queue', async (req, res, ctx) => {
		requireStaff(ctx);
		ok(res, { queue: prioritizeQueue(db).slice(0, 100), reports: db.reports.filter((r) => r.status === 'open').slice(-100) });
	});
	on('POST', '/api/admin/queue/:id/resolve', async (req, res, ctx, params) => {
		const staff = requireStaff(ctx);
		const item = db.modQueue.find((q) => q.id === params.id);
		if (!item) throw new HttpError(404, 'Запись не найдена');
		const body = await readJson(req);
		item.status = 'resolved';
		item.resolvedBy = staff.id;
		item.resolution = clean(body.resolution, 200);
		item.resolvedAt = now();
		store.audit(staff, 'queue.resolve', 'queue', item.id, { resolution: item.resolution });
		store.schedule(0);
		ok(res, { item });
	});
	on('POST', '/api/admin/users/:userId/ban', async (req, res, ctx, params) => {
		const staff = requireStaff(ctx, 'admin');
		const target = db.users[params.userId];
		if (!target) throw new HttpError(404, 'Игрок не найден');
		const body = await readJson(req);
		if (body.lift) target.ban = null;
		else target.ban = { reason: clean(body.reason, 200), until: body.durationMs ? now() + int(body.durationMs, 60000, 3650 * 86400000, 86400000) : null, by: staff.id, at: now() };
		store.audit(staff, body.lift ? 'user.unban' : 'user.ban', 'user', target.id, { reason: target.ban?.reason });
		store.schedule(0);
		ok(res, { ban: target.ban });
	});
	on('POST', '/api/admin/users/:userId/role', async (req, res, ctx, params) => {
		const staff = requireStaff(ctx, 'admin');
		const target = db.users[params.userId];
		if (!target) throw new HttpError(404, 'Игрок не найден');
		const body = await readJson(req);
		target.role = pick(['user', 'moderator', 'admin'], body.role, 'user');
		store.audit(staff, 'user.role', 'user', target.id, { role: target.role });
		store.schedule(0);
		ok(res, { role: target.role });
	});
	on('GET', '/api/admin/audit', async (req, res, ctx) => {
		requireStaff(ctx);
		ok(res, { audit: db.audit.slice(-200).reverse() });
	});
	on('GET', '/api/admin/automation', async (req, res, ctx) => {
		requireStaff(ctx);
		ok(res, { automation: db.automation, events: db.events, season: db.season });
	});

	// -------- SSE --------
	on('GET', '/api/stream', async (req, res, ctx) => {
		const worldId = clean(new URL(req.url, 'http://localhost').searchParams.get('world') || 'official', 60);
		const world = db.worlds[worldId];
		if (!world || !isVisible(world, ctx.user, ctx.session)) throw new HttpError(403, 'Мир недоступен');
		sse.subscribe(worldId, req, res);
	});

	// ------------- helpers -------------
	function getWorld(idParam) {
		const world = db.worlds[idParam];
		if (!world) throw new HttpError(404, 'Мир не найден');
		return world;
	}
	function isOwner2(user, world) {
		return user && world.ownerId === user.id;
	}
	function startSession(res, ctx, user) {
		destroySession(db, ctx.req);
		const { sid, session } = createSession(db, user.id, ctx.https);
		setCookie(res, 'sid', sid, { maxAge: Number(process.env.SESSION_TTL || 7 * 86400000), https: ctx.https });
		res.setHeader('x-csrf-token', session.csrf);
		user.lastSeenAt = now();
	}
	function meView(user) {
		return {
			id: user.id,
			nick: user.nick,
			role: user.role,
			verified: user.verified,
			level: user.level,
			xp: user.xp,
			officialPixels: user.officialPixels,
			communityPixels: user.communityPixels,
			coins: user.inventory.coins,
			titles: user.titles,
			achievements: user.achievements,
			worldSlots: user.worldSlots,
			worldsCreated: user.worldsCreated,
			csrf: currentCsrf(user)
		};
	}
	function currentCsrf() {
		return undefined;
	}
	function publicEnergy(user, world) {
		const state = energyState(user, world);
		return { value: Math.floor(state.value), max: world.energy.maxEnergy, mode: world.energy.mode, stepMs: state.step || world.energy.cooldownMs, spentToday: state.spentToday };
	}
	return { routes, dispatch: makeDispatcher(routes, { store, db, getSession }) };
}

// -------- чистые функции --------

const CAPTCHA_SECRET = process.env.CAPTCHA_SECRET || token(24);
function makeCaptcha() {
	const a = 1 + Math.floor(Math.random() * 9);
	const b = 1 + Math.floor(Math.random() * 9);
	return { question: `${a} + ${b} = ?`, captchaToken: sha(`${a + b}:${CAPTCHA_SECRET}`) };
}
function verifyCaptcha(tokenValue, answer) {
	if (!tokenValue || answer == null) return false;
	return safeEqual(String(tokenValue), sha(`${String(answer).trim()}:${CAPTCHA_SECRET}`));
}

function normalizeCells(cells, world) {
	if (!Array.isArray(cells)) return [];
	const seen = new Set();
	const out = [];
	for (const cell of cells.slice(0, 5000)) {
		if (!Array.isArray(cell) || cell.length < 2) continue;
		const x = Math.trunc(Number(cell[0]));
		const y = Math.trunc(Number(cell[1]));
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		if (x < 0 || y < 0 || x >= world.width || y >