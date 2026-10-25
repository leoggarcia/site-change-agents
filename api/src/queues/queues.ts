import type { RegisterQueueOptions } from '@nestjs/bullmq';

// Queue names, shared with the Python workers (agents/src/change_agents/worker/main.py).
export const INTAKE_QUEUE = 'intake';
export const CODING_QUEUE = 'coding';
export const REVIEW_QUEUE = 'review';
export const REINDEX_QUEUE = 'reindex';
/** Pushes the branch, opens and merges pull requests, and waits for the site's deploys (Phase 7). */
export const DELIVERY_QUEUE = 'delivery';
/** Python workers report every result, retry and final failure here; the API applies them to tickets. */
export const AGENT_RESULTS_QUEUE = 'agent-results';

export type Stage = 'intake' | 'coding' | 'review' | 'reindex' | 'delivery';

// Keep finished jobs for a while: they show in Bull Board, and their ids stop duplicates being added.
const keep = { removeOnComplete: { count: 500 }, removeOnFail: { count: 1000 } };

/**
 * Retries with exponential backoff: e.g. intake waits 10 s, then 20 s, before giving up.
 * Time limits and concurrency are set by the workers, which know how long their work takes.
 */
export const QUEUES: RegisterQueueOptions[] = [
  { name: INTAKE_QUEUE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, ...keep } },
  { name: CODING_QUEUE, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 15_000 }, ...keep } },
  { name: REVIEW_QUEUE, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 10_000 }, ...keep } },
  { name: REINDEX_QUEUE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, ...keep } },
  { name: DELIVERY_QUEUE, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, ...keep } },
  { name: AGENT_RESULTS_QUEUE, defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, ...keep } },
];

export function redisConnection(url = process.env.REDIS_URL ?? 'redis://localhost:6379') {
  return { url };
}
