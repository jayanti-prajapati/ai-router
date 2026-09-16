/**
 * Process entry point: boot, listen, graceful shutdown.
 *
 * Start with:
 *   node --import tsx/esm src/server.ts
 *   # or in dev:
 *   npx tsx watch src/server.ts
 */
import { buildApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });
  console.log(`[ai-model-router] Listening on http://${env.HOST}:${env.PORT}`);

  const shutdown = async (signal: string) => {
    console.log(`[ai-model-router] Received ${signal}, shutting down...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[ai-model-router] Fatal error:', err);
  process.exit(1);
});
