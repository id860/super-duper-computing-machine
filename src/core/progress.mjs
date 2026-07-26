// Прогрессия, квесты, достижения, экономика и рейтинги.
// Главный принцип: только официальный мир даёт глобальный опыт/рейтинг/экономику.
import { ACHIEVEMENTS, QUEST_POOL, SHOP_ITEMS } from './model.mjs';
import { now, today } from './util.mjs';

const COMMUNITY_NOTICE = 'Активность в мирах сообщества не влияет на глобальный рейтинг, достижения и экономику.';

// -------- уровни --------
export function xpForLevel(level) {
	if (level <= 1) return 0;
	return Math.round(80 * Math.pow(level - 1, 1.5));
}

export function levelFromXp(xp) {
	let level = 1;
	while (level < 200 && xpForLevel(level + 1) <= xp) level += 1;
	return level;
}

export function seasonId(date = now()) {
	const d = new Date(date);
	return `${d.getUTCFullYear()}-S${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

// -------- ежедневные задания --------
function pickDailyQuests(day, limit = 4) {
	const pool = [...QUEST_POOL];
	const out = [];
	let seed = Number(day.replace(/-/g, '')) || 1;
	while (out.length < limit && pool.length) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		const index = seed % pool.length;
		out.push(pool.splice(index, 1)[0]);
	}
	return out;
}

export function dailyState(user) {
	const day = today();
	if (!user.daily || user.daily.day !== day) {
		user.daily = {
			day,
			colors: [],
			quests: pickDailyQuests(day).map((q) => ({ id: q.id, progress: 0, claimed: false }))
		};
	}
	return user.daily;
}

export function questView(user) {
	const state = dailyState(user);
	return {
		day: state.day,
		quests: state.quests.map((q) => {
			const def = QUEST_POOL.find((x) => x.id === q.id);
			return { id: q.id, title: def?.title, metric: def?.metric, target: def?.target, reward: def?.reward, progress: q.progress, claimed: q.claimed };
		})
	};
}

export function trackQuest(user, metric, amount = 1) {
	const state = dailyState(user);
	let changed = false;
	for (const q of state.quests) {
		if (q.claimed) continue;
		const def = QUEST_POOL.find((x) => x.id === q.id);
		if (!def || def.metric !== metric) continue;
		q.progress = Math.min(def.target, q.progress + amount);
		changed = true;
	}
	return changed;
}

function raiseQuest(user, metric, value) {
	const state = dailyState(user);
	for (const q of state.quests) {
		if (q.claimed) continue;
		const def = QUEST_POOL.find((x) => x.id === q.id);
		if (!def || def.metric !== metric) continue;
		q.progress = Math.min(def.target, Math.max(q.progress, value));
	}
}

export function claimQuest(user, questId) {
	const state = dailyState(user);
	const q = state.quests.find((x) => x.id === questId);
	if (!q) return { error: 404, message: 'Задание не найдено' };
	if (q.claimed) return { error: 409, message: 'Награда уже получена' };
	const def = QUEST_POOL.find((x) => x.id === questId);
	if (!def || q.progress < def.target) return { error: 400, message: 'Задание ещё не выполнено' };
	q.claimed = true;
	const levelBefore = user.level;
	user.inventory.coins += def.reward.coins || 0;
	if (def.reward.xp) addXp(user, def.reward.xp);
	user.questsCompleted = Number(user.questsCompleted || 0) + 1;
	const achievements = grantAchievements(user);
	return { claimed: true, reward: def.reward, coins: user.inventory.coins, xp: user.xp, level: user.level, levelUp: user.level > levelBefore, achievements };
}

// -------- достижения --------
export function grantAchievements(user) {
	const unlocked = [];
	for (const a of ACHIEVEMENTS) {
		if (user.achievements.includes(a.key)) continue;
		if (Number(user[a.metric] || 0) >= a.target) {
			user.achievements.push(a.key);
			unlocked.push(a.key);
		}
	}
	return unlocked;
}

function addXp(user, xp) {
	user.xp = Number(user.xp || 0) + xp;
	const level = levelFromXp(user.xp);
	user.level = Math.max(user.level || 1, level);
}

// -------- единый обработчик начислений --------
export function awardPixels(user, world, count, meta = {}) {
	const t = now();
	const day = today();
	user.lastSeenAt = t;

	// Локальная статистика обновляется в любом мире.
	world.stats.pixels = Object.keys(world.pixels).length;
	world.stats.players[user.id] = Number(world.stats.players[user.id] || 0) + count;
	world.stats.days[day] = Number(world.stats.days[day] || 0) + count;
	world.localLeaderboard[user.id] = Number(world.localLeaderboard[user.id] || 0) + count;
	if (world.members[user.id]) world.members[user.id].pixels = Number(world.members[user.id].pixels || 0) + count;
	const local = { pixels: world.localLeaderboard[user.id] };

	if (world.type !== 'official') {
		// Миры сообщества: только локальная статистика, без глобальной экономики.
		user.communityPixels = Number(user.communityPixels || 0) + count;
		return { scope: 'community', xp: 0, coins: 0, levelUp: false, achievements: [], local };
	}

	// Официальный мир: глобальная прогрессия.
	const levelBefore = user.level;
	user.officialPixels = Number(user.officialPixels || 0) + count;
	const xp = count * 2;
	addXp(user, xp);
	const coins = Math.max(1, Math.floor(count / 2));
	user.inventory.coins += coins;
	if (!user.season || user.season.id !== seasonId(t)) user.season = { id: seasonId(t), pixels: 0 };
	user.season.pixels += count;

	// Квесты.
	trackQuest(user, 'official_pixels', count);
	trackQuest(user, 'area_progress', meta.area || count);
	if (meta.event) trackQuest(user, 'event_pixels', count);
	if (Array.isArray(meta.colors) && meta.colors.length) {
		const state = dailyState(user);
		for (const color of meta.colors) if (color && !state.colors.includes(color)) state.colors.push(color);
		raiseQuest(user, 'colors_used', state.colors.length);
	}

	const achievements = grantAchievements(user);
	return { scope: 'official', xp, coins, levelUp: user.level > levelBefore, achievements, local };
}

// -------- магазин --------
export function buyItem(user, key) {
	const item = SHOP_ITEMS.find((i) => i.key === key);
	if (!item) return { error: 404, message: 'Товар не найден' };
	if (item.type === 'cosmetic' && user.inventory.items[key]) return { error: 409, message: 'Уже куплено' };
	if (Number(user.inventory.coins || 0) < item.price) return { error: 402, message: 'Недостаточно монет' };
	user.inventory.coins -= item.price;
	user.inventory.items[key] = Number(user.inventory.items[key] || 0) + 1;
	if (key === 'world_slot') user.worldSlots = Number(user.worldSlots || 1) + 1;
	return { bought: true, key, coins: user.inventory.coins, worldSlots: user.worldSlots, items: user.inventory.items };
}

// -------- статистика и рейтинги --------
export function globalStats(user) {
	return {
		level: user.level,
		xp: user.xp,
		currentLevelXp: xpForLevel(user.level),
		nextLevelXp: xpForLevel(user.level + 1),
		officialPixels: user.officialPixels,
		coins: user.inventory.coins,
		achievements: user.achievements,
		titles: user.titles,
		eventsCompleted: user.eventsCompleted,
		questsCompleted: user.questsCompleted,
		season: user.season
	};
}

export function communityStats(user, worlds = {}) {
	const list = Object.values(worlds).filter((w) => w.type === 'community');
	const perWorld = [];
	let localPixels = 0;
	for (const world of list) {
		const pixels = Number(world.localLeaderboard?.[user.id] || 0);
		if (pixels > 0) {
			localPixels += pixels;
			perWorld.push({ worldId: world.id, name: world.name, pixels });
		}
	}
	return {
		communityPixels: user.communityPixels,
		localPixels,
		worldsCreated: user.worldsCreated,
		ownedWorlds: list.filter((w) => w.ownerId === user.id).length,
		perWorld: perWorld.sort((a, b) => b.pixels - a.pixels).slice(0, 20),
		notice: COMMUNITY_NOTICE
	};
}

export function leaderboard(users, limit = 50) {
	return Object.values(users)
		.filter((u) => !u.ban)
		.sort((a, b) => b.xp - a.xp || b.officialPixels - a.officialPixels)
		.slice(0, limit)
		.map((u, index) => ({ rank: index + 1, id: u.id, nick: u.nick, level: u.level, xp: u.xp, officialPixels: u.officialPixels, titles: u.titles }));
}

export function localLeaderboard(world, users = {}, limit = 50) {
	const board = world.localLeaderboard || {};
	return Object.entries(board)
		.sort((a, b) => b[1] - a[1])
		.slice(0, limit)
		.map(([uid, pixels], index) => ({ rank: index + 1, id: uid, nick: users[uid]?.nick || '—', pixels }));
}
