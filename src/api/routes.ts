/**
 * Fastify route definitions.
 *
 * Endpoints:
 *   POST /ai/run              — synchronous completion (or ?async=true for queue)
 *   GET  /ai/jobs/:id         — poll an async job
 *   GET  /ai/models           — list available models
 *   GET  /ai/prompts          — list registered prompt templates
 *   GET  /ai/metrics?limit=N  — recent telemetry + per-model rollup
 *   GET  /health              — liveness probe
 */
import type { FastifyInstance } from 'fastify';
import { runAiRequest } from '../services/ai.service.js';
import { enqueue, getJobStatus } from '../services/queue.js';
import { getRecentRows, getModelRollup } from '../services/telemetry.js';
import { listPrompts } from '../prompts/registry.js';
import { MODELS } from '../config/models.js';
import { env } from '../config/env.js';
import { CostLimitError, NoModelAvailableError } from '../core/types.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /ai/run ──────────────────────────────────────────────────────────
  app.post('/ai/run', async (req, reply) => {
    const async_ = (req.query as Record<string, string>).async === 'true';
    const body = req.body as Record<string, unknown>;

    if (!body.task || !body.input) {
      return reply.status(400).send({ error: '`task` and `input` are required' });
    }

    const request = {
      task: String(body.task),
      input: String(body.input),
      priority: body.priority as 'speed' | 'balanced' | 'quality' | undefined,
      forceModel: body.forceModel as string | undefined,
      promptId: body.promptId as string | undefined,
      acceptCost: Boolean(body.acceptCost),
      noCache: Boolean(body.noCache),
      debug: Boolean(body.debug),
    };

    if (async_) {
      try {
        const jobId = await enqueue(request);
        return reply.status(202).send({ jobId, status: 'queued' });
      } catch (err) {
        return reply.status(503).send({ error: (err as Error).message });
      }
    }

    try {
      const result = await runAiRequest(request);
      return reply.send(result);
    } catch (err) {
      if (err instanceof CostLimitError) {
        return reply.status(402).send({
          error: err.message,
          cheapestAvailable: err.cheapestAvailable,
        });
      }
      if (err instanceof NoModelAvailableError) {
        return reply.status(503).send({ error: err.message });
      }
      app.log.error(err);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // ── GET /ai/jobs/:id ──────────────────────────────────────────────────────
  app.get('/ai/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const status = await getJobStatus(id);
    if (!status) return reply.status(404).send({ error: 'Job not found' });
    return reply.send(status);
  });

  // ── GET /ai/models ─────────────────────────────────────────────────────────
  app.get('/ai/models', async (_req, reply) => {
    return reply.send({
      models: MODELS.map((m) => ({
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        inputCostPerMTok: m.inputCostPerMTok,
        outputCostPerMTok: m.outputCostPerMTok,
      })),
      forceModelActive: env.FORCE_MODEL ?? null,
      maxCostPerRequest: env.MAX_COST_PER_REQUEST,
    });
  });

  // ── GET /ai/prompts ────────────────────────────────────────────────────────
  app.get('/ai/prompts', async (_req, reply) => {
    return reply.send({ prompts: listPrompts() });
  });

  // ── GET /ai/metrics ────────────────────────────────────────────────────────
  app.get('/ai/metrics', async (req, reply) => {
    const limit = Math.min(parseInt((req.query as Record<string, string>).limit ?? '50', 10), 1000);
    return reply.send({
      recent: getRecentRows(limit),
      rollup: getModelRollup(),
    });
  });

  // ── GET /health ────────────────────────────────────────────────────────────
  app.get('/health', async (_req, reply) => {
    return reply.send({ status: 'ok' });
  });
}
