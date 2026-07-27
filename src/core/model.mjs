// Модель данных: палитры, пресеты миров, фабрики и миграция БД.
import { bool, clamp, clean, id, int, now, pick, uniq } from './util.mjs';

export const PALETTE = [
	'#ffffff', '#e4e4e4', '#888888', '#222222', '#000000',
	'#ffa7d1', '#e50000', '#e59500', '#a06a42', '#e5d900',
	'#94e044', '#02be01', '#00d3dd', '#0083c7', '#0000ea',
	'#cf6ee4', '#820080', '#ff7f7f', '#5b3a29', '#f5deb3'
];

export const SMALL_PALETTE = ['#ffffff', '#000000', '#e50000', '#0083c7', '#02be01', '#e5d900'];

export const WORLD_ROLES = ['guest', 'member', 'trusted', 'artist', 'moderator', 'admin', 'owner'];
export const ROLE_WEIGHT = Object.fromEntries(WORLD_ROLES.map((r, i) => [r, i]));

export const GLOBAL_ROLES = ['user', 'moderator', 'admin'];

export const ACCESS_MODES = ['public', 'link', 'password', 'request', 'invite', 'faction'];

export const ENERGY_MODES = ['cooldown', 'stock', 'infinite', 'off'];

export const PROTECTION_LEVELS = ['none', 'soft', 'guests', 'authors', 'frozen', 'timed'];

// Бесконечный мир: центральная зона спавна SPAWN_SIZE×SPAWN_SIZE даёт больше
// наград (XP) и полезностей, чем область за её пределами.
export const SPAWN_SIZE = 1000;
export const SPAWN_HALF = SPAWN_SIZE / 2;
export const SPAWN_XP_MULTIPLIER = 2;

// Ластик убран. Кисти: brush2 (2×2) и brush3 (3×3).
export const TOOLS = [
	'pixel', 'brush2', 'brush3', 'line', 'rect', 'fill', 'picker',
	'move', 'copy', 'stamp', 'template', 'protect', 'restore'
];

export const LIFECYCLE_STATES = ['trial', 'active', 'frozen', 'archived', 'ended'];

export const QUEST_POOL = [
	{ id: 'daily_pixels_25', title: 'Поставить 25 пикселей в официальном мире', metric: 'official_pixels', target: 25, reward: { coins: 30, xp: 20 } },
	{ id: 'daily_pixels_100', title: 'Поставить 100 пикселей в официальном мире', metric: 'official_pixels', target: 100, reward: { coins: 90, xp: 60 } },
	{ id: 'daily_colors_5', title: 'Использовать 5 разных цветов', metric: 'colors_used', target: 5, reward: { coins: 25, xp: 15 } },
	{ id: 'daily_chat_3', title: 'Написать 3 сообщения в чат', metric: 'chat_messages', target: 3, reward: { coins: 10 } },
	{ id: 'daily_area', title: 'Закрасить область 8×8', metric: 'area_progress', target: 64, reward: { coins: 40, xp: 30 } },
	{ id: 'daily_visit_community', title: 'Посетить мир сообщества', metric: 'community_visits', target: 1, reward: { coins: 15 } },
	{ id: 'daily_event', title: 'Поучаствовать в автоматическом событии', metric: 'event_pixels', target: 20, reward: { coins: 50, xp: 40 } }
];

export const ACHIEVEMENTS = [
	{ key: 'first_pixel', title: 'Первый след', metric: 'officialPixels', target: 1 },
	{ key: 'pixels_100', title: 'Сотня', metric: 'officialPixels', target: 100 },
	{ key: 'pixels_1000', title: 'Тысяча', metric: 'officialPixels', target: 1000 },
	{ key: 'pixels_10000', title: 'Десять тысяч', metric: 'officialPixels', target: 10000 },
	{ key: 'level_5', title: 'Опытный художник', metric: 'level', target: 5 },
	{ key: 'level_15', title: 'Мастер холста', metric: 'level', target: 15 },
	{ key: 'events_5', title: 'Участник событий', metric: 'eventsCompleted', target: 5 },
	{ key: 'quests_25', title: 'Исполнительный', metric: 'questsCompleted', target: 25 }
];

export const SHOP_ITEMS = [
	{ key: 'frame_neon', title: 'Неоновая рамка профиля', price: 250, type: 'cosmetic' },
	{ key: 'nick_gradient', title: 'Градиентный ник', price: 400, type: 'cosmetic' },
	{ key: 'badge_pioneer', title: 'Значок пионера', price: 150, type: 'cosmetic' },
	{ key: 'world_slot', title: 'Дополнительный слот мира', price: 900, type: 'utility' },
	{ key: 'energy_boost', title: 'Ускорение энергии на 1 час', price: 120, type: 'consumable' }
];

export const EVENT_TEMPLATES = [
	{ key: 'rush', title: 'Пиксельный рывок', durationMs: 3600000, everyMs: 10800000, reward: { coins: 60, xp: 50 }, goalPerPlayer: 60 },
	{ key: 'weekend_mural', title: 'Мурал выходного дня', durationMs: 21600000, everyMs: 604800000, reward: { coins: 200, xp: 180 }, goalPerPlayer: 250, weekendOnly: true },
	{ key: 'palette_day', title: 'День ограниченной палитры', durationMs: 7200000, everyMs: 86400000, reward: { coins: 80, xp: 70 }, goalPerPlayer: 80 }
];

function toolDefaults(overrides = {}) {
	const base = {
		pixel: { enabled: true, cost: 1, cooldownMs: 0, maxSize: 1, minRole: 'guest', dailyLimit: 0, allowInProtected: false },
		brush2: { enabled: true, cost: 4, cooldownMs: 0, maxSize: 2, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		brush3: { enabled: true, cost: 9, cooldownMs: 0, maxSize: 3, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		line: { enabled: true, cost: 1, cooldownMs: 0, maxSize: 64, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		rect: { enabled: true, cost: 1, cooldownMs: 0, maxSize: 48, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		fill: { enabled: false, cost: 1, cooldownMs: 5000, maxSize: 4096, minRole: 'trusted', dailyLimit: 20, allowInProtected: false },
		picker: { enabled: true, cost: 0, cooldownMs: 0, maxSize: 1, minRole: 'guest', dailyLimit: 0, allowInProtected: true },
		move: { enabled: false, cost: 1, cooldownMs: 15000, maxSize: 1024, minRole: 'trusted', dailyLimit: 10, allowInProtected: false },
		copy: { enabled: false, cost: 0, cooldownMs: 2000, maxSize: 1024, minRole: 'trusted', dailyLimit: 0, allowInProtected: true },
		stamp: { enabled: false, cost: 1, cooldownMs: 3000, maxSize: 1024, minRole: 'artist', dailyLimit: 0, allowInProtected: false },
		template: { enabled: true, cost: 0, cooldownMs: 0, maxSize: 4096, minRole: 'artist', dailyLimit: 0, allowInProtected: true },
		protect: { enabled: true, cost: 0, cooldownMs: 0, maxSize: 4096, minRole: 'artist', dailyLimit: 0, allowInProtected: true },
		restore: { enabled: true, cost: 0, cooldownMs: 0, maxSize: 4096, minRole: 'moderator', dailyLimit: 0, allowInProtected: true }
	};
	for (const [key, patch] of Object.entries(overrides)) base[key] = { ...base[key], ...patch };
	return base;
}

export const PRESETS = {
	free_canvas: {
		title: 'Свободный холст',
		description: 'Минимальное КД, большая палитра, никаких захватов территорий.',
		patch: {
			energy: { mode: 'cooldown', cooldownMs: 1000, maxEnergy: 120, startEnergy: 60 },
			tools: toolDefaults({ fill: { enabled: true, minRole: 'trusted' } }),
			protection: { maxAreas: 20, maxPercent: 25 }
		}
	},
	gallery: {
		title: 'Защищённая галерея',
		description: 'Завершённые работы регистрируются и защищаются, разрушение ограничено.',
		patch: {
			energy: { mode: 'cooldown', cooldownMs: 3000, maxEnergy: 60, startEnergy: 30 },
			tools: toolDefaults({ fill: { enabled: false }, move: { enabled: false } }),
			protection: { maxAreas: 120, maxPercent: 70, requireApproval: true, minArtSize: 64 }
		}
	},
	faction: {
		title: 'Мир фракции',
		description: 'Доступ по приглашению, роли, шаблоны и общая очередь задач.',
		patch: {
			access: { mode: 'invite' },
			energy: { mode: 'stock', cooldownMs: 1500, maxEnergy: 200, startEnergy: 100, trustedMultiplier: 2 },
			tools: toolDefaults({ stamp: { enabled: true }, template: { enabled: true }, copy: { enabled: true } }),
			protection: { maxAreas: 80, maxPercent: 60 }
		}
	},
	war: {
		title: 'Пиксельная война',
		description: 'Команды, территории, флаги и автоматический подсчёт победителя.',
		patch: {
			energy: { mode: 'cooldown', cooldownMs: 800, maxEnergy: 80, startEnergy: 40 },
			tools: toolDefaults({ fill: { enabled: true, minRole: 'trusted' } }),
			protection: { maxAreas: 8, maxPercent: 10 },
			battle: { enabled: true, teams: ['red', 'blue'], roundMs: 86400000 }
		}
	},
	private_world: {
		title: 'Приватный мир',
		description: 'Только по приглашениям, владелец задаёт любые правила.',
		patch: {
			access: { mode: 'invite' },
			catalog: { listed: false },
			energy: { mode: 'infinite' },
			tools: toolDefaults({ fill: { enabled: true, minRole: 'member' }, move: { enabled: true, minRole: 'member' } }),
			protection: { unlimited: true, maxAreas: 500, maxPercent: 100 }
		}
	},
	event: {
		title: 'Временное событие',
		description: 'Есть дата начала и конца, после финала карта замораживается и уходит в архив.',
		patch: {
			energy: { mode: 'cooldown', cooldownMs: 500, maxEnergy: 150, startEnergy: 150 },
			tools: toolDefaults({ fill: { enabled: true, minRole: 'trusted' } }),
			protection: { maxAreas: 30, maxPercent: 40 },
			lifecycle: { endsAt: now() + 7 * 86400000 }
		}
	}
};

export function defaultEnergy(patch = {}) {
	return {
		mode: pick(ENERGY_MODES, patch.mode, 'cooldown'),
		cooldownMs: int(patch.cooldownMs, 200, 600000, 2500),
		maxEnergy: int(patch.maxEnergy, 1, 1000, 30),
		startEnergy: int(patch.startEnergy, 0, 1000, 15),
		dailyLimit: int(patch.dailyLimit, 0, 1000000, 0),
		newbieMultiplier: clamp(patch.newbieMultiplier, 0.1, 5, 1),
		trustedMultiplier: clamp(patch.trustedMultiplier, 0.1, 5, 1),
		guestCooldownMs: int(patch.guestCooldownMs, 0, 600000, 0),
		regenOffline: bool(patch.regenOffline, true),
		blockNegativeReputation: bool(patch.blockNegativeReputation, true),
		heatPenalty: bool(patch.heatPenalty, true)
	};
}

export function defaultProtection(patch = {}) {
	return {
		maxAreas: int(patch.maxAreas, 0, 1000, 25),
		maxPercent: int(patch.maxPercent, 0, 100, 30),
		maxDurationMs: int(patch.maxDurationMs, 0, 90 * 86400000, 30 * 86400000),
		minArtSize: int(patch.minArtSize, 1, 100000, 16),
		requireApproval: bool(patch.requireApproval, false),
		unlimited: bool(patch.unlimited, false)
	};
}

export function defaultChat(patch = {}) {
	return {
		enabled: bool(patch.enabled, true),
		whoCanWrite: pick(WORLD_ROLES, patch.whoCanWrite, 'member'),
		minAccountAgeMs: int(patch.minAccountAgeMs, 0, 30 * 86400000, 0),
		slowModeMs: int(patch.slowModeMs, 0, 600000, 2000),
		allowLinks: bool(patch.allowLinks, false),
		allowImages: bool(patch.allowImages, false),
		maxLength: int(patch.maxLength, 20, 400, 240),
		bannedWords: uniq((Array.isArray(patch.bannedWords) ? patch.bannedWords : []).map((w) => clean(w, 32).toLowerCase()).filter(Boolean)).slice(0, 200),
		autoMute: bool(patch.autoMute, true),
		historyLimit: int(patch.historyLimit, 50, 2000, 300)
	};
}

export function defaultAccess(patch = {}) {
	return {
		mode: pick(ACCESS_MODES, patch.mode, 'public'),
		passwordHash: typeof patch.passwordHash === 'string' ? patch.passwordHash : null,
		linkKey: typeof patch.linkKey === 'string' ? patch.linkKey : null,
		factionId: patch.factionId ? clean(patch.factionId, 40) : null,
		requests: Array.isArray(patch.requests) ? patch.requests : [],
		invites: Array.isArray(patch.invites) ? patch.invites : []
	};
}

export function defaultLifecycle(patch = {}) {
	const t = now();
	return {
		state: pick(LIFECYCLE_STATES, patch.state, 'trial'),
		trialUntil: Number(patch.trialUntil || t + 14 * 86400000),
		lastActivityAt: Number(patch.lastActivityAt || t),
		frozenAt: patch.frozenAt ?? null,
		archivedAt: patch.archivedAt ?? null,
		endsAt: patch.endsAt ?? null,
		startsAt: patch.startsAt ?? null,
		notifiedAt: patch.notifiedAt ?? null,
		finalSnapshotId: patch.finalSnapshotId ?? null
	};
}

export function defaultCatalog(patch = {}) {
	return {
		listed: bool(patch.listed, true),
		subscribers: Array.isArray(patch.subscribers) ? patch.subscribers : [],
		ratings: patch.ratings && typeof patch.ratings === 'object' ? patch.ratings : {},
		promotionScore: Number(patch.promotionScore || 0),
		moderationStatus: pick(['ok', 'review', 'limited', 'blocked'], patch.moderationStatus, 'ok')
	};
}

export function createWorld(input = {}, ownerId = null) {
	const t = now();
	const presetKey = pick(Object.keys(PRESETS), input.preset, 'free_canvas');
	const preset = PRESETS[presetKey].patch;
	// Миры по умолчанию квадратные и бесконечные; width/height задают стартовую
	// (видимую) область, но не ограничивают рисование за её пределами.
	const infinite = bool(input.infinite, true);
	const width = int(input.width, 32, 100000, SPAWN_SIZE);
	const height = int(input.height, 32, 100000, width);
	return {
		id: input.id || id('world'),
		name: clean(input.name, 48) || PRESETS[presetKey].title,
		description: clean(input.description, 240),
		icon: clean(input.icon, 8) || '🎨',
		language: clean(input.language, 8) || 'ru',
		tags: uniq((Array.isArray(input.tags) ? input.tags : []).map((x) => clean(x, 20).toLowerCase()).filter(Boolean)).slice(0, 8),
		ageRating: pick(['0+', '12+', '16+', '18+'], input.ageRating, '0+'),
		type: input.type === 'official' ? 'official' : 'community',
		preset: presetKey,
		ownerId,
		width,
		height,
		infinite,
		spawn: SPAWN_SIZE,
		background: PALETTE.includes(input.background) ? input.background : '#ffffff',
		grid: bool(input.grid, true),
		zoomMin: clamp(input.zoomMin, 0.25, 4, 0.5),
		zoomMax: clamp(input.zoomMax, 4, 64, 40),
		allowDownload: bool(input.allowDownload, true),
		maxOnline: int(input.maxOnline, 2, 5000, 200),
		palette: (() => {
			const list = uniq((Array.isArray(input.palette) ? input.palette : PALETTE).filter((c) => PALETTE.includes(c)));
			return list.length ? list : [...PALETTE];
		})(),
		access: defaultAccess({ ...(preset.access || {}), ...(input.access || {}) }),
		energy: defaultEnergy({ ...(preset.energy || {}), ...(input.energy || {}) }),
		tools: (() => {
			const base = preset.tools || toolDefaults();
			const patch = input.tools && typeof input.tools === 'object' ? input.tools : {};
			const out = {};
			for (const tool of TOOLS) {
				const src = { ...base[tool], ...(patch[tool] || {}) };
				out[tool] = {
					enabled: bool(src.enabled, false),
					cost: int(src.cost, 0, 100, 1),
					cooldownMs: int(src.cooldownMs, 0, 600000, 0),
					maxSize: int(src.maxSize, 1, 65536, 1),
					minRole: pick(WORLD_ROLES, src.minRole, 'member'),
					dailyLimit: int(src.dailyLimit, 0, 1000000, 0),
					allowInProtected: bool(src.allowInProtected, false)
				};
			}
			return out;
		})(),
		protection: defaultProtection({ ...(preset.protection || {}), ...(input.protection || {}) }),
		chat: defaultChat({ ...(preset.chat || {}), ...(input.chat || {}) }),
		battle: preset.battle ? { ...preset.battle, roundStartedAt: t, scores: {} } : null,
		members: {},
		pixels: {},
		pixelHistory: [],
		snapshots: [],
		arts: {},
		heat: {},
		stats: { pixels: 0, players: {}, days: {} },
		localLeaderboard: {},
		lifecycle: defaultLifecycle({ ...(preset.lifecycle || {}), ...(input.lifecycle || {}) }),
		catalog: defaultCatalog({ ...(preset.catalog || {}), ...(input.catalog || {}) }),
		createdAt: t,
		updatedAt: t
	};
}

export function officialWorld() {
	const world = createWorld(
		{
			id: 'official',
			name: 'Официальный мир',
			description: 'Постоянный холст с глобальной прогрессией, рейтингом и автоматическими событиями.',
			icon: '🌍',
			type: 'official',
			preset: 'free_canvas',
			infinite: true,
			width: 1000,
			height: 1000,
			palette: [...PALETTE],
			energy: { mode: 'cooldown', cooldownMs: 2500, maxEnergy: 30, startEnergy: 15 },
			protection: { maxAreas: 0, maxPercent: 0, unlimited: false },
			chat: { enabled: true, whoCanWrite: 'member', slowModeMs: 3000 },
			lifecycle: { state: 'active', trialUntil: null }
		},
		null
	);
	world.tools.fill.enabled = false;
	world.tools.move.enabled = false;
	world.tools.protect.enabled = false;
	world.museum = [];
	world.regions = [];
	return world;
}

export function createUser(input = {}) {
	const t = now();
	return {
		id: input.id || id('usr'),
		nick: clean(input.nick, 24),
		password: input.password,
		role: pick(GLOBAL_ROLES, input.role, 'user'),
		verified: bool(input.verified, false),
		createdAt: t,
		lastSeenAt: t,
		activeMs: 0,
		xp: 0,
		level: 1,
		officialPixels: 0,
		usefulPixels: 0,
		communityPixels: 0,
		worldsCreated: 0,
		worldSlots: 1,
		visitedWorlds: [],
		favorites: [],
		subscriptions: [],
		achievements: [],
		titles: [],
		eventsCompleted: 0,
		questsCompleted: 0,
		inventory: { coins: 0, items: {} },
		localItems: {},
		energy: {},
		toolUsage: {},
		daily: null,
		season: { id: null, pixels: 0 },
		strikes: [],
		ban: null,
		mutedUntil: 0
	};
}

export function freshDb() {
	const official = officialWorld();
	return {
		version: 4,
		users: {},
		sessions: {},
		worlds: { official },
		chats: { official: [] },
		reports: [],
		modQueue: [],
		audit: [],
		events: { active: [], history: [], lastRun: {} },
		season: { id: null, startedAt: now(), endsAt: null, leaderboard: [] },
		shop: { refreshedAt: 0, offers: [] },
		museum: [],
		automation: { lastTickAt: 0, log: [] }
	};
}

export function migrate(raw) {
	const fresh = freshDb();
	if (!raw || typeof raw !== 'object') return fresh;
	const db = { ...fresh, ...raw };
	db.version = 4;
	db.users = db.users && typeof db.users === 'object' ? db.users : {};
	db.sessions = db.sessions && typeof db.sessions === 'object' ? db.sessions : {};
	db.worlds = db.worlds && typeof db.worlds === 'object' ? db.worlds : {};
	db.chats = db.chats && typeof db.chats === 'object' ? db.chats : {};
	db.reports = Array.isArray(db.reports) ? db.reports : [];
	db.modQueue = Array.isArray(db.modQueue) ? db.modQueue : [];
	db.audit = Array.isArray(db.audit) ? db.audit : [];
	db.museum = Array.isArray(db.museum) ? db.museum : [];
	db.events = db.events && typeof db.events === 'object' ? db.events : fresh.events;
	db.events.active = Array.isArray(db.events.active) ? db.events.active : [];
	db.events.history = Array.isArray(db.events.history) ? db.events.history : [];
	db.events.lastRun = db.events.lastRun && typeof db.events.lastRun === 'object' ? db.events.lastRun : {};
	db.season = db.season && typeof db.season === 'object' ? db.season : fresh.season;
	db.shop = db.shop && typeof db.shop === 'object' ? db.shop : fresh.shop;
	db.automation = db.automation && typeof db.automation === 'object' ? db.automation : fresh.automation;

	for (const [uid, raw2] of Object.entries(db.users)) {
		const base = createUser({ id: uid, nick: raw2.nick, password: raw2.password, role: raw2.role, verified: raw2.verified });
		const user = { ...base, ...raw2 };
		user.inventory = { coins: Number(raw2.inventory?.coins || 0), items: raw2.inventory?.items || {} };
		user.achievements = Array.isArray(raw2.achievements) ? raw2.achievements : [];
		user.energy = raw2.energy && typeof raw2.energy === 'object' ? raw2.energy : {};
		user.toolUsage = raw2.toolUsage && typeof raw2.toolUsage === 'object' ? raw2.toolUsage : {};
		user.visitedWorlds = Array.isArray(raw2.visitedWorlds) ? raw2.visitedWorlds : [];
		user.favorites = Array.isArray(raw2.favorites) ? raw2.favorites : [];
		user.subscriptions = Array.isArray(raw2.subscriptions) ? raw2.subscriptions : [];
		user.strikes = Array.isArray(raw2.strikes) ? raw2.strikes : [];
		user.season = raw2.season && typeof raw2.season === 'object' ? raw2.season : { id: null, pixels: 0 };
		db.users[uid] = user;
	}

	if (!db.worlds.official) db.worlds.official = officialWorld();
	for (const [wid, raw2] of Object.entries(db.worlds)) {
		const isOfficial = wid === 'official' || raw2.type === 'official';
		const base = isOfficial ? officialWorld() : createWorld({ id: wid, name: raw2.name, preset: raw2.preset }, raw2.ownerId || null);
		const world = { ...base, ...raw2 };
		world.id = wid;
		world.type = isOfficial ? 'official' : 'community';
		world.width = int(raw2.width, 32, 100000, base.width);
		world.height = int(raw2.height, 32, 100000, base.height);
		world.infinite = typeof raw2.infinite === 'boolean' ? raw2.infinite : base.infinite;
		world.spawn = int(raw2.spawn, 32, 100000, SPAWN_SIZE);
		world.palette = Array.isArray(raw2.palette) && raw2.palette.length ? uniq(raw2.palette.filter((c) => PALETTE.includes(c))) : base.palette;
		if (!world.palette.length) world.palette = [...PALETTE];
		world.access = defaultAccess({ ...base.access, ...(raw2.access || {}) });
		world.energy = defaultEnergy({ ...base.energy, ...(raw2.energy || {}), ...(raw2.cooldownMs ? { cooldownMs: raw2.cooldownMs } : {}), ...(raw2.maxEnergy ? { maxEnergy: raw2.maxEnergy } : {}) });
		world.tools = createWorld({ id: wid, preset: world.preset, tools: raw2.tools || {} }, world.ownerId).tools;
		world.protection = defaultProtection({ ...base.protection, ...(raw2.protection || {}) });
		world.chat = defaultChat({ ...base.chat, ...(raw2.chat || {}) });
		world.catalog = defaultCatalog({ ...base.catalog, ...(raw2.catalog || {}) });
		world.lifecycle = defaultLifecycle({ ...base.lifecycle, ...(raw2.lifecycle || {}) });
		if (raw2.archivedAt) world.lifecycle.archivedAt = raw2.archivedAt, world.lifecycle.state = 'archived';
		world.members = raw2.members && typeof raw2.members === 'object' ? raw2.members : {};
		world.pixels = raw2.pixels && typeof raw2.pixels === 'object' ? raw2.pixels : {};
		world.pixelHistory = Array.isArray(raw2.pixelHistory) ? raw2.pixelHistory : [];
		world.snapshots = Array.isArray(raw2.snapshots) ? raw2.snapshots : [];
		world.heat = raw2.heat && typeof raw2.heat === 'object' ? raw2.heat : {};
		world.stats = raw2.stats && typeof raw2.stats === 'object' ? raw2.stats : { pixels: Object.keys(world.pixels).length, players: {}, days: {} };
		world.localLeaderboard = raw2.localLeaderboard && typeof raw2.localLeaderboard === 'object' ? raw2.localLeaderboard : {};
		world.arts = (() => {
			const out = {};
			for (const [aid, art] of Object.entries(raw2.arts && typeof raw2.arts === 'object' ? raw2.arts : {})) {
				out[aid] = {
					id: aid,
					name: clean(art.name, 48) || 'Арт',
					description: clean(art.description, 200),
					x: int(art.x, 0, 100000, 0),
					y: int(art.y, 0, 100000, 0),
					width: int(art.width, 1, 100000, 1),
					height: int(art.height, 1, 100000, 1),
					ownerId: art.ownerId || null,
					authors: Array.isArray(art.authors) ? art.authors : art.ownerId ? [art.ownerId] : [],
					level: pick(PROTECTION_LEVELS, art.level, 'authors'),
					status: pick(['pending', 'approved', 'rejected'], art.status, 'approved'),
					until: art.until ?? null,
					createdAt: Number(art.createdAt || now()),
					versions: Array.isArray(art.versions) ? art.versions : []
				};
			}
			return out;
		})();
		if (isOfficial) {
			world.museum = Array.isArray(raw2.museum) ? raw2.museum : [];
			world.regions = Array.isArray(raw2.regions) ? raw2.regions : [];
		}
		db.worlds[wid] = world;
		db.chats[wid] = Array.isArray(db.chats[wid]) ? db.chats[wid] : [];
	}
	return db;
}
