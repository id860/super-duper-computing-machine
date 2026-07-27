# Архитектура PixelFront Worlds v3

## Runtime

PixelFront Worlds — автономный Node.js-монолит: HTTP API, JSON Store, SSE и SPA на ванильном JavaScript.

```text
Browser SPA ── fetch / EventSource ──> server-v3.mjs
  main.js + experience-patch.js          ├─ api.mjs + player-preferences.mjs
  engine.js + interaction-patch.js       ├─ world-bootstrap.mjs + chunks.mjs
                                          └─ src/core/* + JSON Store
```

## Клиент

- `engine.js` — canvas, зум, панорамирование, sparse renderer, миникарта.
- `interaction-patch.js` — загрузчик viewport-чанков, визуальные инструменты и миникарта.
- `viewport-cache.js` — ограничение кэша загруженных чанков.
- `experience-patch.js` — fine-чанки, профиль, косметика, события, зона спавна и панель.
- `main.js` / `ui.js` — маршрутизация, панели, SSE, инструменты и модалки.

## Бесконечный мир и чанки

Официальный мир имеет диапазон `0…99 999` и стартовую зону `1000 × 1000`. Она рендерится как лёгкая заливка с подписью, может скрываться в настройках игрока и не мешает работе с холстом.

Infinite bootstrap не передаёт полный массив пикселей. Серверный `ChunkIndex` индексирует их в памяти по fine-чанкам **86 × 86**. Старый 256-клеточный участок разделён на `3 × 3`; клиент запросом `radius=0` получает маленький чанк сразу и не ждёт большую область. Повторные панорамирования коалесцируются, а LRU оставляет возможность повторно загрузить дальние области.

## Синхронизация и безопасность

Canvas применяет операции оптимистично; сервер проверяет координаты, энергию, роли, защиту и rate limits, затем передаёт SSE. CSRF, Origin checks, CSP, scrypt-пароли и защита статики действуют на уровне HTTP.

## Профиль и экономика

Косметика хранится отдельно от инвентаря в независимых слотах (`frame`, `nick`, `badge`, `trail`, `cursor`): рамка, оформление ника и значок можно использовать одновременно. Встроенный магазин продаёт косметические, utility и consumable-предметы.

## Deployment and scale-out

v3 использует JSON как автономный runtime и безопасный fallback. Репозиторий содержит PostgreSQL/Redis Compose, SQL-схему и exporter для следующего миграционного релиза. Runtime-переключение на внешние сервисы намеренно не выполняется без доступной инфраструктуры, dual-write и rollback-окна.

## Verification

GitHub Actions выполняет syntax-check, unit/live API-контракты и Docker build на каждом push в `main`.