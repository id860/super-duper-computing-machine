# API Reference — PixelFront Worlds v3

Base URL: `/api`. Mutating requests require the `x-csrf-token` header returned by `GET /api/config`.

## Authentication and player preferences

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register`, `/auth/login`, `/auth/logout` | account lifecycle |
| `GET` | `/me`, `/me/stats` | current player and statistics |
| `GET` / `PATCH` | `/me/preferences` | player settings such as `hideSpawnZone` |
| `GET` | `/inventory` | owned items |
| `POST` | `/me/cosmetics` | toggle a purchased cosmetic in its slot: `{ key, slot }` |

`GET /config` is the first request the client should make. It returns CSRF, the signed-in player (if any), palette, tool list, presets and features.

## Worlds and viewport

`GET /worlds/:id?viewport=1` is the infinite-world bootstrap response: it returns metadata and arts with `pixels: []` and `viewport: true`. Finite worlds retain the ordinary full-world response.

### `GET /worlds/:id/chunks?cx=<x>&cy=<y>&radius=<0..2>`

Returns fine chunks of **86 × 86** cells. This is the 3×3 subdivision of the former 256-cell viewport chunk. The normal client asks for `radius=0` immediately and coalesces panning into the latest requested center.

```json
{ "chunkSize": 86, "center": { "x": 3, "y": 2 }, "radius": 0, "chunks": [{ "x": 3, "y": 2, "cells": [[259, 173, "#e50000"]] }] }
```

The server keeps a per-world spatial index. Empty chunks are returned and can be cached safely.

`GET /worlds/:id/pixel-info?x=<x>&y=<y>` returns a painted cell author/timestamp or `{ "empty": true }`.

## Drawing and live stream

`POST /worlds/:id/ops` accepts `{ tool, color, cells }`, validates every operation server-side and broadcasts `pixels` SSE events with the author nickname. Tools include `pixel`, `brush2`, `brush3`, `line`, `rect`, `fill`, `picker`, `move`, `copy`, `stamp`, `template`, `protect`, `restore`.

`GET /stream?world=:id` opens the EventSource channel. Events: `pixels`, `chat`, `lifecycle`, `reload`.

## Economy and social

| Method | Path | Purpose |
|---|---|---|
| `GET` / `POST` | `/worlds/:id/chat` | chat |
| `GET` | `/quests`, `/events`, `/shop` | daily quests, active events and offers |
| `POST` | `/quests/:id/claim`, `/shop/:key/buy` | rewards and purchases |
| `GET` | `/leaderboard`, `/worlds/:id/leaderboard` | global and local rankings |

Errors use `{ "error": "message" }`; common statuses are `400`, `401`, `403`, `404`, `409`, and `429`.
