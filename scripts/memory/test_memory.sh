#!/usr/bin/env bash
# test_memory.sh - Quick smoke test: insert + recall memories
# Requires: psql, node, OPENAI_API_KEY (for semantic search)

set -euo pipefail

DB_URL="${MEMORY_DB_URL:-postgres://postgres:postgres@localhost:54322/memory}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Memory Smoke Test ==="
echo "DB: $DB_URL"

# 1. Direct SQL insert (no embedding needed for basic test)
echo ""
echo "1. Inserting test memories via SQL..."
psql "$DB_URL" <<'SQL'
INSERT INTO memories (content, category, summary, tags, importance)
VALUES
  ('Marcos prefers concise replies without filler phrases', 'preference', 'comms style', ARRAY['communication'], 4),
  ('Mission Control project uses Next.js with SQLite for local DB', 'project', 'mc tech stack', ARRAY['mission-control','tech'], 3),
  ('Decided to use pgvector for hybrid semantic memory on 2026-03-01', 'decision', 'pgvector adoption', ARRAY['memory','architecture'], 5)
ON CONFLICT DO NOTHING;
SELECT count(*) AS total_memories FROM memories;
SQL

# 2. List recent
echo ""
echo "2. Listing recent memories..."
node "$SCRIPT_DIR/recall_memories.js" --list-recent --limit 5

# 3. Semantic search (only if OPENAI_API_KEY set)
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  echo ""
  echo "3. Semantic search: 'What are Marcos communication preferences?'"
  node "$SCRIPT_DIR/recall_memories.js" "What are Marcos communication preferences?" --limit 3
else
  echo ""
  echo "3. Skipping semantic search (OPENAI_API_KEY not set)"
fi

# 4. Archive test
echo ""
echo "4. Archive + TTL test..."
psql "$DB_URL" <<'SQL'
UPDATE memories SET archived = TRUE WHERE category = 'project';
INSERT INTO memories (content, category, ttl)
VALUES ('Temporary test memory', 'other', NOW() + INTERVAL '1 second');
SELECT pg_sleep(2);
SELECT expire_memories() AS expired_count;
SELECT count(*) AS active_count FROM memories WHERE archived = FALSE AND (ttl IS NULL OR ttl > NOW());
SQL

echo ""
echo "✅ Smoke test complete"
