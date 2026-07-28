import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bluePatternCell, eventProgress } from '../public/app/event-chunk-polish.js';

test('event progress resolves the signed-in user and never returns NaN', () => {
  assert.equal(eventProgress({ progress: { usr_a: 17 } }, 'usr_a'), 17);
  assert.equal(eventProgress({ myProgress: '8', progress: {} }, 'usr_a'), 8);
  assert.equal(eventProgress({ progress: {} }, 'usr_a'), 0);
  assert.equal(eventProgress({ progress: null }, 'usr_a'), 0);
  assert.ok(Number.isFinite(eventProgress({ progress: { usr_a: 'broken' } }, 'usr_a')));
});

test('blue unloaded pattern preserves OWOP diagonal sequence with blue colours', () => {
  assert.equal(bluePatternCell(0, 0), '#e7f0ff');
  assert.equal(bluePatternCell(2, 0), '#b8d2ff');
  assert.equal(bluePatternCell(1, 1), '#b8d2ff');
  assert.equal(bluePatternCell(3, 1), '#e7f0ff');
  const colors = new Set(Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => bluePatternCell(x, y))).flat());
  assert.deepEqual([...colors].sort(), ['#b8d2ff', '#e7f0ff']);
});

test('polish layer loads between experience and regression overlays', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('event-chunk-polish.js') > html.indexOf('experience-patch.js'));
  assert.ok(html.indexOf('event-chunk-polish.js') < html.indexOf('regression-fixes.js'));
});
