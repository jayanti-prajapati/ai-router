/**
 * Shared domain types. No vendor-specific types leak through here — all
 * provider adapters normalise to NormalizedRequest / NormalizedResponse.
 */

// ─── Routing primitives ────────────────────────────────────────────────────

export type Complexity = "simple" | "medium" | "complex";
export type Priority = "speed" | "balanced" | "quality";
export type ProviderName = "openai" | "anthropic" | "local";

// ─── Task constants ─────────────────────────────────────────────────────────

/**
 * Built-in task name constants.
 *
 * Each value is the string the classifier recognises for routing. Using these
 * constants gives you autocomplete and ensures the task name matches exactly
 * what the classifier expects — no magic strings needed.
 *
 * Custom task names are always accepted; these are just the ones that receive
 * a built-in complexity hint from the classifier.
 *
 * @example
 * ```typescript
 * import { Task, runAiRequest } from 'smart-ai-router';
 *
 * // Simple tier — formatting, JSON, spelling
 * await runAiRequest({ task: Task.FORMAT,       input: 'Convert to JSON: ...' });
 * await runAiRequest({ task: Task.SUMMARIZE,    input: 'Summarize: ...' });
 * await runAiRequest({ task: Task.TRANSLATE,    input: 'Translate to French: ...' });
 *
 * // Medium tier — code generation, API integration
 * await runAiRequest({ task: Task.CODEGEN,      input: 'Write a debounce function' });
 *
 * // Complex tier — architecture, deep reasoning
 * await runAiRequest({ task: Task.ARCHITECTURE, input: 'Design a payment system ...' });
 * await runAiRequest({ task: Task.CODE_REVIEW,  input: code });
 *
 * // Custom task — still works, classified by heuristic
 * await runAiRequest({ task: 'my-custom-task',  input: '...' });
 * ```
 */
export const Task = {
  // ── Simple tier ────────────────────────────────────────────────────────────
  /** Formatting, JSON conversion, text transforms */
  FORMAT: "format",
  /** JSON-specific conversion tasks */
  JSON: "json",
  /** Language translation */
  TRANSLATE: "translate",
  /** Classification or labelling */
  CLASSIFY: "classify",
  /** Text summarisation */
  SUMMARIZE: "summarize",
  /** Explanation of a concept or system */
  EXPLAIN: "explain",
  /** Data or format transformation (no classifier hint — classified by heuristic) */
  TRANSFORM: "transform",

  // ── Medium tier ────────────────────────────────────────────────────────────
  /** Code generation */
  CODEGEN: "codegen",
  /** API integration tasks */
  API_INTEGRATION: "api-integration",
  /** Structured output generation */
  STRUCTURED_OUTPUT: "structured-output",

  // ── Complex tier ───────────────────────────────────────────────────────────
  /** System architecture design */
  ARCHITECTURE: "architecture",
  /** System design (alias for architecture) */
  SYSTEM_DESIGN: "system-design",
  /** Code review */
  CODE_REVIEW: "code-review",
  /** Complex reasoning or analysis */
  REASONING: "reasoning",
} as const;

/**
 * Open string-union of all built-in task names.
 *
 * Known values get full IDE autocomplete; any other string is still valid.
 * Pass this type to `RunRequest.task` — it replaces the old plain `string`.
 */
export type TaskType = (typeof Task)[keyof typeof Task] | (string & {});

// ─── Model catalog entry ───────────────────────────────────────────────────

export interface ModelSpec {
  id: string;
  provider: ProviderName;
  tier: Complexity;
  /** USD per 1M input tokens */
  inputCostPerMTok: number;
  /** USD per 1M output tokens */
  outputCostPerMTok: number;
  /** Maximum context window in tokens (input + output combined) */
  contextWindow: number;
  /** Maximum tokens the model may generate */
  maxOutputTokens: number;
  /** Observed median latency in ms (used for speed-priority ordering) */
  avgLatencyMs: number;
  /** Subjective quality score 0–1 (used for quality-priority ordering) */
  quality: number;
}

// ─── Classification ─────────────────────────────────────────────────────────

export interface ClassificationResult {
  complexity: Complexity;
  confidence: number;
  signals: string[];
  estimatedInputTokens: number;
  source: "heuristic" | "meta-model" | "forced";
}

// ─── Routing ────────────────────────────────────────────────────────────────

export interface RoutingDecision {
  model: ModelSpec;
  complexity: Complexity;
  requestedTier: Complexity;
  reason: string;
  estimatedCost: number;
  downgraded: boolean;
  experiment?: { name: string; arm: "control" | "variant" };
}

// ─── Provider I/O ───────────────────────────────────────────────────────────

export interface NormalizedRequest {
  modelId: string;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
}

export interface NormalizedResponse {
  output: string;
  inputTokens: number;
  outputTokens: number;
  finishReason: "stop" | "length" | "content_filter" | "unknown";
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RunRequest {
  /** The task type. Use \`Task.*\` constants for autocomplete, or any custom string. */
  task: TaskType;
  input: string;
  priority?: Priority;
  forceModel?: string;
  promptId?: string;
  acceptCost?: boolean;
  noCache?: boolean;
  debug?: boolean;
}

export interface RunResponse {
  modelUsed: string;
  complexity: Complexity;
  tokensUsed: number;
  costEstimate: number;
  output: string;
  cached: boolean;
  latencyMs: number;
  escalatedFrom?: string;
  debug?: {
    signals: string[];
    routingReason: string;
    inputTokens: number;
    outputTokens: number;
    experiment?: { name: string; arm: "control" | "variant" };
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class NoModelAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoModelAvailableError";
  }
}

export class CostLimitError extends Error {
  constructor(
    public readonly estimatedCost: number,
    public readonly limit: number,
    public readonly cheapestAvailable: string,
  ) {
    super(
      `Estimated cost $${estimatedCost.toFixed(4)} exceeds limit $${limit.toFixed(4)}. ` +
        `Cheapest available: ${cheapestAvailable}. Re-submit with acceptCost=true to proceed.`,
    );
    this.name = "CostLimitError";
  }
}
