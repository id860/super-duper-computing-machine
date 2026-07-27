# Архитектура PixelFront Worlds v3

## Runtime

PixelFront Worlds — автономный Node.js-монолит: HTTP API, JSON Store, SSE и SPA на ванильном JavaScript. Внешние сервисы (PostgreSQL, Redis, worker) — opt-in и включаются переменными окружения.

```text
Browser SPA ── fetch / EventSource ──> server-v3.mjs
  main.js + experience-patch.js          ├─ api.mjs + player-preferences.mjs
  engine.js + interaction-patch.js       ├─ world-bootstrap.mjs + chunks.mjs
  viewport-cache.js + chunk-lru.js       ├─ src/core/* + JSON Store
                                          ├─ postgres-mirror.mjs (DATABASE_URL)
                                          └─ redis-runtime.mjs (REDIS_URL) ↔ worker-v3.mjs
```

## Клиент

- `engine.js` — canvas, зум, панорамирование, sparse renderer, миникарта.
- `interaction-patch.js` — загрузчик viewport-чанков, визуальные инструменты и миникарта.
- `viewport-cache.js` + `chunk-lru.js` — LRU загруженных чанков и вытеснение самих пикселей дальних чанков (свежие записи сохраняются).
- `experience-patch.js` — fine-чанки, профиль, косметика всех авторов чата, события, зона спавна и панель.
- `main.js` / `ui.js` — маршрутизация, панели, SSE, инструменты и модалки.

## Бесконечный мир и чанки

Официальный мир имеет диапазон `0…99 999` и стартовую зону `1000 × 1000`. Она рендерится как лёгкая заливка с подписью, может скрываться в настройках игрока и не мешает работе с холстом.

Infinite bootstrap не передаёт полный массив пикселей. Серверный `ChunkIndex` индексирует их в памяти по fine-чанкам **86 × 86**. Старый 256-клеточный участок разделён на `3 × 3`; клиент запросом `radius=0` получает маленький чанк сразу и не ждёт большую область. Повторные панорамирования коалесцируются, а LRU оставляет возможность повторно загрузить дальние области.

При `CHUNK_READ_MODE=postgres` чанки читаются из `world_chunks`, и ответ помечается `storage: "postgres"`. Любая ошибка чтения прозрачно возвращает запрос на JSON-индекс.

## Синхронизация и безопасность

Canvas применяет операции оптимистично; сервер проверяет координаты, энергию, роли, защиту и rate limits, затем передаёт SSE. CSRF, Origin checks, CSP, scrypt-пароли и защита статики действуют на уровне HTTP.

С `REDIS_URL` сессии и rate limits становятся общими для всех инстансов, а SSE-события рассылаются через канал `pixelfront:sse`.

## Профиль и экономика

Косметика хранится отдельно от инвентаря в независимых слотах (`frame`, `nick`, `badge`, `trail`, `cursor`): рамка, оформление ника и значок можно использовать одновременно. История чата отдаёт слоты авторов, а живые сообщения добирают их через `GET /api/cosmetics?nick=`. Встроенный магазин продаёт косметические, utility и consumable-предметы.

## Deployment and scale-out

JSON остаётся автономным runtime и безопасным fallback. Порядок rollout: dual-write → импорт через `scripts/export-postgres.mjs` → `CHUNK_READ_MODE=postgres` → Redis-сессии и fan-out → `AUTOMATION_MODE=worker` с отдельным `worker-v3.mjs`. Откат — снятие соответствующей переменной окружения. Детали и переменные — в `infra/README.md` и `.env.example`.

## Verification

GitHub Actions выполняет syntax-check клиентских и серверных модулей, unit/live API-контракты (включая косметику в чате и PostgreSQL-чтение чанков), нагрузочный тест чанков и Docker build на каждый push в `main`.
