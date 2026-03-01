#!/usr/bin/env node
/**
 * save_memory.js - Store a memory entry in pgvector DB
 *
 * Usage:
 *   node scripts/memory/save_memory.js \
 *     --content "Marcos prefers concise replies" \
 *     --category preference \
 *     --tags "communication,style" \
 *     --importance 4 \
 *     --ttl "2026-12-31T00:00:00Z"
 *
 * Or pipe content:
 *   echo "Some important fact" | node scripts/memory/save_memory.js --category fact
 *
 * Env vars (or .env.memory):
 *   MEMORY_DB_URL    postgres://postgres:postgres@localhost:54322/memory
 *   OPENAI_API_KEY   (required for embedding generation)
 *   EMBEDDING_MODEL  text-embedding-3-small (default)
 *   EMBEDDING_DIMS   1536 (default)
 */

import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Load .env.memory if present ──────────────────────────────────────────────
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

// ── CLI Args ─────────────────────────────────────────────────────────────────
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    content: { type: "string", short: "c" },
    category: { type: "string", default: "other" },
    summary: { type: "string", short: "s" },
    tags: { type: "string", default: "" },        // comma-separated
    importance: { type: "string", default: "3" },
    source: { type: "string", default: "cli" },
    ttl: { type: "string" },                       // ISO date string
    "no-embed": { type: "boolean", default: false },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
save_memory.js - Store a memory in pgvector DB

Options:
  --content, -c   Text content (required, or pipe stdin)
  --category      fact|event|decision|preference|task|person|project|lesson|other
  --summary, -s   Short label (optional)
  --tags          Comma-separated tags
  --importance    1-5 (default 3)
  --source        Source label (default: cli)
  --ttl           Expiry timestamp (ISO 8601), omit = permanent
  --no-embed      Skip embedding generation (stores without vector)
  --help, -h      Show this help
`);
  process.exit(0);
}

// ── Read content ─────────────────────────────────────────────────────────────
async function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (d) => chunks.push(d));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString().trim()));
  });
}

let content = values.content;
if (!content) {
  if (process.stdin.isTTY) {
    console.error("Error: --content is required (or pipe content via stdin)");
    process.exit(1);
  }
  content = await readStdin();
}

if (!content.trim()) {
  console.error("Error: content cannot be empty");
  process.exit(1);
}

// ── Generate embedding ────────────────────────────────────────────────────────
async function getEmbedding(text) {
  if (!OPENAI_KEY) {
    console.warn("⚠  OPENAI_API_KEY not set — storing without embedding");
    return null;
  }
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI embedding error: ${err}`);
  }
  const data = await res.json();
  return data.data[0].embedding;
}

// ── Insert into DB ────────────────────────────────────────────────────────────
async function saveMemory({ content, embedding, category, summary, tags, importance, source, ttl }) {
  // Dynamically import pg (must be installed: npm i pg)
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  const embeddingStr = embedding ? `'[${embedding.join(",")}]'::vector` : "NULL";
  const tagsArr = tags ? `ARRAY[${tags.split(",").filter(Boolean).map(t => `'${t.trim().replace(/'/g, "''")}'`).join(",")}]` : "ARRAY[]::TEXT[]";

  const result = await client.query(
    `INSERT INTO memories (content, summary, category, embedding, tags, importance, source, ttl)
     VALUES ($1, $2, $3::memory_category, ${embeddingStr}, ${tagsArr}, $4, $5, $6)
     RETURNING id, created_at`,
    [
      content,
      summary || null,
      category,
      parseInt(importance),
      source,
      ttl || null,
    ]
  );

  await client.end();
  return result.rows[0];
}

// ── Main ──────────────────────────────────────────────────────────────────────
try {
  process.stdout.write("Saving memory...");

  const embedding = values["no-embed"] ? null : await getEmbedding(content);
  process.stdout.write(embedding ? " (embedded)" : " (no embedding)");

  const row = await saveMemory({
    content,
    embedding,
    category: values.category,
    summary: values.summary,
    tags: values.tags,
    importance: values.importance,
    source: values.source,
    ttl: values.ttl,
  });

  console.log(`\n✅ Saved memory: ${row.id} (${row.created_at})`);
  process.exit(0);
} catch (err) {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
}
