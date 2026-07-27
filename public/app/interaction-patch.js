// Runtime UI patch: stable minimap bounds, compact sidebar toggle and semantic tool glyphs.
import { PixelEngine } from './engine.js';

// The minimap must retain negative viewport coordinates while the camera is
// panned left/up. The former implementation clipped its cached bounds at 0.
PixelEngine.prototype._rebuildMinimap = function (vx0, vy0, vx1, vy1) {
	if (!this.mctx || !this.world) return;
	const mw = this.minimap.width, mh = this.minimap.height;
	const sp = this._spawn();
	let bx0 = 0, by0 = 0, bx1 = sp || 1, by1 = sp || 1;
	for (const [key] of this.pixels) {
		const i = key.indexOf(':');
		const x = +key.slice(0, i), y = +key.slice(i + 1);
		bx0 = Math.min(bx0, x); by0 = Math.min(by0, y);
		bx1 = Math.max(bx1, x + 1); by1 = Math.max(by1, y + 1);
	}
	if (vx0 !== undefined) {
		bx0 = Math.min(bx0, vx0); by0 = Math.min(by0, vy0);
		bx1 = Math.max(bx1, vx1); by1 = Math.max(by1, vy1);
	}
	const padX = (bx1 - bx0) * 0.06 + 8, padY = (by1 - by0) * 0.06 + 8;
	bx0 = Math.floor(bx0 - padX); by0 = Math.floor(by0 - padY);
	bx1 = Math.ceil(bx1 + padX); by1 = Math.ceil(by1 + padY);
	this._mbx0 = bx0; this._mby0 = by0; this._mbx1 = bx1; this._mby1 = by1;
	const scale = Math.min(mw / (bx1 - bx0), mh / (by1 - by0));
	this._miniScale = scale;
	this._miniOx = (mw - (bx1 - bx0) * scale) / 2;
	this._miniOy = (mh - (by1 - by0) * scale) / 2;
	if (!this._mini) this._mini = document.createElement('canvas');
	this._mini.width = mw; this._mini.height = mh;
	const ctx = this._mini.getContext('2d');
	ctx.clearRect(0, 0, mw, mh);
	if (sp) {
		const x = this._miniOx - bx0 * scale, y = this._miniOy - by0 * scale;
		ctx.fillStyle = this.world.background || '#fff';
		ctx.fillRect(x, y, sp * scale, sp * scale);
		if (this.world.infinite) {
			ctx.strokeStyle = 'rgba(37,99,235,.38)'; ctx.lineWidth = 1;
			ctx.strokeRect(x, y, sp * scale, sp * scale);
		}
	}
	for (const [key, cell] of this.pixels) {
		const i = key.indexOf(':');
		const x = +key.slice(0, i), y = +key.slice(i + 1);
		ctx.fillStyle = cell.c;
		ctx.fillRect(this._miniOx + (x - bx0) * scale, this._miniOy + (y - by0) * scale, Math.max(1, scale), Math.max(1, scale));
	}
	this._miniDirty = false;
};

const paths = {
	pixel: 'M7 7h2v2H7z', brush2: 'M5 5h6v6H5z', brush3: 'M4 4h8v8H4z',
	line: 'M4 12 12 4', rect: 'M4 4h8v8H4z', fill: 'M6 4l5 5-3 3-5-5z M11 12h3',
	picker: 'M5 11 11 5m-2-2 2 2M4 12h2', move: 'M8 3v10M3 8h10M6 5l2-2 2 2M6 11l2 2 2-2M5 6 3 8l2 2m6-4 2 2-2 2',
	copy: 'M6 5h6v7H6z M4 4h6', stamp: 'M5 5h6v5H5z M4 12h8',
	template: 'M4 4h8v8H4z M6 4v8M4 7h8', protect: 'M8 3l4 2v3c0 3-2 4-4 5-2-1-4-2-4-5V5z', restore: 'M5 7a4 4 0 1 1 1 4M5 4v3h3'
};
const hotkeys = { pixel: 'E', brush2: 'B', brush3: '3', line: 'L', rect: 'R', fill: 'F', picker: 'P' };
function redrawToolGlyphs() {
	document.querySelectorAll('#tools .tool[data-tool]').forEach((button) => {
		const tool = button.dataset.tool;
		if (button.dataset.redrawn === tool) return;
		button.dataset.redrawn = tool;
		button.replaceChildren();
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('class', 'tool-svg'); svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', paths[tool] || paths.pixel);
		path.setAttribute('fill', tool === 'pixel' || tool === 'brush2' || tool === 'brush3' ? 'currentColor' : 'none');
		path.setAttribute('stroke', 'currentColor'); path.setAttribute('stroke-width', '1.65'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(path); button.appendChild(svg);
		if (hotkeys[tool]) { const key = document.createElement('span'); key.className = 'hotkey-hint'; key.textContent = hotkeys[tool]; button.appendChild(key); }
	});
}
function moveSidebarToggle() {
	const toggle = document.getElementById('sidebarToggle');
	const tabs = document.querySelector('#sidebar .tabs');
	if (!toggle || !tabs || toggle.parentElement === tabs) return;
	toggle.classList.add('tab-sidebar-toggle');
	toggle.title = 'Свернуть правую панель';
	tabs.appendChild(toggle);
}
const observer = new MutationObserver(() => { redrawToolGlyphs(); moveSidebarToggle(); });
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', () => { redrawToolGlyphs(); moveSidebarToggle(); });

const style = document.createElement('style');
style.textContent = `
#sidebar .tabs { align-items: stretch; }
#sidebarToggle.tab-sidebar-toggle { width: 34px; min-width: 34px; border: 0; border-left: 1px solid var(--line); border-radius: 0; font-size: 18px; color: var(--muted); background: var(--panel); }
#sidebarToggle.tab-sidebar-toggle:hover { color: var(--accent); background: var(--accent-weak); }
.tool { position: relative; }
.tool-svg { width: 21px; height: 21px; display: block; }
.tool.active .tool-svg { color: #fff; }
`;
document.head.appendChild(style);
