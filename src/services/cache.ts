/**
 * Prompt-hash cache.
 *
 * Uses Redis when REDIS_URL is set (shared across instances), falls back to an
 * in-process LRU when running without Redis (suitable for single-instance
 * dev/test). In both cases the key is a SHA-256 of the request fields that
 * determine the answer: task + input + priority + promptId.
 *
 * noCache=true on the request skips both read and write.
 */
import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import type { RunRequest, RunResponse } from '../core/types.js';

// ─── Key ──────────────────────────────────────────────────────────────────

function cacheKey(req: RunRequest): string {
  const payload = `${req.task}\x00${req.input}\x00${req.priority ?? 'balanced'}\x00${req.promptId ?? ''}`;
  return createHash('sha256').update(payload).digest('hex');
}

// ─── In-process LRU ──────────────────────────────────────────────────────

const MAX_LRU_SIZE = 512;
const lruMap = new Map<string, { value: RunResponse; expiresAt: number }>();

function lruGet(key: string): RunResponse | null {
  const entry = lruMap.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    lruMap.delete(key);
    return null;
  }
  // Move to end (most-recently-used).
  lruMap.delete(key);
  lruMap.set(key, entry);
  return entry.value;
}

function lruSet(key: string, value: RunResponse): void {
  // Evict oldest if at capacity.
  if (lruMap.size >= MAX_LRU_SIZE) {
    const oldest = lruMap.keys().next().value;
    if (oldest) lruMap.delete(oldest);
  }
  lruMap.set(key, { value, expiresAt: Date.now() + env.CACHE_TTL_SECONDS * 1_000 });
}

// ─── Redis ────────────────────────────────────────────────────────────────

// Lazy-load ioredis so the service starts without it when REDIS_URL is absent.
let redis: { get(k: string): Promise<string | null>; set(k: string, v: string, m: string, t: number): Promise<unknown> } | null = null;

async function getRedis() {
  if (redis) return redis;
  if (!env.REDIS_URL) return null;
  try {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(env.REDIS_URL);
    return redis;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function getCached(req: RunRequest): Promise<RunResponse | null> {
  if (!env.CACHE_ENABLED || req.noCache) return null;
  const key = cacheKey(req);
  const r = await getRedis();
  if (r) {
    const raw = await r.get(key).catch(() => null);
    return raw ? (JSON.parse(raw) as RunResponse) : null;
  }
  return lruGet(key);
}

export async function setCached(req: RunRequest, response: RunResponse): Promise<void> {
  if (!env.CACHE_ENABLED || req.noCache) return;
  const key = cacheKey(req);
  const r = await getRedis();
  if (r) {
    await r.set(key, JSON.stringify(response), 'EX', env.CACHE_TTL_SECONDS).catch(() => null);
  } else {
    lruSet(key, response);
  }
}

/** Flush the in-process LRU (useful in tests). */
export function clearCache(): void {
  lruMap.clear();
}
