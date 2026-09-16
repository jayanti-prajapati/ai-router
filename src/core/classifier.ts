/**
 * Complexity classifier.
 *
 * Two stages:
 *   1. A weighted heuristic score (free, ~1ms) over token length, keywords,
 *      code volume and task type. This handles the overwhelming majority.
 *   2. An optional meta-model call — a cheap model asked to emit one word —
 *      used only when the heuristic lands in an ambiguous band and
 *      ENABLE_META_CLASSIFIER is on. Costs a fraction of a cent and is still
 *      far cheaper than mis-routing a simple prompt to the top tier.
 */
import { env } from '../config/env.js';
import { estimateTokens } from './cost.js';
import { getProvider } from '../providers/registry.js';
import { getModel } from '../config/models.js';
import { logger } from '../services/telemetry.js';
import type { ClassificationResult, Complexity, RunRequest } from './types.js';

/** Keyword groups with weights. Matching is case-insensitive, word-boundary. */
const KEYWORD_WEIGHTS: Array<{ weight: number; words: string[] }> = [
  {
    // Strong signals of design / deep reasoning work.
    weight: 2.5,
    words: [
      'architecture',
      'architect',
      'design',
      'scalable',
      'scalability',
      'trade-?offs?',
      'strategy',
      'migration plan',
      'system design',
      'distributed',
      'consistency',
      'threat model',
      'root cause',
      'critical',
      'security review',
    ],
  },
  {
    // Moderate signals: analysis, comparison, multi-step reasoning.
    weight: 1.2,
    words: [
      'analy[sz]e',
      'compare',
      'evaluate',
      'optimi[sz]e',
      'refactor',
      'debug',
      'why',
      'explain',
      'implement',
      'integrate',
      'plan',
      'review',
      'benchmark',
      'test strategy',
    ],
  },
  {
    // Negative signals: mechanical transformations.
    weight: -2.0,
    words: [
      'translate',
      'rephrase',
      'reword',
      'summari[sz]e',
      'format',
      'convert to json',
      'to json',
      'uppercase',
      'lowercase',
      'fix typo',
      'spell ?check',
      'extract',
      'rename',
      'tidy',
      'lint',
    ],
  },
];

/** Task names that pin a tier regardless of prose, if you use them. */
const TASK_HINTS: Record<string, Complexity> = {
  format: 'simple',
  json: 'simple',
  translate: 'simple',
  classify: 'simple',
  summarize: 'simple',
  codegen: 'medium',
  'api-integration': 'medium',
  'structured-output': 'medium',
  architecture: 'complex',
  'system-design': 'complex',
  'code-review': 'complex',
  reasoning: 'complex',
};

const CODE_FENCE = /```[\s\S]*?```/g;

const GENERATION_VERB = /\b(write|implement|build|create|generate|add|set up)\b/i;
const TECHNICAL_NOUN =
  /\b(function|class|component|module|endpoint|api|middleware|service|script|query|schema|migration|pipeline|test|hook|worker|handler|parser|client|server)\b/i;

interface Signals {
  score: number;
  reasons: string[];
  tokens: number;
}

function scoreHeuristics(req: RunRequest): Signals {
  const text = `${req.task}\n${req.input}`;
  const tokens = estimateTokens(text);
  const reasons: string[] = [];
  let score = 0;

  // --- 1. Length. Long prompts almost always need more capable models. ---
  if (tokens < 300) {
    // Weak evidence only: a two-line prompt can still ask for real work
    // ("write a rate limiter"), so this must not dominate the other signals.
    score -= 1.0;
    reasons.push(`short prompt (~${tokens} tokens)`);
  } else if (tokens < 1_200) {
    score += 0.5;
    reasons.push(`medium prompt (~${tokens} tokens)`);
  } else if (tokens < 6_000) {
    score += 2.0;
    reasons.push(`long prompt (~${tokens} tokens)`);
  } else {
    score += 3.5;
    reasons.push(`very long prompt (~${tokens} tokens)`);
  }

  // --- 2. Keywords. ---
  for (const group of KEYWORD_WEIGHTS) {
    for (const word of group.words) {
      const re = new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(text)) {
        score += group.weight;
        reasons.push(`${group.weight > 0 ? '+' : ''}${group.weight} keyword "${word}"`);
        break; // Count each group once; repetition is not more evidence.
      }
    }
  }

  // --- 3. Code volume. A 400-line file is not a "minor fix". ---
  const fences = req.input.match(CODE_FENCE) ?? [];
  const codeText = fences.join('\n') || (looksLikeCode(req.input) ? req.input : '');
  const loc = codeText ? codeText.split('\n').length : 0;
  if (loc > 0) {
    if (loc < 30) {
      score -= 0.5;
      reasons.push(`small code block (${loc} loc)`);
    } else if (loc < 150) {
      score += 1.0;
      reasons.push(`moderate code block (${loc} loc)`);
    } else {
      score += 2.5;
      reasons.push(`large code block (${loc} loc)`);
    }
  }

  // --- 3b. Generation intent. "Write a function that..." is real work even
  // when the prompt is two lines long; this is the single most common way a
  // length-only heuristic under-routes.
  if (GENERATION_VERB.test(text) && TECHNICAL_NOUN.test(text)) {
    score += 1.5;
    reasons.push('code/artifact generation request');
  }

  // --- 4. Multi-step structure: numbered lists, "step", "then". ---
  const steps = (req.input.match(/^\s*\d+[.)]\s/gm) ?? []).length;
  if (steps >= 3) {
    score += 1.5;
    reasons.push(`${steps} enumerated requirements`);
  }

  // --- 5. Explicit task hint. ---
  const hint = TASK_HINTS[req.task.toLowerCase().trim()];
  if (hint) {
    // An explicit task name is the strongest signal we get — the caller told us.
    const nudge = hint === 'simple' ? -2.5 : hint === 'complex' ? 3.0 : 1.5;
    score += nudge;
    reasons.push(`task hint "${req.task}" -> ${hint}`);
  }

  return { score, reasons, tokens };
}

function looksLikeCode(text: string): boolean {
  const codeish = (text.match(/[{};]|=>|function |class |import |def /g) ?? []).length;
  return codeish / Math.max(text.split('\n').length, 1) > 0.5;
}

function scoreToTier(score: number): { complexity: Complexity; confidence: number } {
  // Thresholds are tuned so the ambiguous band is narrow; widen them if you
  // see too many escalations in telemetry.
  if (score <= 0) {
    return { complexity: 'simple', confidence: clamp(0.5 + Math.abs(score) / 6) };
  }
  if (score < 3.5) {
    return { complexity: 'medium', confidence: clamp(0.5 + Math.abs(score - 1.75) / 6) };
  }
  return { complexity: 'complex', confidence: clamp(0.5 + (score - 3.5) / 6) };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Classify a request. `priority` is NOT considered here — the classifier
 * answers "how hard is this?", the router answers "what should we spend on it?".
 */
export async function classify(req: RunRequest): Promise<ClassificationResult> {
  const { score, reasons, tokens } = scoreHeuristics(req);
  const { complexity, confidence } = scoreToTier(score);

  const result: ClassificationResult = {
    complexity,
    confidence,
    signals: [...reasons, `score=${score.toFixed(2)}`],
    estimatedInputTokens: tokens,
    source: 'heuristic',
  };

  // Only pay for a meta-classification when the heuristic is genuinely unsure.
  if (!env.ENABLE_META_CLASSIFIER || confidence >= 0.7) return result;

  try {
    const refined = await metaClassify(req);
    if (refined) {
      return {
        ...result,
        complexity: refined,
        confidence: 0.8,
        signals: [...result.signals, `meta-model overrode ${complexity} -> ${refined}`],
        source: 'meta-model',
      };
    }
  } catch (err) {
    // Never fail a request because the classifier had a bad day.
    logger.warn({ err }, 'meta classifier failed, falling back to heuristic');
  }

  return result;
}

const META_SYSTEM = `You are a request classifier for an AI model router.
Reply with exactly one word: SIMPLE, MEDIUM, or COMPLEX.
SIMPLE = short text transforms, formatting, trivial code fixes.
MEDIUM = moderate code generation, API integration, structured output, light reasoning.
COMPLEX = architecture, deep multi-step reasoning, large context, critical business logic.
No explanation. One word.`;

async function metaClassify(req: RunRequest): Promise<Complexity | null> {
  const model = getModel(env.META_CLASSIFIER_MODEL);
  if (!model) return null;

  const provider = getProvider(model.provider);
  // Truncate: the first 2k characters are more than enough to judge difficulty.
  const excerpt = `${req.task}\n\n${req.input}`.slice(0, 2_000);

  const res = await provider.complete({
    modelId: model.id,
    system: META_SYSTEM,
    prompt: excerpt,
    maxOutputTokens: 8,
    temperature: 0,
    signal: AbortSignal.timeout(5_000),
  });

  const word = res.output.trim().toUpperCase();
  if (word.startsWith('SIMPLE')) return 'simple';
  if (word.startsWith('MEDIUM')) return 'medium';
  if (word.startsWith('COMPLEX')) return 'complex';
  return null;
}
