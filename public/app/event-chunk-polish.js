// Event progress normalization and a blue adaptation of OWOP's unloaded pattern.
import { PixelEngine } from './engine.js';
import { api } from './api.js';

const CHUNK_SIZE = 86;
const TILE_SIZE = 16;
const MAX_VISIBLE_CHUNKS = 1600;

export function eventProgress(event, userId) {
  const progress = event?.progress;
  const values = [
    event?.myProgress,
    typeof progress === 'number' || typeof progress === 'string' ? progress : undefined,
    userId && progress && typeof progress === 'object' ? progress[userId] : undefined,
    userId && event?.progressByUser && typeof event.progressByUser === 'object' ? event.progressByUser[userId] : undefined
  ];
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return Math.max(0, number);
  }
  return 0;
}

// Same 16×16 two-colour diagonal sequence as OurSources/owop-client's
// src/img/unloaded.png, recoloured for PixelFront instead of copying its grey palette.
export function bluePatternCell(x, y) {
  return ((x + y) % 4 + 4) % 4 >= 2 ? '#b8d2ff' : '#e7f0ff';
}

const previousEvents = api.events.bind(api);
api.events = async () => {
  const result = await previousEvents();
  const userId = api.state.me?.id;
  const active = (result.active || []).map((event) => ({ ...event, myProgress: eventProgress(event, userId) }));
  api.state._events = active;
  return { ...result, active };
};

let patternCanvas = null;
const patterns = new WeakMap();
function bluePattern(ctx) {
  if (!patternCanvas) {
    patternCanvas = document.createElement('canvas');
    patternCanvas.width = patternCanvas.height = TILE_SIZE;
    const tile = patternCanvas.getContext('2d');
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        tile.fillStyle = bluePatternCell(x, y);
        tile.fillRect(x, y, 1, 1);
      }
    }
  }
  let pattern = patterns.get(ctx);
  if (!pattern) { pattern = ctx.createPattern(patternCanvas, 'repeat'); patterns.set(ctx, pattern); }
  return pattern;
}

function drawBlueUnloaded(ctx, engine) {
  if (!engine.world?.infinite) return;
  const span = CHUNK_SIZE * engine.scale;
  if (!(span > 0)) return;
  const x0 = Math.floor(-engine.offsetX / span), x1 = Math.floor((engine.viewW - engine.offsetX) / span);
  const y0 = Math.floor(-engine.offsetY / span), y1 = Math.floor((engine.viewH - engine.offsetY) / span);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_VISIBLE_CHUNKS) return;
  const loaded = engine._validatedChunks || engine._loadedChunks;
  const rects = [];
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    if (loaded?.has(`${cx}:${cy}`)) continue;
    rects.push({ x: engine.offsetX + cx * span, y: engine.offsetY + cy * span });
  }
  if (!rects.length) return;
  const pattern = bluePattern(ctx);
  if (!pattern) return;
  const ox = engine.offsetX % TILE_SIZE, oy = engine.offsetY % TILE_SIZE;
  ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = pattern;
  for (const rect of rects) ctx.fillRect(rect.x - ox, rect.y - oy, span, span);
  ctx.restore();
}

// Loaded after experience-patch and before regression-fixes: blue unloaded
// chunks replace the grey veil, while chunk borders/selection remain on top.
const previousSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
  previousSetWorld.apply(this, args);
  const previousOverlay = this.onOverlay;
  this.onOverlay = (ctx) => { previousOverlay?.(ctx); drawBlueUnloaded(ctx, this); };
};
