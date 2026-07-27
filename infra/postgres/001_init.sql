-- PixelFront v3 scale-out schema blueprint.
-- Applied only by the future PostgreSQL adapter; JSON remains the active store.
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS world_chunks (
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  cells JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, chunk_x, chunk_y)
);
CREATE INDEX IF NOT EXISTS world_chunks_world_revision_idx ON world_chunks (world_id, revision DESC);

CREATE TABLE IF NOT EXISTS pixel_events (
  id BIGSERIAL PRIMARY KEY,
  world_id TEXT NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_y INTEGER NOT NULL,
  actor_id TEXT,
  tool TEXT NOT NULL,
  cells JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pixel_events_world_created_idx ON pixel_events (world_id, created_at DESC);
