# API Reference — PixelFront Worlds v3

Base URL: `/api`. Mutating requests require the `x-csrf-token` header returned by `GET /api/config`.

## Authentication

| Method | Path | Body | Result |
|---|---|---|---|
| `POST` | `/auth/register` | `{ nick, password }` | `201 { me }` |
| `POST` | `/auth/login` | `{ nick, password }` | `200 { me }` |
| `POST` | `/auth/logout` | — | `200` |
| `GET` | `/me` | — | current user |
| `GET` | `/me/stats` | — | global and community statistics |

`GET /config` is the first request the client should make. It returns the CSRF token, the signed-in user (if any), palettes, tool list, presets and enabled features.

## Worlds

### `GET /worlds/:id`

Returns `{ world, pixels, arts }`. `world.infinite` identifies an unbounded world. Coordinates accepted by the current server range from `0` through `99,999` on both axes. `world.spawn` identifies the square spawn zone: for the official world this is `1000`, therefore its zone is `0…999 × 0…999`.

`pixels` is a compact array of `[x, y, color]` records. Pixel author metadata is intentionally loaded separately.

### `GET /worlds/:id?viewport=1`

For an infinite world, returns metadata and arts with an empty `pixels` array plus `viewport: true`. This is the client bootstrap route: it prevents downloading the entire world before the canvas is usable. Finite worlds retain the normal full-world response.

### `GET /worlds/:id/chunks?cx=<x>&cy=<y>&radius=<0..2>`

Returns the requested **256 × 256** cell chunks:

```json
{ "chunkSize": 256, "center": { "x": 3, "y": 2 }, "radius": 1, "chunks": [{ "x": 3, "y": 2, "cells": [[769, 513, "#e50000"]] }] }
```

The server keeps an in-memory spatial index for each requested world and synchronizes it with accepted pixel operations. Empty chunks are returned too, allowing clients to cache them.

### `GET /worlds/:id/pixels?since=<timestamp>`

Returns pixels changed after the Unix-millisecond timestamp: `{ pixels, at }`.

### `GET /worlds/:id/pixel-info?x=<x>&y=<y>`

Returns metadata for a painted cell. For an unpainted cell the response is `{ "empty": true, "x": 25, "y": 42 }`.

### `POST /worlds`

Creates a community world. Body supports `{ name, description?, width?, height?, access?, preset?, palette? }`. Community-world activity remains separate from global progression.

### `PATCH /worlds/:id`

Updates a world. Available to the owner, moderators or administrators; the official world is restricted to administrators.

## Drawing

### `POST /worlds/:id/ops`

```json
{ "tool": "pixel", "color": "#0083c7", "cells": [[25, 42]] }
```

The server validates the active world palette, tool role, protected areas, energy, rate limits and coordinate range. Duplicate and out-of-range cells are ignored before application. `brush2` permits four cells and `brush3` permits nine cells.

Tools: `pixel`, `brush2`, `brush3`, `line`, `rect`, `fill`, `picker`, `move`, `copy`, `stamp`, `template`, `protect`, `restore`.

## Realtime stream

### `GET /stream?world=:id`

Connect using `EventSource`. `pixels` events contain `{ tool, pixels: [[x,y,color]], by }`; clients apply them immediately and cache `by` with the cell. Other events: `chat`, `lifecycle`, `reload`.

## Other endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` / `POST` | `/worlds/:id/chat` | world chat |
| `GET` | `/worlds/:id/leaderboard` | local leaderboard |
| `POST` | `/worlds/:id/end` | archive a community world |
| `GET` | `/leaderboard` | global ranking |
| `GET` | `/quests` | daily quests |
| `POST` | `/quests/:id/claim` | claim quest reward |
| `GET` | `/shop` | shop offers |
| `POST` | `/shop/:key/buy` | buy an item |
| `GET` | `/events` | active events |
| `GET` | `/catalog?category=&q=` | community-world catalogue |

## Administration and errors

All `/admin/*` routes require staff privileges. Errors use `{ "error": "message" }`; common statuses are `400`, `401`, `403`, `404`, `409`, and `429`.