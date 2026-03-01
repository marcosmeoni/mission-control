# Hybrid Memory with pgvector

Local Supabase-compatible vector memory store for Mission Control.
Combines **semantic search** (embeddings via pgvector) with **structured metadata** (categories, tags, TTL, archive).

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  CLI Scripts / Agent Tools                          │
│  save_memory.js        recall_memories.js           │
└─────────────┬──────────────────┬───────────────────-┘
              │ pg client        │ pg client / HTTP
              ▼                  ▼
┌─────────────────────────────────────────────────────┐
│  PostgREST (port 54321)  ← REST API (optional)      │
│  PostgreSQL 16 + pgvector (port 54322)              │
│  memories table + recall_memories() RPC             │
└─────────────────────────────────────────────────────┘
              │
              ▼ embeddings
┌─────────────────────┐
│  OpenAI Embeddings  │
│  text-embedding-3-small│
└─────────────────────┘
```

## Quick Start

### 1. Start the stack

```bash
docker compose -f docker-compose.pgvector.yml up -d
```

### 2. Run migrations

```bash
# Option A: via script (requires psql CLI)
./scripts/memory/migrate.sh

# Option B: via docker exec (no local psql needed)
docker compose -f docker-compose.pgvector.yml exec db \
  psql -U postgres -d memory -f /migrations/001_memories.sql
```

### 3. Configure environment

```bash
cp .env.memory.example .env.memory
# Edit .env.memory with your OPENAI_API_KEY
```

Or export directly:
```bash
export OPENAI_API_KEY=sk-...
export MEMORY_DB_URL=postgres://postgres:postgres@localhost:54322/memory
```

### 4. Save a memory

```bash
# With semantic embedding (requires OPENAI_API_KEY)
node scripts/memory/save_memory.js \
  --content "Marcos prefers concise replies without filler phrases" \
  --category preference \
  --tags "communication,style" \
  --importance 4

# Without embedding (metadata only)
node scripts/memory/save_memory.js \
  --content "Team decided to migrate to pgvector on 2026-03-01" \
  --category decision \
  --no-embed

# Pipe from stdin
echo "Next.js project uses SQLite locally" | \
  node scripts/memory/save_memory.js --category project
```

### 5. Recall memories

```bash
# Semantic search
node scripts/memory/recall_memories.js "What does Marcos prefer?"

# Filter by category
node scripts/memory/recall_memories.js \
  --query "architecture decisions" \
  --category decision \
  --limit 5

# List recent without semantic search
node scripts/memory/recall_memories.js --list-recent --limit 20

# JSON output (for piping)
node scripts/memory/recall_memories.js "preferences" --json | jq '.[0]'
```

### 6. Run smoke tests

```bash
./scripts/memory/test_memory.sh
```

---

## Docker Services

| Service    | Port  | Purpose                         |
|------------|-------|---------------------------------|
| db         | 54322 | PostgreSQL 16 + pgvector        |
| postgrest  | 54321 | Auto REST API (Supabase-style)  |
| pgadmin    | 5050  | Web DB UI (profile: admin)      |

Start pgAdmin:
```bash
docker compose -f docker-compose.pgvector.yml --profile admin up -d
# Open: http://localhost:5050 (admin@local.dev / admin)
```

---

## Schema Overview

### `memories` table

| Column       | Type             | Description                          |
|--------------|------------------|--------------------------------------|
| id           | UUID             | Primary key (auto-generated)         |
| content      | TEXT             | Full memory text                     |
| summary      | TEXT             | Optional short label                 |
| category     | memory_category  | Enum (see below)                     |
| embedding    | VECTOR(1536)     | Semantic embedding (nullable)        |
| source       | TEXT             | Origin: "agent", "cli", "whatsapp"   |
| tags         | TEXT[]           | Free-form tags                       |
| importance   | SMALLINT (1-5)   | Priority weight                      |
| archived     | BOOLEAN          | Soft-delete flag                     |
| ttl          | TIMESTAMPTZ      | Auto-expire timestamp (NULL=forever) |
| created_at   | TIMESTAMPTZ      | Row creation time                    |
| updated_at   | TIMESTAMPTZ      | Auto-updated on change               |
| accessed_at  | TIMESTAMPTZ      | Last semantic search hit             |

### Categories

`fact` · `event` · `decision` · `preference` · `task` · `person` · `project` · `lesson` · `other`

---

## PostgREST API (optional)

PostgREST exposes the `memories` table and RPCs automatically.

```bash
BASE=http://localhost:54321

# List active memories
curl "$BASE/memories?archived=eq.false&order=created_at.desc&limit=10"

# Filter by category
curl "$BASE/memories?category=eq.decision&archived=eq.false"

# Semantic search (RPC)
curl -X POST "$BASE/rpc/recall_memories" \
  -H "Content-Type: application/json" \
  -d '{
    "query_embedding": [0.1, 0.2, ...],  
    "match_threshold": 0.75,
    "match_count": 5,
    "filter_category": "preference"
  }'

# Expire TTL entries
curl -X POST "$BASE/rpc/expire_memories"
```

---

## `.env.memory.example`

```bash
# Copy to .env.memory and fill in values
MEMORY_DB_URL=postgres://postgres:postgres@localhost:54322/memory
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMS=1536
```

---

## Maintenance

```bash
# Archive all memories from a source
psql "$MEMORY_DB_URL" -c "UPDATE memories SET archived=TRUE WHERE source='old-agent';"

# Manual TTL cleanup
psql "$MEMORY_DB_URL" -c "SELECT expire_memories();"

# Rebuild vector index after bulk inserts
psql "$MEMORY_DB_URL" -c "REINDEX INDEX memories_embedding_idx;"

# Backup
docker compose -f docker-compose.pgvector.yml exec db \
  pg_dump -U postgres memory > backup-$(date +%Y%m%d).sql
```

---

## Integration with Mission Control Agent

To call these tools from the OpenClaw agent:

```javascript
// In a tool definition or script block:
import { execSync } from "child_process";

// Save
execSync(`node /path/to/save_memory.js --content "${text}" --category fact`);

// Recall (JSON mode)
const results = JSON.parse(
  execSync(`node /path/to/recall_memories.js "${query}" --json`).toString()
);
```

Or connect directly via the `pg` package using `MEMORY_DB_URL`.
