/**
 * smart-ai-router — public API surface
 *
 * Primary usage:
 *   import { runAiRequest } from 'smart-ai-router';
 *
 * Advanced (lower-level building blocks):
 *   import { classify, route, scoreOutput } from 'smart-ai-router';
 *   import type { RunRequest, RunResponse } from 'smart-ai-router';
 *
 * Adding a custom provider:
 *   import { BaseProvider, getProvider } from 'smart-ai-router';
 */

// ── Primary orchestration ──────────────────────────────────────────────────
export { runAiRequest } from "./services/ai.service.js";

// ── Types ──────────────────────────────────────────────────────────────────
export type {
  RunRequest,
  RunResponse,
  Complexity,
  Priority,
  ModelSpec,
  ProviderName,
  ClassificationResult,
  RoutingDecision,
  NormalizedRequest,
  NormalizedResponse,
} from "./core/types.js";
export { NoModelAvailableError, CostLimitError } from "./core/types.js";

// ── Lower-level building blocks ────────────────────────────────────────────
export { classify } from "./core/classifier.js";
export { route } from "./core/router.js";
export type { RouteOptions } from "./core/router.js";
export { scoreOutput } from "./core/quality.js";
export type { QualityResult } from "./core/quality.js";
export {
  estimateTokens,
  computeCost,
  estimateCost,
  estimateOutputTokens,
} from "./core/cost.js";

// ── Provider registry ──────────────────────────────────────────────────────
export { getProvider, resetProviderRegistry } from "./providers/registry.js";
export { BaseProvider, ProviderError } from "./providers/base.provider.js";

// ── Prompt registry ────────────────────────────────────────────────────────
export {
  getPrompt,
  render,
  listPrompts,
  promptRef,
} from "./prompts/registry.js";
export type { PromptTemplate } from "./prompts/registry.js";

// ── Telemetry ──────────────────────────────────────────────────────────────
export {
  setTelemetrySink,
  recordRequest,
  getRecentRows,
  getModelRollup,
  budget,
  logger,
} from "./services/telemetry.js";
export type { TelemetryRow } from "./services/telemetry.js";

// ── Cache ──────────────────────────────────────────────────────────────────
export { getCached, setCached, clearCache } from "./services/cache.js";

// ── Model catalog ──────────────────────────────────────────────────────────
export {
  MODELS,
  TIER_ORDER,
  modelsForTier,
  getModel,
  effectiveRate,
} from "./config/models.js";
