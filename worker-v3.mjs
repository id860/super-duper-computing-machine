import { createRedisBridge } from './src/core/redis-runtime.mjs';
const interval = Number(process.env.AUTOMATION_INTERVAL_MS || 60000), redis = await createRedisBridge(process.env.REDIS_URL || '', () => {});
if (!redis) throw new Error('worker-v3 requires REDIS_URL');
const publish = async () => { const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`; await redis.publish({ type: 'automation-tick', origin: `worker-${process.pid}`, jobId }); };
await publish(); const timer = setInterval(() => publish().catch((error) => console.error('automation worker:', error.message)), interval); timer.unref?.();
const stop = async () => { clearInterval(timer); await redis.close(); process.exit(0); }; process.on('SIGINT', stop); process.on('SIGTERM', stop);
