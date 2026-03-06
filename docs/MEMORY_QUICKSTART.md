# Memory Quickstart (Operación diaria)

## Ver estado
```bash
docker compose -f docker-compose.pgvector.yml ps
```

## Guardar un recuerdo
```bash
node scripts/memory/save_memory.js \
  --content "Marcos prefiere updates cortos" \
  --category preference \
  --tags "comms,style" \
  --importance 4
```

## Buscar recuerdos recientes
```bash
node scripts/memory/recall_memories.js --list-recent --limit 10
```

## Buscar por similitud semántica
```bash
node scripts/memory/recall_memories.js "como prefiere trabajar marcos" --threshold 0.25 --limit 5
```

## Validar pipeline E2E
1. Crear tarea en Mission Control (workspace Tuten)
2. Despachar
3. Verificar que en el mensaje al agente aparezca:
   - `## 🧠 Recalled Memory`
   - `### 🌐 Workspace Memory`
   - `### 🔎 Semantic Recall (DB)`

## Variables clave
- `MC_MEMORY_SEMANTIC_RECALL=true` (en `.env.local` / `.env.production.local`)
- `MC_MEMORY_SEMANTIC_LIMIT=3`
- `MC_MEMORY_SEMANTIC_TIMEOUT_MS=10000`
- `MC_MEMORY_SEMANTIC_THRESHOLD`:
  - `0.35` uso general
  - `0.45` recomendado para prod (menos ruido)
- `.env.memory`:
  - `EMBEDDING_PROVIDER=ollama`
  - `EMBEDDING_MODEL=nomic-embed-text`
  - `MEMORY_DB_URL=postgres://postgres:postgres@localhost:54322/memory`

## Mantenimiento
- Archivar/limpiar recuerdos temporales (TTL)
- Evitar guardar secretos
- Mantener categorías consistentes: decision/preference/restriction/project
