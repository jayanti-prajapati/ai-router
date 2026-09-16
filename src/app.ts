/**
 * Fastify application factory.
 *
 * Returns a fully configured Fastify instance without binding to a port.
 * This separation makes the app importable in tests without listening.
 *
 * Usage:
 *   const app = await buildApp();
 *   await app.listen({ port: 3000 });
 */
import Fastify from 'fastify';
import { registerRoutes } from './api/routes.js';
import { env } from './config/env.js';

export async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'production',
  });

  // Parse JSON bodies.
  await app.register(import('@fastify/formbody'));

  // Register all routes.
  await registerRoutes(app);

  return app;
}
