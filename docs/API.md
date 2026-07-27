# API Reference — PixelFront Worlds v3

Базовый URL: `/api`. Все мутирующие запросы требуют заголовка `x-csrf-token` (получается из `/api/config`).

## Авторизация

### `POST /api/auth/register`
Тело: `{ nick, password }`  
Ответ: `201 { me }` или `409` (ник занят).

### `POST /api/auth/login`
Тело: `{ nick, password }`  
Ответ: `200 { me }`.

### `POST /api/auth/logout`
Ответ: `200 {}`. Сессия уничтожается, cookie обнуляется.

### `GET /api/me`
Ответ: `200 { me }` — текущий пользователь или `null`.

### `GET /api/me/stats`
Ответ: `200 { global, community }` — детальная статистика.

## Конфигурация

### `GET /api/config`
Ответ: `200 { features, csrf, me, presets, accessModes, … }`.  
Всегда запрашивайте первым — задаёт CSRF-токен и состояние сессии.

### `GET /api/captcha`
Ответ: `200 { question, captchaToken }`.

## Миры

### `GET /api/worlds/:id`
Ответ: `200 { world, pixels }`.  
`world.infinite: boolean` — бесконечный холст.  
`world.spawn: number` — размер зоны спавна (0…spawn-1).  
`pixels`: массив `[x, y, color]` всех закрашенных клеток.

### `POST /api/worlds`
Тело: `{ name, description?, width?, height?, cooldownMs?, maxEnergy?, access? }`  
Ответ: `201 { world }`.

### `PATCH /api/worlds/:id`
Только владелец / модератор / администратор.  
Тело: частичные поля мира.  
Ответ: `200 { world }`.

### `POST /api/worlds/:id/ops`
Рисование пикселей.  
Тело: `{ tool, color, cells: [[x,y],…] }`  
Инструменты: `pixel`, `brush2`, `brush3`, `line`, `rect`, `fill`, `picker`, `move`, `copy`, `stamp`, `template`, `protect`, `restore`.  
Ответ: `201 { reward?, energy? }`.  
Пиксели в зоне спавна официального мира дают двойной XP.

### `GET /api/worlds/:id/energy`
Ответ: `200 { energy: { value, max, mode, cooldownMs } }`.

### `GET /api/worlds/:id/chat`
Ответ: `200 { messages: [{ nick, text, at }] }`.

### `POST /api/worlds/:id/chat`
Тело: `{ text }`  
Ответ: `201 {}`.

### `GET /api/worlds/:id/leaderboard`
Ответ: `200 { local: [{ nick, pixels }] }`.

### `POST /api/worlds/:id/end`
Архивировать мир (владелец / админ).  
Ответ: `200 {}`.

## Рейтинг и прогрессия

### `GET /api/leaderboard`
Глобальный рейтинг. Ответ: `200 { leaderboard: [{ nick, xp, level, officialPixels }] }`.

### `GET /api/quests`
Ответ: `200 { daily: { quests: [{ id, title, progress, target, claimed }] } }`.

### `POST /api/quests/:id/claim`
Ответ: `200 { reward }`.

### `GET /api/shop`
Ответ: `200 { offers: [{ key, title, type, price }] }`.

### `POST /api/shop/:key/buy`
Ответ: `200 { ok }`.

### `GET /api/events`
Ответ: `200 { active: [{ key, title }] }`.

## Каталог

### `GET /api/catalog?category=&q=`
Ответ: `200 { worlds: […] }`.  
Категории: `popular | new | growing | drawing | faction | games | events | protected`.

## SSE

### `GET /api/stream?world=:id`
Подключается через `EventSource`.  
События: `pixels` (новые/измененные пиксели), `chat` (новое сообщение), `lifecycle` (состояние мира), `reload` (полная перезагрузка).

## Администрирование

Все `/api/admin/*` требуют роль `admin` или `moderator`.

### `GET /api/admin/worlds/:id`
Полная конфигурация мира (включая `energy`, `tools`, `chat`, `infinite`, `spawn`).

### `PATCH /api/admin/worlds/:id`
Обновление любых полей мира. Ответ: `200 { world }`.

### `GET /api/admin/users?q=`
Поиск пользователей. Ответ: `200 { users: […] }`.

### `PATCH /api/admin/users/:id`
Тело: `{ role?, level?, xp?, coins?, officialPixels?, communityPixels?, worldSlots?, verified?, ban? }`.  
Ответ: `200 { user }`.

### `GET /api/admin/queue`
Очередь модерации. Ответ: `200 { queue: [{ id, type, priority, details }] }`.

### `POST /api/admin/queue/:id/resolve`
Тело: `{ resolution }`. Ответ: `200 {}`.

### `GET /api/admin/automation`
Состояние автоматики: последний тик, статистика.

## Ошибки

Формат: `{ error: string }`.  
HTTP-статусы: `400` (невалидный запрос), `401` (не авторизован), `403` (нет прав / CSRF), `404` (не найдено), `409` (конфликт), `429` (rate limit), `500` (внутренняя ошибка).
