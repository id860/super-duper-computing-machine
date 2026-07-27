# Инфраструктурная заготовка

`docker compose -f docker-compose.infra.yml up -d` поднимает PostgreSQL 16 и Redis 7 для следующего этапа масштабирования. Они **не подключены** к текущему runtime: production/MVP продолжает использовать `DATA_DIR/db.json`.

## План переключения

1. Добавить adapter interface для `Store` и dual-write в JSON/PostgreSQL.
2. Импортировать `worlds` и разложить `pixels` по `world_chunks` размером 256×256.
3. Сверять revision и переключить read-path чанков на PostgreSQL.
4. Вынести сессии, rate limits и SSE fan-out в Redis.
5. После метрик и rollback-периода отключить JSON write-path.

Схема `postgres/001_init.sql` хранит мир отдельно от изменяемых чанков и append-only событий пикселей. Это позволяет читать viewport одной выборкой по ключам `(world_id, chunk_x, chunk_y)`.
