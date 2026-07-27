// Optional Redis bridge for cross-process live events. Disabled unless REDIS_URL is set.
export async function createRedisBridge(url, onEvent) {
	if (!url) return null;
	const { createClient } = await import('redis');
	const publisher = createClient({ url }); const subscriber = publisher.duplicate();
	publisher.on('error', (error) => console.error('Redis publisher:', error.message)); subscriber.on('error', (error) => console.error('Redis subscriber:', error.message));
	await Promise.all([publisher.connect(), subscriber.connect()]);
	await subscriber.subscribe('pixelfront:sse', (raw) => { try { const event = JSON.parse(raw); onEvent(event); } catch (error) { console.error('Redis event:', error.message); } });
	return { publish: (event) => publisher.publish('pixelfront:sse', JSON.stringify(event)), close: async () => { await Promise.allSettled([subscriber.quit(), publisher.quit()]); } };
}
