/**
 * Runnable demo of every routing scenario.
 *
 * Requires the server to be running on PORT (default 3000):
 *   npx tsx src/server.ts
 *
 * Then run:
 *   npx tsx examples/usage.ts
 */

const BASE = `http://localhost:${process.env.PORT ?? 3000}`;

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  console.log(`\n── POST ${path} ──`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  const json = await res.json();
  console.log(`\n── GET ${path} ──`);
  console.log(JSON.stringify(json, null, 2));
  return json;
}

async function main() {
  // 1. Simple task — expect simple tier model
  await post('/ai/run', {
    task: 'format',
    input: 'Convert to JSON: name Ada Lovelace, born 1815, field mathematics.',
    priority: 'balanced',
    debug: true,
  });

  // 2. Medium complexity — code generation
  await post('/ai/run', {
    task: 'codegen',
    input: 'Write a TypeScript function that debounces an async function with a configurable delay.',
    priority: 'balanced',
    debug: true,
  });

  // 3. Complex task — architecture
  await post('/ai/run', {
    task: 'architecture',
    input: 'Design a scalable event-driven payment processing system that handles 100k TPS. ' +
      'Cover the database schema, message queue design, idempotency, and failure recovery.',
    priority: 'quality',
    debug: true,
  });

  // 4. Speed priority — should use cheapest / fastest model
  await post('/ai/run', {
    task: 'summarize',
    input: 'Summarize in one sentence: The quick brown fox jumps over the lazy dog.',
    priority: 'speed',
    debug: true,
  });

  // 5. Pinned prompt template
  await post('/ai/run', {
    task: 'transform',
    input: 'name: John Smith, age: 42, city: London',
    promptId: 'json-transform',
    debug: true,
  });

  // 6. Force a specific model
  await post('/ai/run', {
    task: 'explain',
    input: 'What is a monad?',
    forceModel: 'gpt-4.1-nano',
    debug: true,
  });

  // 7. Async job
  const enqueued = await post('/ai/run?async=true', {
    task: 'architecture',
    input: 'Design a payment gateway with PCI-DSS compliance considerations.',
  });

  if (enqueued.jobId) {
    // Poll until done (simple demo loop)
    let tries = 0;
    while (tries++ < 20) {
      await new Promise((r) => setTimeout(r, 1500));
      const status = await get(`/ai/jobs/${enqueued.jobId}`);
      if (status.state === 'completed' || status.state === 'failed') break;
    }
  }

  // 8. List models
  await get('/ai/models');

  // 9. List prompts
  await get('/ai/prompts');

  // 10. Metrics
  await get('/ai/metrics?limit=10');
}

main().catch((err) => {
  console.error('Example failed:', err);
  process.exit(1);
});
