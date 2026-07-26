// Права, энергия, инструменты, защита артов и автомодерация.
import { PROTECTION_LEVELS, ROLE_WEIGHT } from './model.mjs';
import { HttpError, clamp, now, today } from './util.mjs';

export const isOfficial = (world) => world.type === 'official';
export const isGlobalStaff = (user) => !!user && (user.role === 'admin' || user.role === 'moderator');
export const isOwner = (user, world) => !!user && world.ownerId === user.id;

export function worldRole(user, world) {
	if (!user) return 'guest';
	if (user.role === 'admin') return 'admin';
	if (isOwner(user, world)) return 'owner';
	if (user.role === 'moderator') return 'moderator';
	const member = world.members?.[user.id];
	if (!member) return 'guest';
	if (member.banned) return 'guest';
	return ROLE_WEIGHT[member.role] === undefined ? 'member' : member.role;
}

export const atLeast = (role, required) => (ROLE_WEIGHT[role] ?? 0) >= (ROLE_WEIGHT[required] ?? 0);
export const canManage = (user, world) => atLeast(worldRole(user, world), 'admin');
export const canModerate = (user, world) => atLeast(worldRole(user, world), 'moderator');

export function isArchived(world) {
	return world.lifecycle.state === 'archived' || world.lifecycle.state === 'ended';
}

export function isFrozen(world) {
	return isArchived(world) || world.lifecycle.state === 'frozen';
}

export function isVisible(world, user, session = null) {
	if (!world) return false;
	if (canModerate(user, world)) return true;
	if (isArchived(world)) return false;
	if (isOfficial(world)) return true;
	if (!world.catalog.listed && !session?.unlocked?.includes(world.id) && !world.members?.[user?.id || '']) {
		if (world.access.mode !== 'public') return false;
	}
	switch (world.access.mode) {
		case 'public':
			return true;
		case 'link':
		case 'password':
			return !!session?.unlocked?.includes(world.id) || !!world.members?.[user?.id || ''];
		case 'request':
		case 'invite':
		case 'faction':
			return !!world.members?.[user?.id || ''];
		default:
			return false;
	}
}

export function ensureMember(world, user, role = 'member') {
	if (!user) return null;
	world.members ||= {};
	const existing = world.members[user.id];
	if (existing) {
		existing.lastSeenAt = now();
		return existing;
	}
	world.members[user.id] = {
		userId: user.id,
		role,
		joinedAt: now(),
		lastSeenAt: now(),
		reputation: 0,
		mutedUntil: 0,
		banned: false,
		pixels: 0
	};
	return world.members[user.id];
}

// Сколько энергии восстановилось с последнего действия (ленивый расчёт).
export function energyState(user, world) {
	const config = world.energy;
	user.energy ||= {};
	const t = now();
	const state = user.energy[world.id] || {
		value: Math.min(config.maxEnergy, config.startEnergy),
		at: t,
		spentToday: 0,
		day: today(t)
	};
	if (state.day !== today(t)) {
		state.day = today(t);
		state.spentToday = 0;
	}
	if (config.mode === 'infinite' || config.mode === 'off') {
		state.value = config.maxEnergy;
		state.at = t;
		user.energy[world.id] = state;
		return state;
	}
	const role = worldRole(user, world);
	const multiplier =
		role === 'guest'
			? 1
			: atLeast(role, 'trusted')
				? config.trustedMultiplier
				: t - user.createdAt < 3 * 86400000
					? config.newbieMultiplier
					: 1;
	const baseCooldown = role === 'guest' && config.guestCooldownMs ? config.guestCooldownMs : config.cooldownMs;
	const step = Math.max(200, Math.round(baseCooldown / Math.max(0.1, multiplier)));
	const gained = Math.floor((t - state.at) / step);
	if (gained > 0) {
		state.value = Math.min(config.maxEnergy, state.value + gained);
		state.at = state.value >= config.maxEnergy ? t : state.at + gained * step;
	}
	state.step = step;
	state.max = config.maxEnergy;
	state.mode = config.mode;
	user.energy[world.id] = state;
	return state;
}

export function heatKey(x, y) {
	return `${x >> 4},${y >> 4}`;
}

// При частом перекрашивании одной области стоимость растёт.
export function heatMultiplier(world, x, y) {
	if (!world.energy.heatPenalty) return 1;
	const key = heatKey(x, y);
	const entry = world.heat[key];
	if (!entry) return 1;
	const decayed = Math.max(0, entry.value - (now() - entry.at) / 60000);
	return clamp(1 + decayed / 400, 1, 3, 1);
}

export function bumpHeat(world, x, y, amount = 1) {
	const key = heatKey(x, y);
	const t = now();
	const entry = world.heat[key] || { value: 0, at: t };
	entry.value = Math.max(0, entry.value - (t - entry.at) / 60000) + amount;
	entry.at = t;
	world.heat[key] = entry;
	if (Object.keys(world.heat).length > 4000) {
		for (const [k, v] of Object.entries(world.heat)) if (t - v.at > 3600000) delete world.heat[k];
	}
}

export function toolConfig(world, tool) {
	const config = world.tools[tool];
	if (!config) throw new HttpError(400, 'Неизвестный инструмент');
	if (!config.enabled) throw new HttpError(403, 'Инструмент отключён в этом мире');
	return config;
}

export function toolUsage(user, world, tool) {
	user.toolUsage ||= {};
	const key = `${world.id}:${tool}`;
	const entry = user.toolUsage[key] || { day: today(), count: 0, lastAt: 0 };
	if (entry.day !== today()) {
		entry.day = today();
		entry.count = 0;
	}
	user.toolUsage[key] = entry;
	return entry;
}

export function artAt(world, x, y) {
	for (const art of Object.values(world.arts || {})) {
		if (art.status !== 'approved') continue;
		if (x >= art.x && y >= art.y && x < art.x + art.width && y < art.y + art.height) return art;
	}
	return null;
}

export function effectiveLevel(art) {
	if (art.level === 'timed') {
		return art.until && art.until > now() ? 'authors' : 'none';
	}
	return PROTECTION_LEVELS.includes(art.level) ? art.level : 'authors';
}

// Можно ли рисовать в точке: возвращает { allowed, warn, art }.
export function checkProtection(world, user, x, y, tool) {
	const art = artAt(world, x, y);
	if (!art) return { allowed: true, warn: false, art: null };
	const level = effectiveLevel(art);
	const role = worldRole(user, world);
	const isAuthor = !!user && (art.authors.includes(user.id) || art.ownerId === user.id);
	const toolAllows = world.tools[tool]?.allowInProtected;
	if (canModerate(user, world)) return { allowed: true, warn: false, art };
	switch (level) {
		case 'none':
			return { allowed: true, warn: false, art };
		case 'soft':
			return { allowed: true, warn: true, art };
		case 'guests':
			return { allowed: atLeast(role, 'member') || isAuthor, warn: false, art };
		case 'authors':
			return { allowed: isAuthor || (toolAllows && atLeast(role, 'trusted')), warn: false, art };
		case 'frozen':
			return { allowed: false, warn: false, art };
		default:
			return { allowed: isAuthor, warn: false, art };
	}
}

export function protectedArea(world) {
	let area = 0;
	for (const art of Object.values(world.arts || {})) {
		if (art.status === 'approved' && effectiveLevel(art) !== 'none') area += art.width * art.height;
	}
	return area;
}

export function assertProtectionLimits(world, art) {
	const limits = world.protection;
	if (limits.unlimited) return;
	const arts = Object.values(world.arts || {});
	if (limits.maxAreas && arts.length >= limits.maxAreas) throw new HttpError(409, 'Достигнут лимит защищённых областей');
	const area = art.width * art.height;
	if (area < limits.minArtSize) throw new HttpError(400, `Минимальный размер арта — ${limits.minArtSize} пикселей`);
	const total = world.width * world.height;
	if (limits.maxPercent < 100 && ((protectedArea(world) + area) / total) * 100 > limits.maxPercent) {
		throw new HttpError(409, `Под защитой не может быть больше ${limits.maxPercent}% карты`);
	}
}

// ---------- Автомодерация чата ----------

const GLOBAL_BANNED = ['killyourself', 'убейсебя', 'childporn', 'детскоепорно', 'heroinшоп'];
const LINK_RE = /(https?:\/\/|www\.|t\.me\/|discord\.gg\/)/i;
const MENTION_RE = /@[\wа-яА-ЯёЁ_-]+/g;

function normalize(text) {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]/gu, '')
		.replace(/(.)\1{2,}/gu, '$1$1');
}

// Возвращает решение: { action, score, reasons }
// action: allow | warn | delete | mute | escalate
export function moderateMessage({ text, world, user, recent = [] }) {
	const reasons = [];
	let score = 0;
	const normalized = normalize(text);
	if (LINK_RE.test(text) && !world.chat.allowLinks) {
		reasons.push('links');
		score += 40;
	}
	const mentions = text.match(MENTION_RE) || [];
	if (mentions.length > 4) {
		reasons.push('mass_mentions');
		score += 30;
	}
	if (text.length > 40 && text === text.toUpperCase()) {
		reasons.push('caps');
		score += 15;
	}
	const words = [...world.chat.bannedWords, ...GLOBAL_BANNED];
	for (const word of words) {
		if (!word) continue;
		if (normalized.includes(normalize(word))) {
			reasons.push(`banned_word:${word}`);
			score += GLOBAL_BANNED.includes(word) ? 90 : 50;
		}
	}
	const duplicates = recent.filter((m) => m.userId === user.id && normalize(m.text) === normalized).length;
	if (duplicates >= 2) {
		reasons.push('repeat');
		score += 35;
	}
	const burst = recent.filter((m) => m.userId === user.id && now() - m.at < 10000).length;
	if (burst >= 5) {
		reasons.push('flood');
		score += 45;
	}
	let action = 'allow';
	if (score >= 90) action = 'escalate';
	else if (score >= 60) action = 'mute';
	else if (score >= 35) action = 'delete';
	else if (score >= 15) action = 'warn';
	return { action, score, reasons };
}

// Простая эвристика для массовых перекрашиваний (антигриф).
export function detectGriefing(world, userId, windowMs = 1800000) {
	const since = now() - windowMs;
	const events = world.pixelHistory.filter((e) => e.actorId === userId && e.at >= since);
	const overwrites = events.filter((e) => e.before && e.before.userId && e.before.userId !== userId).length;
	return { total: events.length, overwrites, suspicious: overwrites >= 200 || (events.length >= 400 && overwrites / Math.max(1, events.length) > 0.7) };
}

// Антинакрутка: нереалистичный темп в официальном мире.
export function detectBoosting(world, userId, windowMs = 600000) {
	const since = now() - windowMs;
	const events = world.pixelHistory.filter((e) => e.actorId === userId && e.at >= since);
	if (events.length < 30) return { suspicious: false, rate: 0 };
	const deltas = [];
	for (let i = 1; i < events.length; i += 1) deltas.push(events[i].at - events[i - 1].at);
	const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
	const variance = deltas.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, deltas.length);
	return { suspicious: avg < 250 || variance < 400, rate: Math.round(avg) };
}
