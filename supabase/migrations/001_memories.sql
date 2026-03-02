-- 001_memories.sql
-- Hybrid memory table: semantic (pgvector) + structured metadata
-- Run: psql -U postgres -d memory -f 001_memories.sql

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Minimal role for PostgREST anon access (safe local dev)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

-- ─────────────────────────────────────────────
-- Enum: memory categories
-- ─────────────────────────────────────────────
CREATE TYPE memory_category AS ENUM (
  'fact',        -- factual knowledge / world info
  'event',       -- something that happened
  'decision',    -- a choice made
  'preference',  -- user preferences / tastes
  'task',        -- task or todo context
  'person',      -- info about a person
  'project',     -- project-level context
  'lesson',      -- lessons learned
  'other'        -- catch-all
);

-- ─────────────────────────────────────────────
-- Table: memories
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT            NOT NULL,
  summary       TEXT,                          -- optional short label
  category      memory_category NOT NULL DEFAULT 'other',

  -- Semantic embedding (text-embedding-3-small → 1536 dims; change as needed)
  embedding     VECTOR(768),

  -- Structured metadata
  source        TEXT,                          -- e.g. "whatsapp", "agent", "manual"
  tags          TEXT[]          DEFAULT '{}',
  importance    SMALLINT        DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),

  -- Lifecycle
  archived      BOOLEAN         NOT NULL DEFAULT FALSE,
  ttl           TIMESTAMPTZ,                   -- NULL = keep forever; set to expire
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  accessed_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────

-- Vector similarity search (cosine distance, IVFFlat)
-- Rebuild after bulk inserts: REINDEX INDEX memories_embedding_idx;
CREATE INDEX IF NOT EXISTS memories_embedding_idx
  ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Fast category + archive filters
CREATE INDEX IF NOT EXISTS memories_category_archived_idx
  ON memories (category, archived);

-- TTL cleanup index
CREATE INDEX IF NOT EXISTS memories_ttl_idx
  ON memories (ttl)
  WHERE ttl IS NOT NULL;

-- Tags GIN index for array containment queries
CREATE INDEX IF NOT EXISTS memories_tags_idx
  ON memories USING GIN (tags);

-- ─────────────────────────────────────────────
-- updated_at trigger
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER memories_updated_at
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────
-- RPC: recall_memories (semantic similarity search)
-- Called via PostgREST: POST /rpc/recall_memories
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recall_memories(
  query_embedding   VECTOR(768),
  match_threshold   FLOAT   DEFAULT 0.75,
  match_count       INT     DEFAULT 10,
  filter_category   TEXT    DEFAULT NULL,
  filter_tags       TEXT[]  DEFAULT NULL,
  include_archived  BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id          UUID,
  content     TEXT,
  summary     TEXT,
  category    memory_category,
  tags        TEXT[],
  importance  SMALLINT,
  similarity  FLOAT,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.id,
    m.content,
    m.summary,
    m.category,
    m.tags,
    m.importance,
    1 - (m.embedding <=> query_embedding) AS similarity,
    m.created_at
  FROM memories m
  WHERE
    m.embedding IS NOT NULL
    AND (include_archived OR m.archived = FALSE)
    AND (m.ttl IS NULL OR m.ttl > NOW())
    AND (filter_category IS NULL OR m.category = filter_category::memory_category)
    AND (filter_tags IS NULL OR m.tags @> filter_tags)
    AND 1 - (m.embedding <=> query_embedding) >= match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;

  -- Track last access time
  UPDATE memories
  SET accessed_at = NOW()
  WHERE memories.id IN (
    SELECT m2.id FROM memories m2
    WHERE
      m2.embedding IS NOT NULL
      AND (include_archived OR m2.archived = FALSE)
      AND (m2.ttl IS NULL OR m2.ttl > NOW())
      AND (filter_category IS NULL OR m2.category = filter_category::memory_category)
      AND (filter_tags IS NULL OR m2.tags @> filter_tags)
      AND 1 - (m2.embedding <=> query_embedding) >= match_threshold
    ORDER BY m2.embedding <=> query_embedding
    LIMIT match_count
  );
END;
$$;

-- ─────────────────────────────────────────────
-- RPC: expire_memories (cleanup TTL-expired rows)
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_memories()
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM memories WHERE ttl IS NOT NULL AND ttl <= NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ─────────────────────────────────────────────
-- Grant PostgREST anon role read/write/execute
-- ─────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE ON memories TO anon;
GRANT EXECUTE ON FUNCTION recall_memories TO anon;
GRANT EXECUTE ON FUNCTION expire_memories TO anon;
