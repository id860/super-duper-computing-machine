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

Returns `{ world, pixels, arts }`.

`world.infinite` identifies an unbounded world. Coordinates accepted by the current server range from `0` through `99,999` on both axes. `world.spawn` identifies the square spawn zone: for the official world this is `1000`, therefore its zone is `0…999 × 0…999`.

`pixels` is a compact array of `[x, y, color]` records. Pixel author metadata is intentionally loaded separately.

### `GET /worlds/:id/pixels?since=<timestamp>`

Returns pixels changed after the Unix-millisecond timestamp: `{ pixels, at }`.

### `GET /worlds/:id/pixel-info?x=<x>&y=<y>`

Returns metadata for a painted cell:

```json
{ "x": 25, "y": 42, "color": "#e50000", "nick": "artist", "at": 1785140000000 }
```

For an unpainted cell the response is `{ "empty": true, "x": 25, "y": 42 }`.

### `POST /worlds`

Creates a community world. Body supports `{ name, description?, width?, height?, access?, preset?, palette? }`. Community-world activity remains separate from global progression.

### `PATCH /worlds/:id`

Updates a world. Available to the owner, moderators or administrators; the official world is restricted to administrators.

## Drawing

### `POST /worlds/:id/ops`

Body:

```json
{ "tool": "pixel", "color": "#0083c7", "cells": [[25, 42]] }
```

The server validates the active world palette, tool role, protected areas, energy, rate limits and coordinate range. Duplicate and out-of-range cells are ignored before application.

Tools: `pixel`, `brush2`, `brush3`, `line`, `rect`, `fill`, `picker`, `move`, `copy`, `stamp`, `template`, `protect`, `restore`.

The result includes `{ applied, energy, reward }`. In the official world, cells in the spawn zone yield the enhanced XP reward.

### `GET /worlds/:id/energy`

Returns `{ energy: { value, max, mode, stepMs, spentToday } }`.

## Realtime stream

### `GET /stream?world=:id`

Connect using `EventSource`. Events are:

- `pixels` — `{ tool, pixels: [[x,y,color]], by }`, where `by` is the author nickname;
- `chat` — new chat message;
- `lifecycle` — world state changed;
- `reload` — client must reload the current world.

Clients should apply `pixels` events immediately and cache `by` together with the cell to avoid a metadata request on hover.

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

## Administration

All `/admin/*` routes require staff privileges. Administrators can load and update world settings, search and change players, and resolve moderation queue items.

## Errors

Errors use `{ "error": "message" }`. Typical statuses: `400` invalid input, `401` unauthenticated, `403` access/CSRF failure, `404` missing resource, `409` state conflict and `429` rate limit.