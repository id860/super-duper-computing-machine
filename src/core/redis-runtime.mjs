export async function createRedisBridge(url, onEvent) {
	if (!url) return null;
	const { createClient } = await import('redis'); const publisher = createClient({ url }), subscriber = publisher.duplicate();
	publisher.on('error', (error) => console.error('Redis publisher:', error.message)); subscriber.on('error', (error) => console.error('Redis subscriber:', error.message)); await Promise.all([publisher.connect(), subscriber.connect()]);
	await subscriber.subscribe('pixelfront:sse', (raw) => { try { onEvent(JSON.parse(raw)); } catch (error) { console.error('Redis event:', error.message); } });
	return { publish: (event) => publisher.publish('pixelfront:sse', JSON.stringify(event)), async take(key, limit, windowMs) { const tx = publisher.multi(); tx.incr(key); tx.pExpire(key, windowMs, 'NX'); const [count] = await tx.exec(); return Number(count) <= limit; }, async claim(key, ttlMs) { return (await publisher.set(key, '1', { NX: true, PX: ttlMs })) === 'OK'; }, async close() { await Promise.allSettled([subscriber.quit(), publisher.quit()]); } };
}
