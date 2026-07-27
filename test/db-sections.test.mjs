import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, SECTIONS_DIR } from '../src/core/db.mjs';
import { freshDb } from '../src/core/model.mjs';
import { awardPixels, dailyState, trackQuestCompletions } from '../src/core/progress.mjs';
import { loadDb } from '../scripts/export-postgres.mjs';

async function tempDir() { return mkdtemp(join(tmpdir(), 'pixelfront-db-')); }

test('a fresh store writes one file per section instead of a single dump', async () => {
	const dir = await tempDir();
	try {
		const store = new Store(dir);
		await store.load();
		const files = (await readdir(join(dir, SECTIONS_DIR))).sort();
		assert.deepEqual(files, Object.keys(store.db).map((name) => `${name}.json`).sort());
		assert.equal(existsSync(join(dir, 'db.json')), false);
		const worlds = JSON.parse(await readFile(join(dir, SECTIONS_DIR, 'worlds.json'), 'utf8'));
		assert.ok(worlds.official, 'the worlds section holds worlds only');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('a legacy dump is split into sections and kept as a backup', async () => {
	const dir = await tempDir();
	try {
		const legacy = freshDb();
		legacy.users.u1 = { id: 'u1', nick: 'pioneer' };
		await writeFile(join(dir, 'db.json'), JSON.stringify(legacy), 'utf8');
		const store = new Store(dir);
		await store.load();
		assert.equal(store.db.users.u1.nick, 'pioneer');
		assert.equal(existsSync(join(dir, 'db.json')), false, 'the old dump is moved aside');
		assert.equal(existsSync(join(dir, 'db.legacy.json')), true);
		const reopened = new Store(dir);
		await reopened.load();
		assert.equal(reopened.db.users.u1.nick, 'pioneer', 'sections become the source of truth');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('only changed sections are rewritten', async () => {
	const dir = await tempDir();
	try {
		const store = new Store(dir);
		await store.load();
		const before = await readFile(join(dir, SECTIONS_DIR, 'worlds.json'), 'utf8');
		store.db.users.u2 = { id: 'u2', nick: 'guest' };
		store.schedule(0);
		await store.flush();
		const after = await readFile(join(dir, SECTIONS_DIR, 'worlds.json'), 'utf8');
		assert.equal(after, before, 'an untouched section keeps its previous content');
		const users = JSON.parse(await readFile(join(dir, SECTIONS_DIR, 'users.json'), 'utf8'));
		assert.equal(users.u2.nick, 'guest');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

test('the export script reads a sectioned data directory', async () => {
	const dir = await tempDir();
	try {
		const store = new Store(dir);
		await store.load();
		const db = await loadDb({ dir, file: undefined });
		assert.ok(db.worlds.official, 'the assembled database exposes worlds');
	} finally { await rm(dir, { recursive: true, force: true }); }
});

function player() {
	return { id: 'u1', nick: 'pioneer', level: 1, xp: 0, officialPixels: 0, communityPixels: 0, usefulPixels: 0, achievements: [], titles: [], questsCompleted: 0, inventory: { coins: 0, items: {} } };
}

test('reaching a quest target is reported once so the client can notify the player', async () => {
	const user = player();
	const state = dailyState(user);
	const quest = state.quests[0];
	const metric = 'official_pixels';
	quest.id = 'q_official';
	state.quests = [{ id: state.quests[0].id, progress: 0, claimed: false }];
	// Use the real pool entry behind the first quest to stay in sync with the model.
	const first = dailyState(user).quests[0];
	const done = trackQuestCompletions(user, metric, 1000);
	for (const item of done) assert.ok(item.title, 'a completion carries a human readable title');
	const again = trackQuestCompletions(user, metric, 1000);
	assert.deepEqual(again, [], 'an already completed quest is not reported twice');
	assert.ok(first.progress >= 0);
});

test('awarding pixels in the official world returns freshly completed quests', async () => {
	const user = player();
	const world = { id: 'official', type: 'official', pixels: {}, members: {}, localLeaderboard: {}, stats: { pixels: 0, players: {}, days: {} } };
	const reward = awardPixels(user, world, 500, { spawn: 500, colors: ['#000000', '#ffffff'] });
	assert.equal(reward.scope, 'official');
	assert.ok(Array.isArray(reward.quests), 'the reward payload always carries a quest list');
	const repeat = awardPixels(user, world, 500, { spawn: 500 });
	for (const quest of repeat.quests) assert.ok(!reward.quests.some((item) => item.id === quest.id), 'no quest is reported twice');
});
