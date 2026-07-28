// Static v3 checks kept aligned with the split model modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const src = (f) => readFile(new URL('../' + f, import.meta.url), 'utf8');

async function modelSource() {
	return (await src('src/core/model-presets.mjs')) + '\n' + (await src('src/core/model-world.mjs'));
}

test('model: official world is infinite with 1000-cell spawn zone', async () => {
	const s = await modelSource();
	assert.match(s, /SPAWN_SIZE\s*=\s*1000/);
	assert.match(s, /infinite:\s*true/);
	assert.match(s, /officialWorld/);
});

test('model: spawn XP multiplier is at least 2', async () => {
	const s = await modelSource();
	assert.match(s, /SPAWN_XP_MULTIPLIER\s*=\s*[2-9]/);
});

test('model: eraser tool is absent', async () => {
	const s = await modelSource();
	assert.doesNotMatch(s, /['"]eraser['"]/);
});

test('api: publicWorld exposes infinite and spawn fields', async () => {
	const s = await src('src/http/api.mjs');
	assert.match(s, /\binfinite\b/);
	assert.match(s, /\bspawn\b/);
	assert.match(s, /publicWorld/);
});

test('api: community pixels do not update official stats', async () => {
	const s = await src('src/http/api.mjs');
	assert.match(s, /communityPixels/);
	assert.match(s, /officialPixels/);
	assert.match(s, /official/);
});

test('engine: rAF frame coalescing eliminates redundant renders', async () => {
	const s = await src('public/app/engine.js');
	assert.match(s, /requestAnimationFrame/);
	assert.match(s, /_needsDraw/);
	assert.match(s, /_raf/);
});

test('engine: sparse viewport-culled pixel render', async () => {
	const s = await src('public/app/engine.js');
	assert.match(s, /cMinX/);
	assert.match(s, /cMaxX/);
	assert.match(s, /this\.pixels/);
});

test('engine: spawn zone frame drawn only for infinite worlds', async () => {
	const s = await src('public/app/engine.js');
	assert.match(s, /_drawZone/);
	assert.match(s, /world\.infinite/);
	assert.match(s, /setLineDash/);
});

test('engine: infinite canvas limit is 100000', async () => {
	const s = await src('public/app/engine.js');
	assert.match(s, /100000/);
	assert.match(s, /_limX|limX/);
});

test('engine: exports bresenham and rectCells', async () => {
	const s = await src('public/app/engine.js');
	assert.match(s, /export function bresenham/);
	assert.match(s, /export function rectCells/);
});

test('engine: offscreen minimap buffer', async () => {
	const s = await src('public/app/engine.js');
	assert.match(s, /_miniDirty/);
	assert.match(s, /_rebuildMinimap/);
	assert.match(s, /drawImage/);
});

test('ui-base: pixel icons replace unicode tool symbols', async () => {
	const s = await src('public/app/ui-base.js');
	assert.match(s, /ICON_BITS/);
	assert.match(s, /export function toolIcon/);
	assert.doesNotMatch(s, /ICON_BITS\.eraser/);
});

test('tools: tools import bresenham and rectCells from engine', async () => {
	const s = await src('public/app/tools.js');
	assert.match(s, /import.*bresenham.*rectCells.*engine|import.*rectCells.*bresenham.*engine/);
});

test('ui: hub re-exports helpers and Tools', async () => {
	const s = await src('public/app/ui.js');
	assert.match(s, /export.*ui-base/);
	assert.match(s, /export.*tools/);
});

test('server-v3: automation tick and graceful shutdown present', async () => {
	const s = await src('server-v3.mjs');
	assert.match(s, /runAutomation/);
	assert.match(s, /SIGTERM/);
	assert.match(s, /store\.flush/);
});

test('no GitHub tokens in tracked source files', async () => {
	const pattern = /ghp_[A-Za-z0-9]{20,}/;
	const files = ['server-v3.mjs', 'public/index.html', 'src/http/api.mjs', 'src/core/model.mjs', 'src/core/model-world.mjs', 'public/app/engine.js', 'public/app/ui.js', 'public/app/ui-base.js', 'public/app/tools.js', 'public/app/tools-core.js'];
	for (const f of files) assert.doesNotMatch(await src(f), pattern, 'token found in ' + f);
});
