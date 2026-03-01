#!/usr/bin/env bash
# migrate.sh - Run SQL migrations against local pgvector DB
# Usage: ./scripts/memory/migrate.sh

set -euo pipefail

DB_URL="${MEMORY_DB_URL:-postgres://postgres:postgres@localhost:54322/memory}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../../supabase/migrations" && pwd)"

echo "Running migrations from: $MIGRATIONS_DIR"
echo "Target DB: $DB_URL"

# Wait for DB to be ready
for i in {1..20}; do
  if psql "$DB_URL" -c "SELECT 1" >/dev/null 2>&1; then
    break
  fi
  echo "Waiting for DB... ($i/20)"
  sleep 2
done

for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "→ Applying: $(basename "$f")"
  psql "$DB_URL" -f "$f"
done

echo "✅ Migrations complete"
