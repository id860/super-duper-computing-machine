import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const src = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('refreshed design is loaded after legacy and cosmetic layers', async () => {
  const html = await src('public/index.html');
  const cosmetics = html.indexOf('cosmetics.css'), refresh = html.indexOf('design-refresh.css');
  assert.ok(cosmetics >= 0 && refresh > cosmetics);
  assert.match(html, /theme-color" content="#111827"/);
});

test('visual refresh keeps keyboard and mobile accessibility contracts', async () => {
  const css = await src('public/design-refresh.css');
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /@media \(max-width:860px\)/);
});
