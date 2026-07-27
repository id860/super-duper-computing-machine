# Infrastructure runtime

The default application starts with JSON storage and no external dependencies. PostgreSQL and Redis are optional and are activated only through explicit environment variables.

## Safe rollout

1. Start PostgreSQL and run `infra/postgres/001_init.sql`.
2. Set `DATABASE_URL` and restart once. The server enables **dual-write**: JSON stays authoritative and is mirrored to `worlds` and `world_chunks`.
3. Verify the mirror, then set `CHUNK_READ_MODE=postgres`. Only viewport chunk reads switch to PostgreSQL. Any query failure falls back to JSON automatically; set `CHUNK_READ_MODE=json` to roll back immediately.
4. Set `REDIS_URL` to enable cross-instance SSE fan-out and a distributed per-IP API limit (`API_RATE_LIMIT`, default 300/minute).
5. To schedule automation through a separate worker, start `docker compose --profile worker up -d`, set `AUTOMATION_MODE=worker` on app instances, and provide the same `REDIS_URL`. The worker publishes a tick; Redis elects exactly one web instance to execute it, keeping JSON writes single-writer.

## Runtime variables

- `DATABASE_URL`, `POSTGRES_POOL_SIZE`
- `REDIS_URL`, `API_RATE_LIMIT`
- `CHUNK_READ_MODE=json|postgres`
- `AUTOMATION_MODE=inline|worker`, `AUTOMATION_INTERVAL_MS`
