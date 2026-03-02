#!/usr/bin/env node
/**
 * save_memory.js - Store a memory entry in pgvector DB
 * Supports local Ollama embeddings or OpenAI embeddings.
 */

import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dir, '../../.env.memory');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const DB_URL = process.env.MEMORY_DB_URL || 'postgres://postgres:postgres@localhost:54322/memory';
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || 'ollama').toLowerCase();
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || (EMBEDDING_PROVIDER === 'openai' ? 'text-embedding-3-small' : 'nomic-embed-text');
const EMBEDDING_DIMS = parseInt(process.env.EMBEDDING_DIMS || (EMBEDDING_PROVIDER === 'openai' ? '1536' : '768'));
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

const { values } = parseArgs({
  options: {
    content: { type: 'string', short: 'c' },
    category: { type: 'string', default: 'other' },
    summary: { type: 'string', short: 's' },
    tags: { type: 'string', default: '' },
    importance: { type: 'string', default: '3' },
    source: { type: 'string', default: 'cli' },
    ttl: { type: 'string' },
    'no-embed': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log('Usage: node save_memory.js --content "..." [--category decision] [--tags a,b]');
  process.exit(0);
}

async function readStdin() {
  return await new Promise((resolveOut) => {
    const chunks = [];
    process.stdin.on('data', (d) => chunks.push(d));
    process.stdin.on('end', () => resolveOut(Buffer.concat(chunks).toString().trim()));
  });
}

let content = values.content;
if (!content) {
  if (process.stdin.isTTY) {
    console.error('Error: --content is required (or pipe stdin)');
    process.exit(1);
  }
  content = await readStdin();
}
if (!content.trim()) {
  console.error('Error: content cannot be empty');
  process.exit(1);
}

async function getEmbedding(text) {
  if (EMBEDDING_PROVIDER === 'openai') {
    if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text, dimensions: EMBEDDING_DIMS }),
    });
    if (!res.ok) throw new Error(`OpenAI embedding error: ${await res.text()}`);
    return (await res.json()).data[0].embedding;
  }

  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embedding error: ${await res.text()}`);
  const data = await res.json();
  if (!Array.isArray(data.embedding)) throw new Error('Invalid Ollama embedding response');
  return data.embedding;
}

async function saveMemory({ content, embedding, category, summary, tags, importance, source, ttl }) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();

  const embeddingStr = embedding ? `'[${embedding.join(',')}]'::vector` : 'NULL';
  const tagsArr = tags
    ? `ARRAY[${tags
        .split(',')
        .filter(Boolean)
        .map((t) => `'${t.trim().replace(/'/g, "''")}'`)
        .join(',')}]`
    : 'ARRAY[]::TEXT[]';

  const result = await client.query(
    `INSERT INTO memories (content, summary, category, embedding, tags, importance, source, ttl)
     VALUES ($1, $2, $3::memory_category, ${embeddingStr}, ${tagsArr}, $4, $5, $6)
     RETURNING id, created_at`,
    [content, summary || null, category, parseInt(importance), source, ttl || null]
  );

  await client.end();
  return result.rows[0];
}

try {
  process.stdout.write(`Saving memory (${EMBEDDING_PROVIDER})...`);
  const embedding = values['no-embed'] ? null : await getEmbedding(content);
  process.stdout.write(embedding ? ' (embedded)' : ' (no embedding)');
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
} catch (err) {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
}
