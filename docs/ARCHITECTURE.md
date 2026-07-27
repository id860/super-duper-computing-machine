# Архитектура PixelFront Worlds

## Обзор

Монолит на Node.js без внешних зависимостей: HTTP-сервер, JSON-хранилище, SSE-пуш и браузерное SPA на ванильном JS.

```
┌────────────────────────────────────────────────────────────────┐
│                      browser (SPA)                          │
│  main.js  ←→  api.js  ←→  engine.js  ←→  ui.js             │
└──────────────────────────┬────────────────────────────────────┘
                           │  fetch + EventSource
┌──────────────────────────▼───────────────────────────────────┐
│                   server-v3.mjs (entry)                      │
│  kit.mjs  (CSRF, security headers, static)                    │
│  sse.mjs  (EventSource broadcast)                             │
│  api.mjs  (routing, business logic)  ←→  model.mjs           │
│  db.mjs   (atomic JSON store)                                 │
│  automation.mjs  (background tick)                            │
└────────────────────────────────────────────────────────────────┘
```

## Слои

### SPA (`public/app/`)

| Файл | Отвечает за |
|---|---|
| `main.js` | Загрузка, маршрутизация hash, вкладки, SSE-подписка |
| `engine.js` | Canvas-рендер, зум, панорамирование, миникарта |
| `ui.js` | Инструменты, палитра, модалки, тосты, авторизация |
| `api.js` | Обёртка fetch + CSRF-токен |

### HTTP-сервер (`src/http/`)

| Файл | Отвечает за |
|---|---|
| `server-v3.mjs` | Bootstrap: store, SSE, API, automation, graceful shutdown |
| `api.mjs` | Все `/api/*` маршруты, авторизация, бизнес-логика |
| `kit.mjs` | CSRF, security headers, статика, сессии |
| `sse.mjs` | Server-Sent Events (pixels, chat, lifecycle) |

### Ядро (`src/core/`)

| Файл | Отвечает за |
|---|---|
| `model.mjs` | Фабрики (createUser, officialWorld), константы, миграция |
| `db.mjs` | Атомарный JSON-стор с дебаунс-записью |
| `util.mjs` | hashPassword, now, rateLimit и утилиты |
| `automation.mjs` | Фоновый тик: события, сезоны, жизненный цикл, античит |

## Бесконечный холст и оптимизация рендера

Официальный мир создаётся с `infinite: true`. Движок рендерит только реально закрашенные пиксели (`pixels: Map<"x:y", color>`) с отсечением по вьюпорту — `O(закрашенные пиксели)` вместо `O(площадь)`. Коалесинг кадров через `requestAnimationFrame` и офскрин-буфер миникарты устраняют лаги при панорамировании.

Зона спавна 1000 × 1000 (координаты 0…999) даёт `SPAWN_XP_MULTIPLIER = 2` бонуса к XP и выделена пунктирной синей рамкой в движке.

## Безопасность

| Механизм | Реализация |
|---|---|
| CSRF | `x-csrf-token` обязателен для всех мутирующих запросов; Origin проверяется |
| Security headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, CSP, COOP |
| Пароли | `scrypt` (N=32768, r=8, p=1, keylen=64), hex |
| Rate limits | Серверные, без Redis |
| Path traversal | Проверка в `serveStatic` |

## Прогрессия

Изоляция строго на уровне API: `officialPixels`, `xp`, достижения и глобальный рейтинг обновляются только при `world.type === 'official'`. Пиксели пользовательских миров идут в `communityPixels`.

## Данные

Атомарный JSON-стор (`db.mjs`): дебаунс-запись через `tmp + rename`. Данные хранятся в `DATA_DIR/db.json`. На больших нагрузках следует перейти на PostgreSQL.

## Фоновая автоматика

`automation.mjs` запускается по таймеру (`AUTOMATION_INTERVAL_MS`, дефолт 60 000 мс). Выполняет: события и сезоны, архивацию неактивных миров, античит, выдачу наград за задания.
