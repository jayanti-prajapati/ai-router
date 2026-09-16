/**
 * Output quality scorer.
 *
 * Scores are heuristic signals over the raw text — they don't call a model.
 * When a score falls below QUALITY_MIN_SCORE the orchestrator escalates to a
 * stronger model and retries once. This catches:
 *   - empty / near-empty responses
 *   - truncated outputs (model hit max_tokens)
 *   - refusals ("I'm sorry, I can't…")
 *   - repetition loops (model stuck in a loop)
 *   - invalid JSON when the template requires it
 */
import type { NormalizedResponse } from './types.js';

interface QualityOptions {
  /** True when the prompt template expects a JSON response. */
  expectJson?: boolean;
}

export interface QualityResult {
  /** 0–1, higher is better. Below QUALITY_MIN_SCORE triggers escalation. */
  score: number;
  reasons: string[];
}

export function scoreOutput(
  response: NormalizedResponse,
  opts: QualityOptions = {},
): QualityResult {
  const text = response.output.trim();
  const reasons: string[] = [];
  let penalties = 0;

  // ── 1. Empty response ─────────────────────────────────────────────────────
  if (!text) {
    return { score: 0, reasons: ['empty response'] };
  }

  // ── 2. Suspiciously short ─────────────────────────────────────────────────
  if (text.length < 8) {
    penalties += 0.5;
    reasons.push(`very short response (${text.length} chars)`);
  }

  // ── 3. Truncated (hit token limit) ────────────────────────────────────────
  if (response.finishReason === 'length') {
    penalties += 0.35;
    reasons.push('response truncated (finish_reason=length)');
  }

  // ── 4. Refusal patterns ───────────────────────────────────────────────────
  const REFUSAL = /^(i('m| am) sorry|i cannot|i can't|as an ai|i'm afraid|i apologize)/i;
  if (REFUSAL.test(text)) {
    penalties += 0.4;
    reasons.push('refusal detected');
  }

  // ── 5. Repetition loop ────────────────────────────────────────────────────
  // A simple check: if any 20-character window appears more than 4 times, it's looping.
  const windowSize = 20;
  if (text.length > windowSize * 5) {
    const counts = new Map<string, number>();
    for (let i = 0; i <= text.length - windowSize; i++) {
      const slice = text.slice(i, i + windowSize);
      const n = (counts.get(slice) ?? 0) + 1;
      counts.set(slice, n);
      if (n > 4) {
        penalties += 0.35;
        reasons.push('repetition loop detected');
        break;
      }
    }
  }

  // ── 6. JSON validity ──────────────────────────────────────────────────────
  if (opts.expectJson) {
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      penalties += 0.4;
      reasons.push('expected JSON but none found');
    } else {
      try {
        JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      } catch {
        penalties += 0.3;
        reasons.push('malformed JSON');
      }
    }
  }

  const score = Math.max(0, Math.min(1, 1 - penalties));
  return { score, reasons };
}
