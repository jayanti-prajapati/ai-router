/**
 * Token estimation and cost math.
 *
 * Rule of thumb: 1 token ≈ 3.7 characters of English prose. This is close
 * enough for routing decisions; actual billing comes from the provider's
 * reported usage counts, which we use in the telemetry row.
 */
import type { Complexity, ModelSpec } from './types.js';

/** Rough character-to-token ratio (conservative, slightly over-estimates). */
const CHARS_PER_TOKEN = 3.7;

/** Estimate the number of tokens in a string without calling a tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate output token count from input token count and complexity tier.
 *
 * These multipliers are tuned from empirical observation:
 *  - simple: short, mechanical transforms (low ratio)
 *  - medium: code generation, structured output (moderate)
 *  - complex: architecture docs, reasoning traces (high)
 */
export function estimateOutputTokens(inputTokens: number, complexity: Complexity): number {
  const ratio = complexity === 'simple' ? 0.5 : complexity === 'medium' ? 1.2 : 2.0;
  return Math.ceil(inputTokens * ratio);
}

/**
 * Compute the actual USD cost from real token counts reported by the provider.
 * Used after the call to record telemetry.
 */
export function computeCost(model: ModelSpec, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * model.inputCostPerMTok + outputTokens * model.outputCostPerMTok) / 1_000_000
  );
}

/**
 * Estimate cost before the call (used by the cost guard).
 * Combines estimated input with estimated output based on tier.
 */
export function estimateCost(model: ModelSpec, inputTokens: number, complexity: Complexity): number {
  const outputTokens = estimateOutputTokens(inputTokens, complexity);
  return computeCost(model, inputTokens, outputTokens);
}
