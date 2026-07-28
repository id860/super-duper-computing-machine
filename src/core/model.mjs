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
		brush2: { enabled: true, cost: 4, cooldownMs: 0, maxSize: 4, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		brush3: { enabled: true, cost: 9, cooldownMs: 0, maxSize: 9, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		line: { enabled: true, cost: 1, cooldownMs: 0, maxSize: 64, minRole: 'member', dailyLimit: 0, allowInProtected: false },
		rect: { enabled: true, cost: 1, cooldownMs: 0, maxSize: 48, minRole