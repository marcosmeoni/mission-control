# Queue subsystem (optional)

Mission Control can use Redis + BullMQ to process room events asynchronously.

## Why
- Decouple chat/room writes from request latency.
- Prepare for higher-throughput agent-to-agent interactions.
- Keep a safe fallback to sync DB writes if queue is disabled/unavailable.

## Environment variables

Add to `.env.local` / `.env.production.local`:

```env
QUEUE_ENABLED=false
REDIS_URL=redis://127.0.0.1:6379
```

- `QUEUE_ENABLED=false` (default): writes happen synchronously (current behavior)
- `QUEUE_ENABLED=true`: enqueue room messages to Redis/BullMQ

## Run Redis locally with Docker

```bash
docker compose -f docker-compose.queue.yml up -d
```

Stop:

```bash
docker compose -f docker-compose.queue.yml down
```

## Behavior / fallback

- If queue is enabled and Redis is healthy: events are queued and processed by worker.
- If queue enqueue/worker fails: Mission Control falls back to direct DB write and logs a warning.
- App does not crash if Redis is unavailable.

## Caveats

- This is v1 queueing for **task room events** only.
- Persistent durability tuning (AOF/RDB), retries/backoff, and dead-letter queues can be added later.
