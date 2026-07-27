// Minimap navigation. Clicking or dragging on the minimap recentres the main
// canvas, which is the fastest way to cross an infinite world. The coordinate
// maths is exported separately so it can be unit tested without a DOM.
import { PixelEngine } from './engine.js';

// Converts a point in minimap canvas pixels into world cells, using the bounds
// the engine used when it rasterised the minimap buffer.
export function minimapPointToWorld(point, box) {
	const { scale, ox, oy, bx0, by0 } = box || {};
	if (!scale || !Number.isFinite(scale)) return null;
	return {
		x: Math.round((point.mx - ox) / scale + bx0),
		y: Math.round((point.my - oy) / scale + by0)
	};
}

function installMinimapNav(engine) {
	const map = engine.minimap;
	if (!map || engine._miniNavBound || typeof map.addEventListener !== 'function') return;
	engine._miniNavBound = true;
	map.style.cursor = 'crosshair';
	map.title = 'Клик или перетаскивание — быстрый переход по миру';
	let dragging = false;
	const jump = (event) => {
		const rect = map.getBoundingClientRect();
		if (!rect.width || !rect.height) return;
		const point = {
			mx: (event.clientX - rect.left) * (map.width / rect.width),
			my: (event.clientY - rect.top) * (map.height / rect.height)
		};
		const target = minimapPointToWorld(point, {
			scale: engine._miniScale, ox: engine._miniOx, oy: engine._miniOy, bx0: engine._mbx0, by0: engine._mby0
		});
		if (!target) return;
		engine.center(Math.max(0, target.x), Math.max(0, target.y));
	};
	map.addEventListener('pointerdown', (event) => {
		event.preventDefault();
		dragging = true;
		map.setPointerCapture?.(event.pointerId);
		jump(event);
	});
	map.addEventListener('pointermove', (event) => { if (dragging) jump(event); });
	const release = (event) => {
		dragging = false;
		if (map.hasPointerCapture?.(event.pointerId)) map.releasePointerCapture(event.pointerId);
	};
	map.addEventListener('pointerup', release);
	map.addEventListener('pointercancel', release);
	map.addEventListener('contextmenu', (event) => event.preventDefault());
}

const previousSetWorld = PixelEngine.prototype.setWorld;
PixelEngine.prototype.setWorld = function (...args) {
	previousSetWorld.apply(this, args);
	installMinimapNav(this);
};
