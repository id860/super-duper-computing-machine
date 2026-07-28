import { clean, int, now, pick } from './util.mjs';
import { PALETTE, PROTECTION_LEVELS, SPAWN_SIZE, defaultAccess, defaultCatalog, defaultChat, defaultEnergy, defaultLifecycle, defaultProtection } from './model-presets.mjs';
import { createUser, createWorld, officialWorld } from './model-world.mjs';

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
  world.palette = Array.isArray(raw2.palette) && raw2.palette.length ? [...new Set(raw2.palette.filter((c) => PALETTE.includes(c)))] : base.palette;
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
    out[aid] = { id: aid, name: clean(art.name, 48) || 'Арт', description: clean(art.description, 200), x: int(art.x, 0, 100000, 0), y: int(art.y, 0, 100000, 0), width: int(art.width, 1, 100000, 1), height: int(art.height, 1, 100000, 1), ownerId: art.ownerId || null, authors: Array.isArray(art.authors) ? art.authors : art.ownerId ? [art.ownerId] : [], level: pick(PROTECTION_LEVELS, art.level, 'authors'), status: pick(['pending', 'approved', 'rejected'], art.status, 'approved'), until: art.until ?? null, createdAt: Number(art.createdAt || now()), versions: Array.isArray(art.versions) ? art.versions : [] };
   }
   return out;
  })();
  if (isOfficial) { world.museum = Array.isArray(raw2.museum) ? raw2.museum : []; world.regions = Array.isArray(raw2.regions) ? raw2.regions : []; }
  db.worlds[wid] = world;
  db.chats[wid] = Array.isArray(db.chats[wid]) ? db.chats[wid] : [];
 }
 return db;
}

function freshDb() {
 const official = officialWorld();
 return { version: 4, users: {}, sessions: {}, worlds: { official }, chats: { official: [] }, reports: [], modQueue: [], audit: [], events: { active: [], history: [], lastRun: {} }, season: { id: null, startedAt: now(), endsAt: null, leaderboard: [] }, shop: { refreshedAt: 0, offers: [] }, museum: [], automation: { lastTickAt: 0, log: [] } };
}
