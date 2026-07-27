// Compatibility corrections for persisted and newly-created world settings.
const BRUSH_CELLS = { brush2: 4, brush3: 9 };
const BASIC_TOOLS = new Set(['pixel', 'brush2', 'brush3', 'line', 'rect', 'fill', 'picker']);

export function normalizeWorldToolSettings(db) {
	let changed = false;
	for (const world of Object.values(db.worlds || {})) {
		for (const [tool, cells] of Object.entries(BRUSH_CELLS)) {
			if (!world?.tools?.[tool] || world.tools[tool].maxSize === cells) continue;
			world.tools[tool].maxSize = cells; changed = true;
		}
		// The official starter set is intentionally small; advanced tools are opt-in.
		if (world?.type === 'official') for (const [tool, config] of Object.entries(world.tools || {})) {
			const enabled = BASIC_TOOLS.has(tool);
			if (config.enabled !== enabled) { config.enabled = enabled; changed = true; }
		}
	}
	return changed;
}
