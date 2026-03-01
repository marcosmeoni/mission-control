#!/usr/bin/env node
/**
 * recall_memories.js - Semantic search over the pgvector memory store
 *
 * Usage:
 *   node scripts/memory/recall_memories.js "What does Marcos prefer?"
 *   node scripts/memory/recall_memories.js --query "team decisions" --category decision --limit 5
 *   node scripts/memory/recall_memories.js --list-recent --limit 20
 *
 * Env vars (or .env.memory):
 *   MEMORY_DB_URL    postgres://postgres:postgres@localhost:54322/memory
 *   OPENAI_API_KEY   (required for semantic search)
 *   EMBEDDING_MODEL  text-embedding-3-small (default)
 */

import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dir, "../../.env.memory");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const DB_URL =
  process.env.MEMORY_DB_URL ||
  "postgres://postgres:postgres@localhost:54322/memory";
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const EMBEDDING_DIMS = parseInt(process.env.EMBEDDING_DIMS || "1536");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    query: { type: "string", short: "q" },
    category: { type: "string" },
    tags: { type: "string" },
    limit: { type: "string", default: "10" },
    threshold: { type: "string", default: "0.70" },
    archived: { type: "boolean", default: false },
    "list-recent": { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
recall_memories.js - Semantic memory search

Usage:
  node recall_memories.js "your query"
  node recall_memories.js --query "your query" [options]
  node recall_memories.js --list-recent

Options:
  --query, -q      Search query (uses semantic similarity)
  --category       Filter by category
  --tags           Filter by comma-separated tags
  --limit          Max results (default 10)
  --threshold      Similarity threshold 0-1 (default 0.70)
  --archived       Include archived memories
  --list-recent    List recent memories (no semantic search)
  --json           Output raw JSON
  --help, -h       Show this
`);
  process.exit(0);
}

const queryText = values.query || positionals[0];

async function getEmbedding(text) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMS,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
  return (await res.json()).data[0].embedding;
}

async function semanticSearch(client, embedding) {
  const tagsFilter = values.tags
    ? `ARRAY[${values.tags.split(",").filter(Boolean).map(t => `'${t.trim().replace(/'/g, "''")}'`).join(",")}]`
    : "NULL";

  const result = await client.query(
    `SELECT * FROM recall_memories(
      $1::vector,
      $2::float,
      $3::int,
      $4::text,
      ${tagsFilter}::text[],
      $5::boolean
    )`,
    [
      `[${embedding.join(",")}]`,
      parseFloat(values.threshold),
      parseInt(values.limit),
      values.category || null,
      values.archived,
    ]
  );
  return result.rows;
}

async function listRecent(client) {
  const whereClauses = [
    "archived = FALSE OR $1 = TRUE",
    "ttl IS NULL OR ttl > NOW()",
  ];
  if (values.category) whereClauses.push(`category = '${values.category}'::memory_category`);

  const result = await client.query(
    `SELECT id, content, summary, category, tags, importance, created_at
     FROM memories
     WHERE (archived = FALSE OR $1 = TRUE)
       AND (ttl IS NULL OR ttl > NOW())
     ORDER BY created_at DESC
     LIMIT $2`,
    [values.archived, parseInt(values.limit)]
  );
  return result.rows;
}

function formatResults(rows, mode = "semantic") {
  if (!rows.length) {
    console.log("No memories found.");
    return;
  }
  console.log(`\n Found ${rows.length} ${mode === "recent" ? "recent" : "similar"} memories:\n`);
  for (const r of rows) {
    const sim = r.similarity != null ? ` [${(r.similarity * 100).toFixed(1)}% match]` : "";
    const tag = r.tags?.length ? ` #${r.tags.join(" #")}` : "";
    const imp = "★".repeat(r.importance || 0) + "☆".repeat(5 - (r.importance || 0));
    console.log(`┌─ [${r.category}]${sim} ${imp}${tag}`);
    if (r.summary) console.log(`│  ${r.summary}`);
    console.log(`│  ${r.content.replace(/\n/g, "\n│  ")}`);
    console.log(`└─ id: ${r.id}  created: ${new Date(r.created_at).toISOString()}\n`);
  }
}

try {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  let rows;

  if (values["list-recent"]) {
    rows = await listRecent(client);
    if (values.json) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      formatResults(rows, "recent");
    }
  } else if (queryText) {
    process.stderr.write("Generating embedding...\n");
    const embedding = await getEmbedding(queryText);
    rows = await semanticSearch(client, embedding);
    if (values.json) {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      formatResults(rows, "semantic");
    }
  } else {
    console.error("Error: provide a query or use --list-recent");
    await client.end();
    process.exit(1);
  }

  await client.end();
  process.exit(0);
} catch (err) {
  console.error("❌ Error:", err.message);
  process.exit(1);
}
