// Pure consistency helpers shared by the viewport loader and tests.
// Cached data may be painted immediately, but it is never authoritative until
// the server validates the corresponding chunk during the current session.
export function keysNeedingValidation(keys, validated) {
	const has = validated && typeof validated.has === 'function' ? validated : new Set();
	return (keys || []).filter((key) => !has.has(key));
}

// Preserve an optimistic/SSE write that happened after a chunk request began.
// Older and undated cells may be replaced by the authoritative response.
export function keepNewerCell(cell, requestedAt) {
	return Number.isFinite(cell?.at) && cell.at > requestedAt;
}
