// Автоматизация: события, сезоны, жизненный цикл миров, снимки, антинакрутка.
import { EVENT_TEMPLATES, SHOP_ITEMS } from './model.mjs';
import { detectBoosting, detectGriefing, isOfficial } from './rules.mjs';
import { leaderboard, seasonId } from './progress.mjs';
import { id, now, today } from './util.mjs';

const DAY = 86400000;

export const LIFECYCLE_TIMINGS = {
	trialMs: Number(process.env.WORLD_TRIAL_MS || 14 * DAY),
	freezeAfterMs: Number(process.env.WORLD_FREEZE_MS || 30 * DAY),
	archiveAfterMs: Number(process.env.WORLD_ARCHIVE_MS || 60 * DAY),
	deleteEmptyAfterMs: Number(process.env.WORLD_DELETE_MS || 120 * DAY),
	snapshotEveryMs: Number(process.env.WORLD_SNAPSHOT_MS || 6 * 3600000)
};

function snapshot(world, kind = 'auto') {
	const entry = {
		id: id('snap'),
		kind,
		at: now(),
		pixels: Object.keys(world.pixels).length,
		data: JSON.stringify(world.pixels)
	};
	world.snapshots.push(entry);
	const limit = Number(process.env.SNAPSHOT_LIMIT || 12);
	if (world.snapshots.length > limit) world.snapshots.splice(0, world.snapshots.length - limit);
	return entry;
}

export function makeSnapshot(world, kind) {
	return snapshot(world, kind);
}

export function isPopular(world) {
	const players = Object.keys(world.stats?.players || {}).length;
	return players >= 25 || world.catalog.subscribers.length >= 15 || world.catalog.promotionScore >= 500;
}

// Продвижение считается по уникальным игрокам и возвратам, а не по числу пикселей.
export function promotionScore(world, reportsByWorld = {}) {
	const players = Object.keys(world.stats?.players || {});
	const unique = players.length;
	const activeDays = Object.keys(world.stats?.days || {}).length;
	const returning = players.filter((uid) => (world.members?.[uid]?.pixels || 0) > 20).length;
	const ratings = Object.values(world.catalog.ratings || {});
	const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 3;
	const reports = reportsByWorld[world.id] || 0;
	const ageDays = Math.max(1, (now() - world.createdAt) / DAY);
	const freshness = Math.max(0.2, 1 - (now() - world.lifecycle.lastActivityAt) / (14 * DAY));
	const score =
		unique * 12 +
		returning * 25 +
		activeDays * 8 +
		world.catalog.subscribers.length * 10 +
		rating * 20 -
		reports * 40 +
		Math.min(60, ageDays);
	return Math.max(0, Math.round(score * freshness));
}

export function refreshShop(db) {
	if (now() - db.shop.refreshedAt < DAY) return false;
	const seed = Number(today().replace(/-/g, ''));
	db.shop.offers = SHOP_ITEMS.map((item, index) => ({
		...item,
		discount: (seed + index) % 5 === 0 ? 20 : 0
	}));
	db.shop.refreshedAt = now();
	return true;
}

export function runEvents(db, emit) {
	const t = now();
	let changed = false;
	for (const event of [...db.events.active]) {
		if (event.endsAt > t) continue;
		event.finishedAt = t;
		const winners = Object.entries(event.progress || {})
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10);
		for (const [userId, value] of winners) {
			const user = db.users[userId];
			if (!user) continue;
			if (value >= event.goalPerPlayer) {
				user.inventory.coins += event.reward.coins;
				user.xp += event.reward.xp;
				user.eventsCompleted = Number(user.eventsCompleted || 0) + 1;
			}
		}
		event.winners = winners.map(([userId, value]) => ({ userId, nick: db.users[userId]?.nick || '—', value }));
		db.events.history.push(event);
		if (db.events.history.length > 100) db.events.history.splice(0, db.events.history.length - 100);
		db.events.active = db.events.active.filter((e) => e.id !== event.id);
		emit?.('official', 'event', { type: 'finished', event: { id: event.id, title: event.title, winners: event.winners } });
		changed = true;
	}

	const online = Object.values(db.users).filter((u) => t - (u.lastSeenAt || 0) < 900000).length;
	for (const template of EVENT_TEMPLATES) {
		const last = Number(db.events.lastRun[template.key] || 0);
		if (t - last < template.everyMs) continue;
		if (template.weekendOnly && ![0, 6].includes(new Date(t).getUTCDay())) continue;
		const event = {
			id: id('evt'),
			key: template.key,
			title: template.title,
			worldId: 'official',
			startedAt: t,
			endsAt: t + template.durationMs,
			// Событие масштабируется под текущий онлайн.
			goalPerPlayer: Math.max(15, Math.round(template.goalPerPlayer * (online > 50 ? 1.5 : online > 10 ? 1 : 0.6))),
			reward: { ...template.reward },
			progress: {}
		};
		db.events.active.push(event);
		db.events.lastRun[template.key] = t;
		emit?.('official', 'event', { type: 'started', event: { id: event.id, title: event.title, endsAt: event.endsAt, goalPerPlayer: event.goalPerPlayer } });
		changed = true;
	}
	return changed;
}

export function trackEventProgress(db, user, count) {
	let touched = false;
	for (const event of db.events.active) {
		event.progress[user.id] = Number(event.progress[user.id] || 0) + count;
		touched = true;
	}
	return touched;
}

export function rotateSeason(db) {
	const current = seasonId();
	if (db.season.id === current) return false;
	if (db.season.id) {
		const top = leaderboard(db.users, 10);
		db.season.leaderboard = top;
		for (const [index, row] of top.entries()) {
			const user = db.users[row.id];
			if (!user) continue;
			const title = index === 0 ? `Лидер сезона ${db.season.id}` : `Топ-10 сезона ${db.season.id}`;
			user.titles = [...new Set([...(user.titles || []), title])].slice(-12);
			user.inventory.coins += index === 0 ? 1500 : 400;
		}
	}
	for (const user of Object.values(db.users)) user.season = { id: current, pixels: 0 };
	db.season = { id: current, startedAt: now(), endsAt: null, leaderboard: db.season.leaderboard || [] };
	return true;
}

// Автоочистка и жизненный цикл миров сообщества.
export function runLifecycle(db, emit, notify) {
	const t = now();
	const reportsByWorld = {};
	for (const report of db.reports) {
		if (report.status === 'open') reportsByWorld[report.worldId] = (reportsByWorld[report.worldId] || 0) + 1;
	}
	let changed = false;
	for (const world of Object.values(db.worlds)) {
		if (isOfficial(world)) {
			if (t - (world.snapshots.at(-1)?.at || 0) > LIFECYCLE_TIMINGS.snapshotEveryMs) {
				snapshot(world, 'auto');
				changed = true;
			}
			continue;
		}
		const life = world.lifecycle;
		const score = promotionScore(world, reportsByWorld);
		if (score !== world.catalog.promotionScore) {
			world.catalog.promotionScore = score;
			changed = true;
		}
		if (t - (world.snapshots.at(-1)?.at || 0) > LIFECYCLE_TIMINGS.snapshotEveryMs && Object.keys(world.pixels).length) {
			snapshot(world, 'auto');
			changed = true;
		}
		if (life.state === 'ended' || life.state === 'archived') {
			if (!Object.keys(world.pixels).length && t - (life.archivedAt || t) > LIFECYCLE_TIMINGS.deleteEmptyAfterMs) {
				delete db.worlds[world.id];
				delete db.chats[world.id];
				changed = true;
			}
			continue;
		}
		if (life.endsAt && life.endsAt <= t) {
			life.state = 'ended';
			life.archivedAt = t;
			life.finalSnapshotId = snapshot(world, 'final').id;
			world.catalog.listed = false;
			emit?.(world.id, 'lifecycle', { state: 'ended', worldId: world.id });
			notify?.(world.ownerId, `Мир «${world.name}» завершён по расписанию, создан финальный снимок.`);
			changed = true;
			continue;
		}
		if (life.state === 'trial' && life.trialUntil && life.trialUntil <= t) {
			const players = Object.keys(world.stats?.players || {}).length;
			life.state = players >= 2 ? 'active' : 'frozen';
			if (life.state === 'frozen') life.frozenAt = t;
			changed = true;
		}
		const idleMs = t - life.lastActivityAt;
		if (isPopular(world)) continue;
		if (life.state === 'active' && idleMs > LIFECYCLE_TIMINGS.freezeAfterMs) {
			life.state = 'frozen';
			life.frozenAt = t;
			notify?.(world.ownerId, `Мир «${world.name}» заморожен из-за неактивности. Зайдите, чтобы вернуть его в строй.`);
			emit?.(world.id, 'lifecycle', { state: 'frozen', worldId: world.id });
			changed = true;
		} else if (life.state === 'frozen' && idleMs > LIFECYCLE_TIMINGS.archiveAfterMs) {
			life.state = 'archived';
			life.archivedAt = t;
			world.catalog.listed = false;
			snapshot(world, 'archive');
			notify?.(world.ownerId, `Мир «${world.name}» перенесён в архив. Его можно восстановить.`);
			emit?.(world.id, 'lifecycle', { state: 'archived', worldId: world.id });
			changed = true;
		}
	}
	return changed;
}

// Автопоиск накрутки и грифа: в очередь модератора попадают только фильтрованные случаи.
export function runAntiCheat(db) {
	let changed = false;
	for (const world of Object.values(db.worlds)) {
		const actors = new Set(world.pixelHistory.slice(-4000).map((e) => e.actorId).filter(Boolean));
		for (const actorId of actors) {
			const grief = detectGriefing(world, actorId);
			if (grief.suspicious) {
				changed = pushQueue(db, { type: 'griefing', priority: 'high', worldId: world.id, userId: actorId, details: grief }) || changed;
			}
			if (isOfficial(world)) {
				const boost = detectBoosting(world, actorId);
				if (boost.suspicious) {
					changed = pushQueue(db, { type: 'boosting', priority: 'critical', worldId: world.id, userId: actorId, details: boost }) || changed;
				}
			}
		}
	}
	return changed;
}

export function pushQueue(db, entry) {
	const key = `${entry.type}:${entry.worldId}:${entry.userId || entry.targetId || ''}`;
	const existing = db.modQueue.find((item) => item.key === key && item.status === 'open');
	if (existing) {
		existing.count += 1;
		existing.updatedAt = now();
		existing.details = entry.details || existing.details;
		return false;
	}
	db.modQueue.push({ id: id('mq'), key, status: 'open', count: 1, createdAt: now(), updatedAt: now(), ...entry });
	if (db.modQueue.length > 5000) db.modQueue.splice(0, db.modQueue.length - 5000);
	return true;
}

export function prioritizeQueue(db) {
	const weight = { critical: 0, high: 1, normal: 2, low: 3, likely_false: 4 };
	return [...db.modQueue]
		.filter((item) => item.status === 'open')
		.sort((a, b) => (weight[a.priority] ?? 2) - (weight[b.priority] ?? 2) || b.count - a.count || a.createdAt - b.createdAt);
}

export function cleanupSessions(db) {
	const t = now();
	let changed = false;
	for (const [key, session] of Object.entries(db.sessions)) {
		if (session.until <= t || !db.users[session.uid]) {
			delete db.sessions[key];
			changed = true;
		}
	}
	return changed;
}

// Главный тик автоматизации официального мира и платформы.
export function runAutomation(db, { emit, notify } = {}) {
	const t = now();
	const results = [];
	if (rotateSeason(db)) results.push('season');
	if (refreshShop(db)) results.push('shop');
	if (runEvents(db, emit)) results.push('events');
	if (runLifecycle(db, emit, notify)) results.push('lifecycle');
	if (runAntiCheat(db)) results.push('anticheat');
	if (cleanupSessions(db)) results.push('sessions');
	db.automation.lastTickAt = t;
	if (results.length) {
		db.automation.log.push({ at: t, tasks: results });
		if (db.automation.log.length > 200) db.automation.log.splice(0, db.automation.log.length - 200);
	}
	return results;
}
