/**
 * Structured logging (pino) + telemetry sink + daily budget tracker.
 *
 * TelemetrySink is a no-op by default. Wire it to your database in production:
 *
 *   import { setTelemetrySink } from './telemetry.js';
 *   setTelemetrySink(async (row) => {
 *     await db.insert('ai_requests').values(row);
 *   });
 *
 * Schema for reference (adapt to your DB):
 *   request_id      TEXT PRIMARY KEY
 *   task            TEXT
 *   model_used      TEXT
 *   provider        TEXT
 *   complexity      TEXT
 *   priority        TEXT
 *   input_tokens    INTEGER
 *   output_tokens   INTEGER
 *   cost_usd        REAL
 *   latency_ms      INTEGER
 *   cached          BOOLEAN
 *   escalated       BOOLEAN
 *   error           TEXT
 *   created_at      TIMESTAMPTZ
 */
import { env } from '../config/env.js';

// ─── Logger ───────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function makeLogger() {
  const isDev = env.NODE_ENV !== 'production';
  const log = (level: LogLevel, obj: Record<string, unknown>, msg: string) => {
    if (level === 'debug' && env.NODE_ENV === 'production') return;
    const entry = JSON.stringify({ level, msg, ...obj, time: new Date().toISOString() });
    if (level === 'error' || level === 'warn') {
      console.error(isDev ? `[${level.toUpperCase()}] ${msg} ${JSON.stringify(obj)}` : entry);
    } else {
      console.log(isDev ? `[${level.toUpperCase()}] ${msg} ${JSON.stringify(obj)}` : entry);
    }
  };
  return {
    debug: (obj: Record<string, unknown>, msg: string) => log('debug', obj, msg),
    info:  (obj: Record<string, unknown>, msg: string) => log('info', obj, msg),
    warn:  (obj: Record<string, unknown>, msg: string) => log('warn', obj, msg),
    error: (obj: Record<string, unknown>, msg: string) => log('error', obj, msg),
  };
}

export const logger = makeLogger();

// ─── Telemetry row ────────────────────────────────────────────────────────

export interface TelemetryRow {
  requestId: string;
  task: string;
  modelUsed: string;
  provider: string;
  complexity: string;
  priority: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  cached: boolean;
  escalated: boolean;
  error?: string;
  createdAt: string;
}

type TelemetrySinkFn = (row: TelemetryRow) => Promise<void>;
let sink: TelemetrySinkFn | null = null;

export function setTelemetrySink(fn: TelemetrySinkFn): void {
  sink = fn;
}

/** In-memory ring buffer — last 1000 rows, for /ai/metrics. */
const MAX_ROWS = 1_000;
const rows: TelemetryRow[] = [];

export function recordRequest(row: TelemetryRow): void {
  rows.push(row);
  if (rows.length > MAX_ROWS) rows.shift();
  if (sink) sink(row).catch((err) => logger.error({ err }, 'telemetry sink error'));
  logger.debug(
    { requestId: row.requestId, model: row.modelUsed, cost: row.costUsd, latency: row.latencyMs },
    'request recorded',
  );
}

export function getRecentRows(limit = 50): TelemetryRow[] {
  return rows.slice(-limit);
}

export function getModelRollup(): Record<string, { calls: number; totalCost: number; avgLatencyMs: number }> {
  const rollup: Record<string, { calls: number; totalCost: number; totalLatency: number }> = {};
  for (const row of rows) {
    const r = rollup[row.modelUsed] ?? { calls: 0, totalCost: 0, totalLatency: 0 };
    r.calls++;
    r.totalCost += row.costUsd;
    r.totalLatency += row.latencyMs;
    rollup[row.modelUsed] = r;
  }
  return Object.fromEntries(
    Object.entries(rollup).map(([model, r]) => [
      model,
      { calls: r.calls, totalCost: r.totalCost, avgLatencyMs: Math.round(r.totalLatency / r.calls) },
    ]),
  );
}

// ─── Daily budget tracker ─────────────────────────────────────────────────

class BudgetTracker {
  total = 0;
  private day = todayString();

  add(cost: number): void {
    if (todayString() !== this.day) {
      this.total = 0;
      this.day = todayString();
    }
    this.total += cost;
  }

  exceeded(): boolean {
    return env.DAILY_BUDGET_USD > 0 && this.total >= env.DAILY_BUDGET_USD;
  }
}

export const budget = new BudgetTracker();

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}
