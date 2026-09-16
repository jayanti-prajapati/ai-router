/**
 * The router — the core brain.
 *
 * Decision order (each step can only narrow the choice):
 *   1. Overrides       — global FORCE_MODEL, then client forceModel.
 *   2. Tier            — from the classifier, shifted by `priority`.
 *   3. Context fit     — drop models that cannot hold the prompt.
 *   4. Candidate order — by priority: cost | balanced | quality.
 *   5. Cost guard      — estimate, compare to ceiling, downgrade or reject.
 *   6. A/B experiment  — optionally swap in a variant model.
 *
 * Every branch records a human-readable reason; when routing surprises you in
 * production, the reason string is what tells you which rule fired.
 */
import { env } from '../config/env.js';
import { MODELS, TIER_ORDER, effectiveRate, getModel, modelsForTier } from '../config/models.js';
import { estimateCost } from './cost.js';
import { CostLimitError, NoModelAvailableError } from './types.js';
import type {
  ClassificationResult,
  Complexity,
  ModelSpec,
  Priority,
  RoutingDecision,
  RunRequest,
} from './types.js';

/** priority shifts the tier by one step in either direction. */
function adjustTier(tier: Complexity, priority: Priority): Complexity {
  const i = TIER_ORDER.indexOf(tier);
  if (priority === 'speed') return TIER_ORDER[Math.max(0, i - 1)]!;
  if (priority === 'quality') return TIER_ORDER[Math.min(TIER_ORDER.length - 1, i + 1)]!;
  return tier;
}

/** Candidate ordering within a tier. */
function orderCandidates(models: ModelSpec[], priority: Priority): ModelSpec[] {
  const sorted = [...models];
  switch (priority) {
    case 'speed':
      return sorted.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs || effectiveRate(a) - effectiveRate(b));
    case 'quality':
      return sorted.sort((a, b) => b.quality - a.quality || effectiveRate(a) - effectiveRate(b));
    case 'balanced':
    default:
      // Value = quality per dollar, with a floor so free models don't divide by zero.
      return sorted.sort(
        (a, b) => b.quality / (effectiveRate(b) + 0.05) - a.quality / (effectiveRate(a) + 0.05),
      );
  }
}

/** Models from `tier` and, if that tier is empty, the nearest populated tier. */
function candidatesForTier(tier: Complexity, inputTokens: number): ModelSpec[] {
  const startIndex = TIER_ORDER.indexOf(tier);
  // Walk outward: exact tier first, then up (better), then down (cheaper).
  const order: Complexity[] = [
    TIER_ORDER[startIndex]!,
    ...TIER_ORDER.slice(startIndex + 1),
    ...TIER_ORDER.slice(0, startIndex).reverse(),
  ];
  for (const t of order) {
    const fit = modelsForTier(t).filter((m) => m.contextWindow > inputTokens * 1.2);
    if (fit.length > 0) return fit;
  }
  return [];
}

export interface RouteOptions {
  /** Models already tried and failed — excluded from selection. */
  exclude?: string[];
  /** Force at least this tier (used by quality-retry escalation). */
  minTier?: Complexity;
  /** Caller accepted a cost above the ceiling. */
  acceptCost?: boolean;
  /** Stable key for A/B bucketing (user id, session id, request hash). */
  experimentKey?: string;
}

export function route(
  req: RunRequest,
  classification: ClassificationResult,
  opts: RouteOptions = {},
): RoutingDecision {
  const priority: Priority = req.priority ?? 'balanced';
  const inputTokens = classification.estimatedInputTokens;

  // ---------- 1. Overrides ----------
  const override = env.FORCE_MODEL || (env.ALLOW_CLIENT_FORCE_MODEL ? req.forceModel : undefined);
  if (override) {
    const forced = getModel(override);
    if (!forced) {
      throw new NoModelAvailableError(
        `Unknown or disabled model "${override}". Available: ${MODELS.map((m) => m.id).join(', ')}`,
      );
    }
    return {
      model: forced,
      complexity: classification.complexity,
      requestedTier: classification.complexity,
      reason: env.FORCE_MODEL ? 'global FORCE_MODEL flag' : 'client forceModel override',
      estimatedCost: estimateCost(forced, inputTokens, classification.complexity),
      downgraded: false,
    };
  }

  // ---------- 2. Tier ----------
  let tier = adjustTier(classification.complexity, priority);
  if (opts.minTier && TIER_ORDER.indexOf(opts.minTier) > TIER_ORDER.indexOf(tier)) {
    tier = opts.minTier;
  }
  const requestedTier = tier;

  // ---------- 3 + 4. Candidates, filtered and ordered ----------
  const exclude = new Set(opts.exclude ?? []);
  const candidates = orderCandidates(
    candidatesForTier(tier, inputTokens).filter((m) => !exclude.has(m.id)),
    priority,
  );

  if (candidates.length === 0) {
    throw new NoModelAvailableError(
      `No model available for tier "${tier}" with ~${inputTokens} input tokens` +
        (exclude.size ? ` (excluded: ${[...exclude].join(', ')})` : ''),
    );
  }

  const preferred = candidates[0]!;
  let decision: RoutingDecision = {
    model: preferred,
    complexity: classification.complexity,
    requestedTier,
    reason: `tier=${tier} priority=${priority} (${classification.source})`,
    estimatedCost: estimateCost(preferred, inputTokens, tier),
    downgraded: false,
  };

  // ---------- 5. Cost guard ----------
  decision = applyCostGuard(decision, inputTokens, tier, exclude, priority, opts.acceptCost === true);

  // ---------- 6. A/B experiment ----------
  return applyExperiment(decision, opts.experimentKey, inputTokens, tier);
}

/**
 * Enforce max_cost_per_request.
 *   - Under the ceiling: nothing happens.
 *   - Over, with fallback enabled: walk down the tiers to the first model that
 *     fits, preferring the cheapest option we can still justify.
 *   - Over, with fallback disabled: throw CostLimitError so the API can return
 *     402 and let the caller confirm with acceptCost=true.
 */
function applyCostGuard(
  decision: RoutingDecision,
  inputTokens: number,
  tier: Complexity,
  exclude: Set<string>,
  priority: Priority,
  acceptCost: boolean,
): RoutingDecision {
  const limit = env.MAX_COST_PER_REQUEST;
  if (decision.estimatedCost <= limit || acceptCost) return decision;

  if (!env.FALLBACK_TO_CHEAPER_MODEL) {
    const cheapest = cheapestAffordable(inputTokens, limit, exclude);
    throw new CostLimitError(decision.estimatedCost, limit, cheapest?.id ?? decision.model.id);
  }

  // Walk tiers downward looking for something within budget.
  for (let i = TIER_ORDER.indexOf(tier); i >= 0; i--) {
    const t = TIER_ORDER[i]!;
    const affordable = orderCandidates(
      modelsForTier(t).filter(
        (m) =>
          !exclude.has(m.id) &&
          m.contextWindow > inputTokens * 1.2 &&
          estimateCost(m, inputTokens, t) <= limit,
      ),
      priority,
    );
    const pick = affordable[0];
    if (pick) {
      return {
        ...decision,
        model: pick,
        estimatedCost: estimateCost(pick, inputTokens, t),
        downgraded: true,
        reason:
          `${decision.reason}; downgraded from ${decision.model.id} ` +
          `($${decision.estimatedCost.toFixed(4)} > $${limit.toFixed(4)} cap) to ${pick.id}`,
      };
    }
  }

  // Nothing fits the budget at any tier — the prompt itself is too expensive.
  throw new CostLimitError(decision.estimatedCost, limit, decision.model.id);
}

function cheapestAffordable(
  inputTokens: number,
  limit: number,
  exclude: Set<string>,
): ModelSpec | undefined {
  return MODELS.filter((m) => !exclude.has(m.id) && m.contextWindow > inputTokens * 1.2)
    .filter((m) => estimateCost(m, inputTokens, m.tier) <= limit)
    .sort((a, b) => effectiveRate(a) - effectiveRate(b))[0];
}

/**
 * A/B testing. Bucketing is a deterministic hash of the experiment key, so the
 * same user stays in the same arm across requests and the telemetry rows can be
 * grouped by arm later.
 */
function applyExperiment(
  decision: RoutingDecision,
  key: string | undefined,
  inputTokens: number,
  tier: Complexity,
): RoutingDecision {
  const experiments = Object.entries(env.AB_EXPERIMENTS);
  if (experiments.length === 0 || !key) return decision;

  for (const [name, cfg] of experiments) {
    if (cfg.control !== decision.model.id) continue;
    const variant = getModel(cfg.variant);
    if (!variant) continue;

    const bucket = hashToUnit(`${name}:${key}`);
    if (bucket < cfg.split) {
      return {
        ...decision,
        model: variant,
        estimatedCost: estimateCost(variant, inputTokens, tier),
        reason: `${decision.reason}; A/B "${name}" variant arm`,
        experiment: { name, arm: 'variant' },
      };
    }
    return { ...decision, experiment: { name, arm: 'control' } };
  }
  return decision;
}

/** FNV-1a -> [0,1). Stable across processes, unlike Math.random or hashCode. */
function hashToUnit(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0xffffffff;
}
