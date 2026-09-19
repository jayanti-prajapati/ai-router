# smart-ai-router

[![npm](https://img.shields.io/npm/v/smart-ai-router)](https://www.npmjs.com/package/smart-ai-router)
[![CI](https://github.com/jayanti-prajapati/smart-ai-router/actions/workflows/ci.yml/badge.svg)](https://github.com/jayanti-prajapati/smart-ai-router/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Production-ready AI model router for Node.js + TypeScript.**

Automatically classifies prompt complexity, routes to the cheapest model that
can handle it, guards your per-request and daily spend, retries on poor-quality
output, and A/B tests models — all in a single function call, with zero vendor
lock-in.

```
simple prompt  → gpt-4.1-nano  ($0.0001)
medium prompt  → gpt-4.1-mini  ($0.0004)
complex prompt → gpt-4.1       ($0.003)
```

---

## Install

```bash
npm install smart-ai-router
```

Set at least one provider key:

```bash
cp node_modules/smart-ai-router/.env.example .env
# Edit .env: set OPENAI_API_KEY or ANTHROPIC_API_KEY
```

---

## Quick start

```typescript
import { Task, runAiRequest } from "smart-ai-router";

const result = await runAiRequest({
  task: Task.FORMAT,
  input: "Convert to JSON: name Ada Lovelace, born 1815, field mathematics.",
});

console.log(result.output);
// { "name": "Ada Lovelace", "born": 1815, "field": "mathematics" }

console.log(
  `Model: ${result.modelUsed}  Cost: $${result.costEstimate.toFixed(6)}`,
);
// Model: gpt-4.1-nano  Cost: $0.000094
```

No server required. Import and call — that's it.

---

## How routing works

```
Request
  │
  ├─ 1. Cache lookup          (SHA-256 of prompt + task + priority)
  │
  ├─ 2. Prompt template       ("json-transform@1" pins complexity=simple, temp=0)
  │
  ├─ 3. Classify complexity
  │      Heuristic scorer:
  │        • Token length (short → negative, long → positive)
  │        • Keyword weights (architecture/design → +2.5, translate/format → −2)
  │        • Code volume (LOC in fences)
  │        • Generation-verb + technical-noun detection
  │        • Task hint override
  │      If confidence < 0.7 AND ENABLE_META_CLASSIFIER=true:
  │        → cheap model emits SIMPLE/MEDIUM/COMPLEX
  │
  ├─ 4. Tier adjustment       (priority=speed → −1 tier, quality → +1 tier)
  │
  ├─ 5. Candidate selection   (models for tier, filtered by context window)
  │      Ordered by:
  │        speed    → lowest latency
  │        quality  → highest quality score
  │        balanced → quality per dollar
  │
  ├─ 6. Cost guard
  │      estimatedCost > MAX_COST_PER_REQUEST?
  │        FALLBACK_TO_CHEAPER_MODEL=true  → walk tiers downward, pick first fit
  │        FALLBACK_TO_CHEAPER_MODEL=false → throw CostLimitError (caller retries with acceptCost=true)
  │
  ├─ 7. A/B experiment        (FNV-1a hash of requestId → stable arm assignment)
  │
  ├─ 8. Provider call         (retry 3× with exponential backoff + full jitter)
  │
  ├─ 9. Quality gate          (empty, truncated, refusal, repetition loop, bad JSON)
  │      score < QUALITY_MIN_SCORE && not already escalated?
  │        → bump to next tier, retry once
  │
  ├─ 10. Telemetry            (structured log + sink row + budget tracker)
  │
  └─ 11. Cache write
```

---

## Complexity tiers

| Tier    | Score range | Models (default)                      | Typical requests                             |
| ------- | ----------- | ------------------------------------- | -------------------------------------------- |
| simple  | ≤ 0         | gpt-4.1-nano, claude-haiku-4-5, local | Formatting, JSON, spelling, short transforms |
| medium  | 0 – 3.5     | gpt-4.1-mini, claude-sonnet-5         | Code generation, API integration, summaries  |
| complex | > 3.5       | gpt-4.1, claude-opus-5                | Architecture, deep reasoning, large context  |

`priority=speed` shifts the tier one step down; `priority=quality` one step up.

---

## Task types

Import `Task` for autocomplete and type safety — no magic strings required.

```typescript
import { Task, runAiRequest } from "smart-ai-router";

// Simple tier — cheap, fast models
await runAiRequest({ task: Task.FORMAT, input: "Convert to JSON: ..." });
await runAiRequest({ task: Task.SUMMARIZE, input: "Summarize: ..." });
await runAiRequest({ task: Task.TRANSLATE, input: "Translate to French: ..." });
await runAiRequest({ task: Task.CLASSIFY, input: "Label this review: ..." });
await runAiRequest({ task: Task.EXPLAIN, input: "What is a monad?" });
await runAiRequest({ task: Task.TRANSFORM, input: "Reformat this CSV: ..." });

// Medium tier — code generation, structured output
await runAiRequest({ task: Task.CODEGEN, input: "Write a debounce function" });
await runAiRequest({
  task: Task.API_INTEGRATION,
  input: "Integrate Stripe webhooks",
});
await runAiRequest({
  task: Task.STRUCTURED_OUTPUT,
  input: "Extract fields from ...",
});

// Complex tier — architecture, reasoning, code review
await runAiRequest({
  task: Task.ARCHITECTURE,
  input: "Design a payment system ...",
});
await runAiRequest({
  task: Task.SYSTEM_DESIGN,
  input: "Design a URL shortener ...",
});
await runAiRequest({ task: Task.CODE_REVIEW, input: code });
await runAiRequest({
  task: Task.REASONING,
  input: "Analyse trade-offs of ...",
});

// Custom task — still works, classified by heuristic
await runAiRequest({ task: "my-custom-task", input: "..." });
```

All built-in task values and the tier they hint at:

| Constant                 | String value          | Complexity hint |
| ------------------------ | --------------------- | --------------- |
| `Task.FORMAT`            | `'format'`            | simple          |
| `Task.JSON`              | `'json'`              | simple          |
| `Task.TRANSLATE`         | `'translate'`         | simple          |
| `Task.CLASSIFY`          | `'classify'`          | simple          |
| `Task.SUMMARIZE`         | `'summarize'`         | simple          |
| `Task.EXPLAIN`           | `'explain'`           | _(heuristic)_   |
| `Task.TRANSFORM`         | `'transform'`         | _(heuristic)_   |
| `Task.CODEGEN`           | `'codegen'`           | medium          |
| `Task.API_INTEGRATION`   | `'api-integration'`   | medium          |
| `Task.STRUCTURED_OUTPUT` | `'structured-output'` | medium          |
| `Task.ARCHITECTURE`      | `'architecture'`      | complex         |
| `Task.SYSTEM_DESIGN`     | `'system-design'`     | complex         |
| `Task.CODE_REVIEW`       | `'code-review'`       | complex         |
| `Task.REASONING`         | `'reasoning'`         | complex         |

`TaskType` is an open union — any other string is valid and classified by the heuristic.

---

## API reference

### `runAiRequest(req: RunRequest): Promise<RunResponse>`

The primary function. Handles the full lifecycle: cache → classify → route → call → quality → telemetry → cache write.

#### `RunRequest`

| Field        | Type                                 | Required | Description                                             |
| ------------ | ------------------------------------ | -------- | ------------------------------------------------------- |
| `task`       | `TaskType`                           | ✓        | Task name — use `Task.*` constants or any custom string |
| `input`      | `string`                             | ✓        | The full prompt body                                    |
| `priority`   | `"speed" \| "balanced" \| "quality"` |          | Default: `"balanced"`                                   |
| `forceModel` | `string`                             |          | Bypass classification and routing entirely              |
| `promptId`   | `string`                             |          | Template reference, e.g. `"code-review@2"`              |
| `acceptCost` | `boolean`                            |          | Allow cost above `MAX_COST_PER_REQUEST`                 |
| `noCache`    | `boolean`                            |          | Skip read and write for this call                       |
| `debug`      | `boolean`                            |          | Include signals and routing reason in response          |

#### `RunResponse`

```typescript
{
  modelUsed:     string;     // e.g. "gpt-4.1-nano"
  complexity:    Complexity; // "simple" | "medium" | "complex"
  tokensUsed:    number;
  costEstimate:  number;     // USD
  output:        string;
  cached:        boolean;
  latencyMs:     number;
  escalatedFrom?: string;   // set if quality escalation fired
  debug?: {
    signals:       string[];
    routingReason: string;
    inputTokens:   number;
    outputTokens:  number;
    experiment?:   { name: string; arm: "control" | "variant" };
  };
}
```

---

## Providers

### OpenAI

```bash
OPENAI_API_KEY=sk-...
# Optional: override base URL for Azure, OpenRouter, Together, Groq, etc.
OPENAI_BASE_URL=https://api.openai.com/v1
```

### Anthropic

```bash
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_VERSION=2023-06-01
```

### Local (Ollama / vLLM / LM Studio)

```bash
LOCAL_ENABLED=true
LOCAL_MODEL=llama3
LOCAL_BASE_URL=http://localhost:11434/v1
```

Local models cost $0.00 per token — the cost guard will always prefer them when the tier allows.

---

## Cost model (September 2026)

| Model               | Input $/MTok | Output $/MTok | Tier    |
| ------------------- | ------------ | ------------- | ------- |
| gpt-4.1-nano        | $0.10        | $0.40         | simple  |
| claude-haiku-4-5    | $1.00        | $5.00         | simple  |
| gpt-4.1-mini        | $0.40        | $1.60         | medium  |
| claude-sonnet-5     | $3.00        | $15.00        | medium  |
| gpt-4.1             | $2.00        | $8.00         | complex |
| claude-opus-5       | $5.00        | $25.00        | complex |
| local (Ollama/vLLM) | $0.00        | $0.00         | simple  |

Update prices in `src/config/models.ts` — they are pure configuration, no rebuild needed.

---

## Prompt templates

Templates are versioned: `"code-review"` resolves to the latest version; `"code-review@1"` pins to v1. Old versions are never deleted so telemetry rows remain comparable.

```typescript
// Use the latest code-review template
await runAiRequest({ task: "review", input: code, promptId: "code-review" });

// Pin to version 1
await runAiRequest({ task: "review", input: code, promptId: "code-review@1" });
```

### Custom prompt templates

Use `registerPrompt()` to add your own system prompts at runtime — no forking required.

```typescript
import { registerPrompt, runAiRequest } from "smart-ai-router";

registerPrompt({
  id: "customer-support",
  version: 1,
  system:
    "You are a helpful customer support agent for Acme Corp. " +
    "Be polite, concise, and always offer a follow-up action.",
  pinnedComplexity: "medium", // classifier is skipped for this template
});

const result = await runAiRequest({
  task: "support",
  input: userMessage,
  promptId: "customer-support",
});
```

Registering a new version promotes it to `latest`; the old version remains resolvable by `@1` suffix:

```typescript
registerPrompt({
  id: "customer-support",
  version: 2,
  system: "Updated prompt v2",
});

getPrompt("customer-support"); // → version 2
getPrompt("customer-support@1"); // → version 1 (still works)
```

A template can override complexity and temperature:

```typescript
registerPrompt({
  id: "strict-json",
  version: 1,
  system: "Output only valid JSON. No prose.",
  user: "Convert:\n\n{{input}}",
  pinnedComplexity: "simple", // classifier skipped entirely
  temperature: 0, // deterministic output
});
```

---

## A/B testing

Set `AB_EXPERIMENTS` in your environment:

```bash
AB_EXPERIMENTS='{"haiku-vs-nano":{"control":"gpt-4.1-nano","variant":"claude-haiku-4-5","split":0.1}}'
```

10% of requests for `gpt-4.1-nano` will be bucketed to `claude-haiku-4-5`. Bucketing is a deterministic FNV-1a hash of `experimentName:requestId` — the same request always lands in the same arm, which makes telemetry grouping correct. The arm name is logged and returned in `debug.experiment` when `debug=true`.

---

## Adding a custom provider

Use `registerProvider(name, factory)` to add any vendor without forking the package.

```typescript
import { registerProvider, BaseProvider } from "smart-ai-router";
import type { NormalizedRequest, NormalizedResponse } from "smart-ai-router";

class GeminiProvider extends BaseProvider {
  readonly name = "gemini" as const;

  protected async send(req: NormalizedRequest): Promise<NormalizedResponse> {
    // Call your vendor's API here.
    // Use this.post() for a shared fetch wrapper with automatic error normalisation.
    const data = await this.post(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      { "x-goog-api-key": process.env.GEMINI_API_KEY! },
      { contents: [{ role: "user", parts: [{ text: req.prompt }] }] },
    );

    return {
      output: data.candidates[0].content.parts[0].text,
      inputTokens: data.usageMetadata.promptTokenCount,
      outputTokens: data.usageMetadata.candidatesTokenCount,
      finishReason: "stop",
    };
  }
}

// Register once at startup — the factory is called lazily on first use.
registerProvider("gemini", () => new GeminiProvider());
```

Then add a model entry to your model catalog and route requests to it:

```typescript
import { registerProvider, runAiRequest } from "smart-ai-router";
// After registering the provider above...

const result = await runAiRequest({
  task: "explain",
  input: "What is a transformer model?",
  forceModel: "gemini-2.0-flash",
});
```

> `registerProvider()` replaces any previously cached instance for that name, making it easy to swap implementations in tests.

---

## Wiring the telemetry sink

By default, telemetry is logged to stdout and held in an in-process ring buffer. In production, wire it to your database:

```typescript
import { setTelemetrySink } from "smart-ai-router";

setTelemetrySink(async (row) => {
  await db.insert(aiRequests).values({
    requestId: row.requestId,
    task: row.task,
    modelUsed: row.modelUsed,
    provider: row.provider,
    complexity: row.complexity,
    priority: row.priority,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    latencyMs: row.latencyMs,
    cached: row.cached,
    escalated: row.escalated,
    error: row.error,
    createdAt: row.createdAt,
  });
});
```

---

## Redis cache

Set `REDIS_URL` and the library automatically uses Redis instead of the in-process LRU. The same interface — no code changes:

```bash
REDIS_URL=redis://localhost:6379
CACHE_TTL_SECONDS=3600
```

---

## Async queue (BullMQ)

Requires `REDIS_URL` and `QUEUE_ENABLED=true`. Start the worker alongside your app:

```bash
node --import tsx/esm node_modules/smart-ai-router/dist/services/worker.js
```

Or, when using the built-in Fastify server, add `?async=true` to enqueue instead of blocking:

```bash
curl -X POST "http://localhost:3000/ai/run?async=true" \
  -H 'content-type: application/json' \
  -d '{ "task": "architecture", "input": "Design a payment gateway..." }'
# → { "jobId": "42", "status": "queued" }

curl http://localhost:3000/ai/jobs/42
# → { "id": "42", "state": "completed", "result": { ... } }
```

---

## Standalone HTTP server

The library ships an optional Fastify server that exposes all functionality over HTTP.

```bash
node --import tsx/esm node_modules/smart-ai-router/dist/server.js
```

Endpoints: `POST /ai/run`, `GET /ai/jobs/:id`, `GET /ai/models`, `GET /ai/prompts`, `GET /ai/metrics`, `GET /health`.

---

## Environment reference

| Variable                    | Default | Effect                                                      |
| --------------------------- | ------- | ----------------------------------------------------------- |
| `MAX_COST_PER_REQUEST`      | `0.05`  | Hard ceiling per call (USD)                                 |
| `FALLBACK_TO_CHEAPER_MODEL` | `true`  | Downgrade on budget breach vs. throw `CostLimitError`       |
| `DAILY_BUDGET_USD`          | `0`     | 0 = disabled; circuit-breaks to cheapest tier when exceeded |
| `ENABLE_META_CLASSIFIER`    | `false` | Second-opinion AI call when heuristic confidence < 0.7      |
| `FORCE_MODEL`               | —       | Global override: every request gets this model              |
| `ENABLE_QUALITY_RETRY`      | `true`  | Escalate once on bad output                                 |
| `QUALITY_MIN_SCORE`         | `0.5`   | 0–1; below this triggers escalation                         |
| `CACHE_ENABLED`             | `true`  | Prompt-hash cache (Redis or in-process LRU)                 |
| `CACHE_TTL_SECONDS`         | `3600`  | Cache entry lifetime                                        |
| `QUEUE_ENABLED`             | `false` | BullMQ async jobs (requires `REDIS_URL`)                    |

See `.env.example` for the full annotated reference.

---

## Production checklist

- [ ] Set `NODE_ENV=production`
- [ ] Provide `REDIS_URL` (shared cache, queue, cross-instance budget)
- [ ] Wire `setTelemetrySink()` to your database
- [ ] Set `DAILY_BUDGET_USD` to match your spend limits
- [ ] Review `MAX_COST_PER_REQUEST` per workload class
- [ ] Pin `AB_EXPERIMENTS` model ids to models you have quota for
- [ ] Update prices in `src/config/models.ts` whenever a vendor changes rates

---

## Versioning

This package follows [SemVer](https://semver.org/):

| Bump    | When                                                                 |
| ------- | -------------------------------------------------------------------- |
| `patch` | Bug fixes, doc updates, dependency bumps                             |
| `minor` | New provider, new exported API, new feature                          |
| `major` | Breaking change to `RunRequest`, `RunResponse`, or any exported type |

---

## Contributing

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes with tests
3. Open a pull request — CI must pass (typecheck + build across Node 18/20/22)

---

## License

MIT © 2026 Jayantilal Prajapat. See [LICENSE](./LICENSE).
