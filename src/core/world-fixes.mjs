// Compatibility corrections for persisted and newly-created world settings.
const BRUSH_CELLS = { brush2: 4, brush3: 9 };

export function normalizeWorldToolSettings(db) {
	let changed = false;
	for (const world of Object.values(db.worlds || {})) {
		for (const [tool, cells] of Object.entries(BRUSH_CELLS)) {
			if (!world?.tools?.[tool] || world.tools[tool].maxSize === cells) continue;
			world.tools[tool].maxSize = cells;
			changed = true;
		}
	}
	return changed;
}
