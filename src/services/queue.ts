/**
 * BullMQ async job queue (optional).
 *
 * Enable with QUEUE_ENABLED=true and a REDIS_URL. When disabled, enqueueing
 * is a no-op and callers should use the synchronous path instead.
 *
 * Start the worker in a separate process:
 *   npm run worker
 */
import { env } from "../config/env.js";
import type { RunRequest, RunResponse } from "../core/types.js";
import type { Queue } from "bullmq";

export const QUEUE_NAME = "ai-requests";

// ─── Job types ────────────────────────────────────────────────────────────

export interface JobData {
  request: RunRequest;
}

export interface JobResult {
  response: RunResponse;
}

// ─── Lazy BullMQ queue ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queue: Queue<JobData, JobResult> | null = null;

async function getQueue(): Promise<Queue<JobData, JobResult> | null> {
  if (!env.QUEUE_ENABLED || !env.REDIS_URL) return null;
  if (queue) return queue;
  const { Queue } = await import("bullmq");
  queue = new Queue<JobData, JobResult>(QUEUE_NAME, {
    connection: { url: env.REDIS_URL },
  });
  return queue;
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function enqueue(request: RunRequest): Promise<string> {
  const q = await getQueue();
  if (!q)
    throw new Error("Queue not enabled. Set QUEUE_ENABLED=true and REDIS_URL.");
  const job = await q.add("run", { request });
  return job.id ?? "unknown";
}

export interface JobStatus {
  id: string;
  state: string;
  result?: RunResponse;
  error?: string;
}

export async function getJobStatus(id: string): Promise<JobStatus | null> {
  const q = await getQueue();
  if (!q) return null;
  const job = await q.getJob(id);
  if (!job) return null;
  const state = await job.getState();
  return {
    id: job.id ?? id,
    state,
    result: job.returnvalue?.response,
    error: job.failedReason,
  };
}
