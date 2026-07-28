import { bool, clamp, clean, id, int, now, pick, uniq } from './util.mjs';
import { ACCESS_MODES, ENERGY_MODES, GLOBAL_ROLES, LIFECYCLE_STATES, PALETTE, PRESETS, PROTECTION_LEVELS, SPAWN_SIZE, TOOLS, WORLD_ROLES } from './model-presets.mjs';
import { defaultAccess, defaultCatalog, defaultChat, defaultEnergy, defaultLifecycle, defaultProtection, toolDefaults } from './model-presets.mjs';

export function createWorld(input = {}, ownerId = null) {
 const t = now();
 const presetKey = pick(Object.keys(PRESETS), input.preset, 'free_canvas');
 const preset = PRESETS[presetKey].patch;
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
  palette: (() => { const list = uniq((Array.isArray(input.palette) ? input.palette : PALETTE).filter((c) => PALETTE.includes(c))); return list.length ? list : [...PALETTE]; })(),
  access: defaultAccess({ ...(preset.access || {}), ...(input.access || {}) }),
  energy: defaultEnergy({ ...(preset.energy || {}), ...(input.energy || {}) }),
  tools: (() => {
   const base = preset.tools || toolDefaults();
   const patch = input.tools && typeof input.tools === 'object' ? input.tools : {};
   const out = {};
   for (const tool of TOOLS) {
    const src = { ...base[tool], ...(patch[tool] || {}) };
    out[tool] = { enabled: bool(src.enabled, false), cost: int(src.cost, 0, 100, 1), cooldownMs: int(src.cooldownMs, 0, 600000, 0), maxSize: int(src.maxSize, 1, 65536, 1), minRole: pick(WORLD_ROLES, src.minRole, 'member'), dailyLimit: int(src.dailyLimit, 0, 1000000, 0), allowInProtected: bool(src.allowInProtected, false) };
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
 const world = createWorld({
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
  energy: { mode: 'infinite', cooldownMs: 2500, maxEnergy: 30, startEnergy: 15 },
  protection: { maxAreas: 0, maxPercent: 0, unlimited: false },
  chat: { enabled: true, whoCanWrite: 'member', slowModeMs: 3000 },
  lifecycle: { state: 'active', trialUntil: null }
 }, null);
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
