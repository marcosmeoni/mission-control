import { Queue, Worker } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, run } from '@/lib/db';

const QUEUE_NAME = 'mc-room-events';
let queue: Queue | null = null;
let workerStarted = false;

function redisUrl(): string {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

function connectionOptions() {
  const u = new URL(redisUrl());
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

export function isQueueEnabled(): boolean {
  return process.env.QUEUE_ENABLED === 'true';
}

function ensureConversation(taskId: string): string {
  let conv = queryOne<{ id: string }>('SELECT id FROM conversations WHERE task_id = ? AND type = ? LIMIT 1', [taskId, 'task']);
  if (!conv) {
    const id = uuidv4();
    const now = new Date().toISOString();
    run('INSERT INTO conversations (id, title, type, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, `Task Room ${taskId.slice(0, 8)}`, 'task', taskId, now, now]);
    conv = { id };
  }
  return conv.id;
}

function writeRoomMessageDirect(taskId: string, senderAgentId: string | null, content: string, messageType = 'task_update') {
  const conversationId = ensureConversation(taskId);
  const now = new Date().toISOString();
  run('INSERT INTO messages (id, conversation_id, sender_agent_id, content, message_type, created_at) VALUES (?, ?, ?, ?, ?, ?)', [uuidv4(), conversationId, senderAgentId, content, messageType, now]);
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId]);
}

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: connectionOptions() });
  }
  return queue;
}

export async function enqueueRoomMessage(taskId: string, senderAgentId: string | null, content: string, messageType = 'task_update'): Promise<void> {
  if (!isQueueEnabled()) {
    writeRoomMessageDirect(taskId, senderAgentId, content, messageType);
    return;
  }

  try {
    await getQueue().add('room-message', { taskId, senderAgentId, content, messageType }, {
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  } catch (error) {
    console.warn('[queue] enqueue failed, falling back to direct write:', error);
    writeRoomMessageDirect(taskId, senderAgentId, content, messageType);
  }
}

export function startQueueWorker(): void {
  if (!isQueueEnabled() || workerStarted) return;
  workerStarted = true;

  try {
    const worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (job.name !== 'room-message') return;
        const { taskId, senderAgentId, content, messageType } = job.data as {
          taskId: string;
          senderAgentId: string | null;
          content: string;
          messageType?: string;
        };
        writeRoomMessageDirect(taskId, senderAgentId, content, messageType || 'task_update');
      },
      { connection: connectionOptions() }
    );

    worker.on('failed', (job, err) => {
      console.warn('[queue] worker job failed', job?.id, err?.message);
    });

    console.log('[queue] worker started');
  } catch (error) {
    console.warn('[queue] worker start failed, continuing in sync mode:', error);
  }
}
