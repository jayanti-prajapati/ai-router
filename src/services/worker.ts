/**
 * BullMQ worker process. Run as a separate process alongside the server:
 *
 *   npm run worker
 *
 * It consumes jobs from the "ai-requests" queue, calls runAiRequest(), and
 * stores the result back in BullMQ so the polling endpoint can return it.
 *
 * Requirements: QUEUE_ENABLED=true, REDIS_URL set.
 */
import { env } from '../config/env.js';
import { runAiRequest } from './ai.service.js';
import { QUEUE_NAME } from './queue.js';
import { logger } from './telemetry.js';
import type { JobData, JobResult } from './queue.js';

async function main() {
  if (!env.QUEUE_ENABLED || !env.REDIS_URL) {
    console.error('[worker] QUEUE_ENABLED must be true and REDIS_URL must be set');
    process.exit(1);
  }

  const { Worker } = await import('bullmq');

  const worker = new Worker<JobData, JobResult>(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id }, 'processing job');
      const response = await runAiRequest(job.data.request);
      return { response };
    },
    {
      connection: { url: env.REDIS_URL },
      concurrency: 4,
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'job failed');
  });

  logger.info({}, `[worker] listening on queue "${QUEUE_NAME}"`);

  const shutdown = async () => {
    logger.info({}, '[worker] shutting down...');
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[worker] fatal error', err);
  process.exit(1);
});
