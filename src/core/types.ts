/**
 * Shared domain types. No vendor-specific types leak through here — all
 * provider adapters normalise to NormalizedRequest / NormalizedResponse.
 */

// ─── Routing primitives ────────────────────────────────────────────────────

export type Complexity = 'simple' | 'medium' | 'complex';
export type Priority = 'speed' | 'balanced' | 'quality';
export type ProviderName = 'openai' | 'anthropic' | 'local';

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
  source: 'heuristic' | 'meta-model' | 'forced';
}

// ─── Routing ────────────────────────────────────────────────────────────────

export interface RoutingDecision {
  model: ModelSpec;
  complexity: Complexity;
  requestedTier: Complexity;
  reason: string;
  estimatedCost: number;
  downgraded: boolean;
  experiment?: { name: string; arm: 'control' | 'variant' };
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
  finishReason: 'stop' | 'length' | 'content_filter' | 'unknown';
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RunRequest {
  task: string;
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
    experiment?: { name: string; arm: 'control' | 'variant' };
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class NoModelAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoModelAvailableError';
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
    this.name = 'CostLimitError';
  }
}
