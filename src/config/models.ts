/**
 * Model catalog — the single place you edit to add or retire a model.
 *
 * PRICES ARE CONFIGURATION, NOT TRUTH. They are USD per 1M tokens as published
 * at the time of writing; verify against the vendor pricing pages before you
 * rely on the cost guard in production, and update them in one place here.
 *   OpenAI:    https://openai.com/api/pricing
 *   Anthropic: https://docs.claude.com/en/docs/about-claude/pricing
 */
import { env, enabledProviders } from './env.js';
import type { Complexity, ModelSpec } from '../core/types.js';

const CATALOG: ModelSpec[] = [
  // ---------------- SIMPLE tier: high volume, latency-sensitive ----------------
  {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    tier: 'simple',
    inputCostPerMTok: 0.1,
    outputCostPerMTok: 0.4,
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    avgLatencyMs: 700,
    quality: 0.45,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    tier: 'simple',
    inputCostPerMTok: 1,
    outputCostPerMTok: 5,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    avgLatencyMs: 900,
    quality: 0.6,
  },

  // ---------------- MEDIUM tier: default workhorse ----------------
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    tier: 'medium',
    inputCostPerMTok: 0.4,
    outputCostPerMTok: 1.6,
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    avgLatencyMs: 1_400,
    quality: 0.68,
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    tier: 'medium',
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    avgLatencyMs: 2_200,
    quality: 0.85,
  },

  // ---------------- COMPLEX tier: reasoning, architecture, critical paths ----------------
  {
    id: 'gpt-4.1',
    provider: 'openai',
    tier: 'complex',
    inputCostPerMTok: 2,
    outputCostPerMTok: 8,
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    avgLatencyMs: 3_000,
    quality: 0.82,
  },
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    tier: 'complex',
    inputCostPerMTok: 5,
    outputCostPerMTok: 25,
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    avgLatencyMs: 4_500,
    quality: 0.97,
  },
];

// A self-hosted model costs nothing per token, so it is modelled at $0 and the
// cost guard will always prefer it when it is good enough for the tier.
if (enabledProviders.local) {
  CATALOG.push({
    id: env.LOCAL_MODEL,
    provider: 'local',
    tier: 'simple',
    inputCostPerMTok: 0,
    outputCostPerMTok: 0,
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    avgLatencyMs: 1_800,
    quality: 0.4,
  });
}

/** Only models whose provider is actually configured. */
export const MODELS: ModelSpec[] = CATALOG.filter((m) => enabledProviders[m.provider]);

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelSpec | undefined {
  return BY_ID.get(id);
}

/** Models registered for a tier, cheapest first. */
export function modelsForTier(tier: Complexity): ModelSpec[] {
  return MODELS.filter((m) => m.tier === tier).sort(
    (a, b) => effectiveRate(a) - effectiveRate(b),
  );
}

/** Blended $/MTok assuming a 3:1 input:output ratio — good enough for ordering. */
export function effectiveRate(m: ModelSpec): number {
  return m.inputCostPerMTok * 0.75 + m.outputCostPerMTok * 0.25;
}

export const TIER_ORDER: Complexity[] = ['simple', 'medium', 'complex'];

if (MODELS.length === 0) {
  throw new Error(
    'No models available: set OPENAI_API_KEY, ANTHROPIC_API_KEY or LOCAL_ENABLED=true.',
  );
}
